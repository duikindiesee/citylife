import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import type { Terrain } from "../src/colony/terrain";
import {
  plotClearsBuildableTerrain,
  plotTerrainInvalidCells,
} from "../src/colony/placementValidation";

function terrainFixture(
  options: {
    water?: string[];
    nonBuildable?: string[];
    nonFinite?: string[];
  } = {},
): Terrain {
  const size = 6;
  const water = new Set(options.water ?? []);
  const nonBuildable = new Set(options.nonBuildable ?? []);
  const nonFinite = new Set(options.nonFinite ?? []);
  return {
    size,
    buildable: Uint8Array.from({ length: size * size }, (_, i) => {
      const key = `${i % size},${Math.floor(i / size)}`;
      return nonBuildable.has(key) ? 0 : 2;
    }),
    idx: (x: number, y: number) => y * size + x,
    inBounds: (x: number, y: number) =>
      x >= 0 && x < size && y >= 0 && y < size,
    isWater: (x: number, y: number) => water.has(`${x},${y}`),
    worldY: (x: number, y: number) =>
      nonFinite.has(`${x},${y}`) ? Number.NaN : 4,
  } as unknown as Terrain;
}

describe("plot/pad placement versus terrain", () => {
  it("rejects the complete footprint when any cell is wet, non-buildable, non-finite, or out of bounds", () => {
    const terrain = terrainFixture({
      water: ["2,1"],
      nonBuildable: ["1,2"],
      nonFinite: ["2,2"],
    });

    expect(
      plotTerrainInvalidCells({ x: 1, y: 1, w: 2, h: 2 }, terrain),
    ).toEqual([
      { key: "2,1", reason: "water" },
      { key: "1,2", reason: "non-buildable" },
      { key: "2,2", reason: "non-finite" },
    ]);
    expect(
      plotClearsBuildableTerrain({ x: 1, y: 1, w: 2, h: 2 }, terrain),
    ).toBe(false);
    expect(
      plotTerrainInvalidCells({ x: -1, y: 0, w: 1, h: 1 }, terrain),
    ).toEqual([{ key: "-1,0", reason: "out-of-bounds" }]);
  });

  it("accepts a fully finite dry and buildable half-open footprint", () => {
    expect(
      plotTerrainInvalidCells({ x: 1, y: 1, w: 2, h: 3 }, terrainFixture()),
    ).toEqual([]);
    expect(
      plotClearsBuildableTerrain({ x: 1, y: 1, w: 2, h: 3 }, terrainFixture()),
    ).toBe(true);
  });

  it("fails the rejected seed-4242 sea site and accepts the corrected dry candidate", () => {
    const terrain = new ColonyRuntime(4242).sim.state.terrain;
    const rejected = plotTerrainInvalidCells(
      { x: 104, y: 234, w: 20, h: 14 },
      terrain,
    );
    const corrected = plotTerrainInvalidCells(
      { x: 127, y: 283, w: 20, h: 14 },
      terrain,
    );

    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.some((cell) => cell.reason === "water")).toBe(true);
    expect(corrected).toEqual([]);
  });
});
