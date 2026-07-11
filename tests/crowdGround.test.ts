// Spec 140 — the crowd rides the road ribbon on road cells, the leveled ground elsewhere.
import { describe, it, expect } from "vitest";
import { crowdGroundY } from "../src/colony/render/crowdGround";
import { ROAD_RIBBON_LIFT } from "../src/colony/render/roadRibbon";

// a flat terrain at height H everywhere (worldYAt == worldY == H); size only bounds the index math
const flatTerrain = (h: number) => ({
  size: 64,
  worldY: () => h,
  worldYAt: () => h,
});
const roads = (...keys: string[]) => ({ has: (k: string) => keys.includes(k) });

describe("spec 140 — crowd ground surface", () => {
  it("on a road cell, stands on the ribbon top (getSmoothRoadY + lift), not the ground under it", () => {
    const t = flatTerrain(5);
    // getSmoothRoadY over a flat terrain is the flat height; the figure stands lift above it
    expect(crowdGroundY(t, null, roads("5,5"), 5, 5)).toBeCloseTo(5 + ROAD_RIBBON_LIFT, 5);
  });

  it("off a road cell, stands on the leveled ground (no ribbon lift)", () => {
    const t = flatTerrain(5);
    expect(crowdGroundY(t, null, roads("5,5"), 9, 9)).toBeCloseTo(5, 5);
  });

  it("off-road honours the leveling override where one exists", () => {
    const t = flatTerrain(5);
    const level = new Map<number, number>([[9 * t.size + 9, 12]]); // graded pad at (9,9)
    expect(crowdGroundY(t, level, roads(), 9, 9)).toBeCloseTo(12, 5);
    // but a road cell ignores the override and takes the ribbon surface
    expect(crowdGroundY(t, level, roads("9,9"), 9, 9)).toBeCloseTo(5 + ROAD_RIBBON_LIFT, 5);
  });

  it("a null roadSet falls back to the leveled ground everywhere", () => {
    const t = flatTerrain(3);
    expect(crowdGroundY(t, null, null, 1, 1)).toBeCloseTo(3, 5);
  });
});
