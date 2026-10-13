import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  buildRoadRibbons,
  ribbonCoverage,
} from "../src/colony/render/roadRibbon";
import { getSmoothRoadY } from "../src/colony/render/roadSurface";
import { findJunctionZones } from "../src/colony/render/roadJunctions";
import {
  attachCapPolys,
  buildJunctionCaps,
  capCoverageCells,
} from "../src/colony/render/junctionCap";
import { computeTerrainLeveling } from "../src/colony/render/useTerrainLeveling";
import { leveledWorldY } from "../src/colony/render/terrainLeveling";
import type { Terrain } from "../src/colony/terrain";
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

/** Compute actual terrain surface height faithful to buildChunkedTerrain and terrainChunks indexed triangles. */
function triangulatedGroundY(
  terrain: Terrain,
  level: Map<number, number>,
  gx: number,
  gy: number,
): number {
  const n = terrain.size;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  const x0 = clamp(Math.floor(gx));
  const y0 = clamp(Math.floor(gy));
  const x1 = clamp(x0 + 1);
  const y1 = clamp(y0 + 1);
  const u = Math.max(0, Math.min(1, gx - x0));
  const v = Math.max(0, Math.min(1, gy - y0));
  const h00 = leveledWorldY(terrain, level, x0, y0);
  const h10 = leveledWorldY(terrain, level, x1, y0);
  const h01 = leveledWorldY(terrain, level, x0, y1);
  const h11 = leveledWorldY(terrain, level, x1, y1);
  if (u + v <= 1) {
    // Triangle (a, c, b) matching buildChunkedTerrain / terrainChunks
    return h00 * (1 - u - v) + h01 * v + h10 * u;
  }
  // Triangle (b, c, e) matching buildChunkedTerrain / terrainChunks
  return h11 * (u + v - 1) + h10 * (1 - v) + h01 * (1 - u);
}

function buildLiveRoadScene(seed: number) {
  const rt = new ColonyRuntime(seed);
  const terrain = rt.sim.state.terrain;
  const N = terrain.size;
  const roadY = (x: number, y: number) => getSmoothRoadY(terrain, x, y);
  const wx = (x: number) => (x - N / 2) * 4;
  const wz = (y: number) => (y - N / 2) * 4;
  const opts = { terrain, wx, wz, roadY };
  const ways = rt.sim.state.roadWays ?? [];
  const publicWays = ways.filter((way) => way.source !== "depot-spur");
  // Match R3FRoadRibbons: ribbon zones exclude depot spur
  const ribbonZones = attachCapPolys(findJunctionZones(publicWays));
  const { group } = buildRoadRibbons(ways, opts, ribbonZones);
  const caps = buildJunctionCaps(ribbonZones, opts);
  if (caps.surf.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(caps.surf, 3),
    );
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
  }
  const cover = ribbonCoverage(ways, terrain, roadY);
  // Match R3FPlanetRenderer: capCover uses all ways
  const rendererCapZones = attachCapPolys(findJunctionZones(ways));
  const capCover = capCoverageCells(rendererCapZones, terrain, roadY);
  for (const [k, h] of capCover) {
    const cur = cover.get(k);
    if (cur === undefined || h > cur) cover.set(k, h);
  }
  const level = computeTerrainLeveling(rt.sim.state, cover, new Map());
  return {
    rt,
    terrain,
    group,
    level,
    gridOf: (world: number) => world / 4 + N / 2,
  };
}

/** Build the live world's ribbons and return every point where ground beats the rendered surface.
 *
 *  The ground compared against is the GRADED, RENDERED height sampled across the actual
 *  piecewise indexed triangles constructed by buildChunkedTerrain / terrainChunks. */
