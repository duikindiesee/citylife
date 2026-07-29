import { describe, it, expect } from "vitest";
import {
  BUG_ANNOTATION_LAYER_VERSION,
  BugAnnotationError,
  addBugAnnotation,
  clearBugAnnotations,
  deriveBugAnnotationLayerId,
  openBugAnnotationLayer,
  paintBugAnnotationOverlay,
  parseBugAnnotationLayer,
  removeBugAnnotation,
  reopenBugAnnotationLayer,
  resolveBugAnnotationOverlay,
  serializeBugAnnotationLayer,
  summarizeBugAnnotations,
  type Annotation2DContext,
  type AnnotatedCaptureRef,
  type BugAnnotationLayer,
  type BugAnnotationPoint,
} from "../src/colony/bug/bugAnnotation";

// BUG.ANNOTATE.1 — the red-arrow workflow, moved inside CityLife and made replayable.
//
// The invariants worth testing are NOT "does it store what I put in". They are the four ways a marking
// layer silently lies to a reviewer:
//
//   1. It puts the arrow in the wrong place on re-open, because the coordinates were pixels.
//   2. It shows marks over the wrong image, because nothing checked which capture they belong to.
//   3. It loses or reorders marks in transit, because storage was keyed rather than ordered.
//   4. It accepts a mark that was never drawn, because a caller mutated the array it handed in.
//
// Each of those is asserted below, and each assertion was verified to FAIL against the naive
// implementation it exists to rule out (see the discrimination table in the PR body).

const CAPTURE: AnnotatedCaptureRef = {
  captureId: "bugcap_1a2b3c4d5e6f7788",
  viewport: { width: 3840, height: 2160, devicePixelRatio: 2 },
};

const OTHER_CAPTURE: AnnotatedCaptureRef = {
  captureId: "bugcap_99887766554433aa",
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
};

const RED = { color: "#ff2d2d", strokeWidth: 0.004 };
const AMBER = { color: "#ffb020", strokeWidth: 0.006 };

const ARROW = {
  kind: "arrow",
  style: RED,
  from: { u: 0.2, v: 0.1 },
  to: { u: 0.5, v: 0.5 },
} as const;

const BOX = {
  kind: "box",
  style: AMBER,
  min: { u: 0.4, v: 0.4 },
  max: { u: 0.7, v: 0.65 },
} as const;

const FREEHAND = {
  kind: "freehand",
  style: RED,
  points: [
    { u: 0.1, v: 0.9 },
    { u: 0.15, v: 0.85 },
    { u: 0.22, v: 0.88 },
  ],
} as const;

/** A layer with one of each shape, in a known paint order. */
function markedLayer(): BugAnnotationLayer {
  let layer = openBugAnnotationLayer(CAPTURE);
  layer = addBugAnnotation(layer, ARROW);
  layer = addBugAnnotation(layer, BOX);
  layer = addBugAnnotation(layer, FREEHAND);
  return layer;
}

/** Records every call, so painting can be asserted without a DOM. */
function recordingContext(): Annotation2DContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    beginPath: () => void calls.push("beginPath"),
    moveTo: (x, y) =>
      void calls.push(`moveTo(${x.toFixed(2)},${y.toFixed(2)})`),
    lineTo: (x, y) =>
      void calls.push(`lineTo(${x.toFixed(2)},${y.toFixed(2)})`),
    stroke: () => void calls.push("stroke"),
    strokeRect: (x, y, w, h) =>
      void calls.push(
        `strokeRect(${x.toFixed(2)},${y.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)})`,
      ),
    clearRect: (x, y, w, h) =>
      void calls.push(`clearRect(${x},${y},${w},${h})`),
  };
}

