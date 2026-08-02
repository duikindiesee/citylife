// HQ.SITE.1 — wire the (already-authored) Kooker HQ interior fragment to a real, surveyed site in the
// CIVIC centre of the colony. Pure and deterministic — no three.js / React / DOM / fetch — so it runs
// in node tests exactly like the rest of the spatial layer, and the same survey always yields
// byte-identical site + portal metadata.
//
// This is the slice `kookerHqInterior.ts` says it is waiting for, in its own words: "does NOT decide
// where the HQ sits in the running world — the runtime survey/wiring slice supplies the surveyed HQ
// site". Until now nothing supplied it, so the interior existed with no way in and was imported by
// tests only.
//
// WHY CIVIC, and not a commercial plot like the Gamehouse. `cellZone` already anchors CIVIC at the
// colony centre, around the landing (`d < 4` from the landing cell), and splits every outer arc into
// commercial / industrial / residential. The civic ring is the one zone with no tenant competing for
// it — a headquarters is what it is FOR — and putting HQ there gives the straight street-door sightline
// spec 153's campus plan is built around. Operator decision, 2026-08-01.
//
// This module READS the survey it is given and copies cells verbatim. It never mutates terrain, a
// road, a plot, an owner or any world coordinate, and it fabricates nothing: with no buildable civic
// cell it returns null so callers fail CLOSED (the HQ simply does not appear) rather than dropping a
// building into the sea.
import type { GridCell } from "../worldSurvey";
import type {
  WorldLayoutDocumentInput,
  WorldLayoutFrame,
} from "./worldLayoutDocument";
import {
  buildKookerHqInteriorFragment,
  withKookerHqInterior,
  type KookerHqFacing,
  type KookerHqInteriorFragment,
} from "./kookerHqInterior";

/** How far from the landing the civic ring reaches, in cells. Mirrors `cellZone`'s own `d < 4` civic
 *  test — kept as a named constant here so the coupling is visible rather than a repeated literal. */
export const HQ_CIVIC_RADIUS_CELLS = 4;

export type KookerHqPortalErrorCode = "NO_CIVIC_SITE";

export class KookerHqPortalError extends Error {
  constructor(
    readonly code: KookerHqPortalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KookerHqPortalError";
  }
}

/**
 * The world facts this module needs to choose a site, supplied as plain predicates.
 *
 * Deliberately NOT the Terrain/ColonyState objects themselves: taking closures keeps this module free
 * of the sim layer, so the siting rule is testable in node against a hand-drawn 9x9 world instead of a
 * booted colony.
 */
export interface KookerHqSiteSurvey {
  /** The landing cell — the civic centre `cellZone` measures from. */
  readonly landing: GridCell;
  /** True when the cell is dry, buildable ground (not ocean, shallows, river or beach). */
  readonly isBuildable: (x: number, y: number) => boolean;
  /** True when a road occupies the cell. The HQ must not sit ON the carriageway... */
  readonly isRoad: (x: number, y: number) => boolean;
  /** True when something already claims the cell (a plot, a structure, the landing itself). */
  readonly isOccupied: (x: number, y: number) => boolean;
}

/** The surveyed HQ site: the door cell, which way it faces, and the road it fronts. Read-only. */
export interface KookerHqPortalSite {
  /** The surface grid cell of the HQ door — what both portals pin to. */
  readonly entranceCell: GridCell;
  /** Which way the door opens. Always toward the road the site fronts. */
  readonly facing: KookerHqFacing;
  /** The road cell the door faces, for metadata and cross-referencing. */
  readonly frontsRoad: GridCell;
  /** Chebyshev distance from the landing, in cells — always < HQ_CIVIC_RADIUS_CELLS. */
  readonly distanceFromLanding: number;
}

/** The four road-facing directions, in a FIXED order. Ties break by this order, so the chosen facing
 *  is deterministic for a given survey rather than dependent on iteration accidents. */
const FACINGS: readonly { facing: KookerHqFacing; dx: number; dy: number }[] = [
  { facing: "n", dx: 0, dy: -1 },
  { facing: "e", dx: 1, dy: 0 },
  { facing: "s", dx: 0, dy: 1 },
  { facing: "w", dx: -1, dy: 0 },
];

/**
 * Choose the HQ door cell: the buildable, unoccupied, non-road civic cell CLOSEST to the landing that
 * fronts a road, with the door opening toward that road.
 *
 * Returns null — never a fabricated cell — when the civic ring holds no such site. That happens for
 * real (a landing ringed by water, a survey that laid no civic roads), and a null must fail closed all
 * the way up: no HQ is a strictly better outcome than an HQ in the sea.
 *
 * Determinism: candidates are visited in ring order (nearest first), then row-major within a ring, and
 * facings resolve in the fixed N/E/S/W order above. No sorting on floats, no iteration over a Map.
 */
export function resolveKookerHqSite(
  survey: KookerHqSiteSurvey,
): KookerHqPortalSite | null {
  const { landing, isBuildable, isRoad, isOccupied } = survey;
  // Ring order: every cell at Chebyshev distance 0, then 1, then 2... so the HQ lands as close to the
  // centre as the ground allows and the result cannot depend on scan direction.
  for (let ring = 0; ring < HQ_CIVIC_RADIUS_CELLS; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        // Only the ring's own perimeter; inner cells were covered by an earlier, closer ring.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = landing.x + dx;
        const y = landing.y + dy;
        if (!isBuildable(x, y)) continue;
        if (isRoad(x, y)) continue;
        if (isOccupied(x, y)) continue;
        for (const f of FACINGS) {
          const rx = x + f.dx;
          const ry = y + f.dy;
          if (!isRoad(rx, ry)) continue;
          return {
            entranceCell: { x, y },
            facing: f.facing,
            frontsRoad: { x: rx, y: ry },
            distanceFromLanding: ring,
          };
        }
      }
    }
  }
  return null;
}

/** Build the HQ interior fragment (building frame, reception room, the inverse enter/exit door portals)
 *  anchored on the surveyed civic site. Throws NO_CIVIC_SITE when the civic ring offers none. */
export function buildKookerHqPortalFragment(
  surfaceFrame: WorldLayoutFrame,
  survey: KookerHqSiteSurvey,
): { site: KookerHqPortalSite; fragment: KookerHqInteriorFragment } {
  const site = resolveKookerHqSite(survey);
  if (!site)
    throw new KookerHqPortalError(
      "NO_CIVIC_SITE",
      "civic centre has no buildable road-fronting cell to anchor Kooker HQ to",
    );
  const fragment = buildKookerHqInteriorFragment(surfaceFrame, {
    entranceCell: site.entranceCell,
    facing: site.facing,
  });
  return { site, fragment };
}

/** Append the HQ (frames + portals) to a world-layout document input, anchored on the surveyed civic
 *  site. Carries every existing frame/portal/placement/road/way/zone/reservation/network/terrain edit
 *  through untouched and in order (withKookerHqInterior's contract), so no original island id or
 *  coordinate changes. Throws NO_CIVIC_SITE when the civic ring offers no site. */
export function withKookerHqPortal(
  input: WorldLayoutDocumentInput,
  survey: KookerHqSiteSurvey,
): WorldLayoutDocumentInput {
  const site = resolveKookerHqSite(survey);
  if (!site)
    throw new KookerHqPortalError(
      "NO_CIVIC_SITE",
      "civic centre has no buildable road-fronting cell to anchor Kooker HQ to",
    );
  return withKookerHqInterior(input, {
    entranceCell: site.entranceCell,
    facing: site.facing,
  });
}
