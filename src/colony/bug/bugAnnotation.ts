// BUG.ANNOTATE.1 — on-screen marking over a captured bug view.
//
// The operator's current workflow is: take a screenshot, open an external tool, draw a red arrow at
// the broken thing, paste the image somewhere. The arrow is the most valuable part of the report — it
// is the only thing that says WHICH of the two hundred objects on screen is wrong — and today it lives
// outside the repo, unversioned, un-replayable, and lost the moment the image is re-cropped.
//
// This module owns that marking layer and nothing else. It is pure and framework-agnostic (no three.js,
// no React, no DOM types) and never mutates world, player, sim or score state. Every function returns a
// new deep-frozen value.
//
// Five properties are load-bearing, and each one has a matching invariant in tests/bugAnnotation.test.ts:
//
//  1. MARKS ARE NORMALIZED, NOT PIXELS. An annotation is stored in 0..1 of the capture's viewport, so
//     re-opening a report on a different monitor, a different window size or a different devicePixelRatio
//     puts the arrow back on the SAME PIXEL OF THE WORLD. Storing raw pixel coordinates is the obvious
//     implementation and it is wrong: the operator files from a 3840x2160 display, the reviewer re-opens
//     at 1280x720, and every arrow lands a third of the way from where the defect is. `resolveBugAnnotationOverlay`
//     is the only place normalized units become pixels, and it takes the CURRENT viewport, never the
//     stored one. Stroke widths normalize against the SHORTER viewport edge so a mark keeps its visual
//     weight instead of turning into a hairline on a wide window.
//
//  2. A LAYER IS BOUND TO ONE CAPTURE. `reopenBugAnnotationLayer` re-derives the binding and refuses a
//     layer whose `captureId` is not the capture being opened. Marks are meaningless without the exact
//     image they were drawn over — an arrow pointing at a kerb defect, silently re-hung over a different
//     junction's screenshot, is worse than no arrow, because it asserts something false with the
//     operator's authority behind it.
//
//  3. THE LAYER IS SELF-VERIFYING. `layerId` is a deterministic digest of every annotation, in order, plus
//     the binding — so an unchanged layer always re-derives the same id (stability) and any single altered
//     field derives a different one (sensitivity). `parseBugAnnotationLayer` recomputes it and rejects a
//     mismatch, so a truncated or hand-edited layer fails loudly rather than dropping the reporter's marks.
//
//  4. PAINT ORDER IS AUTHORING ORDER, AND IT SURVIVES. Annotations are an ORDERED list, not a set or a map.
//     A box drawn over an arrow must stay over it; a reporter who draws three overlapping marks means the
//     third to be on top. Keying storage by id (the natural way to make removal cheap) scrambles that the
//     first time a layer round-trips, and the scrambling is invisible until someone looks at the image.
//
//  5. A COMMITTED LAYER IS A SNAPSHOT. Inputs are copied, never aliased, and the result is deep-frozen — so
//     a caller that keeps drawing into its own scratch point array after committing cannot retroactively
//     rewrite a filed report. This is the same property `bugCapture.ts` holds for the camera pose, for the
//     same reason.
//
// Deliberately NOT here: the image bytes (they travel beside the record, as in BUG.CAPTURE.1), any
// notion of undo history (a report carries the marks the reporter meant, not how they got there), and any
// canvas/DOM binding. `paintBugAnnotationOverlay` takes a structural 2D-context interface so the same code
// drives a real `CanvasRenderingContext2D`, an offscreen canvas in a worker, or a recording fake in tests.

export const BUG_ANNOTATION_LAYER_VERSION = 1;

export type BugAnnotationErrorCode =
  | "NON_FINITE_VALUE"
  | "OUT_OF_BOUNDS"
  | "INVALID_STYLE"
  | "INVALID_SHAPE"
  | "DEGENERATE_SHAPE"
  | "INVALID_LAYER"
  | "INVALID_VIEWPORT"
  | "UNSUPPORTED_VERSION"
  | "CAPTURE_MISMATCH"
  | "UNKNOWN_ANNOTATION";

export class BugAnnotationError extends Error {
  constructor(
    readonly code: BugAnnotationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BugAnnotationError";
  }
}

// ---------------------------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------------------------

