// Spec 169 §1 — the Long Beach field's constitutional properties (WORLD.LONGBEACH.1 slice 1).
//
// These are the promises the whole region design leans on, each asserted independently:
//   - the WEST EDGE is ocean on every row (a west coast is a direction);
//   - PLAINS IS GUARANTEED — the seed-314 lesson: the island's moisture split produced a desert with
//     no dune flat on one seed in five, so Long Beach bands by coast distance and the sand flat must
//     exist on EVERY seed, 314 included, by construction;
//   - reaches APPEND: building 2 reaches reproduces reach 1's rows byte-identically, because every
//     sample is a pure function of (seed, x, yGlobal) — this is what makes expansion save-safe;
//   - the dry-wash arroyos exist and are water-flagged (that flag is what makes bridges span them).
import { describe, expect, it } from "vitest";
import {
  LB_BIOME,
  LB_REACH,
  LB_WIDTH,
  buildLongBeachField,
  coastlineX,
  LB_COAST_AMP,
  LB_COAST_MEAN_X,
} from "../src/colony/longbeach/longBeachField";

/** Element-exact Float32Array equality (Buffer is not in this tsconfig lib set). */
function f32Identical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe("WORLD.LONGBEACH.1 — the strip's constitutional properties", () => {
  it("keeps the whole west edge under water on every row", () => {
    const f = buildLongBeachField(1);
    for (let y = 0; y < f.height; y++) {
      for (const x of [0, 40, 90]) {
        expect(f.water[f.idx(x, y)], `(${x},${y}) must be sea`).toBe(1);
      }
    }
  });

  it("meanders the coast inside its stated amplitude", () => {
    for (let y = 0; y < LB_REACH; y += 7) {
      const c = coastlineX(1, y);
      expect(c).toBeGreaterThanOrEqual(LB_COAST_MEAN_X - LB_COAST_AMP);
      expect(c).toBeLessThanOrEqual(LB_COAST_MEAN_X + LB_COAST_AMP);
    }
  });

  it("guarantees the sand flat on EVERY seed — including 314, the island's no-Plains seed", () => {
    for (const seed of [1, 314, 4242]) {
      const f = buildLongBeachField(seed);
      let plains = 0;
      for (let i = 0; i < f.biome.length; i++)
        if (f.biome[i] === LB_BIOME.Plains) plains++;
      // The flat band alone is ~236 columns × 512 rows minus forest pockets and washes; 40,000 is a
      // conservative floor that still fails hard if banding ever regresses to a moisture split.
      expect(plains, `seed ${seed} plains cells`).toBeGreaterThan(40_000);
    }
  });

  it("orders the bands west to east: sea, beach, then dry land", () => {
    const f = buildLongBeachField(1);
    for (let y = 20; y < LB_REACH; y += 50) {
      const coast = Math.ceil(f.coastlineAt(y));
      // First dry cell east of the shoreline is Beach.
      let x = coast;
      while (x < LB_WIDTH && f.water[f.idx(x, y)] === 1) x++;
      expect(f.biome[f.idx(x, y)], `row ${y} first dry cell`).toBe(
        LB_BIOME.Beach,
      );
    }
  });

  it("raises the rock wall on the east edge", () => {
    const f = buildLongBeachField(1);
    let mountain = 0;
    let rows = 0;
    for (let y = 0; y < f.height; y += 5) {
      rows++;
      if (f.biome[f.idx(1000, y)] === LB_BIOME.Mountain) mountain++;
    }
    expect(mountain / rows).toBeGreaterThan(0.9);
  });

  it("carves water-flagged arroyos into the flat", () => {
    const f = buildLongBeachField(1);
    let washCells = 0;
    for (let y = 0; y < f.height; y++) {
      const coast = f.coastlineAt(y);
      for (let x = Math.ceil(coast + 30); x < 600; x += 3) {
        if (f.water[f.idx(x, y)] === 1) washCells++;
      }
    }
    expect(washCells, "dry-wash cells east of the beach").toBeGreaterThan(150);
  });

  it("is deterministic: two builds are byte-identical", () => {
    const a = buildLongBeachField(7);
    const b = buildLongBeachField(7);
    expect(f32Identical(a.elev, b.elev)).toBe(true);
    expect(a.water).toEqual(b.water);
    expect(a.biome).toEqual(b.biome);
  });

  it("appends reaches without touching reach 1 — the save-safety property", () => {
    const one = buildLongBeachField(1, 1);
    const two = buildLongBeachField(1, 2);
    const n = LB_WIDTH * LB_REACH;
    expect(two.height).toBe(LB_REACH * 2);
    expect(
      f32Identical(two.elev.subarray(0, n), one.elev.subarray(0, n)),
      "reach 1 elevation must be byte-identical under expansion",
    ).toBe(true);
    expect(two.water.slice(0, n)).toEqual(one.water.slice(0, n));
    expect(two.biome.slice(0, n)).toEqual(one.biome.slice(0, n));
  });
});
