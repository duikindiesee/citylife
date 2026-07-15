import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

// A colony must BOOT on every seed. Spec 148 (road connectivity) surfaced but deliberately left out of
// scope a PRE-EXISTING boot crash: on some seeds (e.g. 4) the founders' neighbourhood degenerates to an
// empty `carriage`, so the commercial connector's `nearestPair(car, …)` returns `[undefined, …]` and
// `leastCostPath` dereferences `start.x` on undefined — a construction-time throw, before any
// connectivity pass runs. See docs/specs/148-road-network-one-web.md "Known adjacent issue".
//
// This suite pins the floor contract: constructing a ColonyRuntime never throws, across a broad seed
// sweep. Seed 4 is the documented reproducer; the 1..24 range guards against sibling degenerate seeds.
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

describe("colony boots on every seed (spec 148 known adjacent issue)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: new ColonyRuntime(${seed}) constructs without throwing`, () => {
      expect(() => new ColonyRuntime(seed)).not.toThrow();
    });
  }

  it("seed 4 — the documented reproducer — boots and still lays a real road network", () => {
    // Regression anchor for the empty-founders-carriage crash specifically. Booting must succeed AND
    // still build the distributed city's roads (the commercial high street is widened + merged even
    // when there is no founders' carriage to spur a connector from).
    const rt = new ColonyRuntime(4);
    expect(rt.sim.state.roads.length).toBeGreaterThan(100);
  });
});
