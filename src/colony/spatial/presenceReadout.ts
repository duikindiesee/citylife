// BUG.GEO.1 — the on-screen geolocation readout, resolved from the spec-152 PRESENCE ADDRESS.
//
// A shared screenshot has to be self-locating: whoever receives it must be able to say exactly where
// the bot/player stood and reproduce that view. This module turns a list of presence RECORDS (frame
// id + frame-local pose, per spec 152 "Presence and occupancy addresses") into the readout the HUD
// paints, and nothing else. Three properties are deliberate and load-bearing:
//
//  1. A RECORD LIST, not a special-cased local player. The local player is one entry with
//     `isLocal: true`. Adding multiplayer or other-bot markers is then a data change (append records)
//     rather than a UI rewrite.
//  2. Spec-152 visibility policy. A viewer resolves a COARSE public frame (building/region) and gets
//     no point at all; an authorized subject resolves the EXACT frame plus its grid/world fix. The
//     coarse branch never carries a coordinate, so redaction cannot be undone from the rendered text.
//  3. No invented poses. A subject without an authoritative pose — or whose frame cannot be resolved
//     against the frame graph — is HIDDEN with a reason. It never falls back to the origin, to a home
//     cell, or to the last known position.
//
// The projection is taken from the projection frame's own declared grid (origin + cellSize), which is
// the same geometry the renderer places cells with. It is never re-derived from raw sim coordinates,
// because a readout that agrees with the source data but not with the rendered world would put the
// marker in the wrong place on the very screenshot it is supposed to locate.
import type {
  SpatialFrame,
  SpatialFrameKind,
  SpatialGrid,
  Vec3,
} from "../worldSurvey";
import {
  DEFAULT_PUBLIC_PRESENCE_KINDS,
  frameAncestry,
  resolveLocationInFrame,
  SpatialLocationError,
  toPublicPresence,
  type SpatialLocation,
} from "./spatialLocation";

export type PresenceSubjectKind = "player" | "bot" | "vehicle";

/**
 * One entry of the authoritative presence list. `location` is the spec-152 presence address: the
 * smallest known frame plus the pose local to it. `null` means the runtime holds no authoritative
 * pose for this subject — which is a fact to be rendered as "unknown", never patched over.
 */
export interface PresenceRecord {
  readonly subjectId: string;
  readonly displayName: string;
  readonly subjectKind: PresenceSubjectKind;
  /** True for the viewer's own player/bot. Exactly one entry should carry it; more is not an error. */
  readonly isLocal: boolean;
  readonly location: SpatialLocation | null;
  /** Facing in radians within `location.frameId`, when the runtime knows it. */
  readonly headingRadians?: number | null;
}

/**
 * The reproducibility stamp burned next to the marker. Seed + canonical sol + layout revision are
 * what let someone else rebuild the same world and stand in the same place.
 */
export interface PresenceStamp {
  readonly worldSeed: number;
  readonly sol: number;
  readonly solHour: number;
  readonly solMinute: number;
  readonly layoutRevision?: string | null;
}

export type PresenceResolution = "exact" | "coarse";

export interface PresenceFrameRef {
  readonly frameId: string;
  readonly address: string;
  readonly kind: SpatialFrameKind;
}

/** An exact positional fix, expressed in one named projection frame. Only ever attached to an
 *  `exact` entry. */
export interface PresenceGridFix {
  /** The frame the fix is expressed in — the frame whose grid the renderer lays cells out on. */
  readonly projectionFrameId: string;
  /** Frame-local metres. */
  readonly world: Vec3;
  /** Fractional grid cell in the projection frame's declared grid; `null` if it declares no grid. */
  readonly cell: { readonly x: number; readonly y: number } | null;
  /**
   * Whether the fix lies inside the projection frame's half-open grid extent. A pose beyond the
   * extent is reported as outside — never clamped back onto the grid, because a clamped marker is a
   * confident lie about where the screenshot was taken.
   */
  readonly withinExtent: boolean;
}

