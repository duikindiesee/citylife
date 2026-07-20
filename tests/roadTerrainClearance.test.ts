import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  buildRoadRibbons,
  ribbonCoverage,
} from "../src/colony/render/roadRibbon";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";
import { computeTerrainLeveling } from "../src/colony/render/useTerrainLeveling";
import { leveledWorldY } from "../src/colony/render/terrainLeveling";
import {
  clearanceLayoutOk,
  crossSectionOffsets,
  CLEARANCE_EPSILON_M,
  SAMPLE_RADIUS_CELLS,
  STATION_STEP_CELLS,
  VERTEX_STEP_CELLS,
} from "../src/colony/render/roadClearance";

// Terrain must never rise through a rendered road. The drape puts every VERTEX on the terrain max
// within SAMPLE_RADIUS_CELLS of itself, so vertices were always safe — the bug lived strictly
// BETWEEN them, where a quad is a flat interpolation of its corners. These tests therefore sample
// triangle INTERIORS (centroid + edge midpoints), which is what the old kerb-only cross-section
// failed. See src/colony/render/roadClearance.ts for the invariant.

const SEEDS = [4242, 7, 99, 1234];

interface Violation {
  seed: number;
  gx: number;
  gy: number;
  surfaceY: number;
  groundY: number;
  protrusion: number;
}

/** Every rendered road triangle, as world-space vertex triples. */
function roadTriangles(group: THREE.Group): number[][][] {
  const tris: number[][][] = [];
  group.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const pos = mesh.geometry?.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      tris.push([
        [pos.getX(i), pos.getY(i), pos.getZ(i)],
        [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)],
        [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)],
      ]);
    }
  });
  return tris;
}

/** Build the live world's ribbons and return every point where ground beats the rendered surface.
 *
 *  The ground compared against is the GRADED, RENDERED height (leveledWorldY over the terrain-
 *  leveling map), not raw terrain.worldYAt. That distinction is the whole bug: `computeTerrainLeveling`
 *  grades each road cell up to `getSmoothRoadY` at the CELL CENTRE, while the ribbon renders an
 *  interpolation between its cross-section vertices. Where the cell-centre max beat that surface the
 *  engine literally graded the ground up through the road. Measuring against raw terrain hides it. */
function protrusions(seed: number): Violation[] {
  const rt = new ColonyRuntime(seed);
  const terrain = rt.sim.state.terrain;
  const N = terrain.size;
  const roadY = (x: number, y: number) => getSmoothRoadY(terrain, x, y);
  const { group } = buildRoadRibbons(rt.sim.state.roadWays!, {
    terrain,
    wx: (x: number) => (x - N / 2) * 4,
    wz: (y: number) => (y - N / 2) * 4,
    roadY,
  });
  // The same coverage map and leveling pass the renderer feeds the terrain mesh from.
  const cover = ribbonCoverage(rt.sim.state.roadWays ?? [], terrain, roadY);
  const level = computeTerrainLeveling(rt.sim.state, cover, new Map());
  // Inverse of wx/wz, back to fractional grid coordinates.
  const gridOf = (world: number) => world / 4 + N / 2;
  const out: Violation[] = [];
  for (const t of roadTriangles(group)) {
    const [a, b, c] = t as [number[], number[], number[]];
    // Interior samples: the centroid and the three edge midpoints. A flat triangle interpolates
    // linearly, so these are exactly the points the old geometry could not keep above ground.
    const samples = [
      [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3],
      [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2],
      [(b[0]! + c[0]!) / 2, (b[1]! + c[1]!) / 2, (b[2]! + c[2]!) / 2],
      [(a[0]! + c[0]!) / 2, (a[1]! + c[1]!) / 2, (a[2]! + c[2]!) / 2],
    ];
    for (const s of samples) {
      const gx = gridOf(s[0]!);
      const gy = gridOf(s[2]!);
      // The rendered mesh is per-cell, so resolve the graded height at the cell under the sample.
      const groundY = Math.max(
        0,
        leveledWorldY(terrain, level, Math.round(gx), Math.round(gy)),
      );
      const protrusion = groundY - s[1]!;
      if (protrusion > CLEARANCE_EPSILON_M)
        out.push({ seed, gx, gy, surfaceY: s[1]!, groundY, protrusion });
    }
  }
  return out;
}