describe("bug annotation layer — composing marks (BUG.ANNOTATE.1)", () => {
  it("opens empty, bound to the capture, at the current record version", () => {
    const layer = openBugAnnotationLayer(CAPTURE);
    expect(layer.layerVersion).toBe(BUG_ANNOTATION_LAYER_VERSION);
    expect(layer.captureId).toBe(CAPTURE.captureId);
    expect(layer.annotations).toEqual([]);
    expect(layer.nextOrdinal).toBe(0);
    expect(layer.viewport).toEqual(CAPTURE.viewport);
  });

  it("accepts all three shapes the operator draws by hand today", () => {
    const layer = markedLayer();
    expect(layer.annotations.map((a) => a.kind)).toEqual([
      "arrow",
      "box",
      "freehand",
    ]);
    expect(summarizeBugAnnotations(layer)).toMatchObject({
      captureId: CAPTURE.captureId,
      total: 3,
      byKind: { arrow: 1, box: 1, freehand: 1 },
    });
  });

  it("normalizes a box drawn in any drag direction to the same canonical mark", () => {
    const downRight = addBugAnnotation(openBugAnnotationLayer(CAPTURE), BOX);
    const upLeft = addBugAnnotation(openBugAnnotationLayer(CAPTURE), {
      kind: "box",
      style: AMBER,
      min: BOX.max,
      max: BOX.min,
    });
    expect(upLeft.annotations[0]).toEqual(downRight.annotations[0]);
    // Same picture, same identity — otherwise two reporters drawing the same box file different layers.
    expect(upLeft.layerId).toBe(downRight.layerId);
  });

  it("collapses the repeated points a held-still pointer emits", () => {
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), {
      kind: "freehand",
      style: RED,
      points: [
        { u: 0.1, v: 0.9 },
        { u: 0.1, v: 0.9 },
        { u: 0.1, v: 0.9 },
        { u: 0.15, v: 0.85 },
        { u: 0.15, v: 0.85 },
      ],
    });
    const stroke = layer.annotations[0];
    expect(stroke.kind).toBe("freehand");
    if (stroke.kind !== "freehand") throw new Error("expected a freehand mark");
    expect(stroke.points).toEqual([
      { u: 0.1, v: 0.9 },
      { u: 0.15, v: 0.85 },
    ]);
  });

  it("rejects marks that were clicks rather than drawings", () => {
    const layer = openBugAnnotationLayer(CAPTURE);
    expect(() =>
      addBugAnnotation(layer, {
        kind: "arrow",
        style: RED,
        from: { u: 0.5, v: 0.5 },
        to: { u: 0.5, v: 0.5 },
      }),
    ).toThrowError(BugAnnotationError);
    expect(() =>
      addBugAnnotation(layer, {
        kind: "box",
        style: RED,
        min: { u: 0.5, v: 0.5 },
        max: { u: 0.5, v: 0.5 },
      }),
    ).toThrowError(/box needs an area/);
    expect(() =>
      addBugAnnotation(layer, {
        kind: "freehand",
        style: RED,
        points: [{ u: 0.5, v: 0.5 }],
      }),
    ).toThrowError(/at least two distinct points/);
  });

  it("rejects a mark that falls outside the captured image instead of clamping it", () => {
    const layer = openBugAnnotationLayer(CAPTURE);
    // Clamping would move the operator's arrow and still present it as theirs.
    expect(() =>
      addBugAnnotation(layer, {
        kind: "arrow",
        style: RED,
        from: { u: -0.2, v: 0.5 },
        to: { u: 0.5, v: 0.5 },
      }),
    ).toThrowError(/0\.\.1/);
    expect(() =>
      addBugAnnotation(layer, {
        kind: "arrow",
        style: RED,
        from: { u: 0.1, v: 0.5 },
        to: { u: 1.4, v: 0.5 },
      }),
    ).toThrowError(BugAnnotationError);
    expect(() =>
      addBugAnnotation(layer, {
        kind: "arrow",
        style: RED,
        from: { u: 0.1, v: Number.NaN },
        to: { u: 0.5, v: 0.5 },
      }),
    ).toThrowError(/finite/);
  });

  it("rejects a style that would paint nothing or paint the whole image", () => {
    const layer = openBugAnnotationLayer(CAPTURE);
    for (const strokeWidth of [0, -0.01, 1.5]) {
      expect(() =>
        addBugAnnotation(layer, {
          kind: "arrow",
          style: { color: "#fff", strokeWidth },
          from: { u: 0.1, v: 0.1 },
          to: { u: 0.4, v: 0.4 },
        }),
      ).toThrowError(/strokeWidth/);
    }
    expect(() =>
      addBugAnnotation(layer, {
        kind: "arrow",
        style: { color: "  ", strokeWidth: 0.004 },
        from: { u: 0.1, v: 0.1 },
        to: { u: 0.4, v: 0.4 },
      }),
    ).toThrowError(/color/);
  });
});

