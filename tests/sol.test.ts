import { describe, expect, it } from "vitest";
import {
  canonicalSolClock,
  CITYLIFE_EPOCH_MS,
  MS_PER_SOL,
  secondsToNextSol,
  solCount,
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
    expect(canonicalSolClock(CITYLIFE_EPOCH_MS + 4 * MS_PER_SOL)).toMatchObject({
      sol: 4,
      earthDay: 1,
      solOfEarthDay: 0,
      hour: 0,
    });
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
      canonicalSolClock(
        CITYLIFE_EPOCH_MS + (inSolHour / 24) * MS_PER_SOL,
      ).isDay;
    expect(at(5)).toBe(false);
    expect(at(6)).toBe(true);
    expect(at(19)).toBe(true);
    expect(at(20)).toBe(false);
  });

  it("clamps pre-founding and invalid input to Sol 0", () => {
    expect(canonicalSolClock(CITYLIFE_EPOCH_MS - MS_PER_SOL).sol).toBe(0);
    expect(canonicalSolClock(Number.NaN).sol).toBe(0);
  });

  it("retains generic elapsed-sol and countdown helpers at six hours", () => {
    expect(
      solCount(CITYLIFE_EPOCH_MS, CITYLIFE_EPOCH_MS + 3 * MS_PER_SOL),
    ).toBe(3);
    expect(secondsToNextSol(CITYLIFE_EPOCH_MS, CITYLIFE_EPOCH_MS)).toBe(21_600);
    expect(
      secondsToNextSol(
        CITYLIFE_EPOCH_MS,
        CITYLIFE_EPOCH_MS + MS_PER_SOL - 1000,
      ),
    ).toBe(1);
  });
});
