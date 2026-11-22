import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import type { Parcel } from "../src/colony/neighborhood";
import { gradePlot, SLOPE_LIMITS, summarizeBands, type SlopeBand, type GradingTechnique } from "../src/colony/slope/plotGrading";

const bandTechnique: Record<SlopeBand, GradingTechnique> = {
  level: "level-pad", gentle: "house-platform", moderate: "platform-retaining-wall",
  "steep-uphill": "street-level-garage-cut", "steep-downhill": "undercroft-garage", reject: "reject",
};

function parcel(tier: Parcel["tier"] = "COMPACT", w = 5, h = 6): Parcel {
  const minX = 11 - Math.floor((w - 1) / 2), maxX = minX + w - 1;
  const minY = 9 - Math.floor((h - 1) / 2), maxY = minY + h - 1;
  const houseZone = { x: 10, y: minY + 2, w: tier === "GRAND" ? 5 : 3, d: 3 };
  const gate = { x: 11, y: minY };
  const fence = [
    ...Array.from({ length: w }, (_, i) => minX + i).filter((x) => x !== gate.x).map((x) => ({ x, y: minY })),
    ...Array.from({ length: w }, (_, i) => ({ x: minX + i, y: maxY })),
    ...Array.from({ length: h - 2 }, (_, i) => minY + i + 1).flatMap((y) => [{ x: minX, y }, { x: maxX, y }]),
  ];
  return {
    id: `synthetic-${tier}`, x: 11, y: 9, w, h, side: 1, tier, doorX: 11, doorY: 9,
    built: false, houseSeed: 1, fenceType: "fence", houseZone, garden: { x: 10, y: 10, w: 1, d: 1 },
    farm: { x: 10, y: minY + 4, w: 1, d: 1 }, gate, driveway: [{ x: 11, y: minY - 1 }, gate, { x: 11, y: minY + 1 }, { x: 11, y: minY + 2 }], fence,
  };
}

