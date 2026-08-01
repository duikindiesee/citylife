import { nearestTrackPoint, type RaceTrack } from "./track";
import { STOCK_STATS, type CarStatVector } from "../car/carSpec";

export type RaceMode = "idle" | "countdown" | "running" | "finished";

export interface RaceCar {
  x: number;
  y: number;
  heading: number;
  speed: number;
}

export interface RaceCheckpoint {
  x: number;
  y: number;
  crossed: boolean;
}

export interface RaceInput {
  accelerate?: boolean;
  brake?: boolean;
  steerLeft?: boolean;
  steerRight?: boolean;
  handbrake?: boolean;
  steer?: number;
}

export interface RaceDriveInput {
  steer: number;
  throttle: boolean;
  brake: boolean;
  handbrake: boolean;
}

export interface OrientationLike {
  gamma: number | null;
  beta: number | null;
}

export interface GamepadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

// CAR.STATS.DRIVE.1 — the car's stats actually drive the car.
//
// `deriveStats()` was computed in exactly ONE place on main: the garage panel's headline "tune points"
// readout. `driveCar` below ran on hardcoded literals and never saw the vector, so no bolted-on part
// and no car choice changed how anything drove — a blower and a stock rod were byte-identical on the
// road, and the only thing a purchase moved was the number on the buy screen. carParts.ts's own header
// ("The race reads deriveStats() for handling") described an intention, not the code.
//
// Each stat is 0..1 with 0.5 = stock, so the multiplier is 1 at 0.5 BY CONSTRUCTION: a stock car
// reproduces main's handling exactly, digit for digit, and only a tuned car deviates. That property is
// asserted in tests/raceCarStats.test.ts — this must stay a wiring change, not a re-tune.
const statScale = (stat: number, spread: number): number =>
  1 + (clamp(stat, 0, 1) - 0.5) * 2 * spread;

/** How far a fully-built (1.0) or gutted (0.0) car may swing from the stock figure, per stat. Chosen so
 *  the best obtainable build is decisively quicker without making the stock car feel broken: the parts
 *  catalog tops out near 0.8, i.e. +15% top speed and +21% acceleration, not double. */
const TOP_SPEED_SPREAD = 0.25;
const ACCELERATION_SPREAD = 0.35;
const BRAKING_SPREAD = 0.3;
const GRIP_SPREAD = 0.25;

const RACE_STEER_DEADZONE = 0.15;
const GYRO_STEER_DEADZONE_DEGREES = 2;
const GYRO_STEER_FULL_LOCK_DEGREES = 30;

export function normalizeRaceDriveInput(input: RaceInput): RaceDriveInput {
  const keySteer = (input.steerLeft ? -1 : 0) + (input.steerRight ? 1 : 0);
  return {
    steer: clamp(keySteer + clamp(input.steer ?? 0, -1, 1), -1, 1),
    throttle: input.accelerate === true,
    brake: input.brake === true,
    handbrake: input.handbrake === true,
  };
}

export function gyroSteerFromOrientation(
  orientation: OrientationLike,
  baseline: OrientationLike,
): number {
  const gamma = finiteOrNull(orientation.gamma);
  const baseGamma = finiteOrNull(baseline.gamma);
  if (gamma === null || baseGamma === null) return 0;
  const delta = gamma - baseGamma;
  if (Math.abs(delta) < GYRO_STEER_DEADZONE_DEGREES) return 0;
  return clamp(delta / GYRO_STEER_FULL_LOCK_DEGREES, -1, 1);
}

export function gamepadRaceInput(gamepad: GamepadLike): RaceInput {
  const stick = finiteNumber(gamepad.axes[0]);
  const dpadLeft = gamepad.buttons[14]?.pressed === true;
  const dpadRight = gamepad.buttons[15]?.pressed === true;
  const dpadSteer = (dpadLeft ? -1 : 0) + (dpadRight ? 1 : 0);
  const steer =
    Math.abs(stick) >= RACE_STEER_DEADZONE ? clamp(stick, -1, 1) : dpadSteer;
  return {
    steer,
    accelerate: gamepad.buttons[0]?.pressed === true,
    brake: gamepad.buttons[1]?.pressed === true,
  };
}

function finiteNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface RaceState {
  mode: RaceMode;
  track: RaceTrack;
  car: RaceCar;
  /** CAR.STATS.DRIVE.1 — the EFFECTIVE stats of the car being driven (base + mounted parts), resolved
   *  once at the start line. Held on the state rather than read per-frame so a race cannot change car
   *  mid-lap and so this module stays free of the garage/storage layer. */
  stats: CarStatVector;
  checkpoints: RaceCheckpoint[];
  nextCheckpoint: number;
  countdownMs: number;
  raceTimeMs: number;
  finishedMs: number | null;
  offTrack: boolean;
}

export const RACE_COUNTDOWN_MS = 3000;
export const CHECKPOINT_RADIUS = 1.15;

