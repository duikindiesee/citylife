// PLAYER.HOME.1C — the dark, server-truth client contract for the starter-property selection and
// identity-bound house projection. It mirrors PLAYER.CAR.1.S4's carAcquisition purity rules:
//
//   • The eligible starter choices are SERVER-RETURNED ONLY. The client never infers a choice from the
//     map, a static layout, localStorage or any client state — it renders exactly what the authority
//     lists and nothing else. A private/inaccessible neighbourhood is simply ABSENT from that list
//     (the server omits it), so omission is server-owned and never a client filter that could leak.
//   • On purchase the client posts the SELECTED neighbourhoodKey ONLY, and only when that key is one the
//     server just offered. It never names a price, never moves KCO, never claims a plot/frame/owner/deed
//     — the kooker service is the sole authority for identity (from the bearer token), price and grant.
//   • Ownership renders from the authoritative home-truth GET. There is NO localStorage authority: the
//     projected house is a pure function of the re-fetched server truth (see starterHouseProjection).
//   • Every purchase response is classified into a small closed set the overlay renders: owned (grant),
//     insufficient_funds (422), pending (accepted/replay), disabled (signed out / flag off / kill
//     switch), error. 422 (not the vehicle flow's 402) is the deployed home-purchase shortfall status;
//     503 (kill switch) and 401/403 (signed out / feature off) all fail closed to disabled.
//
// The whole step is DARK by the SERVER's own gate: the fail-closed `new-player-journey-v1` entitlement
// (evaluated in ColonyApp) hides the entry unless the backend unambiguously allowlists the player, and
// the deployed home-purchase route itself answers 403/503 while its flag / kill switch are OFF. The
// client keeps NO independent on/off switch that could drift from the server or be flipped in a build —
// authority lives solely with the service, which is why an unreachable flag endpoint fails closed. The
// pure model ops (the sanitisers, the response classifier and the button view) take no DOM and are
// node-testable; the backend layer is best-effort and fail-soft like carAcquisition / furnitureStore:
// it never throws, never blocks the game, and tolerates a 404 while an endpoint ships separately.
import { getAuthClient } from "../authClient";

/** GET the server-eligible starter neighbourhood choices for THIS signed-in player (token-derived).
 *  The server has already applied the stricter `isPubliclyEligibleForStarterHome` gate, so a private
 *  or inaccessible neighbourhood never appears here. */
export const HOME_ELIGIBLE_PATH =
  "/kooker/api/v1/citylife/players/me/home/eligible-neighbourhoods";
/** GET the authoritative home truth (owned/status/plot/frame) for the signed-in player. */
export const HOME_TRUTH_PATH = "/kooker/api/v1/citylife/players/me/home";
/** POST a single selected neighbourhoodKey to purchase; the service checks funds, moves coin, derives
 *  the plot/frame/deed from the token identity and records ownership itself. */
export const HOME_PURCHASE_PATH =
  "/kooker/api/v1/citylife/players/me/home/purchase";
export const HOME_BUILD_PATH =
  "/kooker/api/v1/citylife/players/me/home/build";
export const HOME_ARRIVAL_PATH =
  "/kooker/api/v1/citylife/players/me/home/arrival";

export interface PurchaseHomeOptions {
  neighbourhoodKey: string;
  plotId?: string;
  layoutRevision?: string;
}

/** The starter home's server-owned onboarding states, mirrored for the guided-journey advance. Only
 *  `OWNED` truth (owned === true) advances the journey and projects a house. */
export type HomeOnboardingState =
  | "NONE"
  | "PENDING"
  | "OWNED"
  | "REQUIRES_OPERATOR"
  | string;

// ── Eligible starter choices (SERVER-RETURNED ONLY) ───────────────────────────────

/** One server-offered starter-property choice. `key` is the ONLY thing the client may ever post back;
 *  `name` and `priceKco` are display-only server truth the UI shows but must never author or submit. */
