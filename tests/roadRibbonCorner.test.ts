// ROAD.RIBBON.TURN.1 — the rendered carriageway must pave the road it was routed onto.
//
// The drivable cells are rasterised STRAIGHT onto `way.path` (runtime.ts layRoad), so any distance
// between the rendered centre-line and those cells is asphalt drawn where there is no road. The
// defect: roadRibbonRenderPath smoothed with textbook Chaikin, which cuts a QUARTER off every
// segment — a corner therefore moved by a distance proportional to its ARM LENGTHS. `way.path` is
// string-pulled (runtime.ts simplifyPath) and can be six points across a hundred cells, so one bend
// swung the visible asphalt 9.28 cells (37 m) off the road at (491.6, 197.6) on seed 4242 while the
// cell road underneath went the other way. Measured on the same seeds: 9.28 / 4.50 / 3.16 / 4.53.
//
// The fix clamps the cut to MAX_CORNER_CUT_CELLS, so every corner gets the same small fillet
// whatever its arms are. Two things are pinned here:
//   1. the smoothing bow — how far the RENDERED centre-line strays from the ROUTED one. This is
//      what the fix owns, and it is now bounded by the clamp instead of by segment length.
//   2. the roadKind measure — how far the rendered centre-line sits from the nearest DRIVABLE cell,
//      bounded per way by that way's own routed floor plus the fillet. Bounding it relatively
//      matters: a handful of ways are routed over ground layRoad's roadLandOk refuses to pave, so
//      their ROUTED line is already several cells from the nearest cell (seed 7 way 8, a straight
//      two-point way with no corner at all, measures 4.56). That is a rasterisation gap, not a
//      smoothing bow, and a flat threshold would either mask this defect or fail on that gap.
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  MAX_CORNER_CUT_CELLS,
  chaikin,
  densify,
  roadRibbonRenderPath,
} from "../src/colony/render/roadRibbon";
import { STATION_STEP_CELLS } from "../src/colony/render/roadClearance";

type P = { x: number; y: number };

const SEEDS = [4242, 1234, 42, 7] as const;

/** The corner-cut clamp confines a rounded corner to a triangle of side MAX_CORNER_CUT_CELLS, and
 *  the curve inside it never reaches the far side — worst measured across these seeds is 0.354
 *  cells. Half the clamp is comfortably above that and far below what proportional cutting
 *  produces (2.65 cells on a 45-degree bend with 60-cell arms, and it keeps growing with the arms). */
const MAX_BOW_CELLS = MAX_CORNER_CUT_CELLS * 0.5;

/** Distance in CELLS from p to the nearest drivable road cell, by expanding-ring search over
 *  state.roadKind — THE membership source for "is this a drivable road cell" (sim.ts). */
function cellsFromDrivableRoad(roads: Set<string>, p: P, maxR = 60): number {
  const cx = Math.round(p.x),
    cy = Math.round(p.y);
  let best = Infinity;
  for (let r = 0; r <= maxR; r++) {
    // every cell in a further ring is at least r-1 away, so we can stop once we beat that
    if (best <= r - 1) break;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!roads.has(`${cx + dx},${cy + dy}`)) continue;
        best = Math.min(best, Math.hypot(cx + dx - p.x, cy + dy - p.y));
      }
  }
  return best;
}

function distToPolyline(p: P, poly: P[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!,
      b = poly[i + 1]!;
    const vx = b.x - a.x,
      vy = b.y - a.y;
    const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2),
    );
    best = Math.min(
      best,
      Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)),
    );
  }
  return best;
}

/** The furthest any point of `pts` gets from a drivable road cell. */
function worstOffRoad(roads: Set<string>, pts: P[]): { d: number; at: P } {
  let d = 0,
    at: P = pts[0] ?? { x: 0, y: 0 };
  for (const p of pts) {
    const q = cellsFromDrivableRoad(roads, p);
    if (q > d) {
      d = q;
      at = p;
    }
  }
  return { d, at };
}

describe("ROAD.RIBBON.TURN.1 — the ribbon stays on the road it paves", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: no rendered carriageway bows off its routed centre-line`, () => {
      const rt = new ColonyRuntime(seed);
      const terrain = rt.sim.state.terrain;
      const roads = new Set(rt.sim.state.roadKind.keys());
      expect(rt.roadWays.length).toBeGreaterThan(0);

      const bowed: string[] = [];
      const offRoad: string[] = [];
      rt.roadWays.forEach((way, wi) => {
        if (way.path.length < 2) return;
        const pts = roadRibbonRenderPath(way, terrain);

        // (1) the smoothing bow — rendered centre-line vs the polyline it is smoothing.
        for (const p of pts) {
          const bow = distToPolyline(p, way.path);
          if (bow > MAX_BOW_CELLS)
            bowed.push(
              `way[${wi}] ${way.kind} (${way.path.length} routed pts): rendered (${p.x.toFixed(1)},${p.y.toFixed(1)}) bows ${bow.toFixed(2)} cells off the routed centre-line`,
            );
        }

        // (2) the roadKind measure — against this way's OWN routed floor, so a way routed over
        // ground layRoad could not pave does not mask (or fake) a smoothing regression.
        const routedFloor = worstOffRoad(
          roads,
          densify(way.path, STATION_STEP_CELLS),
        ).d;
        const rendered = worstOffRoad(roads, pts);
        if (rendered.d > routedFloor + MAX_CORNER_CUT_CELLS)
          offRoad.push(
            `way[${wi}] ${way.kind}: rendered centre-line runs ${rendered.d.toFixed(2)} cells from the nearest drivable road cell at (${rendered.at.x.toFixed(1)},${rendered.at.y.toFixed(1)}) — its routed line only ever gets ${routedFloor.toFixed(2)} away`,
          );
      });
      expect(bowed).toEqual([]);
      expect(offRoad).toEqual([]);
    });
  }

  it("rounds a corner by a fixed distance, not by a fraction of its arms", () => {
    // THE regression, in one assertion. A 90-degree bend, smoothed, measured against the bend it
    // is rounding. With proportional cutting this grows without bound as the arms get longer —
    // which is exactly what a string-pulled way.path hands the renderer.
    const bendDeviation = (arm: number): number => {
      const path: P[] = [
        { x: -arm, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: arm },
      ];
      let worst = 0;
      for (const p of chaikin(path, 3))
        worst = Math.max(worst, distToPolyline(p, path));
      return worst;
    };
    const short = bendDeviation(4);
    for (const arm of [8, 20, 60, 200]) {
      // identical, not merely bounded: past 4 * MAX_CORNER_CUT_CELLS the fillet is the same shape
      // however long the straight runs into it are.
      expect(bendDeviation(arm)).toBeCloseTo(short, 9);
      expect(bendDeviation(arm)).toBeLessThanOrEqual(MAX_BOW_CELLS);
    }
  });

  it("leaves a long straight run dead straight", () => {
    const path: P[] = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ];
    for (const p of chaikin(path, 3)) expect(p.y).toBe(0);
  });
});
