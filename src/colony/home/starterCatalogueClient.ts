import { getAuthClient } from "../authClient";
import { COLONY } from "../config";
import { parseBlueprint, validateBlueprint } from "../blueprintScript";
import { parseWorldLayoutDocument, type WorldLayoutDocument } from "../spatial/worldLayoutDocument";
import type { Parcel } from "../neighborhood";
import type { Cell } from "../pathfind";
import { ownedDriveFootprintClear } from "../car/ownedDriving";
import type { DoorDir } from "../voxelHouse";
import {
  type HomeTruth,
  type PurchaseOutcome,
  classifyPurchaseStatus,
  HOME_PURCHASE_PATH,
  isHomeOwned,
} from "./starterProperty";
import { homeTargetCell } from "./driveHome";

export const STARTER_CATALOGUE_TIMEOUT_MS = 10_000;
export const AVAILABLE_PLOTS_PATH = "/kooker/api/v1/citylife/players/me/home/available-plots";
export const HOUSE_BUILD_PATH = "/kooker/api/v1/citylife/players/me/home/build";

export interface StarterParcelGeometry {
  plotId: string;
  worldId: string;
  layoutRevision: string;
  neighbourhoodKey: string;
  parcel: { x: number; y: number; width: number; depth: number };
  houseZone: { x: number; y: number; width: number; depth: number };
  driveway: Cell[];
  roadCells: Cell[];
  spawn: Cell;
}

export interface StarterParcelSurvey {
  candidates: StarterParcelGeometry[];
  rejected: { plotId: string; reason: string }[];
}

export interface PublishedPlayerInventory {
  worldId: string;
  layoutRevision: string;
  plotIds: readonly string[];
  plotFrames: ReadonlyMap<string, string>;
  plotGeometry: ReadonlyMap<string, StarterParcelGeometry>;
  layout: WorldLayoutDocument;
}

export interface StarterPlotOffer {
  readonly plotId: string;
  readonly frameId: string;
  readonly priceKco: number;
  readonly neighbourhoodKey: string;
  readonly worldId: string;
  readonly layoutRevision: string;
  readonly width: number;
  readonly depth: number;
}

export interface HouseBuildContext {
  plotId: string;
  frameId: string;
  layoutRevision: string;
  geometry: StarterParcelGeometry;
  script: string | null;
  completed: boolean;
}

export interface HouseBuildSession {
  userId: string;
  context: HouseBuildContext;
  inventory: PublishedPlayerInventory;
  door: DoorDir;
}

const key = (c: Cell) => `${c.x},${c.y}`;
const adjacent = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 120 &&
    value.trim() === value
  );
}

const object = (value: unknown, message = "Invalid input"): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
};

// ── Published Starter World Hydration ─────────────────────────────────────────────

export function parsePublishedStarterWorld(
  raw: unknown,
  worldId: string,
): PublishedPlayerInventory {
  const response = object(raw, "World catalogue is not published");
  const manifest = object(response.manifest, "World catalogue manifest missing");
  if (
    response.published !== true ||
    manifest.schemaVersion !== "citylife.starter-parcel-manifest/v1" ||
    manifest.worldId !== worldId ||
    !Array.isArray(manifest.plots) ||
    !manifest.plots.length
  ) {
    throw new Error("World catalogue is not published");
  }
  const layout = parseWorldLayoutDocument(JSON.stringify(manifest.layout));
  if (
    layout.worldId !== worldId ||
    layout.revision.contentHash !== manifest.layoutRevision ||
    layout.revision.parentHash !== manifest.sourceLayoutRevision
  ) {
    throw new Error("World catalogue revision does not match its layout");
  }
  const plotIds = new Set<string>();
  const frameIds = new Set<string>();
  const plotFrames = new Map<string, string>();
  const plotGeometry = new Map<string, StarterParcelGeometry>();
  for (const entry of manifest.plots) {
    const plot = object(entry, "Invalid plot entry");
    const geom = object(plot.geometry, "Invalid plot geometry");
    if (
      typeof plot.plotId !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,120}$/.test(plot.plotId) ||
      typeof plot.frameId !== "string" ||
      plotIds.has(plot.plotId) ||
      frameIds.has(plot.frameId) ||
      geom.plotId !== plot.plotId ||
      geom.worldId !== worldId ||
      geom.layoutRevision !== layout.revision.contentHash ||
      !layout.frames.some(
        (f) =>
          f.id === plot.frameId &&
          f.kind === "region" &&
          f.layer === "surface",
      )
    ) {
      throw new Error("World catalogue has inconsistent plot bindings");
    }
    plotIds.add(plot.plotId);
    frameIds.add(plot.frameId);
    plotFrames.set(plot.plotId, plot.frameId);
    plotGeometry.set(plot.plotId, geom as unknown as StarterParcelGeometry);
  }
  return {
    worldId,
    layoutRevision: layout.revision.contentHash,
    plotIds: [...plotIds],
    plotFrames,
    plotGeometry,
    layout,
  };
}