export interface EligibleNeighbourhood {
  readonly key: string;
  readonly name: string;
  /** The canonical server price in KCO. Display only — never submitted. `null` when the server did not
   *  quote one (the UI shows it as unknown rather than inventing a number). */
  readonly priceKco: number | null;
  readonly plotId?: string;
  readonly layoutRevision?: string;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

/** Coerce a raw server entry into an EligibleNeighbourhood, or null if it lacks a usable key. Price is
 *  kept only when the server sent a finite number — never defaulted, so the UI can only ever show the
 *  authority's own quote. Pure. */
export function coerceEligibleNeighbourhood(
  raw: unknown,
): EligibleNeighbourhood | null {
  const o = asRecord(raw);
  if (!o) return null;
  const key = typeof o.key === "string" ? o.key.trim() : "";
  if (!key) return null;
  const name =
    typeof o.name === "string" && o.name.trim() ? o.name.trim() : key;
  const priceRaw = o.priceKco ?? o.price;
  const priceKco =
    typeof priceRaw === "number" && Number.isFinite(priceRaw) ? priceRaw : null;
  const plotId =
    typeof o.plotId === "string" && o.plotId.trim() ? o.plotId.trim() : undefined;
  const layoutRevision =
    typeof o.layoutRevision === "string" && o.layoutRevision.trim()
      ? o.layoutRevision.trim()
      : undefined;
  return {
    key,
    name,
    priceKco,
    ...(plotId ? { plotId } : {}),
    ...(layoutRevision ? { layoutRevision } : {}),
  };
}

/** Screen a raw server body into the sorted, de-duped list of eligible choices we are willing to render
 *  and post. Accepts either a bare array or a { neighbourhoods: [...] } envelope. Unknown/keyless
 *  entries are dropped; duplicate keys keep the first. Sorted by key for a deterministic render order.
 *  Returns [] for anything malformed — the overlay then shows an empty/legacy state, never a guess. */
export function sanitizeEligibleNeighbourhoods(
  raw: unknown,
): EligibleNeighbourhood[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw)?.neighbourhoods)
      ? (asRecord(raw)!.neighbourhoods as unknown[])
      : null;
  if (!arr) return [];
  const seen = new Set<string>();
  const out: EligibleNeighbourhood[] = [];
  for (const e of arr) {
    const n = coerceEligibleNeighbourhood(e);
    if (!n || seen.has(n.key)) continue;
    seen.add(n.key);
    out.push(n);
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

// ── Authoritative home truth ──────────────────────────────────────────────────────

export interface HomeTruthParcelGeometry {
  readonly plotId?: string;
  readonly worldId?: string;
  readonly layoutRevision?: string;
  readonly neighbourhoodKey?: string;
  readonly parcel?: { readonly x: number; readonly y: number; readonly width: number; readonly depth: number };
  readonly houseZone?: { readonly x: number; readonly y: number; readonly width: number; readonly depth: number };
  readonly door?: { readonly x: number; readonly y: number };
  readonly driveway?: readonly { readonly x: number; readonly y: number }[];
  readonly roadCells?: readonly { readonly x: number; readonly y: number }[];
  readonly spawn?: { readonly x: number; readonly y: number };
}

export interface HomeTruthVehiclePose {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly heading?: number;
}

/** The authoritative home truth the server returns (shape from the deployed user-service 1.37.3
 *  contract: `{owned,status,neighbourhoodKey,plotId,onboardingState}`, plus published server-bound
 *  plot offers, geometry, build state, arrival/residency and owned-vehicle projection). Every field
 *  is server-owned; the client only reads it. */
export interface HomeTruth {
  readonly owned: boolean;
  readonly status: string | null;
  readonly neighbourhoodKey: string | null;
  readonly plotId: string | null;
  readonly frameId: string | null;
  readonly onboardingState: HomeOnboardingState;
  /** The canonical price the server charged/charges, display only. */
  readonly priceKco: number | null;
  /** Published layout revision the deed/plot belongs to. */
  readonly layoutRevision?: string | null;
  /** Published server-owned coordinates if directly quoted. */
  readonly x?: number | null;
  readonly y?: number | null;
  /** Published server-owned plot geometry, foundations and driveway cells. */
  readonly geometry?: HomeTruthParcelGeometry | null;
  /** Durable house-builder completion state and blueprint design. */
  readonly plotOwned?: boolean;
  readonly requiresBuild?: boolean;
  readonly buildState?: string | null;
  readonly completed?: boolean;
  readonly script?: string | null;
  /** Arrival and residency state. */
  readonly arrivalStatus?: string | null;
  readonly isResident?: boolean;
  /** Exact owned vehicle projection on return and reload. */
  readonly vehicleId?: string | null;
  readonly vehicleModel?: string | null;
  readonly vehiclePose?: HomeTruthVehiclePose | null;
}

/** Coerce a raw home-truth body into a HomeTruth, or null if it is not a usable object. `owned` is true
 *  ONLY on an explicit boolean true — anything ambiguous reads as not-owned so the journey never
 *  advances and no house projects on a malformed payload. Pure, fail-closed. */
export function parseHomeTruth(raw: unknown): HomeTruth | null {
  const o = asRecord(raw);
  if (!o) return null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const priceRaw = o.priceKco ?? o.price;

  let geometry: HomeTruthParcelGeometry | null = null;
  const geomRaw = asRecord(o.geometry);
  if (geomRaw) {
    const parcelRaw = asRecord(geomRaw.parcel);
    const hzRaw = asRecord(geomRaw.houseZone);
    const doorRaw = asRecord(geomRaw.door);
    const spawnRaw = asRecord(geomRaw.spawn);
    const parseCells = (arr: unknown): readonly { x: number; y: number }[] | undefined => {
      if (!Array.isArray(arr)) return undefined;
      const res: { x: number; y: number }[] = [];
      for (const item of arr) {
        const c = asRecord(item);
        if (
          c &&
          typeof c.x === "number" &&
          Number.isFinite(c.x) &&
          typeof c.y === "number" &&
          Number.isFinite(c.y)
        ) {
          res.push({ x: c.x, y: c.y });
        }
      }
      return res;
    };
    geometry = {
      plotId: str(geomRaw.plotId) ?? undefined,
      worldId: str(geomRaw.worldId) ?? undefined,
      layoutRevision: str(geomRaw.layoutRevision) ?? undefined,
      neighbourhoodKey: str(geomRaw.neighbourhoodKey) ?? undefined,
      parcel:
        parcelRaw && typeof parcelRaw.x === "number" && Number.isFinite(parcelRaw.x) && typeof parcelRaw.y === "number" && Number.isFinite(parcelRaw.y)
          ? {
              x: parcelRaw.x as number,
              y: parcelRaw.y as number,
              width: typeof parcelRaw.width === "number" && Number.isFinite(parcelRaw.width) ? parcelRaw.width : 0,
              depth: typeof parcelRaw.depth === "number" && Number.isFinite(parcelRaw.depth) ? parcelRaw.depth : 0,
            }
          : undefined,
      houseZone:
        hzRaw && typeof hzRaw.x === "number" && Number.isFinite(hzRaw.x) && typeof hzRaw.y === "number" && Number.isFinite(hzRaw.y)
          ? {
              x: hzRaw.x as number,
              y: hzRaw.y as number,
              width:
                typeof hzRaw.width === "number" && Number.isFinite(hzRaw.width)
                  ? hzRaw.width
                  : typeof (hzRaw as any).w === "number" && Number.isFinite((hzRaw as any).w)
                    ? ((hzRaw as any).w as number)
                    : 0,
              depth:
                typeof hzRaw.depth === "number" && Number.isFinite(hzRaw.depth)
                  ? hzRaw.depth
                  : typeof (hzRaw as any).d === "number" && Number.isFinite((hzRaw as any).d)
                    ? ((hzRaw as any).d as number)
                    : 0,
            }
          : undefined,
      door:
        doorRaw && typeof doorRaw.x === "number" && Number.isFinite(doorRaw.x) && typeof doorRaw.y === "number" && Number.isFinite(doorRaw.y)
          ? { x: doorRaw.x as number, y: doorRaw.y as number }
          : undefined,
      spawn:
        spawnRaw && typeof spawnRaw.x === "number" && Number.isFinite(spawnRaw.x) && typeof spawnRaw.y === "number" && Number.isFinite(spawnRaw.y)
          ? { x: spawnRaw.x as number, y: spawnRaw.y as number }
          : undefined,
      driveway: parseCells(geomRaw.driveway),
      roadCells: parseCells(geomRaw.roadCells),
    };
  }

  const vPoseRaw = asRecord(o.vehiclePose);
  const vehiclePose: HomeTruthVehiclePose | null = vPoseRaw
    ? {
        x: typeof vPoseRaw.x === "number" ? vPoseRaw.x : NaN,
        y: typeof vPoseRaw.y === "number" ? vPoseRaw.y : NaN,
        z: num(vPoseRaw.z) ?? undefined,
        heading: typeof vPoseRaw.heading === "number" ? vPoseRaw.heading : NaN,
      }
    : null;

  const statusStr = str(o.status);
  const plotIdStr = str(o.plotId);
  const layoutRevisionStr = str(o.layoutRevision);
  const isResident =
    o.isResident === true ||
    str(o.arrivalStatus) === "RESIDENT" ||
    statusStr === "RESIDENT";
  const plotOwned = o.plotOwned === true || statusStr === "PLOT_OWNED";
  const serverRequiresBuild = typeof o.requiresBuild === "boolean" ? o.requiresBuild : undefined;
  const publishedCompletedFromProvider =
    o.owned === true &&
    o.plotOwned === true &&
    serverRequiresBuild === false &&
    (statusStr === "OWNED" || statusStr === "RESIDENT") &&
    Boolean(plotIdStr && layoutRevisionStr);
  const completed =
    serverRequiresBuild !== true &&
    statusStr !== "PLOT_OWNED" &&
    (o.completed === true ||
      str(o.buildState) === "COMPLETED" ||
      publishedCompletedFromProvider);
  const requiresBuild =
    serverRequiresBuild === true ||
    statusStr === "PLOT_OWNED" ||
    (plotOwned && !completed);

  return {
    owned: o.owned === true,
    plotOwned,
    requiresBuild,
    status: statusStr,
    neighbourhoodKey: str(o.neighbourhoodKey),
    plotId: plotIdStr,
    frameId: str(o.frameId),
    onboardingState: str(o.onboardingState) ?? "NONE",
    priceKco: num(priceRaw),
    layoutRevision: layoutRevisionStr,
    x: num(o.x),
    y: num(o.y),
    geometry,
    buildState: str(o.buildState),
    completed,
    script: str(o.script),
    arrivalStatus: str(o.arrivalStatus),
    isResident,
    vehicleId: str(o.vehicleId) ?? str(o.ownedVehicleId),
    vehicleModel: str(o.vehicleModel) ?? str(o.vehicleKey),
    vehiclePose,
  };
}

/** Does the authoritative truth say the home is owned? The single guard the guided journey advances on
 *  and the projection keys off — owned must be explicitly true AND the status must not contradict it.
 *  Pure. */
export function isHomeOwned(truth: HomeTruth | null): boolean {
  if (!truth) return false;
  if (!truth.owned) return false;
  // A status is optional, but if the server sent one it must not say the home is unowned/pending.
  if (
    truth.status &&
    truth.status.toUpperCase() !== "OWNED" &&
    truth.status.toUpperCase() !== "RESIDENT" &&
    truth.status.toUpperCase() !== "PLOT_OWNED"
  ) {
    return false;
  }
  return true;
}

// ── Purchase response classification ──────────────────────────────────────────────

/** The states one purchase attempt can settle into — the overlay renders exactly one. */
export type PurchaseOutcome =
  | { kind: "owned" } // 200/201 — the server granted (or confirms prior) ownership
  | { kind: "insufficient_funds" } // 422 — not enough KCO; the service moved no coin
  | { kind: "pending" } // 202/409 — accepted or a replay of an in-flight/settled request
  | { kind: "disabled" } // 401/403/503 — signed out, feature off, or kill switch; never blind-retry
  | { kind: "error"; status?: number }; // anything else — a transient/unknown failure

/** Map a purchase HTTP status to a closed outcome. The kooker service owns the decision; the client only
 *  interprets it. 409/202 both mean "already being handled" — an idempotent replay that must never
 *  double-charge, so we surface a neutral pending rather than a second POST. 422 is the deployed
 *  insufficient-funds shortfall (distinct from the vehicle flow's 402). 503 is the home kill switch and
 *  403 the feature-flag/off gate — both fail closed to disabled so the journey holds on the legacy
 *  path. Pure. */
export function classifyPurchaseStatus(status: number, body?: unknown): PurchaseOutcome {
  if (status === 200 || status === 201) return { kind: "owned" };
  if (status === 422) return { kind: "insufficient_funds" };
  if (status === 202 || status === 409) return { kind: "pending" };
  if (status === 401 || status === 403 || status === 503)
    return { kind: "disabled" };
  return { kind: "error", status };
}

export type BuildOutcome =
  | { kind: "confirmed" }
  | { kind: "rejected"; reason?: string }
  | { kind: "disabled" }
  | { kind: "error" };

export function classifyBuildStatus(status: number, body?: unknown): BuildOutcome {
  if (status === 200 || status === 201) return { kind: "confirmed" };
  if (status === 422) {
    const o = asRecord(body);
    const reason = typeof o?.reason === "string" ? o.reason : undefined;
    return { kind: "rejected", reason };
  }
  if (status === 401 || status === 403 || status === 503) return { kind: "disabled" };
  return { kind: "error" };
}

/** The rendered shape of the purchase control, derived purely from ownership + selection + in-flight +
 *  last outcome so the overlay stays a thin view and the "handle every state" logic is node-testable.
 *  `state` is the stable key an E2E asserts (data-purchase-state); `disabled` is true whenever a tap
 *  must not fire another POST (already owned, nothing selected, in flight, being processed, or refused). */
export interface PurchaseButtonView {
  readonly state:
    | "ready"
    | "pending"
    | "owned"
    | "insufficient_funds"
    | "disabled"
    | "error";
  readonly label: string;
  readonly disabled: boolean;
}

export function purchaseButtonView(
  isOwned: boolean,
  hasSelection: boolean,
  isPending: boolean,
  outcome: PurchaseOutcome | undefined,
): PurchaseButtonView {
  if (isOwned)
    return { state: "owned", label: "✓ Home secured", disabled: true };
  if (isPending)
    return { state: "pending", label: "⏳ Securing…", disabled: true };
  switch (outcome?.kind) {
    case "insufficient_funds":
      return {
        state: "insufficient_funds",
        label: "Not enough ₭ — try later",
        disabled: false,
      };
    case "pending":
      return { state: "pending", label: "⏳ Processing…", disabled: true };
    case "disabled":
      return { state: "disabled", label: "🔒 Sign in to buy", disabled: true };
    case "error":
      return { state: "error", label: "Couldn't buy — retry", disabled: false };
    default:
      if (!hasSelection)
        return {
          state: "disabled",
          label: "Pick a neighbourhood",
          disabled: true,
        };
      return { state: "ready", label: "Secure this home", disabled: false };
  }
}

/** The accent colour for a purchase state. Kept next to the pure view so the overlay carries no policy,
 *  but separated from {@link purchaseButtonView} so the state machine stays colour-free and testable. */
export function purchaseStateColor(state: PurchaseButtonView["state"]): string {
  switch (state) {
    case "owned":
      return "#9fd4a6";
    case "pending":
      return "#ffd25a";
    case "insufficient_funds":
      return "#f2a35a";
    case "error":
      return "#e07a7a";
    case "disabled":
      return "#7a90a0";
    default:
      return "#a0d4f0";
  }
}

/** A stable idempotency key for one (player, neighbourhood) purchase, so a double-tap or a reload-retry
 *  is the SAME request to the service and can never create a second deed / double-charge. Pure. userId
 *  is best-effort — a signed-in player always has one; the "anon" fallback only appears in a degraded
 *  path where no POST fires. */
export function homePurchaseIdempotencyKey(
  userId: string | null,
  neighbourhoodKey: string,
): string {
  return `citylife:home-purchase:${userId ?? "anon"}:${neighbourhoodKey}`;
}

// ── Backend layer (best-effort, as the logged-in player) ──────────────────────────

async function bearer(): Promise<string | null> {
  return getAuthClient().getValidToken();
}

/** Fetch the SERVER-eligible starter neighbourhood choices. Null when signed out, the endpoint is
 *  missing (404 while it ships separately), or the body is malformed — callers then show the empty /
 *  legacy state, never a client-invented list. Never throws. */
export async function fetchEligibleNeighbourhoods(): Promise<
  EligibleNeighbourhood[] | null
> {
  const token = await bearer();
  if (!token) return null;
  try {
    const resp = await fetch(HOME_ELIGIBLE_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    return sanitizeEligibleNeighbourhoods(data);
  } catch {
    return null;
  }
}

/** Fetch the authoritative home truth. Null when signed out, the endpoint is absent, or the payload is
 *  malformed — callers keep the legacy entry and never project a house. Never throws. */
export async function fetchHomeTruth(): Promise<HomeTruth | null> {
  const token = await bearer();
  if (!token) return null;
  try {
    const resp = await fetch(HOME_TRUTH_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    return parseHomeTruth(data);
  } catch {
    return null;
  }
}

/** Post a starter-home purchase. Sends the SELECTED neighbourhoodKey ONLY (no price, no amount, no owner
 *  or plot claim) plus a stable Idempotency-Key; the service alone checks funds, moves coin, derives the
 *  identity-bound plot/frame/deed and records ownership. Returns a classified {@link PurchaseOutcome}.
export interface PurchaseHomeOptions {
  readonly neighbourhoodKey: string;
  readonly plotId?: string;
  readonly layoutRevision?: string;
}

export const HOME_BUILD_PATH = "/kooker/api/v1/citylife/players/me/home/build";
export const HOME_ARRIVAL_PATH = "/kooker/api/v1/citylife/players/me/home/arrival";

/** Post a starter-home purchase. Sends the SELECTED neighbourhoodKey, plus optional server-bound
 *  plotId and layoutRevision when published offers are active, plus a stable Idempotency-Key.
 *  The service alone checks funds, moves coin, derives the identity-bound plot/frame/deed and
 *  records ownership. Returns a classified {@link PurchaseOutcome}.
 *  Refuses locally — without ever touching the network — when the player is signed out or the key is NOT
 *  one the server just offered (`eligibleKeys`), so a tampered/stale key can never reach the authority.
 *  The DARK gate stays server-owned: while the new-player-journey / home kill switch are OFF the service
 *  answers 403/503, which classifies to `disabled` and moves no KCO — the client never second-guesses it. */
export async function postPurchaseHome(
  selection: string | PurchaseHomeOptions,
  eligibleKeys: readonly string[],
): Promise<PurchaseOutcome> {
  const neighbourhoodKey =
    typeof selection === "string" ? selection : selection.neighbourhoodKey;
  const plotId = typeof selection === "object" ? selection.plotId : undefined;
  const layoutRevision =
    typeof selection === "object" ? selection.layoutRevision : undefined;

  if (!neighbourhoodKey || !eligibleKeys.includes(neighbourhoodKey))
    return { kind: "disabled" };
  const auth = getAuthClient();
  const token = await auth.getValidToken();
  if (!token) return { kind: "disabled" };
  const idemKey = homePurchaseIdempotencyKey(
    auth.operator?.userId ?? null,
    plotId ? `${neighbourhoodKey}:${plotId}:${layoutRevision ?? "v1"}` : neighbourhoodKey,
  );
  try {
    const bodyPayload: Record<string, unknown> = { neighbourhoodKey };
    if (plotId) bodyPayload.plotId = plotId;
    if (layoutRevision) bodyPayload.layoutRevision = layoutRevision;

    const resp = await fetch(HOME_PURCHASE_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify(bodyPayload),
    });
    const body: unknown = await resp.json().catch(() => null);
    return classifyPurchaseStatus(resp.status, body);
  } catch {
    return { kind: "error" };
  }
}

export async function postBuildHome(request: {
  plotId: string;
  layoutRevision: string;
  script: string;
}): Promise<BuildOutcome> {
  const auth = getAuthClient();
  const token = await auth.getValidToken();
  if (!token) return { kind: "disabled" };
  try {
    const resp = await fetch(HOME_BUILD_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });
    const body: unknown = await resp.json().catch(() => null);
    return classifyBuildStatus(resp.status, body);
  } catch {
    return { kind: "error" };
  }
}

export async function postConfirmArrival(request: {
  plotId: string;
  layoutRevision?: string;
}): Promise<PurchaseOutcome> {
  const auth = getAuthClient();
  const token = await auth.getValidToken();
  if (!token) return { kind: "disabled" };
  try {
    const resp = await fetch(HOME_ARRIVAL_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });
    const body: unknown = await resp.json().catch(() => null);
    return classifyPurchaseStatus(resp.status, body);
  } catch {
    return { kind: "error" };
  }
}

/**
 * Extract the 64-hex content hash from a revision identifier, handling both formatted CAS tokens
 * (`wl:v1:<number>:<contentHash>`) and bare 64-hex hashes.
 */
export function extractLayoutContentHash(rev: string | null | undefined): string | null {
  if (!rev || typeof rev !== "string") return null;
  const trimmed = rev.trim();
  const match = /^wl:v1:\d+:([0-9a-fA-F]{64})$/.exec(trimmed);
  if (match) return match[1];
  return trimmed;
}

/**
 * Compare two layout revision identifiers. Returns true if both are non-empty and either exactly
 * match or resolve to the same underlying content hash.
 */
export function layoutRevisionsMatch(
  revA: string | null | undefined,
  revB: string | null | undefined,
): boolean {
  if (!revA || !revB) return false;
  if (revA === revB) return true;
  const hashA = extractLayoutContentHash(revA);
  const hashB = extractLayoutContentHash(revB);
  return Boolean(hashA && hashB && hashA === hashB);
}

