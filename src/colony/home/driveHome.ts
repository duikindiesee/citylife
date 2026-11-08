// PLAYER.HOME.1D.S2 — the dark, server-truth client slice for the guided drive out of the dealership
// to the player's owned home, the bounded arrival-evidence submission, convergence on the server
// RESIDENT/HOME truth, and the home-garage portal. It mirrors the purity + fail-closed rules the rest of
// the new-player journey already follows (starterProperty / starterHouseProjection / carAcquisition):
//
//   • The DESTINATION is server-derived, never client-authored. The home the player drives to is the SAME
//     deterministic cell PLAYER.HOME.1C already projects the owned house onto (deriveHomePlacement) — a
//     pure function of the authoritative deed (frameId/plotId/neighbourhoodKey). Refresh, re-login and a
//     second device therefore all guide to the SAME place, and the client invents no location of its own.
//   • DRIVING GUIDANCE is a pure function of the CURRENT position and that server destination, so straying
//     off-route simply recomputes toward home — route recovery is inherent, never a stored waypoint that
//     could drift. No wall-clock, no randomness, no ColonyState.
//   • ARRIVAL is SERVER-authoritative. The client submits BOUNDED evidence (its clamped observed cell) only
//     once it locally believes it is inside the owned plot cells, and REFUSES locally otherwise — but the
//     service alone validates the evidence, records arrival and moves the player to RESIDENT. A 422 means
//     the authority rejected the evidence; the client never forces residency.
//   • RESIDENCY + the HOME-GARAGE UNLOCK render from the authoritative GET truth. The portal opens ONLY
//     after the server confirms the unlock (RESIDENT + garageUnlocked); everything fails closed on a
//     stale/missing/malformed read, so a non-allowlisted or not-yet-arrived player can never open it.
//
// The whole step stays DARK by the SERVER's own gate: the fail-closed `new-player-journey-v1` entitlement
// (evaluated in ColonyApp) hides the entry unless the backend unambiguously allowlists the player, and the
// deployed drive-home/arrival route itself answers 403/503 while its flag / kill switch are OFF. The client
// keeps NO independent on/off switch. The pure model ops (geometry, guidance, classifiers, button views)
// take no DOM and are node-testable; the backend layer is best-effort and fail-soft like carAcquisition /
// starterProperty: it never throws, never blocks the game, and tolerates a 404 while the endpoint ships.
import { getAuthClient } from "../authClient";
import {
  HOME_TRUTH_PATH,
  isHomeOwned,
  layoutRevisionsMatch,
  parseHomeTruth,
  type HomeTruth,
} from "./starterProperty";
import {
  deriveHomePlacement,
  STARTER_PLACEMENT_GRID,
} from "./starterHouseProjection";

/** POST bounded arrival evidence; the service validates the player is inside their owned plot cells,
 *  records arrival and moves them to RESIDENT. It never trusts the client's claim — the evidence is
 *  advisory and re-checked server-side. */
export const HOME_ARRIVAL_PATH =
  "/kooker/api/v1/citylife/players/me/home/arrival";
export const HOME_DEED_DRIVE_HOME_ARRIVAL_PATH =
  "/kooker/api/v1/citylife/players/me/home-deed/drive-home-arrival";

/** The authoritative home-truth GET (shared with PLAYER.HOME.1C) — residency + garage unlock are read
 *  from the SAME endpoint so there is a single source of home truth. */
export { HOME_TRUTH_PATH };

// ── Cell geometry (pure) ──────────────────────────────────────────────────────────

/** A cell in the same bounded placement grid PLAYER.HOME.1C projects the house onto. */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Clamp a raw coordinate into the valid grid so a wild/off-map input can never be submitted or drawn. */
export function clampToGrid(v: number, grid = STARTER_PLACEMENT_GRID): number {
  if (!Number.isFinite(v)) return 0;
  const i = Math.round(v);
  if (i < 0) return 0;
  if (i > grid - 1) return grid - 1;
  return i;
}

/** Clamp a raw cell into the grid. Pure — the single boundary every observed position passes through. */
export function clampCell(cell: Cell, grid = STARTER_PLACEMENT_GRID): Cell {
  return { x: clampToGrid(cell.x, grid), y: clampToGrid(cell.y, grid) };
}

/** The owned-home target cell — the SAME deterministic placement the house projects to, so the drive
 *  destination is server-derived truth (a pure function of the deed), never a client-authored point.
 *  Null unless the truth is unambiguously OWNED, so no destination exists until the server grants one. */