function protrusions(
  seed: number,
  levelOverride?: Map<number, number>,
): Violation[] {
  const { terrain, group, level: defaultLevel, gridOf } = buildLiveRoadScene(seed);
  const level = levelOverride ?? defaultLevel;
  const out: Violation[] = [];
  let sampleCount = 0;
  for (const t of roadTriangles(group)) {
    const [a, b, c] = t as [number[], number[], number[]];
    // Interior samples: the centroid and the three edge midpoints.
    const samples = [
      [
        (a[0]! + b[0]! + c[0]!) / 3,
        (a[1]! + b[1]! + c[1]!) / 3,
        (a[2]! + b[2]! + c[2]!) / 3,
      ],
      [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2],
      [(b[0]! + c[0]!) / 2, (b[1]! + c[1]!) / 2, (b[2]! + c[2]!) / 2],
      [(a[0]! + c[0]!) / 2, (a[1]! + c[1]!) / 2, (a[2]! + c[2]!) / 2],
    ];
    for (const s of samples) {
      const gx = gridOf(s[0]!);
      const gy = gridOf(s[2]!);
      const groundY = triangulatedGroundY(terrain, level, gx, gy);
      if (
        !Number.isFinite(s[0]) ||
        !Number.isFinite(s[1]) ||
        !Number.isFinite(s[2]) ||
        !Number.isFinite(gx) ||
        !Number.isFinite(gy) ||
        !Number.isFinite(groundY)
      ) {
        throw new Error(
          `Non-finite road or ground coordinate encountered at sample (${s[0]}, ${s[1]}, ${s[2]}), grid (${gx}, ${gy}), groundY ${groundY}`,
        );
      }
      sampleCount++;
      const protrusion = groundY - s[1]!;
      if (protrusion > CLEARANCE_EPSILON_M)
        out.push({ seed, gx, gy, surfaceY: s[1]!, groundY, protrusion });
    }
  }
  expect(sampleCount).toBeGreaterThan(0);
  expect(Number.isFinite(sampleCount)).toBe(true);
  return out;
}

