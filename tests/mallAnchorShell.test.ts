import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  buildMallAnchorShellModel,
  mallAnchorNightFloorEmissive,
} from "../src/colony/render/mallAnchorShell";
import type { MallAnchorShellModel } from "../src/colony/render/mallAnchorShell";
// @ts-ignore Vite/Vitest raw import for source-scan coverage.
import mallAnchorShellSource from "../src/colony/render/mallAnchorShell.ts?raw";

const SEEDS = [4242, 42, 7] as const;

function padSurfaceY(x: number, y: number): number {
  return 10 + (x % 3) * 0.1 + (y % 2) * 0.05;
}

describe("mall anchor shell render model", () => {
  it("source-scans the mall anchor shell for deterministic render-only generation", () => {
    expect(mallAnchorShellSource).not.toMatch(
      /Math\.random|Date\.now|performance\.now|new Date/,
    );
  });

  it("maps the night floor emissive from dim day to bright night", () => {
    expect(mallAnchorNightFloorEmissive(1)).toBe(0.08);
    expect(mallAnchorNightFloorEmissive(0)).toBe(1.35);
    expect(mallAnchorNightFloorEmissive(0.5)).toBeCloseTo(0.715, 5);
  });

  let totalConstructedRuntimes = 0;

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      let aRuntime: ColonyRuntime;
      let bRuntime: ColonyRuntime;
      let pair: { a: ColonyRuntime; b: ColonyRuntime };
      let modelA: MallAnchorShellModel;
      let modelB: MallAnchorShellModel;
      let baselineSnapshotA: string;
      let baselineSnapshotB: string;

      function snapshotState(
        rt: ColonyRuntime,
        model: MallAnchorShellModel,
      ): string {
        const d = rt.commercialDistrict;
        const t = rt.sim.state.terrain;
        return JSON.stringify({
          mallPad: d?.mallPad,
          terrainSize: t.size,
          terrainLanding: { x: t.landing.x, y: t.landing.y },
          model,
        });
      }

      let bootDurationA = 0;
      let bootDurationB = 0;

      beforeAll(() => {
        const t0 = performance.now();
        aRuntime = new ColonyRuntime(seed);
        totalConstructedRuntimes++;
        bootDurationA = performance.now() - t0;
      }, 30000);

      beforeAll(() => {
        const t0 = performance.now();
        bRuntime = new ColonyRuntime(seed);
        totalConstructedRuntimes++;
        pair = { a: aRuntime, b: bRuntime };
        modelA = buildMallAnchorShellModel(
          pair.a.commercialDistrict!.mallPad,
          padSurfaceY,
        );
        modelB = buildMallAnchorShellModel(
          pair.b.commercialDistrict!.mallPad,
          padSurfaceY,
        );

        // Identity and isolation checks across runtimes, sim states, terrain, districts, and model objects
        expect(pair.a).not.toBe(pair.b);
        expect(pair.a.sim.state).not.toBe(pair.b.sim.state);
        expect(pair.a.sim.state.terrain).not.toBe(pair.b.sim.state.terrain);
        expect(pair.a.commercialDistrict).not.toBe(pair.b.commercialDistrict);
        expect(pair.a.commercialDistrict!.mallPad).not.toBe(
          pair.b.commercialDistrict!.mallPad,
        );
        expect(modelA).not.toBe(modelB);
        expect(modelA.center).not.toBe(modelB.center);
        expect(modelA.body).not.toBe(modelB.body);
        expect(modelA.roof).not.toBe(modelB.roof);
        expect(modelA.nightFloor).not.toBe(modelB.nightFloor);

        baselineSnapshotA = snapshotState(pair.a, modelA);
        baselineSnapshotB = snapshotState(pair.b, modelB);
        bootDurationB = performance.now() - t0;
        console.log(
          `[mallAnchorShell] Seed ${seed} Vitest setup: bootA=${(bootDurationA / 1000).toFixed(2)}s, bootB+model+checks=${(bootDurationB / 1000).toFixed(2)}s, pairTotal=${((bootDurationA + bootDurationB) / 1000).toFixed(2)}s`,
        );
      }, 30000);

      afterEach(() => {
        expect(snapshotState(pair.a, modelA)).toBe(baselineSnapshotA);
        expect(snapshotState(pair.b, modelB)).toBe(baselineSnapshotB);
      });

      it("builds a deterministic flat-roofed anchor shell matching across independent boots", () => {
        expect(modelB).toEqual(modelA);
        expect(modelA.kind).toBe("mall_anchor_shell");
        expect(modelA.center).toEqual({
          x:
            pair.a.commercialDistrict!.mallPad.x +
            (pair.a.commercialDistrict!.mallPad.w - 1) / 2,
          y:
            pair.a.commercialDistrict!.mallPad.y +
            (pair.a.commercialDistrict!.mallPad.h - 1) / 2,
        });
        expect(modelA.body.w).toBeCloseTo(
          pair.a.commercialDistrict!.mallPad.w * 0.86,
          5,
        );
        expect(modelA.body.d).toBeCloseTo(
          pair.a.commercialDistrict!.mallPad.h * 0.78,
          5,
        );
        expect(modelA.roof.y).toBeCloseTo(modelA.body.h + modelA.roof.h / 2, 5);
        expect(modelA.nightFloor.y).toBeCloseTo(0.025, 5);
        expect(modelA.nightFloor.w - modelA.roof.w).toBeGreaterThanOrEqual(1);
        expect(modelA.nightFloor.d - modelA.roof.d).toBeGreaterThanOrEqual(1);
        expect(modelA.nightFloor.emissiveIntensity.day).toBe(0.08);
        expect(modelA.nightFloor.emissiveIntensity.night).toBe(1.35);
        expect(modelA.baseY).toBeLessThanOrEqual(
          padSurfaceY(
            pair.a.commercialDistrict!.mallPad.x,
            pair.a.commercialDistrict!.mallPad.y,
          ),
        );
      }, 30000);

      it("proves instance and model isolation with mutation negative control", () => {
        const origRoofY = modelA.roof.y;
        const snapshotBeforeA = snapshotState(pair.a, modelA);
        const snapshotBeforeB = snapshotState(pair.b, modelB);
        try {
          modelA.roof.y = origRoofY + 0.2;
          expect(modelA).not.toEqual(modelB);
          expect(snapshotState(pair.a, modelA)).not.toBe(snapshotBeforeA);
          expect(snapshotState(pair.b, modelB)).toBe(snapshotBeforeB);
          expect(modelB.roof.y).toBe(origRoofY);
          expect(modelB.roof.y).not.toBe(modelA.roof.y);
        } finally {
          modelA.roof.y = origRoofY;
        }
        expect(modelA).toEqual(modelB);
        expect(snapshotState(pair.a, modelA)).toBe(snapshotBeforeA);
      }, 30000);
    });
  }

  afterAll(() => {
    expect(totalConstructedRuntimes).toBe(6);
  });
});
