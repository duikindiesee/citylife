// Spec 152 WB.1e — Authoritative, privacy-safe runtime presence for bots and humans.
//
// A SpatialLocation names *where an entity is* as a frame id plus a frame-local point. It is a runtime
// fact, deliberately kept out of the persisted WorldLayoutDocument (which carries only durable spatial
// facts — see ./worldLayoutDocument). Presence therefore never mutates, and never depends on, any
// original island id, coordinate, road or placement: it only reads the authoritative frame graph.
//
// This module supplies the two primitives the rest of WB.1e needs and that ./frameTransforms did not
// yet cover:
//   1. resolvePointBetweenFrames — resolve a point from *any* frame into *any* other frame via their
//      lowest common ancestor. Ancestor/root resolution alone cannot answer "where does the surface
//      entrance land in reception-local coordinates?", which is exactly what cross-frame portal
//      navigation and shared-interior presence require.
//   2. toPublicPresence — coarsen a precise location to the nearest public-visible ancestor frame
//      (building/region/world/universe), revealing which building or region an entity is in without
//      leaking the exact interior seat/room coordinate. This mirrors the citizen roster's
//      public-presence model (a PLAYER sees others' presence, never their private point).
import type { SpatialFrame, SpatialFrameKind, Vec3 } from "../worldSurvey";
import { localToParent, parentToLocal } from "./frameTransforms";

/**
 * A privacy-safe address of a point inside the authoritative frame graph: a frame id plus a point in
 * that frame's local coordinates. The point is meaningful only together with its frame — resolving it
 * to any other frame goes through the invertible frame transforms, never a raw coordinate copy.
 */
export interface SpatialLocation {
  readonly frameId: string;
  /** Coordinates in `frameId`'s local space. */
  readonly point: Vec3;
}

/**
 * A coarsened, shareable view of where an entity is: the nearest public-visible ancestor frame. It
 * carries no exact point, so it can be shown to other citizens without leaking a private seat/desk
 * coordinate.
 */
export interface PublicPresence {
  readonly frameId: string;
  readonly address: string;
  readonly kind: SpatialFrameKind;
}

export type SpatialLocationErrorCode =
  | "MISSING_FRAME"
  | "MISSING_PARENT"
  | "FRAME_CYCLE"
  | "NO_COMMON_ANCESTOR"
  | "NON_FINITE_VALUE";

export class SpatialLocationError extends Error {
  constructor(
    readonly code: SpatialLocationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpatialLocationError";
  }
}

/**
 * Public-visible frame kinds. A `room` is deliberately excluded: coarsening stops at the building so
 * presence reveals "in Kooker HQ", never "seated in the boardroom".
 */
export const DEFAULT_PUBLIC_PRESENCE_KINDS: readonly SpatialFrameKind[] = [
  "building",
  "region",
  "world",
  "universe",
];

function assertFiniteVec3(value: Vec3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new SpatialLocationError(
      "NON_FINITE_VALUE",
      `${label} must contain finite values`,
    );
}

function requireFrame(
  frames: ReadonlyMap<string, SpatialFrame>,
  frameId: string,
): SpatialFrame {
  const frame = frames.get(frameId);
  if (!frame)
    throw new SpatialLocationError(
      "MISSING_FRAME",
      `spatial frame does not exist: ${frameId}`,
    );
  return frame;
}

/**
 * Ordered chain of frames from `fromFrameId` up to its root: [self, parent, ..., root]. Detects cycles
 * and dangling parents so callers get a precise error instead of a hang or a silently wrong answer.
 */
function frameChainToRoot(
  fromFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): SpatialFrame[] {
  const chain: SpatialFrame[] = [];
  const visited = new Set<string>();
  let frame = requireFrame(frames, fromFrameId);
  for (;;) {
    if (visited.has(frame.id))
      throw new SpatialLocationError(
        "FRAME_CYCLE",
        `cycle detected while walking spatial frame chain: ${frame.id}`,
      );
    visited.add(frame.id);
    chain.push(frame);
    if (!frame.parentId) return chain;
    const parent = frames.get(frame.parentId);
    if (!parent)
      throw new SpatialLocationError(
        "MISSING_PARENT",
        `spatial frame ${frame.id} references missing parent ${frame.parentId}`,
      );
    frame = parent;
  }
}

