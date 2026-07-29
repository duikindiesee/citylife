# Spec 160 — In-world bug capture: reproducible context record (BUG.CAPTURE.1)

- **Status:** proposed for review. The record and its adapters ship here; no UI surface is wired yet.
- **Depends on:** spec 152 (authoritative spatial registry — `SpatialLocation`, `toPublicPresence`,
  frame transforms) and spec 150 (canonical sol clock).
- **Blocked on for a user-visible flow:** BUG.GEO.1 (the geolocation overlay), which owns the
  authoritative presence address this record consumes.
- **Design provenance:** the operator brief
  `bridge/from-claude-citylife/2026-07-23-in-world-bug-reporting-and-kco-bounty.md`, decomposition
  item 2. Items 3–6 (annotation, Markdown/Mermaid composition, tracking, KCO reward) retain their own
  tasks and are explicitly out of scope.

## The product rule

A bug filed from inside CityLife is worthless if a reviewer cannot stand where the reporter stood.
The capture must therefore carry enough to REPRODUCE the view, not merely describe it: the 3D camera
pose, the presence address, the world seed and the canonical sol. A screenshot is evidence; it is
never the source of truth (spec 152).

## What ships

`src/colony/bug/bugCapture.ts` — pure, framework-agnostic (no three.js, no React, no DOM), and it
mutates nothing. Every function returns a new deep-frozen value. No world, player, sim or KCO state
is touched.

- **Compose session.** `openBugCaptureDraft` → `aimBugCaptureDraft` (as often as the reporter likes
  while flying around) → `attachBugCaptureScreenshot` → `commitBugCapture`. Drafts are persistent
  values, so free camera movement while composing is the normal path rather than a special case.
- **`BugCaptureContext`** — the committed record: `world {worldId, seed}`, `sol` (the canonical clock
  at the COMMIT instant), `presence` (exact `SpatialLocation`, coarsened `PublicPresence`, and the
  full ancestor frame chain spec 152 requires), `camera`, `viewport`, `screenshot` and `composeSteps`.
- **`planBugReproduction`** — turns a stored record into instructions the receiving session executes:
  which frame to enter, the portal path to get there, and the camera pose resolved into the ROOT
  frame.
- **`serializeBugCapture` / `parseBugCapture`** — JSON transport with verification.
- **`toShareableBugCapture`** — the coarsened form for pasting into chat.
- **Adapters.** `PlanetRenderer.cameraPose()` / `.viewport()` read the live three.js camera without
  mutating it; `ColonyRuntime.captureBugContext()` pairs the record with a PNG, mirroring the existing
  `captureFirstPersonDemo()` evidence + PNG shape.

## The three decisions worth writing down

### 1. The camera is a registry reference, not a magic vector

Spec 152 already says cameras and named views must be references to registry targets. The pose is
therefore stored in the frame the reporter was actually in — the same frame BUG.GEO.1 reports the
presence address in — and `planBugReproduction` resolves it back into the root frame the renderer
uses. A capture taken in a Kooker HQ boardroom stores boardroom-local numbers; replaying those numbers
straight into the renderer would place the camera roughly 120 m away, in the wrong place, with no
error. That is the whole point of the resolution step, and it is the failure the tests pin.

`up` is a DIRECTION, not a point. It is resolved as the difference of two resolved points, so frame
rotation and scale apply while frame TRANSLATION cancels. Resolving it as a point would add the
frame offset to it and tilt the replayed camera.

### 2. The record is a snapshot, not a live view

The reporter keeps flying after filing. A committed record is deep-frozen and holds no reference to
the caller's pose objects, so later camera movement can never retroactively rewrite a filed report.
The sol likewise comes from the commit instant, not from whenever the record is later serialized or
read — a report always names the sol it was filed on.

### 3. The record is self-verifying

`captureId` is a deterministic FNV-1a digest of every field. Same contents always derive the same id
(stability); any single altered field derives a different one (sensitivity). `parseBugCapture`
recomputes the id and rejects a mismatch, so a truncated or edited record fails loudly instead of
quietly sending a reviewer to the wrong place. The digest is an integrity/identity primitive, never a
security one.

## Privacy

The exact interior point stays in the full record for authorized reproduction. `toShareableBugCapture`
coarsens to the nearest public ancestor frame (building/region/world), matching the citizen roster's
public-presence model: a viewer learns "in Kooker HQ", never "in the boardroom". Screenshot BYTES
never enter the record — only dimensions plus a content fingerprint that binds a specific image to a
specific capture, so the record stays small, JSON-safe and deterministically comparable. `worldId` is
the derived `seed-<n>` identity and carries no credentials or personal data.

## Why `location` is required, not defaulted

`ColonyRuntime.captureBugContext()` takes the presence address as a required argument. Defaulting it
(for example to the camera's own ground point) would file reports pointing at a place the reporter was
not, which is precisely what this record exists to prevent. BUG.GEO.1 supplies it when the overlay
lands; until then the seam is explicit.

## Tests

`tests/bugCapture.test.ts`, 20 deterministic cases over the record — no renderer, no clock, no
randomness. Each of the four load-bearing invariants was verified to DISCRIMINATE: the naive
implementation was restored, the test observed to FAIL, and the real implementation restored.

| Invariant | Naive implementation restored | Tests that failed |
| --- | --- | --- |
| Snapshot, not a live view | draft/record alias the caller's pose; nothing frozen | 2 |
| Reproduction resolves the frame chain | replay the raw frame-local numbers | 3 |
| `up` is a direction | resolve `up` as a point | 2 |
| Self-verifying id | trust the transported id; derive it from the timestamp alone | 3 |

Two-sided coverage is deliberate: id STABILITY is paired with id SENSITIVITY across eleven
single-field mutations; the JSON round-trip asserts the exact key set, so the wire form can neither
lose nor gain a field; and the `up` test asserts both that translation is ignored AND that rotation is
still applied.

## Out of scope

On-screen annotation (BUG.ANNOTATE.1), the Markdown/Mermaid body and assisted chatbox
(BUG.COMPOSE.1), the bug lifecycle wired to the Task API (BUG.TRACK.1), and any KCO reward
(BUG.KCO.1 — reward on VALIDATED fix only, through the existing authenticated score authority).
