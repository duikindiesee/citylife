// Spec 149 / Task e81ea9de — Canonical Transit Authority v1 Contract
//
// Standalone companion format conforming to 'citylife.transit/v1'.
// Expresses the authoritative transit loop, stops, and depot geometry
// bound cryptographically to a canonical WorldLayoutDocument revision contentHash.

export const CANONICAL_TRANSIT_SCHEMA_VERSION = "citylife.transit/v1" as const;

export interface CanonicalTransitPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanonicalTransitStop extends CanonicalTransitPoint {
  readonly name?: string;
}

export interface CanonicalTransitRouteAuthority {
  readonly loop: readonly CanonicalTransitPoint[];
  readonly stops: readonly CanonicalTransitStop[];
}

export interface CanonicalTransitDepotAuthority {
  readonly gate: CanonicalTransitPoint;
  readonly roadCell: CanonicalTransitPoint;
  readonly gateHeading?: number;
  readonly baysTotal?: number;
}

export interface CanonicalTransitAuthority {
  readonly schemaVersion: typeof CANONICAL_TRANSIT_SCHEMA_VERSION;
  readonly worldId: string;
  readonly layoutRevision: string;
  readonly route: CanonicalTransitRouteAuthority;
  readonly depot: CanonicalTransitDepotAuthority;
}

export interface TransitValidationResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly message?: string;
}

/**
 * Validates a CanonicalTransitAuthority against the server-sync 118cc contract.
 */
export function validateCanonicalTransitAuthority(
  auth: unknown,
  worldId?: string,
  layoutRevision?: string,
  minBays: number = 5,
): TransitValidationResult {
  if (!auth || typeof auth !== "object") {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Transit authority is missing or not an object for world '${worldId ?? "unknown"}'`,
    };
  }

  const record = auth as Record<string, unknown>;

  // 1. Explicit supported schema required
  if (record.schemaVersion !== CANONICAL_TRANSIT_SCHEMA_VERSION) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Transit authority schema '${record.schemaVersion ?? "missing"}' is unsupported or missing; expected '${CANONICAL_TRANSIT_SCHEMA_VERSION}'`,
    };
  }

  // 2. Nonempty matching worldId required against session truth
  if (typeof record.worldId !== "string" || !record.worldId.trim()) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNAVAILABLE",
      message: `Transit authority worldId is missing or empty; expected '${worldId ?? "unknown"}'`,
    };
  }
  if (
    worldId !== undefined &&
    (!record.worldId.trim() || record.worldId.trim() !== worldId.trim())
  ) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNAVAILABLE",
      message: `Transit authority worldId '${record.worldId}' does not match session worldId '${worldId}'`,
    };
  }

  // 3. Compatible nonempty layoutRevision required against session truth
  if (
    typeof record.layoutRevision !== "string" ||
    !record.layoutRevision.trim()
  ) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNAVAILABLE",
      message: `Transit authority layoutRevision is missing or empty for world '${worldId ?? "unknown"}'`,
    };
  }
  if (
    layoutRevision !== undefined &&
    record.layoutRevision.trim() !== layoutRevision.trim()
  ) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNAVAILABLE",
      message: `Transit authority layoutRevision '${record.layoutRevision}' does not match session revision '${layoutRevision}'`,
    };
  }

  // 4. Route loop validation: at least 4 finite numeric points
  const route = record.route as Record<string, unknown> | undefined;
  if (!route || !Array.isArray(route.loop) || route.loop.length < 4) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Transit authority route loop is missing or has fewer than 4 points for world '${worldId ?? "unknown"}'`,
    };
  }
  for (let i = 0; i < route.loop.length; i++) {
    const pt = route.loop[i];
    if (
      !pt ||
      typeof pt.x !== "number" ||
      typeof pt.y !== "number" ||
      !Number.isFinite(pt.x) ||
      !Number.isFinite(pt.y)
    ) {
      return {
        valid: false,
        error: "CANONICAL_TRANSIT_UNUSABLE",
        message: `Transit authority route loop point ${i} contains non-numeric or non-finite coordinates for world '${worldId ?? "unknown"}'`,
      };
    }
  }

  // 5. Route stops validation: at least 2 finite numeric points
  if (!Array.isArray(route.stops) || route.stops.length < 2) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Transit authority route stops are missing or have fewer than 2 stops for world '${worldId ?? "unknown"}'`,
    };
  }
  for (let i = 0; i < route.stops.length; i++) {
    const st = route.stops[i];
    if (
      !st ||
      typeof st.x !== "number" ||
      typeof st.y !== "number" ||
      !Number.isFinite(st.x) ||
      !Number.isFinite(st.y)
    ) {
      return {
        valid: false,
        error: "CANONICAL_TRANSIT_UNUSABLE",
        message: `Transit authority route stop ${i} contains non-numeric or non-finite coordinates for world '${worldId ?? "unknown"}'`,
      };
    }
  }

  // 6. Depot authority validation: gate and roadCell coordinates must be finite numbers
  const depot = record.depot as Record<string, unknown> | undefined;
  if (!depot || typeof depot !== "object") {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Missing or malformed depot authority in transit block for world '${worldId ?? "unknown"}'`,
    };
  }
  const { gate, roadCell, gateHeading, baysTotal } = depot as Record<
    string,
    any
  >;
  if (
    !gate ||
    typeof gate.x !== "number" ||
    typeof gate.y !== "number" ||
    !Number.isFinite(gate.x) ||
    !Number.isFinite(gate.y) ||
    !roadCell ||
    typeof roadCell.x !== "number" ||
    typeof roadCell.y !== "number" ||
    !Number.isFinite(roadCell.x) ||
    !Number.isFinite(roadCell.y)
  ) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Missing or non-finite depot gate/roadCell coordinates in transit authority for world '${worldId ?? "unknown"}'`,
    };
  }

  if (
    gateHeading !== undefined &&
    (typeof gateHeading !== "number" || !Number.isFinite(gateHeading))
  ) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Transit authority depot gateHeading must be a finite number for world '${worldId ?? "unknown"}'`,
    };
  }

  // 7. Depot baysTotal must be an integer >= minBays
  if (
    baysTotal !== undefined &&
    (!Number.isInteger(baysTotal) || baysTotal < minBays)
  ) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Transit authority depot baysTotal must be an integer >= ${minBays} for world '${worldId ?? "unknown"}'`,
    };
  }

  return { valid: true };
}

