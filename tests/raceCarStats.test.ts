// CAR.STATS.DRIVE.1 — the car's stats must actually drive the car.
//
// THE DEFECT. `deriveStats()` had exactly ONE call site in the whole tree — runtime.ts's garage panel,
// where it produced the headline "tune points" readout. `driveCar` ran on hardcoded literals (13.5
// accel, 16 brake, 8.8/7.2/4.8 top speed by road kind) and never saw the vector. So every part was
// cosmetic to DRIVING: bolting on a blower moved the number on the buy screen and nothing else, and
// two cars with different base stats drove identically. carParts.ts's header claimed "The race reads
// deriveStats() for handling"; it did not.
//
// Two things are asserted here, and BOTH matter:
//   1. A stock car (every stat 0.5) drives exactly as it did before — same figures, digit for digit.
//      This is a wiring fix, not a re-tune, and this suite is what holds it to that.
//   2. A tuned car is measurably different. Each stat is checked through the channel it owns, so a
//      wiring that reaches only one of them cannot pass.
import { describe, expect, it } from "vitest";
import {
  newRaceState,
  stepRace,
  type RaceState,
} from "../src/colony/racing/race";
import type { RaceTrack } from "../src/colony/racing/track";
import { deriveStats } from "../src/colony/car/carParts";
import {
  STOCK_STATS,
  defaultCarSpec,
  type CarSpec,
  type CarStatVector,
} from "../src/colony/car/carSpec";

/** A long straight street. It must be LONG: a car at the 7.2 street ceiling covers 3 cells in under
 *  half a second, and once it runs off the end `driveCar` applies the 0.48 off-track penalty — which
 *  reads as a top speed of 3.25 and silently measures the wrong thing. 200 cells outlasts every run
 *  here (4s of full throttle is ~29 cells). */
const TRACK_CELLS = 200;

function straightTrack(): RaceTrack {
  const path = Array.from({ length: TRACK_CELLS }, (_, i) => ({
    x: 1 + i,
    y: 1,
  }));
  const roadKinds: RaceTrack["roadKinds"] = {};
  for (const p of path) roadKinds[`${p.x},${p.y}`] = "street";
  return {
    checkpoints: [path[0]!, path[path.length - 1]!].map((p) => ({ ...p })),
    path,
    length: TRACK_CELLS - 1,
    loop: false,
    seed: 1,
    roadsVersion: 1,
    roadKinds,
  };
}

/** A race already under way at the start cell, so the countdown does not eat the sampled time. */
function running(stats?: CarStatVector): RaceState {
  const r = newRaceState(straightTrack(), stats);
  return {
    ...r,
    mode: "running",
    countdownMs: 0,
    nextCheckpoint: r.checkpoints.length,
    car: { ...r.car, x: 1, y: 1, speed: 0 },
  };
}

function drive(
  state: RaceState,
  input: Parameters<typeof stepRace>[1],
  ms: number,
  stepMs = 50,
): RaceState {
  let s = state;
  for (let t = 0; t < ms; t += stepMs) s = stepRace(s, input, stepMs);
  return s;
}

function carWith(parts: string[]): CarSpec {
  return { ...defaultCarSpec("driver"), parts };
}

describe("CAR.STATS.DRIVE.1 — a stock car is unchanged", () => {
  it("accelerates at exactly 13.5 cells/s^2, the figure driveCar always used", () => {
    // 0.15s of throttle, short enough that the street's 7.2 ceiling never clamps it.
    const s = drive(running(), { accelerate: true }, 150);
    expect(s.car.speed).toBeCloseTo(13.5 * 0.15, 9);
  });

  it("tops out at exactly 7.2 cells/s on a street", () => {
    const s = drive(running(), { accelerate: true }, 4000);
    expect(s.car.speed).toBeCloseTo(7.2, 9);
  });

  it("an omitted stat vector is the same car as an explicit stock one", () => {
    const a = drive(running(), { accelerate: true, steerLeft: true }, 1000);
    const b = drive(
      running({ ...STOCK_STATS }),
      { accelerate: true, steerLeft: true },
      1000,
    );
    expect(b.car.speed).toBe(a.car.speed);
    expect(b.car.heading).toBe(a.car.heading);
    expect(b.car.x).toBe(a.car.x);
    expect(b.car.y).toBe(a.car.y);
  });
});

describe("CAR.STATS.DRIVE.1 — a tuned car drives differently", () => {
  it("acceleration: a four-barrel and a blower pull away harder", () => {
    const tuned = deriveStats(carWith(["blower", "headers"]));
    // Non-vacuity: the parts must actually raise the stat, or the comparison below proves nothing.
    expect(tuned.acceleration).toBeGreaterThan(STOCK_STATS.acceleration);

    const stock = drive(running(), { accelerate: true }, 150).car.speed;
    const fast = drive(running(tuned), { accelerate: true }, 150).car.speed;
    expect(fast).toBeGreaterThan(stock);
  });

  it("top speed: a blown motor holds a higher ceiling on the same street", () => {
    const tuned = deriveStats(carWith(["blower"]));
    expect(tuned.topSpeed).toBeGreaterThan(STOCK_STATS.topSpeed);

    const stock = drive(running(), { accelerate: true }, 4000).car.speed;
    const fast = drive(running(tuned), { accelerate: true }, 4000).car.speed;
    expect(stock).toBeCloseTo(7.2, 9);
    expect(fast).toBeGreaterThan(7.25);
  });

  it("grip: the ducktail spoiler turns the car harder — the operator's actual complaint", () => {
    const tuned = deriveStats(carWith(["ducktail_spoiler"]));
    expect(tuned.grip).toBeGreaterThan(STOCK_STATS.grip);
    // The ducktail is grip ONLY, so any difference below must have come through the grip channel.
    expect(tuned.topSpeed).toBe(STOCK_STATS.topSpeed);
    expect(tuned.acceleration).toBe(STOCK_STATS.acceleration);

    const turn = (stats?: CarStatVector) => {
      const s = drive(
        running(stats),
        { accelerate: true, steerLeft: true },
        800,
      );
      return Math.abs(s.car.heading);
    };
    expect(turn(tuned)).toBeGreaterThan(turn());
  });

  it("braking: a car with a better braking stat stops in less distance", () => {
    // No part in the catalog touches braking, so this exercises the BASE stats — i.e. the channel by
    // which one car model can out-brake another.
    const strong: CarStatVector = { ...STOCK_STATS, braking: 0.9 };
    const stop = (stats?: CarStatVector) => {
      const rolling = drive(running(stats), { accelerate: true }, 4000);
      return drive(rolling, { brake: true }, 200).car.speed;
    };
    expect(stop(strong)).toBeLessThan(stop());
  });

  it("a purely cosmetic part changes nothing on the road", () => {
    const chrome = deriveStats(carWith(["chrome_pipes"]));
    expect(chrome).toEqual(STOCK_STATS);
    const a = drive(running(), { accelerate: true, steerRight: true }, 1000);
    const b = drive(
      running(chrome),
      { accelerate: true, steerRight: true },
      1000,
    );
    expect(b.car.speed).toBe(a.car.speed);
    expect(b.car.heading).toBe(a.car.heading);
  });
});
