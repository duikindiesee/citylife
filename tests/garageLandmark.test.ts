import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { cellOk } from "../src/colony/pathfind";
import {
  buildGarageAnchorShellModel,
  commercialPromenadeLampAllowed,
  commercialPromenadeLampPosition,
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

function roadClearanceKeys(r: {
  x: number;
  y: number;
  w: number;
  h: number;
}): string[] {
  const keys = new Set<string>();
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        keys.add(`${x + dx},${y + dy}`);
      }
    }
  }
  return [...keys];
}

function facingVector(angle: number) {
  return {
    x: Math.round(Math.sin(angle)),
    y: Math.round(Math.cos(angle)),
  };
}

function localToGrid(angle: number, local: { x: number; z: number }) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: local.x * cos + local.z * sin,
    y: -local.x * sin + local.z * cos,
  };
}

function modelLocalToAbsoluteGrid(
  center: { x: number; y: number },
  angle: number,
  local: { x: number; z: number },
) {
  const offset = localToGrid(angle, local);
  return { x: center.x + offset.x, y: center.y + offset.y };
}

function rectSamples(local: { x: number; z: number; w: number; d: number }) {
  return [
    { x: local.x, z: local.z },
    { x: local.x - local.w / 2, z: local.z - local.d / 2 },
    { x: local.x + local.w / 2, z: local.z - local.d / 2 },
    { x: local.x - local.w / 2, z: local.z + local.d / 2 },
    { x: local.x + local.w / 2, z: local.z + local.d / 2 },
  ];
}

function expectInsidePad(
  p: { x: number; y: number },
  pad: { x: number; y: number; w: number; h: number },
) {
  expect(p.x).toBeGreaterThanOrEqual(pad.x - 0.01);
  expect(p.y).toBeGreaterThanOrEqual(pad.y - 0.01);
  expect(p.x).toBeLessThanOrEqual(pad.x + pad.w - 1 + 0.01);
  expect(p.y).toBeLessThanOrEqual(pad.y + pad.h - 1 + 0.01);
}

