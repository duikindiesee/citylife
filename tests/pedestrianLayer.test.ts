// Spec 121 — the ambient pedestrian crowd. Pins the pure math the R3F component syncs from:
// legacy-verbatim constants, the population-tracking count, deterministic pool seeding,
// road-seeking target choice with a wander fallback, and the per-figure step.
import { describe, it, expect } from "vitest";
import {
  PED_POOL_CAP,
  PED_BODY,
  PED_HEAD,
  PED_COLORS,
  pedColorHex,
  visiblePedCount,
  initPedPool,
  pickPedTarget,
  stepPed,
  pedTransform,
  makePedRng,
  type Ped,
} from "../src/colony/render/pedestrianLayer";

const alwaysLand = () => true;

describe("spec 121 — legacy-verbatim constants", () => {
  it("keeps the pool cap and palette, and stands a 1.7 m adult on the ground (spec 137)", () => {
    expect(PED_POOL_CAP).toBe(28);
    // pedestrians share the citizens' 1.7 m silhouette: crown reaches 1.7, feet at 0
    expect(PED_HEAD.translateY + PED_HEAD.radius).toBeCloseTo(1.7, 5);
    expect(PED_BODY.translateY - (PED_BODY.radius + PED_BODY.length / 2)).toBeCloseTo(0, 5);
    expect(PED_COLORS).toHaveLength(6);
  });

  it("wraps the body palette by index (including negative-safe)", () => {
    expect(pedColorHex(0)).toBe(PED_COLORS[0]);
    expect(pedColorHex(6)).toBe(PED_COLORS[0]);
    expect(pedColorHex(7)).toBe(PED_COLORS[1]);
  });
});

describe("spec 121 — visible count tracks the colony population", () => {
  it("draws one figure per colonist, clamped to the pool and rounded", () => {
    expect(visiblePedCount(0, 28)).toBe(0);
    expect(visiblePedCount(4.4, 28)).toBe(4);
    expect(visiblePedCount(4.6, 28)).toBe(5);
    expect(visiblePedCount(100, 28)).toBe(28);
    expect(visiblePedCount(-3, 28)).toBe(0);
  });
});

describe("spec 121 — pool seeding is deterministic and on-land", () => {
  it("fills the pool near the landing on land only", () => {
    const rand = makePedRng(1234);
    const pool = initPedPool({ x: 50, y: 50 }, rand, alwaysLand);
    expect(pool).toHaveLength(PED_POOL_CAP);
    for (const p of pool) {
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeLessThanOrEqual(16); // 2 + 14 max radius
      expect(p.tx).toBe(p.x);
      expect(p.ty).toBe(p.y);
      expect(p.spd).toBeGreaterThanOrEqual(0.5);
      expect(p.spd).toBeLessThanOrEqual(1.2);
    }
  });

  it("is reproducible for the same seed and stops at the guard when no land", () => {
    const a = initPedPool({ x: 10, y: 10 }, makePedRng(7), alwaysLand);
    const b = initPedPool({ x: 10, y: 10 }, makePedRng(7), alwaysLand);
    expect(a).toEqual(b);
    const none = initPedPool({ x: 10, y: 10 }, makePedRng(7), () => false);
    expect(none).toHaveLength(0); // guard exits, no infinite loop
  });
});

describe("spec 121 — target picking", () => {
  it("picks a road cell in the 1.5..16 band, nudged toward the kerb", () => {
    const roads = [
      { x: 0, y: 0 }, // dist 0 — too close, excluded
      { x: 5, y: 0 }, // dist 5 — in band
      { x: 50, y: 0 }, // dist 50 — too far, excluded
    ];
    const t = pickPedTarget(0, 0, 0, 0, roads, makePedRng(3), alwaysLand);
    // only the dist-5 cell qualifies; nudge is +/-0.25
    expect(Math.abs(t.x - 5)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(t.y - 0)).toBeLessThanOrEqual(0.25);
  });

  it("wanders near the landing when there are no roads yet", () => {
    const t = pickPedTarget(50, 50, 50, 50, [], makePedRng(9), alwaysLand);
    expect(Math.hypot(t.x - 50, t.y - 50)).toBeLessThan(18);
  });
});

describe("spec 121 — stepping a figure", () => {
  it("moves toward the target and advances the bob phase", () => {
    const p: Ped = { x: 0, y: 0, tx: 10, ty: 0, spd: 1, phase: 0 };
    const { heading, bob } = stepPed(p, 0.1, 0, 0, [], makePedRng(1), alwaysLand);
    expect(p.x).toBeCloseTo(0.1, 6); // spd 1 * dt 0.1
    expect(p.y).toBeCloseTo(0, 6);
    expect(heading).toBeCloseTo(0, 6); // heading toward +x
    expect(bob).toBeGreaterThanOrEqual(0);
    expect(bob).toBeLessThanOrEqual(0.05);
  });

  it("re-targets when it arrives (within 0.4 of its target)", () => {
    const roads = [{ x: 20, y: 0 }];
    const p: Ped = { x: 5, y: 0, tx: 5.1, ty: 0, spd: 1, phase: 0 };
    stepPed(p, 0.1, 0, 0, roads, makePedRng(2), alwaysLand);
    // arrived at old target -> re-targeted to the road cell band
    expect(p.tx).not.toBe(5.1);
  });
});

describe("spec 121 — transform", () => {
  it("maps to the 4m grid with bob on top of the ground, legacy yaw", () => {
    const p: Ped = { x: 10, y: 20, tx: 10, ty: 20, spd: 1, phase: 0 };
    const t = pedTransform(p, 0, 0.03, 40, () => 2.5);
    expect(t.wx).toBe((10 - 20) * 4);
    expect(t.wz).toBe((20 - 20) * 4);
    expect(t.wy).toBeCloseTo(2.53, 6); // ground 2.5 + bob 0.03
    expect(t.rotY).toBeCloseTo(Math.PI / 2, 6); // -heading + PI/2, heading 0
  });

  it("never sinks below sea level", () => {
    const p: Ped = { x: 0, y: 0, tx: 0, ty: 0, spd: 1, phase: 0 };
    expect(pedTransform(p, 0, 0, 10, () => -5).wy).toBe(0);
  });
});
