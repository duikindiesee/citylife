import { afterEach, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { setSolDebugOffsetMs } from "../src/colony/solRuntimeClock";

// Spec 150 PR2 — the bus fleet is a DETERMINISTIC REPLAY of canonical sol time. These locks assert
// the two properties the rewrite is for: the same sol minute always reproduces the same fleet, and
// sim speed no longer moves it. transitTick is private; the frame loop that normally calls it needs
// a browser, so the driver is invoked directly here.

type Runtime = ColonyRuntime & { transitTick: () => void };

const modesAt = (rt: ColonyRuntime, hour: number, minute: number): string[] => {
  rt.debugSetSolTimeOfDay(hour, minute);
  (rt as unknown as Runtime).transitTick();
  return rt.busFleet!.buses.map((b) => b.mode);
};

afterEach(() => setSolDebugOffsetMs(0));

describe("spec 150 PR2 — the fleet replays canonical sol time", () => {
  it("boots a fleet to drive", () => {
    const rt = new ColonyRuntime();
    expect(rt.busFleet).not.toBeNull();
    expect(rt.busFleet!.buses.length).toBe(COLONY.transit.busesOwned);
  });

  it("reproduces the same fleet for the same sol minute", () => {
    // Two independent runtimes on the same seed, replayed to the same sol time, must agree —
    // this is what makes the fleet a pure function of the clock rather than of frame history.
    const a = new ColonyRuntime();
    const b = new ColonyRuntime();
    expect(modesAt(a, 12, 0)).toEqual(modesAt(b, 12, 0));
  });

  it("parks the whole fleet overnight, before the service window opens", () => {
    const rt = new ColonyRuntime();
    // 01:00 is well before firstDepartureMin (05:00), so nothing may be out on the route.
    expect(modesAt(rt, 1, 0).every((m) => m === "parked")).toBe(true);
  });

  it("has the fleet out on the route inside the service window", () => {
    const rt = new ColonyRuntime();
    expect(modesAt(rt, 12, 0).some((m) => m !== "parked")).toBe(true);
  });

  it("ignores sim speed", () => {
    // The old driver scaled by this.speed; the sol driver must not, or the bus and the sky (which
    // reads the same clock) would drift apart whenever the operator changed speed.
    const slow = new ColonyRuntime();
    const fast = new ColonyRuntime();
    fast.setSpeed(9);
    expect(modesAt(fast, 12, 0)).toEqual(modesAt(slow, 12, 0));
  });

  it("returns to the same fleet after the clock leaves and re-enters a sol minute", () => {
    // Debug time travel jumps the clock away and back. Depending on where the jump lands relative
    // to the anchor this takes either the backward-clock guard (re-anchor and replay a clean day)
    // or the forward day-wrap path; both must converge on the same fleet for the same sol minute.
    const rt = new ColonyRuntime();
    const midday = modesAt(rt, 12, 0);
    modesAt(rt, 2, 0); // away into the night
    expect(modesAt(rt, 12, 0)).toEqual(midday);
  });
});
