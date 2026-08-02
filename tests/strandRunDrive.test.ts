// Spec 169 §3 — DRIVE THE STRAND RUN. The operator's slice-1 exit criterion, in its strongest
// verifiable form on this slice: a simulated car actually drives the authored route start to finish
// through the UNCHANGED stepRace/checkpoint machinery, the profile ceiling provably bites (the car
// exceeds every legacy road-kind ceiling), and the §3.2 grip cap provably prices corners.
//
// Equally load-bearing: the NO-PROFILE branch is bit-identical to legacy. The founding island's
// rallies must not feel this slice at all — that is what lets the side branch sit unmerged without
// drift risk, and what the assertions at the bottom pin directly (raceCarStats pins the rest).
import { describe, expect, it } from "vitest";
import { buildLongBeachField } from "../src/colony/longbeach/longBeachField";
import {
  STRAND_LATERAL_GRIP_CELLS_PER_SEC2,
  buildStrandRun,
} from "../src/colony/longbeach/strandRun";
import { makeSignatureTrack } from "../src/colony/racing/signatureTrack";
import {
  isFinished,
  newRaceState,
  stepRace,
  type RaceState,
} from "../src/colony/racing/race";
import { nearestTrackPoint, type RaceTrack } from "../src/colony/racing/track";

const field = buildLongBeachField(1);
const run = buildStrandRun(field);
const track = makeSignatureTrack(run);

/** A straight legacy-style street track (no profile) for the bit-identical comparisons. */
function straightTrack(): RaceTrack {
  const path = Array.from({ length: 200 }, (_, i) => ({ x: 1 + i, y: 1 }));
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

describe("Spec 169 — driving the Strand Run", () => {
  it("a pursuit autopilot completes the route through the unchanged race machinery", () => {
    let s = running(track);
    let maxSpeed = 0;
    const stepMs = 50;
    // Generous budget: ~530 cells at an 8-ish average is ~70 s; three minutes means a stall fails.
    const budgetMs = 180_000;
    for (let t = 0; t < budgetMs && !isFinished(s); t += stepMs) {
      const near = nearestTrackPoint(s.track, s.car.x, s.car.y);
      const look =
        s.track.path[Math.min(near.pathIndex + 3, s.track.path.length - 1)]!;
      const desired = Math.atan2(look.y - s.car.y, look.x - s.car.x);
      const err = norm(desired - s.car.heading);
      s = stepRace(
        s,
        {
          steer: Math.max(-1, Math.min(1, err * 2.5)),
          accelerate: Math.abs(err) < 0.5,
          brake: Math.abs(err) > 0.9 && s.car.speed > 5,
        },
        stepMs,
      );
      maxSpeed = Math.max(maxSpeed, s.car.speed);
    }
    expect(isFinished(s), "the run must be completed within the budget").toBe(
      true,
    );
    // The profile ceiling BITES: every legacy kind caps at 8.8, and the car held more than that on
    // the designed straights — this is the number that makes the highway feel like a highway.
    expect(maxSpeed, "top speed on the straights").toBeGreaterThan(10.5);
  });

  it("the §3.2 grip cap prices speed: at the ceiling, yaw is A_LAT/|v|, not the base formula", () => {
    // One deterministic step, full lock, at the Strand ceiling. Base formula would turn at
    // 2.25 + 5·0.12 = 2.85 rad/s; the cap allows A_LAT/|v| = 14/11.5 ≈ 1.217 rad/s. Stock car, so
    // every statScale is exactly 1 and the numbers are closed-form.
    const dt = 50;
    let s = running(track);
    s.car.speed = 11.5;
    s.car.heading = Math.atan2(
      track.path[1]!.y - track.path[0]!.y,
      track.path[1]!.x - track.path[0]!.x,
    );
    const before = s.car.heading;
    // Throttle held: without it, coast-decay drops v to 10.235 inside the step and the cap correctly
    // allows 14/10.235 — the first run of this test measured exactly that, which CONFIRMS the
    // formula but is not the closed-form case. With throttle the ceiling clamp pins v at 11.5.
    s = stepRace(s, { steer: 1, accelerate: true }, dt);
    const turned = Math.abs(norm(s.car.heading - before));
    const capExpected =
      (STRAND_LATERAL_GRIP_CELLS_PER_SEC2 / 11.5) * (dt / 1000);
    expect(turned).toBeCloseTo(capExpected, 5);
    expect(turned).toBeLessThan(2.85 * (dt / 1000) * 0.5);
  });

  it("braking tightens the line: the same lock turns harder at 7 than at 11.5", () => {
    const dt = 50;
    const turnAt = (speed: number): number => {
      let s = running(track);
      s.car.speed = speed;
      const before = s.car.heading;
      s = stepRace(s, { steer: 1 }, dt);
      return Math.abs(norm(s.car.heading - before));
    };
    // 14/7 = 2 rad/s vs 14/11.5 ≈ 1.217 — slower IS tighter, which is the whole §3.2 point.
    expect(turnAt(7)).toBeGreaterThan(turnAt(11.5) * 1.5);
  });

  it("without a profile, nothing changed: legacy ceiling, legacy yaw, legacy off-track", () => {
    const dt = 50;
    // Ceiling: a street still clamps at 7.2 exactly (stock statScale = 1).
    let s = running(straightTrack());
    for (let t = 0; t < 4000; t += dt)
      s = stepRace(s, { accelerate: true }, dt);
    expect(s.car.speed).toBeCloseTo(7.2, 9);

    // Yaw at speed 5+: exactly the base formula, uncapped (2.85 rad/s · dt).
    let y = running(straightTrack());
    y.car.speed = 6;
    const before = y.car.heading;
    y = stepRace(y, { steer: 1 }, dt);
    expect(Math.abs(norm(y.car.heading - before))).toBeCloseTo(
      (2.25 + 5 * 0.12) * (dt / 1000),
      9,
    );

    // Off-track threshold: 1.2 cells off a legacy line is OFF (0.9); the same offset on the Strand's
    // 1.65-cell half-width is ON — the width-awareness is profile-scoped.
    let off = running(straightTrack());
    off.car.x = 50;
    off.car.y = 1 + 1.2;
    off = stepRace(off, {}, dt);
    expect(off.offTrack).toBe(true);

    let onStrand = running(track);
    const p0 = track.path[10]!;
    const p1 = track.path[11]!;
    const h = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    onStrand.car.x = p0.x + Math.cos(h + Math.PI / 2) * 1.2;
    onStrand.car.y = p0.y + Math.sin(h + Math.PI / 2) * 1.2;
    onStrand = stepRace(onStrand, {}, dt);
    expect(onStrand.offTrack).toBe(false);
  });

  it("the signature track is a legal RaceTrack: 4-7 checkpoints, finish at the end", () => {
    expect(track.checkpoints.length).toBeGreaterThanOrEqual(4);
    expect(track.checkpoints.length).toBeLessThanOrEqual(7);
    const last = track.checkpoints[track.checkpoints.length - 1]!;
    const end = track.path[track.path.length - 1]!;
    expect(Math.hypot(last.x - end.x, last.y - end.y)).toBeLessThan(1e-9);
  });
});
