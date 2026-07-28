// BUG.CAPTURE.1 — in-world bug capture: the reproducible context record.
//
// A bug filed from inside CityLife is only useful if a DIFFERENT session can stand where the reporter
// stood and look at what the reporter looked at. This module owns that record and nothing else: it is
// pure, framework-agnostic (no three.js, no React, no DOM) and never mutates world, player, sim or
// score state. The renderer/runtime adapters hand it plain numbers; every function here returns a new
// deep-frozen value.
//
// Three properties are load-bearing, and each one has a matching invariant in tests/bugCapture.test.ts:
//
//  1. FREE CAMERA MOVEMENT WHILE COMPOSING. The reporter flies around framing the defect. Re-aiming
//     produces a NEW draft (`aimBugCaptureDraft`); committing snapshots the pose that was aimed. A
//     committed record is deep-frozen and holds no live reference to the caller's pose objects, so
//     camera movement AFTER filing can never retroactively rewrite a filed report.
//
//  2. THE CAMERA IS A REGISTRY REFERENCE, NOT A MAGIC VECTOR (spec 152). The pose is stored in the
//     frame the reporter was actually in — the BUG.GEO.1 presence address's frame — not as raw
//     renderer world coordinates. `planBugReproduction` resolves it back into the ROOT frame, which is
//     the space the three.js camera really uses. Storing renderer world coordinates under an interior
//     frame id, or replaying frame-local numbers straight into the renderer, is the same class of
//     mistake: measuring against the wrong reference. `up` is a DIRECTION and is resolved as one —
//     rotated and scaled, never translated.
//
//  3. THE RECORD IS SELF-VERIFYING. `captureId` is a deterministic digest of every field, so an
//     unchanged record always re-derives the same id (stability) and any single altered field derives
//     a different one (sensitivity). `parseBugCapture` recomputes it and rejects a mismatch, so a
//     truncated or edited record fails loudly instead of reproducing the wrong place.
import { canonicalSolClock } from "../sol";
import { resolvePointToRoot } from "../spatial/frameTransforms";
import {
  resolvePointBetweenFrames,
  toPublicPresence,
  type PublicPresence,
  type SpatialLocation,
} from "../spatial/spatialLocation";
import type { SpatialFrame, Vec3 } from "../worldSurvey";

export const BUG_CAPTURE_RECORD_VERSION = 1;

export type BugCaptureErrorCode =
  | "NON_FINITE_VALUE"
  | "NOT_AIMED"
  | "INVALID_WORLD"
  | "INVALID_VIEWPORT"
  | "INVALID_SCREENSHOT"
  | "INVALID_RECORD"
  | "UNSUPPORTED_VERSION"
  | "MISSING_FRAME"
  | "MISSING_PARENT"
  | "FRAME_CYCLE"
  | "DEGENERATE_DIRECTION";

export class BugCaptureError extends Error {
  constructor(
    readonly code: BugCaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BugCaptureError";
  }
}

/**
 * A camera pose expressed in one registry frame's local space. `position` and `target` are points;
 * `up` is a direction. Keeping the frame id alongside them is what makes the pose survive the frame
 * being moved later, and what stops a capture taken inside a building from being replayed as if the
 * numbers were island coordinates.
 */
export interface BugCameraPose {
  readonly frameId: string;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
  readonly fovDeg: number;
  readonly near: number;
  readonly far: number;
  readonly aspect: number;
}

