import { describe, expect, it } from "vitest";
import { applyCoastalCommercialDryBlend } from "../src/colony/render/terrainLeveling";

class FakeTerrain {
  constructor(private readonly heights: Map<string, number>) {}
  worldY(x: number, y: number): number {
    return this.heights.get(`${x},${y}`) ?? 1.1;
  }
}

function get(next: Map<number, number>, n: number, x: number, y: number): number | undefined {
  return next.get(y * n + x);
}

describe("coastal commercial terrain leveling", () => {
  it("dries the shop seat and blends seaward cliff cells instead of leaving a sheer face", () => {
    const n = 40;
    const heights = new Map<string, number>();
    for (let y = 8; y <= 15; y++) {
      for (let x = 4; x <= 15; x++) {
        // Steep coastal frontage: the shop pad is low dry land, but the seaward edge falls into water.
        heights.set(`${x},${y}`, x < 10 ? -0.35 : 0.04);
      }
    }
    const next = new Map<number, number>();

    applyCoastalCommercialDryBlend({
      next,
      n,
      terrain: new FakeTerrain(heights),
      rects: [{ x: 10, y: 10, w: 4, h: 4 }],
      roadRibbonCells: new Set<string>(),
      dry: 0.65,
    });

    expect(get(next, n, 10, 12)).toBe(0.65);
    const apron1 = get(next, n, 9, 12)!;
    const apron4 = get(next, n, 6, 12)!;
    expect(apron1).toBeGreaterThan(0.45);
    expect(apron1).toBeLessThanOrEqual(0.65);
    expect(Math.abs(apron1 - get(next, n, 10, 12)!)).toBeLessThanOrEqual(0.2);
    expect(apron4).toBeGreaterThan(-0.35);
    expect(apron4).toBeLessThan(apron1);
    const apron7 = get(next, n, 4, 12)!;
    expect(apron7).toBeGreaterThan(-0.35);
    expect(apron7).toBeLessThan(apron4);
    expect(get(next, n, 0, 12)).toBeUndefined();
  });

  it("does not disturb road ribbon cells or inland high ground", () => {
    const n = 40;
    const heights = new Map<string, number>();
    for (let y = 8; y <= 15; y++)
      for (let x = 6; x <= 15; x++) heights.set(`${x},${y}`, x < 10 ? 1.2 : 0.04);
    const next = new Map<number, number>();

    applyCoastalCommercialDryBlend({
      next,
      n,
      terrain: new FakeTerrain(heights),
      rects: [{ x: 10, y: 10, w: 4, h: 4 }],
      roadRibbonCells: new Set<string>(["11,12"]),
      dry: 0.65,
    });

    expect(get(next, n, 11, 12)).toBeUndefined();
    expect(get(next, n, 9, 12)).toBeUndefined();
    expect(get(next, n, 8, 12)).toBeUndefined();
  });
});
