import { describe, expect, it } from "vitest";
import { computeVenuePropPlacements } from "../src/colony/render/venueProps";
import type { SeedStructure } from "../src/colony/sim";

const dryTerrain = {
  size: 192,
  inBounds: (x: number, y: number) => x >= 0 && x < 192 && y >= 0 && y < 192,
  isWater: () => false,
  worldY: () => 5.191,
  buildable: new Uint8Array(192 * 192).fill(2),
  idx: (x: number, y: number) => y * 192 + x,
};

describe("night rally venue prop placement", () => {
  it("is deterministic and masks roads occupied cells and the rally footprint", () => {
    const structures: SeedStructure[] = [{ kind: "rally", x: 91, y: 73 }];
    const roadSet = new Set(["93,73", "91,75"]);
    const occupied = new Set(["89,73"]);

    const first = computeVenuePropPlacements({
      terrain: dryTerrain as never,
      structures,
      roadSet,
      occupied,
    });
    const second = computeVenuePropPlacements({
      terrain: dryTerrain as never,
      structures,
      roadSet,
      occupied,
    });

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(4);
    const cells = first.map((p) => `${p.x},${p.y}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells).not.toContain("91,73");
    expect(cells).not.toContain("93,73");
    expect(cells).not.toContain("91,75");
    expect(cells).not.toContain("89,73");
    for (const p of first) {
      expect(
        Math.max(Math.abs(p.x - 91), Math.abs(p.y - 73)),
      ).toBeGreaterThanOrEqual(2);
      expect(
        Math.max(Math.abs(p.x - 91), Math.abs(p.y - 73)),
      ).toBeLessThanOrEqual(5);
    }
  });
});
