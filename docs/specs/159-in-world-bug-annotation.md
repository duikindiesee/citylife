# Spec 159 — On-screen marking over a captured bug view (BUG.ANNOTATE.1)

- **Status:** proposed for review; the pure marking layer ships here, the compose UI does not
- **Depends on:** spec 158 (in-world bug capture — the `captureId` and viewport a layer binds to).
  **Spec 158 is not merged at the time of writing** (PR #415, open). This module therefore declares the
  part of a capture it needs STRUCTURALLY (`AnnotatedCaptureRef`) instead of importing it — see §5.
- **Relates to:** spec 152 (authoritative spatial registry — the presence address a capture carries),
  BUG.GEO.1 (the on-screen geolocation readout burned into a capture),
  `bridge/from-claude-citylife/2026-07-23-in-world-bug-reporting-and-kco-bounty.md` (item 3 of the
  operator's decomposition)
- **Out of scope, deliberately:** the compose UI (pointer handling, the toolbar, the colour picker),
  undo history, text labels and Mermaid/Markdown bodies (BUG.COMPOSE.1), and any persistence rail —
  this module produces and consumes one string.

## 1. Why

The operator's bug reports today are: screenshot, open an external tool, draw a red arrow at the broken
thing, paste the image somewhere. **The arrow is the most valuable part of the report.** A capture of a
junction contains a couple of hundred objects; the arrow is the only thing that says which one is wrong.

And it is the one part that lives outside the repo — unversioned, un-replayable, and gone the moment the
image is re-cropped or re-taken. Spec 158 made the VIEW reproducible. Without this spec, the report still
loses the part that says what to look at.

## 2. Mechanic

`src/colony/bug/bugAnnotation.ts` — pure, framework-agnostic (no three.js, no React, no DOM types), never
mutates world, player, sim or score state. Every function returns a new deep-frozen value.

- **Three shapes**, matching what the operator already draws by hand: `arrow` (tail → tip), `box`
  (min/max), `freehand` (a polyline of at least two distinct points).
- **A layer** binds a list of marks to exactly one capture: `openBugAnnotationLayer(capture)`,
  `addBugAnnotation`, `removeBugAnnotation`, `clearBugAnnotations`.
- **Transport**: `serializeBugAnnotationLayer` / `parseBugAnnotationLayer`, plus
  `reopenBugAnnotationLayer(json, capture)` — the "survives re-open" path, which verifies the transport
  AND the binding.
- **Rendering**: `resolveBugAnnotationOverlay(layer, viewport)` turns normalized marks into device pixels
  for the viewport being rendered right now; `paintBugAnnotationOverlay(ctx, overlay)` draws them through
  a structural 2D-context interface.
- **Reporting**: `summarizeBugAnnotations` for a report body or a review listing.

## 3. The five load-bearing properties

Each has a matching invariant in `tests/bugAnnotation.test.ts`, and each invariant was verified to FAIL
against the naive implementation it rules out (§6).

1. **Marks are normalized, not pixels.** Stored in 0..1 of the capture's viewport. The operator files
   from a 3840×2160 display; the reviewer re-opens at 1280×720. With pixel coordinates every arrow lands
   a third of the way from the defect and still looks deliberate. `resolveBugAnnotationOverlay` is the
   only place normalization is undone, and it takes the CURRENT viewport — it deliberately ignores
   `layer.viewport`, because reaching for the stored one is precisely this bug wearing a correct-looking
   call site.

2. **A layer belongs to exactly one capture.** `reopenBugAnnotationLayer` refuses a layer whose
   `captureId` is not the capture being opened. An arrow meaning "this kerb is wrong", silently re-hung
   over a different junction's screenshot, is worse than no arrow: it asserts something false with the
   operator's authority behind it.

3. **The layer is self-verifying.** `layerId` is a deterministic FNV-1a digest of every mark, in order,
   plus the binding — the same construction `bugCapture.ts` uses, so a reviewer learns the shape once.
   Stability (unchanged layer → same id) is paired with sensitivity (any single altered field → different
   id). `parseBugAnnotationLayer` recomputes and rejects a mismatch.

4. **Paint order is authoring order, and it survives.** Marks are an ORDERED list, never a set or a map.
   A box drawn over an arrow stays over it. Keying storage by id is the natural way to make removal
   cheap, and it scrambles the picture the first time a layer round-trips — invisibly, until a human
   looks at the image, which for a bug report is too late.

5. **A committed layer is a snapshot.** Inputs are copied, never aliased, and the result is deep-frozen,
   so a compose UI that keeps drawing into its own scratch array cannot retroactively rewrite a filed
   report. Same property `bugCapture.ts` holds for the camera pose, for the same reason.

## 4. Decisions worth the reviewer's attention

- **Out-of-image marks are rejected, not clamped.** Clamping moves the operator's arrow and still
  presents it as theirs. A mark outside the image is a bug in the caller.
- **Stroke widths normalize against the SHORTER viewport edge.** Against the longer edge (or the
  diagonal) a 3440×1440 ultrawide fattens every mark by more than a third relative to a squarer window,
  and the same report reads differently to two reviewers.
- **Consecutive duplicate points are collapsed.** A pointer held still emits the same coordinate many
  times; without collapsing, the same stroke drawn with a mouse and with a stylus digests differently.
- **`nextOrdinal` never rewinds on removal.** A removed mark's id must never be minted again, or a stale
  link would silently start resolving to a different mark.
- **A drag shorter than `MIN_ANNOTATION_EXTENT` is a click, not a mark.** Otherwise a report accumulates
  invisible zero-length arrows that read to a reviewer as noise on the image.
- **The transport form is canonical.** Both construction paths (freshly drawn, and parsed from storage)
  seal marks through one function so `JSON.stringify` emits keys in one fixed order. This was found by
  the round-trip test, not predicted: without it, a layer and its own re-parse produce different BYTES
  despite the same `layerId`, and any content-addressed store or "has this changed?" check sees two
  records where there is one.
- **The arrow head is derived, never stored.** Barb geometry is computed from the shaft at resolve time
  and bounded (8–48 px) so a short arrow keeps a visible head and a long one does not grow a comic flag.

## 5. The spec-158 seam

`AnnotatedCaptureRef` is `{ captureId: string; viewport: { width; height; devicePixelRatio } }`. A
spec-158 `BugCaptureContext` satisfies it structurally, as-is, with no shim and no adapter — so when
PR #415 merges, wiring is `openBugAnnotationLayer(capture)` and nothing else.

Declaring the dependency structurally rather than importing it is deliberate: it keeps this slice
independently mergeable and independently reviewable, and it stops one open PR's review from blocking
another's. It also happens to be the honest shape of the coupling — a marking layer genuinely does not
care how the image underneath it was produced.

## 6. Discrimination check — verified, not asserted

Fifteen naive implementations were restored one at a time, the suite observed to FAIL, and the fix
restored. The full table is in the PR body and in
`bridge/from-claude-citylife/2026-07-29-bug-annotate-1-marking.md`. Headline results:

| Naive implementation restored | Result |
| --- | --- |
| Resolve uses the layer's STORED viewport (marks are effectively pixels) | 6 failed / 34 passed |
| Storage keyed by id (paint order becomes id-sorted) | 6 failed / 34 passed |
| `layerId` from a counter instead of a content digest | 4 failed / 36 passed |
| Freehand stores the caller's live array by reference | 3 failed / 37 passed |
| Re-open ignores which capture the marks belong to | 1 failed / 39 passed |
| Fix restored | **40 passed / 40** |

## 7. Open questions

- **Colour palette.** `style.color` is an opaque token this module never parses, so a theme can swap the
  palette without a record migration. Which palette the compose UI offers is BUG.COMPOSE.1's call.
- **Where a layer is stored.** This module produces and consumes one string; it takes no position on
  whether that lands beside the capture PNG, in the bug record, or in the Task API. BUG.TRACK.1 decides.
