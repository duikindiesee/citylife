import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  buildMallAnchorShellModel,
  mallAnchorNightFloorEmissive,
} from "../src/colony/render/mallAnchorShell";
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

  it("builds a deterministic flat-roofed anchor shell from each surveyed mall pad", () => {
    for (const seed of SEEDS) {
      const a = new ColonyRuntime(seed).commercialDistrict!;
      const b = new ColonyRuntime(seed).commercialDistrict!;
      const modelA = buildMallAnchorShellModel(a.mallPad, padSurfaceY);
      const modelB = buildMallAnchorShellModel(b.mallPad, padSurfaceY);

      expect(modelB).toEqual(modelA);
      expect(modelA.kind).toBe("mall_anchor_shell");
      expect(modelA.center).toEqual({
        x: a.mallPad.x + (a.mallPad.w - 1) / 2,
        y: a.mallPad.y + (a.mallPad.h - 1) / 2,
      });
      expect(modelA.body.w).toBeCloseTo(a.mallPad.w * 0.86, 5);
      expect(modelA.body.d).toBeCloseTo(a.mallPad.h * 0.78, 5);
      expect(modelA.roof.y).toBeCloseTo(modelA.body.h + modelA.roof.h / 2, 5);
      expect(modelA.nightFloor.y).toBeCloseTo(0.025, 5);
      expect(modelA.nightFloor.w - modelA.roof.w).toBeGreaterThanOrEqual(1);
      expect(modelA.nightFloor.d - modelA.roof.d).toBeGreaterThanOrEqual(1);
      expect(modelA.nightFloor.emissiveIntensity.day).toBe(0.08);
      expect(modelA.nightFloor.emissiveIntensity.night).toBe(1.35);
      expect(modelA.baseY).toBeLessThanOrEqual(
        padSurfaceY(a.mallPad.x, a.mallPad.y),
      );
    }
  }, 30000);
});
