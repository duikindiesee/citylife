import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { CELL_SIZE } from "../src/colony/scale";
import type { Parcel } from "../src/colony/neighborhood";
import { parcelFencePlacements } from "../src/colony/render/parcelFencePlacement";
import { forSaleBoardPlacement } from "../src/colony/render/forSaleBoardPlacement";
import { garageFootprintInside, starterGaragePlacement } from "../src/colony/render/starterGaragePlacement";
import { FLAT_GROUND, type GroundAt } from "../src/colony/render/kitGround";

const closeTo = (actual: number, expected: number, tolerance = 0.001) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

function fenceBounds(parcel: Parcel) {
  const ring = [...parcel.fence, parcel.gate];
  return {
    minX: Math.min(...ring.map((c) => c.x)) - 0.5,
    maxX: Math.max(...ring.map((c) => c.x)) + 0.5,
    minY: Math.min(...ring.map((c) => c.y)) - 0.5,
    maxY: Math.max(...ring.map((c) => c.y)) + 0.5,
  };
}

describe("homestead kit follows rendered ground", () => {
  const runtime = new ColonyRuntime(42);
  const parcels = runtime.lots().filter((parcel) => parcel.fenceType === "fence");
  const size = runtime.sim.state.terrain.size;
  const roadKind = runtime.sim.state.roadKind;
  const planes: GroundAt[] = [
    (gx, gy) => 10 + (gx * 0.03 + gy * 0.06) * CELL_SIZE,
    (gx, gy) => 10 + gy * 0.12 * CELL_SIZE,
  ];

  it("seats posts, stepped panels, gates, garages and sale signs on grade", () => {
    expect(parcels.length).toBeGreaterThan(0);
    for (const parcel of parcels) for (const groundAt of planes) {
      const placements = parcelFencePlacements(parcel, size, groundAt);
      const posts = placements.filter((p) => p.piece.startsWith("post"));
      const panels = placements.filter((p) => p.piece === "panel");
      const gate = placements.find((p) => p.piece === "gate-driveway")!;
      for (const post of posts) {
        const gx = post.position[0] / CELL_SIZE + size / 2;
        const gy = post.position[2] / CELL_SIZE + size / 2;
        closeTo(post.position[1], groundAt(gx, gy));
      }
      for (const panel of panels) {
        const horizontal = Math.abs(Math.sin(panel.rotationY)) < 1e-6;
        const length = panel.length ?? 0;
        let maxGap = 0;
        for (let i = 0; i < 5; i++) {
          const t = i / 4;
          const x = panel.position[0] + (horizontal ? (t - 0.5) * length : 0);
          const z = panel.position[2] + (horizontal ? 0 : (t - 0.5) * length);
          const gx = x / CELL_SIZE + size / 2;
          const gy = z / CELL_SIZE + size / 2;
          const gap = panel.position[1] - groundAt(gx, gy);
          expect(gap).toBeGreaterThanOrEqual(-0.001);
          maxGap = Math.max(maxGap, gap);
        }
        closeTo(panel.bottomGapMax ?? 0, maxGap, 0.002);
        if (groundAt === planes[0]) expect(panel.bottomGapMax ?? 0).toBeLessThanOrEqual(0.3);
      }
      const frontY = parcel.gate.y + (parcel.side === 1 ? -0.5 : 0.5);
      closeTo(gate.position[1], groundAt(parcel.gate.x, frontY));

      const garage = starterGaragePlacement(parcel, size, groundAt);
      const doorCell = parcel.driveway.at(-1) ?? parcel.gate;
      closeTo(garage.garageFloorY, groundAt(doorCell.x, doorCell.y));
      closeTo(garage.position[1], garage.garageFloorY);

      const board = forSaleBoardPlacement(parcel, size, groundAt);
      closeTo(board.position[1], groundAt(board.gx, board.gy));
      for (const post of board.posts) {
        const gx=post.position[0]/CELL_SIZE+size/2,gy=post.position[2]/CELL_SIZE+size/2;
        closeTo(post.position[1],groundAt(gx,gy));
      }
      const streetSign = parcel.side === 1 ? -1 : 1;
      const fenceFront = parcel.gate.y + (parcel.side === 1 ? -0.5 : 0.5);
      const streetDistance = (board.gy - fenceFront) * CELL_SIZE * streetSign;
      expect(streetDistance).toBeGreaterThanOrEqual(0.5);
      expect(streetDistance).toBeLessThanOrEqual(2);
      const drivewayCells = new Set(parcel.driveway.map((c) => `${c.x},${c.y}`));
      expect(drivewayCells.has(`${Math.round(board.gx)},${Math.round(board.gy)}`)).toBe(false);
      expect(roadKind.has(`${Math.round(board.gx)},${Math.round(board.gy)}`)).toBe(false);
      expect(Math.abs(board.gx - parcel.gate.x) * CELL_SIZE).toBeGreaterThanOrEqual(2.45);
      const bounds = fenceBounds(parcel);
      expect(board.gx < bounds.minX || board.gx > bounds.maxX || board.gy < bounds.minY || board.gy > bounds.maxY).toBe(true);
      const oldInside = { gx: parcel.gate.x, gy: parcel.gate.y };
      expect(oldInside.gx >= bounds.minX && oldInside.gx <= bounds.maxX && oldInside.gy >= bounds.minY && oldInside.gy <= bounds.maxY).toBe(true);
    }
  });

  it("keeps every kit y at zero on flat ground", () => {
    for (const parcel of parcels) {
      const fence = parcelFencePlacements(parcel, size, FLAT_GROUND);
      for (const item of fence) closeTo(item.position[1], 0);
      const garage = starterGaragePlacement(parcel, size, FLAT_GROUND);
      closeTo(garage.garageFloorY, 0);
      closeTo(garage.position[1], 0);
      closeTo(forSaleBoardPlacement(parcel, size, FLAT_GROUND).position[1], 0);
      expect(garageFootprintInside(parcel, garage, size)).toBe(true);
    }
  });
});