export function newRaceState(
  track: RaceTrack,
  /** The driver's effective stats, from carParts.deriveStats(). Omitted = a stock car, which drives
   *  exactly as the race always has. */
  stats: CarStatVector = STOCK_STATS,
): RaceState {
  const start = track.checkpoints[0] ?? track.path[0] ?? { x: 0, y: 0 };
  const next = track.path.find((p) => p.x !== start.x || p.y !== start.y) ??
    track.checkpoints[1] ?? { x: start.x + 1, y: start.y };
  return {
    mode: "countdown",
    track,
    car: {
      x: start.x,
      y: start.y,
      heading: Math.atan2(next.y - start.y, next.x - start.x),
      speed: 0,
    },
    stats: { ...stats },
    checkpoints: track.checkpoints.map((p, i) => ({
      x: p.x,
      y: p.y,
      crossed: i === 0,
    })),
    nextCheckpoint: track.checkpoints.length > 1 ? 1 : 0,
    countdownMs: RACE_COUNTDOWN_MS,
    raceTimeMs: 0,
    finishedMs: null,
    offTrack: false,
  };
}

export function stepRace(
  state: RaceState,
  input: RaceInput,
  dtMs: number,
): RaceState {
  const dt = Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
  const next = cloneState(state);
  if (next.mode === "idle" || next.mode === "finished" || dt === 0) return next;
  if (next.mode === "countdown") {
    const used = Math.min(next.countdownMs, dt);
    next.countdownMs -= used;
    const leftover = dt - used;
    if (next.countdownMs <= 0) next.mode = "running";
    if (leftover <= 0) return next;
    return stepRace(next, input, leftover);
  }
  next.raceTimeMs += dt;
  driveCar(next, input, dt / 1000);
  advanceCheckpoint(next);
  return next;
}

export function crossedCheckpoint(state: RaceState, idx: number): boolean {
  const cp = state.checkpoints[idx];
  if (!cp) return false;
  return (
    Math.hypot(state.car.x - cp.x, state.car.y - cp.y) <= CHECKPOINT_RADIUS
  );
}

export function isFinished(state: RaceState): boolean {
  return state.mode === "finished";
}

function cloneState(state: RaceState): RaceState {
  return {
    ...state,
    car: { ...state.car },
    stats: { ...state.stats },
    checkpoints: state.checkpoints.map((c) => ({ ...c })),
  };
}

function driveCar(state: RaceState, input: RaceInput, dt: number): void {
  const car = state.car;
  const before = nearestTrackPoint(state.track, car.x, car.y);
  const cell =
    state.track.path[
      Math.max(0, Math.min(state.track.path.length - 1, before.pathIndex))
    ] ?? state.track.path[0];
  const kind = cell
    ? (state.track.roadKinds[`${cell.x},${cell.y}`] ?? "street")
    : "street";
  const onTrack = before.distance <= 0.9;
  // CAR.STATS.DRIVE.1 — the road kind still sets the ceiling; the car's top-speed stat scales it, so a
  // blown motor is faster everywhere rather than only on the avenues.
  const stats = state.stats ?? STOCK_STATS;
  const maxForward =
    (kind === "avenue" ? 8.8 : kind === "street" ? 7.2 : 4.8) *
    statScale(stats.topSpeed, TOP_SPEED_SPREAD) *
    (onTrack ? 1 : 0.48);
  const maxReverse = onTrack ? -2.8 : -1.4;

  const drive = normalizeRaceDriveInput(input);
  if (drive.throttle)
    car.speed += 13.5 * statScale(stats.acceleration, ACCELERATION_SPREAD) * dt;
  // Only the braking figure scales: the 7 is the reverse gear pulling away backwards, not a stop.
  if (drive.brake)
    car.speed -=
      car.speed > 0.2
        ? 16 * statScale(stats.braking, BRAKING_SPREAD) * dt
        : 7 * dt;
  if (!drive.throttle && !drive.brake) car.speed *= Math.max(0, 1 - 2.2 * dt);
  if (drive.handbrake) car.speed *= Math.max(0, 1 - 1.8 * dt);
  car.speed = clamp(car.speed, maxReverse, maxForward);

  if (drive.steer !== 0 && Math.abs(car.speed) > 0.05) {
    const dir = car.speed >= 0 ? 1 : -1;
    const handbrake = drive.handbrake ? 1.45 : 1;
    // Grip is cornering: slicks and a ducktail turn the car harder at the same speed. This is the stat
    // the operator's ducktail complaint was actually about — it had no effect whatsoever.
    car.heading +=
      drive.steer *
      dir *
      (2.25 + Math.min(5, Math.abs(car.speed)) * 0.12) *
      statScale(stats.grip, GRIP_SPREAD) *
      handbrake *
      dt;
  }

  car.x += Math.cos(car.heading) * car.speed * dt;
  car.y += Math.sin(car.heading) * car.speed * dt;

  const after = nearestTrackPoint(state.track, car.x, car.y);
  state.offTrack = after.distance > 0.9;
  if (state.offTrack) {
    const pull = Math.min(0.45, after.distance * 0.08 + dt * 0.35);
    car.x += (after.x - car.x) * pull;
    car.y += (after.y - car.y) * pull;
    car.speed *= Math.max(0, 1 - 1.2 * dt);
  }
}

function advanceCheckpoint(state: RaceState): void {
  if (state.mode !== "running") return;
  if (state.nextCheckpoint < state.checkpoints.length) {
    if (!crossedCheckpoint(state, state.nextCheckpoint)) return;
    state.checkpoints[state.nextCheckpoint]!.crossed = true;
    state.nextCheckpoint++;
    if (state.nextCheckpoint >= state.checkpoints.length && !state.track.loop)
      finish(state);
    return;
  }
  if (state.track.loop && crossedCheckpoint(state, 0)) finish(state);
}

function finish(state: RaceState): void {
  state.mode = "finished";
  state.finishedMs = state.raceTimeMs;
  state.car.speed = 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