export interface PresenceReadoutEntry {
  readonly subjectId: string;
  readonly displayName: string;
  readonly subjectKind: PresenceSubjectKind;
  readonly isLocal: boolean;
  readonly resolution: PresenceResolution;
  /** `exact` names the presence frame itself; `coarse` names the nearest public-visible ancestor. */
  readonly frame: PresenceFrameRef;
  /** Ancestor chain of `frame`, self first, root last. */
  readonly ancestry: readonly PresenceFrameRef[];
  /** Always `null` on a coarse entry. */
  readonly fix: PresenceGridFix | null;
  /** Always `null` on a coarse entry — a facing is exact pose data. */
  readonly headingDegrees: number | null;
}

export type PresenceHiddenReason =
  | "NO_AUTHORITATIVE_POSE"
  | "UNRESOLVABLE_FRAME";

export interface PresenceHiddenEntry {
  readonly subjectId: string;
  readonly displayName: string;
  readonly subjectKind: PresenceSubjectKind;
  readonly isLocal: boolean;
  readonly reason: PresenceHiddenReason;
  readonly detail: string;
}

export interface PresenceReadout {
  readonly stamp: PresenceStamp;
  /** Renderable markers. Order follows the input record order — the caller owns the ordering. */
  readonly entries: readonly PresenceReadoutEntry[];
  /** Subjects deliberately NOT rendered as markers, with the reason they were withheld. */
  readonly hidden: readonly PresenceHiddenEntry[];
}

export interface PresenceReadoutOptions {
  readonly frames: ReadonlyMap<string, SpatialFrame>;
  /** The frame exact fixes are projected into: the frame the renderer draws the world grid on. */
  readonly projectionFrameId: string;
  readonly stamp: PresenceStamp;
  /** Subject ids this viewer is authorized to resolve exactly. Everything else coarsens. */
  readonly exactSubjectIds?: Iterable<string>;
  readonly publicKinds?: readonly SpatialFrameKind[];
}

function frameRef(frame: SpatialFrame): PresenceFrameRef {
  return { frameId: frame.id, address: frame.address, kind: frame.kind };
}

function ancestryRefs(
  frameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): PresenceFrameRef[] {
  return frameAncestry(frameId, frames).map(frameRef);
}

/**
 * Grid cell for a frame-local point, using the frame's OWN declared grid. `origin` is the corner of
 * cell (0,0) — the same convention `gridToWorld` renders with — so this is its exact inverse and no
 * half-cell offset belongs here.
 */
export function gridCellInFrame(
  grid: SpatialGrid,
  point: Vec3,
): { x: number; y: number } {
  return {
    x: (point.x - grid.origin.x) / grid.cellSize,
    y: (point.z - grid.origin.z) / grid.cellSize,
  };
}

