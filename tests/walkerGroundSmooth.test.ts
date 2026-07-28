import { describe, expect, it } from "vitest";
import {
  leveledWorldY,
  leveledWorldYAt,
} from "../src/colony/render/terrainLeveling";

// "Bumpy when I walk over the road." The walker's ground clamp sampled leveledWorldY at the NEAREST
// cell (Math.round), i.e. a 4 m plateau staircase, while the rendered terrain mesh interpolates
// bilinearly between the same cell corners. The walker therefore stepped up/down discontinuously at
// every cell boundary under a visually smooth surface. These lock the continuous contract.

/** 8x8 world with a steep ramp along x — the shape a road cutting/skirt makes beside a road. */
const terrain = { size: 8, worldY: (x: number) => x * 2 };
const level: ReadonlyMap<number, number> | null = null;

/** The OLD behaviour: snap to nearest cell. */
const nearest = (gx: number, gy: number) =>
  leveledWorldY(terrain, level, Math.round(gx), Math.round(gy));

describe("walker ground is continuous, not a per-cell staircase", () => {
  it("agrees with the per-cell value exactly ON cell centres", () => {
    for (let x = 0; x < 8; x++)
      expect(leveledWorldYAt(terrain, level, x, 3)).toBeCloseTo(
        leveledWorldY(terrain, level, x, 3),
        9,
      );
  });

  it("interpolates BETWEEN cells instead of snapping (the fix)", () => {
    // Midway between x=2 (4 m) and x=3 (6 m) the visible mesh is at 5 m.
    expect(leveledWorldYAt(terrain, level, 2.5, 3)).toBeCloseTo(5, 9);
    // The old nearest-cell sampling could not produce 5 — it jumps 4 -> 6.
    expect(nearest(2.5, 3)).not.toBeCloseTo(5, 6);
  });

  it("removes the boundary step a walker felt as a bump", () => {
    // Straddle the x=2/3 cell boundary by a hair. Continuous sampling barely changes; the old
    // nearest-cell sampling jumps a whole cell's height difference (2 m here).
    const eps = 1e-3;
    const smoothJump = Math.abs(
      leveledWorldYAt(terrain, level, 2.5 + eps, 3) -
        leveledWorldYAt(terrain, level, 2.5 - eps, 3),
    );
    const nearestJump = Math.abs(nearest(2.5 + eps, 3) - nearest(2.5 - eps, 3));
    expect(smoothJump).toBeLessThan(0.01);
    expect(nearestJump).toBeGreaterThan(1.5); // the bump the operator walked over
  });

  it("stays continuous across a whole traverse (no step exceeds the local slope)", () => {
    let worst = 0;
    let prev = leveledWorldYAt(terrain, level, 1, 3);
    for (let gx = 1; gx <= 6; gx += 0.05) {
      const h = leveledWorldYAt(terrain, level, gx, 3);
      worst = Math.max(worst, Math.abs(h - prev));
      prev = h;
    }
    // 0.05 cell of a 2 m/cell ramp = 0.1 m; anything larger is a discontinuity.
    expect(worst).toBeLessThan(0.11);
  });

  it("clamps at world edges and stays finite", () => {
    for (const [gx, gy] of [
      [-3, -3],
      [99, 99],
      [0, 0],
      [7.9, 7.9],
    ] as const) {
      expect(Number.isFinite(leveledWorldYAt(terrain, level, gx, gy))).toBe(
        true,
      );
    }
  });

  it("honours leveling overrides through the interpolation", () => {
    const overrides = new Map<number, number>([[3 * 8 + 2, 100]]); // cell (2,3) raised
    expect(leveledWorldYAt(terrain, overrides, 2, 3)).toBeCloseTo(100, 9);
    // A neighbour blends toward it rather than stepping.
    const mid = leveledWorldYAt(terrain, overrides, 2.5, 3);
    expect(mid).toBeGreaterThan(6);
    expect(mid).toBeLessThan(100);
  });
});
