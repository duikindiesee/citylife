import { describe, expect, it } from "vitest";

import { resolveGlbHouseScale } from "../src/colony/render/glbHouseScale";

describe("resolveGlbHouseScale", () => {
  it("uses a uniform footprint fit instead of the manifest fallback when lot dimensions are provided", () => {
    const scale = resolveGlbHouseScale({
      manifestScale: [1, 1, 1],
      modelSize: { x: 4, y: 3, z: 8 },
      footprint: { w: 3, d: 5 },
    });

    expect(scale).toEqual([2.5, 2.5, 2.5]);
  });

  it("keeps the manifest scale when no footprint is provided", () => {
    const scale = resolveGlbHouseScale({
      manifestScale: [1.2, 0.9, 1.4],
      modelSize: { x: 4, y: 3, z: 8 },
    });

    expect(scale).toEqual([1.2, 0.9, 1.4]);
  });

  it("falls back to the manifest scale when a model bound is not measurable", () => {
    const scale = resolveGlbHouseScale({
      manifestScale: [1, 1, 1],
      modelSize: { x: 0, y: 3, z: 8 },
      footprint: { w: 3, d: 5 },
    });

    expect(scale).toEqual([1, 1, 1]);
  });
});