/**
 * Helper to determine canonical grid size from authority or fallback.
 * Derives from authority.getWorldGridSize() or authority.sim.state.terrain.size when present.
 * Defaults to 608 for canonical wide coordinates, or STARTER_PLACEMENT_GRID (64) for legacy plots.
 */
function resolveGridSize(authorityOrGrid?: any, home?: Cell | null): number {
  if (typeof authorityOrGrid === "number" && authorityOrGrid > 0) {
    return authorityOrGrid;
  }
  if (authorityOrGrid && typeof authorityOrGrid === "object") {
    if (typeof authorityOrGrid.getWorldGridSize === "function") {
      const s = authorityOrGrid.getWorldGridSize();
      if (typeof s === "number" && s > 0) return s;
    }
    if (
      typeof authorityOrGrid.sim?.state?.terrain?.size === "number" &&
      authorityOrGrid.sim.state.terrain.size > 0
    ) {
      return authorityOrGrid.sim.state.terrain.size;
    }
  }
  if (home && (home.x >= STARTER_PLACEMENT_GRID || home.y >= STARTER_PLACEMENT_GRID)) {
    return 608;
  }
  return STARTER_PLACEMENT_GRID;
}

/** The server-authoritative grid cell the player's home occupies. Pure and deterministic — the
 *  destination is server-derived truth (a pure function of the deed), never a client-authored point.
 *  Null unless the truth is unambiguously OWNED, so no destination exists until the server grants one. */
export function homeTargetCell(
  truth: HomeTruth | null,
  authority?: any,
): Cell | null {
  if (!isHomeOwned(truth)) return null;
  const t = truth as HomeTruth;
  if (
    !t.frameId &&
    !t.plotId &&
    !t.neighbourhoodKey &&
    !t.geometry &&
    t.x === undefined &&
    t.y === undefined
  ) {
    return null;
  }
  // Direct published coordinates or geometry on truth take precedence when present
  if (
    typeof t.x === "number" &&
    typeof t.y === "number" &&
    Number.isFinite(t.x) &&
    Number.isFinite(t.y)
  ) {
    return { x: Math.round(t.x), y: Math.round(t.y) };
  }
  if (
    t.geometry?.door &&
    Number.isFinite(t.geometry.door.x) &&
    Number.isFinite(t.geometry.door.y)
  ) {
    return { x: Math.round(t.geometry.door.x), y: Math.round(t.geometry.door.y) };
  }
  if (
    t.geometry?.spawn &&
    Number.isFinite(t.geometry.spawn.x) &&
    Number.isFinite(t.geometry.spawn.y)
  ) {
    return { x: Math.round(t.geometry.spawn.x), y: Math.round(t.geometry.spawn.y) };
  }
  if (
    t.geometry?.houseZone &&
    Number.isFinite(t.geometry.houseZone.x) &&
    Number.isFinite(t.geometry.houseZone.y)
  ) {
    const hz = t.geometry.houseZone;
    const w = (hz as any).width ?? (hz as any).w ?? 1;
    const d = (hz as any).depth ?? (hz as any).d ?? 1;
    return {
      x: Math.round(hz.x + (w - 1) / 2),
      y: Math.round(hz.y + (d - 1) / 2),
    };
  }

  // If authority is provided and truth lacks coordinates/geometry (10-field wire DTO), resolve via authority
  if (authority) {
    if (t.layoutRevision && typeof authority.getActiveLayoutRevisionId === "function") {
      const authRev = authority.getActiveLayoutRevisionId();
      if (authRev && !layoutRevisionsMatch(t.layoutRevision, authRev)) {
        return null;
      }
    }
    if (t.plotId) {
      if (typeof authority.getStarterCatalogueManifest === "function") {
        const manifest = authority.getStarterCatalogueManifest();
        const plot = manifest?.plots?.find?.(
          (p: any) => p && (p.plotId === t.plotId || p.id === t.plotId),
        );
        if (plot) {
          if (t.frameId && plot.frameId && plot.frameId !== t.frameId) {
            return null;
          }
          if (plot?.geometry?.spawn) {
            return {
              x: Math.round(plot.geometry.spawn.x),
              y: Math.round(plot.geometry.spawn.y),
            };
          }
          if (plot?.geometry?.houseZone) {
            const hz = plot.geometry.houseZone;
            const w = hz.width ?? 1;
            const d = hz.depth ?? 1;
            return {
              x: Math.round(hz.x + (w - 1) / 2),
              y: Math.round(hz.y + (d - 1) / 2),
            };
          }
        }
      }
      if (typeof authority.lots === "function") {
        const allLots = authority.lots();
        if (Array.isArray(allLots)) {
          const lot = allLots.find(
            (l: any) =>
              l &&
              (l.id === t.plotId ||
                l.id === `lot-${t.plotId}` ||
                l.id === `lot_${t.plotId}`),
          );
          if (lot) {
            if (t.frameId && lot.frameId && lot.frameId !== t.frameId) {
              return null;
            }
            if (lot.spawn && Number.isFinite(lot.spawn.x) && Number.isFinite(lot.spawn.y)) {
              return { x: Math.round(lot.spawn.x), y: Math.round(lot.spawn.y) };
            }
            if (
              lot.doorX !== undefined &&
              lot.doorY !== undefined &&
              Number.isFinite(lot.doorX) &&
              Number.isFinite(lot.doorY)
            ) {
              return { x: Math.round(lot.doorX), y: Math.round(lot.doorY) };
            }
            if (
              lot.houseZone &&
              Number.isFinite(lot.houseZone.x) &&
              Number.isFinite(lot.houseZone.y)
            ) {
              const w = lot.houseZone.width ?? lot.houseZone.w ?? 1;
              const d = lot.houseZone.depth ?? lot.houseZone.d ?? 1;
              return {
                x: Math.round(lot.houseZone.x + (w - 1) / 2),
                y: Math.round(lot.houseZone.y + (d - 1) / 2),
              };
            }
          }
        }
      }
      if (authority.plotGeometry && typeof authority.plotGeometry.get === "function") {
        const geom = authority.plotGeometry.get(t.plotId);
        if (geom) {
          if (t.frameId && geom.frameId && geom.frameId !== t.frameId) {
            return null;
          }
          if (geom?.spawn) {
            return {
              x: Math.round(geom.spawn.x),
              y: Math.round(geom.spawn.y),
            };
          }
          if (geom?.houseZone) {
            const hz = geom.houseZone;
            const w = hz.width ?? 1;
            const d = hz.depth ?? 1;
            return {
              x: Math.round(hz.x + (w - 1) / 2),
              y: Math.round(hz.y + (d - 1) / 2),
            };
          }
        }
      }
    }
    // Fail closed if authority is present but plot is not found in authority
    return null;
  }
  return deriveHomePlacement(t);
}

