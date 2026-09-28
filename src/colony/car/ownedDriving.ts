import { COLONY } from "../config";
import type { CarStatVector } from "./carSpec";

export interface OwnedDrivePose {
  x: number;
  y: number;
  heading: number;
  speed: number; // metres per second; positions are grid cells
}
export interface OwnedDriveInput {
  throttle?: boolean;
  reverse?: boolean;
  left?: boolean;
  right?: boolean;
  brake?: boolean;
}

/** Shared spawn/movement clearance. Check every grid cell intersecting the rotated
 * body, not only the corners: a small obstacle under the middle is still solid.
 * The continuous samples also preserve callers with finer-than-cell constraints.
 */
export function ownedDriveFootprintClear(
  pose: Pick<OwnedDrivePose, "x" | "y" | "heading">,
  canOccupy: (x: number, y: number) => boolean,
): boolean {
  if (![pose.x, pose.y, pose.heading].every(Number.isFinite)) return false;
  const cfg = COLONY.ownedDriving;
  const length = cfg.halfLengthMetres / cfg.cellMetres;
  const width = cfg.halfWidthMetres / cfg.cellMetres;
  const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  for (const along of [-length, 0, length]) {
    for (const across of [-width, width]) {
      if (!canOccupy(pose.x + c * along - s * across, pose.y + s * along + c * across)) return false;
    }
  }
  const rx = Math.abs(c) * length + Math.abs(s) * width;
  const ry = Math.abs(s) * length + Math.abs(c) * width;
  const cellProjection = (Math.abs(c) + Math.abs(s)) / 2;
  for (let x = Math.ceil(pose.x - rx - 0.5); x <= Math.floor(pose.x + rx + 0.5); x++) {
    for (let y = Math.ceil(pose.y - ry - 0.5); y <= Math.floor(pose.y + ry + 0.5); y++) {
      const dx = x - pose.x, dy = y - pose.y;
      // Separating-axis test of the car rectangle and this unit grid cell.
      if (Math.abs(dx) > rx + 0.5 || Math.abs(dy) > ry + 0.5 ||
          Math.abs(dx * c + dy * s) > length + cellProjection ||
          Math.abs(-dx * s + dy * c) > width + cellProjection) continue;
      if (!canOccupy(x, y)) return false;
    }
  }
  return true;
}

/** Real world movement, without the race's checkpoint attraction/teleport correction. */
export function stepOwnedDrive(
  pose: OwnedDrivePose,
  input: OwnedDriveInput,
  stats: CarStatVector,
  delta: number,
  canOccupy: (x: number, y: number) => boolean,
): OwnedDrivePose {
  const cfg = COLONY.ownedDriving;
  const next = { ...pose };
  if (!Number.isFinite(delta) || delta <= 0) return next;
  let remaining = Math.min(delta, cfg.maxFrameSeconds);
  while (remaining > 0) {
    const dt = Math.min(remaining, cfg.substepSeconds);
    remaining -= dt;
    const acceleration = cfg.accelerationMps2 * (0.5 + stats.acceleration);
    if (input.brake) {
      next.speed =
        Math.sign(next.speed) *
        Math.max(
          0,
          Math.abs(next.speed) - cfg.brakingMps2 * (0.5 + stats.braking) * dt,
        );
    } else if (
      input.throttle !== input.reverse &&
      (input.throttle || input.reverse)
    ) {
      next.speed += (input.throttle ? 1 : -1) * acceleration * dt;
    } else {
      next.speed *= Math.max(0, 1 - cfg.coastDrag * dt);
    }
    next.speed = Math.max(
      -cfg.reverseMps,
      Math.min(cfg.topSpeedMps * (0.5 + stats.topSpeed), next.speed),
    );
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const heading =
      next.heading +
      steer *
        cfg.steerRadiansPerSecond *
        Math.min(1, Math.abs(next.speed)) *
        Math.sign(next.speed) *
        dt;
    const x = next.x + (Math.cos(heading) * next.speed * dt) / cfg.cellMetres;
    const y = next.y + (Math.sin(heading) * next.speed * dt) / cfg.cellMetres;
    // Sweep in small bounded steps. The entire footprint must remain on a
    // permitted surface; a long frame cannot jump across a missing road cell.
    if (!ownedDriveFootprintClear({ x, y, heading }, canOccupy)) {
      next.speed = 0;
      break;
    }
    next.x = x;
    next.y = y;
    next.heading = heading;
  }
  return next;
}
