import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { STATION_STEP_CELLS } from "../src/colony/render/roadClearance";
import { Biome } from "../src/colony/terrain";
import type { Terrain } from "../src/colony/terrain";
import {
  buildRoadRibbons,
  densify,
  roadCentreLine,
  roadRibbonRenderPath,
  type RoadWay,
} from "../src/colony/render/roadRibbon";

const SEEDS = [4242, 42, 7] as const;

function badRoadCellLabels(rt: ColonyRuntime): string[] {
  const t = rt.sim.state.terrain;
  return rt.sim.state.roads
    .filter((r) => {
      const i = t.idx(r.x, r.y);
      return t.biome[i] === Biome.Ocean || t.buildable[i] === 0;
    })
    .map((r) => {
      const i = t.idx(r.x, r.y);
      return `${r.x},${r.y}:${Biome[t.biome[i]!]}:buildable${t.buildable[i]}`;
    });
}

function badRibbonCellLabels(rt: ColonyRuntime): string[] {
  const t = rt.sim.state.terrain;
  const { cells } = buildRoadRibbons(rt.roadWays, {
    terrain: t,
    wx: (x) => x,
    wz: (y) => y,
    roadY: (x, y) => {
      const gx = Math.max(0, Math.min(t.size - 1, Math.round(x)));
      const gy = Math.max(0, Math.min(t.size - 1, Math.round(y)));
      return t.worldY(gx, gy);
    },
  });
  // Spec 133 — the ribbon contract is WATER-only: never over ocean/shallows/river or a
  // water-flagged cell. Rough LAND (buildable 0) is allowed — the ways cross dozens of
  // steep/sunken dry pockets, and excluding them left holes in the asphalt and ungraded
  // dips the walker fell into under the spanning quads. The grading (spec 130) reshapes
  // that ground to meet the road.
  return [...cells]
    .filter((k) => {
      const [x, y] = k.split(",").map(Number);
      if (!t.inBounds(x!, y!)) return true;
      const i = t.idx(x!, y!);
      const b = t.biome[i];
      return (
        b === Biome.Ocean ||
        b === Biome.Shallows ||
        b === Biome.River ||
        t.water[i] === 1
      );
    })
    .map((k) => {
      const [x, y] = k.split(",").map(Number);
      if (!t.inBounds(x!, y!)) return `${k}:out-of-bounds`;
      const i = t.idx(x!, y!);
      return `${k}:${Biome[t.biome[i]!]}:water${t.water[i]}`;
    });
}

describe("road-on-water guard", () => {
  for (const seed of SEEDS) {
    it(`keeps sim road cells and rendered road ribbons off ocean/non-buildable terrain for seed ${seed}`, () => {
      const rt = new ColonyRuntime(seed);
      expect(badRoadCellLabels(rt)).toEqual([]);
      expect(badRibbonCellLabels(rt)).toEqual([]);
    });
  }

  it("falls back to the routed bend when smoothing would cut across water", () => {
    const size = 16;
    const biome = new Uint8Array(size * size).fill(Biome.Plains);
    const water = new Uint8Array(size * size);
    // The corner-cut clamp (ROAD.RIBBON.TURN.1) means a rounded corner now moves at most
    // MAX_CORNER_CUT_CELLS off the routed bend, so the inlet this guard exists for has to sit
    // inside that fillet: (4,5) is the one cell the smoothed bend covers that the routed bend
    // (2,2)->(2,5)->(8,7) never touches.
    water[5 * size + 4] = 1;
    biome[5 * size + 4] = Biome.River;
    const terrain = {
      size,
      biome,
      water,
      inBounds: (x: number, y: number) =>
        x >= 0 && x < size && y >= 0 && y < size,
      idx: (x: number, y: number) => y * size + x,
    } as unknown as Terrain;
    const way: RoadWay = {
      path: [
        { x: 2, y: 2 },
        { x: 2, y: 5 },
        { x: 8, y: 7 },
      ],
      kind: "street",
      width: 4,
    };

    const smoothed = roadCentreLine(way.path, STATION_STEP_CELLS);
    expect(
      smoothed.some(
        (p) => water[Math.round(p.y) * size + Math.round(p.x)] === 1,
      ),
    ).toBe(true);
    expect(roadRibbonRenderPath(way, terrain)).toEqual(
      densify(way.path, STATION_STEP_CELLS),
    );
  });

  it("keeps the seed 4242 Woods1 connector visibly continuous", () => {
    const rt = new ColonyRuntime(4242);
    const terrain = rt.sim.state.terrain;
    const way = rt.roadWays.find((candidate) => {
      const start = candidate.path[0];
      const end = candidate.path.at(-1);
      return (
        start?.x === 179 && start.y === 467 && end?.x === 487 && end.y === 367
      );
    });
    expect(way).toBeDefined();
    // CONTINUITY is the contract, not which branch delivers it. This connector used to reach the
    // water only because textbook Chaikin bowed it there off a string-pulled bend, so the guard had
    // to throw the smoothing away wholesale and render the raw routed polyline. With the corner cut
    // clamped (ROAD.RIBBON.TURN.1) the smoothed line stays on the routed land route, so the ribbon
    // is now BOTH smooth and unbroken. What must never come back is a wet segment: buildRoadRibbons
    // omits those, and every omission is a visible hole in the asphalt.
    const pts = roadRibbonRenderPath(way!, terrain);
    const wet = pts.filter((p) => {
      const gx = Math.round(p.x),
        gy = Math.round(p.y);
      if (!terrain.inBounds(gx, gy)) return true;
      const i = terrain.idx(gx, gy);
      const b = terrain.biome[i];
      return (
        b === Biome.Ocean ||
        b === Biome.Shallows ||
        b === Biome.River ||
        terrain.water[i] === 1
      );
    });
    expect(wet).toEqual([]);
    // and it is the SMOOTHED line that survives now — the fallback is no longer needed here.
    expect(pts).not.toEqual(densify(way!.path, STATION_STEP_CELLS));
  });
});
