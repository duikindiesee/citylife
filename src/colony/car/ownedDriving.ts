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

function getDenseFootprintSamples(
  halfLength: number,
  halfWidth: number,
): readonly [number, number][] {
  return [
    // 5 front bumper points
    [halfLength, -halfWidth],
    [halfLength, -halfWidth * 0.5],
    [halfLength, 0],
    [halfLength, halfWidth * 0.5],
    [halfLength, halfWidth],
    // 3 front-quarter points
    [halfLength * 0.5, -halfWidth],
    [halfLength * 0.5, 0],
    [halfLength * 0.5, halfWidth],
    // 3 center/mid points
    [0, -halfWidth],
    [0, 0],
    [0, halfWidth],
    // 3 rear-quarter points
    [-halfLength * 0.5, -halfWidth],
    [-halfLength * 0.5, 0],
    [-halfLength * 0.5, halfWidth],
    // 5 rear bumper points
    [-halfLength, -halfWidth],
    [-halfLength, -halfWidth * 0.5],
    [-halfLength, 0],
    [-halfLength, halfWidth * 0.5],
    [-halfLength, halfWidth],
  ];
}

function isFootprintClear(
  x: number,
  y: number,
  heading: number,
  canOccupy: (x: number, y: number) => boolean,
  halfLength: number,
  halfWidth: number,
  cellMetres: number,
  isFootprintValid?: (x: number, y: number, heading: number) => boolean,
): boolean {
  if (isFootprintValid && !isFootprintValid(x, y, heading)) return false;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const samples = getDenseFootprintSamples(halfLength, halfWidth);
  for (const [along, across] of samples) {
    const px = x + (cos * along - sin * across) / cellMetres;
    const py = y + (sin * along + cos * across) / cellMetres;
    if (!canOccupy(px, py)) return false;
  }
  return true;
}

interface FootprintInspection {
  front: number;
  center: number;
  rear: number;
  total: number;
}

function inspectFootprint(
  x: number,
  y: number,
  heading: number,
  canOccupy: (x: number, y: number) => boolean,
  halfLength: number,
  halfWidth: number,
  cellMetres: number,
  isFootprintValid?: (x: number, y: number, heading: number) => boolean,
): FootprintInspection {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  let front = 0;
  let center = 0;
  let rear = 0;
  const samples = getDenseFootprintSamples(halfLength, halfWidth);
  for (const [along, across] of samples) {
    const px = x + (cos * along - sin * across) / cellMetres;
    const py = y + (sin * along + cos * across) / cellMetres;
    if (!canOccupy(px, py)) {
      if (along > 0) front++;
      else if (along < 0) rear++;
      else center++;
    }
  }
  if (isFootprintValid && !isFootprintValid(x, y, heading)) {
    // If continuous OBB SAT detects collision, probe front vs rear half to identify
    // whether the obstacle impinges on the front, rear, or spans the chassis.
    const probeDist = halfLength / cellMetres;
    const frontClear = isFootprintValid(
      x + cos * probeDist,
      y + sin * probeDist,
      heading,
    );
    const rearClear = isFootprintValid(
      x - cos * probeDist,
      y - sin * probeDist,
      heading,
    );
    if (!frontClear && rearClear) {
      front++;
    } else if (frontClear && !rearClear) {
      rear++;
    } else {
      front++;
      rear++;
      center++;
    }
  }
  return { front, center, rear, total: front + center + rear };
}

function isStepAllowed(
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  heading: number,
  speed: number,
  canOccupy: (x: number, y: number) => boolean,
  halfLength: number,
  halfWidth: number,
  cellMetres: number,
  isFootprintValid?: (x: number, y: number, heading: number) => boolean,
): boolean {
  if (!canOccupy(targetX, targetY)) return false;

  // Hard gate: SAT clear-to-overlap transition is strictly blocked.
  if (
    isFootprintValid &&
    isFootprintValid(currentX, currentY, heading) &&
    !isFootprintValid(targetX, targetY, heading)
  ) {
    return false;
  }

  const current = inspectFootprint(
    currentX,
    currentY,
    heading,
    canOccupy,
    halfLength,
    halfWidth,
    cellMetres,
    isFootprintValid,
  );

  const target = inspectFootprint(
    targetX,
    targetY,
    heading,
    canOccupy,
    halfLength,
    halfWidth,
    cellMetres,
    isFootprintValid,
  );

  // If 100% clear of all obstacles: step is valid
  if (target.total === 0) return true;

  // Hard gate: Any clear-to-overlap transition is strictly blocked.
  if (current.total === 0 && target.total > 0) return false;

  // If moving forward (speed > 0), front cannot penetrate obstacles
  if (speed > 0 && target.front > 0) return false;

  // If moving backward (speed < 0), rear cannot penetrate obstacles
  if (speed < 0 && target.rear > 0) return false;

  // Directional unsticking / recovery from an already overlapping pose:
  // If moving backward away from an obstacle in front: allowed if rear remains clear
  if (speed < 0 && target.rear === 0 && current.rear === 0) return true;

  // If moving forward away from an obstacle in rear: allowed if front remains clear
  if (speed > 0 && target.front === 0 && current.front === 0) return true;

  return false;
}

