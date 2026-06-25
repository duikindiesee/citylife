# Top layer lens controls — making the upper screen readable

**Date:** 2026-06-25 20:21 SAST  
**Status:** research proposal / discussion space  
**Owner lane:** Player & UI, with Claude review requested before implementation  
**Scope:** docs-only research. No runtime, no map-layer, no district/signage implementation in this PR.

## Why this exists

Irwin called out the top-of-screen controls: when the screen is clicked or explored, the current upper UI shows several technical toggles together — camera height/preset, `Biome`, `Buildable`, `Elevation`, district/street concepts, race controls, liveability, and snapshot. The controls work, but the player cannot immediately tell which buttons are:

- **camera scale**: Street / District / Planet;
- **world lens**: Biome / Buildable / Elevation;
- **city/game actions**: Road Rally / Join Race / Liveability / Snapshot;
- **future map overlays**: district, street, POI, signage, route, or commercial-heart reads.

The issue is not that the controls are wrong. The issue is that they are all sitting in the same top strip, so a player reads them as one mixed sentence. That makes the top bar feel like developer tooling instead of a game-world control surface.

This document creates a research space for the question: **how should CityLife expose map/layer information without covering the world or confusing the player?**

## Current repo facts

Observed in the live code on `main`:

- `src/colony/ui/ColonyApp.tsx` defines camera presets:
  - `Street`
  - `District`
  - `Planet`
- The same file defines terrain view modes:
  - `Biome`
  - `Buildable`
  - `Elevation`
- The top bar currently renders, left-to-right:
  - brand / sim clock;
  - pause + speed;
  - camera preset buttons;
  - terrain view buttons;
  - Road Rally;
  - Join Race when ready;
  - Liveability;
  - snapshot.
- `src/colony/runtime.ts` owns `setPreset()` and `setView()` and forwards them to the renderer.
- `src/colony/render/PlanetRenderer.ts` currently models:
  - `ViewMode = "biome" | "buildable" | "elevation"`;
  - `CameraPreset = "street" | "district" | "planet"`;
  - recolouring for view modes via `colorFor()`;
  - staged terrain recolouring so view toggles do not stall large maps.
- `docs/VISION-open-world.md` now says the world is heading toward a Need-for-Speed-feel open-world car game, but district/mall/garage/POI/signage layers remain sequenced behind the phase roadmap.
- PR #152 (`jack/phase-2a-district-scale-up`) is open for the world/district scale-up path, so this research must not assume district-layer implementation is already merged.

## Problem statement

The top strip currently mixes four different mental models:

1. **Time controls** — pause and speed.
2. **Camera controls** — where the player is seeing from.
3. **Map lenses** — what information the ground is coloured by.
4. **Game verbs** — race, join, liveability, save snapshot.

When those are visually equal, the user has to decode the toolbar before they can read the world. That is expensive, especially on a TV/mobile/gameplay screen where the goal is to watch and drive, not operate a GIS tool.

The top bar should become a **game-facing lens deck**: a small readable control area that answers only one question at a time:

> What am I looking at right now, and what other lens can I switch to?

## Research direction: split Camera from Lens from Actions

### 1. Camera scale should be a camera deck

Keep the three presets, but frame them as where the player is watching from:

- **Street** — human / Joe-eye scale, for walking, nameplates, friends, garage doors, rally props.
- **District** — city-block scale, for commercial heart, rally overlook, garage intersection, roads.
- **Planet** — whole-island scale, for orientation and ambience.

Recommended UI copy:

- `Camera: Street · District · Planet`

This should not sit in the same visual group as `Biome` / `Buildable` / `Elevation`, because those are not camera choices.

### 2. Terrain overlays should become a World Lens deck

Rename the technical view-mode group into a player-readable lens:

- **Natural** — current `Biome`. Shows grass, forest, beach, water, mountain, and the default world mood.
- **Build sites** — current `Buildable`. Shows where the world can accept buildings/plots.
- **Height** — current `Elevation`. Shows slope/topography.

Recommended UI copy:

- `World Lens: Natural · Build sites · Height`

