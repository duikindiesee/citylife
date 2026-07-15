// Spec 125 — the tarentaal flock placement. Pins the pure transform the R3F component syncs
// from: legacy-verbatim proportions/colors, the grid->world transform, the behavior-driven
// bob and stride, and the -heading yaw convention.
import { describe, it, expect } from "vitest";
import type { TarentaalBird } from "../src/colony/tarentaal";
import {
  TARENTAAL_ADULT,
  TARENTAAL_CHICK,
  birdBob,
  birdStride,
  tarentaalTransform,
} from "../src/colony/render/tarentaalLayer";

function bird(p: Partial<TarentaalBird>): TarentaalBird {
  return {
    id: 1,
    age: "adult",
    x: 0,
    y: 0,
    heading: 0,
    behavior: "forage",
    followId: null,
    isPublicSafe: true,
    ...p,
  };
}

describe("spec 125 — legacy-verbatim bird specs", () => {
  it("keeps adult + chick proportions and colors", () => {
    expect(TARENTAAL_ADULT.radius).toBe(0.22);
    expect(TARENTAAL_ADULT.color).toBe(0x32343a);
    expect(TARENTAAL_ADULT.scale).toEqual([1.25, 0.72, 0.82]);
    expect(TARENTAAL_CHICK.radius).toBe(0.12);
    expect(TARENTAAL_CHICK.color).toBe(0x8c7444);
  });
});

describe("spec 125 — behavior flourishes", () => {
  it("a chasing bird bobs higher and strides longer", () => {
    expect(birdBob("chase")).toBe(0.035);
    expect(birdBob("forage")).toBe(0.01);
    expect(birdBob("follow")).toBe(0.01);
    expect(birdStride("chase")).toBe(1.18);
    expect(birdStride("forage")).toBe(1);
  });
});

describe("spec 125 — grid to world transform", () => {
  it("maps through the 4m grid with the bob on top of the ground", () => {
    const t = tarentaalTransform(
      bird({ x: 10, y: 20, behavior: "forage" }),
      40,
      () => 2.5,
    );
    expect(t.wx).toBe((10 - 20) * 4);
    expect(t.wz).toBe((20 - 20) * 4);
    expect(t.wy).toBeCloseTo(2.51, 6); // ground 2.5 + forage bob 0.01
    expect(t.stride).toBe(1);
  });

  it("uses -heading yaw (legacy) and never sinks below sea level", () => {
    const t = tarentaalTransform(
      bird({ heading: Math.PI / 3, behavior: "chase" }),
      10,
      () => -5,
    );
    expect(t.rotY).toBeCloseTo(-Math.PI / 3, 6);
    expect(t.wy).toBeCloseTo(0.035, 6); // floored ground 0 + chase bob
    expect(t.stride).toBe(1.18);
  });
});
