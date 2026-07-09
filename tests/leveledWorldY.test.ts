// Spec 134 — the leveled ground lookup: override wins, raw terrain otherwise. The walker's
// guardrail and spawn read THIS surface (the one the physics collider carries), never raw
// worldY — the road grading cuts and fills, so raw can sit metres away from the floor.
import { describe, it, expect } from "vitest";
import { leveledWorldY } from "../src/colony/render/useTerrainLeveling";

describe("spec 134 — leveledWorldY", () => {
  const terrain = { size: 10, worldY: (x: number, y: number) => x + y };

  it("returns the override where the leveling reshaped the ground", () => {
    const lvl = new Map<number, number>([[3 * 10 + 2, 7.5]]);
    expect(leveledWorldY(lvl, terrain, 2, 3)).toBe(7.5);
  });

  it("falls back to raw terrain where no override exists", () => {
    const lvl = new Map<number, number>([[0, 9]]);
    expect(leveledWorldY(lvl, terrain, 2, 3)).toBe(5);
    expect(leveledWorldY(null, terrain, 4, 4)).toBe(8);
    expect(leveledWorldY(undefined, terrain, 1, 1)).toBe(2);
  });

  it("a zero-height override is honoured (falsy but real — a cut to sea level)", () => {
    const lvl = new Map<number, number>([[3 * 10 + 2, 0]]);
    expect(leveledWorldY(lvl, terrain, 2, 3)).toBe(0);
  });
});
