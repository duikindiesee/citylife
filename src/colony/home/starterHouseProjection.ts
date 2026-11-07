// PLAYER.HOME.1C — project the AUTHORITATIVE deed into exactly ONE deterministic, identity-bound
// starter house. This is a PURE function of the server home truth alone: given the same authoritative
// deed it always yields byte-identical output, so a refresh, a re-login and a second device all
// converge on the SAME house at the SAME place — because none of the inputs are client state, wall-clock
// or randomness.
//
// DETERMINISM is mandatory and total (same rule as houseBuilder/blueprintScript): the only inputs are
// the server-owned frameId / plotId / neighbourhoodKey, folded through a fixed integer hash into the
// seed the existing designHouse pipeline already consumes. There is NO Date.now, NO Math.random and NO
// reliance on ColonyState — identity binding comes solely from the server's deterministic
// `starter-home[-frame]:<userId>` reference, never a spoofable client id.
//
// The projection returns null unless the truth is unambiguously OWNED, so a NONE/PENDING/malformed truth
// never places a house and the guided journey stays on the legacy path.
import { designHouse, type HouseSpec } from "../house";
import { isHomeOwned, type HomeTruth } from "./starterProperty";

/** How many plot cells the starter-house placement grid spans on each axis. The identity hash lands the
 *  home deterministically inside this bounded grid; two different deeds land on (almost surely) distinct
 *  cells, and the same deed always lands on the same one. */
export const STARTER_PLACEMENT_GRID = 64;

/** A strong 32-bit finaliser (the same permutation family houseBuilder uses) so nearby inputs never
 *  collide, yet identical inputs always hash identically. Pure. */
function hash32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a over a string into a 32-bit value, then finalised through hash32. Pure and stable across
 *  runs/devices — the backbone of identity-bound determinism. */
export function hashIdentityString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash32(h >>> 0);
}

/** The single, canonical identity string for a starter home — the server-owned reference chain, in a
 *  fixed priority so the SAME deed always resolves to the SAME string (and therefore the same seed and
 *  placement). frameId is preferred (the server derives `starter-home-frame:<userId>`), then plotId,
 *  then the neighbourhoodKey as a last resort. Never includes any client-supplied value. Pure. */
export function homeIdentityString(truth: HomeTruth): string {
  return (
    truth.frameId ??
    truth.plotId ??
    (truth.neighbourhoodKey ? `nbh:${truth.neighbourhoodKey}` : "starter-home")
  );
}

/** The deterministic 32-bit house seed for a deed, folding all server-owned references so a home is
 *  bound to its frame AND plot AND neighbourhood — never a client id. Pure. */
export function deriveHomeSeed(truth: HomeTruth): number {
  const id = homeIdentityString(truth);
  const plot = truth.plotId ?? "";
  const nbh = truth.neighbourhoodKey ?? "";
  return hash32(
    (hashIdentityString(id) ^
      Math.imul(hashIdentityString(plot) + 1, 0x9e3779b1) ^
      Math.imul(hashIdentityString(nbh) + 131, 0x85ebca77)) >>>
      0,
  );
}

/** The deterministic map placement (a cell in the bounded grid) for a deed. Adopts published
 *  server-owned coordinates or plot geometry when present; otherwise derives from the deed
 *  identity chain so the same deed always lands on the same cell. Pure. */
export function deriveHomePlacement(truth: HomeTruth): {
  readonly x: number;
  readonly y: number;
} {
  if (
    typeof truth.x === "number" &&
    Number.isFinite(truth.x) &&
    typeof truth.y === "number" &&
    Number.isFinite(truth.y)
  ) {
    return { x: truth.x, y: truth.y };
  }
  if (truth.geometry) {
    if (
      truth.geometry.door &&
      Number.isFinite(truth.geometry.door.x) &&
      Number.isFinite(truth.geometry.door.y)
    ) {
      return { x: truth.geometry.door.x, y: truth.geometry.door.y };
    }
    if (
      truth.geometry.spawn &&
      Number.isFinite(truth.geometry.spawn.x) &&
      Number.isFinite(truth.geometry.spawn.y)
    ) {
      return { x: truth.geometry.spawn.x, y: truth.geometry.spawn.y };
    }
    if (
      truth.geometry.houseZone &&
      Number.isFinite(truth.geometry.houseZone.x) &&
      Number.isFinite(truth.geometry.houseZone.y)
    ) {
      const hz = truth.geometry.houseZone;
      const w = hz.width ?? (hz as any).w ?? 1;
      const d = hz.depth ?? (hz as any).d ?? 1;
      return {
        x: Math.round(hz.x + (w - 1) / 2),
        y: Math.round(hz.y + (d - 1) / 2),
      };
    }
  }

  const seed = deriveHomeSeed(truth);
  const hx = hash32((seed ^ 0x2545f491) >>> 0);
  const hy = hash32((seed ^ 0x9e3779b9) >>> 0);
  return {
    x: hx % STARTER_PLACEMENT_GRID,
    y: hy % STARTER_PLACEMENT_GRID,
  };
}

/** The one house the authoritative deed projects to. Everything here is server-owned truth or a pure
 *  derivation of it — the client contributes only the deterministic hashing. */
export interface ProjectedStarterHouse {
  /** The deterministic house seed the designHouse/houseBuilder pipeline consumes. */
  readonly seed: number;
  /** The generated house specification (character, roof, colours…), from the shared designHouse pipeline
   *  so the projected home looks identical everywhere it is ever drawn. */
  readonly spec: HouseSpec;
  /** The server-owned deed references this house is bound to, echoed for the UI/tests to assert on. */
  readonly frameId: string | null;
  readonly plotId: string | null;
  readonly neighbourhoodKey: string | null;
  /** The deterministic grid cell the home occupies. */
  readonly placement: { readonly x: number; readonly y: number };
}

/**
 * Project the authoritative home truth into EXACTLY ONE deterministic, identity-bound starter house, or
 * null when the truth is not unambiguously OWNED. Idempotent by construction: calling it twice with the
 * same truth (a double-tap that re-fetches, a replay, a second device) yields an identical projection —
 * there is never a second or a drifting house. Pure: no wall-clock, no randomness, no client state.
 */
export function projectStarterHome(
  truth: HomeTruth | null,
): ProjectedStarterHouse | null {
  if (!isHomeOwned(truth)) return null;
  const t = truth as HomeTruth;
  // A deed with no server reference at all cannot be bound to an identity — fail closed rather than
  // place a floating, non-deterministic house.
  if (!t.frameId && !t.plotId && !t.neighbourhoodKey) return null;
  const seed = deriveHomeSeed(t);
  return {
    seed,
    spec: designHouse(seed),
    frameId: t.frameId,
    plotId: t.plotId,
    neighbourhoodKey: t.neighbourhoodKey,
    placement: deriveHomePlacement(t),
  };
}
