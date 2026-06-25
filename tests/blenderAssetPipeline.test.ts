import { describe, expect, it } from "vitest";
import { rallyVenuePropPlacements, venuePropAssets } from "../src/colony/render/venuePropAssets";
import type { SeedStructure } from "../src/colony/sim";

const dryTerrain = {
  inBounds: (x: number, y: number) => x >= 0 && x < 192 && y >= 0 && y < 192,
  isWater: () => false,
  worldY: () => 5.191,
};

describe("Blender GLB venue prop asset pipeline", () => {
  it("registers the public-safe rally venue bench GLB", () => {
    expect(venuePropAssets).toEqual([
      {
        id: "rally-venue-bench",
        url: "/assets/citylife/props/rally-venue-bench.glb",
        instanceKind: "rallyVenueBench",
        publicSafe: true,
      },
    ]);
  });

  it("derives one deterministic rally prop placement from city coordinates", () => {
    const structures: SeedStructure[] = [{ kind: "rally", x: 91, y: 73 }];
    const first = rallyVenuePropPlacements(structures, dryTerrain as never);
    const second = rallyVenuePropPlacements(structures, dryTerrain as never);
    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        assetId: "rally-venue-bench",
        instanceKind: "rallyVenueBench",
        x: 93,
        y: 74,
        rotationTurns: 0.125,
        scale: 1,
      },
    ]);
  });

  it("does not place Blender props without a rally marker", () => {
    expect(rallyVenuePropPlacements([{ kind: "rocket", x: 10, y: 10 }])).toEqual([]);
  });
});
