import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { Biome, type Terrain } from "../src/colony/terrain";
import {
  buildRoadRibbons,
  ribbonCoverage,
} from "../src/colony/render/roadRibbon";
import { findJunctionZones } from "../src/colony/render/roadJunctions";
import {
  attachCapPolys,
  capCoverageCells,
} from "../src/colony/render/junctionCap";
import { cellOk, roadCellOk } from "../src/colony/pathfind";

// Spec 140 — roads are never on beaches. The route planner treats Biome.Beach exactly like
// water (pathfind roadCellOk / forbidBeach), so every boot road — corridor spines and their
// dilated carriageways, trunk links, the commercial high street + cross street + connector,
// the rally spur and the landing block frames — bends inland along the grass line. This pins
// the contract the same way tests/roadWaterGuard.test.ts pins the water contract, across the
// same three seeds. Beach stays legal for PLOTS (Beach Cove homesteads, and the future
// boat-launch pad reserved in the spec) — only pavement is banned.

const SEEDS = [4242, 42, 7] as const;

function roadYOf(t: Terrain) {
  return (x: number, y: number) => {
    const gx = Math.max(0, Math.min(t.size - 1, Math.round(x)));
    const gy = Math.max(0, Math.min(t.size - 1, Math.round(y)));
    return t.worldY(gx, gy);
  };
}

function beachRoadCellLabels(rt: ColonyRuntime): string[] {
  const t = rt.sim.state.terrain;
  return rt.sim.state.roads
    .filter((r) => t.biome[t.idx(r.x, r.y)] === Biome.Beach)
    .map((r) => `${r.x},${r.y}:${r.kind}`);
}

function beachRibbonCellLabels(rt: ColonyRuntime): string[] {
  const t = rt.sim.state.terrain;
  const { cells } = buildRoadRibbons(rt.roadWays, {
    terrain: t,
    wx: (x) => x,
    wz: (y) => y,
    roadY: roadYOf(t),
  });
  return [...cells].filter((k) => {
    const [x, y] = k.split(",").map(Number);
    return t.inBounds(x!, y!) && t.biome[t.idx(x!, y!)] === Biome.Beach;
  });
}

function beachCoverageCellLabels(rt: ColonyRuntime): string[] {
  const t = rt.sim.state.terrain;
  const cover = ribbonCoverage(rt.roadWays, t, roadYOf(t));
  return [...cover.keys()].filter((k) => {
    const [x, y] = k.split(",").map(Number);
    return t.inBounds(x!, y!) && t.biome[t.idx(x!, y!)] === Biome.Beach;
  });
}

// Spec 137's junction caps are a SEPARATE draped surface whose graded footprint (capCoverageCells)
// keys off cellOk — which permits beach — not roadCellOk. The caps hull only the carriageways, and
// those are beach-free by routing, so a cap can only reach sand if a junction sits right on the
// grass/sand line. Assert it never does, the same way R3FPlanetRenderer builds the coverage.
function beachCapCoverageCellLabels(rt: ColonyRuntime): string[] {
  const t = rt.sim.state.terrain;
  const zones = attachCapPolys(findJunctionZones(rt.roadWays));
  const cover = capCoverageCells(zones, t, roadYOf(t));
  return [...cover.keys()].filter((k) => {
    const [x, y] = k.split(",").map(Number);
    return t.inBounds(x!, y!) && t.biome[t.idx(x!, y!)] === Biome.Beach;
  });
}

describe("road-on-beach guard (spec 140)", () => {
  for (const seed of SEEDS) {
    it(`keeps every boot road cell, ribbon cell and graded coverage cell off Biome.Beach for seed ${seed}`, () => {
      const rt = new ColonyRuntime(seed);
      expect(beachRoadCellLabels(rt)).toEqual([]);
      expect(beachRibbonCellLabels(rt)).toEqual([]);
      expect(beachCoverageCellLabels(rt)).toEqual([]);
      expect(beachCapCoverageCellLabels(rt)).toEqual([]); // spec 137 junction caps, spec 140 clean
    });
  }

  it("roadCellOk rejects beach cells that plain cellOk (parcels, walking) still accepts", () => {
    const rt = new ColonyRuntime(4242);
    const t = rt.sim.state.terrain;
    let checked = 0;
    for (let y = 0; y < t.size && checked < 25; y++) {
      for (let x = 0; x < t.size && checked < 25; x++) {
        if (t.biome[t.idx(x, y)] !== Biome.Beach) continue;
        if (!cellOk(t, x, y)) continue; // only assert on beach cells that are otherwise good land
        expect(roadCellOk(t, x, y)).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // the seeded map must actually exercise the gate
  });
});
