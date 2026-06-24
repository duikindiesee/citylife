import { describe, expect, it } from "vitest";
import { defaultCarSpec, safeCarSpec } from "../src/colony/car/carSpec";
import {
  CAR_PARTS,
  partFits,
  validCarParts,
  deriveStats,
} from "../src/colony/car/carParts";

describe("car parts: sockets, fitment, derived stats (096 Slice C)", () => {
  it("fits a part only to its own socket", () => {
    expect(partFits("engine", "fourbarrel_carb")).toBe(true);
    expect(partFits("wheels", "fourbarrel_carb")).toBe(false);
    expect(partFits("wheels", "slicks")).toBe(true);
    expect(partFits("engine", "not_a_part")).toBe(false); // unknown kind
  });

  it("validates a part list to known kinds, one per socket", () => {
    // two engine parts -> only the first (one per socket); unknown dropped; cosmetic kept
    expect(
      validCarParts(["fourbarrel_carb", "blower", "junk", "slicks"]),
    ).toEqual(["fourbarrel_carb", "slicks"]);
  });

  it("derives effective stats additively, clamped, order-independent", () => {
    const stock = defaultCarSpec("p1");
    expect(deriveStats(stock)).toEqual(stock.stats); // no parts -> base

    const tuned = { ...defaultCarSpec("p1"), parts: ["blower", "slicks"] };
    const s = deriveStats(tuned);
    // blower: topSpeed +0.2 accel +0.15 grip -0.1 ; slicks: grip +0.25 accel +0.1 topSpeed -0.05
    expect(s.topSpeed).toBeCloseTo(0.65, 5); // 0.5 +0.2 -0.05
    expect(s.acceleration).toBeCloseTo(0.75, 5); // 0.5 +0.15 +0.1
    expect(s.grip).toBeCloseTo(0.65, 5); // 0.5 -0.1 +0.25

    // order does not matter
    const reordered = { ...defaultCarSpec("p1"), parts: ["slicks", "blower"] };
    expect(deriveStats(reordered)).toEqual(s);

    // clamps at 1 even if multiple parts pile onto the same stat is impossible (one per socket),
    // but a single strong part plus a high base must never exceed 1
    const fast = {
      ...defaultCarSpec("p1"),
      stats: { topSpeed: 0.95, acceleration: 0.5, grip: 0.5, braking: 0.5 },
      parts: ["blower"],
    };
    expect(deriveStats(fast).topSpeed).toBe(1);
  });

  it("safeCarSpec keeps part strings deduped and the catalog stays brand-safe", () => {
    const dup = { ...defaultCarSpec("p1"), parts: ["slicks", "slicks", 7] };
    const safe = safeCarSpec(JSON.parse(JSON.stringify(dup)))!;
    expect(safe.parts).toEqual(["slicks"]); // deduped, non-strings dropped
    // no catalog label smuggles a brand word
    for (const def of Object.values(CAR_PARTS)) {
      expect(def.label).not.toMatch(/kooker|token|secret/i);
    }
  });
});
