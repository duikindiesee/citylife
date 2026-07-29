import { describe, expect, it } from "vitest";
// @ts-ignore - Vite raw import pins the capsule's speed source so the fork cannot recur.
import capsuleSource from "../src/render/components/FirstPersonController.tsx?raw";
// @ts-ignore - and the runtime loop's tick clamp, which must stay the shared one.
import runtimeSource from "../src/colony/runtime.ts?raw";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import {
  CELL_SIZE,
  PLAYER_WALK_SPEED_MPS,
  mpsToCellsPerSec,
} from "../src/colony/scale";
import {
  MAX_LOCOMOTION_DT,
  advanceSprintCharge,
  advanceWalkRampMps,
  clampLocomotionDt,
  playerGroundSpeedMps,
  playerTopSpeedMps,
  rampedGroundSpeedMps,
} from "../src/colony/playerSpeed";

// Spec 165 — the player had TWO movement integrators that disagreed by 36%, because ONE config
// number was read as metres in one place and cells in the other.
//
//   capsule (FirstPersonController) : Rapier linvel of a private literal 10 -> 10.0 m/s walking
//   twin    (runtime.driveFirstPerson): COLONY.firstPerson.maxWalkSpeed 3.4 added to a CELL position
//                                       -> 3.4 * CELL_SIZE = 13.6 m/s walking, 24.65 m/s sprinting
//
// Metres are authoritative (spec 146 anchors 1 world unit = 1 m and makes scale.ts the single source
// of truth), so the twin — whose position is in cells — is the path that converts. These locks fail
// if either path re-forks the number, drops the conversion, or stops honouring a multiplier.

/** What the twin's speed WOULD be if someone deleted the metres->cells conversion again: the m/s
 *  value added straight to a cell position, i.e. CELL_SIZE times too fast. */
const UNCONVERTED_MPS = PLAYER_WALK_SPEED_MPS * CELL_SIZE; // 13.6 — the shipped defect

const CAPSULE_SRC: string = capsuleSource;
const RUNTIME_SRC: string = runtimeSource;

/** Walk the real runtime in a straight line and return metres covered per real second, measured
 *  from the CELL displacement of the roster twin — the units the twin actually stores. */
function measureTwinMps(opts: { onRoad: boolean; sprint: boolean }): number {
  const rt = new ColonyRuntime(4242);
  const me = rt.getUiState().citizens.list[0]!;
  const terrain = rt.sim.state.terrain;
  const roadSet = rt.sim.state.roadSet;
  const key = (x: number, y: number) => `${x},${y}`;
  const blocked = (x: number, y: number) =>
    terrain.isWater(x, y) ||
    rt.sim.state.buildings.some(
      (b) => Math.round(b.x) === x && Math.round(b.y) === y,
    ) ||
    (rt.sim.state.occupied.has(key(x, y)) && !roadSet.has(key(x, y)));

  // Heading 0 walks +x, so the run needs a clear lane ahead in x for the whole measured distance.
  const LANE = 4;
  const laneOk = (x: number, y: number) => {
    for (let i = 0; i <= LANE; i++) {
      if (x + i >= terrain.size - 1) return false;
      if (blocked(x + i, y)) return false;
      if (roadSet.has(key(x + i, y)) !== opts.onRoad) return false;
    }
    return true;
  };
  let start: { x: number; y: number } | null = null;
  for (let y = 1; y < terrain.size - 1 && !start; y++) {
    for (let x = 1; x < terrain.size - LANE - 2 && !start; x++) {
      if (laneOk(x, y)) start = { x, y };
    }
  }
  if (!start)
    throw new Error(
      `test terrain needs a clear ${opts.onRoad ? "road" : "off-road"} lane`,
    );

  rt.enterFirstPerson(me.id);
  expect(rt.placeFirstPersonDogfood(start, 0)).toBe(true);
  rt.setFpKey("KeyW", true);
  if (opts.sprint) rt.setFpKey("ShiftLeft", true);
  // Saturate the acceleration ramp first (PLAYER_WALK_SPEED_MPS / walkAcceleration = 0.34 s), so
  // what follows is steady-state speed and not the ramp.
  const TICK = 0.02;
  for (let i = 0; i < 25; i++) rt.stepFirstPersonDogfood(TICK);
  const before = { ...rt.getUiState().firstPerson.view!.citizen.positionXY };
  const TICKS = 5;
  for (let i = 0; i < TICKS; i++) rt.stepFirstPersonDogfood(TICK);
  const after = rt.getUiState().firstPerson.view!.citizen.positionXY;
  rt.setFpKey("KeyW", false);
  rt.setFpKey("ShiftLeft", false);
  expect(rt.getUiState().firstPerson.blockedReason).toBeNull();

  const cells = Math.hypot(after.x - before.x, after.y - before.y);
  // cells -> metres, then per real second. THIS is the conversion under test.
  return (cells * CELL_SIZE) / (TICK * TICKS);
}