function findRoadSample(
  group: THREE.Group,
  gridOf: (world: number) => number,
  targetGx: number,
  targetGy: number,
  eps = 1e-4,
): { gx: number; gy: number; surfaceY: number } | null {
  for (const t of roadTriangles(group)) {
    const [a, b, c] = t as [number[], number[], number[]];
    const samples = [
      [
        (a[0]! + b[0]! + c[0]!) / 3,
        (a[1]! + b[1]! + c[1]!) / 3,
        (a[2]! + b[2]! + c[2]!) / 3,
      ],
      [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2],
      [(b[0]! + c[0]!) / 2, (b[1]! + c[1]!) / 2, (b[2]! + c[2]!) / 2],
      [(a[0]! + c[0]!) / 2, (a[1]! + c[1]!) / 2, (a[2]! + c[2]!) / 2],
    ];
    for (const s of samples) {
      const gx = gridOf(s[0]!);
      const gy = gridOf(s[2]!);
      if (Math.abs(gx - targetGx) < eps && Math.abs(gy - targetGy) < eps) {
        return { gx, gy, surfaceY: s[1]! };
      }
    }
  }
  return null;
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

  it("actually rendered road geometry to inspect (the sweep is not vacuous and samples are finite)", () => {
    const { group } = buildLiveRoadScene(SEEDS[0]!);
    const tris = roadTriangles(group);
    expect(tris.length).toBeGreaterThan(500);
    const sampleCount = tris.length * 4;
    expect(Number.isFinite(sampleCount)).toBe(true);
    expect(sampleCount).toBeGreaterThan(2000);
  });

  it("keeps target road at grid (514.40, 198.50) strictly above triangulated ground on seed 4242", () => {
    const { terrain, level, gridOf, group } = buildLiveRoadScene(4242);
    // Preserved coordinates from diagnostic probe artifact
    const targetGx = 514.3972473144531;
    const targetGy = 198.50392150878906;
    const expectedRoadSurfaceY = 4.929289817810059;
    const expectedGroundY = 4.434311177879542;

    const sample = findRoadSample(group, gridOf, targetGx, targetGy);
    expect(sample).not.toBeNull();
    expect(sample!.surfaceY).toBeCloseTo(expectedRoadSurfaceY, 3);

    const groundY = triangulatedGroundY(terrain, level, sample!.gx, sample!.gy);
    expect(groundY).toBeCloseTo(expectedGroundY, 3);
    const clearance = sample!.surfaceY - groundY;
    expect(clearance).toBeCloseTo(0.495, 3);
    expect(clearance).toBeGreaterThan(CLEARANCE_EPSILON_M);
  });

  it("confirms positive clearance on valid clear control", () => {
    const { terrain, level, gridOf, group } = buildLiveRoadScene(4242);
    // Preserved coordinates from diagnostic probe artifact
    const ctrlGx = 385.4760030110677;
    const ctrlGy = 319.8749723434448;
    const expectedRoadSurfaceY = 16.964541753133137;
    const expectedGroundY = 16.653484785920693;

    const sample = findRoadSample(group, gridOf, ctrlGx, ctrlGy);
    expect(sample).not.toBeNull();
    expect(sample!.surfaceY).toBeCloseTo(expectedRoadSurfaceY, 3);

    const groundY = triangulatedGroundY(terrain, level, sample!.gx, sample!.gy);
    expect(groundY).toBeCloseTo(expectedGroundY, 3);
    const clearance = sample!.surfaceY - groundY;
    expect(clearance).toBeCloseTo(0.311, 3);
    expect(clearance).toBeGreaterThan(CLEARANCE_EPSILON_M);
  });

  it("detects an artificial ground protrusion on an injected raised cell (negative control)", () => {
    const { terrain, level, gridOf, group } = buildLiveRoadScene(4242);
    // Road sample near cell [384, 322]
    let sample: { gx: number; gy: number; surfaceY: number } | null = null;
    let minD2 = Infinity;
    for (const t of roadTriangles(group)) {
      const [a, b, c] = t as [number[], number[], number[]];
      const centroid = [
        (a[0]! + b[0]! + c[0]!) / 3,
        (a[1]! + b[1]! + c[1]!) / 3,
        (a[2]! + b[2]! + c[2]!) / 3,
      ];
      const gx = gridOf(centroid[0]!);
      const gy = gridOf(centroid[2]!);
      const d2 = (gx - 384.81) ** 2 + (gy - 322.24) ** 2;
      if (d2 < minD2) {
        minD2 = d2;
        sample = { gx, gy, surfaceY: centroid[1]! };
      }
    }
    expect(sample).not.toBeNull();
    expect(minD2).toBeLessThan(1.0);

    const cellX = Math.floor(sample!.gx);
    const cellY = Math.floor(sample!.gy);
    const N = terrain.size;
    const raisedHeight = sample!.surfaceY + 2.50;

    const modifiedLevel = new Map(level);
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        modifiedLevel.set((cellY + dy) * N + (cellX + dx), raisedHeight);
      }
    }

    const raisedGroundAtSample = triangulatedGroundY(
      terrain,
      modifiedLevel,
      sample!.gx,
      sample!.gy,
    );
    expect(raisedGroundAtSample).toBeCloseTo(raisedHeight, 3);
    const protrusionAtSample = raisedGroundAtSample - sample!.surfaceY;
    expect(protrusionAtSample).toBeCloseTo(2.50, 2);

    const bad = protrusions(4242, modifiedLevel);
    expect(bad.length).toBeGreaterThan(0);
    const exactViolation = bad.find(
      (v) =>
        Math.abs(v.gx - sample!.gx) < 1e-4 &&
        Math.abs(v.gy - sample!.gy) < 1e-4,
    );
    expect(exactViolation).toBeDefined();
    expect(exactViolation!.protrusion).toBeCloseTo(2.50, 2);
    expect(exactViolation!.protrusion).toBeGreaterThan(CLEARANCE_EPSILON_M);
    expect(exactViolation!.protrusion).toBeGreaterThan(2.0);
  });
});
