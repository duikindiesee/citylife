import { describe, expect, it } from "vitest";
import { calculateQuiverTrees } from "../src/colony/render/quiverTreeLogic";
import { worldClearRects } from "../src/colony/render/worldClearRects";
import { Biome } from "../src/colony/terrain";

const N = 220;
const SEA = 0;

function worldOf(biome: Biome) {
  const size = N * N;
  return {
    size: N,
    biome: new Uint8Array(size).fill(biome),
    elev: new Float32Array(size).fill(SEA + 1),
    water: new Uint8Array(size),
    worldY: () => 0,
  };
}

describe("Spec 176 — roads are strictly clear of quiver trees and foliage", () => {
  it("prevents any quiver tree from spawning inside road corridors", () => {
    // Generate trees without road clearance
    const allTrees = calculateQuiverTrees(worldOf(Biome.Plains), SEA, []);
    expect(allTrees.length).toBeGreaterThan(20);

    // Pick coordinates of some trees that would have spawned
    const target = allTrees[0]!;
    const roadSet = new Set<string>([`${target.x},${target.y}`]);

    // Compute clear rects with roadSet
    const rects = worldClearRects({
      roadSet,
    });

    const clearedTrees = calculateQuiverTrees(worldOf(Biome.Plains), SEA, rects);

    // Verify the tree at (target.x, target.y) was prevented
    const foundOnRoad = clearedTrees.some(
      (t) => Math.abs(t.x - target.x) <= 1 && Math.abs(t.y - target.y) <= 1,
    );
    expect(foundOnRoad).toBe(false);
  });
});