describe("road/terrain clearance — the invariant itself", () => {
  it("keeps vertex and station spacing inside the sampler footprint", () => {
    // If either step outruns 2x the sampler radius, ground between vertices stops being covered
    // and protrusion becomes possible again.
    expect(VERTEX_STEP_CELLS / 2).toBeLessThanOrEqual(SAMPLE_RADIUS_CELLS);
    expect(STATION_STEP_CELLS / 2).toBeLessThanOrEqual(SAMPLE_RADIUS_CELLS);
    expect(clearanceLayoutOk()).toBe(true);
    // A layout that outruns the sampler must be rejected, or this guard proves nothing.
    expect(clearanceLayoutOk(0.5, 4.0)).toBe(false);
    expect(clearanceLayoutOk(4.0, 1.0)).toBe(false);
  });

  it("samples the COMPLETE width, not just the two kerbs", () => {
    const half = 1.5; // the shipped ~3-cell carriageway
    const offsets = crossSectionOffsets(half);
    // The old geometry had exactly two vertices per station; the middle of the carriageway — up to
    // ~1.8 cells of ground — was never sampled by either kerb.
    expect(offsets.length).toBeGreaterThan(2);
    expect(offsets[0]).toBe(-half);
    expect(offsets[offsets.length - 1]).toBe(half); // far kerb stays EXACT
    for (let i = 1; i < offsets.length; i++)
      expect(offsets[i]! - offsets[i - 1]!).toBeLessThanOrEqual(
        VERTEX_STEP_CELLS + 1e-9,
      );
  });

  it("keeps both kerbs exact for widths the step does not divide", () => {
    const offsets = crossSectionOffsets(0.7);
    expect(offsets[0]).toBe(-0.7);
    expect(offsets[offsets.length - 1]).toBe(0.7);
    for (let i = 1; i < offsets.length; i++)
      expect(offsets[i]! - offsets[i - 1]!).toBeLessThanOrEqual(
        VERTEX_STEP_CELLS + 1e-9,
      );
  });

  it("degenerates safely at zero width", () => {
    expect(crossSectionOffsets(0)).toEqual([0]);
  });
});

describe("road/terrain clearance — live multi-seed worlds", () => {
  // Real generated worlds carry the cases the brief calls out: slopes and steep grade transitions,
  // diagonals, chaikin curves, junction joins, depot/rally spurs and generated connectors, and the
  // kerb/shoulder vertices at the carriageway edge.
  for (const seed of SEEDS) {
    it(`keeps every rendered road surface above the ground on seed ${seed}`, () => {
      const bad = protrusions(seed);
      const worst = bad.sort((a, b) => b.protrusion - a.protrusion)[0];
      expect(
        worst
          ? `seed ${seed}: ground rises ${worst.protrusion.toFixed(3)} m through the road at grid (${worst.gx.toFixed(2)}, ${worst.gy.toFixed(2)}) — surface ${worst.surfaceY.toFixed(3)} m, ground ${worst.groundY.toFixed(3)} m (${bad.length} sample points affected)`
          : "clear",
      ).toBe("clear");
    });
  }

  it("actually rendered road geometry to inspect (the sweep is not vacuous)", () => {
    const rt = new ColonyRuntime(SEEDS[0]!);
    const terrain = rt.sim.state.terrain;
    const N = terrain.size;
    const { group } = buildRoadRibbons(rt.sim.state.roadWays!, {
      terrain,
      wx: (x: number) => (x - N / 2) * 4,
      wz: (y: number) => (y - N / 2) * 4,
      roadY: (x: number, y: number) => getSmoothRoadY(terrain, x, y),
    });
    expect(roadTriangles(group).length).toBeGreaterThan(500);
  });
});
