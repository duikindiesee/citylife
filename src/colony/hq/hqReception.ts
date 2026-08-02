// HQ.VIEW.1 — the geometry and camera rules of the Kooker HQ reception, as pure data.
//
// Everything here is arithmetic over the spec-152 reception frame, with no three.js, no React and no
// DOM, so the room's shape and the camera's limits are node-testable. HqReceptionView.tsx renders
// exactly these numbers and adds nothing of its own — if the room is the wrong size or the camera can
// escape it, a unit test says so rather than a human noticing in a screenshot.
//
// The room's dimensions are NOT restated here. They are imported from `kookerHqInterior.ts`, which is
// the authoritative spatial-layer source and what the world document is actually built from. A second
// copy of "12 by 10" would be a second thing to keep in sync, and the whole reason HQ took this long is
// that its interior lived in one file while nothing else agreed where it was.
import {
  KOOKER_HQ_RECEPTION_WIDTH_CELLS,
  KOOKER_HQ_RECEPTION_DEPTH_CELLS,
  KOOKER_HQ_RECEPTION_CELL_SIZE,
} from "../spatial/kookerHqInterior";

/** Interior metres. The reception grid is 1 m per cell (spec 152), so these are the room in metres. */
export const HQ_ROOM_WIDTH_M =
  KOOKER_HQ_RECEPTION_WIDTH_CELLS * KOOKER_HQ_RECEPTION_CELL_SIZE;
export const HQ_ROOM_DEPTH_M =
  KOOKER_HQ_RECEPTION_DEPTH_CELLS * KOOKER_HQ_RECEPTION_CELL_SIZE;

/** Wall height. Reception is a double-height entrance — this is what makes it read as a lobby rather
 *  than an office, and spec 153's commons opens off the back wall at the same height. */
export const HQ_WALL_HEIGHT_M = 5.2;

/** The door sits centred on the z=0 wall and opens along +Z into the room (the authored idiom). */
export const HQ_DOOR_WIDTH_M = 2.4;
export const HQ_DOOR_HEIGHT_M = 3.0;

/**
 * Camera orbit radius limits, in metres from the room centre.
 *
 * These are SMALL on purpose, and the first draft got them wrong: at a 13 m limit the camera sat
 * 9.08 m from the centre of a room whose smallest half-dimension is 5 m — orbiting straight through
 * the walls and showing the lobby from outside. A 12x10 room simply does not let an orbit camera back
 * up far. The bound below keeps the whole sweep inside the shell with a margin for the near plane, and
 * `hqCameraPosition` is the single place that turns it into a position so the view and the test can
 * never disagree about where the camera actually ends up.
 */
export const HQ_CAMERA_MIN_M = 2;
export const HQ_CAMERA_MAX_M = 4.4;
/** Fixed elevation above the floor plane — a standing eyeline, tilted slightly down. */
export const HQ_CAMERA_POLAR_RAD = (14 * Math.PI) / 180;
/** Eye height the camera looks at and orbits about: a standing citizen's eyeline. */
export const HQ_EYE_HEIGHT_M = 1.7;

/**
 * Where the camera sits for a given orbit angle. The ONE place this is computed — HqReceptionView
 * calls it every frame and the test sweeps it over a full turn to prove the camera never leaves the
 * room. A second copy of this arithmetic in the view is exactly how the first version escaped.
 */
export function hqCameraPosition(
  azimuthRad: number,
  distanceM: number = HQ_CAMERA_MAX_M,
): { x: number; y: number; z: number } {
  const d = clampHqCameraDistance(distanceM);
  const horizontal = d * Math.cos(HQ_CAMERA_POLAR_RAD);
  return {
    x: Math.sin(azimuthRad) * horizontal,
    y: HQ_EYE_HEIGHT_M + d * Math.sin(HQ_CAMERA_POLAR_RAD),
    z: Math.cos(azimuthRad) * horizontal,
  };
}

/** Clamp a requested orbit distance into the bounded range. Mirrors clampShowroomZoom's contract:
 *  a non-finite request resolves to the far limit rather than NaN-ing the camera. */
export function clampHqCameraDistance(requested: number): number {
  if (!Number.isFinite(requested)) return HQ_CAMERA_MAX_M;
  if (requested < HQ_CAMERA_MIN_M) return HQ_CAMERA_MIN_M;
  if (requested > HQ_CAMERA_MAX_M) return HQ_CAMERA_MAX_M;
  return requested;
}

export interface HqWallSegment {
  /** Centre of the wall panel, room-local metres. Origin is the room centre, floor at y = 0. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Panel size: width along its own run, then height. */
  readonly w: number;
  readonly h: number;
  /** Yaw about Y. 0 faces +Z. */
  readonly yaw: number;
  readonly id: string;
}

/**
 * The four walls, with the front wall split into three panels around the doorway so the opening is a
 * real hole rather than a texture. Room-local metres, origin at the room centre, floor at y = 0.
 *
 * Deterministic and order-stable: same constants in, same list out, so a test can name a panel.
 */
export function hqWallSegments(): HqWallSegment[] {
  const hw = HQ_ROOM_WIDTH_M / 2;
  const hd = HQ_ROOM_DEPTH_M / 2;
  const h = HQ_WALL_HEIGHT_M;
  const doorHalf = HQ_DOOR_WIDTH_M / 2;
  // Width of the wall either side of the doorway.
  const sideW = hw - doorHalf;
  // The lintel above the door: full door width, from the door head to the ceiling.
  const lintelH = h - HQ_DOOR_HEIGHT_M;

  return [
    // Back wall (the far one you face on entering — spec 153 opens the commons through here).
    { id: "back", x: 0, y: h / 2, z: hd, w: HQ_ROOM_WIDTH_M, h, yaw: 0 },
    // Side walls.
    {
      id: "left",
      x: -hw,
      y: h / 2,
      z: 0,
      w: HQ_ROOM_DEPTH_M,
      h,
      yaw: Math.PI / 2,
    },
    {
      id: "right",
      x: hw,
      y: h / 2,
      z: 0,
      w: HQ_ROOM_DEPTH_M,
      h,
      yaw: Math.PI / 2,
    },
    // Front wall, in three pieces around the street door.
    {
      id: "front-left",
      x: -(doorHalf + sideW / 2),
      y: h / 2,
      z: -hd,
      w: sideW,
      h,
      yaw: 0,
    },
    {
      id: "front-right",
      x: doorHalf + sideW / 2,
      y: h / 2,
      z: -hd,
      w: sideW,
      h,
      yaw: 0,
    },
    {
      id: "front-lintel",
      x: 0,
      y: HQ_DOOR_HEIGHT_M + lintelH / 2,
      z: -hd,
      w: HQ_DOOR_WIDTH_M,
      h: lintelH,
      yaw: 0,
    },
  ];
}

/** The doorway opening in room-local metres — what the exit prompt anchors to. */
export function hqDoorway(): {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
} {
  return {
    x: 0,
    y: HQ_DOOR_HEIGHT_M / 2,
    z: -HQ_ROOM_DEPTH_M / 2,
    w: HQ_DOOR_WIDTH_M,
    h: HQ_DOOR_HEIGHT_M,
  };
}