describe("bug annotation layer — a committed layer is a snapshot", () => {
  // Property 5. The reporter's pointer keeps moving after they let go of the mouse; a layer that aliased
  // the caller's array would keep growing the mark after it was filed.
  it("does not alias the caller's point array", () => {
    const live: BugAnnotationPoint[] = [
      { u: 0.1, v: 0.1 },
      { u: 0.2, v: 0.2 },
    ];
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), {
      kind: "freehand",
      style: RED,
      points: live,
    });
    const before = serializeBugAnnotationLayer(layer);
    live.push({ u: 0.9, v: 0.9 });
    live[0] = { u: 0.5, v: 0.5 };
    expect(serializeBugAnnotationLayer(layer)).toBe(before);
    const stroke = layer.annotations[0];
    if (stroke.kind !== "freehand") throw new Error("expected a freehand mark");
    expect(stroke.points).toHaveLength(2);
  });

  it("is deep-frozen, so a stray write cannot rewrite a filed report", () => {
    const layer = markedLayer();
    expect(Object.isFrozen(layer)).toBe(true);
    expect(Object.isFrozen(layer.annotations)).toBe(true);
    expect(Object.isFrozen(layer.annotations[0])).toBe(true);
    const arrow = layer.annotations[0];
    if (arrow.kind !== "arrow") throw new Error("expected an arrow");
    expect(Object.isFrozen(arrow.from)).toBe(true);
  });

  it("leaves the previous layer untouched when a mark is added or removed", () => {
    const one = addBugAnnotation(openBugAnnotationLayer(CAPTURE), ARROW);
    const two = addBugAnnotation(one, BOX);
    expect(one.annotations).toHaveLength(1);
    expect(two.annotations).toHaveLength(2);
    const back = removeBugAnnotation(two, two.annotations[1].id);
    expect(two.annotations).toHaveLength(2);
    expect(back.annotations).toHaveLength(1);
  });
});

describe("bug annotation layer — paint order is authoring order", () => {
  // Property 4. Keying storage by id makes removal cheap and scrambles the picture; the scrambling is
  // invisible until a human looks at the image, which is exactly too late for a bug report.
  it("keeps overlapping marks in the order they were drawn", () => {
    const layer = markedLayer();
    expect(layer.annotations.map((a) => a.kind)).toEqual([
      "arrow",
      "box",
      "freehand",
    ]);
  });

  it("preserves that order exactly across a serialize/parse round-trip", () => {
    const layer = markedLayer();
    const restored = parseBugAnnotationLayer(
      serializeBugAnnotationLayer(layer),
    );
    expect(restored.annotations.map((a) => a.id)).toEqual(
      layer.annotations.map((a) => a.id),
    );
    expect(restored.annotations.map((a) => a.kind)).toEqual([
      "arrow",
      "box",
      "freehand",
    ]);
  });

  it("keeps the survivors in order after a mark is removed from the middle", () => {
    const layer = markedLayer();
    const trimmed = removeBugAnnotation(layer, layer.annotations[1].id);
    expect(trimmed.annotations.map((a) => a.kind)).toEqual([
      "arrow",
      "freehand",
    ]);
    const restored = parseBugAnnotationLayer(
      serializeBugAnnotationLayer(trimmed),
    );
    expect(restored.annotations.map((a) => a.id)).toEqual(
      trimmed.annotations.map((a) => a.id),
    );
  });

  it("treats a reordering of the same marks as a different layer", () => {
    // Two marks, same geometry, opposite draw order: a different picture, so a different identity.
    let a = openBugAnnotationLayer(CAPTURE);
    a = addBugAnnotation(a, ARROW);
    a = addBugAnnotation(a, BOX);
    let b = openBugAnnotationLayer(CAPTURE);
    b = addBugAnnotation(b, BOX);
    b = addBugAnnotation(b, ARROW);
    expect(b.layerId).not.toBe(a.layerId);
  });

  it("never mints a removed mark's id again", () => {
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), ARROW);
    const removedId = layer.annotations[0].id;
    const emptied = removeBugAnnotation(layer, removedId);
    expect(emptied.nextOrdinal).toBe(1);
    const redrawn = addBugAnnotation(emptied, ARROW);
    expect(redrawn.annotations[0].id).not.toBe(removedId);
  });

  it("refuses to remove a mark that is not in this layer", () => {
    expect(() =>
      removeBugAnnotation(markedLayer(), "bugann_deadbeef"),
    ).toThrowError(/not in this layer/);
  });

  it("clears every mark while keeping the binding and the ordinal watermark", () => {
    const layer = markedLayer();
    const cleared = clearBugAnnotations(layer);
    expect(cleared.annotations).toEqual([]);
    expect(cleared.captureId).toBe(CAPTURE.captureId);
    expect(cleared.nextOrdinal).toBe(layer.nextOrdinal);
  });
});

