import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  findJunctionZones,
  type JunctionZone,
} from "../src/colony/render/roadJunctions";
import {
  attachCapPolys,
  capCrosswalks,
  capStopBars,
  paintApproaches,
  PAINT_APPROACH_MERGE_DEG,
  type CapBuildOptions,
} from "../src/colony/render/junctionCap";

// ROAD.JUNCTION.PAINT.1 — the junction INTERIOR paint proof.
//
// The existing junction proofs all assert DISTANCES (cap overshoot, edge notch, arm-mouth
// containment, continuity). Every one of them passed while the operator was looking at a
// junction whose centre carried a fan of stacked zebra stripes and stray diagonal slashes:
// "the crosswalks look like a barcode" is not a distance, so no invariant could catch it.
//
// This proof asserts LAYOUT instead, over every junction of four seeded worlds:
//   1. no two painted quads overlap                      (no stacking / barcode)
//   2. one crosswalk band per approach, and bands are
//      mutually non-parallel by the approach threshold   (no fan of near-duplicate bands)
//   3. every stripe is aligned to its own arm axis       (no diagonal slashes)
//
// Geometry is evaluated in GRID space with a flat road plane, so the assertions are about
// layout alone and cannot be perturbed by terrain drape.

const SEEDS = [4242, 7, 99, 1234];

function worldZones(seed: number): {
  zones: JunctionZone[];
  opts: CapBuildOptions;
} {
  const rt = new ColonyRuntime(seed);
  // Match R3FRoadRibbons: depot spurs are not public ways and never form junctions.
  const ways = (rt.sim.state.roadWays ?? []).filter(
    (w) => w.source !== "depot-spur",
  );
  const zones = attachCapPolys(findJunctionZones(ways));
  const opts: CapBuildOptions = {
    terrain: rt.sim.state.terrain,
    wx: (x) => x,
    wz: (y) => y,
    roadY: () => 0,
  };
  return { zones, opts };
}

/** Triangles (9 floats) -> quads (2 tris). capCrosswalks/capStopBars emit exactly this. */
function quadsOf(out: number[]): Array<Array<[number, number]>> {
  const tris: Array<Array<[number, number]>> = [];
  for (let i = 0; i + 8 < out.length; i += 9) {
    tris.push([
      [out[i]!, out[i + 2]!],
      [out[i + 3]!, out[i + 5]!],
      [out[i + 6]!, out[i + 8]!],
    ]);
  }
  const quads: Array<Array<[number, number]>> = [];
  for (let t = 0; t + 1 < tris.length; t += 2) {
    // emitted as [0,1,2] then [0,2,3] -> corners are a0,a1,a2,b2
    const a = tris[t]!,
      b = tris[t + 1]!;
    quads.push([a[0]!, a[1]!, a[2]!, b[2]!]);
  }
  return quads;
}

/** Independent separating-axis overlap oracle (deliberately NOT the shipped helper). */
function overlaps(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): boolean {
  const area = (p: Array<[number, number]>) => {
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const u = p[i]!,
        v = p[(i + 1) % p.length]!;
      s += u[0] * v[1] - v[0] * u[1];
    }
    return Math.abs(s) / 2;
  };
  // ignore degenerate slivers; a zero-area quad cannot be "visibly stacked"
  if (area(a) < 1e-9 || area(b) < 1e-9) return false;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!,
        q = poly[(i + 1) % poly.length]!;
      const nx = -(q[1] - p[1]),
        ny = q[0] - p[0];
      const len = Math.hypot(nx, ny);
      if (len < 1e-12) continue;
      const ax = nx / len,
        ay = ny / len;
      let aMin = Infinity,
        aMax = -Infinity,
        bMin = Infinity,
        bMax = -Infinity;
      for (const v of a) {
        const d = v[0] * ax + v[1] * ay;
        aMin = Math.min(aMin, d);
        aMax = Math.max(aMax, d);
      }
      for (const v of b) {
        const d = v[0] * ax + v[1] * ay;
        bMin = Math.min(bMin, d);
        bMax = Math.max(bMax, d);
      }
      // 1 mm of tolerance at grid scale (1 cell = 4 m) -> 2.5e-4 cells
      if (aMax <= bMin + 2.5e-4 || bMax <= aMin + 2.5e-4) return false;
    }
  }
  return true;
}

/** Acute angle in DEGREES between a quad's long axis and a reference direction. */
function longAxisDeg(
  q: Array<[number, number]>,
  ux: number,
  uy: number,
): number {
  // long axis = the longer of the two edge directions
  const e1 = [q[1]![0] - q[0]![0], q[1]![1] - q[0]![1]] as const;
  const e2 = [q[2]![0] - q[1]![0], q[2]![1] - q[1]![1]] as const;
  const long = Math.hypot(...e1) >= Math.hypot(...e2) ? e1 : e2;
  const l = Math.hypot(long[0], long[1]) || 1;
  const dot = Math.abs((long[0] / l) * ux + (long[1] / l) * uy);
  return (Math.acos(Math.max(0, Math.min(1, dot))) * 180) / Math.PI;
}