/**
 * A point on the captured image in NORMALIZED viewport units: `u` runs 0 (left) to 1 (right), `v` runs
 * 0 (top) to 1 (bottom), matching how a screenshot is addressed everywhere else in the stack. Never
 * pixels — see property 1 in the module header.
 */
export interface BugAnnotationPoint {
  readonly u: number;
  readonly v: number;
}

/**
 * `strokeWidth` is normalized against the SHORTER viewport edge, so the same layer reads with the same
 * visual weight at 720p and at 4K. `color` is an opaque token the painter hands straight to the drawing
 * surface; this module never parses it, so a theme can swap the palette without a record migration.
 */
export interface BugAnnotationStyle {
  readonly color: string;
  readonly strokeWidth: number;
}

export interface BugArrowAnnotation {
  readonly kind: "arrow";
  readonly id: string;
  readonly style: BugAnnotationStyle;
  /** The tail — where the reporter started the drag, usually in empty sky. */
  readonly from: BugAnnotationPoint;
  /** The head — the thing that is wrong. */
  readonly to: BugAnnotationPoint;
}

export interface BugBoxAnnotation {
  readonly kind: "box";
  readonly id: string;
  readonly style: BugAnnotationStyle;
  /** Top-left. Normalized so `min` is always above-left of `max`, whichever way the drag went. */
  readonly min: BugAnnotationPoint;
  readonly max: BugAnnotationPoint;
}

export interface BugFreehandAnnotation {
  readonly kind: "freehand";
  readonly id: string;
  readonly style: BugAnnotationStyle;
  /** At least two points; consecutive duplicates are collapsed so a stationary pointer cannot pad it. */
  readonly points: readonly BugAnnotationPoint[];
}

export type BugAnnotation =
  | BugArrowAnnotation
  | BugBoxAnnotation
  | BugFreehandAnnotation;

export type BugAnnotationKind = BugAnnotation["kind"];

/** What a caller hands in. The id is derived here, never supplied, so ids cannot collide or be forged. */
export type BugAnnotationInput =
  | {
      readonly kind: "arrow";
      readonly style: BugAnnotationStyle;
      readonly from: BugAnnotationPoint;
      readonly to: BugAnnotationPoint;
    }
  | {
      readonly kind: "box";
      readonly style: BugAnnotationStyle;
      readonly min: BugAnnotationPoint;
      readonly max: BugAnnotationPoint;
    }
  | {
      readonly kind: "freehand";
      readonly style: BugAnnotationStyle;
      readonly points: readonly BugAnnotationPoint[];
    };

export interface BugAnnotationViewport {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

/**
 * The part of a BUG.CAPTURE.1 record this module needs. Declared structurally rather than imported so the
 * marking layer does not depend on the capture module's build, and so a stored capture summary, a test
 * fixture or a future capture version all satisfy it without a shim. A `BugCaptureContext` is assignable
 * to this as-is.
 */
export interface AnnotatedCaptureRef {
  readonly captureId: string;
  readonly viewport: BugAnnotationViewport;
}

export interface BugAnnotationLayer {
  readonly layerVersion: number;
  readonly layerId: string;
  /** The capture these marks belong to. A layer is meaningless apart from it (property 2). */
  readonly captureId: string;
  /** The framing the marks were drawn over. Kept for provenance and aspect checking, NOT for rendering. */
  readonly viewport: BugAnnotationViewport;
  /** Authoring order == paint order, back to front (property 4). */
  readonly annotations: readonly BugAnnotation[];
  /** Monotonic; never reused after a removal, so a removed mark's id can never be resurrected. */
  readonly nextOrdinal: number;
}

// ---------------------------------------------------------------------------------------------
// validation helpers
// ---------------------------------------------------------------------------------------------

function assertFinite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new BugAnnotationError(
      "NON_FINITE_VALUE",
      `${label} must be a finite number`,
    );
  return value;
}

function assertPositiveInt(value: number, label: string): number {
  assertFinite(value, label);
  if (!Number.isInteger(value) || value <= 0)
    throw new BugAnnotationError(
      "INVALID_VIEWPORT",
      `${label} must be a positive integer`,
    );
  return value;
}

/** Normalized coordinates are a closed contract: a mark outside the image is a bug in the caller, not a
 *  value to silently clamp. Clamping would move the operator's arrow and still claim it was theirs. */
