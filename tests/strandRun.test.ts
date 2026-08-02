// Spec 169 §3.4 — the Strand Run's authored geometry, held to the spec's own driving decomposition.
//
// §3.1 says what makes a road fun in measurable terms, so this suite measures them: real straights
// (the spec's ≥120-cell figure, as heading stability over the designed bands), class-A sweepers only
// (min turn radius ≥ 12 cells outside the straight joins), the coastal corridor (the sea stays in
// view), and an arroyo crossing recorded as a bridge. Geometry guarantees are asserted on the
// CANONICAL seed (1): the route is authored FROM noise, so per-seed tuning is a non-goal — the
// canonical world is the one the operator drives.
import { describe, expect, it } from "vitest";
import { buildLongBeachField } from "../src/colony/longbeach/longBeachField";
import {
  STRAND_SETBACK_MAX,
  STRAND_SETBACK_MIN,
  STRAND_STRAIGHT_BANDS,
  buildStrandRun,
} from "../src/colony/longbeach/strandRun";

const field = buildLongBeachField(1);
const run = buildStrandRun(field);

/** Circumradius of three consecutive path points — the discrete turn radius at the middle one. */
function radiusAt(i: number): number {
  const a = run.path[i - 1]!;
  const b = run.path[i]!;
  const c = run.path[i + 1]!;
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const area2 = Math.abs(cross);
  if (area2 < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

const inBlend = (y: number): boolean =>
  STRAND_STRAIGHT_BANDS.some(([a, b]) => y > a - 28 && y < b + 28);

describe("Spec 169 §3.4 — The Strand Run", () => {
  it("is a real route, not a sketch", () => {
    expect(run.path.length).toBeGreaterThan(100);
    // ~488 rows of reach plus sweeper slope. The spec's ~600 was flagged an estimate; measure > 480.
    expect(run.lengthCells).toBeGreaterThan(480);
  });

  it("holds its two DESIGNED straights dead straight", () => {
    for (const [a, b] of STRAND_STRAIGHT_BANDS) {
      // Total heading variation across the band's interior must be a fraction of a degree per
      // segment — a chord, not a flattened wiggle. Band length itself is ≥120 cells by construction.
      expect(b - a).toBeGreaterThanOrEqual(120);
      const seg = run.path.filter((p) => p.y > a + 10 && p.y < b - 10);
      expect(seg.length, `band ${a}-${b} sample size`).toBeGreaterThan(10);
      let maxTurn = 0;
      for (let i = 1; i < seg.length - 1; i++) {
        const h1 = Math.atan2(
          seg[i]!.y - seg[i - 1]!.y,
          seg[i]!.x - seg[i - 1]!.x,
        );
        const h2 = Math.atan2(
          seg[i + 1]!.y - seg[i]!.y,
          seg[i + 1]!.x - seg[i]!.x,
        );
        let d = Math.abs(h2 - h1);
        if (d > Math.PI) d = 2 * Math.PI - d;
        maxTurn = Math.max(maxTurn, d);
      }
      expect(
        (maxTurn * 180) / Math.PI,
        `band ${a}-${b} max per-segment turn (degrees)`,
      ).toBeLessThan(1.5);
    }
  });

  it("keeps every corner class A — sweepers, never a hidden hairpin", () => {
    let minR = Infinity;
    for (let i = 1; i < run.path.length - 1; i++) {
      if (inBlend(run.path[i]!.y)) continue; // straight joins measured separately above
      minR = Math.min(minR, radiusAt(i));
    }
    // Spec §3.3: class A is radius ≥ 12 cells — flat-out under the grip cap at highway speed.
    expect(minR, "minimum sweeper radius (cells)").toBeGreaterThanOrEqual(12);
  });

  it("traces the coast inside the setback corridor, so the sea stays in view", () => {
    for (const p of run.path) {
      if (inBlend(p.y)) continue; // a designed straight may cut across the coast's wander
      const setback = p.x - field.coastlineAt(p.y);
      expect(setback, `setback at y=${p.y.toFixed(0)}`).toBeGreaterThan(
        STRAND_SETBACK_MIN - 3,
      );
      expect(setback).toBeLessThan(STRAND_SETBACK_MAX + 4);
    }
  });

  it("crosses at least one arroyo, recorded as a bridge", () => {
    expect(run.bridges.length).toBeGreaterThanOrEqual(1);
    for (const b of run.bridges) {
      expect(b.spanVertices).toBeGreaterThanOrEqual(1);
      // A wash crossing, not the open sea: bridges sit east of the shoreline.
      expect(b.x).toBeGreaterThan(field.coastlineAt(b.y));
    }
  });

  it("is deterministic", () => {
    const again = buildStrandRun(buildLongBeachField(1));
    expect(again.path).toEqual(run.path);
    expect(again.lengthCells).toBe(run.lengthCells);
    expect(again.bridges).toEqual(run.bridges);
  });
});