describe("bug annotation layer — serialisation and round-trip", () => {
  it("round-trips to a value equal to the original, with the EXACT key set", () => {
    const layer = markedLayer();
    const restored = parseBugAnnotationLayer(
      serializeBugAnnotationLayer(layer),
    );
    expect(restored).toEqual(layer);
    // A field that is added to the record but not to the digest (or the reverse) is caught here.
    expect(Object.keys(restored).sort()).toEqual(
      [
        "annotations",
        "captureId",
        "layerId",
        "layerVersion",
        "nextOrdinal",
        "viewport",
      ].sort(),
    );
    expect(Object.keys(restored.annotations[0]).sort()).toEqual(
      ["from", "id", "kind", "style", "to"].sort(),
    );
  });

  it("re-derives a stable id: an unchanged layer always digests the same", () => {
    const layer = markedLayer();
    const { layerId, ...parts } = layer;
    expect(deriveBugAnnotationLayerId(parts)).toBe(layerId);
    expect(markedLayer().layerId).toBe(layerId);
  });

  it("re-derives a SENSITIVE id: any single altered field changes it", () => {
    const layer = markedLayer();
    const { layerId, ...parts } = layer;
    const mutations: Array<
      [string, () => Omit<BugAnnotationLayer, "layerId">]
    > = [
      ["captureId", () => ({ ...parts, captureId: "bugcap_0000000000000000" })],
      [
        "viewport.width",
        () => ({ ...parts, viewport: { ...parts.viewport, width: 1920 } }),
      ],
      [
        "viewport.devicePixelRatio",
        () => ({
          ...parts,
          viewport: { ...parts.viewport, devicePixelRatio: 1 },
        }),
      ],
      ["nextOrdinal", () => ({ ...parts, nextOrdinal: 9 })],
      [
        "a dropped mark",
        () => ({ ...parts, annotations: parts.annotations.slice(1) }),
      ],
      [
        "an arrow tip moved",
        () => ({
          ...parts,
          annotations: [
            {
              ...parts.annotations[0],
              to: { u: 0.51, v: 0.5 },
            } as (typeof parts.annotations)[number],
            ...parts.annotations.slice(1),
          ],
        }),
      ],
      [
        "a colour changed",
        () => ({
          ...parts,
          annotations: [
            {
              ...parts.annotations[0],
              style: { ...parts.annotations[0].style, color: "#00ff00" },
            },
            ...parts.annotations.slice(1),
          ],
        }),
      ],
      [
        "a stroke width changed",
        () => ({
          ...parts,
          annotations: [
            {
              ...parts.annotations[0],
              style: { ...parts.annotations[0].style, strokeWidth: 0.02 },
            },
            ...parts.annotations.slice(1),
          ],
        }),
      ],
    ];
    for (const [label, mutate] of mutations) {
      expect(deriveBugAnnotationLayerId(mutate()), label).not.toBe(layerId);
    }
  });

  it("rejects a layer whose marks were edited in transit", () => {
    const layer = markedLayer();
    const tampered = JSON.parse(serializeBugAnnotationLayer(layer));
    tampered.annotations[0].to = { u: 0.9, v: 0.9 };
    expect(() =>
      parseBugAnnotationLayer(JSON.stringify(tampered)),
    ).toThrowError(/layerId does not match/);
  });

  it("rejects a layer that lost a mark in transit", () => {
    const layer = markedLayer();
    const truncated = JSON.parse(serializeBugAnnotationLayer(layer));
    truncated.annotations.pop();
    expect(() =>
      parseBugAnnotationLayer(JSON.stringify(truncated)),
    ).toThrowError(/layerId does not match/);
  });

  it("rejects malformed, mis-versioned and non-JSON transports", () => {
    expect(() => parseBugAnnotationLayer("not json")).toThrowError(
      /valid JSON/,
    );
    expect(() => parseBugAnnotationLayer("[]")).toThrowError(
      BugAnnotationError,
    );
    const layer = markedLayer();
    const wrongVersion = JSON.parse(serializeBugAnnotationLayer(layer));
    wrongVersion.layerVersion = 99;
    expect(() =>
      parseBugAnnotationLayer(JSON.stringify(wrongVersion)),
    ).toThrowError(/unsupported bug annotation layer version/);
    const badShape = JSON.parse(serializeBugAnnotationLayer(layer));
    badShape.annotations[0].kind = "scribble";
    expect(() =>
      parseBugAnnotationLayer(JSON.stringify(badShape)),
    ).toThrowError(/not a supported shape/);
  });
});

