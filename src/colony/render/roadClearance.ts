// The ONE road/terrain clearance invariant.
//
// The rendered carriageway is a triangle mesh whose vertices are draped on the terrain by
// `getSmoothRoadY`, which returns the MAX ground height within `SAMPLE_RADIUS_CELLS` of the point
// it is asked about. That makes each vertex safe, but says nothing about the surface BETWEEN
// vertices: a quad is a flat linear interpolation of its corners, so any ground that rises between
// them pokes through the road.
//
// The invariant that makes the whole carriageway safe:
//
//   every point of the rendered surface must lie within SAMPLE_RADIUS_CELLS (per axis) of a vertex
//
// because then that vertex's height is already >= the ground at that point, and a linear
// interpolation between two such vertices is >= min(both) >= the ground between them. Concretely
// that means vertices must be laid out across the COMPLETE rendered width, not only at the two
// kerbs or the road-cell centres, and stations must not outrun the sampler along the road either:
//
//   VERTEX_STEP_CELLS / 2 <= SAMPLE_RADIUS_CELLS   (across the carriageway)
//   STATION_STEP_CELLS / 2 <= SAMPLE_RADIUS_CELLS  (along the carriageway)
//
// The old geometry violated both: two vertices per station (leaving the middle of a ~3-cell
// carriageway unsampled) and 1.5-cell stations against a 0.6-cell sampler.
//
// Renderer and tests import these constants from here so the drape and its regression proof can
// never drift apart.

/** Half-extent, in grid cells, of the footprint `getSmoothRoadY` maxes over. Keep in sync with
 *  roadSurface.ts, which sweeps ix/iy in [-3, 3] at 0.2 cells. */
export const SAMPLE_RADIUS_CELLS = 0.6;

/** Spacing between adjacent vertices ACROSS the carriageway. */
export const VERTEX_STEP_CELLS = 0.5;

/** Spacing between successive stations ALONG the carriageway. */
export const STATION_STEP_CELLS = 1.0;

/** Ground clearance the rendered surface is asserted to keep, in world metres. The drape adds
 *  ROAD_RIBBON_LIFT (0.18 m); this is the slack a regression test demands after floating-point and
 *  the sampler's 0.2-cell lattice, so a real protrusion fails loudly while noise does not. */
export const CLEARANCE_EPSILON_M = 0.01;

/** True when the vertex layout still satisfies the invariant. Guards the constants themselves. */
export function clearanceLayoutOk(
  vertexStep = VERTEX_STEP_CELLS,
  stationStep = STATION_STEP_CELLS,
  radius = SAMPLE_RADIUS_CELLS,
): boolean {
  return vertexStep / 2 <= radius && stationStep / 2 <= radius;
}

/** Signed offsets across a carriageway of half-width `half`, from one kerb to the other at
 *  VERTEX_STEP_CELLS. Both kerbs are always included EXACTLY, so the rendered edge stays where the
 *  carriageway really ends however the step divides. Shared by the ribbon extruder and the tests. */
export function crossSectionOffsets(
  half: number,
  step = VERTEX_STEP_CELLS,
): number[] {
  const safeHalf = Math.max(0, half);
  if (safeHalf === 0) return [0];
  const out: number[] = [];
  for (let k = -safeHalf; k < safeHalf - 1e-9; k += step) out.push(k);
  out.push(safeHalf); // exact far kerb, never overshot by the accumulating step
  return out;
}

/** Minimal shape of the terrain this module needs to spot a water cell. */
export interface WaterProbe {
  inBounds(x: number, y: number): boolean;
  idx(x: number, y: number): number;
  readonly water: ArrayLike<number>;
}

/** True when the bilinear stencil under a rendered road sample touches water — a BRIDGE SPAN.
 *
 *  The ground beneath a road sample is reconstructed bilinearly from four integer cell corners.
 *  The spec 115/133 water guard forbids grading or paving over water, so a corner that is water
 *  keeps its natural bed height and the interpolated ground necessarily falls away beneath the
 *  road edge. That is not a clearance defect to be graded out: a road carried over water IS a
 *  bridge, and grounding it would mean raising a river bed. The ground-clearance guard therefore
 *  excepts these samples, while PROTRUSION stays strictly enforced everywhere — a bridge may span
 *  open water, but terrain must still never rise through the deck. */
export function stencilTouchesWater(
  terrain: WaterProbe,
  gx: number,
  gy: number,
): boolean {
  const x0 = Math.floor(gx),
    y0 = Math.floor(gy);
  for (const [x, y] of [
    [x0, y0],
    [x0 + 1, y0],
    [x0, y0 + 1],
    [x0 + 1, y0 + 1],
  ] as const) {
    if (!terrain.inBounds(x, y)) continue;
    if (terrain.water[terrain.idx(x, y)]) return true;
  }
  return false;
}