export interface BugCaptureViewport {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

/** Stable save/seed identity. Never carries credentials or personal data (public-repo safety rule). */
export interface BugCaptureWorld {
  readonly worldId: string;
  readonly seed: number;
}

/** The canonical public clock at the instant of commit — the sol another session must replay to. */
export interface BugCaptureSol {
  readonly capturedAtMs: number;
  readonly sol: number;
  readonly earthDay: number;
  readonly solOfEarthDay: number;
  readonly hour: number;
  readonly minute: number;
  readonly isDay: boolean;
}

/** What the reporter fed in: the actual image bytes, which the record deliberately does NOT store. */
export interface BugScreenshotInput {
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  /** Base64 (optionally a full `data:` URL). Travels beside the record, never inside it. */
  readonly payload: string;
}

/**
 * The record's view of the screenshot: dimensions plus a content fingerprint. The image itself stays
 * out so the context record remains small, JSON-safe and deterministically comparable, while the
 * fingerprint still binds a specific image to a specific capture.
 */
export interface BugScreenshot {
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly fingerprint: string;
}

/** BUG.GEO.1's location payload, plus the ancestor chain spec 152 requires a presence record to carry. */
export interface BugCapturePresence {
  readonly location: SpatialLocation;
  readonly publicPresence: PublicPresence;
  /** [self, parent, ..., root] — the portals another session must traverse to stand here. */
  readonly ancestorFrameIds: readonly string[];
}

export interface BugCaptureContext {
  readonly recordVersion: number;
  readonly captureId: string;
  readonly world: BugCaptureWorld;
  readonly sol: BugCaptureSol;
  readonly presence: BugCapturePresence;
  readonly camera: BugCameraPose;
  readonly viewport: BugCaptureViewport;
  readonly screenshot: BugScreenshot | null;
  /** How many times the reporter re-aimed before filing. Evidence that free composition happened. */
  readonly composeSteps: number;
}

/** The in-progress capture. Immutable: every compose step returns a new draft. */
export interface BugCaptureDraft {
  readonly world: BugCaptureWorld;
  readonly viewport: BugCaptureViewport;
  readonly camera: BugCameraPose | null;
  readonly location: SpatialLocation | null;
  readonly screenshot: BugScreenshot | null;
  readonly composeSteps: number;
}

// ---------------------------------------------------------------------------------------------
// validation helpers
// ---------------------------------------------------------------------------------------------

function assertFinite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new BugCaptureError(
      "NON_FINITE_VALUE",
      `${label} must be a finite number`,
    );
  return value;
}

function assertVec3(value: Vec3 | undefined, label: string): Vec3 {
  if (!value || typeof value !== "object")
    throw new BugCaptureError("NON_FINITE_VALUE", `${label} must be a vector`);
  return {
    x: assertFinite(value.x, `${label}.x`),
    y: assertFinite(value.y, `${label}.y`),
    z: assertFinite(value.z, `${label}.z`),
  };
}

function assertId(value: string | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new BugCaptureError("INVALID_RECORD", `${label} must be a non-empty string`);
  return value;
}

