/**
 * Shared coordinate convention between Three.js first-person camera yaw (Euler Y in radians)
 * and world / wire heading (in radians, where cos(heading) points to +worldX, sin(heading) points to +worldZ).
 *
 * Three.js camera at yaw=0 looks down -Z (camera forward = (0, -1)).
 * In world coordinates:
 *   heading -PI/2 -> (0, -1) [-Z]
 *   heading 0     -> (1, 0)  [+X]
 *   heading PI/2  -> (0, 1)  [+Z]
 *   heading PI    -> (-1, 0) [-X]
 *
 * For camera yaw Y:
 *   forward vector = (-sin(Y), -cos(Y))
 *   strafe vector  = (cos(Y), -sin(Y))
 *
 * Matching wire heading:
 *   wireHeading = atan2(-cos(Y), -sin(Y))
 *
 * Inverse:
 *   cameraYaw = -heading - PI/2
 */

export function cameraYawToWireHeading(yaw: number): number {
  return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
}

export function wireHeadingToCameraYaw(heading: number): number {
  return -heading - Math.PI / 2;
}

export function cameraYawToWorldForward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function cameraYawToWorldRight(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

export function headingToWorldDirection(heading: number): { x: number; z: number } {
  return { x: Math.cos(heading), z: Math.sin(heading) };
}

export function normalizeAngle(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
