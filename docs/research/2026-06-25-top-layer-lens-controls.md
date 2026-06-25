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

## Implementation ladder

This is a proposal ladder. The 2026-06-25 mobile HUD build converts the mobile first-person part into a concrete UI slice: first-person now uses an edge HUD with a top destination strip, clear center view, bottom-left joystick-style movement dock, bottom-right action cluster, one-line guidance caption, and debug details collapsed by default.

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

### Slice D — mobile first-person joystick HUD [BUILD IN THIS PR]

Owner: Player & UI.

- Replace the portrait mobile blocking panel with an edge HUD.
- Keep the center world view clear.
- Move from the report-card style 3×3 arrow pad toward a joystick/radial thumb control at the lower-left edge.
- Move `Use`, `Walk to Rally`, debug, and exit into a compact lower-right action cluster.
- Put `Joe view`, the active destination, distance, friend-nearby banner, and urgent blocked/mood warnings in a compact top strip.
- Keep target coordinates, `Next leg`, ground telemetry, and neighbour debug detail hidden behind the `Debug` disclosure.

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

## Recommendation

Do not add more top-row buttons for district/street/POI/signage. Instead:

1. Rename the current terrain modes into player-facing lens language.
2. Split `Camera` from `World Lens` visually.
3. Collapse advanced lens choices into a fly-away tray.
4. Keep future district/street overlays behind the phase/spec gates and add them as lenses only after their deterministic read-model exists.

The target is not a bigger toolbar. The target is a **small world lens** that lets Irwin quickly see Natural / Build sites / Height now, and Streets / Districts / People / Night later, without the UI fighting the open-world view.
