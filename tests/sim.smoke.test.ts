import { describe, it, expect } from "vitest";
import { Simulation } from "../src/engine/simulation";
import { GameAPI } from "../src/engine/api";
import { Governor } from "../src/ai/governor";

describe("Layer 1 — the living city runs itself", () => {
  it("spawns a populated city", () => {
    const sim = new Simulation(1234);
    expect(sim.state.metrics.population).toBeGreaterThan(10);
    expect(sim.state.buildings.length).toBeGreaterThan(20);
    expect(sim.state.businesses.length).toBeGreaterThan(3);
  });

  it("produces an economy over a few sim-weeks (jobs, GDP, finances move)", () => {
    const sim = new Simulation(1234);
    const startTreasury = sim.state.treasury;
    // ~16 sim-days: crosses multiple Fridays -> payroll, taxes, GDP, migration
    for (let i = 0; i < 8000; i++) sim.step();
    const m = sim.state.metrics;
    expect(m.population).toBeGreaterThan(0);
    expect(m.employmentRate).toBeGreaterThan(0);
    expect(m.gdp).toBeGreaterThan(0); // production cleared through the market
    expect(sim.state.treasury).not.toBe(startTreasury); // weekly settlement ran
    expect(sim.state.clock.day).toBeGreaterThanOrEqual(14);
  });
});

describe("Layer 2 — the AI governor closes the loop", () => {
  it("returns schema-valid actions with reasoning and records them", async () => {
    const sim = new Simulation(42);
    const api = new GameAPI(sim);
    const gov = new Governor(api, sim, "heuristic");
    for (let i = 0; i < 3000; i++) sim.step();
    const rec = await gov.checkIn();
    expect(rec.actions.length).toBeGreaterThan(0);
    expect(gov.decisions).toHaveLength(1);
    for (const a of rec.actions) {
      expect(typeof a.action).toBe("string");
      expect(Array.isArray(a.args)).toBe(true);
    }
  });

  it("actually governs: a deficit triggers a revenue response that changes policy", async () => {
    const sim = new Simulation(7);
    const api = new GameAPI(sim);
    const gov = new Governor(api, sim, "heuristic");
    sim.state.treasury = -5000; // force a deficit
    const beforeCommercial = sim.state.taxRates.commercial;
    await gov.checkIn();
    expect(sim.state.taxRates.commercial).toBeGreaterThan(beforeCommercial);
  });
});