describe("bug annotation layer — a layer belongs to exactly one capture", () => {
  // Property 2. This is the invariant that stops an arrow that means "this kerb is wrong" from being
  // re-hung over a different junction and asserting something false with the operator's authority.
  it("re-opens against the capture it was drawn on", () => {
    const layer = markedLayer();
    const restored = reopenBugAnnotationLayer(
      serializeBugAnnotationLayer(layer),
      CAPTURE,
    );
    expect(restored).toEqual(layer);
  });

  it("refuses to re-open over a DIFFERENT capture", () => {
    const layer = markedLayer();
    expect(() =>
      reopenBugAnnotationLayer(
        serializeBugAnnotationLayer(layer),
        OTHER_CAPTURE,
      ),
    ).toThrowError(/belongs to capture/);
  });

  it("re-opens happily at a different window size — that is the normal case", () => {
    const layer = markedLayer();
    const restored = reopenBugAnnotationLayer(
      serializeBugAnnotationLayer(layer),
      {
        captureId: CAPTURE.captureId,
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      },
    );
    expect(restored.annotations).toEqual(layer.annotations);
  });

  it("survives the full file -> store -> re-open journey unchanged", () => {
    const layer = markedLayer();
    // Exactly what persistence does: one string in, one string out, nothing else carried across.
    const stored = serializeBugAnnotationLayer(layer);
    const reopened = reopenBugAnnotationLayer(stored, CAPTURE);
    expect(serializeBugAnnotationLayer(reopened)).toBe(stored);
    expect(reopened.layerId).toBe(layer.layerId);
  });
});