/**
 * Semantically compares two CanonicalTransitAuthority objects for exact numerical/geometric equivalence,
 * regardless of key ordering or optional stop names.
 */
export function canonicalTransitMatches(
  a: CanonicalTransitAuthority | null | undefined,
  b: CanonicalTransitAuthority | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.worldId !== b.worldId) return false;
  if (a.layoutRevision !== b.layoutRevision) return false;
  if (a.route.stops.length !== b.route.stops.length) return false;
  if (a.route.loop.length !== b.route.loop.length) return false;

  for (let i = 0; i < a.route.stops.length; i++) {
    const sA = a.route.stops[i];
    const sB = b.route.stops[i];
    if (sA.x !== sB.x || sA.y !== sB.y) return false;
  }

  for (let i = 0; i < a.route.loop.length; i++) {
    const pA = a.route.loop[i];
    const pB = b.route.loop[i];
    if (pA.x !== pB.x || pA.y !== pB.y) return false;
  }

  if (a.depot.gate.x !== b.depot.gate.x || a.depot.gate.y !== b.depot.gate.y) return false;
  if (a.depot.roadCell.x !== b.depot.roadCell.x || a.depot.roadCell.y !== b.depot.roadCell.y) return false;

  const headingA = a.depot.gateHeading;
  const headingB = b.depot.gateHeading;
  if (headingA !== headingB) {
    if (headingA !== undefined && headingB !== undefined) {
      if (Math.abs(headingA - headingB) > 1e-6) return false;
    } else {
      return false;
    }
  }

  const baysA = a.depot.baysTotal;
  const baysB = b.depot.baysTotal;
  if (baysA !== baysB) return false;

  return true;
}