describe("ROAD.JUNCTION.PAINT.1 — junction interior paint layout", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: no painted quad overlaps another`, () => {
      const { zones, opts } = worldZones(seed);
      expect(zones.length, "world has junctions to prove").toBeGreaterThan(0);

      const offenders: string[] = [];
      let quadTotal = 0;
      for (let z = 0; z < zones.length; z++) {
        const out: number[] = [];
        capCrosswalks(zones[z]!, opts, out);
        capStopBars(zones[z]!, opts, out);
        const quads = quadsOf(out);
        quadTotal += quads.length;
        for (let i = 0; i < quads.length; i++) {
          for (let j = i + 1; j < quads.length; j++) {
            if (overlaps(quads[i]!, quads[j]!)) {
              offenders.push(
                `zone ${z} (${zones[z]!.kind}, ${zones[z]!.arms.length} arms): quad ${i} overlaps quad ${j}`,
              );
            }
          }
        }
      }
      expect(quadTotal, "paint was actually emitted").toBeGreaterThan(0);
      expect(
        offenders.slice(0, 12),
        `${offenders.length} overlapping painted quads across ${zones.length} junctions`,
      ).toEqual([]);
    });

    it(`seed ${seed}: one crosswalk band per approach, no near-parallel duplicates`, () => {
      const { zones, opts } = worldZones(seed);
      const offenders: string[] = [];
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z]!;
        if (zone.kind === "bend") continue;
        const out: number[] = [];
        capCrosswalks(zone, opts, out);
        const quads = quadsOf(out);
        if (quads.length === 0) continue;

        // Stripes carry their band's direction in their long axis; group into bands of 5.
        expect(
          quads.length % 5,
          `zone ${z}: crosswalk stripes come in bands of 5`,
        ).toBe(0);
        const bandCount = quads.length / 5;
        const approaches = paintApproaches(zone);

        // TWO-SIDED: a band per approach is the ceiling (terrain may drop some), and the
        // count may never EXCEED the approach count — that excess is exactly the stacking.
        if (bandCount > approaches.length) {
          offenders.push(
            `zone ${z}: ${bandCount} bands for ${approaches.length} approaches (${zone.arms.length} raw arms)`,
          );
        }

        // No two bands may sit on the same OUTWARD bearing from the junction centre —
        // that is the fan/stack the operator saw. (Opposite ends of one through road are
        // anti-parallel and 180 deg apart on this measure, which is correct and allowed.)
        const dirs: Array<[number, number]> = [];
        for (let b = 0; b < bandCount; b++) {
          let sx = 0,
            sy = 0,
            n = 0;
          for (let s = 0; s < 5; s++)
            for (const c of quads[b * 5 + s]!) {
              sx += c[0];
              sy += c[1];
              n++;
            }
          const vx = sx / n - zone.cx,
            vy = sy / n - zone.cy;
          const l = Math.hypot(vx, vy) || 1;
          dirs.push([vx / l, vy / l]);
        }
        for (let i = 0; i < dirs.length; i++) {
          for (let j = i + 1; j < dirs.length; j++) {
            const dot = dirs[i]![0] * dirs[j]![0] + dirs[i]![1] * dirs[j]![1];
            const deg =
              (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
            if (deg < PAINT_APPROACH_MERGE_DEG - 1e-6) {
              offenders.push(
                `zone ${z}: bands ${i}/${j} share a bearing (${deg.toFixed(1)} deg apart)`,
              );
            }
          }
        }
      }
      expect(
        offenders.slice(0, 12),
        `${offenders.length} crosswalk-band layout faults`,
      ).toEqual([]);
    });

    it(`seed ${seed}: every stripe is aligned to a real arm axis (no diagonals)`, () => {
      const { zones, opts } = worldZones(seed);
      const offenders: string[] = [];
      let checked = 0;
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z]!;
        const out: number[] = [];
        capCrosswalks(zone, opts, out);
        for (const q of quadsOf(out)) {
          checked++;
          // must be aligned to SOME arm of this junction, to <1 deg
          const best = Math.min(
            ...zone.arms.map((a) => longAxisDeg(q, a.ux, a.uy)),
          );
          if (best > 1) {
            offenders.push(
              `zone ${z}: stripe off every arm axis by ${best.toFixed(1)} deg`,
            );
          }
        }
      }
      expect(checked, "stripes were checked").toBeGreaterThan(0);
      expect(
        offenders.slice(0, 12),
        `${offenders.length} misaligned stripes`,
      ).toEqual([]);
    });
  }

  it("paintApproaches collapses a near-parallel arm bundle to one approach", () => {
    // Directly pins the mechanism: four arms, two of them 3 deg apart (the shallow
    // near-parallel crossing that produced stacked zebras on origin/main).
    const zone: JunctionZone = {
      cx: 0,
      cy: 0,
      kind: "cross",
      arms: [
        { ux: 1, uy: 0, half: 1.15, mouthD: 3, terminating: false, wayIdx: 0 },
        {
          ux: Math.cos((3 * Math.PI) / 180),
          uy: Math.sin((3 * Math.PI) / 180),
          half: 1.6,
          mouthD: 3,
          terminating: false,
          wayIdx: 1,
        },
        { ux: -1, uy: 0, half: 1.15, mouthD: 3, terminating: false, wayIdx: 0 },
        { ux: 0, uy: 1, half: 1.15, mouthD: 3, terminating: false, wayIdx: 2 },
      ],
      wayIdx: [0, 1, 2],
      poly: [],
      rBound: 5,
    };
    const approaches = paintApproaches(zone);
    expect(approaches).toHaveLength(3);
    // the widest arm of the bundle wins, and its REAL heading survives (not an average)
    const merged = approaches.find((a) => Math.abs(a.uy) > 1e-9 && a.ux > 0)!;
    expect(merged.half).toBe(1.6);
    expect(merged.ux).toBeCloseTo(Math.cos((3 * Math.PI) / 180), 12);
    expect(merged.uy).toBeCloseTo(Math.sin((3 * Math.PI) / 180), 12);
  });
});
