// WORLD.FOLIAGE.SCATTER.1 — plants must SCATTER, not march in rows.
//
// THE DEFECT, as the operator saw it: "trees are in lines now ... scattered, not in patterns".
//
// THE CAUSE. `calculateFoliagePositions` selected cells by thresholding `hash(i)` where `i = y*N + x`
// and `hash` was the plain multiplicative `(n * 2654435761) >>> 0`. A multiplicative hash of
// CONSECUTIVE integers is an arithmetic progression mod 2^32, and `i` is consecutive along every row,
// so the threshold picked a periodic set of columns. quiverTreeLogic.ts had already replaced that hash
// for the quiver trees and documented it as unfit — this file was the "elsewhere" its note referred to.
//
// MEASURED on main, 40 rows of a 608-wide grid at the Forest threshold, gaps between neighbouring
// selected cells:
//
//   gap 3 = 57.1%   gap 2 = 30.6%   gap 5 = 12.3%     <- three values, 100% of the world
//
// Three spacings for every plant on the planet is a lattice. The test below fails on that and passes on
// a hash with a real avalanche, WITHOUT pinning any particular random sequence — it asserts the
// STATISTICAL PROPERTY (no small set of gaps dominates), so a future hash change that is still properly
// scattered keeps passing.
import { describe, expect, it } from "vitest";
import { calculateFoliagePositions } from "../src/colony/render/foliageLogic";
import { Biome } from "../src/colony/terrain";
import { COLONY } from "../src/colony/config";

const N = 160;
const LOT_SIZE = 4;

/** A flat, all-Forest, all-dry stand-in for Terrain — the densest biome, so the sample is large. */
function forestTerrain() {
  const size = N * N;
  const elev = new Float32Array(size).fill(COLONY.world.seaLevel + 1);
  const water = new Uint8Array(size);
  const biome = new Uint8Array(size).fill(Biome.Forest);
  return {
    size: N,
    elev,
    water,
    biome,
    worldY: () => 0,
  };
}

/** Cell coordinates of every placed plant, recovered from the instance matrices. */
function placedCells(): { x: number; y: number }[] {
  const { matrices } = calculateFoliagePositions(
    forestTerrain(),
    [],
    [],
    [],
    [],
  );
  // Column-major THREE.Matrix4: translation is elements 12,13,14 → (worldX, worldY, worldZ).
  return matrices.map((m) => ({
    x: Math.round(m[12]! / LOT_SIZE + N / 2),
    y: Math.round(m[14]! / LOT_SIZE + N / 2),
  }));
}

describe("WORLD.FOLIAGE.SCATTER.1 — plants scatter", () => {
  it("does not place plants on a lattice", () => {
    const cells = placedCells();

    // Non-vacuity: an empty world trivially has no lattice. There must be a real stand to judge.
    expect(
      cells.length,
      "the fixture must actually grow plants",
    ).toBeGreaterThan(500);

    // Gaps between neighbouring plants along each row.
    const byRow = new Map<number, number[]>();
    for (const c of cells) {
      const row = byRow.get(c.y) ?? [];
      row.push(c.x);
      byRow.set(c.y, row);
    }
    const gaps = new Map<number, number>();
    let total = 0;
    for (const xs of byRow.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        const g = xs[i]! - xs[i - 1]!;
        if (g <= 0) continue;
        gaps.set(g, (gaps.get(g) ?? 0) + 1);
        total++;
      }
    }
    expect(
      total,
      "there must be enough neighbour pairs to measure",
    ).toBeGreaterThan(300);

    const ranked = [...gaps.entries()].sort((a, b) => b[1] - a[1]);
    const topThreeShare =
      ranked.slice(0, 3).reduce((s, [, c]) => s + c, 0) / total;

    // On main the top THREE gaps were 100% of every spacing in the world. Real scatter spreads across
    // many gap lengths. 0.9 sits far below the lattice (1.00) and far above a healthy geometric tail
    // (~0.72 measured), so it discriminates without pinning an exact distribution.
    expect(
      topThreeShare,
      `top 3 gap lengths cover ${(topThreeShare * 100).toFixed(1)}% of spacings — ` +
        `a lattice, not scatter (ranked: ${ranked
          .slice(0, 4)
          .map(([g, c]) => `${g}x${((100 * c) / total).toFixed(1)}%`)
          .join(", ")})`,
    ).toBeLessThan(0.9);

    // And the world must use MORE than a handful of distinct spacings at all.
    expect(gaps.size, "distinct gap lengths").toBeGreaterThan(5);
  });

  it("clears a rectangle it is told to clear, with a canopy margin", () => {
    const rect = { x0: 40, y0: 40, x1: 48, y1: 48 };
    const { matrices } = calculateFoliagePositions(
      forestTerrain(),
      [],
      [],
      [rect],
      [],
    );
    for (const m of matrices) {
      const x = m[12]! / LOT_SIZE + N / 2;
      const y = m[14]! / LOT_SIZE + N / 2;
      const inside =
        x >= rect.x0 - 1 &&
        x <= rect.x1 + 1 &&
        y >= rect.y0 - 1 &&
        y <= rect.y1 + 1;
      expect(
        inside,
        `plant at ${x.toFixed(1)},${y.toFixed(1)} is inside a cleared rect`,
      ).toBe(false);
    }
  });
});