/** The bounded distance (cells) the dealership sits from the home — a short, followable drive that is
 *  always well outside the arrival radius so it never auto-arrives, and small enough that the guided route
 *  is a handful of moves on a phone rather than a marathon across the grid. */
export const DEALERSHIP_OFFSET_CELLS = 6; // ARRIVAL_RADIUS_CELLS (2) + 4 — comfortably outside the plot

/** The deterministic dealership-exit start cell for a deed — a fixed, bounded offset from the owned home,
 *  toward whichever side of the grid has room, so the journey begins a short, followable drive away yet is
 *  identical on every device. Only used to seed the guidance HUD's initial cursor; it carries no authority
 *  and is never submitted. Null when there is no owned home. Pure. */
export function dealershipStartCell(
  truth: HomeTruth | null,
  authorityOrGrid?: any,
): Cell | null {
  const authority =
    authorityOrGrid && typeof authorityOrGrid === "object"
      ? authorityOrGrid
      : undefined;
  const home = homeTargetCell(truth, authority);
  if (!home) return null;
  const off = DEALERSHIP_OFFSET_CELLS;
  const effectiveGrid = resolveGridSize(authorityOrGrid, home);
  // Offset toward whichever side has room to stay in-grid; the fixed magnitude keeps it outside the
  // arrival radius (a real drive) without ever leaving the bounded grid.
  const dx = home.x >= off ? -off : off;
  const dy = home.y >= off ? -off : off;
  return {
    x: clampToGrid(home.x + dx, effectiveGrid),
    y: clampToGrid(home.y + dy, effectiveGrid),
  };
}

// ── Driving guidance (pure) ─────────────────────────────────────────────────────────

/** How close (in cells, Chebyshev distance) the player must be to count as inside the owned plot cells. */
export const ARRIVAL_RADIUS_CELLS = 2;