/** Half-open extent test, matching the spec-152 rule: `origin` through `origin + dimensions*cellSize`. */
export function withinGridExtent(
  grid: SpatialGrid,
  cell: { x: number; y: number },
): boolean {
  return (
    Number.isFinite(cell.x) &&
    Number.isFinite(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < grid.width &&
    cell.y < grid.height
  );
}

const RAD_TO_DEG = 180 / Math.PI;

/** Normalize a heading to [0, 360) degrees so two runs of the same pose format identically. */
export function headingDegrees(radians: number): number {
  const degrees = radians * RAD_TO_DEG;
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Resolve the presence record list into the readout the HUD paints. Pure and deterministic: given the
 * same records, frame graph, authorization set and stamp it returns byte-identical output, with no
 * clock, locale, randomness or renderer state involved.
 */
export function resolvePresenceReadout(
  records: readonly PresenceRecord[],
  options: PresenceReadoutOptions,
): PresenceReadout {
  const { frames, projectionFrameId, stamp } = options;
  const exact = new Set<string>(options.exactSubjectIds ?? []);
  const publicKinds = options.publicKinds ?? DEFAULT_PUBLIC_PRESENCE_KINDS;
  const projectionFrame = frames.get(projectionFrameId);

  const entries: PresenceReadoutEntry[] = [];
  const hidden: PresenceHiddenEntry[] = [];

  for (const record of records) {
    const identity = {
      subjectId: record.subjectId,
      displayName: record.displayName,
      subjectKind: record.subjectKind,
      isLocal: record.isLocal,
    };
    if (!record.location) {
      hidden.push({
        ...identity,
        reason: "NO_AUTHORITATIVE_POSE",
        detail: "no authoritative presence address for this subject",
      });
      continue;
    }
    const authorized = exact.has(record.subjectId);
    try {
      if (!authorized) {
        const publicFrame = toPublicPresence(record.location, frames, {
          publicKinds,
        });
        entries.push({
          ...identity,
          resolution: "coarse",
          frame: publicFrame,
          ancestry: ancestryRefs(publicFrame.frameId, frames),
          fix: null,
          headingDegrees: null,
        });
        continue;
      }
      if (!projectionFrame)
        throw new SpatialLocationError(
          "MISSING_FRAME",
          `projection frame does not exist: ${projectionFrameId}`,
        );
      const world = resolveLocationInFrame(
        record.location,
        projectionFrameId,
        frames,
      );
      const grid = projectionFrame.grid;
      const cell = grid ? gridCellInFrame(grid, world) : null;
      const presenceFrame = frames.get(record.location.frameId);
      if (!presenceFrame)
        throw new SpatialLocationError(
          "MISSING_FRAME",
          `spatial frame does not exist: ${record.location.frameId}`,
        );
      entries.push({
        ...identity,
        resolution: "exact",
        frame: frameRef(presenceFrame),
        ancestry: ancestryRefs(presenceFrame.id, frames),
        fix: {
          projectionFrameId,
          world,
          cell,
          withinExtent: grid && cell ? withinGridExtent(grid, cell) : false,
        },
        headingDegrees:
          typeof record.headingRadians === "number" &&
          Number.isFinite(record.headingRadians)
            ? headingDegrees(record.headingRadians)
            : null,
      });
    } catch (error) {
      // An unresolvable address is withheld, never approximated. The reason travels with it so the
      // HUD can say "position unavailable" instead of silently dropping a citizen.
      hidden.push({
        ...identity,
        reason: "UNRESOLVABLE_FRAME",
        detail:
          error instanceof SpatialLocationError
            ? `${error.code}: ${error.message}`
            : String(error),
      });
    }
  }

  return { stamp, entries, hidden };
}

function fixed(value: number, digits: number): string {
  // -0 formats as "-0.0" via toFixed; normalize so identical positions never render two ways.
  const normalized = value === 0 ? 0 : value;
  return normalized.toFixed(digits);
}

/** The reproducibility suffix: everything needed to rebuild this exact world-instant. */
export function formatPresenceStamp(stamp: PresenceStamp): string {
  const clock = `${String(stamp.solHour).padStart(2, "0")}:${String(
    stamp.solMinute,
  ).padStart(2, "0")}`;
  const revision = stamp.layoutRevision ? ` · rev ${stamp.layoutRevision}` : "";
  return `seed ${stamp.worldSeed} · sol ${stamp.sol} ${clock}${revision}`;
}

/**
 * One-line, screenshot-legible rendering of an entry. A coarse entry prints its public address and no
 * coordinate at all, so the redaction survives being copied out of an image.
 */
export function formatPresenceEntry(entry: PresenceReadoutEntry): string {
  if (entry.resolution === "coarse" || !entry.fix)
    return `${entry.displayName} · ${entry.frame.address} · location coarse`;
  const { cell, world, withinExtent } = entry.fix;
  const gridPart = cell
    ? `grid ${fixed(cell.x, 1)}, ${fixed(cell.y, 1)}${
        withinExtent ? "" : " (outside frame extent)"
      }`
    : "grid n/a";
  const worldPart = `world ${fixed(world.x, 2)}, ${fixed(world.y, 2)}, ${fixed(
    world.z,
    2,
  )}`;
  const heading =
    entry.headingDegrees === null
      ? ""
      : ` · heading ${fixed(entry.headingDegrees, 0)}°`;
  return `${entry.displayName} · ${entry.frame.address} · ${gridPart} · ${worldPart}${heading}`;
}
