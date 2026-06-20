import { describe, it, expect } from "vitest";
import { Simulation } from "../src/engine/simulation";

describe("Logistics — vehicles live on the roads", () => {
  it("spawns a pool of cars and trucks", () => {
    const sim = new Simulation(1234);
    expect(sim.state.vehicles.length).toBeGreaterThan(10);
    expect(sim.state.vehicles.some((v) => v.kind === "car")).toBe(true);
    expect(sim.state.vehicles.some((v) => v.kind === "truck")).toBe(true);
  });

  it("vehicles actually drive (positions change over time)", () => {
    const sim = new Simulation(1234);
    const before = sim.state.vehicles.map((v) => ({ x: v.x, y: v.y }));
    for (let i = 0; i < 500; i++) sim.step();
    const moved = sim.state.vehicles.filter(
      (v, i) => Math.hypot(v.x - before[i]!.x, v.y - before[i]!.y) > 0.5,
    ).length;
    expect(moved).toBeGreaterThan(0);
  });

  it("trucks carry cargo during their freight cycle", () => {
    const sim = new Simulation(5);
    let sawCargo = false;
    for (let i = 0; i < 3000; i++) {
      sim.step();
      if (sim.state.vehicles.some((v) => v.kind === "truck" && v.cargo > 0)) {
        sawCargo = true;
        break;
      }
    }
    expect(sawCargo).toBe(true);
  });
});
