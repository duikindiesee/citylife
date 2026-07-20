import { afterEach, describe, expect, it } from "vitest";
import {
  setSolDebugOffsetMs,
  solDebugOffsetMs,
  solNowMs,
} from "../src/colony/solRuntimeClock";
import {
  MINUTES_PER_SOL,
  MS_PER_SOL,
  solClockOfDay,
  solMinutesSinceEpoch,
} from "../src/colony/sol";

const MS_PER_SOL_MINUTE = MS_PER_SOL / MINUTES_PER_SOL;

afterEach(() => setSolDebugOffsetMs(0));

describe("spec 150 PR2 — the one shared sol instant", () => {
  it("is the real clock until a debug offset is set", () => {
    expect(solDebugOffsetMs()).toBe(0);
    const before = Date.now();
    const now = solNowMs();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("shifts every consumer by exactly the offset", () => {
    const baseline = solMinutesSinceEpoch(solNowMs());
    setSolDebugOffsetMs(90 * MS_PER_SOL_MINUTE);
    expect(solDebugOffsetMs()).toBe(90 * MS_PER_SOL_MINUTE);
    // 90 in-sol minutes later — the same shift the fleet, sky and HUD all observe.
    expect(solMinutesSinceEpoch(solNowMs()) - baseline).toBe(90);
  });

  it("resets a non-finite offset rather than poisoning the clock", () => {
    setSolDebugOffsetMs(Number.NaN);
    expect(solDebugOffsetMs()).toBe(0);
    setSolDebugOffsetMs(Number.POSITIVE_INFINITY);
    expect(solDebugOffsetMs()).toBe(0);
  });

  it("an offset that lands the shared instant on a chosen time of day is exact", () => {
    // The same arithmetic debugSetSolTimeOfDay uses: resolve forward to the next hh:mm.
    const targetTod = 5 * 60; // 05:00 — the widened first departure
    const currentTod = solMinutesSinceEpoch(Date.now()) % MINUTES_PER_SOL;
    const delta =
      (((targetTod - currentTod) % MINUTES_PER_SOL) + MINUTES_PER_SOL) %
      MINUTES_PER_SOL;
    setSolDebugOffsetMs(delta * MS_PER_SOL_MINUTE);
    expect(solClockOfDay(solNowMs())).toEqual({ hour: 5, minute: 0 });
  });
});
