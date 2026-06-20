import { describe, it, expect } from "vitest";
import { ColonySim } from "../src/colony/sim";
import { autoGrow } from "../src/colony/build";

describe("Colony — Phase B construction loop", () => {
  it("starts empty and grows buildings, roads, colonists over time", () => {
    const sim = new ColonySim(4242);
    expect(sim.state.buildings.length).toBe(0);
    const startTreasury = sim.state.treasury;

    const stepsPerDay = (24 * 60) / 3;
    for (let i = 0; i < stepsPerDay * 6; i++) sim.step(); // ~6 sim-days

    expect(startTreasury).toBeGreaterThan(0);
    expect(sim.state.buildings.length).toBeGreaterThan(3); // habitats + solar farms were built
    expect(sim.state.roads.length).toBeGreaterThan(0); // roads were laid
    expect(sim.state.colonists).toBeGreaterThan(2); // colonists arrived
    expect(sim.state.buildingLoad).toBeGreaterThan(0); // habitat power load grew
    expect(sim.state.powerGen).toBeGreaterThan(0); // solar farms were built when the grid ran short
    expect(sim.state.totalJobs).toBeGreaterThan(0); // workplaces created jobs
    expect(
      new Set(sim.state.buildings.map((b) => b.artifact.kind)).size,
    ).toBeGreaterThan(1); // a mix of building types
    expect(Number.isFinite(sim.state.treasury)).toBe(true); // economy settled to a finite balance
  });

  it("a planned build becomes a job that completes into a building", () => {
    const sim = new ColonySim(7);
    const ok = autoGrow(sim.state, sim.rng);
    expect(ok).toBe(true);
    expect(sim.state.jobs.length).toBe(1);
    const jobId = sim.state.jobs[0]!.id;
    for (let i = 0; i < 200; i++) sim.step(); // > buildTime (5 sim-hours)
    expect(sim.state.buildings.some((b) => b.id === jobId)).toBe(true);
  });
});
