import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { Biome, type Terrain } from "../src/colony/terrain";
import { cellOk, roadCellOk } from "../src/colony/pathfind";

// Spec 140 — roads are never on beaches. The route planner treats Biome.Beach exactly like
// water (pathfind roadCellOk / forbidBeach), so every boot road CELL — corridor spines and
// their dilated carriageways, trunk links, the commercial high street + cross street +
// connector, the rally spur and the landing block frames — bends inland along the grass line.
// This pins that ROUTING contract across the same three seeds as the water guard.
//
// Spec 140 amendment: the ban is on the road NETWORK (state.roads cells), NOT on the rendered
// ribbon's every pixel. A ribbon is ~half-a-carriageway wider than its centre-line, so a road
// running the grass line right beside the beach has its outer edge graze a beach cell. The
// render guard (roadRibbon.cellOkOn) used to drop the whole cross-section there, SHATTERING the
// ribbon into ragged holes ("the beach is breaking the roads"); it now only shatters over water.
// So we assert the ROUTING contract (zero road cells on Beach) — the meaningful "no roads on the
// beach" guarantee — and no longer the over-strict "zero ribbon pixels on Beach", which cost more
// than it bought. Beach stays legal for PLOTS (Beach Cove homesteads, the future boat-launch pad).

const SEEDS = [4242, 42, 7] as const;

function beachRoadCellLabels(rt: ColonyRuntime): string[] {
  const t = rt.sim.state.terrain;
  return rt.sim.state.roads
    .filter((r) => t.biome[t.idx(r.x, r.y)] === Biome.Beach)
    .map((r) => `${r.x},${r.y}:${r.kind}`);
}

describe("road-on-beach guard (spec 140)", () => {
  for (const seed of SEEDS) {
    it(`keeps every boot road NETWORK cell off Biome.Beach for seed ${seed}`, () => {
      const rt = new ColonyRuntime(seed);
      // The routing contract: no cell in the drivable road network sits on the sand.
      expect(beachRoadCellLabels(rt)).toEqual([]);
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