/** The 8-way compass heading the mobile HUD points the driver along. Null once arrived. */
export type RouteHeading = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** True when the current cell is inside the owned plot cells (within the arrival radius of the home cell,
 *  Chebyshev so the plot is a small square). Pure — the single local arrival gate; the server re-checks. */
export function isWithinArrivalBounds(
  current: Cell,
  home: Cell,
  radius = ARRIVAL_RADIUS_CELLS,
): boolean {
  return (
    Math.abs(current.x - home.x) <= radius &&
    Math.abs(current.y - home.y) <= radius
  );
}

/** The compass heading from `current` toward `home` on the screen grid (y increases downward → south),
 *  or null when already inside the arrival bounds. Pure and deterministic. */
export function headingToHome(
  current: Cell,
  home: Cell,
  radius = ARRIVAL_RADIUS_CELLS,
): RouteHeading | null {
  if (isWithinArrivalBounds(current, home, radius)) return null;
  const dx = home.x - current.x; // +east
  const dy = home.y - current.y; // +south (screen y grows downward)
  const ns = dy < 0 ? "N" : dy > 0 ? "S" : "";
  const ew = dx > 0 ? "E" : dx < 0 ? "W" : "";
  // Only split into a diagonal when both axes are meaningfully off; otherwise snap to the dominant axis
  // so the instruction stays a single, followable direction on a small phone screen.
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ns && ew) {
    const dominantOnly = ax > ay * 3 ? ew : ay > ax * 3 ? ns : `${ns}${ew}`;
    return dominantOnly as RouteHeading;
  }
  return (ns || ew) as RouteHeading;
}

/** The rendered guidance the mobile HUD shows — a heading, the remaining cell distance and a single,
 *  followable instruction. `arrived` is the local (client-side) in-bounds signal only; server truth still
 *  owns residency. Pure: derived solely from the current position and the server destination. */
export interface RouteGuidance {
  readonly heading: RouteHeading | null;
  /** Chebyshev cells remaining to the plot edge (0 once inside). */
  readonly distance: number;
  readonly arrived: boolean;
  readonly instruction: string;
}

const HEADING_WORD: Record<RouteHeading, string> = {
  N: "north",
  NE: "north-east",
  E: "east",
  SE: "south-east",
  S: "south",
  SW: "south-west",
  W: "west",
  NW: "north-west",
};

/** Compute the mobile driving guidance from the current position to the server-owned home. Fails closed
 *  to a neutral "no destination" guidance when either the position or the destination is missing (no owned
 *  home yet, stale truth), so the HUD never points at a client-invented place. Pure. */
export function computeRouteGuidance(
  current: Cell | null,
  home: Cell | null,
  radius = ARRIVAL_RADIUS_CELLS,
): RouteGuidance {
  if (!current || !home) {
    return {
      heading: null,
      distance: Number.POSITIVE_INFINITY,
      arrived: false,
      instruction: "Waiting for your home…",
    };
  }
  const arrived = isWithinArrivalBounds(current, home, radius);
  const cheb = Math.max(
    Math.abs(current.x - home.x),
    Math.abs(current.y - home.y),
  );
  const distance = Math.max(0, cheb - radius);
  if (arrived) {
    return {
      heading: null,
      distance: 0,
      arrived: true,
      instruction: "You're at your home plot — pull in",
    };
  }
  const heading = headingToHome(current, home, radius);
  const word = heading ? HEADING_WORD[heading] : "on";
  return {
    heading,
    distance,
    arrived: false,
    instruction: `Head ${word} · ${distance} cell${distance === 1 ? "" : "s"} to go`,
  };
}

/** Step the driving cursor one cell in a compass direction, clamped to the grid. This is the pure core the
 *  mobile D-pad / vehicle controls drive; the runtime may instead feed a real mapped world cell. Straying
 *  never breaks the route because {@link computeRouteGuidance} re-derives from wherever the cursor lands. */
export function stepCell(
  cell: Cell,
  dir: "up" | "down" | "left" | "right",
  grid = STARTER_PLACEMENT_GRID,
): Cell {
  const d = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[dir];
  return clampCell({ x: cell.x + d.x, y: cell.y + d.y }, grid);
}

// ── Bounded arrival evidence (server-authoritative) ─────────────────────────────────

