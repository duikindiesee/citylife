// Spec 169 §3.4 — THE STRAND RUN: the coastal signature route, authored (WORLD.LONGBEACH.1 slice 1).
//
// The operator's stated critical is racing roads, and the spec's decomposition of "fun to drive"
// (§3.1) is concrete: an AUTHORED way (BFS staircase wiggle is the enemy), class-A sweepers that
// follow the shoreline's own noise, straights long enough to HOLD top speed (≥120 cells ≈ 10–14 s
// flat-out), and an arroyo bridge for drama. This module authors exactly that from the field:
//
//   centreline x(y) = coastline(y) + setback(y)        — the road traces the coast at 20–40 cells
//   two DESIGNED straights (chord-blended bands)        — designed features, not noise accidents
//   bridges recorded where the route crosses a wash     — water-flagged cells under the path
//
// The route's speed/width/grip character rides on the RACING PROFILE, not on a new RoadKind: slice 1
// deliberately defers spec §2's `highway` union member to the slice that lays real highway ROADS,
// because the union ripples through the persistence codec and builder surfaces (8 files) for zero
// slice-1 benefit — no highway cell exists in any world yet. The profile carries the same numbers
// the spec's tier table proposes (11.5 cells/s ceiling, width 4).
import { LB_REACH, coastlineX, type LongBeachField } from "./longBeachField";

/** Spec §2 tier 0, carried on the profile until real highway roads exist: ~166 km/h. PROPOSED and
 *  untested in the spec's own words — tuned here only as far as the drive test demands. */
export const STRAND_TOP_SPEED_CELLS_PER_SEC = 11.5;
/** Spec §3.2 — the lateral-grip cap that makes corners price speed. A_LAT, cells/s². */
export const STRAND_LATERAL_GRIP_CELLS_PER_SEC2 = 14;
/** Spec §2 — highway carriageway is 4 cells; half minus the kerb margin the off-track check keeps. */
export const STRAND_HALF_WIDTH_CELLS = 4 / 2 - 0.35;
/** The coast setback band (§2.3 rule 3): the sea stays in view from the carriageway. */
export const STRAND_SETBACK_MIN = 20;
export const STRAND_SETBACK_MAX = 40;
/** The two DESIGNED straights, as global-row bands. Placed to dodge the arroyo margin rows. */
export const STRAND_STRAIGHT_BANDS: readonly [number, number][] = [
  [64, 200],
  [304, 448],
];
/** Sampling step along y (cells). Fine enough that curvature is real, coarse enough to stay light. */
const STEP_ROWS = 4;
/** How many rows the chord blend eases in/out of a straight band. */
const BLEND_ROWS = 20;

export interface StrandBridge {
  /** Index into the route path of the first on-water vertex of this crossing. */
  readonly pathIndex: number;
  readonly x: number;
  readonly y: number;
  /** Crossing length in path vertices (all water beneath). */
  readonly spanVertices: number;
}

export interface StrandRun {
  readonly name: "The Strand Run";
  readonly path: { x: number; y: number }[];
  /** Polyline length in cells. */
  readonly lengthCells: number;
  readonly bridges: StrandBridge[];
  readonly profile: {
    readonly halfWidthCells: number;
    readonly topSpeedCellsPerSec: number;
    readonly lateralGripCapCellsPerSec2: number;
  };
}

const smooth01 = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Raw centreline x for a row: coast + a gently varying setback. Pure in (seed, y). */
function rawCentreX(seed: number, y: number): number {
  // Reuse the field's own coast; the setback varies slowly inside [MIN, MAX] so the sweepers come
  // from the SHORELINE's character, not from setback jitter.
  const coast = coastlineX(seed, y);
  const t = 0.5 + 0.5 * Math.sin(y / 90 + (seed % 97) * 0.13);
  const setback =
    STRAND_SETBACK_MIN +
    (STRAND_SETBACK_MAX - STRAND_SETBACK_MIN) * (0.35 + 0.3 * t);
  return coast + setback;
}

/**
 * Author the Strand Run over reach 1 of the field.
 *
 * Straight bands are CHORDS: inside each band the centreline blends to the straight line between the
 * band's entry and exit anchors, with smooth ramps, so the straight is genuinely straight and the
 * joins are sweepers rather than kinks. The corridor assertion (20–40 off the coast) applies OUTSIDE
 * the bands; inside them the road may cut across the coast's wander — that is what a designed
 * straight on a real coast road does.
 */
export function buildStrandRun(field: LongBeachField): StrandRun {
  const seed = field.seed;
  const yStart = 12;
  const yEnd = Math.min(field.height, LB_REACH) - 12;

  // Band chord anchors, computed from the raw line at the band edges.
  const bands = STRAND_STRAIGHT_BANDS.map(([a, b]) => ({
    a,
    b,
    xa: rawCentreX(seed, a),
    xb: rawCentreX(seed, b),
  }));

  const centreX = (y: number): number => {
    let x = rawCentreX(seed, y);
    for (const band of bands) {
      if (y < band.a - BLEND_ROWS || y > band.b + BLEND_ROWS) continue;
      const chord =
        band.xa + ((band.xb - band.xa) * (y - band.a)) / (band.b - band.a);
      let w = 1;
      if (y < band.a) w = smooth01((y - (band.a - BLEND_ROWS)) / BLEND_ROWS);
      else if (y > band.b) w = smooth01((band.b + BLEND_ROWS - y) / BLEND_ROWS);
      x = x * (1 - w) + chord * w;
    }
    return x;
  };

  // Sample, then one smoothing pass (three-point average) to round the discretisation.
  const pts: { x: number; y: number }[] = [];
  for (let y = yStart; y <= yEnd; y += STEP_ROWS)
    pts.push({ x: centreX(y), y });
  const path = pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return { x: p.x, y: p.y };
    return {
      x: (pts[i - 1]!.x + p.x + pts[i + 1]!.x) / 3,
      y: (pts[i - 1]!.y + p.y + pts[i + 1]!.y) / 3,
    };
  });

  let lengthCells = 0;
  for (let i = 1; i < path.length; i++)
    lengthCells += Math.hypot(
      path[i]!.x - path[i - 1]!.x,
      path[i]!.y - path[i - 1]!.y,
    );

  // Bridges: runs of consecutive path vertices standing on water-flagged cells (the arroyos).
  const bridges: StrandBridge[] = [];
  let runStart = -1;
  for (let i = 0; i < path.length; i++) {
    const cx = Math.round(path[i]!.x);
    const cy = Math.round(path[i]!.y);
    const wet = field.inBounds(cx, cy) && field.water[field.idx(cx, cy)] === 1;
    if (wet && runStart < 0) runStart = i;
    if ((!wet || i === path.length - 1) && runStart >= 0) {
      bridges.push({
        pathIndex: runStart,
        x: path[runStart]!.x,
        y: path[runStart]!.y,
        spanVertices: (wet ? i + 1 : i) - runStart,
      });
      runStart = -1;
    }
  }

  return {
    name: "The Strand Run",
    path,
    lengthCells,
    bridges,
    profile: {
      halfWidthCells: STRAND_HALF_WIDTH_CELLS,
      topSpeedCellsPerSec: STRAND_TOP_SPEED_CELLS_PER_SEC,
      lateralGripCapCellsPerSec2: STRAND_LATERAL_GRIP_CELLS_PER_SEC2,
    },
  };
}
