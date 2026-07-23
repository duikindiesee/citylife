import { describe, expect, it } from "vitest";
import {
  canonicalSolClock,
  CITYLIFE_EPOCH_MS,
  MINUTES_PER_SOL,
  MS_PER_SOL,
  secondsToNextSol,
  solClockOfDay,
  solMinuteOfDay,
  solMinutesSinceEpoch,
  solPhase,
  solsSinceEpoch,
} from "../src/colony/sol";

describe("canonical CityLife clock — four six-hour sols per Johannesburg day", () => {
  it("anchors Sol 0 at the start of the first commit day", () => {
    expect(new Date(CITYLIFE_EPOCH_MS).toISOString()).toBe(
      "2026-05-29T22:00:00.000Z",
    );
    expect(canonicalSolClock(CITYLIFE_EPOCH_MS)).toEqual({
      sol: 0,
      earthDay: 0,
      solOfEarthDay: 0,
      hour: 0,
      minute: 0,
      isDay: false,
    });
  });

  it("starts a new sol every six real hours and four each day", () => {
    expect(canonicalSolClock(CITYLIFE_EPOCH_MS + MS_PER_SOL)).toMatchObject({
      sol: 1,
      earthDay: 0,
      solOfEarthDay: 1,
      hour: 0,
    });
    expect(canonicalSolClock(CITYLIFE_EPOCH_MS + 4 * MS_PER_SOL)).toMatchObject(
      {
        sol: 4,
        earthDay: 1,
        solOfEarthDay: 0,
        hour: 0,
      },
    );
  });

  it("compresses a full 24-hour sol into six real hours", () => {
    const after15RealMinutes = canonicalSolClock(
      CITYLIFE_EPOCH_MS + 15 * 60 * 1000,
    );
    expect(after15RealMinutes).toMatchObject({ hour: 1, minute: 0 });
    const afterFiveAndAHalfRealHours = canonicalSolClock(
      CITYLIFE_EPOCH_MS + 5.5 * 60 * 60 * 1000,
    );
    expect(afterFiveAndAHalfRealHours).toMatchObject({ hour: 22, minute: 0 });
  });

  it("uses the same daylight boundary as the colony", () => {
    const at = (inSolHour: number) =>
      canonicalSolClock(CITYLIFE_EPOCH_MS + (inSolHour / 24) * MS_PER_SOL)
        .isDay;
    expect(at(5)).toBe(false);
    expect(at(6)).toBe(true);
    expect(at(19)).toBe(true);
    expect(at(20)).toBe(false);
  });

  it("clamps pre-founding and invalid input to Sol 0", () => {
    expect(canonicalSolClock(CITYLIFE_EPOCH_MS - MS_PER_SOL).sol).toBe(0);
    expect(canonicalSolClock(Number.NaN).sol).toBe(0);
  });

  it("retains a six-hour sol boundary countdown", () => {
    expect(secondsToNextSol(CITYLIFE_EPOCH_MS, CITYLIFE_EPOCH_MS)).toBe(21_600);
    expect(
      secondsToNextSol(
        CITYLIFE_EPOCH_MS,
        CITYLIFE_EPOCH_MS + MS_PER_SOL - 1000,
      ),
    ).toBe(1);
  });
});

describe("Spec 150 PR1 — pure sol helpers on the canonical epoch", () => {
  it("solsSinceEpoch counts whole sols from the canonical epoch by default", () => {
    expect(solsSinceEpoch(CITYLIFE_EPOCH_MS)).toBe(0);
    expect(solsSinceEpoch(CITYLIFE_EPOCH_MS + 3 * MS_PER_SOL)).toBe(3);
    // Matches the HUD source: the clock's sol equals the helper for the same instant.
    const now = CITYLIFE_EPOCH_MS + 9 * MS_PER_SOL + 123_456;
    expect(solsSinceEpoch(now)).toBe(canonicalSolClock(now).sol);
  });

  it("solsSinceEpoch accepts an injected epoch and clamps invalid input to zero", () => {
    const epoch = 5_000_000_000_000;
    expect(solsSinceEpoch(epoch + 2 * MS_PER_SOL, epoch)).toBe(2);
    expect(solsSinceEpoch(epoch - MS_PER_SOL, epoch)).toBe(0);
    expect(solsSinceEpoch(Number.NaN, epoch)).toBe(0);
    expect(solsSinceEpoch(epoch, Number.NaN)).toBe(0);
  });

  it("solMinutesSinceEpoch accumulates compressed in-sol minutes across sols", () => {
    expect(solMinutesSinceEpoch(CITYLIFE_EPOCH_MS)).toBe(0);
    // Fifteen real minutes is one compressed in-sol hour.
    expect(solMinutesSinceEpoch(CITYLIFE_EPOCH_MS + 15 * 60 * 1000)).toBe(60);
    // A whole sol is a whole 24-hour in-sol day.
    expect(solMinutesSinceEpoch(CITYLIFE_EPOCH_MS + MS_PER_SOL)).toBe(
      MINUTES_PER_SOL,
    );
    expect(solMinutesSinceEpoch(CITYLIFE_EPOCH_MS + 2 * MS_PER_SOL)).toBe(
      2 * MINUTES_PER_SOL,
    );
  });

  it("solMinuteOfDay and solClockOfDay wrap within one 24-hour sol day", () => {
    const at = CITYLIFE_EPOCH_MS + MS_PER_SOL + 5.5 * 60 * 60 * 1000;
    expect(solMinuteOfDay(at)).toBe(22 * 60);
    expect(solClockOfDay(at)).toEqual({ hour: 22, minute: 0 });
    // Agrees with canonicalSolClock for the same instant.
    const clock = canonicalSolClock(at);
    expect(solClockOfDay(at)).toEqual({
      hour: clock.hour,
      minute: clock.minute,
    });
  });

  it("solPhase reports normalized progress through the current sol in [0, 1)", () => {
    expect(solPhase(CITYLIFE_EPOCH_MS)).toBe(0);
    expect(solPhase(CITYLIFE_EPOCH_MS + MS_PER_SOL / 4)).toBeCloseTo(0.25, 10);
    expect(solPhase(CITYLIFE_EPOCH_MS + MS_PER_SOL / 2)).toBeCloseTo(0.5, 10);
    // Resets at each sol boundary rather than reaching 1.
    expect(solPhase(CITYLIFE_EPOCH_MS + MS_PER_SOL)).toBe(0);
    expect(solPhase(CITYLIFE_EPOCH_MS - MS_PER_SOL)).toBe(0);
  });
});
