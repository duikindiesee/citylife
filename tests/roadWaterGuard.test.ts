import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { STATION_STEP_CELLS } from "../src/colony/render/roadClearance";
import { Biome } from "../src/colony/terrain";
import type { Terrain } from "../src/colony/terrain";
import {
  buildRoadRibbons,
  chaikin,
  densify,
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
    water[9 * size + 3] = 1;
    biome[9 * size + 3] = Biome.River;
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
        { x: 2, y: 10 },
        { x: 10, y: 10 },
      ],
      kind: "street",
      width: 4,
    };

    const smoothed = densify(chaikin(way.path, 2), STATION_STEP_CELLS);
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
    // Spec 180 R11 — the connector is re-derived from the generator instead of pinned to old
    // coordinates: it is the way that runs from the Woods2 hamlet to the Woods1 hamlet.
    const hoodLots = (key: string) => rt.lots().filter((l) => l.neighborhoodKey === key);
    const near = (p: { x: number; y: number } | undefined, key: string) =>
      p !== undefined &&
      hoodLots(key).some((l) => Math.hypot(l.x - p.x, l.y - p.y) <= 15);
    const way = rt.roadWays.find((candidate) => {
      const start = candidate.path[0];
      const end = candidate.path.at(-1);
      return near(start, "wood2") && near(end, "wood1");
    });
    expect(way).toBeDefined();
    // The old layout's connector hugged a lagoon, so the guard had to fall back to the raw path
    // (pinned as toEqual(densify(path))). The Spec 180 R11 connector keeps clear of the water, so
    // the smoothed path is legitimately used. The intent — a continuous ribbon that never samples
    // water — is asserted directly for whichever path the guard picks.
    const render = roadRibbonRenderPath(way!, terrain);
    const raw = densify(way!.path, STATION_STEP_CELLS);
    const onWater = (p: { x: number; y: number }) =>
      !terrain.inBounds(Math.round(p.x), Math.round(p.y)) ||
      terrain.water[terrain.idx(Math.round(p.x), Math.round(p.y))] === 1;
    expect(render.length).toBeGreaterThan(1);
    expect(render.filter(onWater)).toEqual([]);
    expect(render[0]).toEqual(raw[0]);
    expect(render.at(-1)).toEqual(raw.at(-1));
    // No visible gap: consecutive stations never farther apart than the station step.
    for (let i = 0; i + 1 < render.length; i++) {
      expect(Math.hypot(render[i + 1]!.x - render[i]!.x, render[i + 1]!.y - render[i]!.y)).toBeLessThanOrEqual(
        STATION_STEP_CELLS * 1.01,
      );
    }
  });
});