export async function fetchPublishedStarterWorld(
  worldId: string,
  signal?: AbortSignal,
): Promise<PublishedPlayerInventory> {
  const auth = getAuthClient();
  const userId = auth.operator?.userId;
  if (!userId) throw new Error("Sign in to load your world");
  const token = await auth.getValidToken();
  if (!token || auth.operator?.userId !== userId || signal?.aborted) {
    throw new Error("Your session changed. Please retry.");
  }
  const response = await fetch(
    `/kooker/api/v1/citylife/worlds/${encodeURIComponent(worldId)}/starter-catalogue`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(STARTER_CATALOGUE_TIMEOUT_MS)])
        : AbortSignal.timeout(STARTER_CATALOGUE_TIMEOUT_MS),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "The world catalogue has not been published yet. Please try again later."
        : "The world catalogue could not be loaded. Please retry.",
    );
  }
  const raw: unknown = await response.json();
  if (auth.operator?.userId !== userId || signal?.aborted) {
    throw new Error("Your session changed. Please retry.");
  }
  return parsePublishedStarterWorld(raw, worldId);
}

// ── Server-Bound Plot Offers ──────────────────────────────────────────────────────

export function parseStarterPlotOffers(raw: unknown): StarterPlotOffer[] | null {
  if (!Array.isArray(raw)) return null;
  const offers: StarterPlotOffer[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    const offer = record(entry);
    const geom = record(offer?.geometry);
    const parcel = record(geom?.parcel);
    if (
      !offer ||
      !geom ||
      !parcel ||
      !identifier(offer.plotId) ||
      !identifier(offer.frameId) ||
      !identifier(geom.worldId) ||
      !identifier(geom.neighbourhoodKey) ||
      geom.plotId !== offer.plotId ||
      typeof geom.layoutRevision !== "string" ||
      !/^[a-f0-9]{64}$/.test(geom.layoutRevision) ||
      typeof offer.priceKco !== "number" ||
      !Number.isFinite(offer.priceKco) ||
      offer.priceKco < 0 ||
      typeof parcel.width !== "number" ||
      !Number.isSafeInteger(parcel.width) ||
      parcel.width <= 0 ||
      typeof parcel.depth !== "number" ||
      !Number.isSafeInteger(parcel.depth) ||
      parcel.depth <= 0 ||
      ids.has(offer.plotId)
    ) {
      return null;
    }
    ids.add(offer.plotId);
    offers.push({
      plotId: offer.plotId,
      frameId: offer.frameId,
      priceKco: offer.priceKco,
      neighbourhoodKey: geom.neighbourhoodKey,
      worldId: geom.worldId,
      layoutRevision: geom.layoutRevision,
      width: parcel.width,
      depth: parcel.depth,
    });
  }
  return offers.sort((a, b) => (a.plotId < b.plotId ? -1 : a.plotId > b.plotId ? 1 : 0));
}

export function bindStarterPlotOffers(
  offers: StarterPlotOffer[] | null,
  inventory:
    | Pick<PublishedPlayerInventory, "worldId" | "layoutRevision" | "plotIds" | "plotFrames">
    | undefined,
): StarterPlotOffer[] | null {
  if (!offers || !inventory) return null;
  return offers.every(
    (offer) =>
      offer.worldId === inventory.worldId &&
      offer.layoutRevision === inventory.layoutRevision &&
      inventory.plotIds.includes(offer.plotId) &&
      inventory.plotFrames.get(offer.plotId) === offer.frameId,
  )
    ? offers
    : null;
}

