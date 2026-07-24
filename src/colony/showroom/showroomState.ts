// PLAYER.GARAGE.1 — pure showroom interaction state: carousel selection and bounded camera zoom.
// No THREE, no React, no randomness — fully node-testable, mirroring the carSpec purity rule.

/** Camera distance bounds for the showroom orbit rig, in metres from the plinth pivot. */
export const SHOWROOM_MIN_ZOOM = 2.5;
export const SHOWROOM_MAX_ZOOM = 8;
export const SHOWROOM_DEFAULT_ZOOM = 5;
/** One zoom button/wheel step. */
export const SHOWROOM_ZOOM_STEP = 0.75;

/** Wrap any integer index onto [0, len). len <= 0 yields 0 so an empty catalog can never crash. */
export function wrapIndex(index: number, len: number): number {
  if (!Number.isInteger(index) || len <= 0) return 0;
  return ((index % len) + len) % len;
}

/** Move the carousel one step left (-1) or right (+1), wrapping at both ends. */
export function stepSelection(
  index: number,
  len: number,
  direction: -1 | 1,
): number {
  return wrapIndex(wrapIndex(index, len) + direction, len);
}

/** Clamp a requested camera distance into the safe showroom envelope. Non-finite input recovers to
 *  the default rather than jamming the camera. */
export function clampShowroomZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return SHOWROOM_DEFAULT_ZOOM;
  return Math.max(SHOWROOM_MIN_ZOOM, Math.min(SHOWROOM_MAX_ZOOM, zoom));
}
