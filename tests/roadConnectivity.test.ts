import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  roadComponents,
  largestComponentShare,
} from "../src/colony/roadConnectivity";

// Spec 148 — THE ROAD NETWORK IS ONE WEB. World View kept showing "missing road": road segments that
// plainly did not join. The cause was not the beach ban (that IMPROVED connectivity, 90%->97%) but
// pieces merged into `state.roads` as ISLANDS — most often the commercial cross street the mall pad
// severs from its own high street, and a rally stub the homesteads wall off. The runtime now runs a
// connectivity-repair pass at the end of boot: it routes a short, coastal-legal connector from every
// orphan to the main web, so every settlement's roads reach the network. These tests pin that contract
// on the seed suite (4242/7/42, matching districtDeterminism/roadsPlan/commerceDistrict) and document
// the only legitimate exceptions: a piece a legal road CANNOT reach — across water (a future bridge,
// spec 133/138) or walled by a homestead setback (an embedded rally overlook, spec 097 fail-soft).

const SEEDS = [4242, 7, 42];

describe("road connectivity — one connected web (spec 148)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: the whole road network is a single connected component`, () => {
      const rt = new ColonyRuntime(seed);
      const t = rt.sim.state.terrain;
      const roads = rt.sim.state.roads;
      expect(roads.length).toBeGreaterThan(100); // a real distributed city was built
      const comps = roadComponents(roads, t.size);
      // The repair pass connects every orphan a legal road can reach; on the seed suite that is all of
      // them, so exactly ONE component remains. If this ever regresses to >1, the message names the
      // orphan sizes so the failure is legible.
      expect(
        comps.length,
        `seed ${seed} has ${comps.length} road components; orphan sizes = [${comps
          .slice(1)
          .map((c) => c.size)
          .join(", ")}]`,
      ).toBe(1);
      expect(largestComponentShare(roads, t.size)).toBe(1);
    });
  }

  it("every road cell has a 4-neighbour on the network (no floating single cells)", () => {
    const rt = new ColonyRuntime(4242);
    const set = new Set(rt.sim.state.roads.map((r) => `${r.x},${r.y}`));
    let isolated = 0;
    for (const r of rt.sim.state.roads) {
      const linked =
        set.has(`${r.x + 1},${r.y}`) ||
        set.has(`${r.x - 1},${r.y}`) ||
        set.has(`${r.x},${r.y + 1}`) ||
        set.has(`${r.x},${r.y - 1}`);
      if (!linked) isolated++;
    }
    expect(isolated).toBe(0);
  });

  it("the connectivity repair is deterministic — the same seed lays the identical network", () => {
    const fingerprint = (seed: number) =>
      new ColonyRuntime(seed).sim.state.roads
        .map((r) => `${r.x},${r.y},${r.kind ?? "street"}`)
        .sort()
        .join("|");
    for (const seed of SEEDS) {
      expect(fingerprint(seed), `seed ${seed} not deterministic`).toBe(
        fingerprint(seed),
      );
    }
  });

  it("the largest-component share is a well-formed fraction, and 1 when fully connected", () => {
    // Contract for the invariant helper the runtime's boot warning also reads: the general floor is
    // >= 99% of cells in one web; a residual orphan is only ever a water-locked or setback-walled
    // exception, never a routing miss the repair pass should have closed.
    for (const seed of SEEDS) {
      const rt = new ColonyRuntime(seed);
      const share = largestComponentShare(
        rt.sim.state.roads,
        rt.sim.state.terrain.size,
      );
      expect(share).toBeGreaterThanOrEqual(0.99);
      expect(share).toBeLessThanOrEqual(1);
    }
  });
});
