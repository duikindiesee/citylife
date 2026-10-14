// Spec 149 / Task e81ea9de / BUS.SYNC.SERVER.1 (cb551d21) — Canonical Transit Authority v1 Contract
//
// Standalone companion format conforming to 'citylife.transit/v1' with explicit geometry capability
// 'explicit-paths-v1'. Expresses authoritative transit loop, pre-computed curved bay paths, spur path,
// pad site, and junction-adjusted stop anchors bound cryptographically to a canonical WorldLayoutDocument revision contentHash.

export const CANONICAL_TRANSIT_SCHEMA_VERSION = "citylife.transit/v1" as const;
export const CANONICAL_TRANSIT_GEOMETRY_CAPABILITY = "explicit-paths-v1" as const;

export interface CanonicalTransitPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanonicalTransitStop extends CanonicalTransitPoint {
  readonly name?: string;
}

export interface CanonicalTransitStopAnchor {
  readonly cell: CanonicalTransitPoint;
  readonly arc: number;
  readonly at: CanonicalTransitPoint;
  readonly heading: number;
  readonly verge: CanonicalTransitPoint;
  readonly furniture: CanonicalTransitPoint;
}

export interface CanonicalTransitRouteAuthority {
  readonly loop: readonly CanonicalTransitPoint[];
  readonly stops: readonly CanonicalTransitStop[];
  readonly stopAnchors?: readonly CanonicalTransitStopAnchor[];
}

export interface CanonicalTransitDepotSite {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly inward: CanonicalTransitPoint;
}

export interface CanonicalTransitBayPath {
  readonly bayIndex: number;
  readonly park: CanonicalTransitPoint;
  readonly heading: number;
  readonly path: readonly CanonicalTransitPoint[];
}

export interface CanonicalTransitDepotAuthority {
  readonly gate: CanonicalTransitPoint;
  readonly roadCell: CanonicalTransitPoint;
  readonly gateHeading?: number;
  readonly baysTotal?: number;
  readonly site?: CanonicalTransitDepotSite;
  readonly spur?: readonly CanonicalTransitPoint[];
  readonly bays?: readonly CanonicalTransitBayPath[];
}