describe("bug annotation overlay — marks land on the same pixel of the world", () => {
  // Property 1. THE headline invariant: the operator files from a 4K display, the reviewer re-opens at
  // 720p, and the arrow must still point at the defect.
  it("scales normalized marks to whatever viewport is being rendered now", () => {
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), ARROW);
    const small = resolveBugAnnotationOverlay(layer, {
      width: 1000,
      height: 500,
      devicePixelRatio: 1,
    });
    const arrow = small.annotations[0];
    if (arrow.kind !== "arrow") throw new Error("expected an arrow");
    expect(arrow.from).toEqual({ x: 200, y: 50 });
    expect(arrow.to).toEqual({ x: 500, y: 250 });
    expect(small.width).toBe(1000);
    expect(small.height).toBe(500);
  });

  it("puts a mark at the same FRACTION of the image at every size and DPR", () => {
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), ARROW);
    const viewports = [
      { width: 1280, height: 720, devicePixelRatio: 1 },
      { width: 3840, height: 2160, devicePixelRatio: 2 },
      { width: 800, height: 1400, devicePixelRatio: 3 },
    ];
    for (const viewport of viewports) {
      const overlay = resolveBugAnnotationOverlay(layer, viewport);
      const arrow = overlay.annotations[0];
      if (arrow.kind !== "arrow") throw new Error("expected an arrow");
      // The fraction is the thing that must be invariant — the pixels are supposed to differ.
      expect(arrow.to.x / overlay.width).toBeCloseTo(0.5, 12);
      expect(arrow.to.y / overlay.height).toBeCloseTo(0.5, 12);
      expect(arrow.from.x / overlay.width).toBeCloseTo(0.2, 12);
      expect(arrow.from.y / overlay.height).toBeCloseTo(0.1, 12);
    }
  });

  it("resolves against the LIVE viewport, never the one stored on the layer", () => {
    // A layer drawn at 3840x2160@2 resolved into a 1280x720@1 window must produce 1280x720 pixels.
    // An implementation that reached for `layer.viewport` would return 7680x4320 here.
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), BOX);
    const overlay = resolveBugAnnotationOverlay(layer, {
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
    });
    expect(overlay.width).toBe(1280);
    expect(overlay.height).toBe(720);
    const box = overlay.annotations[0];
    if (box.kind !== "box") throw new Error("expected a box");
    expect(box.x).toBeCloseTo(0.4 * 1280, 9);
    expect(box.width).toBeCloseTo(0.3 * 1280, 9);
    expect(box.height).toBeCloseTo(0.25 * 720, 9);
  });

  it("doubles every pixel coordinate when the backing store doubles", () => {
    const layer = markedLayer();
    const at1 = resolveBugAnnotationOverlay(layer, {
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
    });
    const at2 = resolveBugAnnotationOverlay(layer, {
      width: 1280,
      height: 720,
      devicePixelRatio: 2,
    });
    const a = at1.annotations[2];
    const b = at2.annotations[2];
    if (a.kind !== "freehand" || b.kind !== "freehand")
      throw new Error("expected freehand marks");
    for (let i = 0; i < a.points.length; i += 1) {
      expect(b.points[i].x).toBeCloseTo(a.points[i].x * 2, 9);
      expect(b.points[i].y).toBeCloseTo(a.points[i].y * 2, 9);
    }
    expect(b.lineWidth).toBeCloseTo(a.lineWidth * 2, 9);
  });

  it("keeps a mark's visual weight on a very wide window", () => {
    // Stroke widths normalize against the SHORTER edge. Against the longer edge (or the diagonal), a
    // 3440x1440 ultrawide would fatten every mark by more than a third relative to a 1440p square-ish
    // window, and the same report would read differently to two reviewers.
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), ARROW);
    const wide = resolveBugAnnotationOverlay(layer, {
      width: 3440,
      height: 1440,
      devicePixelRatio: 1,
    });
    const tall = resolveBugAnnotationOverlay(layer, {
      width: 1440,
      height: 3440,
      devicePixelRatio: 1,
    });
    expect(wide.annotations[0].lineWidth).toBeCloseTo(
      tall.annotations[0].lineWidth,
      9,
    );
    expect(wide.annotations[0].lineWidth).toBeCloseTo(0.004 * 1440, 9);
  });

  it("derives the arrow head from the shaft rather than storing it", () => {
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), ARROW);
    const overlay = resolveBugAnnotationOverlay(layer, {
      width: 1000,
      height: 1000,
      devicePixelRatio: 1,
    });
    const arrow = overlay.annotations[0];
    if (arrow.kind !== "arrow") throw new Error("expected an arrow");
    const shaftX = arrow.to.x - arrow.from.x;
    const shaftY = arrow.to.y - arrow.from.y;
    for (const barb of arrow.head) {
      const bx = barb.x - arrow.to.x;
      const by = barb.y - arrow.to.y;
      // A barb must point BACK along the shaft. A head that failed to rotate with the arrow would
      // point a fixed direction and this dot product would go positive for some arrows.
      expect(shaftX * bx + shaftY * by).toBeLessThan(0);
    }
    // The two barbs straddle the shaft: mirrored about it, so they are distinct points.
    expect(arrow.head[0]).not.toEqual(arrow.head[1]);
  });

  it("rotates the head with the arrow, in all four quadrants", () => {
    const centre = { u: 0.5, v: 0.5 };
    const tips = [
      { u: 0.9, v: 0.5 },
      { u: 0.1, v: 0.5 },
      { u: 0.5, v: 0.9 },
      { u: 0.5, v: 0.1 },
    ];
    for (const tip of tips) {
      const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), {
        kind: "arrow",
        style: RED,
        from: centre,
        to: tip,
      });
      const overlay = resolveBugAnnotationOverlay(layer, {
        width: 1000,
        height: 1000,
        devicePixelRatio: 1,
      });
      const arrow = overlay.annotations[0];
      if (arrow.kind !== "arrow") throw new Error("expected an arrow");
      const shaftX = arrow.to.x - arrow.from.x;
      const shaftY = arrow.to.y - arrow.from.y;
      for (const barb of arrow.head) {
        const bx = barb.x - arrow.to.x;
        const by = barb.y - arrow.to.y;
        expect(shaftX * bx + shaftY * by).toBeLessThan(0);
      }
    }
  });

  it("bounds the arrow head so it is neither a speck nor a comic flag", () => {
    const tiny = addBugAnnotation(openBugAnnotationLayer(CAPTURE), {
      kind: "arrow",
      style: RED,
      from: { u: 0.5, v: 0.5 },
      to: { u: 0.505, v: 0.5 },
    });
    const huge = addBugAnnotation(openBugAnnotationLayer(CAPTURE), {
      kind: "arrow",
      style: RED,
      from: { u: 0.02, v: 0.02 },
      to: { u: 0.98, v: 0.98 },
    });
    const viewport = { width: 4000, height: 4000, devicePixelRatio: 1 };
    for (const [label, layer] of [
      ["tiny", tiny],
      ["huge", huge],
    ] as const) {
      const arrow = resolveBugAnnotationOverlay(layer, viewport).annotations[0];
      if (arrow.kind !== "arrow") throw new Error("expected an arrow");
      const headLength = Math.hypot(
        arrow.head[0].x - arrow.to.x,
        arrow.head[0].y - arrow.to.y,
      );
      expect(headLength, label).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(headLength, label).toBeLessThanOrEqual(48 + 1e-9);
    }
  });

  it("carries the binding through to the overlay so a painter cannot mix reports", () => {
    const overlay = resolveBugAnnotationOverlay(
      markedLayer(),
      CAPTURE.viewport,
    );
    expect(overlay.captureId).toBe(CAPTURE.captureId);
    expect(overlay.layerId).toBe(markedLayer().layerId);
  });

  it("rejects a nonsensical viewport rather than dividing by zero", () => {
    const layer = markedLayer();
    for (const viewport of [
      { width: 0, height: 720, devicePixelRatio: 1 },
      { width: 1280, height: -720, devicePixelRatio: 1 },
      { width: 1280, height: 720, devicePixelRatio: 0 },
      { width: 1280.5, height: 720, devicePixelRatio: 1 },
    ]) {
      expect(() => resolveBugAnnotationOverlay(layer, viewport)).toThrowError(
        BugAnnotationError,
      );
    }
  });
});

