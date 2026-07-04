// Spec 118 — road seam continuity. Road tiles used to pitch around their own centers with
// slopes sampled from NEIGHBOR CENTERS 8m apart, and intersections were forced flat at
// their own height — so adjacent segments never agreed on the height of their shared
// boundary and every grade change showed a visible step (operator screenshot 2026-07-04).
//
// The fix: both sides of a boundary compute ONE shared edge height (the functions here are
// symmetric by construction — that symmetry IS the no-seam invariant, pinned by tests),
// and each pitched segment is built so its two edges land EXACTLY on those shared heights.
//
// Article I of the V3 constitution is preserved: straights pitch along travel only, roll
// stays locked at zero, intersections and corners stay flat, and the projected footprint
// of every segment remains exactly one 4x4m grid cell.

export const ROAD_CELL_SPAN = 4;

/** Straight north-south runs and their dead ends: mask N(1), S(4), N+S(5). */
export function isPitchableNS(mask: number): boolean {
  return mask === 1 || mask === 4 || mask === 5;
}

/** Straight east-west runs and their dead ends: mask E(2), W(8), E+W(10). */
export function isPitchableEW(mask: number): boolean {
  return mask === 2 || mask === 8 || mask === 10;
}

/** Corners, T-junctions, crossroads and isolated cells stay flat so any number of
 *  connections meet cleanly (constitution: intersections connect flat). */
export function isFlatRoad(mask: number): boolean {
  return !isPitchableNS(mask) && !isPitchableEW(mask);
}

/** The height of the shared boundary between a road cell and its neighbor in one
 *  direction. SYMMETRIC: the neighbor computing its side of the same boundary swaps the
 *  arguments and gets the identical value — that is the no-seam invariant.
 *  - no road neighbor: the cell holds its own height at that edge (dead ends stay level)
 *  - a flat tile's surface is a single height, so a pitched neighbor bends to meet it;
 *    two adjacent flats take the max (a single flat slab cannot honor two edge heights —
 *    rare, documented in spec 118)
 *  - two pitched tiles meet at the midpoint of their surface heights */
export function roadEdgeHeight(
  hSelf: number,
  selfFlat: boolean,
  hNeighbor: number | null,
  neighborFlat: boolean,
): number {
  if (hNeighbor === null) return hSelf;
  if (selfFlat && neighborFlat) return Math.max(hSelf, hNeighbor);
  if (selfFlat) return hSelf;
  if (neighborFlat) return hNeighbor;
  return (hSelf + hNeighbor) / 2;
}

export interface SegmentPitch {
  /** Rotation about the cross-travel axis, sign matching the renderer's existing
   *  conventions (rotX = atan2(north - south, span), rotZ = atan2(east - west, span)). */
  rot: number;
  /** Group Y so the segment's midpoint sits between its two edge heights. */
  centerY: number;
  /** Along-travel box length: the hypotenuse, so the PROJECTED footprint is exactly one
   *  cell and the segment's ends land exactly on the shared edge heights. */
  length: number;
}

/** Build the pitch for a straight segment whose two boundary heights are known.
 *  Exactness (pinned by tests): centerY + (length/2)sin(rot) === hInEdge and
 *  centerY - (length/2)sin(rot) === hOutEdge, and length*cos(rot) === span. */
export function pitchBetweenEdges(
  hInEdge: number,
  hOutEdge: number,
  span: number = ROAD_CELL_SPAN,
): SegmentPitch {
  const drop = hInEdge - hOutEdge;
  return {
    rot: Math.atan2(drop, span),
    centerY: (hInEdge + hOutEdge) / 2,
    length: Math.hypot(span, drop),
  };
}
