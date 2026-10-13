import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { Biome } from "../src/colony/terrain";
import { ribbonSurfaceCells } from "../src/colony/render/roadRibbon";
import { busLoopPath, samplePath } from "../src/colony/transit/path";
import { roadPath } from "../src/colony/traffic";

const CANONICAL_SEEDS = [4242, 42, 7, 16, 29, 46] as const;
const BUS_SEEDS = [4242, 42, 7] as const;

function cellsFromSet(
  cells: ReadonlySet<string>,
  px: number,
  py: number,
  limit = 6,
): number {
  let best = Infinity;
  const cx = Math.round(px);
  const cy = Math.round(py);
  for (let r = 0; r <= limit && best > r - 0.5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!cells.has(`${cx + dx},${cy + dy}`)) continue;
        best = Math.min(best, Math.hypot(px - (cx + dx), py - (cy + dy)));
      }
    }
  }
  return best;
}

describe("ROAD.NET.CANON.1 — one road graph for render, transit and driving", () => {
  it("renders an authored transit-loop surface under every driven bus-route sample", () => {
    for (const seed of BUS_SEEDS) {
      const rt = new ColonyRuntime(seed, { surveyOnly: true } as never);
      expect(rt.busRoute, `seed ${seed} routes a bus loop`).not.toBeNull();

      const surface = ribbonSurfaceCells(
        rt.sim.state.roadWays ?? [],
        rt.sim.state.terrain,
      );
      const loopPath = busLoopPath(rt.busRoute!.loop);
      const uncovered: string[] = [];

      for (let s = 0; s < loopPath.total; s += 0.5) {
        const p = samplePath(loopPath, s);
        if (cellsFromSet(surface, p.x, p.y) > 2) {
          uncovered.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
        }
      }

      expect(uncovered, `seed ${seed} missing bus ribbon samples`).toEqual([]);
      expect(
        rt.sim.state.roadWays?.some((way) => way.source === "transit-loop"),
      ).toBe(true);
    }
  });

  it("keeps the canonical graph terrain-safe and internally synchronized across adversarial seeds", () => {
    for (const seed of CANONICAL_SEEDS) {
      const rt = new ColonyRuntime(seed, { surveyOnly: true } as never);
      const roadKeys = new Set(rt.sim.state.roads.map((r) => `${r.x},${r.y}`));
      const badWater = rt.sim.state.roads.filter((r) =>
        rt.sim.state.terrain.isWater(r.x, r.y),
      );
      const badBeach = rt.sim.state.roads.filter(
        (r) =>
          rt.sim.state.terrain.biome[
            rt.sim.state.terrain.idx(r.x, r.y)
          ] === Biome.Beach,
      );
      const missingKind = rt.sim.state.roads.filter(
        (r) => !rt.sim.state.roadKind.has(`${r.x},${r.y}`),
      );
      const rendererOnlyKind = [...rt.sim.state.roadKind.keys()].filter(
        (k) => !roadKeys.has(k),
      );

      expect(badWater, `seed ${seed} canonicalized water roads`).toEqual([]);
      expect(badBeach, `seed ${seed} canonicalized beach roads`).toEqual([]);
      expect(missingKind, `seed ${seed} roads missing roadKind`).toEqual([]);
      expect(rendererOnlyKind, `seed ${seed} roadKind without roads rows`).toEqual(
        [],
      );
    }
  });

  it("does not backfill renderer-only ribbon shoulders into roadKind", () => {
    for (const seed of [4242, 42, 7] as const) {
      const rt = new ColonyRuntime(seed, { surveyOnly: true } as never);
      const surface = ribbonSurfaceCells(
        rt.sim.state.roadWays ?? [],
        rt.sim.state.terrain,
      );
      const rendererOnly = [...surface].filter(
        (cell) => !rt.sim.state.roadKind.has(cell),
      );

      // Smooth ribbons may cover shoulders/kerbs/beach-adjacent cells. That render footprint is a
      // derived surface, not permission to mutate the canonical drivable graph.
      expect(
        rendererOnly.length,
        `seed ${seed} made ribbon coverage tautological`,
      ).toBeGreaterThan(0);
    }
  });

  it("preserves traffic, depot-spur and rally consumers on the authored graph", () => {
    for (const seed of BUS_SEEDS) {
      const rt = new ColonyRuntime(seed, { surveyOnly: true } as never);
      const stops = rt.busRoute!.stops;
      const carPath = roadPath(
        rt.sim.state,
        stops[0]!.x,
        stops[0]!.y,
        stops.at(-1)!.x,
        stops.at(-1)!.y,
      );
      const badSpur = [...(rt.sim.state.busDepotSpurCells ?? [])].filter(
        (cell) => !rt.sim.state.roadKind.has(cell),
      );
      const rally = rt.sim.state.structures.find((s) => s.kind === "rally");
      const rallyDistance = rally
        ? cellsFromSet(
            new Set(rt.sim.state.roadKind.keys()),
            Math.round(rally.x),
            Math.round(rally.y),
            8,
          )
        : Infinity;

      expect(
        carPath.length,
        `seed ${seed} traffic graph lost connectivity`,
      ).toBeGreaterThan(0);
      expect(badSpur, `seed ${seed} bus spur left canonical graph`).toEqual([]);
      expect(rally, `seed ${seed} has no rally structure`).toBeDefined();
      expect(
        rallyDistance,
        `seed ${seed} rally lost road approach`,
      ).toBeLessThanOrEqual(8);
    }
  });
});
