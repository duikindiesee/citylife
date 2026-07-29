// Spec 165 — THE player locomotion speed model. One implementation, in metres per real second,
// shared by both things that move the player:
//
//   1. src/render/components/FirstPersonController.tsx — the camera capsule (Rapier linear
//      velocity, world units = metres). What the player actually FEELS: `runtime.fpCameraCell` is
//      set from this capsule and is authoritative over the twin's `pos` wherever it exists.
//   2. src/colony/runtime.ts `driveFirstPerson` — the roster data twin, whose position is in CELLS.
//
// Before this module the two had SEPARATE integrators that disagreed by 36%: the capsule used a
// private literal 10 (m/s) with no acceleration ramp, no road multiplier and no sprint budget, while
// the twin ramped `COLONY.firstPerson.maxWalkSpeed` (3.4) and applied both multipliers — but added
// the result to a position measured in cells, making it 13.6 m/s walking and 24.65 m/s sprinting.
//
// Everything here is PURE and unit-labelled: `...Mps` is metres per real second, `...CellsPerSec` is
// cells per real second. Both callers hold their own ramp/charge scalars (the capsule can mount with
// no runtime at all — see R3FCityRenderer) but advance them through THESE functions, so the two
// paths cannot drift apart without this file changing. tests/playerSpeedUnits.test.ts locks that.

import { COLONY } from "./config";
import { PLAYER_WALK_SPEED_MPS, mpsToCellsPerSec } from "./scale";

/** Longest tick the locomotion model will integrate, in real seconds. A frame hitch (shader compile,
 *  GC, a backgrounded tab) hands the renderer a `delta` of whole seconds; without this the ramp
 *  snaps to full speed and — much worse — ONE such frame drains the entire sprint budget, because
 *  the drain is dt/sprintChargeSeconds. ColonyRuntime's loop has always clamped its own tick to this
 *  value (`dtReal = Math.min(0.25, ...)`), so the capsule must use the SAME bound or the two paths
 *  diverge again on exactly the frames where it is hardest to notice. Observed in-app: an unclamped
 *  capsule went from a full sprint charge to empty in one stalled frame. */
export const MAX_LOCOMOTION_DT = 0.25;

/** Clamp a renderer/loop delta to something the locomotion model can integrate sanely. */
export function clampLocomotionDt(dt: number): number {
  return Number.isFinite(dt) ? Math.min(Math.max(0, dt), MAX_LOCOMOTION_DT) : 0;
}

/** What the world is doing to the player this tick — the only inputs that scale ground speed. */
export interface PlayerSpeedContext {
  /** The player is standing on a road/path cell (COLONY.firstPerson.roadWalkSpeedMultiplier). */
  onRoad: boolean;
  /** Sprint is actually being spent this tick — Shift held, moving, AND charge left. */
  sprinting: boolean;
}

/** The surface multiplier alone, so a caller can report it without recomputing the chain. */
export function surfaceMultiplier(onRoad: boolean): number {
  const cfg = COLONY.firstPerson;
  return onRoad ? cfg.roadWalkSpeedMultiplier : cfg.offRoadWalkSpeedMultiplier;
}

/** Ground speed in METRES PER REAL SECOND for a fully-ramped player in the given context. This is
 *  the whole speed contract: base anchor x surface x sprint. */
export function playerGroundSpeedMps(ctx: PlayerSpeedContext): number {
  return rampedGroundSpeedMps(PLAYER_WALK_SPEED_MPS, ctx);
}

/** Ground speed in METRES PER REAL SECOND for a player still on the acceleration ramp — `rampMps`
 *  is the current ramped base speed (0..PLAYER_WALK_SPEED_MPS), NOT the anchor. The multipliers
 *  apply on top of the ramp, exactly as the roster twin has always applied them. */
export function rampedGroundSpeedMps(
  rampMps: number,
  ctx: PlayerSpeedContext,
): number {
  const sprint = ctx.sprinting
    ? COLONY.firstPerson.sprintWalkSpeedMultiplier
    : 1;
  return rampMps * surfaceMultiplier(ctx.onRoad) * sprint;
}

/** The same speed in CELLS per real second — for the roster twin, whose `pos` is in cells. The only
 *  supported way to move a cell-space position at the player's speed. */
export function rampedGroundSpeedCellsPerSec(
  rampMps: number,
  ctx: PlayerSpeedContext,
): number {
  return mpsToCellsPerSec(rampedGroundSpeedMps(rampMps, ctx));
}

/** The fastest the player can ever move, in m/s — full ramp, on a road, sprinting. The bound every
 *  other mover in the world (notably the bus fleet) must be tuned against. */
export function playerTopSpeedMps(): number {
  return playerGroundSpeedMps({ onRoad: true, sprinting: true });
}

/** Advance the acceleration ramp one tick, in m/s. Accelerating and decelerating use different
 *  rates (config `walkAcceleration` / `walkDeceleration`, m/s^2) so a release coasts briefly. */
export function advanceWalkRampMps(
  currentMps: number,
  targetMps: number,
  dt: number,
): number {
  const cfg = COLONY.firstPerson;
  if (currentMps < targetMps) {
    return Math.min(targetMps, currentMps + cfg.walkAcceleration * dt);
  }
  if (currentMps > targetMps) {
    const rate = targetMps === 0 ? cfg.walkDeceleration : cfg.walkAcceleration;
    return Math.max(targetMps, currentMps - rate * dt);
  }
  return currentMps;
}

/** Advance the sprint comfort budget one tick. `charge` is 0..1: it drains over
 *  `sprintChargeSeconds` while sprinting and refills over `sprintRecoverySeconds` whenever Shift is
 *  released. Sprinting is only possible while charge remains, so holding Shift forever cannot buy a
 *  permanent 1.45x. */
export function advanceSprintCharge(
  charge: number,
  dt: number,
  opts: { sprintHeld: boolean; sprinting: boolean },
): number {
  const cfg = COLONY.firstPerson;
  if (!opts.sprintHeld) {
    return Math.min(1, charge + dt / cfg.sprintRecoverySeconds);
  }
  if (opts.sprinting) {
    return Math.max(0, charge - dt / cfg.sprintChargeSeconds);
  }
  return charge;
}

/** Whether sprint actually engages this tick — the single predicate both paths use, so one of them
 *  can never grant a 1.45x the other withholds. */
export function isSprinting(opts: {
  sprintHeld: boolean;
  moving: boolean;
  charge: number;
}): boolean {
  return opts.moving && opts.sprintHeld && opts.charge > 0;
}