/** The bounded evidence the client is willing to submit: its clamped observed cell plus whether it locally
 *  believes it is in bounds. The server re-validates against the owned plot — this is advisory only, and
 *  carries NO owner/deed/price claim. Pure. */
export interface ArrivalEvidence {
  readonly cell: Cell;
  readonly withinBounds: boolean;
}

/** Build the bounded arrival evidence for an observed position against the server destination. The cell is
 *  clamped into the grid so an out-of-range value can never be posted. Pure. */
export function boundedArrivalEvidence(
  current: Cell,
  home: Cell,
  radius = ARRIVAL_RADIUS_CELLS,
  gridOrAuthority?: number | any,
): ArrivalEvidence {
  const effectiveGrid = resolveGridSize(gridOrAuthority, home);
  const cell = clampCell(current, effectiveGrid);
  return { cell, withinBounds: isWithinArrivalBounds(cell, home, radius) };
}

/** Authoritative arrival receipt returned by DriveHomeArrivalController / User service. */
export interface DriveHomeArrivalReceipt {
  readonly plotId: string;
  readonly frameId: string;
  readonly homeGarageUnlocked: boolean;
  readonly homeGarageUnlockedAt?: string | null;
  readonly vehicleStorageLocation: string;
  readonly onboardingState?: string | null;
  readonly alreadyArrived?: boolean;
}

export function parseDriveHomeArrivalReceipt(raw: unknown): DriveHomeArrivalReceipt | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const plotId = typeof o.plotId === "string" && o.plotId.trim() ? o.plotId.trim() : null;
  const frameId = typeof o.frameId === "string" && o.frameId.trim() ? o.frameId.trim() : null;
  if (!plotId || !frameId) return null;
  if (o.homeGarageUnlocked !== true) return null;
  const storage =
    typeof o.vehicleStorageLocation === "string" ? o.vehicleStorageLocation.trim() : null;
  if (storage !== "HOME") return null;
  return {
    plotId,
    frameId,
    homeGarageUnlocked: true,
    homeGarageUnlockedAt:
      typeof o.homeGarageUnlockedAt === "string" ? o.homeGarageUnlockedAt : null,
    vehicleStorageLocation: "HOME",
    onboardingState:
      typeof o.onboardingState === "string" && o.onboardingState.trim()
        ? o.onboardingState.trim()
        : null,
    alreadyArrived: typeof o.alreadyArrived === "boolean" ? o.alreadyArrived : undefined,
  };
}

/** The closed set of outcomes one arrival submission settles into — the overlay renders exactly one. */
export type ArrivalOutcome =
  | { kind: "confirmed"; receipt?: DriveHomeArrivalReceipt } // 200/201 — the server accepted the arrival and moved the player to RESIDENT
  | { kind: "pending"; receipt?: DriveHomeArrivalReceipt } // 202/409 — accepted / an idempotent replay of an in-flight-or-settled arrival
  | { kind: "rejected" } // 422 — the authority rejected the evidence (not actually in the owned plot)
  | { kind: "disabled" } // 401/403/503 — signed out, feature off, or kill switch; never blind-retry
  | { kind: "error"; status?: number }; // anything else — a transient/unknown failure

/** Map an arrival HTTP status to a closed outcome. 202/409 are an idempotent replay (a duplicate arrival
 *  must never create a second RESIDENT transition), 422 is the deployed evidence-rejected status, and
 *  401/403/503 all fail closed to disabled so the journey holds on the legacy path. Pure. */
export function classifyArrivalStatus(status: number): ArrivalOutcome {
  if (status === 200 || status === 201) return { kind: "confirmed" };
  if (status === 202 || status === 409) return { kind: "pending" };
  if (status === 422) return { kind: "rejected" };
  if (status === 401 || status === 403 || status === 503)
    return { kind: "disabled" };
  return { kind: "error", status };
}

/** A stable idempotency key for one (player, plot) arrival, so a double-tap or a reload-retry is the SAME
 *  request and can never record a second arrival. Pure. plotRef is the server-owned plot/frame reference;
 *  userId is best-effort (a signed-in player always has one). */
export function arrivalIdempotencyKey(
  userId: string | null,
  plotRef: string,
): string {
  return `citylife:home-arrival:${userId ?? "anon"}:${plotRef}`;
}

/** The single server-owned plot reference an arrival is keyed to — the deed's plot, then frame, then
 *  neighbourhood, never a client value. Null when there is no owned home to arrive at. Pure. */
