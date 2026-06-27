import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildGarageAnchorShellModel } from "../src/colony/render/garageAnchorShell";
import {
  footprintTouchesRoad,
  rectFootprintCells,
  type GridCell,
} from "../src/colony/placementSetback";

const SEEDS = [4242, 42, 7] as const;

function roadSet(rt: ColonyRuntime): Set<string> {
  return new Set(rt.sim.state.roads.map((r) => `${r.x},${r.y}`));
}

function garageForecourtCells(rt: ColonyRuntime): GridCell[] {
  const garage = rt.commercialDistrict!.garagePad!;
  const model = buildGarageAnchorShellModel(garage, () => 0);
  const cos = Math.cos(model.facingAngle);
  const sin = Math.sin(model.facingAngle);
  const center = model.center;
  const corners = [
    {
      x: -model.forecourt.w / 2,
      z: model.forecourt.frontOffset - model.forecourt.d / 2,
    },
    {
      x: model.forecourt.w / 2,
      z: model.forecourt.frontOffset - model.forecourt.d / 2,
    },
    {
      x: -model.forecourt.w / 2,
      z: model.forecourt.frontOffset + model.forecourt.d / 2,
    },
    {
      x: model.forecourt.w / 2,
      z: model.forecourt.frontOffset + model.forecourt.d / 2,
    },
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
        Math.abs(localX) <= model.forecourt.w / 2 + 1e-6 &&
        localZ >= model.forecourt.frontOffset - model.forecourt.d / 2 - 1e-6 &&
        localZ <= model.forecourt.frontOffset + model.forecourt.d / 2 + 1e-6
      ) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
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