function assertUnit(value: number, label: string): number {
  assertFinite(value, label);
  if (value < 0 || value > 1)
    throw new BugAnnotationError(
      "OUT_OF_BOUNDS",
      `${label} must lie within the captured image (0..1), got ${value}`,
    );
  return value;
}

function assertPoint(
  value: BugAnnotationPoint | undefined,
  label: string,
): BugAnnotationPoint {
  if (!value || typeof value !== "object")
    throw new BugAnnotationError("INVALID_SHAPE", `${label} must be a point`);
  return {
    u: assertUnit(value.u, `${label}.u`),
    v: assertUnit(value.v, `${label}.v`),
  };
}

function assertStyle(
  value: BugAnnotationStyle | undefined,
  label: string,
): BugAnnotationStyle {
  if (!value || typeof value !== "object")
    throw new BugAnnotationError("INVALID_STYLE", `${label} must be a style`);
  if (typeof value.color !== "string" || value.color.trim() === "")
    throw new BugAnnotationError(
      "INVALID_STYLE",
      `${label}.color must be a non-empty string`,
    );
  assertFinite(value.strokeWidth, `${label}.strokeWidth`);
  if (value.strokeWidth <= 0 || value.strokeWidth > 1)
    throw new BugAnnotationError(
      "INVALID_STYLE",
      `${label}.strokeWidth must be a normalized width in (0..1], got ${value.strokeWidth}`,
    );
  return { color: value.color, strokeWidth: value.strokeWidth };
}

function assertId(value: string | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new BugAnnotationError(
      "INVALID_LAYER",
      `${label} must be a non-empty string`,
    );
  return value;
}

