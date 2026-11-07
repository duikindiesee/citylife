// RACING.PROFILE.1 — authored racing profiles: the physics salvaged from the scrapped Long Beach
// branch, because they were never about Long Beach.
//
// The operator's standing critical is "amazing racing roads". The measured obstacle (spec 169 §0)
// is that the base formula's flat-out turn radius at top speed is 3.1 cells — no corner on any road
// ever forces a lift, so no road can reward braking or grip. The RACING PROFILE fixes that for
// AUTHORED routes only: an optional field on RaceTrack carrying a width, a speed ceiling and the
// §3.2 lateral-grip cap ω ≤ A_LAT·gripScale/|v|. Long Beach was scrapped by operator verdict
// (2026-08-03); these mechanics apply to the island's own future racing roads unchanged.
//
// The load-bearing property, pinned hardest: A TRACK WITHOUT A PROFILE IS BIT-IDENTICAL TO LEGACY.
// Every island rally track has no profile, so the founding world cannot feel this change at all.
import { describe, expect, it } from "vitest";
import {
  newRaceState,
  stepRace,
  type RaceState,
} from "../src/colony/racing/race";
import { makeSignatureTrack } from "../src/colony/racing/signatureTrack";
import type { RaceTrack, RacingProfile } from "../src/colony/racing/track";

const PROFILE: RacingProfile = {
  halfWidthCells: 1.65,
  topSpeedCellsPerSec: 11.5,
  lateralGripCapCellsPerSec2: 14,
};

/** A long synthetic straight — the same fixture shape the legacy race tests drive. */
function straightPath(): { x: number; y: number }[] {
  return Array.from({ length: 200 }, (_, i) => ({ x: 1 + i, y: 1 }));
}

function profiledTrack(): RaceTrack {
  return makeSignatureTrack({
    name: "test route",
    path: straightPath(),
    lengthCells: 199,
    profile: PROFILE,
  });
}

function legacyTrack(): RaceTrack {
  const path = straightPath();
  const roadKinds: RaceTrack["roadKinds"] = {};
  for (const p of path) roadKinds[`${p.x},${p.y}`] = "street";
  return {
    checkpoints: [path[0]!, path[path.length - 1]!],
    path,
    length: 199,
    loop: false,
    seed: 1,
    roadsVersion: 1,
    roadKinds,
  };
}

function running(t: RaceTrack): RaceState {
  const r = newRaceState(t);
  return { ...r, mode: "running", countdownMs: 0 };
}

const norm = (a: number): number => {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
};

describe("RACING.PROFILE.1 — a profiled route", () => {
  it("raises the ceiling to the profile's, not the road kind's", () => {
    const dt = 50;
    let s = running(profiledTrack());
    for (let t = 0; t < 5000; t += dt)
      s = stepRace(s, { accelerate: true }, dt);
    // The carrier kind is "avenue" (8.8); the profile carries 11.5 and must win.
    expect(s.car.speed).toBeCloseTo(11.5, 9);
  });

  it("caps yaw at A_LAT/|v| — closed form, stock car, throttle pinning v at the ceiling", () => {
    const dt = 50;
    let s = running(profiledTrack());
    s.car.speed = 11.5;
    const before = s.car.heading;
    s = stepRace(s, { steer: 1, accelerate: true }, dt);
    const turned = Math.abs(norm(s.car.heading - before));
    expect(turned).toBeCloseTo((14 / 11.5) * (dt / 1000), 5);
    // And decisively below the base formula's 2.85 rad/s.
    expect(turned).toBeLessThan(2.85 * (dt / 1000) * 0.5);
  });

  it("rewards braking: the same lock turns harder at 7 than at 11.5", () => {
    const dt = 50;
    const turnAt = (speed: number): number => {
      let s = running(profiledTrack());
      s.car.speed = speed;
      const before = s.car.heading;
      s = stepRace(s, { steer: 1 }, dt);
      return Math.abs(norm(s.car.heading - before));
    };
    expect(turnAt(7)).toBeGreaterThan(turnAt(11.5) * 1.5);
  });

  it("widens the off-track threshold to the profile's half-width", () => {
    const dt = 50;
    let s = running(profiledTrack());
    s.car.x = 50;
    s.car.y = 1 + 1.2; // 1.2 cells off the centreline: on a 1.65 half-width, still on the road
    s = stepRace(s, {}, dt);
    expect(s.offTrack).toBe(false);
  });
});

describe("RACING.PROFILE.1 — a track WITHOUT a profile is legacy, bit for bit", () => {
  it("street ceiling stays exactly 7.2", () => {
    const dt = 50;
    let s = running(legacyTrack());
    for (let t = 0; t < 4000; t += dt)
      s = stepRace(s, { accelerate: true }, dt);
    expect(s.car.speed).toBeCloseTo(7.2, 9);
  });

  it("yaw stays exactly the base formula, uncapped", () => {
    const dt = 50;
    let s = running(legacyTrack());
    s.car.speed = 6;
    const before = s.car.heading;
    s = stepRace(s, { steer: 1 }, dt);
    expect(Math.abs(norm(s.car.heading - before))).toBeCloseTo(
      (2.25 + 5 * 0.12) * (dt / 1000),
      9,
    );
  });

  it("off-track stays exactly the legacy 0.9", () => {
    const dt = 50;
    let s = running(legacyTrack());
    s.car.x = 50;
    s.car.y = 1 + 1.2;
    s = stepRace(s, {}, dt);
    expect(s.offTrack).toBe(true);
  });
});

describe("RACING.PROFILE.1 — makeSignatureTrack", () => {
  it("produces a legal RaceTrack the unchanged machinery accepts", () => {
    const t = profiledTrack();
    expect(t.checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(t.racingProfile).toEqual(PROFILE);
    const last = t.checkpoints[t.checkpoints.length - 1]!;
    const end = t.path[t.path.length - 1]!;
    expect(Math.hypot(last.x - end.x, last.y - end.y)).toBeLessThan(1e-9);
  });
});