export async function fetchStarterPlotOffers(
  inventory?: Pick<
    PublishedPlayerInventory,
    "worldId" | "layoutRevision" | "plotIds" | "plotFrames"
  >,
): Promise<StarterPlotOffer[] | null> {
  const auth = getAuthClient();
  const userId = auth.operator?.userId;
  if (!userId) return null;
  try {
    const token = await auth.getValidToken();
    if (!token || auth.operator?.userId !== userId) return null;
    const response = await fetch(AVAILABLE_PLOTS_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return auth.operator?.userId === userId
      ? bindStarterPlotOffers(parseStarterPlotOffers(body), inventory)
      : null;
  } catch {
    return null;
  }
}

export async function postPurchasePlot(
  plotId: string,
  offers: readonly StarterPlotOffer[],
): Promise<PurchaseOutcome> {
  const offer = offers.find((item) => item.plotId === plotId);
  if (!offer) return { kind: "disabled" };
  return postPlotSelection(offer);
}

export async function postResumePlotPurchase(truth: HomeTruth): Promise<PurchaseOutcome> {
  if (
    truth.status !== "REJECTED_INSUFFICIENT_FUNDS" ||
    !truth.plotId ||
    !truth.neighbourhoodKey ||
    !truth.layoutRevision ||
    !/^[a-f0-9]{64}$/.test(truth.layoutRevision)
  ) {
    return { kind: "disabled" };
  }
  return postPlotSelection({
    plotId: truth.plotId,
    neighbourhoodKey: truth.neighbourhoodKey,
    layoutRevision: truth.layoutRevision,
  });
}

async function postPlotSelection(
  offer: Pick<StarterPlotOffer, "plotId" | "neighbourhoodKey" | "layoutRevision">,
): Promise<PurchaseOutcome> {
  const auth = getAuthClient();
  const userId = auth.operator?.userId;
  if (!userId) return { kind: "disabled" };
  try {
    const token = await auth.getValidToken();
    if (!token || auth.operator?.userId !== userId) return { kind: "disabled" };
    const response = await fetch(HOME_PURCHASE_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": `citylife:plot-purchase:${userId}:${offer.plotId}:${offer.layoutRevision}`,
      },
      body: JSON.stringify({
        neighbourhoodKey: offer.neighbourhoodKey,
        plotId: offer.plotId,
        layoutRevision: offer.layoutRevision,
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (auth.operator?.userId !== userId) return { kind: "disabled" };
    if (response.status === 409) return { kind: "error", status: 409 };
    if (
      response.ok &&
      record(body)?.status !== "PLOT_OWNED" &&
      record(body)?.status !== "PENDING"
    ) {
      return { kind: "error", status: response.status };
    }
    if (response.ok && record(body)?.status === "PENDING") return { kind: "pending" };
    return classifyPurchaseStatus(response.status, body);
  } catch {
    return { kind: "error" };
  }
}

// ── Durable House Builder ─────────────────────────────────────────────────────────

export function houseDoor(geometry: StarterParcelGeometry): DoorDir {
  const h = geometry.houseZone;
  const end = geometry.driveway.at(-1);
  if (!end) throw new Error("Driveway is unavailable");
  if (end.x === h.x + Math.floor(h.width / 2)) {
    if (end.y === h.y - 1) return "n";
    if (end.y === h.y + h.depth) return "s";
  }
  if (end.y === h.y + Math.floor(h.depth / 2)) {
    if (end.x === h.x - 1) return "w";
    if (end.x === h.x + h.width) return "e";
  }
  throw new Error("Your house entrance does not meet its driveway");
}

export function parseHouseBuildContext(
  raw: unknown,
  inventory: PublishedPlayerInventory,
): HouseBuildContext {
  const value = object(raw, "Invalid house details");
  const geom = object(value.geometry, "Invalid house geometry");
  const zone = object(geom.houseZone, "Invalid house zone");
  if (
    typeof value.plotId !== "string" ||
    typeof value.frameId !== "string" ||
    !inventory.plotIds.includes(value.plotId) ||
    inventory.plotFrames.get(value.plotId) !== value.frameId ||
    value.layoutRevision !== inventory.layoutRevision ||
    geom.worldId !== inventory.worldId ||
    geom.plotId !== value.plotId ||
    geom.layoutRevision !== value.layoutRevision ||
    typeof value.completed !== "boolean" ||
    !(value.script === null || typeof value.script === "string") ||
    !Array.isArray(geom.driveway) ||
    !geom.driveway.length ||
    ![zone.x, zone.y, zone.width, zone.depth].every(Number.isSafeInteger) ||
    Number(zone.width) < 1 ||
    Number(zone.width) > 24 ||
    Number(zone.depth) < 1 ||
    Number(zone.depth) > 24
  ) {
    throw new Error("Your plot does not match the published world. Please retry.");
  }
  const context = value as unknown as HouseBuildContext;
  const published = inventory.plotGeometry.get(context.plotId);
  const canonical = (input: unknown): string => {
    if (Array.isArray(input)) return `[${input.map(canonical).join(",")}]`;
    if (input && typeof input === "object") {
      return `{${Object.entries(input)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`)
        .join(",")}}`;
    }
    return JSON.stringify(input);
  };
  const geometryKey = (g: StarterParcelGeometry) =>
    canonical({
      ...g,
      roadCells: [...g.roadCells].sort((a, b) => a.x - b.x || a.y - b.y),
    });
  if (!published || geometryKey(context.geometry) !== geometryKey(published)) {
    throw new Error("House geometry differs from the published plot");
  }
  const door = houseDoor(context.geometry);
  if (context.completed && !context.script) {
    throw new Error("Completed house design is missing");
  }
  if (context.script) {
    const design = parseBlueprint(context.script);
    if (
      !validateBlueprint(context.script).ok ||
      design.w !== zone.width ||
      design.d !== zone.depth ||
      design.doorDir !== door
    ) {
      throw new Error("Saved house design does not match your plot");
    }
  }
  return context;
}

async function requestHouseBuild(userId: string, body?: unknown): Promise<unknown> {
  const auth = getAuthClient();
  if (auth.operator?.userId !== userId) throw new Error("Your account changed. Reload the builder.");
  const token = await auth.getValidToken();
  if (!token || auth.operator?.userId !== userId) throw new Error("Sign in again to build your house.");
  const response = await fetch(HOUSE_BUILD_PATH, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const result: unknown = await response.json().catch(() => null);
  if (auth.operator?.userId !== userId) throw new Error("Your account changed. Reload the builder.");
  if (!response.ok) {
    throw new Error(
      response.status === 422
        ? "Check your design: an indoor room must meet the driveway entrance."
        : response.status === 409
          ? "Your plot or saved house changed. Reload before continuing."
          : "House building is unavailable. Please retry.",
    );
  }
  return result;
}

export async function loadHouseBuild(
  loadedInventory?: PublishedPlayerInventory,
): Promise<HouseBuildSession> {
  const userId = getAuthClient().operator?.userId;
  if (!userId) throw new Error("Sign in to CityLife before building your house.");
  const inventory =
    loadedInventory ?? (await fetchPublishedStarterWorld(`seed-${COLONY.render.seed}`));
  const context = parseHouseBuildContext(await requestHouseBuild(userId), inventory);
  return { userId, inventory, context, door: houseDoor(context.geometry) };
}

export async function completeHouseBuild(
  session: HouseBuildSession,
  script: string,
): Promise<HouseBuildContext> {
  const { plotId, layoutRevision } = session.context;
  const receipt = parseHouseBuildContext(
    await requestHouseBuild(session.userId, { plotId, layoutRevision, script }),
    session.inventory,
  );
  if (!receipt.completed || receipt.plotId !== plotId || receipt.script !== script) {
    throw new Error("House completion is not confirmed. Retry the same design.");
  }
  const truth = parseHouseBuildContext(
    await requestHouseBuild(session.userId),
    session.inventory,
  );
  if (!truth.completed || truth.plotId !== plotId || truth.script !== script) {
    throw new Error("Your saved house could not be confirmed. Retry the same design.");
  }
  return truth;
}

// ── Returning Resident Projection ─────────────────────────────────────────────────

export interface ReturningResidentProjection {
  readonly isResident: boolean;
  readonly homeCell: Cell | null;
  readonly vehicle: {
    readonly id: string;
    readonly model: string;
    readonly x: number;
    readonly y: number;
    readonly heading: number;
  } | null;
}

export function projectReturningResidentState(
  truth: HomeTruth | null,
  inventory?: PublishedPlayerInventory,
): ReturningResidentProjection {
  if (!truth || !isHomeOwned(truth)) {
    return { isResident: false, homeCell: null, vehicle: null };
  }
  const homeCell = homeTargetCell(truth);
  const isResident =
    truth.onboardingState === "RESIDENT" ||
    truth.isResident === true ||
    truth.status === "RESIDENT" ||
    truth.arrivalStatus === "RESIDENT";

  let vehicle: ReturningResidentProjection["vehicle"] = null;
  const geom = truth.plotId && inventory ? inventory.plotGeometry.get(truth.plotId) : truth.geometry;
  const spawn = geom?.spawn ?? (geom?.driveway && geom.driveway.length > 1 ? geom.driveway[1] : null);

  if (
    typeof truth.vehicleId === "string" &&
    truth.vehicleId.trim() &&
    typeof truth.vehicleModel === "string" &&
    truth.vehicleModel.trim()
  ) {
    if (truth.vehiclePose) {
      const { x, y, heading } = truth.vehiclePose;
      const validHeading = typeof heading === "number" && Number.isFinite(heading);
      if (
        typeof x === "number" &&
        Number.isFinite(x) &&
        typeof y === "number" &&
        Number.isFinite(y) &&
        validHeading
      ) {
        vehicle = {
          id: truth.vehicleId.trim(),
          model: truth.vehicleModel.trim(),
          x,
          y,
          heading,
        };
      } else {
        // Atomic rejection: malformed (NaN/Infinity) vehiclePose rejects with null projection.
        // Never mix coordinates across sources or invent heading 0.
        vehicle = null;
      }
    } else if (
      spawn &&
      typeof spawn.x === "number" &&
      Number.isFinite(spawn.x) &&
      typeof spawn.y === "number" &&
      Number.isFinite(spawn.y)
    ) {
      vehicle = {
        id: truth.vehicleId.trim(),
        model: truth.vehicleModel.trim(),
        x: spawn.x,
        y: spawn.y,
        heading: 0,
      };
    }
  }

  return { isResident, homeCell, vehicle };
}

// ── Vehicle Offers & Authoritative X19 Pricing ───────────────────────────────────

export function verifyX19Pricing(
  prices: Readonly<Record<string, number>> | null,
): { valid: boolean; priceKco: number | null } {
  if (!prices) return { valid: false, priceKco: null };
  const keys = ["karoo-x19-targa", "showroom:karoo-x19-targa", "x19", "karoo-x19"];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(prices, k)) {
      const p = prices[k];
      if (typeof p === "number" && Number.isFinite(p) && p > 0) {
        return { valid: true, priceKco: p };
      }
    }
  }
  return { valid: false, priceKco: null };
}

// ── Starter Parcel Survey & Driveway Clearance ────────────────────────────────────

export function surveyStarterDrivewayClearance(
  geometry: StarterParcelGeometry,
  lot: Parcel,
  roads: readonly Cell[],
  groundClear: (cell: Cell) => boolean,
): { clear: boolean; heading: number; reason: string | null } {
  const end = geometry.driveway.findIndex((c) => key(c) === key(geometry.spawn));
  const path = geometry.driveway.slice(0, end + 1).reverse();
  if (path.length < 2) return { clear: false, heading: 0, reason: "missing-spawn-route" };
  const heading = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
  if (
    path.some(
      (c, i) =>
        i > 0 &&
        (!adjacent(c, path[i - 1]) ||
          Math.atan2(c.y - path[i - 1].y, c.x - path[i - 1].x) !== heading),
    )
  ) {
    return { clear: false, heading, reason: "requires-turn-survey" };
  }
  const permitted = new Set([...roads, ...geometry.driveway].map(key));
  const fence = new Set(lot.fence.map(key));
  const h = geometry.houseZone;
  const canOccupy = (x: number, y: number) => {
    const cell = { x: Math.round(x), y: Math.round(y) };
    return (
      permitted.has(key(cell)) &&
      !fence.has(key(cell)) &&
      groundClear(cell) &&
      !(cell.x >= h.x && cell.x < h.x + h.width && cell.y >= h.y && cell.y < h.y + h.depth)
    );
  };
  const distance = Math.hypot(path[0].x - path.at(-1)!.x, path[0].y - path.at(-1)!.y);
  const sampleMetres =
    ((COLONY.ownedDriving as any).drivewayClearanceSampleMetres as number | undefined) ?? 0.25;
  const samples = Math.ceil(
    (distance * COLONY.ownedDriving.cellMetres) / sampleMetres,
  );
  for (let i = 0; i <= samples; i++) {
    const fraction = i / samples;
    if (
      !ownedDriveFootprintClear(
        {
          x: path[0].x + (path.at(-1)!.x - path[0].x) * fraction,
          y: path[0].y + (path.at(-1)!.y - path[0].y) * fraction,
          heading,
        },
        canOccupy,
      )
    ) {
      return { clear: false, heading, reason: "vehicle-footprint-blocked" };
    }
  }
  return { clear: true, heading, reason: null };
}

export function surveyStarterParcels(input: {
  worldId: string;
  layoutRevision: string;
  parcels: readonly Parcel[];
  roads: readonly Cell[];
  groundClear: (cell: Cell) => boolean;
}): StarterParcelSurvey {
  if (!input.worldId || !/^[a-f0-9]{64}$/.test(input.layoutRevision)) {
    throw new Error("A canonical world and SHA256 layout revision are required");
  }
  const roadSet = new Set(input.roads.map(key));
  const result: StarterParcelSurvey = { candidates: [], rejected: [] };
  const ids = new Set<string>();
  for (const lot of input.parcels) {
    if (ids.has(lot.id)) throw new Error(`Duplicate parcel ${lot.id}`);
    ids.add(lot.id);
    const reject = (reason: string) => result.rejected.push({ plotId: lot.id, reason });
    if (!lot.neighborhoodKey) {
      reject("missing-neighbourhood-key");
      continue;
    }
    if (lot.ownerCitizenId || lot.reservedFor || lot.built || lot.zone === "commercial") {
      reject("occupied-or-reserved");
      continue;
    }
    if (!lot.fence.length) {
      reject("missing-boundary");
      continue;
    }
    const boundary = [...lot.fence, lot.gate];
    const x = Math.min(...boundary.map((c) => c.x));
    const y = Math.min(...boundary.map((c) => c.y));
    const maxX = Math.max(...boundary.map((c) => c.x));
    const maxY = Math.max(...boundary.map((c) => c.y));
    const house = lot.houseZone;
    if (
      maxX - x + 1 !== lot.w ||
      maxY - y + 1 !== lot.h ||
      house.x < x ||
      house.y < y ||
      house.x + house.w > maxX + 1 ||
      house.y + house.d > maxY + 1
    ) {
      reject("invalid-boundary");
      continue;
    }
    const inHouse = (c: Cell) =>
      c.x >= house.x && c.x < house.x + house.w && c.y >= house.y && c.y < house.y + house.d;
    const houseStart = lot.driveway.findIndex(inHouse);
    if (houseStart < 0) {
      reject("path-misses-house");
      continue;
    }
    const approach = lot.driveway.slice(0, houseStart).map((c) => ({ ...c }));
    if (!approach.length) {
      reject("missing-approach");
      continue;
    }
    if (!roadSet.has(key(approach[0]))) {
      const joins = input.roads
        .filter((c) => adjacent(c, approach[0]))
        .sort((a, b) => a.x - b.x || a.y - b.y);
      if (!joins.length) {
        reject("disconnected-road");
        continue;
      }
      approach.unshift({ ...joins[0] });
    }
    if (
      new Set(approach.map(key)).size !== approach.length ||
      approach.some(
        (c, i) =>
          !Number.isInteger(c.x) ||
          !Number.isInteger(c.y) ||
          !input.groundClear(c) ||
          inHouse(c) ||
          (i > 0 && !adjacent(c, approach[i - 1])),
      )
    ) {
      reject("invalid-approach");
      continue;
    }
    const spawn = approach
      .slice(1, -1)
      .reverse()
      .find(
        (c) =>
          !roadSet.has(key(c)) &&
          c.x >= x &&
          c.x <= maxX &&
          c.y >= y &&
          c.y <= maxY,
      );
    if (!spawn) {
      reject("no-off-road-spawn");
      continue;
    }
    result.candidates.push({
      plotId: lot.id,
      worldId: input.worldId,
      layoutRevision: input.layoutRevision,
      neighbourhoodKey: lot.neighborhoodKey,
      parcel: { x, y, width: maxX - x + 1, depth: maxY - y + 1 },
      houseZone: { x: house.x, y: house.y, width: house.w, depth: house.d },
      driveway: approach,
      roadCells: approach.filter((c) => roadSet.has(key(c))),
      spawn: { ...spawn },
    });
  }
  return result;
}
