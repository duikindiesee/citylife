import { describe, it, expect } from "vitest";
import { RNG } from "../src/engine/rng";
import { Terrain, Biome } from "../src/colony/terrain";
import { ColonySim } from "../src/colony/sim";

describe("Colony — procedural planet", () => {
  it("generates land, ocean and a coastal buildable landing site", () => {
    const t = new Terrain(new RNG(4242));
    let ocean = 0;
    let flat = 0;
    for (let i = 0; i < t.size * t.size; i++) {
      if (t.biome[i] === Biome.Ocean) ocean++;
      if (t.buildable[i] === 2) flat++;
    }
    expect(ocean).toBeGreaterThan(200); // there is a sea
    expect(flat).toBeGreaterThan(200); // there is buildable land
    const li = t.idx(t.landing.x, t.landing.y);
    expect(t.buildable[li]).toBe(2); // landing is on flat land
    expect(t.distToWater[li]).toBeGreaterThan(0); // ...but on land
    expect(t.distToWater[li]).toBeLessThanOrEqual(7); // ...and coastal
  });

  it("is deterministic for a given seed", () => {
    const a = new Terrain(new RNG(99));
    const b = new Terrain(new RNG(99));
    expect(a.landing).toEqual(b.landing);
    expect(a.elev[1000]).toBe(b.elev[1000]);
  });
});

describe("Colony — off-grid power loop", () => {
  it("charges the lithium battery through the day", () => {
    const sim = new ColonySim(4242);
    const start = sim.state.power.batteryWh;
    for (let i = 0; i < 100; i++) sim.step(); // ~5 sim-hours from 10:00 → mid-afternoon
    expect(sim.state.power.solarW).toBeGreaterThan(0); // sun is up
    expect(sim.state.power.batteryWh).toBeGreaterThanOrEqual(start); // net charging by day
    expect(sim.state.clock.hour).toBeGreaterThan(10);
  });

  it("seeds a caravan, solar panel and battery on land", () => {
    const sim = new ColonySim(4242);
    const kinds = sim.state.structures.map((s) => s.kind);
    expect(kinds).toContain("caravan");
    expect(kinds).toContain("solar");
    expect(kinds).toContain("battery");
    for (const s of sim.state.structures) {
      expect(
        sim.state.terrain.buildable[sim.state.terrain.idx(s.x, s.y)],
      ).not.toBe(0);
    }
  });
});