function nearestRoadDistance(
  p: { x: number; y: number },
  roads: ReadonlySet<string>,
): number {
  let nearest = Infinity;
  for (const key of roads) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    nearest = Math.min(nearest, Math.abs(Math.round(p.x) - x) + Math.abs(Math.round(p.y) - y));
  }
  return nearest;
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
      expect(g.islandCell).toEqual({
        x: intersection.x - ix * 3,
        y: intersection.y - iy * 3,
      });
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

  it("keeps the garage landmark footprint road-clear on final widened roads", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const g = rt.commercialDistrict!.garagePad!;
      const roads = new Set(rt.sim.state.roads.map((c) => `${c.x},${c.y}`));
      for (const c of roadClearanceKeys(g)) expect(roads.has(c)).toBe(false);
    }
  }, 30000);

  it("keeps the drive-in garage square to the cross street rather than diagonal to the junction", () => {
    for (const seed of SEEDS) {
      const d = rtFor(seed).commercialDistrict!;
      const g = d.garagePad!;
      expect(d.intersection).toBeDefined();
      expect(facingVector(g.facingAngle)).toEqual(g.crossFrontDir);
      const model = buildGarageAnchorShellModel(g, () => 1.25);
      expect(model.forecourt.frontOffset).toBeGreaterThan(0);
      expect(facingVector(model.facingAngle)).toEqual(g.crossFrontDir);
    }
  }, 30000);

  it("mounts the garage sign on the building frontage instead of as a freestanding driveway pole", () => {
    for (const seed of SEEDS) {
      const d = rtFor(seed).commercialDistrict!;
      const g = d.garagePad!;
      const model = buildGarageAnchorShellModel(g, () => 1.25);
      const center = {
        x: g.x + (g.w - 1) / 2,
        y: g.y + (g.h - 1) / 2,
      };
      const pylonAbs = modelLocalToAbsoluteGrid(
        center,
        model.facingAngle,
        model.pylon,
      );

      expectInsidePad(pylonAbs, g);
      expect(model.pylon.w).toBeGreaterThanOrEqual(model.pylon.h * 8);
      expect(model.pylon.h).toBeLessThanOrEqual(0.5);
      expect(model.pylon.y - model.pylon.h / 2).toBeGreaterThanOrEqual(
        model.serviceBay.h - 0.55,
      );
      expect(model.pylon.y + model.pylon.h / 2).toBeLessThanOrEqual(
        model.serviceBay.h + 0.08,
      );
      expect(model.pylon.z).toBeLessThanOrEqual(
        model.serviceBay.z + model.serviceBay.d / 2 + 0.12,
      );
      expect(Math.abs(model.pylon.x - model.serviceBay.x)).toBeLessThanOrEqual(
        model.serviceBay.w * 0.1,
      );
    }
  }, 30000);

  it("keeps commercial promenade lamp posts out of the garage frontage pad", () => {
    for (const seed of SEEDS) {
      const d = rtFor(seed).commercialDistrict!;
      const g = d.garagePad!;
      let rejectedGaragePadLamps = 0;
      for (let i = 0; i < d.street.length; i += 5) {
        const lamp = commercialPromenadeLampPosition(d.street[i]!, i);
        const insideGaragePad =
          lamp.x >= g.x &&
          lamp.x <= g.x + g.w - 1 &&
          lamp.y >= g.y &&
          lamp.y <= g.y + g.h - 1;
        const allowed = commercialPromenadeLampAllowed(lamp, d);
        if (insideGaragePad) {
          rejectedGaragePadLamps++;
          expect(allowed).toBe(false);
        } else {
          expect(allowed).toBe(true);
        }
      }
      expect(rejectedGaragePadLamps).toBeGreaterThan(0);
    }
  }, 30000);

  it("keeps the facade sign forecourt and display apron visually inside the garage pad and away from final roads", () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed);
      const g = rt.commercialDistrict!.garagePad!;
      const model = buildGarageAnchorShellModel(g, () => 1.25);
      const center = {
        x: g.x + (g.w - 1) / 2,
        y: g.y + (g.h - 1) / 2,
      };
      const roads = new Set(rt.sim.state.roads.map((c) => `${c.x},${c.y}`));

      const pylonAbs = modelLocalToAbsoluteGrid(center, model.facingAngle, model.pylon);
      expectInsidePad(pylonAbs, g);
      expect(nearestRoadDistance(pylonAbs, roads)).toBeGreaterThanOrEqual(3);

      for (const sample of rectSamples({
        x: 0,
        z: model.forecourt.frontOffset,
        w: model.forecourt.w,
        d: model.forecourt.d,
      })) {
        const abs = modelLocalToAbsoluteGrid(center, model.facingAngle, sample);
        expectInsidePad(abs, g);
      }

      const bayFaceZ = model.serviceBay.z + model.serviceBay.d / 2 + 0.045;
      const apronCenterZ = bayFaceZ + model.serviceBay.d * 0.42;
      const apronD = model.serviceBay.d * 0.85;
      for (const sample of rectSamples({
        x: model.serviceBay.x,
        z: apronCenterZ,
        w: model.serviceBay.bayDoorW * 1.35,
        d: apronD,
      })) {
        const abs = modelLocalToAbsoluteGrid(center, model.facingAngle, sample);
        expectInsidePad(abs, g);
      }

      for (const car of model.displayCars) {
        const abs = modelLocalToAbsoluteGrid(center, model.facingAngle, car);
        expectInsidePad(abs, g);
      }
    }
  }, 30000);

  it("builds a showroom plus service bays plus pylon massing with night emissive floor", () => {
    const d = rtFor(4242).commercialDistrict!;
    const model = buildGarageAnchorShellModel(d.garagePad!, () => 2);
    expect(model.kind).toBe("garage_anchor_shell");
    expect(model.isPublicSafe).toBe(true);
    expect(model.showroom.w).toBeGreaterThan(model.serviceBay.bayDoorW);
    expect(model.serviceBay.doorCount).toBe(3);
    expect(model.pylon.w).toBeGreaterThan(model.pylon.h * 8);
    expect(model.pylon.h).toBeLessThanOrEqual(0.5);
    expect(model.pylon.y - model.pylon.h / 2).toBeGreaterThanOrEqual(
      model.serviceBay.h - 0.55,
    );
    expect(model.pylon.y + model.pylon.h / 2).toBeLessThanOrEqual(
      model.serviceBay.h + 0.08,
    );
    expect(model.forecourt.w).toBeGreaterThan(model.serviceBay.w * 0.9);
    expect(garageAnchorNightFloorEmissive(1)).toBeCloseTo(0.12);
    expect(garageAnchorNightFloorEmissive(0)).toBeCloseTo(1.05);
    expect(garageAnchorNightFloorEmissive(-10)).toBeCloseTo(1.05);
    expect(garageAnchorNightFloorEmissive(10)).toBeCloseTo(0.12);
  });
});