Reasoning:

- `Biome` is an engine word; `Natural` is a player word.
- `Buildable` is acceptable for developers; `Build sites` says what the player can do.
- `Elevation` is okay, but `Height` is faster on a small screen.

### 3. District/street/POI layers should be future lenses, not top-bar clutter

Future layers should not be added as more equal buttons in the current top strip. They should be grouped under the same World Lens concept once their underlying world data exists.

Potential future lens ladder:

- **Natural** — terrain/biome.
- **Build sites** — buildability and plot eligibility.
- **Height** — elevation/slope.
- **Streets** — roads, trunk routes, crossings, rally route, race start/checkpoint.
- **Districts** — commercial heart, residential bands, garage landmark, mall anchor, rally venue.
- **People** — friends, named citizens, who-is-here, social density.
- **Night** — neon/signage/lit POI read.

Guardrail: only the first three exist today. `Streets`, `Districts`, `People`, and `Night` should be designed here, but only implemented when the owning phase/spec lands.

## Should the controls fly away?

Irwin asked whether the controls maybe should move/fly away. The answer from this research is: **yes, but only the heavy controls should fly away — the active read should stay.**

Recommended behavior:

- The top bar stays compact by default.
- The current camera + current lens remain visible as small pills, for example:
  - `Street` and `Natural`
- Clicking the lens pill opens a short lens tray.
- Selecting a lens closes the tray automatically.
- If the player does not interact for a few seconds, the tray collapses again.
- Game-critical status stays visible; optional developer-like controls collapse.

This keeps the world visible while still allowing investigation. On a TV/mobile-style screen, the UI should not permanently steal the top quarter of the world.

## Proposed target structure

### Top row, always visible

- Left: `CityLife` + sim time.
- Middle/right compact pills:
  - `Camera: District`
  - `Lens: Natural`
  - `Speed: 1×`
- Context action only when relevant:
  - `Join Race` appears only at the rally readiness moment.

### Expanded camera tray

Appears when clicking `Camera`:

- Street
- District
- Planet

Each option includes one-line helper text:

- `Street — walk the world`
- `District — read the block`
- `Planet — see the whole island`

### Expanded lens tray

Appears when clicking `Lens`:

- Natural
- Build sites
- Height
- Future locked/disabled placeholders if useful:
  - Streets — pending phase data
  - Districts — pending Phase 2A/2B
  - People — pending social/read layer
  - Night — pending signage/POI layer

Locked placeholders should be used sparingly. They are useful in a research/prototype build, but the shipped UI should not feel like a wall of unavailable features.

## Visual language

### Lens colour system

Use stable colour accents so the player learns the mode by colour:

- Natural: teal/green accent.
- Build sites: amber/green/red accent, echoing current buildability map.
- Height: violet/blue contour accent.
- Streets: asphalt/cyan line accent.
- Districts: neon magenta/cyan/amber accent.
- People: warm white/yellow social accent.
- Night: emissive blue/pink accent.

### Active lens banner

When a lens changes, show a small 1–2 second toast:

- `World Lens: Build sites`
- `Green = best sites · amber = okay · red = blocked`

This teaches the map without needing a permanent legend.

### Mini legend

For `Build sites` and `Height`, a tiny legend is useful, but it should be attached to the lens tray or HUD, not shoved into the global top row.

Examples:

- Build sites: `green best · amber limited · red blocked · blue water`
- Height: `dark low · light high`

## Interaction rules

1. **One click changes what the player is looking at.** No modal unless needed.
2. **The world remains visible.** Expanded trays should not cover the center of the screen.
3. **Current state is always visible.** Player must know current camera and current lens.
4. **Game verbs are not map lenses.** Race, garage, join, snapshot, and liveability status should not be mixed with terrain mode buttons.
5. **Mobile/TV safe.** Large click targets, no dense toolbar, no hover-only explanations.
6. **Night readable.** Any top UI text and active lens indication must remain readable at night and over emissive terrain.
7. **Public safe.** Future district/POI strings must pass `isPublicSafe` before display.
8. **Deterministic.** Layer data must be read-only render/UI state derived from deterministic world state; no `Math.random`/`Date.now` in sim/tick paths.

