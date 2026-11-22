import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { lastLayParcelsStats, type Parcel } from "../src/colony/neighborhood";
import { gradePlot } from "../src/colony/slope/plotGrading";

function syntheticParcel(): Parcel {
  return {
    id: "synthetic-steep", x: 10, y: 10, w: 5, h: 6, side: 1, tier: "COMPACT",
    doorX: 10, doorY: 10, built: false, houseSeed: 1, fenceType: "fence",
    houseZone: { x: 9, y: 10, w: 3, d: 3 }, garden: { x: 9, y: 13, w: 3, d: 0 },
    farm: { x: 9, y: 13, w: 3, d: 0 }, gate: { x: 10, y: 6 },
    driveway: [{ x: 10, y: 5 }, { x: 10, y: 6 }, { x: 10, y: 7 }],
    fence: [{ x: 8, y: 6 }, { x: 12, y: 6 }, { x: 8, y: 11 }, { x: 12, y: 11 }],
  };
}

describe("terrain-aware parcel placement filters", () => {
  it("grades each placed runtime lot and reports smallholding bands", () => {
    for (const seed of [180, 42, 4242, 7]) {
      const runtime = new ColonyRuntime(seed);
      const terrain = runtime.sim.state.terrain;
      const lots = runtime.lots();
      const counts: Record<string, number> = {};
      expect(lots.length).toBeGreaterThan(0);
      for (const lot of lots) {
        const result = gradePlot(lot, (x, y) => terrain.worldYAt(x, y));
        expect(lot.grading).toBeDefined();
        expect(result.ok, `${seed}/${lot.id}: ${JSON.stringify(result.violations)}`).toBe(true);
        expect(result.band).not.toBe("reject");
        counts[result.band] = (counts[result.band] ?? 0) + 1;
        if (lot.tier === "GRAND") {
          expect(result.padAreaM2).toBeLessThanOrEqual((lot.houseZone.w + 1) * (lot.houseZone.d + 1) * 16);
        }
      }
      console.log("SMALLHOLDINGS", seed, lots.filter((lot) => lot.tier === "GRAND").length, JSON.stringify(counts));
      const grandStats = lastLayParcelsStats();
      console.log("GRAND_TRIES", seed, grandStats.grandAttempts, grandStats.grandSucceeded);
    }
  });

  it("rejects a synthetic 30 percent parcel grade", () => {
    const result = gradePlot(syntheticParcel(), (_x, y) => 0.3 * y * 4);
    expect(result.ok).toBe(false);
    expect(result.band).toBe("reject");
  });
});
