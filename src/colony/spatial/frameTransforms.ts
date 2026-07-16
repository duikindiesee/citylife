// Pure frame-transform maths for the authoritative spatial registry.
//
// A SpatialFrame transform maps coordinates in that frame to its parent frame. Euler rotations use
// one explicit order: scale first, then rotate around X, then Y, then Z, then translate. Keeping the
// order here (rather than inheriting a renderer default) makes layout replay deterministic in Node,
// workers and the browser alike.
import type { SpatialFrame, SpatialTransform, Vec3 } from "../worldSurvey";

export type FrameTransformErrorCode =
  | "MISSING_FRAME"
  | "MISSING_PARENT"
  | "FRAME_CYCLE"
  | "NOT_ANCESTOR"
  | "NON_INVERTIBLE_SCALE"
  | "NON_FINITE_VALUE";

export class FrameTransformError extends Error {
  constructor(
    readonly code: FrameTransformErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FrameTransformError";
  }
}

export interface RootResolvedPoint {
  point: Vec3;
  rootFrameId: string;
}

function assertFiniteVec3(value: Vec3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new FrameTransformError(
      "NON_FINITE_VALUE",
      `${label} must contain finite values`,
    );
}

function rotateX(point: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * c - point.z * s,
    z: point.y * s + point.z * c,
  };
}

function rotateY(point: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: point.x * c + point.z * s,
    y: point.y,
    z: -point.x * s + point.z * c,
  };
}

function rotateZ(point: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
    z: point.z,
  };
}

/** Map one frame-local point into its direct parent's coordinates. */
export function localToParent(point: Vec3, transform: SpatialTransform): Vec3 {
  assertFiniteVec3(point, "point");
  assertFiniteVec3(transform.position, "transform.position");
  assertFiniteVec3(transform.rotation, "transform.rotation");
  assertFiniteVec3(transform.scale, "transform.scale");

  let result: Vec3 = {
    x: point.x * transform.scale.x,
    y: point.y * transform.scale.y,
    z: point.z * transform.scale.z,
  };
  result = rotateX(result, transform.rotation.x);
  result = rotateY(result, transform.rotation.y);
  result = rotateZ(result, transform.rotation.z);
  return {
    x: result.x + transform.position.x,
    y: result.y + transform.position.y,
    z: result.z + transform.position.z,
  };
}

/** Exact inverse of localToParent, including non-uniform scale. */
export function parentToLocal(point: Vec3, transform: SpatialTransform): Vec3 {
  assertFiniteVec3(point, "point");
  assertFiniteVec3(transform.position, "transform.position");
  assertFiniteVec3(transform.rotation, "transform.rotation");
  assertFiniteVec3(transform.scale, "transform.scale");
  if (
    transform.scale.x === 0 ||
    transform.scale.y === 0 ||
    transform.scale.z === 0
  )
    throw new FrameTransformError(
      "NON_INVERTIBLE_SCALE",
      "a frame transform with a zero scale component cannot be inverted",
    );

  let result: Vec3 = {
    x: point.x - transform.position.x,
    y: point.y - transform.position.y,
    z: point.z - transform.position.z,
  };
  // Reverse the forward X -> Y -> Z Euler order before undoing scale.
  result = rotateZ(result, -transform.rotation.z);
  result = rotateY(result, -transform.rotation.y);
  result = rotateX(result, -transform.rotation.x);
  return {
    x: result.x / transform.scale.x,
    y: result.y / transform.scale.y,
    z: result.z / transform.scale.z,
  };
}

/** Alias names make call sites read explicitly when a transform is being applied or inverted. */
export const applyFrameTransform = localToParent;
export const applyInverseFrameTransform = parentToLocal;

function requireFrame(
  frames: ReadonlyMap<string, SpatialFrame>,
  frameId: string,
): SpatialFrame {
  const frame = frames.get(frameId);
  if (!frame)
    throw new FrameTransformError(
      "MISSING_FRAME",
      `spatial frame does not exist: ${frameId}`,
    );
  return frame;
}

/**
 * Resolve a point from any frame into a declared ancestor. The ancestor's own transform is not
 * applied: the returned point is expressed in that ancestor's local coordinates.
 */
export function resolvePointToAncestor(
  point: Vec3,
  fromFrameId: string,
  ancestorFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): Vec3 {
  assertFiniteVec3(point, "point");
  requireFrame(frames, ancestorFrameId);
  let frame = requireFrame(frames, fromFrameId);
  let resolved = { ...point };
  const visited = new Set<string>();

  while (frame.id !== ancestorFrameId) {
    if (visited.has(frame.id))
      throw new FrameTransformError(
        "FRAME_CYCLE",
        `cycle detected while resolving spatial frame: ${frame.id}`,
      );
    visited.add(frame.id);
    if (!frame.parentId)
      throw new FrameTransformError(
        "NOT_ANCESTOR",
        `${ancestorFrameId} is not an ancestor of ${fromFrameId}`,
      );
    resolved = localToParent(resolved, frame.transform);
    const parent = frames.get(frame.parentId);
    if (!parent)
      throw new FrameTransformError(
        "MISSING_PARENT",
        `spatial frame ${frame.id} references missing parent ${frame.parentId}`,
      );
    frame = parent;
  }
  return resolved;
}

/** Resolve to the first root (a frame with no parent), returning both its id and the root-local point. */
export function resolvePointToRoot(
  point: Vec3,
  fromFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): RootResolvedPoint {
  assertFiniteVec3(point, "point");
  let frame = requireFrame(frames, fromFrameId);
  let resolved = { ...point };
  const visited = new Set<string>();

  while (frame.parentId) {
    if (visited.has(frame.id))
      throw new FrameTransformError(
        "FRAME_CYCLE",
        `cycle detected while resolving spatial frame: ${frame.id}`,
      );
    visited.add(frame.id);
    resolved = localToParent(resolved, frame.transform);
    const parent = frames.get(frame.parentId);
    if (!parent)
      throw new FrameTransformError(
        "MISSING_PARENT",
        `spatial frame ${frame.id} references missing parent ${frame.parentId}`,
      );
    frame = parent;
  }
  // A root transform has no parent coordinate system to map into, so it is deliberately not applied.
  return { point: resolved, rootFrameId: frame.id };
}
