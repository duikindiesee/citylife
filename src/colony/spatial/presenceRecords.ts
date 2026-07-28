// BUG.GEO.1 — the one adapter that turns runtime avatar poses into spec-152 presence RECORDS.
//
// Everything downstream (readout, HUD, screenshot text) reads the record list, so this is the single
// place a grid-cell pose becomes a frame-local presence address. It deliberately projects through
// `avatarTransform` — the exact transform the R3F avatar layer places citizens with — rather than
// re-deriving the world point from the sim grid. A readout that agreed with the sim but not with the
// renderer would mislocate the very screenshot it exists to locate.
import { avatarTransform } from "../render/avatarLayer";
import type { PresenceRecord, PresenceSubjectKind } from "./presenceReadout";

/** A grid-cell pose in the island's surface grid, exactly as the roster holds it. */
export interface GridPose {
  readonly x: number;
  readonly y: number;
  /** Grid-space facing in radians, as the roster stores it (atan2 of travel direction). */
  readonly heading: number;
}

export interface AvatarPresenceSource {
  readonly subjectId: string;
  readonly displayName: string;
  readonly subjectKind: PresenceSubjectKind;
  readonly isLocal: boolean;
  /** `null` when the runtime holds no authoritative pose. It is never substituted with a home cell. */
  readonly pose: GridPose | null;
}

export interface SurfacePresenceOptions {
  /** The frame the surface grid belongs to — the presence address's frame. */
  readonly surfaceFrameId: string;
  /** Heightfield resolution in cells; the renderer's grid->world transform is centred on it. */
  readonly terrainSize: number;
  /** Ground height sampler, the same one the avatar layer is fed. */
  readonly groundY: (x: number, y: number) => number;
}

/** Non-finite input is not a position. Treated exactly like a missing pose: hidden, never guessed. */
function finitePose(pose: GridPose | null): GridPose | null {
  if (!pose) return null;
  return Number.isFinite(pose.x) &&
    Number.isFinite(pose.y) &&
    Number.isFinite(pose.heading)
    ? pose
    : null;
}

/**
 * Build the presence record list for subjects standing on the island surface frame. Records keep the
 * caller's order so the caller owns which entry is shown first.
 */
export function surfacePresenceRecords(
  sources: readonly AvatarPresenceSource[],
  options: SurfacePresenceOptions,
): PresenceRecord[] {
  return sources.map((source) => {
    const pose = finitePose(source.pose);
    if (!pose)
      return {
        subjectId: source.subjectId,
        displayName: source.displayName,
        subjectKind: source.subjectKind,
        isLocal: source.isLocal,
        location: null,
        headingRadians: null,
      };
    const transform = avatarTransform(
      pose,
      options.terrainSize,
      options.groundY,
    );
    return {
      subjectId: source.subjectId,
      displayName: source.displayName,
      subjectKind: source.subjectKind,
      isLocal: source.isLocal,
      location: {
        frameId: options.surfaceFrameId,
        point: { x: transform.wx, y: transform.wy, z: transform.wz },
      },
      // The renderer's world yaw, not the raw grid heading, so the printed facing matches the drawn one.
      headingRadians: transform.rotY,
    };
  });
}
