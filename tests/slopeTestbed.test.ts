import { describe, expect, it } from "vitest";
import { pickSlopeFixture } from "../src/colony/testbed/slopeFixtures";
import { housePoseForParcel } from "../src/colony/render/housePlacement";
import { parcelFencePlacements } from "../src/colony/render/parcelFencePlacement";
import { forSaleBoardPlacement } from "../src/colony/render/forSaleBoardPlacement";
import { starterGaragePlacement } from "../src/colony/render/starterGaragePlacement";
import { parcelStreetDirection } from "../src/colony/parcelGeometry";
import { SLOPE_LIMITS } from "../src/colony/slope/plotGrading";
import { CELL_SIZE } from "../src/colony/scale";

const cases = [
  ["downhill", "steep-downhill"],
  ["uphill", "steep-uphill"],
  ["gentle", "gentle"],
] as const;

describe("sloped fence and garage testbed fixtures", () => {
  it.each(cases)("places the %s fixture on valid graded ground", (kind, expectedBand) => {
    const fixture = pickSlopeFixture(kind);
    const { parcel, grading, groundAt, mapSize } = fixture;
    expect(grading.band).toBe(expectedBand);
    expect(grading.ok).toBe(true);

    const pose = housePoseForParcel(parcel, mapSize, grading);
    const ring = [...parcel.fence, parcel.gate];
    const bounds = {
      minX: Math.min(...ring.map((c) => c.x)) - 0.5,
      maxX: Math.max(...ring.map((c) => c.x)) + 0.5,
      minY: Math.min(...ring.map((c) => c.y)) - 0.5,
      maxY: Math.max(...ring.map((c) => c.y)) + 0.5,
    };
    const side = parcel.w * CELL_SIZE > 16 ? 2.5 : 1.5;
    const street = parcelStreetDirection(parcel);
    const parcelDepthM = (Math.abs(street[0]) * (bounds.maxX - bounds.minX) + Math.abs(street[1]) * (bounds.maxY - bounds.minY)) * CELL_SIZE;
    for (const [gx, gy] of pose.corners) {
      expect(gx).toBeGreaterThanOrEqual(bounds.minX + side / CELL_SIZE - 0.001);
      expect(gx).toBeLessThanOrEqual(bounds.maxX - side / CELL_SIZE + 0.001);
      expect(gy).toBeGreaterThanOrEqual(bounds.minY + side / CELL_SIZE - 0.001);
      expect(gy).toBeLessThanOrEqual(bounds.maxY - side / CELL_SIZE + 0.001);
      const streetProjection = (gx - parcel.gate.x) * street[0] + (gy - parcel.gate.y) * street[1];
      expect(streetProjection).toBeLessThanOrEqual(0.5 - 3 / CELL_SIZE + 0.001);
      expect(streetProjection).toBeGreaterThanOrEqual(0.5 - parcelDepthM / CELL_SIZE + 3 / CELL_SIZE - 0.001);
    }

    for (const post of parcelFencePlacements({ ...parcel, fenceType: "fence" }, mapSize, groundAt).filter((p) => p.piece.startsWith("post"))) {
      const gx = post.position[0] / CELL_SIZE + mapSize / 2;
      const gy = post.position[2] / CELL_SIZE + mapSize / 2;
      expect(post.position[1]).toBeCloseTo(groundAt(gx, gy), 3);
      expect(post.position[1]).toBeGreaterThan(0.5);
    }

    expect(starterGaragePlacement(parcel, mapSize, groundAt, grading.garageFloorY).garageFloorY).toBe(grading.garageFloorY);
    expect(grading.garageFloorY).toBeGreaterThan(0.5);
    expect(grading.drive.y[0]).toBeCloseTo(groundAt(parcel.gate.x, parcel.gate.y), 2);
    expect(grading.drive.y.at(-1)).toBeCloseTo(grading.garageFloorY, 3);
    const stations = grading.drive.stationsM;
    for (let i = 1; i < stations.length; i++) {
      const grade = Math.abs(grading.drive.y[i]! - grading.drive.y[i - 1]!) / (stations[i]! - stations[i - 1]!);
      expect(grade).toBeLessThanOrEqual((i === 1 ? SLOPE_LIMITS.driveMaxNearStreet : SLOPE_LIMITS.driveMax) + 1e-9);
    }
    expect(grading.retainingWalls.every((wall) => wall.faceHeightM <= 2)).toBe(true);

    const unsold = fixture.neighbours.find((p) => p.id !== parcel.id);
    expect(unsold).toBeDefined();
    if (unsold) {
      const board = forSaleBoardPlacement(unsold, mapSize, groundAt);
      const frontY = unsold.gate.y + (unsold.side === 1 ? -0.5 : 0.5);
      const streetDirection = parcelStreetDirection(unsold);
      const frontX = unsold.gate.x + streetDirection[0] * 0.5;
      const frontGy = unsold.gate.y + streetDirection[1] * 0.5;
      expect(board.position[1]).toBeCloseTo(groundAt(board.gx, board.gy), 3);
      expect((board.gx - frontX) * streetDirection[0] + (board.gy - frontGy) * streetDirection[1]).toBeGreaterThan(0);
      expect(frontY).toBeGreaterThan(0);
      expect(board.position[1]).toBeGreaterThan(0.5);
    }
  });
});