## Mobile first-person obstruction finding

Follow-up screenshot review from Irwin, 2026-06-25: in portrait mobile first-person at the rally, the current first-person panel becomes the dominant object on screen. The world is technically visible behind it, but the player is mostly reading UI instead of seeing Joe's path, Cole, the rally, or the road.

Visible obstruction in the screenshot:

- The phone status bar plus the CityLife top bar consume the first top band.
- The top bar shows pause, speed, Change Server, and a partly clipped `District` button.
- A `RALLY POINT / Cole / Waiting for a friend` popover sits over the world near the upper center.
- The lower half is occupied by the first-person panel:
  - `Joe the Crab` header and `exit`.
  - current action: `Follow road · 0 away` and `Use E`.
  - guided walk text with target coordinates and `201.1 units away`.
  - next leg coordinates.
  - mood warning: `colony hungry`.
  - sprint percentage plus progress bar.
  - `Walk to Rally` and `Show debug` buttons.
  - narration card: `Guiding you to the Rally Point.`
  - a 3×3 compass rose / arrow pad.
- Behind the panel, the mouse-look / accessibility controls are still faintly visible, which makes the bottom view feel layered instead of intentionally composed.

The problem is now broader than top lens controls: **first-person mobile needs a driving/walking HUD, not a popover report.** The lower panel should not be a blocking card when the user is trying to walk toward a visible rally point.

## /goal — mobile joystick HUD direction

Goal: turn first-person mobile from a large popover into a transparent game control HUD.

### Desired layout

- **Top section: compact HUD / mini-map / destination strip**
  - Keep `Joe the Crab`, current destination, and friend/rally state visible.
  - Show `Rally Point · Cole waiting` as a small destination chip, not a large floating card.
  - Add a small route/map lens area when useful: target arrow, next waypoint, distance, and the active camera/lens pill.
  - Keep pause/speed/lens controls compact and avoid clipped buttons like the partially visible `District` state.

- **Center: protected world view**
  - The center 55–65% of the screen should stay clear for the road, rally point, friend, car, avatar/nameplate, and route cues.
  - No debug text or large panels should sit over the middle during normal play.

- **Bottom left: joystick**
  - Replace or collapse the 3×3 arrow pad into a thumb joystick / radial touch control.
  - Joystick can support walk/strafe by drag direction and distance.
  - A tap/hold affordance can handle sprint, but should not require reading a full sprint panel.

- **Bottom right: action cluster**
  - Primary action button: `Use` / `Talk` / `Enter garage` / `Join race` depending on context.
  - Secondary action: `Walk to Rally` or `Stop guidance` when route guidance is active.
  - Debug stays behind a small disclosure, never expanded by default.

- **Bottom center: short guidance caption**
  - One line max, for example `Guiding to Rally Point · 201u`.
  - Narration can appear as a temporary toast and then fade/collapse.

### What moves out of the blocking panel

- Target coordinates move behind debug.
- `Next leg` coordinates move behind debug or become a tiny arrow cue.
- Sprint becomes a small ring/bar around the joystick or near the movement thumb area.
- Mood warnings become small top chips unless urgent.
- `Show debug` becomes a hidden/developer affordance.
- The narration card becomes a timed toast, not a permanent box.

### Acceptance target for a future slice

A future implementation should pass a simple screenshot test:

- In portrait mobile first-person, the player can see the road/rally direction through the center of the screen.
- The first-person UI covers the edges, not the world.
- There is one obvious movement control, one obvious action control, and one compact destination read.
- Debug data is not visible by default.
- Mouse-look/accessibility controls do not show through behind the first-person HUD.
- Existing keyboard controls and accessibility labels remain available.
- No runtime pathfinding, rally presence, car/race, district generation, or map-layer logic changes are required for the HUD-only slice.

## Implementation ladder

This is a proposal ladder, not work performed by this PR.

### Slice A — label-only clarity

Owner: Player & UI.