describe("bug annotation overlay — painting", () => {
  it("paints back to front, one stroke per mark", () => {
    const overlay = resolveBugAnnotationOverlay(markedLayer(), {
      width: 100,
      height: 100,
      devicePixelRatio: 1,
    });
    const ctx = recordingContext();
    paintBugAnnotationOverlay(ctx, overlay);
    expect(ctx.calls[0]).toBe("clearRect(0,0,100,100)");
    // arrow (path) -> box (rect) -> freehand (path): the order the reporter drew them in.
    const strokeRectAt = ctx.calls.findIndex((c) => c.startsWith("strokeRect"));
    const firstStrokeAt = ctx.calls.indexOf("stroke");
    const lastStrokeAt = ctx.calls.lastIndexOf("stroke");
    expect(firstStrokeAt).toBeGreaterThan(0);
    expect(strokeRectAt).toBeGreaterThan(firstStrokeAt);
    expect(lastStrokeAt).toBeGreaterThan(strokeRectAt);
    expect(ctx.calls.filter((c) => c === "stroke")).toHaveLength(2);
  });

  it("paints the same picture twice — it reads nothing back from the surface", () => {
    const overlay = resolveBugAnnotationOverlay(markedLayer(), {
      width: 100,
      height: 100,
      devicePixelRatio: 1,
    });
    const first = recordingContext();
    const second = recordingContext();
    paintBugAnnotationOverlay(first, overlay);
    paintBugAnnotationOverlay(second, overlay);
    paintBugAnnotationOverlay(second, overlay);
    expect(second.calls.slice(first.calls.length)).toEqual(first.calls);
  });

  it("walks every point of a freehand stroke", () => {
    const layer = addBugAnnotation(openBugAnnotationLayer(CAPTURE), FREEHAND);
    const overlay = resolveBugAnnotationOverlay(layer, {
      width: 100,
      height: 100,
      devicePixelRatio: 1,
    });
    const ctx = recordingContext();
    paintBugAnnotationOverlay(ctx, overlay);
    expect(ctx.calls.filter((c) => c.startsWith("moveTo"))).toHaveLength(1);
    expect(ctx.calls.filter((c) => c.startsWith("lineTo"))).toHaveLength(2);
  });
});
