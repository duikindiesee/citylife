import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildGarageAnchorShellModel } from "../src/colony/render/garageAnchorShell";
import { buildRoadRibbons } from "../src/colony/render/roadRibbon";
import {
  footprintTouchesRoad,
  rectFootprintCells,
  type GridCell,
} from "../src/colony/placementSetback";

const SEEDS = [4242, 42, 7] as const;

function roadSet(rt: ColonyRuntime): Set<string> {
  return new Set(rt.sim.state.roads.map((r) => `${r.x},${r.y}`));
}

function renderedRoadRibbonSet(rt: ColonyRuntime): Set<string> {
  const t = rt.sim.state.terrain;
  return buildRoadRibbons(rt.roadWays, {
    terrain: t,
    wx: (x) => x,
    wz: (y) => y,
    roadY: (x, y) => {
      const gx = Math.max(0, Math.min(t.size - 1, Math.round(x)));
      const gy = Math.max(0, Math.min(t.size - 1, Math.round(y)));
      return t.worldY(gx, gy);
    },
  }).cells;
}

function rotatedRectCells(
  center: { x: number; y: number },
  angle: number,
  rect: { x?: number; z: number; w: number; d: number },
): GridCell[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ox = rect.x ?? 0;
  const corners = [
    { x: ox - rect.w / 2, z: rect.z - rect.d / 2 },
    { x: ox + rect.w / 2, z: rect.z - rect.d / 2 },
    { x: ox - rect.w / 2, z: rect.z + rect.d / 2 },
    { x: ox + rect.w / 2, z: rect.z + rect.d / 2 },
  ].map((p) => ({
    x: center.x + p.x * cos + p.z * sin,
    y: center.y - p.x * sin + p.z * cos,
  }));
  const minX = Math.floor(Math.min(...corners.map((c) => c.x)));
  const maxX = Math.ceil(Math.max(...corners.map((c) => c.x)));
  const minY = Math.floor(Math.min(...corners.map((c) => c.y)));
  const maxY = Math.ceil(Math.max(...corners.map((c) => c.y)));
  const cells: GridCell[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      const localX = dx * cos - dy * sin;
      const localZ = dx * sin + dy * cos;
      if (
        Math.abs(localX - ox) <= rect.w / 2 + 1e-6 &&
        localZ >= rect.z - rect.d / 2 - 1e-6 &&
        localZ <= rect.z + rect.d / 2 + 1e-6
      ) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function garageVisualFootprintCells(rt: ColonyRuntime): GridCell[] {
  const garage = rt.commercialDistrict!.garagePad!;
  const model = buildGarageAnchorShellModel(garage, () => 0);
  return [
    ...rotatedRectCells(model.center, model.facingAngle, {
      z: model.forecourt.frontOffset,
      w: model.forecourt.w,
      d: model.forecourt.d,
    }),
    ...rotatedRectCells(model.center, model.facingAngle, {
      z: 0,
      w: model.nightFloor.w,
      d: model.nightFloor.d,
    }),
    ...rotatedRectCells(model.center, model.facingAngle, {
      x: model.pylon.x,
      z: model.pylon.z,
      w: model.pylon.w * 2.35,
      d: model.pylon.d * 1.52,
    }),
    ...model.displayCars.flatMap((car) =>
      rotatedRectCells(model.center, model.facingAngle, {
        x: car.x,
        z: car.z,
        w: 1.26 * car.scale,
        d: 0.62 * car.scale,
      }),
    ),
  ];
}

function garageForecourtCells(rt: ColonyRuntime): GridCell[] {
  const garage = rt.commercialDistrict!.garagePad!;
  const model = buildGarageAnchorShellModel(garage, () => 0);
  return rotatedRectCells(model.center, model.facingAngle, {
    z: model.forecourt.frontOffset,
    w: model.forecourt.w,
    d: model.forecourt.d,
  });
}

describe("spec 114 no floor touches final road setback invariant", () => {
  it("keeps the corner garage pad and forecourt off and one cell back from final roads", () => {
    for (const seed of SEEDS) {
      const rt = new ColonyRuntime(seed);
      const roads = roadSet(rt);
      const garage = rt.commercialDistrict!.garagePad!;
      expect(
        footprintTouchesRoad(rectFootprintCells(garage), roads),
        `seed ${seed} garage pad touches final road`,
      ).toBe(false);
      expect(
        footprintTouchesRoad(garageForecourtCells(rt), roads),
        `seed ${seed} garage forecourt touches final road`,
      ).toBe(false);
    }
  }, 30000);

  it("keeps the garage visual brown forecourt sign and floor clear of rendered grey road ribbons", () => {
    for (const seed of SEEDS) {
      const rt = new ColonyRuntime(seed);
      const renderedRoads = renderedRoadRibbonSet(rt);
      expect(
        footprintTouchesRoad(garageVisualFootprintCells(rt), renderedRoads),
        `seed ${seed} garage visual footprint touches rendered road ribbon`,
      ).toBe(false);
    }
  }, 30000);

  it("keeps every lot fence ring off and one cell back from final roads", () => {
    for (const seed of SEEDS) {
      const rt = new ColonyRuntime(seed);
      const roads = roadSet(rt);
      for (const lot of rt.lots()) {
        expect(
          footprintTouchesRoad(lot.fence, roads),
          `seed ${seed} ${lot.id} fence ring touches final road`,
        ).toBe(false);
      }
    }
  }, 30000);
});