describe("spec 165 — one speed anchor, in metres, for both movement paths", () => {
  it("keeps ONE anchor: config re-exports scale.ts rather than holding a second copy", () => {
    expect(COLONY.firstPerson.maxWalkSpeed).toBe(PLAYER_WALK_SPEED_MPS);

    // DISCRIMINATION: the shipped pair was 3.4 (config, applied as cells) against a private 10 in
    // the capsule. Neither number can be reconstructed from the anchor now, and the two paths
    // differed by exactly the 36% the report measured.
    expect(UNCONVERTED_MPS).toBeCloseTo(13.6, 6);
    expect(UNCONVERTED_MPS / 10).toBeCloseTo(1.36, 6);
  });

  it("moves the roster twin at the METRE anchor, not the anchor read as cells", () => {
    const measured = measureTwinMps({ onRoad: false, sprint: false });
    expect(measured).toBeCloseTo(PLAYER_WALK_SPEED_MPS, 3);

    // DISCRIMINATION: this is the exact assertion the shipped code failed. Before the fix the twin
    // covered CELL_SIZE times as much ground, because m/s went onto a cell position unconverted.
    expect(measured).not.toBeCloseTo(UNCONVERTED_MPS, 1);
    expect(measured).toBeLessThan(UNCONVERTED_MPS / 3);
  });

  it("applies the road and sprint multipliers to the twin in the same metres", () => {
    for (const [onRoad, sprint] of [
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const measured = measureTwinMps({ onRoad, sprint });
      expect(measured).toBeCloseTo(
        playerGroundSpeedMps({ onRoad, sprinting: sprint }),
        3,
      );
    }
  });

  it("computes the CAPSULE's speed from the same shared model, in metres", () => {
    // The capsule sets a Rapier linear velocity in world units, and spec 146 fixes 1 unit = 1 m, so
    // the model's m/s IS the capsule's velocity — no conversion. The twin is the converting path.
    for (const [onRoad, sprinting] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const capsuleMps = rampedGroundSpeedMps(PLAYER_WALK_SPEED_MPS, {
        onRoad,
        sprinting,
      });
      const twinCellsPerSec = mpsToCellsPerSec(capsuleMps);
      // The two paths agree exactly when the twin's cells/s, read back as metres, is the capsule's
      // m/s. A future edit that drops the conversion on either side breaks this.
      expect(twinCellsPerSec * CELL_SIZE).toBeCloseTo(capsuleMps, 9);
      expect(capsuleMps).toBeCloseTo(measureModel(onRoad, sprinting), 9);
    }
  });

  it("leaves NO private speed literal in the capsule — the way the fork happened", () => {
    const src = CAPSULE_SRC;
    // It must take its speed from the shared model...
    expect(src).toMatch(/from "\.\.\/\.\.\/colony\/playerSpeed"/);
    expect(src).toMatch(/rampedGroundSpeedMps\(/);
    // ...and must not re-declare one. This is the literal regression: `const MOVEMENT_SPEED = 10`.
    expect(src).not.toMatch(/const\s+MOVEMENT_SPEED\s*=/);
    expect(src).not.toMatch(/multiplyScalar\(\s*\d/);
  });

  it("honours the twin's features the capsule used to ignore entirely", () => {
    // The capsule had no ramp, no road multiplier and no sprint budget. All three now come from the
    // shared model, so the capsule cannot silently lack one.
    const src = CAPSULE_SRC;
    expect(src).toMatch(/advanceWalkRampMps\(/); // acceleration ramp
    expect(src).toMatch(/roadSet/); // road surface multiplier
    expect(src).toMatch(/advanceSprintCharge\(/); // sprint comfort budget
    expect(src).toMatch(/isSprinting\(/);
  });

  it("survives a frame hitch: one stalled frame cannot eat the whole sprint budget", () => {
    // FOUND BY RUNNING THE APP, not by reading it. useFrame hands the capsule a raw `delta`, and a
    // shader-compile stall made that delta whole seconds: the sprint charge went 1 -> 0 in a SINGLE
    // frame, against a 3 s design budget. ColonyRuntime's loop had always clamped its tick to 0.25;
    // the capsule did not, so the two paths diverged on exactly the frames nobody is watching.
    const HITCH = 4; // seconds in one frame — what the stall actually produced
    expect(clampLocomotionDt(HITCH)).toBe(MAX_LOCOMOTION_DT);

    // Clamped, a hitch spends at most one clamped tick of the budget...
    const clamped = advanceSprintCharge(1, clampLocomotionDt(HITCH), {
      sprintHeld: true,
      sprinting: true,
    });
    expect(clamped).toBeCloseTo(
      1 - MAX_LOCOMOTION_DT / COLONY.firstPerson.sprintChargeSeconds,
      9,
    );
    expect(clamped).toBeGreaterThan(0.9);

    // DISCRIMINATION: unclamped, that same frame empties it outright — the measured defect.
    const unclamped = advanceSprintCharge(1, HITCH, {
      sprintHeld: true,
      sprinting: true,
    });
    expect(unclamped).toBe(0);

    // ...and the ramp cannot teleport to full speed either.
    expect(advanceWalkRampMps(0, PLAYER_WALK_SPEED_MPS, HITCH)).toBe(
      PLAYER_WALK_SPEED_MPS,
    );
    expect(
      advanceWalkRampMps(0, PLAYER_WALK_SPEED_MPS, clampLocomotionDt(HITCH)),
    ).toBeLessThan(PLAYER_WALK_SPEED_MPS);

    // Garbage deltas must not poison the state either.
    expect(clampLocomotionDt(Number.NaN)).toBe(0);
    expect(clampLocomotionDt(-1)).toBe(0);

    // BOTH paths must apply it — the capsule via clampLocomotionDt, the runtime loop via the same
    // shared constant. A future edit that drops either one fails here.
    expect(CAPSULE_SRC).toMatch(/clampLocomotionDt\(delta\)/);
    expect(RUNTIME_SRC).toMatch(/Math\.min\(MAX_LOCOMOTION_DT,/);
  });

  it("keeps the player a human being and not a 36 km/h giant", () => {
    // The defect that hid behind the units mismatch: a 1.8 m adult moving at 10 m/s (36 km/h) in a
    // world spec 146 deliberately anchored at 1 unit = 1 m.
    expect(PLAYER_WALK_SPEED_MPS).toBeGreaterThan(2.5); // still brisk enough to cross a 2.4 km region
    expect(PLAYER_WALK_SPEED_MPS).toBeLessThan(5);
    // Even the absolute best case — full ramp, on a road, sprinting — stays under the 100 m world
    // record average pace (10.44 m/s). Before the fix the twin sprinted at 24.65 m/s.
    expect(playerTopSpeedMps()).toBeLessThan(10.44);
    expect(playerTopSpeedMps()).toBeCloseTo(6.1625, 4);
    expect(
      UNCONVERTED_MPS *
        COLONY.firstPerson.roadWalkSpeedMultiplier *
        COLONY.firstPerson.sprintWalkSpeedMultiplier,
    ).toBeGreaterThan(10.44);
  });
});

/** The model evaluated independently of the exported helper, so the helper cannot pass by echoing
 *  itself: base anchor x surface x sprint, spelled out from config. */
function measureModel(onRoad: boolean, sprinting: boolean): number {
  const cfg = COLONY.firstPerson;
  return (
    PLAYER_WALK_SPEED_MPS *
    (onRoad ? cfg.roadWalkSpeedMultiplier : cfg.offRoadWalkSpeedMultiplier) *
    (sprinting ? cfg.sprintWalkSpeedMultiplier : 1)
  );
}