function assertPositiveInt(value: number, label: string): number {
  assertFinite(value, label);
  if (!Number.isInteger(value) || value <= 0)
    throw new BugCaptureError(
      "INVALID_VIEWPORT",
      `${label} must be a positive integer`,
    );
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value as Record<string, unknown>))
    freezeDeep((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------------------------
// deterministic digest
// ---------------------------------------------------------------------------------------------

/** Field separator for the canonical digest form: a control character no frame id, address or mime
 *  type can contain, so two different field splits can never collide into the same canonical string. */
const FIELD = "";

/** Stable textual form of a number. `String` is the spec-defined shortest round-trip form, so this is
 *  identical in Node, workers and every browser; -0 is folded to 0 so it cannot fork the digest. */
function num(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function vec(value: Vec3): string {
  return `${num(value.x)},${num(value.y)},${num(value.z)}`;
}

/** FNV-1a, run twice with different offset bases to widen the digest to 64 bits. Dependency-free and
 *  deterministic — this is an integrity/identity digest, never a security primitive. */
function fnv1a(text: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= text.charCodeAt(index) >>> 8;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function digest(text: string): string {
  const a = fnv1a(text, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a(text, 0x7fffffff).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

/** Every field of the record, in one fixed order. Adding a field here without adding it to the record
 *  (or the reverse) is caught by the round-trip key-set test. */
function canonicalForm(
  parts: Omit<BugCaptureContext, "captureId">,
): string {
  const { world, sol, presence, camera, viewport, screenshot } = parts;
  return [
    `v=${num(parts.recordVersion)}`,
    `world=${world.worldId}|${num(world.seed)}`,
    `sol=${num(sol.capturedAtMs)}|${num(sol.sol)}|${num(sol.earthDay)}|${num(sol.solOfEarthDay)}|${num(sol.hour)}|${num(sol.minute)}|${sol.isDay ? "1" : "0"}`,
    `loc=${presence.location.frameId}|${vec(presence.location.point)}`,
    `pub=${presence.publicPresence.frameId}|${presence.publicPresence.address}|${presence.publicPresence.kind}`,
    `chain=${presence.ancestorFrameIds.join(">")}`,
    `cam=${camera.frameId}|${vec(camera.position)}|${vec(camera.target)}|${vec(camera.up)}|${num(camera.fovDeg)}|${num(camera.near)}|${num(camera.far)}|${num(camera.aspect)}`,
    `view=${num(viewport.width)}|${num(viewport.height)}|${num(viewport.devicePixelRatio)}`,
    `shot=${screenshot ? `${screenshot.mimeType}|${num(screenshot.width)}|${num(screenshot.height)}|${num(screenshot.byteLength)}|${screenshot.fingerprint}` : "none"}`,
    `steps=${num(parts.composeSteps)}`,
  ].join(FIELD);
}

/** Re-derive the identity of a record from its contents alone. */
export function deriveBugCaptureId(
  parts: Omit<BugCaptureContext, "captureId">,
): string {
  return `bugcap_${digest(canonicalForm(parts))}`;
}

// ---------------------------------------------------------------------------------------------
// frame walking
// ---------------------------------------------------------------------------------------------

function requireFrame(
  frames: ReadonlyMap<string, SpatialFrame>,
  frameId: string,
): SpatialFrame {
  const frame = frames.get(frameId);
  if (!frame)
    throw new BugCaptureError(
      "MISSING_FRAME",
      `spatial frame does not exist: ${frameId}`,
    );
  return frame;
}

/** [self, parent, ..., root]. Cycles and dangling parents fail loudly rather than hanging. */
export function ancestorFrameChain(
  frameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let frame = requireFrame(frames, frameId);
  for (;;) {
    if (seen.has(frame.id))
      throw new BugCaptureError(
        "FRAME_CYCLE",
        `cycle detected while walking spatial frame chain: ${frame.id}`,
      );
    seen.add(frame.id);
    chain.push(frame.id);
    if (!frame.parentId) return chain;
    const parent = frames.get(frame.parentId);
    if (!parent)
      throw new BugCaptureError(
        "MISSING_PARENT",
        `spatial frame ${frame.id} references missing parent ${frame.parentId}`,
      );
    frame = parent;
  }
}

// ---------------------------------------------------------------------------------------------
// composing
// ---------------------------------------------------------------------------------------------

export interface OpenBugCaptureInput {
  readonly world: BugCaptureWorld;
  readonly viewport: BugCaptureViewport;
}

/** Open a compose session. Nothing is aimed yet; the reporter is free to move the camera. */
export function openBugCaptureDraft(
  input: OpenBugCaptureInput,
): BugCaptureDraft {
  const worldId = assertId(input.world?.worldId, "world.worldId");
  const seed = assertFinite(input.world?.seed, "world.seed");
  if (!Number.isInteger(seed) || seed < 0)
    throw new BugCaptureError(
      "INVALID_WORLD",
      "world.seed must be a non-negative integer",
    );
  return freezeDeep({
    world: { worldId, seed },
    viewport: normalizeViewport(input.viewport),
    camera: null,
    location: null,
    screenshot: null,
    composeSteps: 0,
  });
}

function normalizeViewport(viewport: BugCaptureViewport): BugCaptureViewport {
  if (!viewport || typeof viewport !== "object")
    throw new BugCaptureError("INVALID_VIEWPORT", "viewport is required");
  const devicePixelRatio = assertFinite(
    viewport.devicePixelRatio,
    "viewport.devicePixelRatio",
  );
  if (devicePixelRatio <= 0)
    throw new BugCaptureError(
      "INVALID_VIEWPORT",
      "viewport.devicePixelRatio must be greater than zero",
    );
  return {
    width: assertPositiveInt(viewport.width, "viewport.width"),
    height: assertPositiveInt(viewport.height, "viewport.height"),
    devicePixelRatio,
  };
}

function normalizeCamera(camera: BugCameraPose): BugCameraPose {
  if (!camera || typeof camera !== "object")
    throw new BugCaptureError("NOT_AIMED", "camera pose is required");
  const fovDeg = assertFinite(camera.fovDeg, "camera.fovDeg");
  const near = assertFinite(camera.near, "camera.near");
  const far = assertFinite(camera.far, "camera.far");
  const aspect = assertFinite(camera.aspect, "camera.aspect");
  if (fovDeg <= 0 || fovDeg >= 180)
    throw new BugCaptureError(
      "NON_FINITE_VALUE",
      "camera.fovDeg must be inside (0, 180)",
    );
  if (near <= 0 || far <= near)
    throw new BugCaptureError(
      "NON_FINITE_VALUE",
      "camera near/far must satisfy 0 < near < far",
    );
  if (aspect <= 0)
    throw new BugCaptureError(
      "NON_FINITE_VALUE",
      "camera.aspect must be greater than zero",
    );
  const up = assertVec3(camera.up, "camera.up");
  if (up.x === 0 && up.y === 0 && up.z === 0)
    throw new BugCaptureError(
      "DEGENERATE_DIRECTION",
      "camera.up must not be the zero vector",
    );
  const position = assertVec3(camera.position, "camera.position");
  const target = assertVec3(camera.target, "camera.target");
  // position === target leaves the view direction undefined, so the replayed camera would face an
  // arbitrary way. Reject it at capture time rather than shipping an unreproducible report.
  if (
    position.x === target.x &&
    position.y === target.y &&
    position.z === target.z
  )
    throw new BugCaptureError(
      "DEGENERATE_DIRECTION",
      "camera.target must differ from camera.position",
    );
  return {
    frameId: assertId(camera.frameId, "camera.frameId"),
    position,
    target,
    up,
    fovDeg,
    near,
    far,
    aspect,
  };
}

function normalizeLocation(location: SpatialLocation): SpatialLocation {
  if (!location || typeof location !== "object")
    throw new BugCaptureError("NOT_AIMED", "presence location is required");
  return {
    frameId: assertId(location.frameId, "location.frameId"),
    point: assertVec3(location.point, "location.point"),
  };
}

export interface AimBugCaptureInput {
  /** Pose in `location`'s frame — the same frame BUG.GEO.1 reports the presence address in. */
  readonly camera: BugCameraPose;
  readonly location: SpatialLocation;
}

/**
 * Re-aim the draft. Called as often as the reporter likes while flying around; each call returns a new
 * draft and bumps `composeSteps`. The inputs are copied, so the caller may keep mutating its own
 * camera object afterwards.
 */
export function aimBugCaptureDraft(
  draft: BugCaptureDraft,
  input: AimBugCaptureInput,
): BugCaptureDraft {
  const camera = normalizeCamera(input.camera);
  const location = normalizeLocation(input.location);
  if (camera.frameId !== location.frameId)
    throw new BugCaptureError(
      "INVALID_RECORD",
      `camera frame ${camera.frameId} must match the presence frame ${location.frameId}`,
    );
  return freezeDeep({
    ...draft,
    camera,
    location,
    composeSteps: draft.composeSteps + 1,
  });
}

/** Base64 payload length -> decoded byte length, tolerating a leading `data:` URL prefix. */
function base64ByteLength(payload: string): number {
  const comma = payload.indexOf(",");
  const body = payload.startsWith("data:") && comma >= 0
    ? payload.slice(comma + 1)
    : payload;
  const clean = body.replace(/\s+/g, "");
  if (clean.length === 0) return 0;
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Reduce an image to the record's view of it: dimensions plus a content fingerprint. */
export function describeBugScreenshot(
  input: BugScreenshotInput,
): BugScreenshot {
  if (!input || typeof input !== "object")
    throw new BugCaptureError("INVALID_SCREENSHOT", "screenshot is required");
  if (typeof input.payload !== "string" || input.payload.length === 0)
    throw new BugCaptureError(
      "INVALID_SCREENSHOT",
      "screenshot.payload must be a non-empty string",
    );
  const mimeType = assertId(input.mimeType, "screenshot.mimeType");
  return {
    mimeType,
    width: assertPositiveInt(input.width, "screenshot.width"),
    height: assertPositiveInt(input.height, "screenshot.height"),
    byteLength: base64ByteLength(input.payload),
    fingerprint: digest(`${mimeType}${FIELD}${input.payload}`),
  };
}

/** Attach (or clear, with null) the screenshot. Does not count as a compose step — framing does. */
export function attachBugCaptureScreenshot(
  draft: BugCaptureDraft,
  input: BugScreenshotInput | null,
): BugCaptureDraft {
  return freezeDeep({
    ...draft,
    screenshot: input === null ? null : describeBugScreenshot(input),
  });
}

export interface CommitBugCaptureInput {
  /** The instant the report is filed. Callers pass `solNowMs()`; tests pass a fixed instant. */
  readonly capturedAtMs: number;
  readonly frames: ReadonlyMap<string, SpatialFrame>;
}

/**
 * Freeze the draft into a reproducible context record. The sol is derived from the COMMIT instant, not
 * from whenever the record is later serialized or read, so a report always names the sol it was filed
 * on.
 */
export function commitBugCapture(
  draft: BugCaptureDraft,
  input: CommitBugCaptureInput,
): BugCaptureContext {
  if (!draft?.camera || !draft.location)
    throw new BugCaptureError(
      "NOT_AIMED",
      "the draft must be aimed before it can be committed",
    );
  const capturedAtMs = assertFinite(input.capturedAtMs, "capturedAtMs");
  const frames = input.frames;
  if (!frames || typeof frames.get !== "function")
    throw new BugCaptureError("MISSING_FRAME", "a spatial frame map is required");

  const location = normalizeLocation(draft.location);
  const camera = normalizeCamera(draft.camera);
  const ancestorFrameIds = ancestorFrameChain(location.frameId, frames);
  const publicPresence = toPublicPresence(location, frames);
  const clock = canonicalSolClock(capturedAtMs);

  const parts: Omit<BugCaptureContext, "captureId"> = {
    recordVersion: BUG_CAPTURE_RECORD_VERSION,
    world: { ...draft.world },
    sol: {
      capturedAtMs,
      sol: clock.sol,
      earthDay: clock.earthDay,
      solOfEarthDay: clock.solOfEarthDay,
      hour: clock.hour,
      minute: clock.minute,
      isDay: clock.isDay,
    },
    presence: { location, publicPresence, ancestorFrameIds },
    camera,
    viewport: { ...draft.viewport },
    screenshot: draft.screenshot ? { ...draft.screenshot } : null,
    composeSteps: draft.composeSteps,
  };
  return freezeDeep({ ...parts, captureId: deriveBugCaptureId(parts) });
}

// ---------------------------------------------------------------------------------------------
// reproduction
// ---------------------------------------------------------------------------------------------

export interface BugReproductionPlan {
  readonly captureId: string;
  readonly world: BugCaptureWorld;
  readonly sol: BugCaptureSol;
  /** The frame the receiving session must be inside before the pose means anything. */
  readonly enterFrameId: string;
  readonly portalPath: readonly string[];
  /** Root frame id — the space the renderer's camera actually lives in. */
  readonly rootFrameId: string;
  readonly camera: {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly up: Vec3;
    readonly fovDeg: number;
    readonly near: number;
    readonly far: number;
    readonly aspect: number;
  };
}

/**
 * Resolve a DIRECTION between frames. A direction is the difference of two points, so the frame
 * translation cancels while rotation and scale still apply. Resolving `up` as if it were a point
 * would add the frame's offset to it and tilt the replayed camera — the wrong-reference bug.
 */
function resolveDirection(
  direction: Vec3,
  fromFrameId: string,
  toFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): Vec3 {
  const origin = resolvePointBetweenFrames(
    { x: 0, y: 0, z: 0 },
    fromFrameId,
    toFrameId,
    frames,
  );
  const tip = resolvePointBetweenFrames(
    direction,
    fromFrameId,
    toFrameId,
    frames,
  );
  const out = { x: tip.x - origin.x, y: tip.y - origin.y, z: tip.z - origin.z };
  const length = Math.hypot(out.x, out.y, out.z);
  if (!Number.isFinite(length) || length === 0)
    throw new BugCaptureError(
      "DEGENERATE_DIRECTION",
      "camera up collapsed to zero length under the frame transform",
    );
  return { x: out.x / length, y: out.y / length, z: out.z / length };
}

/**
 * Turn a stored capture into instructions the receiving session can execute: which frame to enter, the
 * portal path to get there, and the camera pose expressed in the ROOT frame the renderer uses.
 */
export function planBugReproduction(
  context: BugCaptureContext,
  frames: ReadonlyMap<string, SpatialFrame>,
): BugReproductionPlan {
  const camera = context.camera;
  const { point: position, rootFrameId } = resolvePointToRoot(
    camera.position,
    camera.frameId,
    frames,
  );
  const target = resolvePointToRoot(camera.target, camera.frameId, frames).point;
  const up = resolveDirection(camera.up, camera.frameId, rootFrameId, frames);
  return freezeDeep({
    captureId: context.captureId,
    world: { ...context.world },
    sol: { ...context.sol },
    enterFrameId: context.presence.location.frameId,
    portalPath: [...context.presence.ancestorFrameIds].reverse(),
    rootFrameId,
    camera: {
      position,
      target,
      up,
      fovDeg: camera.fovDeg,
      near: camera.near,
      far: camera.far,
      aspect: camera.aspect,
    },
  });
}

/**
 * Convert a live renderer pose (root/world space, e.g. straight off the three.js camera) into the
 * reporter's frame, so the capture stores a registry-relative pose rather than a magic vector.
 */
export function bugCameraPoseFromWorld(
  worldPose: Omit<BugCameraPose, "frameId">,
  frameId: string,
  rootFrameId: string,
  frames: ReadonlyMap<string, SpatialFrame>,
): BugCameraPose {
  const staged = normalizeCamera({ ...worldPose, frameId: rootFrameId });
  if (frameId === rootFrameId) return freezeDeep({ ...staged, frameId });
  return freezeDeep(
    normalizeCamera({
      frameId,
      position: resolvePointBetweenFrames(
        staged.position,
        rootFrameId,
        frameId,
        frames,
      ),
      target: resolvePointBetweenFrames(
        staged.target,
        rootFrameId,
        frameId,
        frames,
      ),
      up: resolveDirection(staged.up, rootFrameId, frameId, frames),
      fovDeg: staged.fovDeg,
      near: staged.near,
      far: staged.far,
      aspect: staged.aspect,
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------------------------

export function serializeBugCapture(context: BugCaptureContext): string {
  return JSON.stringify(context);
}

function readVec3(value: unknown, label: string): Vec3 {
  const raw = value as Vec3 | undefined;
  return assertVec3(raw, label);
}

/**
 * Parse and VERIFY a transported record. The captureId is re-derived from the parsed contents, so a
 * record that lost or gained a field, or had one edited in transit, is rejected instead of quietly
 * sending a reviewer to the wrong place.
 */
export function parseBugCapture(json: string): BugCaptureContext {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BugCaptureError("INVALID_RECORD", "record is not valid JSON");
  }
  if (!raw || typeof raw !== "object")
    throw new BugCaptureError("INVALID_RECORD", "record must be an object");
  const record = raw as Record<string, unknown>;

  const recordVersion = record.recordVersion;
  if (recordVersion !== BUG_CAPTURE_RECORD_VERSION)
    throw new BugCaptureError(
      "UNSUPPORTED_VERSION",
      `unsupported bug capture record version: ${String(recordVersion)}`,
    );

  const world = record.world as BugCaptureWorld | undefined;
  const sol = record.sol as BugCaptureSol | undefined;
  const presence = record.presence as
    | {
        location?: SpatialLocation;
        publicPresence?: PublicPresence;
        ancestorFrameIds?: unknown;
      }
    | undefined;
  const camera = record.camera as BugCameraPose | undefined;
  const viewport = record.viewport as BugCaptureViewport | undefined;
  const screenshot = record.screenshot as BugScreenshot | null | undefined;

  if (!world || !sol || !presence || !camera || !viewport)
    throw new BugCaptureError(
      "INVALID_RECORD",
      "record is missing one or more required sections",
    );
  if (!Array.isArray(presence.ancestorFrameIds) || presence.ancestorFrameIds.length === 0)
    throw new BugCaptureError(
      "INVALID_RECORD",
      "presence.ancestorFrameIds must be a non-empty array",
    );
  if (typeof sol.isDay !== "boolean")
    throw new BugCaptureError("INVALID_RECORD", "sol.isDay must be a boolean");
  if (typeof record.composeSteps !== "number")
    throw new BugCaptureError("INVALID_RECORD", "composeSteps must be a number");

  const location = presence.location;
  const publicPresence = presence.publicPresence;
  if (!location || !publicPresence)
    throw new BugCaptureError(
      "INVALID_RECORD",
      "presence must carry both the exact location and the public presence",
    );

  const parts: Omit<BugCaptureContext, "captureId"> = {
    recordVersion: BUG_CAPTURE_RECORD_VERSION,
    world: {
      worldId: assertId(world.worldId, "world.worldId"),
      seed: assertFinite(world.seed, "world.seed"),
    },
    sol: {
      capturedAtMs: assertFinite(sol.capturedAtMs, "sol.capturedAtMs"),
      sol: assertFinite(sol.sol, "sol.sol"),
      earthDay: assertFinite(sol.earthDay, "sol.earthDay"),
      solOfEarthDay: assertFinite(sol.solOfEarthDay, "sol.solOfEarthDay"),
      hour: assertFinite(sol.hour, "sol.hour"),
      minute: assertFinite(sol.minute, "sol.minute"),
      isDay: sol.isDay,
    },
    presence: {
      location: {
        frameId: assertId(location.frameId, "presence.location.frameId"),
        point: readVec3(location.point, "presence.location.point"),
      },
      publicPresence: {
        frameId: assertId(
          publicPresence.frameId,
          "presence.publicPresence.frameId",
        ),
        address: assertId(
          publicPresence.address,
          "presence.publicPresence.address",
        ),
        kind: publicPresence.kind,
      },
      ancestorFrameIds: presence.ancestorFrameIds.map((id, index) =>
        assertId(id as string, `presence.ancestorFrameIds[${index}]`),
      ),
    },
    camera: normalizeCamera(camera),
    viewport: normalizeViewport(viewport),
    screenshot: screenshot
      ? {
          mimeType: assertId(screenshot.mimeType, "screenshot.mimeType"),
          width: assertPositiveInt(screenshot.width, "screenshot.width"),
          height: assertPositiveInt(screenshot.height, "screenshot.height"),
          byteLength: assertFinite(
            screenshot.byteLength,
            "screenshot.byteLength",
          ),
          fingerprint: assertId(
            screenshot.fingerprint,
            "screenshot.fingerprint",
          ),
        }
      : null,
    composeSteps: record.composeSteps,
  };

  const expected = deriveBugCaptureId(parts);
  if (record.captureId !== expected)
    throw new BugCaptureError(
      "INVALID_RECORD",
      "captureId does not match the record contents",
    );
  return freezeDeep({ ...parts, captureId: expected });
}

/**
 * The shareable form: coarsened to the public presence only. It keeps the world, sol and captureId so
 * a viewer can still say WHICH report this is and roughly where, but drops the exact frame-local point
 * and camera pose, which resolve to a private interior seat/room. Authorized reproduction uses the
 * full record; a pasted-into-chat summary uses this.
 */
export interface ShareableBugCapture {
  readonly captureId: string;
  readonly recordVersion: number;
  readonly world: BugCaptureWorld;
  readonly sol: BugCaptureSol;
  readonly publicPresence: PublicPresence;
  readonly screenshot: BugScreenshot | null;
}

export function toShareableBugCapture(
  context: BugCaptureContext,
): ShareableBugCapture {
  return freezeDeep({
    captureId: context.captureId,
    recordVersion: context.recordVersion,
    world: { ...context.world },
    sol: { ...context.sol },
    publicPresence: { ...context.presence.publicPresence },
    screenshot: context.screenshot ? { ...context.screenshot } : null,
  });
}