function normalizeViewport(
  viewport: BugAnnotationViewport | undefined,
  label: string,
): BugAnnotationViewport {
  if (!viewport || typeof viewport !== "object")
    throw new BugAnnotationError("INVALID_VIEWPORT", `${label} is required`);
  const devicePixelRatio = assertFinite(
    viewport.devicePixelRatio,
    `${label}.devicePixelRatio`,
  );
  if (devicePixelRatio <= 0)
    throw new BugAnnotationError(
      "INVALID_VIEWPORT",
      `${label}.devicePixelRatio must be positive`,
    );
  return {
    width: assertPositiveInt(viewport.width, `${label}.width`),
    height: assertPositiveInt(viewport.height, `${label}.height`),
    devicePixelRatio,
  };
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value as Record<string, unknown>))
    freezeDeep((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------------------------
// deterministic digest
//
// Same construction as bugCapture.ts, deliberately: one digest shape across the bug-report records means
// a reviewer learns it once, and an id from either module is recognisable on sight by its prefix.
// ---------------------------------------------------------------------------------------------

/** Field separator: a control character no colour token, id or kind can contain, so two different field
 *  splits can never collide into the same canonical string. */
const FIELD = "";

/** Stable textual form of a number. `String` is the spec-defined shortest round-trip form, so this is
 *  identical in Node, workers and every browser; -0 is folded to 0 so it cannot fork the digest. */
function num(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function pt(value: BugAnnotationPoint): string {
  return `${num(value.u)},${num(value.v)}`;
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

/** Every field of one annotation, in one fixed order. The id is EXCLUDED — it is derived from this. */
function annotationBody(
  annotation: BugAnnotationInput | BugAnnotation,
): string {
  const style = `${annotation.style.color}|${num(annotation.style.strokeWidth)}`;
  switch (annotation.kind) {
    case "arrow":
      return `arrow|${style}|${pt(annotation.from)}|${pt(annotation.to)}`;
    case "box":
      return `box|${style}|${pt(annotation.min)}|${pt(annotation.max)}`;
    case "freehand":
      return `freehand|${style}|${annotation.points.map(pt).join(";")}`;
  }
}

/** The id folds in the ordinal as well as the geometry, so two identical marks drawn twice are still two
 *  distinguishable marks and removal can never ambiguously hit the wrong one. */
function deriveAnnotationId(
  annotation: BugAnnotationInput,
  ordinal: number,
): string {
  return `bugann_${digest(`${num(ordinal)}${FIELD}${annotationBody(annotation)}`)}`;
}

function canonicalLayerForm(
  parts: Omit<BugAnnotationLayer, "layerId">,
): string {
  return [
    `v=${num(parts.layerVersion)}`,
    `capture=${parts.captureId}`,
    `view=${num(parts.viewport.width)}|${num(parts.viewport.height)}|${num(parts.viewport.devicePixelRatio)}`,
    `next=${num(parts.nextOrdinal)}`,
    // Order is part of the identity: reordering the same marks is a different layer, because it is a
    // different picture (property 4).
    `marks=${parts.annotations.map((a) => `${a.id}~${annotationBody(a)}`).join(";")}`,
  ].join(FIELD);
}

/** Re-derive the identity of a layer from its contents alone. */
export function deriveBugAnnotationLayerId(
  parts: Omit<BugAnnotationLayer, "layerId">,
): string {
  return `buganl_${digest(canonicalLayerForm(parts))}`;
}

// ---------------------------------------------------------------------------------------------
// shape normalization
// ---------------------------------------------------------------------------------------------

/** Squared distance in normalized space. Used only to reject marks too small to mean anything. */
function distanceSq(a: BugAnnotationPoint, b: BugAnnotationPoint): number {
  const du = a.u - b.u;
  const dv = a.v - b.v;
  return du * du + dv * dv;
}

/**
 * A drag shorter than this in normalized units is a CLICK, not a mark. Rejecting it is what stops a
 * report accumulating invisible zero-length arrows that render as a single stray pixel of red and read,
 * to a reviewer, as noise on the image rather than as a mark someone meant.
 */
export const MIN_ANNOTATION_EXTENT = 1e-4;

/**
 * Build a mark with its keys in ONE fixed order, whichever path produced it.
 *
 * `JSON.stringify` emits keys in insertion order, so a freshly drawn layer and the same layer parsed
 * back from storage would otherwise serialize to different BYTES despite being the same picture with the
 * same `layerId`. That is a latent duplicate: any content-addressed store, cache key or "has this report
 * changed?" comparison would see two records where there is one. Sealing every mark through here makes
 * the transport form canonical, which the file -> store -> re-open test pins byte-for-byte.
 */
function sealAnnotation(
  kind: BugAnnotationKind,
  id: string,
  style: BugAnnotationStyle,
  geometry: Record<string, unknown>,
): BugAnnotation {
  return { kind, id, style, ...geometry } as BugAnnotation;
}

function normalizeAnnotation(
  input: BugAnnotationInput,
  ordinal: number,
): BugAnnotation {
  if (!input || typeof input !== "object")
    throw new BugAnnotationError("INVALID_SHAPE", "an annotation is required");
  // Kind first: an unsupported shape should say so, rather than reporting whatever else is also wrong
  // with a record this module was never going to accept.
  if (
    input.kind !== "arrow" &&
    input.kind !== "box" &&
    input.kind !== "freehand"
  )
    throw new BugAnnotationError(
      "INVALID_SHAPE",
      `unsupported annotation kind: ${String((input as { kind?: unknown }).kind)}`,
    );
  const style = assertStyle(input.style, `${input.kind}.style`);

  switch (input.kind) {
    case "arrow": {
      const from = assertPoint(input.from, "arrow.from");
      const to = assertPoint(input.to, "arrow.to");
      if (distanceSq(from, to) < MIN_ANNOTATION_EXTENT * MIN_ANNOTATION_EXTENT)
        throw new BugAnnotationError(
          "DEGENERATE_SHAPE",
          "an arrow needs a direction: from and to are the same point",
        );
      const normalized = { kind: "arrow" as const, style, from, to };
      return sealAnnotation(
        "arrow",
        deriveAnnotationId(normalized, ordinal),
        style,
        { from, to },
      );
    }
    case "box": {
      const a = assertPoint(input.min, "box.min");
      const b = assertPoint(input.max, "box.max");
      // Accept a drag in ANY direction and store it canonically. A reviewer who drags up-left means the
      // same box as one who drags down-right, and two records of the same box must digest identically.
      const min = { u: Math.min(a.u, b.u), v: Math.min(a.v, b.v) };
      const max = { u: Math.max(a.u, b.u), v: Math.max(a.v, b.v) };
      if (
        max.u - min.u < MIN_ANNOTATION_EXTENT &&
        max.v - min.v < MIN_ANNOTATION_EXTENT
      )
        throw new BugAnnotationError(
          "DEGENERATE_SHAPE",
          "a box needs an area: min and max collapse to a point",
        );
      const normalized = { kind: "box" as const, style, min, max };
      return sealAnnotation(
        "box",
        deriveAnnotationId(normalized, ordinal),
        style,
        { min, max },
      );
    }
    case "freehand": {
      if (!Array.isArray(input.points))
        throw new BugAnnotationError(
          "INVALID_SHAPE",
          "freehand.points must be an array",
        );
      // Copy first (property 5): every later read is of OUR array, not the caller's live scratch buffer.
      const raw = input.points.map((point, index) =>
        assertPoint(point, `freehand.points[${index}]`),
      );
      // A pointer held still emits the same coordinate many times. Collapsing consecutive duplicates
      // keeps the digest stable across input devices that sample at different rates — the same stroke
      // drawn with a mouse and a stylus should be the same mark.
      const points: BugAnnotationPoint[] = [];
      for (const point of raw) {
        const last = points[points.length - 1];
        if (last && last.u === point.u && last.v === point.v) continue;
        points.push(point);
      }
      if (points.length < 2)
        throw new BugAnnotationError(
          "DEGENERATE_SHAPE",
          "a freehand stroke needs at least two distinct points",
        );
      const normalized = { kind: "freehand" as const, style, points };
      return sealAnnotation(
        "freehand",
        deriveAnnotationId(normalized, ordinal),
        style,
        { points },
      );
    }
    default:
      throw new BugAnnotationError(
        "INVALID_SHAPE",
        `unsupported annotation kind: ${String((input as { kind?: unknown }).kind)}`,
      );
  }
}

// ---------------------------------------------------------------------------------------------
// composing a layer
// ---------------------------------------------------------------------------------------------

function sealLayer(
  parts: Omit<BugAnnotationLayer, "layerId">,
): BugAnnotationLayer {
  return freezeDeep({ ...parts, layerId: deriveBugAnnotationLayerId(parts) });
}

/** Start marking over a capture. The layer is bound to it here and can never be re-bound (property 2). */
export function openBugAnnotationLayer(
  capture: AnnotatedCaptureRef,
): BugAnnotationLayer {
  if (!capture || typeof capture !== "object")
    throw new BugAnnotationError(
      "CAPTURE_MISMATCH",
      "a capture reference is required to open an annotation layer",
    );
  return sealLayer({
    layerVersion: BUG_ANNOTATION_LAYER_VERSION,
    captureId: assertId(capture.captureId, "capture.captureId"),
    viewport: normalizeViewport(capture.viewport, "capture.viewport"),
    annotations: [],
    nextOrdinal: 0,
  });
}

/** Add one mark on top of the existing ones. Returns a new layer; the input layer is untouched. */
export function addBugAnnotation(
  layer: BugAnnotationLayer,
  input: BugAnnotationInput,
): BugAnnotationLayer {
  const base = requireLayer(layer);
  const annotation = normalizeAnnotation(input, base.nextOrdinal);
  return sealLayer({
    layerVersion: base.layerVersion,
    captureId: base.captureId,
    viewport: base.viewport,
    annotations: [...base.annotations, annotation],
    nextOrdinal: base.nextOrdinal + 1,
  });
}

/**
 * Remove one mark by id, keeping the order of the rest. `nextOrdinal` deliberately does NOT rewind: an id
 * that has been removed must never be minted again, or an old link to a removed mark would silently start
 * resolving to a new one.
 */
export function removeBugAnnotation(
  layer: BugAnnotationLayer,
  annotationId: string,
): BugAnnotationLayer {
  const base = requireLayer(layer);
  const kept = base.annotations.filter((a) => a.id !== annotationId);
  if (kept.length === base.annotations.length)
    throw new BugAnnotationError(
      "UNKNOWN_ANNOTATION",
      `annotation not in this layer: ${annotationId}`,
    );
  return sealLayer({
    layerVersion: base.layerVersion,
    captureId: base.captureId,
    viewport: base.viewport,
    annotations: kept,
    nextOrdinal: base.nextOrdinal,
  });
}

/** Drop every mark, keeping the binding — "clear and start again" without re-opening the capture. */
export function clearBugAnnotations(
  layer: BugAnnotationLayer,
): BugAnnotationLayer {
  const base = requireLayer(layer);
  return sealLayer({
    layerVersion: base.layerVersion,
    captureId: base.captureId,
    viewport: base.viewport,
    annotations: [],
    nextOrdinal: base.nextOrdinal,
  });
}

function requireLayer(layer: BugAnnotationLayer): BugAnnotationLayer {
  if (!layer || typeof layer !== "object" || !Array.isArray(layer.annotations))
    throw new BugAnnotationError(
      "INVALID_LAYER",
      "an annotation layer is required",
    );
  return layer;
}

// ---------------------------------------------------------------------------------------------
// transport + re-open
// ---------------------------------------------------------------------------------------------

export function serializeBugAnnotationLayer(layer: BugAnnotationLayer): string {
  return JSON.stringify(requireLayer(layer));
}

function readAnnotation(value: unknown, index: number): BugAnnotation {
  if (!value || typeof value !== "object")
    throw new BugAnnotationError(
      "INVALID_SHAPE",
      `annotations[${index}] must be an object`,
    );
  const raw = value as Record<string, unknown>;
  const id = assertId(raw.id as string, `annotations[${index}].id`);
  const style = assertStyle(
    raw.style as BugAnnotationStyle,
    `annotations[${index}].style`,
  );
  switch (raw.kind) {
    case "arrow":
      return sealAnnotation("arrow", id, style, {
        from: assertPoint(
          raw.from as BugAnnotationPoint,
          `annotations[${index}].from`,
        ),
        to: assertPoint(
          raw.to as BugAnnotationPoint,
          `annotations[${index}].to`,
        ),
      });
    case "box":
      return sealAnnotation("box", id, style, {
        min: assertPoint(
          raw.min as BugAnnotationPoint,
          `annotations[${index}].min`,
        ),
        max: assertPoint(
          raw.max as BugAnnotationPoint,
          `annotations[${index}].max`,
        ),
      });
    case "freehand": {
      if (!Array.isArray(raw.points))
        throw new BugAnnotationError(
          "INVALID_SHAPE",
          `annotations[${index}].points must be an array`,
        );
      const points = (raw.points as BugAnnotationPoint[]).map((point, at) =>
        assertPoint(point, `annotations[${index}].points[${at}]`),
      );
      if (points.length < 2)
        throw new BugAnnotationError(
          "DEGENERATE_SHAPE",
          `annotations[${index}] needs at least two points`,
        );
      return sealAnnotation("freehand", id, style, { points });
    }
    default:
      throw new BugAnnotationError(
        "INVALID_SHAPE",
        `annotations[${index}].kind is not a supported shape: ${String(raw.kind)}`,
      );
  }
}

/**
 * Parse and VERIFY a transported layer. The layerId is re-derived from the parsed contents, so a layer
 * that lost a mark, gained one, or had a coordinate edited in transit is rejected instead of quietly
 * showing a reviewer a picture the reporter never drew.
 */
export function parseBugAnnotationLayer(json: string): BugAnnotationLayer {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BugAnnotationError("INVALID_LAYER", "layer is not valid JSON");
  }
  if (!raw || typeof raw !== "object")
    throw new BugAnnotationError("INVALID_LAYER", "layer must be an object");
  const record = raw as Record<string, unknown>;

  if (record.layerVersion !== BUG_ANNOTATION_LAYER_VERSION)
    throw new BugAnnotationError(
      "UNSUPPORTED_VERSION",
      `unsupported bug annotation layer version: ${String(record.layerVersion)}`,
    );
  if (!Array.isArray(record.annotations))
    throw new BugAnnotationError(
      "INVALID_LAYER",
      "layer.annotations must be an array",
    );
  if (typeof record.nextOrdinal !== "number")
    throw new BugAnnotationError(
      "INVALID_LAYER",
      "layer.nextOrdinal must be a number",
    );

  const parts: Omit<BugAnnotationLayer, "layerId"> = {
    layerVersion: BUG_ANNOTATION_LAYER_VERSION,
    captureId: assertId(record.captureId as string, "layer.captureId"),
    viewport: normalizeViewport(
      record.viewport as BugAnnotationViewport,
      "layer.viewport",
    ),
    annotations: record.annotations.map(readAnnotation),
    nextOrdinal: assertFinite(record.nextOrdinal, "layer.nextOrdinal"),
  };

  const expected = deriveBugAnnotationLayerId(parts);
  if (record.layerId !== expected)
    throw new BugAnnotationError(
      "INVALID_LAYER",
      "layerId does not match the layer contents",
    );
  return freezeDeep({ ...parts, layerId: expected });
}

/**
 * Re-open a stored layer against the capture it belongs to — the "survives re-open" path. Verifies the
 * transport AND the binding, so marks can only ever be re-hung over the exact image they were drawn on.
 *
 * The viewport is deliberately NOT required to match: re-opening on a different-sized window is the
 * normal case and the whole reason coordinates are normalized. What must match is the capture identity.
 */
export function reopenBugAnnotationLayer(
  json: string,
  capture: AnnotatedCaptureRef,
): BugAnnotationLayer {
  if (!capture || typeof capture !== "object")
    throw new BugAnnotationError(
      "CAPTURE_MISMATCH",
      "a capture reference is required to re-open an annotation layer",
    );
  const layer = parseBugAnnotationLayer(json);
  const captureId = assertId(capture.captureId, "capture.captureId");
  if (layer.captureId !== captureId)
    throw new BugAnnotationError(
      "CAPTURE_MISMATCH",
      `annotation layer belongs to capture ${layer.captureId}, not ${captureId}`,
    );
  return layer;
}

// ---------------------------------------------------------------------------------------------
// resolving to pixels
// ---------------------------------------------------------------------------------------------

export interface BugAnnotationPixel {
  readonly x: number;
  readonly y: number;
}

export interface ResolvedArrow {
  readonly kind: "arrow";
  readonly id: string;
  readonly color: string;
  readonly lineWidth: number;
  readonly from: BugAnnotationPixel;
  readonly to: BugAnnotationPixel;
  /** The two barbs, already rotated onto the shaft. Derived, never stored — see property 1. */
  readonly head: readonly [BugAnnotationPixel, BugAnnotationPixel];
}

export interface ResolvedBox {
  readonly kind: "box";
  readonly id: string;
  readonly color: string;
  readonly lineWidth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ResolvedFreehand {
  readonly kind: "freehand";
  readonly id: string;
  readonly color: string;
  readonly lineWidth: number;
  readonly points: readonly BugAnnotationPixel[];
}

export type ResolvedBugAnnotation =
  | ResolvedArrow
  | ResolvedBox
  | ResolvedFreehand;

export interface BugAnnotationOverlay {
  readonly layerId: string;
  readonly captureId: string;
  /** Device pixels — width * devicePixelRatio — i.e. the backing store size a canvas should be sized to. */
  readonly width: number;
  readonly height: number;
  readonly annotations: readonly ResolvedBugAnnotation[];
}

/** Arrow head length as a fraction of the shaft, bounded so a very long arrow does not grow a comic head
 *  and a very short one does not lose its head entirely. */
const ARROW_HEAD_RATIO = 0.18;
const ARROW_HEAD_MIN_PX = 8;
const ARROW_HEAD_MAX_PX = 48;
/** Half-angle of the barbs off the shaft. 26 degrees reads as an arrow at a glance without looking like a Y. */
const ARROW_HEAD_HALF_ANGLE = (26 * Math.PI) / 180;

/**
 * Turn normalized marks into device pixels for the viewport being rendered RIGHT NOW.
 *
 * This is the only place normalization is undone, and it deliberately ignores `layer.viewport`: passing
 * the stored viewport instead of the live one is the exact bug this design exists to prevent, and doing
 * it here would hide it behind a correct-looking call site.
 */
export function resolveBugAnnotationOverlay(
  layer: BugAnnotationLayer,
  viewport: BugAnnotationViewport,
): BugAnnotationOverlay {
  const base = requireLayer(layer);
  const view = normalizeViewport(viewport, "viewport");
  const width = view.width * view.devicePixelRatio;
  const height = view.height * view.devicePixelRatio;
  // Stroke widths scale off the SHORTER edge so a mark keeps its weight when the window is very wide.
  const strokeBasis = Math.min(width, height);

  const toPixel = (point: BugAnnotationPoint): BugAnnotationPixel => ({
    x: point.u * width,
    y: point.v * height,
  });

  const annotations = base.annotations.map(
    (annotation): ResolvedBugAnnotation => {
      const lineWidth = annotation.style.strokeWidth * strokeBasis;
      switch (annotation.kind) {
        case "arrow": {
          const from = toPixel(annotation.from);
          const to = toPixel(annotation.to);
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const shaft = Math.hypot(dx, dy);
          // Guard is unreachable for a normalized arrow (DEGENERATE_SHAPE rejects zero-length at add
          // time) but keeps the maths total for a hand-built layer that slipped through a future path.
          const angle = shaft === 0 ? 0 : Math.atan2(dy, dx);
          const headLength = Math.min(
            ARROW_HEAD_MAX_PX,
            Math.max(ARROW_HEAD_MIN_PX, shaft * ARROW_HEAD_RATIO),
          );
          const barb = (sign: number): BugAnnotationPixel => {
            const theta = angle + Math.PI + sign * ARROW_HEAD_HALF_ANGLE;
            return {
              x: to.x + Math.cos(theta) * headLength,
              y: to.y + Math.sin(theta) * headLength,
            };
          };
          return {
            kind: "arrow",
            id: annotation.id,
            color: annotation.style.color,
            lineWidth,
            from,
            to,
            head: [barb(-1), barb(1)],
          };
        }
        case "box": {
          const min = toPixel(annotation.min);
          const max = toPixel(annotation.max);
          return {
            kind: "box",
            id: annotation.id,
            color: annotation.style.color,
            lineWidth,
            x: min.x,
            y: min.y,
            width: max.x - min.x,
            height: max.y - min.y,
          };
        }
        case "freehand":
          return {
            kind: "freehand",
            id: annotation.id,
            color: annotation.style.color,
            lineWidth,
            points: annotation.points.map(toPixel),
          };
      }
    },
  );

  return freezeDeep({
    layerId: base.layerId,
    captureId: base.captureId,
    width,
    height,
    annotations,
  });
}

// ---------------------------------------------------------------------------------------------
// painting
// ---------------------------------------------------------------------------------------------

/**
 * The slice of a 2D drawing surface this module uses, declared structurally so nothing here depends on
 * DOM lib types. A real `CanvasRenderingContext2D`, an `OffscreenCanvasRenderingContext2D` in a worker,
 * and a recording fake in tests all satisfy it.
 */
export interface Annotation2DContext {
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
}

/**
 * Paint a resolved overlay back-to-front. Pure output: reads nothing from the context, so painting twice
 * paints the same picture, and the caller owns when to clear.
 */
export function paintBugAnnotationOverlay(
  ctx: Annotation2DContext,
  overlay: BugAnnotationOverlay,
): void {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const annotation of overlay.annotations) {
    ctx.strokeStyle = annotation.color;
    ctx.lineWidth = annotation.lineWidth;
    switch (annotation.kind) {
      case "arrow":
        ctx.beginPath();
        ctx.moveTo(annotation.from.x, annotation.from.y);
        ctx.lineTo(annotation.to.x, annotation.to.y);
        // Barbs are drawn as two strokes INTO the tip rather than a closed triangle, so the head keeps
        // its shape at any line width without needing a fill style.
        ctx.moveTo(annotation.head[0].x, annotation.head[0].y);
        ctx.lineTo(annotation.to.x, annotation.to.y);
        ctx.lineTo(annotation.head[1].x, annotation.head[1].y);
        ctx.stroke();
        break;
      case "box":
        ctx.strokeRect(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height,
        );
        break;
      case "freehand": {
        ctx.beginPath();
        const [first, ...rest] = annotation.points;
        ctx.moveTo(first.x, first.y);
        for (const point of rest) ctx.lineTo(point.x, point.y);
        ctx.stroke();
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------------------------

export interface BugAnnotationSummary {
  readonly layerId: string;
  readonly captureId: string;
  readonly total: number;
  readonly byKind: Readonly<Record<BugAnnotationKind, number>>;
}

/** A one-line description for a report body or a review listing, without shipping the geometry. */
export function summarizeBugAnnotations(
  layer: BugAnnotationLayer,
): BugAnnotationSummary {
  const base = requireLayer(layer);
  const byKind: Record<BugAnnotationKind, number> = {
    arrow: 0,
    box: 0,
    freehand: 0,
  };
  for (const annotation of base.annotations) byKind[annotation.kind] += 1;
  return freezeDeep({
    layerId: base.layerId,
    captureId: base.captureId,
    total: base.annotations.length,
    byKind,
  });
}
