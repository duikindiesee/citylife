// Spec 129 — house proportions. The legacy renderer meshes houses in a 1-unit-per-cell
// world (cell: 1, voxelY: 0.22); the R3F world is 4 units per cell. The port scaled the
// footprint but not the height, so houses rendered 4x wider than tall — knee-high pancakes
// the walker stepped over. The contract: the R3F mesh must have EXACTLY legacy's
// height:width ratio, at 4x the world size.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { compileBlueprint, VOXEL_Y } from "../src/colony/houseBuilder";
import { greedyMesh } from "../src/colony/render/voxelMesh";
import { defaultBlueprint } from "../src/colony/neighborhood";

const LOT_SIZE = 4;

function bboxOf(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  return {
    w: bb.max.x - bb.min.x,
    h: bb.max.y - bb.min.y,
    d: bb.max.z - bb.min.z,
  };
}

describe("spec 129 — voxel house scale", () => {
  const zone = { w: 5, d: 6 };
  const seed = 4242;
  const script = defaultBlueprint(seed, "s", zone.w);
  const compiled = compileBlueprint(script, { w: zone.w, d: zone.d, seed });

  it("matches legacy proportions at 4x world scale", () => {
    const legacy = bboxOf(
      greedyMesh(compiled.blocks, { n: compiled.n, cell: 1, voxelY: VOXEL_Y }).geometry,
    );
    const r3f = bboxOf(
      greedyMesh(compiled.blocks, {
        n: compiled.n,
        cell: LOT_SIZE,
        voxelY: VOXEL_Y * LOT_SIZE,
      }).geometry,
    );
    // exactly 4x legacy in every axis — same shape, world-sized
    expect(r3f.w).toBeCloseTo(legacy.w * LOT_SIZE, 4);
    expect(r3f.h).toBeCloseTo(legacy.h * LOT_SIZE, 4);
    expect(r3f.d).toBeCloseTo(legacy.d * LOT_SIZE, 4);
  });

  it("a house is TALLER than the first-person walker, not a knee-high pancake", () => {
    const r3f = bboxOf(
      greedyMesh(compiled.blocks, {
        n: compiled.n,
        cell: LOT_SIZE,
        voxelY: VOXEL_Y * LOT_SIZE,
      }).geometry,
    );
    expect(r3f.h).toBeGreaterThan(3); // a single storey alone is ~5.3 units
    // and the footprint stays on the house zone (w plan-cells at 4 units)
    expect(r3f.w).toBeLessThanOrEqual(zone.w * LOT_SIZE + 0.01);
  });

  it("the OLD params were the pancake (regression guard)", () => {
    const broken = bboxOf(
      greedyMesh(compiled.blocks, { n: compiled.n, cell: LOT_SIZE, voxelY: VOXEL_Y }).geometry,
    );
    const fixed = bboxOf(
      greedyMesh(compiled.blocks, {
        n: compiled.n,
        cell: LOT_SIZE,
        voxelY: VOXEL_Y * LOT_SIZE,
      }).geometry,
    );
    // the bug: full-width footprint at a QUARTER of the height — same width, 1/4 tall
    expect(broken.w).toBeCloseTo(fixed.w, 4);
    expect(broken.h).toBeCloseTo(fixed.h / LOT_SIZE, 4);
  });
});
