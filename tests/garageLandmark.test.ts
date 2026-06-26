import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import {
  buildGarageAnchorShellModel,
  garageAnchorNightFloorEmissive,
} from "../src/colony/render/garageAnchorShell";
import { COLONY } from "../src/colony/config";

const SEEDS = [4242, 42, 7];

const RT_CACHE = new Map<number, ColonyRuntime>();
function rtFor(seed: number): ColonyRuntime {
  let rt = RT_CACHE.get(seed);
  if (!rt) {
    rt = new ColonyRuntime(seed);
    RT_CACHE.set(seed, rt);
  }
  return rt;
}

function cells(r: { x: number; y: number; w: number; h: number }): string[] {
  const out: string[] = [];
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) out.push(`${x},${y}`);
  return out;
}

function dotTowardRoad(d: NonNullable<ColonyRuntime["commercialDistrict"]>) {
  const g = d.garagePad!;
  const cx = g.x + (g.w - 1) / 2;
  const cy = g.y + (g.h - 1) / 2;
  const fx = Math.sin(g.facingAngle);
  const fy = Math.cos(g.facingAngle);
  const ix = d.intersection!.x - cx;
  const iy = d.intersection!.y - cy;
  return fx * ix + fy * iy;
}

describe("garage landmark site and render model (spec 109 P1/P2)", () => {
  it("surveys one deterministic public-safe garage landmark pad per commercial district", () => {
    expect(COLONY.commerce.garagePadW).toBe(16);
    expect(COLONY.commerce.garagePadH).toBe(11);

    for (const seed of SEEDS) {
      const a = rtFor(seed).commercialDistrict!;
      const b = new ColonyRuntime(seed).commercialDistrict!;
      expect(a.garagePad).toBeDefined();
      expect(b.garagePad).toEqual(a.garagePad);
      expect(a.garagePad!.kind).toBe("garage_landmark");
      expect(a.garagePad!.isPublicSafe).toBe(true);
      expect(a.garagePad!.publicName).toBe("Gearbox Auto Hub");
      expect(a.garagePad!.islandCell).toBeDefined();
      expect(a.garagePad!.streetFrontDir).toBeDefined();
      expect(a.garagePad!.crossFrontDir).toBeDefined();
    }
  }, 30000);

  it("anchors the garage to a deterministic intersection corner with a pylon island cell", () => {
    for (const seed of SEEDS) {
      const d = rtFor(seed).commercialDistrict!;
      const g = d.garagePad!;
      const intersection = d.intersection!;
      const ix = g.streetFrontDir.x;
      const iy = g.crossFrontDir.y;
      expect(Math.abs(ix)).toBe(1);
      expect(g.streetFrontDir.y).toBe(0);
      expect(Math.abs(iy)).toBe(1);
      expect(g.crossFrontDir.x).toBe(0);
      expect(g.islandCell).toEqual({ x: intersection.x - ix, y: intersection.y - iy });
      expect(g.x).toBe(ix < 0 ? intersection.x + 1 : intersection.x - g.w);
      expect(g.y).toBe(iy < 0 ? intersection.y + 1 : intersection.y - g.h);
      expect(cells(g)).not.toContain(`${intersection.x},${intersection.y}`);
      expect(cells(g)).toContain(`${g.islandCell.x},${g.islandCell.y}`);
    }
  }, 30000);

  it("places the garage on dry buildable reserve cells without overlapping shops mall or roads", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const d = rt.commercialDistrict!;
      const g = d.garagePad!;
      const occupied = new Set<string>();
      for (const p of d.parcels) for (const c of cells(p)) occupied.add(c);
      for (const c of cells(d.mallPad)) occupied.add(c);
      for (const c of d.street) occupied.add(`${c.x},${c.y}`);
      for (const c of d.crossStreet) occupied.add(`${c.x},${c.y}`);

      expect(g.x).toBeGreaterThanOrEqual(d.reserve.x);
      expect(g.y).toBeGreaterThanOrEqual(d.reserve.y);
      expect(g.x + g.w).toBeLessThanOrEqual(d.reserve.x + d.reserve.w);
      expect(g.y + g.h).toBeLessThanOrEqual(d.reserve.y + d.reserve.h);
      for (const c of cells(g)) {
        const [x, y] = c.split(",").map(Number) as [number, number];
        expect(cellOk(rt.sim.state.terrain, x, y)).toBe(true);
        expect(occupied.has(c)).toBe(false);
      }
    }
  }, 30000);

  it("orients the garage forecourt toward the road intersection", () => {
    for (const seed of SEEDS) {
      const d = rtFor(seed).commercialDistrict!;
      expect(d.intersection).toBeDefined();
      expect(dotTowardRoad(d)).toBeGreaterThan(0);
      const model = buildGarageAnchorShellModel(d.garagePad!, () => 1.25);
      expect(model.forecourt.frontOffset).toBeGreaterThan(0);
      expect(model.facingAngle).toBe(d.garagePad!.facingAngle);
    }
  }, 30000);

  it("builds a showroom plus service bays plus pylon massing with night emissive floor", () => {
    const d = rtFor(4242).commercialDistrict!;
    const model = buildGarageAnchorShellModel(d.garagePad!, () => 2);
    expect(model.kind).toBe("garage_anchor_shell");
    expect(model.isPublicSafe).toBe(true);
    expect(model.showroom.w).toBeGreaterThan(model.serviceBay.bayDoorW);
    expect(model.serviceBay.doorCount).toBe(3);
    expect(model.pylon.h).toBeGreaterThan(model.showroom.h);
    expect(model.forecourt.w).toBeGreaterThan(model.serviceBay.w * 0.9);
    expect(garageAnchorNightFloorEmissive(1)).toBeCloseTo(0.12);
    expect(garageAnchorNightFloorEmissive(0)).toBeCloseTo(1.05);
    expect(garageAnchorNightFloorEmissive(-10)).toBeCloseTo(1.05);
    expect(garageAnchorNightFloorEmissive(10)).toBeCloseTo(0.12);
  });
});