/** Real world movement, without the race's checkpoint attraction/teleport correction. */
export function stepOwnedDrive(
  pose: OwnedDrivePose,
  input: OwnedDriveInput,
  stats: CarStatVector,
  delta: number,
  canOccupy: (x: number, y: number) => boolean,
  isRoad?: (x: number, y: number) => boolean,
  isFootprintValid?: (x: number, y: number, heading: number) => boolean,
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

    // Surface physics: off-road applies extra rolling resistance and speed ceiling
    const onRoad = isRoad ? isRoad(next.x, next.y) : true;
    const offRoadMaxMult = cfg.offRoadTopSpeedMultiplier ?? 0.68;
    const offRoadDragVal = cfg.offRoadDrag ?? 2.0;

    let maxSpeed = cfg.topSpeedMps * (0.5 + stats.topSpeed);
    if (!onRoad) {
      maxSpeed *= offRoadMaxMult;
      next.speed *= Math.max(0, 1 - offRoadDragVal * dt);
    }

    next.speed = Math.max(-cfg.reverseMps, Math.min(maxSpeed, next.speed));

    // Steer authority: allows steering even when stationary or moving slowly,
    // and reverses steering direction when moving backwards.
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const movingBackward =
      next.speed < -0.1 ||
      (next.speed <= 0.1 && !!input.reverse && !input.throttle);
    const steerDir = movingBackward ? -1 : 1;
    // Steer authority is at least 0.4 even when stationary, ramping to 1.0 at 2 m/s:
    const steerAuthority = Math.max(0.4, Math.min(1, Math.abs(next.speed) / 2));
    const heading =
      next.heading +
      steer * cfg.steerRadiansPerSecond * steerAuthority * steerDir * dt;

    if (steer !== 0) {
      const currentInspection = inspectFootprint(
        next.x,
        next.y,
        next.heading,
        canOccupy,
        cfg.halfLengthMetres,
        cfg.halfWidthMetres,
        cfg.cellMetres,
        isFootprintValid,
      );
      const targetInspection = inspectFootprint(
        next.x,
        next.y,
        heading,
        canOccupy,
        cfg.halfLengthMetres,
        cfg.halfWidthMetres,
        cfg.cellMetres,
        isFootprintValid,
      );
      // Hard gate: clear-to-overlap transition is strictly blocked.
      // Turn allowed if target heading is completely clear, or preserves/improves unsticking recovery
      if (
        targetInspection.total === 0 ||
        (currentInspection.total > 0 &&
          targetInspection.total <= currentInspection.total)
      ) {
        next.heading = heading;
      }
    }

    const stepX = (Math.cos(next.heading) * next.speed * dt) / cfg.cellMetres;
    const stepY = (Math.sin(next.heading) * next.speed * dt) / cfg.cellMetres;
    const targetX = next.x + stepX;
    const targetY = next.y + stepY;

    // 1. Full translation clear or recovery
    if (
      isStepAllowed(
        next.x,
        next.y,
        targetX,
        targetY,
        next.heading,
        next.speed,
        canOccupy,
        cfg.halfLengthMetres,
        cfg.halfWidthMetres,
        cfg.cellMetres,
        isFootprintValid,
      )
    ) {
      next.x = targetX;
      next.y = targetY;
    } else if (
      // 2. Glancing collision response: slide along X axis if free or recovering
      stepX !== 0 &&
      isStepAllowed(
        next.x,
        next.y,
        targetX,
        next.y,
        next.heading,
        next.speed,
        canOccupy,
        cfg.halfLengthMetres,
        cfg.halfWidthMetres,
        cfg.cellMetres,
        isFootprintValid,
      )
    ) {
      next.x = targetX;
      next.speed *= 0.85;
    } else if (
      // 3. Glancing collision response: slide along Y axis if free or recovering
      stepY !== 0 &&
      isStepAllowed(
        next.x,
        next.y,
        next.x,
        targetY,
        next.heading,
        next.speed,
        canOccupy,
        cfg.halfLengthMetres,
        cfg.halfWidthMetres,
        cfg.cellMetres,
        isFootprintValid,
      )
    ) {
      next.y = targetY;
      next.speed *= 0.85;
    } else {
      // 4. Blocked along both axes: stop translation, but keep heading updated
      next.speed = 0;
      break;
    }
  }
  return next;
}