export function homePlotRef(truth: HomeTruth | null): string | null {
  if (!isHomeOwned(truth)) return null;
  const t = truth as HomeTruth;
  return t.plotId ?? t.frameId ?? t.neighbourhoodKey ?? null;
}

// ── Residency + home-garage unlock (authoritative GET truth) ────────────────────────

/** The residency view derived from the authoritative home truth. `resident` and `garageUnlocked` are
 *  server-owned; the client only reads them and fails closed on anything ambiguous. */
export interface HomeResidency {
  readonly truth: HomeTruth | null;
  /** The server moved the player to RESIDENT (arrival recorded). */
  readonly resident: boolean;
  /** The server confirms the home-garage portal may open. */
  readonly garageUnlocked: boolean;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

/** Does the authoritative truth say the player is a RESIDENT of their owned home? Owned must be true AND
 *  the onboarding state must read RESIDENT — anything else fails closed so the garage stays locked. Pure. */
export function isResident(truth: HomeTruth | null): boolean {
  if (!isHomeOwned(truth)) return false;
  const state = (truth as HomeTruth).onboardingState;
  return typeof state === "string" && state.toUpperCase() === "RESIDENT";
}

/** Parse a raw home-truth body into the residency view. The garage unlock is granted ONLY when the server
 *  says the player is RESIDENT and (if it sent the flag) `homeGarageUnlocked` is not explicitly false — so
 *  a missing flag defaults to the RESIDENT signal, but an explicit false from the authority always wins.
 *  Fails closed on a malformed/absent body. Pure. */
export function parseHomeResidency(raw: unknown): HomeResidency {
  const truth = parseHomeTruth(raw);
  const resident = isResident(truth);
  const o = asRecord(raw);
  const flag = o
    ? ((o.homeGarageUnlocked ?? o.garageUnlocked ?? o.homeGarage) as unknown)
    : undefined;
  // Explicit false from the authority always locks it; otherwise the RESIDENT truth is the gate.
  const garageUnlocked = flag === false ? false : resident;
  return { truth, resident, garageUnlocked };
}

/** The single guard the home-garage portal opens on: the server confirms the unlock. Fails closed on a
 *  null/absent residency (still loading, stale, or a read failure), so the portal is never merely cosmetic
 *  — a direct/programmatic open is rejected by the same check. Pure. */
export function isHomeGarageUnlocked(res: HomeResidency | null): boolean {
  return res?.garageUnlocked === true && res?.resident === true;
}

// ── Arrival button view (pure) ──────────────────────────────────────────────────────

export interface ArrivalButtonView {
  readonly state:
    | "far" // not yet inside the owned plot cells — cannot submit
    | "ready" // inside the bounds — may submit the bounded evidence
    | "pending" // in flight / idempotent replay being processed
    | "confirmed" // server recorded the arrival (RESIDENT)
    | "rejected" // server rejected the evidence
    | "disabled" // signed out / feature off / kill switch
    | "error";
  readonly label: string;
  readonly disabled: boolean;
}

/** The rendered shape of the arrival control, derived purely from residency + in-bounds + in-flight + last
 *  outcome so the overlay stays a thin view and every state is node-testable. `disabled` is true whenever a
 *  tap must NOT fire another POST (already resident, not in bounds, in flight, being processed, refused). */
export function arrivalButtonView(
  isResidentTruth: boolean,
  withinBounds: boolean,
  isPending: boolean,
  outcome: ArrivalOutcome | undefined,
): ArrivalButtonView {
  if (isResidentTruth)
    return { state: "confirmed", label: "✓ You're home", disabled: true };
  if (isPending)
    return { state: "pending", label: "⏳ Checking you in…", disabled: true };
  switch (outcome?.kind) {
    case "pending":
      return { state: "pending", label: "⏳ Processing…", disabled: true };
    case "rejected":
      return {
        state: "rejected",
        label: "Not inside your plot yet",
        disabled: true,
      };
    case "disabled":
      return {
        state: "disabled",
        label: "🔒 Sign in to arrive",
        disabled: true,
      };
    case "error":
      return {
        state: "error",
        label: "Couldn't check in — retry",
        disabled: false,
      };
    default:
      if (!withinBounds)
        return {
          state: "far",
          label: "Drive to your home plot",
          disabled: true,
        };
      return { state: "ready", label: "Pull into your home", disabled: false };
  }
}

/** The accent colour for an arrival state — kept next to the pure view so the overlay carries no policy. */
export function arrivalStateColor(state: ArrivalButtonView["state"]): string {
  switch (state) {
    case "confirmed":
      return "#9fd4a6";
    case "pending":
      return "#ffd25a";
    case "rejected":
      return "#f2a35a";
    case "error":
      return "#e07a7a";
    case "disabled":
    case "far":
      return "#7a90a0";
    default:
      return "#a0d4f0";
  }
}

// ── Backend layer (best-effort, as the logged-in player) ────────────────────────────

async function bearer(): Promise<string | null> {
  return getAuthClient().getValidToken();
}

/** Fetch the authoritative residency truth. Null when signed out, the endpoint is absent (404 while it
 *  ships separately), or the body is malformed — callers then keep the legacy path and never unlock the
 *  garage on a guess. Never throws. */
export async function fetchHomeResidency(): Promise<HomeResidency | null> {
  const token = await bearer();
  if (!token) return null;
  try {
    const resp = await fetch(HOME_TRUTH_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    return parseHomeResidency(data);
  } catch {
    return null;
  }
}

/** Submit bounded arrival evidence. REFUSES locally — without touching the network — when there is no owned
 *  home, the player is signed out, or the client is not inside the owned plot cells, so a not-yet-arrived
 *  or tampered position never reaches the authority. Sends the clamped observed cell + the server-owned
 *  plotRef echo ONLY (no owner/deed/residency claim) plus a stable Idempotency-Key, so a double-tap is the
 *  SAME request and can never record a second arrival. The service alone validates the evidence and moves
 *  the player to RESIDENT; while the flag / kill switch are OFF it answers 403/503 (→ disabled). Returns a
 *  classified {@link ArrivalOutcome}. */
export interface PostHomeArrivalOptions {
  plotId?: string | null;
  frameId?: string | null;
  vehicleKey?: string | null;
  grid?: number | null;
  authority?: any;
}

export async function postHomeArrival(
  current: Cell,
  truth: HomeTruth | null,
  options?: PostHomeArrivalOptions,
): Promise<ArrivalOutcome> {
  const home = homeTargetCell(truth, options?.authority);
  const plotRef = homePlotRef(truth);
  if (!home || !plotRef) return { kind: "disabled" };
  const effectiveGrid = resolveGridSize(
    options?.grid ?? options?.authority,
    home,
  );
  const evidence = boundedArrivalEvidence(
    current,
    home,
    ARRIVAL_RADIUS_CELLS,
    effectiveGrid,
  );
  if (!evidence.withinBounds) return { kind: "disabled" };
  const auth = getAuthClient();
  const token = await auth.getValidToken();
  if (!token) return { kind: "disabled" };
  const idemKey = arrivalIdempotencyKey(auth.operator?.userId ?? null, plotRef);

  const plotId = options?.plotId ?? truth?.plotId ?? null;
  const frameId = options?.frameId ?? truth?.frameId ?? null;
  const vehicleKey =
    options?.vehicleKey ?? ((truth as any)?.vehicleId ? String((truth as any).vehicleId).trim() : null);

  if (!plotId || !frameId || !vehicleKey) {
    // Fail closed for incomplete identity/context without automatic fallback
    return { kind: "rejected" };
  }

  try {
    const resp = await fetch(HOME_DEED_DRIVE_HOME_ARRIVAL_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify({
        plotId,
        frameId,
        vehicleKey,
        cell: evidence.cell,
        plotRef,
      }),
    });
    if (resp.status === 200 || resp.status === 201) {
      const data = await resp.json().catch(() => null);
      const receipt = parseDriveHomeArrivalReceipt(data);
      if (!receipt || receipt.plotId !== plotId || receipt.frameId !== frameId) {
        return { kind: "rejected" };
      }
      return { kind: "confirmed", receipt };
    }
    if (resp.status === 202 || resp.status === 409) {
      const data = await resp.json().catch(() => null);
      const receipt = parseDriveHomeArrivalReceipt(data);
      return { kind: "pending", receipt: receipt ?? undefined };
    }
    if (resp.status === 422) return { kind: "rejected" };
    if (resp.status === 401 || resp.status === 403 || resp.status === 503) {
      return { kind: "disabled" };
    }
    return { kind: "error", status: resp.status };
  } catch {
    return { kind: "error" };
  }
}

