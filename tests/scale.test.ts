// Spec 137 — the world metric system. Pins the anchor and the derived player/citizen figures
// so the collider, eye height and crowd heights can never silently drift back out of scale.
import { describe, it, expect } from "vitest";
import {
  METRES_PER_UNIT,
  CELL_SIZE,
  HALF_CELL,
  PLAYER_HEIGHT_M,
  PLAYER_EYE_M,
  PLAYER_RADIUS_M,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_EXTENT,
  PLAYER_EYE_OFFSET,
  CITIZEN_HEIGHT_M,
  citizenFigure,
} from "../src/colony/scale";

describe("spec 137 — the metric anchor", () => {
  it("holds 1 unit = 1 m and 1 cell = 4 m", () => {
    expect(METRES_PER_UNIT).toBe(1);
    expect(CELL_SIZE).toBe(4);
    expect(HALF_CELL).toBe(2);
  });
});

describe("spec 137 — the player derives consistently", () => {
  it("a Rapier capsule of [halfHeight, radius] is exactly PLAYER_HEIGHT_M tall", () => {
    // capsule total height = 2 * (halfHeight + radius)
    expect(2 * (PLAYER_HALF_HEIGHT + PLAYER_RADIUS_M)).toBeCloseTo(PLAYER_HEIGHT_M, 5);
    // half-extent (centre to foot) = halfHeight + radius = height/2
    expect(PLAYER_HALF_HEIGHT + PLAYER_RADIUS_M).toBeCloseTo(PLAYER_HALF_EXTENT, 5);
  });
  it("the camera eye offset lands the eye at PLAYER_EYE_M above the feet", () => {
    // eye above feet = half-extent (centre above feet) + eye offset (eye above centre)
    expect(PLAYER_HALF_EXTENT + PLAYER_EYE_OFFSET).toBeCloseTo(PLAYER_EYE_M, 5);
  });
});

describe("spec 137 — citizenFigure builds a feet-on-ground humanoid", () => {
  it("the crown reaches the requested height and the feet sit at 0", () => {
    const f = citizenFigure(CITIZEN_HEIGHT_M);
    expect(f.headLift + f.headRadius).toBeCloseTo(CITIZEN_HEIGHT_M, 5);
    expect(f.bodyLift - (f.bodyRadius + f.bodyLength / 2)).toBeCloseTo(0, 5);
  });
  it("scales linearly with the requested height", () => {
    const a = citizenFigure(2);
    const b = citizenFigure(1);
    expect(a.headRadius).toBeCloseTo(b.headRadius * 2, 5);
    expect(a.bodyLength).toBeCloseTo(b.bodyLength * 2, 5);
  });
  it("a citizen (1.7 m) is shorter than the player (1.8 m) but the same order — not a third of it", () => {
    const c = citizenFigure(CITIZEN_HEIGHT_M);
    const citizenCrown = c.headLift + c.headRadius;
    expect(citizenCrown).toBeGreaterThan(PLAYER_HEIGHT_M * 0.8);
    expect(citizenCrown).toBeLessThan(PLAYER_HEIGHT_M);
  });
});
