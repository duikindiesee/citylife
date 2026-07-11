import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { calculateFoliagePositions } from "../src/colony/render/foliageLogic";
import { findJunctionZones } from "../src/colony/render/roadJunctions";

// Spec 149 — the bus depot pad must clear its trees, exactly like neighborhood lots, commercial
// parcels and junction zones already do (spec 128/137). Before the fix conifers grew across the
// apron and parking bays and half-buried the parked fleet. This pins the regression on the LIVE
// seed 4242 (pad ≈ world (768, -422)): boot the real runtime, build the same foliage-exclusion
// rects R3FFoliage builds, and assert ZERO tree instances land inside the depot pad footprint.

const CELL = 4; // world metres per grid cell (LOT_SIZE in foliageLogic / scale.ts)

/** Rebuild the exact rect set R3FFoliage.calculateFoliagePositions is handed. `withDepot` toggles
 *  the spec-149 depot rect so the test can prove the exclusion — not the biome — clears the pad. */
function foliageRects(
  s: ColonyRuntime["sim"]["state"],
  withDepot: boolean,
): { x0: number; y0: number; x1: number; y1: number }[] {
  const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const lot of s.neighborhood?.lots ?? []) {
    const x0 = lot.x - Math.floor((lot.w - 1) / 2);
    const y0 = lot.y - Math.floor((lot.h - 1) / 2);
    rects.push({ x0, y0, x1: x0 + lot.w - 1, y1: y0 + lot.h - 1 });
  }
  for (const p of s.commercialDistrict?.parcels ?? []) {
    rects.push({ x0: p.x, y0: p.y, x1: p.x + p.w - 1, y1: p.y + p.h - 1 });
  }
  for (const z of findJunctionZones(s.roadWays ?? [])) {
    const r = z.rBound + 1;
    rects.push({
      x0: Math.floor(z.cx - r),
      y0: Math.floor(z.cy - r),
      x1: Math.ceil(z.cx + r),
      y1: Math.ceil(z.cy + r),
    });
  }
  const depot = s.busDepotPad;
  if (withDepot && depot) {
    rects.push({
      x0: depot.x,
      y0: depot.y,
      x1: depot.x + depot.w - 1,
      y1: depot.y + depot.h - 1,
    });
  }
  return rects;
}

/** Count tree instances whose originating cell falls inside the depot pad AABB. Foliage world
 *  positions carry no cell index, so invert the placement transform: cell = round(world/CELL + N/2)
 *  (matrix index 12 = x, 14 = z). */
function treesInPad(
  matrices: number[][],
  pad: { x: number; y: number; w: number; h: number },
  N: number,
): number {
  let n = 0;
  for (const m of matrices) {
    const cx = Math.round(m[12] / CELL + N / 2);
    const cy = Math.round(m[14] / CELL + N / 2);
    if (cx >= pad.x && cx <= pad.x + pad.w - 1 && cy >= pad.y && cy <= pad.y + pad.h - 1) n++;
  }
  return n;
}

describe("bus depot foliage clearing (seed 4242)", () => {
  it("clears every tree from the depot pad at boot", () => {
    const rt = new ColonyRuntime(4242);
    const s = rt.sim.state;
    const pad = s.busDepotPad;
    expect(pad, "seed 4242 must site a bus depot for this regression to mean anything").toBeTruthy();
    const N = s.terrain.size;

    // Guard against a vacuous pass: without the depot rect the seed genuinely grows conifers across
    // the pad, so a green assertion below can only come from the exclusion doing its job.
    const before = calculateFoliagePositions(
      s.terrain,
      s.roads,
      s.buildings,
      foliageRects(s, false),
    ).matrices;
    expect(treesInPad(before, pad!, N)).toBeGreaterThan(0);

    // With the depot rect (what R3FFoliage now builds), the apron + bays are clear.
    const after = calculateFoliagePositions(
      s.terrain,
      s.roads,
      s.buildings,
      foliageRects(s, true),
    ).matrices;
    expect(treesInPad(after, pad!, N)).toBe(0);
  });
});
