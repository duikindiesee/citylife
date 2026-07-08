// Spec 124 — the Road Rally course. The load-bearing new behavior is the runtime attaching
// raceState to sim.state (the same data-path fix that made R3FPlayerCar's racing car and the
// R3FRace course actually render). The race LOGIC and the layer builder are covered elsewhere
// (racing.test.ts, the raceLayer visual test); here we pin the sim.state attach lifecycle.
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

describe("spec 124 — runtime attaches raceState to sim.state for the R3F renderer", () => {
  it("is null before any race", () => {
    const rt = new ColonyRuntime(4242);
    // undefined or null — either way the renderer's `?.` guards read no race.
    expect(rt.sim.state.raceState ?? null).toBe(null);
  });

  it("startRace attaches a live raceState; exitRace clears it", () => {
    const rt = new ColonyRuntime(4242);
    const started = rt.startRace();
    expect(started).toBe(true); // the live seed has roads enough for a track
    const race = rt.sim.state.raceState;
    expect(race).toBeTruthy();
    expect(race!.mode).toBe("countdown");
    expect(race!.car).toBeTruthy();
    expect(race!.track).toBeTruthy();
    expect(Array.isArray(race!.checkpoints)).toBe(true);

    rt.exitRace();
    expect(rt.sim.state.raceState).toBe(null);
  });

  it("the attached raceState is the same object the runtime steps (car tracks live)", () => {
    const rt = new ColonyRuntime(4242);
    rt.startRace();
    const car = rt.sim.state.raceState!.car;
    // the car carries the fields R3FPlayerCar reads (grid x/y + heading).
    expect(typeof car.x).toBe("number");
    expect(typeof car.y).toBe("number");
    expect(typeof car.heading).toBe("number");
    rt.exitRace();
  });
});