export interface CanonicalTransitAuthority {
  readonly schemaVersion: typeof CANONICAL_TRANSIT_SCHEMA_VERSION;
  readonly geometryCapability?: typeof CANONICAL_TRANSIT_GEOMETRY_CAPABILITY | string;
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
 * Validates a CanonicalTransitAuthority against the server-sync 118cc contract and revision 2 explicit geometry.
 */
export function validateCanonicalTransitAuthority(
  auth: unknown,
  worldId?: string,
  layoutRevision?: string,
  minBays: number = 5,
  requireExplicitGeometry: boolean = false,
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
  const { gate, roadCell, gateHeading, baysTotal, site, spur, bays } = depot as Record<
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

  // 8. Explicit Geometry Capability validation ('explicit-paths-v1')
  const isExplicit =
    record.geometryCapability === CANONICAL_TRANSIT_GEOMETRY_CAPABILITY ||
    requireExplicitGeometry;

  if (requireExplicitGeometry && record.geometryCapability !== CANONICAL_TRANSIT_GEOMETRY_CAPABILITY) {
    return {
      valid: false,
      error: "CANONICAL_TRANSIT_UNUSABLE",
      message: `Transit authority missing required geometryCapability '${CANONICAL_TRANSIT_GEOMETRY_CAPABILITY}'`,
    };
  }

  if (isExplicit) {
    // 8a. stopAnchors array matching route.stops
    if (!Array.isArray(route.stopAnchors) || route.stopAnchors.length !== route.stops.length) {
      return {
        valid: false,
        error: "CANONICAL_TRANSIT_UNUSABLE",
        message: `Transit authority route stopAnchors must have length matching stops (${route.stops.length})`,
      };
    }

    for (let i = 0; i < route.stopAnchors.length; i++) {
      const a = route.stopAnchors[i];
      if (
        !a ||
        typeof a !== "object" ||
        typeof a.arc !== "number" ||
        !Number.isFinite(a.arc) ||
        a.arc < 0 ||
        typeof a.heading !== "number" ||
        !Number.isFinite(a.heading) ||
        !a.cell ||
        typeof a.cell.x !== "number" ||
        typeof a.cell.y !== "number" ||
        !Number.isFinite(a.cell.x) ||
        !Number.isFinite(a.cell.y) ||
        !a.at ||
        typeof a.at.x !== "number" ||
        typeof a.at.y !== "number" ||
        !Number.isFinite(a.at.x) ||
        !Number.isFinite(a.at.y) ||
        !a.verge ||
        typeof a.verge.x !== "number" ||
        typeof a.verge.y !== "number" ||
        !Number.isFinite(a.verge.x) ||
        !Number.isFinite(a.verge.y) ||
        !a.furniture ||
        typeof a.furniture.x !== "number" ||
        typeof a.furniture.y !== "number" ||
        !Number.isFinite(a.furniture.x) ||
        !Number.isFinite(a.furniture.y)
      ) {
        return {
          valid: false,
          error: "CANONICAL_TRANSIT_UNUSABLE",
          message: `Transit authority stop anchor ${i} contains non-numeric or non-finite fields`,
        };
      }
      if (a.cell.x !== route.stops[i].x || a.cell.y !== route.stops[i].y) {
        return {
          valid: false,
          error: "CANONICAL_TRANSIT_UNUSABLE",
          message: `Transit authority stop anchor ${i} cell does not match route stop ${i} authored coordinates`,
        };
      }
    }

    // 8b. depot site
    if (
      !site ||
      typeof site !== "object" ||
      typeof site.x !== "number" ||
      typeof site.y !== "number" ||
      typeof site.w !== "number" ||
      typeof site.h !== "number" ||
      !Number.isFinite(site.x) ||
      !Number.isFinite(site.y) ||
      !Number.isFinite(site.w) ||
      !Number.isFinite(site.h) ||
      site.w <= 0 ||
      site.h <= 0 ||
      !site.inward ||
      typeof site.inward.x !== "number" ||
      typeof site.inward.y !== "number" ||
      !Number.isFinite(site.inward.x) ||
      !Number.isFinite(site.inward.y) ||
      Math.abs(Math.abs(site.inward.x) + Math.abs(site.inward.y) - 1) > 1e-4
    ) {
      return {
        valid: false,
        error: "CANONICAL_TRANSIT_UNUSABLE",
        message: `Transit authority depot site is missing or non-finite`,
      };
    }

    // 8c. depot spur
    if (!Array.isArray(spur) || spur.length < 2) {
      return {
        valid: false,
        error: "CANONICAL_TRANSIT_UNUSABLE",
        message: `Transit authority depot spur must be an array of at least 2 points`,
      };
    }
    for (let i = 0; i < spur.length; i++) {
      const p = spur[i];
      if (!p || typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        return {
          valid: false,
          error: "CANONICAL_TRANSIT_UNUSABLE",
          message: `Transit authority depot spur point ${i} is non-finite`,
        };
      }
    }

    // 8d. depot bays
    const expectedBays = baysTotal ?? minBays;
    if (!Array.isArray(bays) || bays.length !== expectedBays) {
      return {
        valid: false,
        error: "CANONICAL_TRANSIT_UNUSABLE",
        message: `Transit authority depot bays must have length matching baysTotal (${expectedBays})`,
      };
    }
    for (let k = 0; k < bays.length; k++) {
      const bay = bays[k];
      if (
        !bay ||
        typeof bay !== "object" ||
        bay.bayIndex !== k ||
        !bay.park ||
        typeof bay.park.x !== "number" ||
        typeof bay.park.y !== "number" ||
        !Number.isFinite(bay.park.x) ||
        !Number.isFinite(bay.park.y) ||
        typeof bay.heading !== "number" ||
        !Number.isFinite(bay.heading) ||
        !Array.isArray(bay.path) ||
        bay.path.length < 2
      ) {
        return {
          valid: false,
          error: "CANONICAL_TRANSIT_UNUSABLE",
          message: `Transit authority depot bay ${k} is malformed or has fewer than 2 path points`,
        };
      }
      for (let j = 0; j < bay.path.length; j++) {
        const bp = bay.path[j];
        if (!bp || typeof bp.x !== "number" || typeof bp.y !== "number" || !Number.isFinite(bp.x) || !Number.isFinite(bp.y)) {
          return {
            valid: false,
            error: "CANONICAL_TRANSIT_UNUSABLE",
            message: `Transit authority depot bay ${k} path point ${j} is non-finite`,
          };
        }
      }
    }
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

  if (a.geometryCapability !== b.geometryCapability) return false;

  // Compare explicit stopAnchors if present on either
  const anchorsA = a.route.stopAnchors;
  const anchorsB = b.route.stopAnchors;
  if (Boolean(anchorsA) !== Boolean(anchorsB)) return false;
  if (anchorsA && anchorsB) {
    if (anchorsA.length !== anchorsB.length) return false;
    for (let i = 0; i < anchorsA.length; i++) {
      const ancA = anchorsA[i]!;
      const ancB = anchorsB[i]!;
      if (ancA.cell.x !== ancB.cell.x || ancA.cell.y !== ancB.cell.y) return false;
      if (Math.abs(ancA.arc - ancB.arc) > 1e-4) return false;
      if (Math.abs(ancA.at.x - ancB.at.x) > 1e-4 || Math.abs(ancA.at.y - ancB.at.y) > 1e-4) return false;
      if (Math.abs(ancA.heading - ancB.heading) > 1e-4) return false;
      if (Math.abs(ancA.verge.x - ancB.verge.x) > 1e-4 || Math.abs(ancA.verge.y - ancB.verge.y) > 1e-4) return false;
      if (Math.abs(ancA.furniture.x - ancB.furniture.x) > 1e-4 || Math.abs(ancA.furniture.y - ancB.furniture.y) > 1e-4) return false;
    }
  }

  // Compare depot site if present
  const siteA = a.depot.site;
  const siteB = b.depot.site;
  if (Boolean(siteA) !== Boolean(siteB)) return false;
  if (siteA && siteB) {
    if (siteA.x !== siteB.x || siteA.y !== siteB.y || siteA.w !== siteB.w || siteA.h !== siteB.h) return false;
    if (siteA.inward.x !== siteB.inward.x || siteA.inward.y !== siteB.inward.y) return false;
  }

  // Compare depot spur if present
  const spurA = a.depot.spur;
  const spurB = b.depot.spur;
  if (Boolean(spurA) !== Boolean(spurB)) return false;
  if (spurA && spurB) {
    if (spurA.length !== spurB.length) return false;
    for (let i = 0; i < spurA.length; i++) {
      if (Math.abs(spurA[i]!.x - spurB[i]!.x) > 1e-4 || Math.abs(spurA[i]!.y - spurB[i]!.y) > 1e-4) return false;
    }
  }

  // Compare depot bays if present
  const depotBaysA = a.depot.bays;
  const depotBaysB = b.depot.bays;
  if (Boolean(depotBaysA) !== Boolean(depotBaysB)) return false;
  if (depotBaysA && depotBaysB) {
    if (depotBaysA.length !== depotBaysB.length) return false;
    for (let k = 0; k < depotBaysA.length; k++) {
      const bayA = depotBaysA[k]!;
      const bayB = depotBaysB[k]!;
      if (bayA.bayIndex !== bayB.bayIndex) return false;
      if (Math.abs(bayA.park.x - bayB.park.x) > 1e-4 || Math.abs(bayA.park.y - bayB.park.y) > 1e-4) return false;
      if (Math.abs(bayA.heading - bayB.heading) > 1e-4) return false;
      if (bayA.path.length !== bayB.path.length) return false;
      for (let j = 0; j < bayA.path.length; j++) {
        if (Math.abs(bayA.path[j]!.x - bayB.path[j]!.x) > 1e-4 || Math.abs(bayA.path[j]!.y - bayB.path[j]!.y) > 1e-4) return false;
      }
    }
  }

  return true;
}