- Keep existing behavior.
- Change displayed labels only:
  - `Biome` -> `Natural`
  - `Buildable` -> `Build sites`
  - `Elevation` -> `Height`
- Add accessible `title` text explaining each lens.
- Keep underlying `ViewMode` identifiers unchanged.

Acceptance:

- `setView()` still receives `biome`, `buildable`, `elevation`.
- No renderer logic change.
- Typecheck passes.
- Top UI reads as Camera + World Lens, not a raw developer toolbar.

### Slice B — collapse the lens tray

Owner: Player & UI.

- Introduce compact pills for Camera and Lens.
- Expand/collapse on click.
- Auto-collapse after selection.
- Preserve keyboard/click accessibility.

Acceptance:

- Current camera and lens always visible.
- Tray does not cover center gameplay.
- Works in first-person and non-first-person modes.
- No new world data or district logic.

### Slice C — attach a mini legend to the active lens

Owner: Player & UI.

- Add tiny contextual legend for Build sites and Height.
- Keep Natural legend-free unless needed.

Acceptance:

- Legend is tied to selected lens.
- No permanent toolbar crowding.
- Night readability verified.

### Slice D — mobile first-person joystick HUD

Owner: Player & UI.

- Replace the current portrait mobile blocking panel with an edge HUD.
- Keep the center world view clear.
- Move from a 3×3 arrow pad toward a joystick / radial thumb control.
- Move `Use`, `Walk to Rally`, and route guidance into a compact action cluster and destination strip.
- Hide coordinates/debug by default.

Acceptance:

- In portrait first-person, the rally road/friend/world remains visible through the center.
- One obvious movement control and one obvious action control are present.
- Current destination and distance are visible without a large card.
- Debug and coordinate detail are collapsed by default.
- Keyboard controls and existing accessible button labels are preserved.
- No edits to rally proximity, pathfinding, car/race, or district generation logic.

### Slice E — future Streets/Districts lens contract

Owner: Player & UI with World & Build read-only data contract.

- Add the UI shell only after Phase 2A/2B data is merged.
- `Streets` reads road/intersection/rally route data.
- `Districts` reads commercial/residential/garage/mall/rally anchors.
- No district generation in UI.

Acceptance:

- UI consumes existing read-model only.
- No edit to district placement logic.
- Disabled if the read-model is absent.

## Open questions for Claude review

1. Should the shipped wording be `Natural / Build sites / Height`, or should `Terrain / Sites / Height` be shorter?
2. Should Street/District/Planet remain as three visible buttons, or should they also collapse into a camera pill?
3. Should future locked lenses be visible as disabled placeholders, or hidden until the data exists?
4. Should the lens tray live in the top bar, or should it become a left-side map drawer so the top screen stays cinematic?
5. Should `Liveability` eventually become a World Lens entry, or remain an unlockable city-action button tied to the Civic Pulse Survey Office?
6. How should first-person mode simplify the lens deck? In first-person, map lenses may be less important than nameplates, route arrows, and social read.
7. On portrait mobile, should the movement control be a virtual joystick, a smaller radial pad, or a swipe-anywhere gesture zone?
8. Should the rally/friend popover become part of the top destination strip so it does not float over the world?
9. Should mouse-look/accessibility controls auto-hide behind first-person mobile mode unless explicitly opened?

## Recommendation

Do not add more top-row buttons for district/street/POI/signage, and do not solve mobile first-person by adding a larger popover. Instead:

1. Rename the current terrain modes into player-facing lens language.
2. Split `Camera` from `World Lens` visually.
3. Collapse advanced lens choices into a fly-away tray.
4. Treat first-person mobile as an edge HUD: top destination/map strip, clear center view, bottom joystick/action controls.
5. Keep future district/street overlays behind the phase/spec gates and add them as lenses only after their deterministic read-model exists.

The target is not a bigger toolbar or a bigger report panel. The target is a **small world lens plus a mobile walking HUD** that lets Irwin quickly see Natural / Build sites / Height now, move Joe with a joystick-style control in first person, and later read Streets / Districts / People / Night without the UI fighting the open-world view.