describe("plot grading bands and constraints", () => {
  it("maps synthetic planes to the sourced bands and techniques", () => {
    const cases: [number, number, SlopeBand][] = [
      [0.01, 1, "level"], [0.05, 1, "gentle"], [0.10, 1, "moderate"],
      [0.18, 1, "steep-uphill"], [0.18, -1, "steep-downhill"], [0.30, 1, "reject"],
    ];
    for (const [g, sign, expected] of cases) {
      const p = parcel();
      const result = gradePlot(p, (x, y) => sign * g * (y - 10) * 4);
      expect(result.band).toBe(expected);
      expect(result.technique).toBe(bandTechnique[expected]);
      expect(result.gradient).toBeCloseTo(g, 3);
      expect(result.ok, `${g}/${sign}`).toBe(expected !== "reject");
      if (["gentle", "moderate", "steep-uphill", "steep-downhill"].includes(expected)) expect(result.ok, `${g}/${sign}`).toBe(true);
      if (expected === "steep-uphill") {
        expect(result.garageMode).toBe("street-level-cut");
        expect(result.garageCutDepthM).toBeGreaterThan(0);
      } else if (expected === "steep-downhill") {
        expect(result.garageMode).toBe("undercroft");
        expect(result.houseFloorY - result.garageFloorY).toBeGreaterThanOrEqual(3.0 - 1e-6);
        const garageDoorNgl = sign * g * ((p.gate.y - 1 / 4) - 10) * 4;
        expect(result.garageFloorY).toBeLessThanOrEqual(garageDoorNgl + 0.5);
        expect(result.ok).toBe(true);
      } else expect(result.garageMode).toBe("on-pad");
      if (result.ok) {
        expect(result.maxFillM, `${g}/${sign}`).toBeLessThanOrEqual(SLOPE_LIMITS.padFillMaxM + 1e-6);
        expect(result.drive.y[0]).toBeCloseTo(result.streetY, 9);
        expect(result.drive.y.at(-1)).toBeCloseTo(result.garageFloorY, 9);
        for (let i = 1; i < result.drive.stationsM.length; i++) {
          const ds = result.drive.stationsM[i]! - result.drive.stationsM[i - 1]!;
          const grade = ds > 0 ? Math.abs(result.drive.y[i]! - result.drive.y[i - 1]!) / ds : 0;
          const limit = result.drive.stationsM[i - 1]! < SLOPE_LIMITS.driveNearStreetM
            ? SLOPE_LIMITS.driveMaxNearStreet
            : SLOPE_LIMITS.driveMax;
          expect(grade).toBeLessThanOrEqual(limit + 1e-9);
        }
        if (result.garageMode !== "undercroft") {
          const footprintSamples = [] as number[];
          for (let y = p.houseZone.y - 0.5; y <= p.houseZone.y + p.houseZone.d - 0.5 + 1e-8; y += 0.5 / 4) {
            for (let x = p.houseZone.x - 0.5; x <= p.houseZone.x + p.houseZone.w - 0.5 + 1e-8; x += 0.5 / 4) footprintSamples.push(sign * g * (y - 10) * 4);
          }
          expect(result.houseFloorY - Math.min(...footprintSamples)).toBeLessThanOrEqual(0.65 + 1e-9);
        }
        expect(result.banks.every((b) => b.gradient <= SLOPE_LIMITS.bankMaxGradient)).toBe(true);
        expect(result.retainingWalls.every((w) => w.faceHeightM <= SLOPE_LIMITS.wallFaceMaxM && w.needsEngineer === (w.faceHeightM > SLOPE_LIMITS.engineerWallM))).toBe(true);
        expect(result.drive.maxGradeNear).toBeLessThanOrEqual(SLOPE_LIMITS.driveMaxNearStreet + 1e-6);
        expect(result.drive.maxGrade).toBeLessThanOrEqual(SLOPE_LIMITS.driveMax + 1e-6);
        expect(result.retainingWalls.reduce((s, w) => s + w.faceHeightM * w.terraces, 0)).toBeLessThanOrEqual(SLOPE_LIMITS.terraceCumulativeM + 1e-6);
      }
      if (expected !== "steep-downhill") expect(result.houseFloorY - 0.15).toBeCloseTo(result.padY, 6);
      if (expected === "moderate") {
        expect(result.retainingWalls.length > 0 || result.banks.length > 0).toBe(true);
        expect(result.retainingWalls.every((w) => w.faceHeightM <= 2.0)).toBe(true);
      }
    }
  });

  it("keeps GRAND grading local to the house footprint", () => {
    const p = parcel("GRAND", 25, 25);
    const r = gradePlot(p, (x) => x * 0.1);
    const marginArea = (p.houseZone.w + 1) * (p.houseZone.d + 1) * 16;
    expect(r.smallholding).toBe(true);
    expect(r.padAreaM2).toBeLessThanOrEqual(marginArea);
    expect(r.padAreaM2).toBeLessThan(p.w * p.h * 16);
  });

  it("measures gradient over the whole plot, including the back garden", () => {
    const p = parcel();
    const result = gradePlot(p, (_x, y) => y > 10 ? 0.2 * (y - 10) * 4 : 0);
    expect(result.band).not.toBe("level");
    expect(result.gradient).toBeGreaterThan(0.03);
  });

  it("grades every live lot over the raw bilinear terrain", () => {
    for (const seed of [180, 42, 4242]) {
      const runtime = new ColonyRuntime(seed);
      const terrain = runtime.sim.state.terrain;
      const groundAt = (x: number, y: number) => terrain.worldYAt(x, y);
      const lots = runtime.lots();
      expect(lots.length).toBeGreaterThan(0);
      for (const lot of lots) expect(gradePlot(lot, groundAt).band).toBeTruthy();
      const counts = summarizeBands(lots, groundAt);
      console.log("BANDS", seed, JSON.stringify(counts));
      const failures = lots.map((lot) => ({ lot: lot.id, result: gradePlot(lot, groundAt) })).filter(({ result }) => !result.ok);
      console.log("GRADING_FAILURES", seed, JSON.stringify({ count: failures.length, lots: failures.map(({ lot, result }) => ({ lot, violations: result.violations })) }));
    }
  });
});