/**
 * Resolve a point expressed in `fromFrameId` into `toFrameId`'s local coordinates, routing through the
 * two frames' lowest common ancestor. Neither the source nor the target root transform is applied — the
 * result is expressed in the target frame's own local space, matching resolvePointToAncestor's
 * semantics. Throws NO_COMMON_ANCESTOR when the frames live under different roots.
 */
export function resolvePointBetweenFrames(
  point: Vec3,
  fromFrameId: string,
  toFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): Vec3 {
  assertFiniteVec3(point, "point");
  if (fromFrameId === toFrameId) {
    requireFrame(frames, fromFrameId);
    return { ...point };
  }

  // Depth-indexed chain for the target so we can recognise the lowest common ancestor while climbing
  // from the source, then descend the remaining target segment.
  const toChain = frameChainToRoot(toFrameId, frames);
  const toIndex = new Map<string, number>();
  toChain.forEach((frame, index) => toIndex.set(frame.id, index));

  let frame = requireFrame(frames, fromFrameId);
  let resolved: Vec3 = { ...point };
  const visited = new Set<string>();
  while (!toIndex.has(frame.id)) {
    if (visited.has(frame.id))
      throw new SpatialLocationError(
        "FRAME_CYCLE",
        `cycle detected while resolving spatial frame: ${frame.id}`,
      );
    visited.add(frame.id);
    if (!frame.parentId)
      throw new SpatialLocationError(
        "NO_COMMON_ANCESTOR",
        `${fromFrameId} and ${toFrameId} do not share a common ancestor frame`,
      );
    resolved = localToParent(resolved, frame.transform);
    const parent = frames.get(frame.parentId);
    if (!parent)
      throw new SpatialLocationError(
        "MISSING_PARENT",
        `spatial frame ${frame.id} references missing parent ${frame.parentId}`,
      );
    frame = parent;
  }

  // `frame` is now the lowest common ancestor and `resolved` is in its local space. Descend the target
  // chain from just below the ancestor down to the target, inverting each frame transform in turn.
  const ancestorIndex = toIndex.get(frame.id)!;
  for (let index = ancestorIndex - 1; index >= 0; index -= 1) {
    resolved = parentToLocal(resolved, toChain[index]!.transform);
  }
  return resolved;
}

/** Resolve a SpatialLocation into an arbitrary target frame's local coordinates. */
export function resolveLocationInFrame(
  location: SpatialLocation,
  targetFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): Vec3 {
  return resolvePointBetweenFrames(
    location.point,
    location.frameId,
    targetFrameId,
    frames,
  );
}

/** Re-express a location in another frame, returning a new SpatialLocation pinned to that frame. */
export function relocate(
  location: SpatialLocation,
  targetFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): SpatialLocation {
  return {
    frameId: targetFrameId,
    point: resolveLocationInFrame(location, targetFrameId, frames),
  };
}

export interface PublicPresenceOptions {
  /** Frame kinds that may be revealed publicly. Defaults to DEFAULT_PUBLIC_PRESENCE_KINDS. */
  readonly publicKinds?: readonly SpatialFrameKind[];
}

/**
 * Coarsen a precise location to a privacy-safe public presence: walk from the location's frame up to
 * the nearest ancestor whose kind is public-visible and return that frame's id/address/kind, with no
 * exact point. If nothing along the chain is public-visible, the root frame is returned so presence is
 * always answerable without ever exposing the private interior coordinate.
 */
export function toPublicPresence(
  location: SpatialLocation,
  frames: ReadonlyMap<string, SpatialFrame>,
  options: PublicPresenceOptions = {},
): PublicPresence {
  const publicKinds = options.publicKinds ?? DEFAULT_PUBLIC_PRESENCE_KINDS;
  const allowed = new Set<SpatialFrameKind>(publicKinds);
  const chain = frameChainToRoot(location.frameId, frames);
  const visible =
    chain.find((frame) => allowed.has(frame.kind)) ?? chain[chain.length - 1]!;
  return { frameId: visible.id, address: visible.address, kind: visible.kind };
}
