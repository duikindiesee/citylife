import { describe, expect, it } from "vitest";
import { ColonySim } from "../src/colony/sim";

const EXPECTED_KINDS = ["bench", "lamppost", "planter", "fountain"];

describe("Colony visual artifacts", () => {
  it("seeds a deterministic furniture/artifact catalog on dry land", () => {
    const a = new ColonySim(4242);
    const b = new ColonySim(4242);

    expect(a.state.artifacts).toEqual(b.state.artifacts);
    expect(a.state.artifacts.map((item) => item.kind)).toEqual(EXPECTED_KINDS);
    expect(a.state.artifacts.map((item) => item.category)).toEqual([
      "furniture",
      "lighting",
      "greenery",
      "civic-art",
    ]);

    for (const item of a.state.artifacts) {
      expect(typeof item.x).toBe("number");
      expect(typeof item.y).toBe("number");
      expect(item.rot).toBeGreaterThanOrEqual(0);
      expect(item.rot).toBeLessThan(Math.PI * 2);
      expect(item.footprint.w).toBeGreaterThan(0);
      expect(item.footprint.h).toBeGreaterThan(0);
      expect(
        a.state.terrain.isWater(Math.round(item.x), Math.round(item.y)),
      ).toBe(false);
    }
  });
});
