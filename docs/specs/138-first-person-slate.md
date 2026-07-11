# Spec 138 — the Colony Slate: first-person viewmodel arms + diegetic HUD (PLANNED)

Operator ask (2026-07-11): "plan our first person HUD and when we walk I would like to
see the arm or like something he holds — maybe a notepad touch screen. You can plan it
for Jack to do any animations for us."

Status: **planned, not built**. This spec is the plan of record; move to `built/` when
it ships. Asset + animation work is Jack's (work order in §5, modeled on the joe-crab
GLB precedent, spec 078).

## 0. Design thesis

The HUD is a THING THE CITIZEN HOLDS: a hand-worn tablet — the **Colony Slate** — in the
walker's right hand, with the left hand entering the frame to tap it. Almost everything
the player needs lives ON the slate's touchscreen; the screen-space HUD shrinks to a
reticle, one interaction prompt line, and toasts.

Why diegetic instead of a screen overlay:

- **The data contract already exists.** `FirstPersonView` (spec 074,
  `src/colony/bot/firstPersonView.ts`) is a pure, deterministic, cheap snapshot of
  exactly what a handheld colony device would show: nearest citizens/buildings/civic
  anchors with distances, the interaction prompt, ground/biome, the sim clock, and the
  colony mood block (liveability, hygiene, fever, unrest, brownout, hungry). The slate
  RENDERS FirstPersonView — no new sim queries, no drift between what bots reason over
  and what the player sees.
- It matches the fiction (an agent-run colony where even the operator carries the same
  device the Hermes bots read), keeps the 3D frame clean for the world the renderer
  team keeps polishing, and gives Jack a characterful asset instead of us shipping
  another rectangle of DOM.

## 1. The viewmodel rig (arms + slate)

**Mount.** A `<group>` child of the camera inside `FirstPersonController`
(`src/render/components/FirstPersonController.tsx`) — the camera already follows the
capsule at eye height; a camera child inherits look pitch/yaw for free. New component
`src/colony/render/fp/FirstPersonRig.tsx` mounted there only while first person is
active, so no cost in aerial/builder modes.

**Placement (camera space, metres; 1 world unit = 1 m, spec 118).**

| thing            | value                                            |
| ---------------- | ------------------------------------------------ |
| rig anchor       | position `(0.24, -0.26, -0.5)` (right, down, forward) |
| rig base tilt    | rotY `-0.18`, rotX `+0.12` (screen angled toward the eye) |
| slate size       | body `0.30 x 0.21 x 0.015`; screen inset `0.27 x 0.18` |
| forearm          | ~`0.34` long, enters bottom-right of frame       |
| near clip safety | nothing closer than `0.32` to the camera (near plane 0.1 + sway margin) |

**Render isolation.** The rig must never clip through walls when the player stands
against one: rig meshes render with `renderOrder = 900`, materials
`depthTest: false, depthWrite: false`, and the group is marked `frustumCulled = false`.
(No second render pass — the postprocessing chain in R3FPlanetRenderer composes after
the scene; renderOrder-on-top inside the same pass is sufficient at our art style.)
The slate screen (emissive) renders at `renderOrder = 901` so it always sits on the
slate body. Shadows: cast OFF, receive OFF for the whole rig.

**Procedural motion (code, not clips — cheap and tunable).** Driven per-frame in
`useFrame` from the capsule's planar speed `v` (0..maxWalkSpeed*sprint):

- bob: `y += 0.006 * sin(t * 2π * stepHz) * min(1, v/maxWalk)`, `stepHz = 1.9` at walk,
  `2.4` sprinting (matches Joe_walk's 0.7 s cadence family);
- sway: `rotZ += 0.01 * sin(t * π * stepHz)`, lateral `x += 0.004 * sin(...)`;
- look inertia: rig lags the camera yaw/pitch by lerping an offset toward the last
  frame's look delta (`k = 8/s`), clamped to ±0.05 rad — the slate "drags" a beat
  behind the eye, which sells the hand-held read;
- all amplitudes scale to zero over 0.25 s when `v -> 0` (idle handled by Jack's clip).

**States** (mixer clips from Jack layered UNDER the procedural motion — procedural
offsets apply to the rig group, clips animate the skeleton inside it):

| state       | clip         | trigger                                          |
| ----------- | ------------ | ------------------------------------------------ |
| hidden      | —            | not in first person, or cinematic owns the camera |
| raising     | `Slate_raise`| entering FP, or Tab from lowered                 |
| idle        | `Slate_idle` | v < 0.2 for 0.4 s                                |
| walk        | `Slate_walk` | v ≥ 0.2                                          |
| tap         | `Slate_tap`  | page change / interaction confirm (one-shot over idle/walk) |
| lowered     | `Slate_lower`→ hold last frame | player presses `H` (hide slate; arms drop out of frame) |

## 2. The slate screen (the actual HUD)

**Tech.** One `THREE.CanvasTexture` (512 x 342, the screen's aspect) painted by a PURE
painter module `src/colony/render/fp/slateScreen.ts`:
`paintSlate(ctx, view: FirstPersonView, page, extras)` — node-testable with a stub 2D
context (assert on the recorded draw-call list, the `businessLabels`/`adBoards`
precedent). Repainted at most **5 Hz** and only when the projected content hash
changes; `texture.needsUpdate = true` only on repaint. No React state per frame.

**Data.** `runtime.getUiState().firstPerson.view` — the existing FirstPersonView the
runtime already maintains in FP mode. Extras: sprint budget fraction (the spec-104
sprint charge, `COLONY.firstPerson.sprintChargeSeconds` bucket the controller already
tracks), current speed, and the compass heading from `citizen.heading`.

**Pages** (Tab cycles; a soft-key row on the screen shows the three pages; `Slate_tap`
plays on switch):

1. **WALK (default)** — top strip: compass ribbon (N/E/S/W ticks sliding with
   `heading`) + clock `Sol {day} · {hh:mm}` + day/night glyph. Centre: the interaction
   prompt, huge, when non-null: `[E] {label} — {targetName} ({distance} m)`; otherwise
   the nearest road/building hint line. Bottom: sprint bar (drains over 3 s, refills
   over 4 s — the config values, never restated) + speed readout.
2. **NEAR** — the three FirstPersonView lists as rows with distance chips:
   `neighbours` (up to 4, "wave" flavour), `nearestBuildings` (3), `nearestCivic` (3).
   Rows sorted by distance; nothing interactive in v1 (rows are informational).
3. **TOWN** — the mood block as five labelled meters (liveability −1..1 centred bar,
   hygiene, fever, unrest 0..1) + status glyph row (`brownout` lamp, `hungry` fork).
   Footer: `plotName` + `homeXY` ("home" pointer angle vs current heading).

**Screen look.** Emissive material (`emissiveIntensity 0.85`, brighter at night via the
existing day/night uniform the HUD lamps use), 2 px scanline pattern baked into the
painter background, colony-terminal palette: ink `#0b2530` on paper `#dff3ec`, accent
`#f2cf52` (the road-dash yellow — already the game's signature accent). Round-rect
soft-keys drawn pressed for 150 ms after a tap.

**Input.**

- `Tab` — next page (`Slate_tap`); `Shift+Tab` previous.
- `H` — lower/raise the slate (players filming the world want clean frames).
- `E` — the EXISTING interaction affordance (prompt comes from FirstPersonView;
  distances per `COLONY.firstPerson.interactionPromptMaxDistance`). The slate flashes
  the prompt row green on accept; unchanged runtime behaviour.
- No pointer-on-screen raycasting in v1 (pointer lock owns the mouse); the "touch"
  fiction is carried by the left-hand `Slate_tap` clip on Tab/E. Raycast touch is a
  possible v2 (§7).

## 3. Screen-space HUD (what little remains)

- **Reticle**: 3 px dot, 40 % opacity, pure CSS in the existing FP DOM layer.
- **Interaction prompt**: keep the CURRENT one-line DOM prompt (it must stay readable
  even with the slate lowered) but demote styling to a small caption over the reticle;
  the slate's WALK page is the primary, bigger presentation of the same string.
- **Toasts** (existing notification strip) stay screen-space.
- Kill nothing else: Radio, Sol clock chip, speed buttons etc. live in the aerial HUD
  and already hide in FP.

## 4. Integration + file plan

- NEW `src/colony/render/fp/FirstPersonRig.tsx` — rig mount, mixer, states, procedural
  motion, CanvasTexture plumbing. Mounted from `FirstPersonController` (one line) so
  every FP consumer (colony page, town page pass-through) gets it.
- NEW `src/colony/render/fp/slateScreen.ts` — pure painter + `slatePages` constants.
- NEW `src/colony/render/fp/fpRigFallback.ts` — Phase-1 placeholder rig built from
  primitives (rounded box slate + capsule forearm, same node NAMES as Jack's GLB) so
  the whole feature ships and is testable before the asset lands; the GLB swaps in by
  file existence (`useGLTF` with error boundary falling back to the placeholder, the
  GlbHouse/VoxelHouse precedent).
- `src/colony/config.ts` — `COLONY.firstPerson.slate = { screenHz: 5, bobAmp: 0.006,
  swayAmp: 0.01, raiseSeconds: 0.35, anchor: [0.24, -0.26, -0.5], tilt: [-0.18, 0.12] }`
  (all tunables in config, AGENTS.md rule — no magic numbers in the rig).
- Keybinds `Tab`/`H` handled in FirstPersonController's existing key listeners; both
  no-ops outside FP. `Tab` must `preventDefault` (focus stealing).

## 5. Jack's work order — `fp-arms-slate.glb` (assets + animations)

Precedent: joe-crab.glb (spec 078; committed GLB + raw-import test + renderer gate).
Branch `jack/fp-arms-slate`, PR to `r3f-colony-migration`. File:
`public/assets/citylife/fp/fp-arms-slate.glb`.

**Content & conventions**

- Units metres, +Y up, **-Z forward** (camera space: the rig is parented to the
  camera; "forward" is into the screen). Origin at the RIG ANCHOR (the point we place
  at `(0.24, -0.26, -0.5)`) — NOT at the wrist and NOT at world zero.
- Nodes (exact names, they are code contracts):
  - `Arms_R` — right forearm + hand gripping the slate's right edge; sleeve cuff in
    the colony jumpsuit teal (`#2a7f7f` family), skin tone from the citizen palette
    mid-tone (we will not per-citizen tint in v1).
  - `Arms_L` — left hand, OFF-SCREEN at rest pose; only enters during `Slate_tap`.
  - `SlateBody` — 0.30 x 0.21 x 0.015 rounded slab, dark shell `#232a2e`, worn edge
    highlights, a small tarentaal-feather sticker on the back (flavour, optional).
  - `SlateScreen` — a SEPARATE mesh, flat quad 0.27 x 0.18 inset in the body face,
    **UV-mapped 0..1 corner-to-corner**, with its own material slot named exactly
    `screen` (the code replaces that material with the live CanvasTexture — do not
    bake a picture into it; export it plain white emissive).
- Budgets: ≤ 12 k triangles total, textures ≤ 512², everything embedded in the GLB,
  file ≤ 400 KB (joe-crab was 92 KB; arms + slate should land well under this).
- No lights, no cameras in the export; single skeleton for both arms is fine.

**Animation clips** (exact names + durations; loop flags in GLB metadata; 24 fps ok):

| clip          | length | loop | content                                                       |
| ------------- | ------ | ---- | -------------------------------------------------------------- |
| `Slate_idle`  | 2.5 s  | yes  | micro breathing sway, thumb shifts grip once per loop           |
| `Slate_walk`  | 0.7 s  | yes  | grip counter-sway matching a 0.7 s stride (Joe_walk cadence); keep amplitude SMALL — code adds bob on top |
| `Slate_raise` | 0.35 s | no   | from below-frame to rest pose (this is the FP entry moment)     |
| `Slate_lower` | 0.35 s | no   | reverse of raise; last frame = arms fully out of frame          |
| `Slate_tap`   | 0.4 s  | no   | left hand enters low-left, index taps screen centre-bottom (the soft-key row), retreats |
| `Slate_point` | 0.6 s  | no   | (stretch) right thumb points past the slate — for future guided-walk confirmations |

**Jack's acceptance tests to ship in the same PR** (mirror joeAvatarGlbRenderer):
`tests/fpArmsSlateGlb.test.ts` — raw import parses; node names exactly as above;
`screen` material slot exists on `SlateScreen`; clip names + durations within 0.05 s;
triangle count under budget. Renderer-side gate stays OUR job (Phase 2).

Queue line for the operator: `/queue jack Build fp-arms-slate.glb per docs/specs/138-first-person-slate.md §5 — first-person arms + Colony Slate with the 6 clips, on branch jack/fp-arms-slate.`

## 6. Phases, tests, acceptance

**Phase 1 — slate ships without Jack (placeholder rig).** Rig + painter + pages +
keybinds + procedural motion on the primitive fallback.
Tests: `tests/slateScreen.test.ts` (painter: WALK page draws prompt text when
FirstPersonView.interactionPrompt non-null, sprint bar width follows the fraction,
page switch changes the draw list, deterministic for a fixed view);
`tests/fpRig.test.ts` (state machine transitions incl. hidden-in-cinematic, H toggle,
5 Hz repaint throttle — fake clock). e2e `firstPersonSlate.spec.ts`: enter FP (the
`enterFirstPerson` runtime API the dogfood driver uses), assert rig meshes exist under
the camera, screen CanvasTexture repaints (hash two captures 1 s apart while walking),
`Tab` changes page, `H` lowers, reticle DOM present, and **frame time regression
guard**: rig adds < 1 ms median frame cost vs FP without it (the existing perf-probe
pattern from spec 127's e2e).
**Phase 2 — Jack's GLB lands.** Swap-in via node-name contract; gate test that the GLB
loads + clips bind; visual pass at eye height (screenshot rig from this spec's e2e).
**Phase 3 — polish (separate spec if it grows):** raycast touch on the screen, guided-
walk integration with `Slate_point`, per-citizen skin/sleeve tint, minimap page fed by
the roadmap HUD data (spec 121), Ask-Kooker page piping the existing chat into the
slate.

**Acceptance (operator walk-test):** entering FP raises the slate; walking swings it
believably with look-drag; the prompt is readable on the screen at 1080p without
leaning in; Tab pages with a visible left-hand tap; H gives a clean frame; nothing
clips through walls when nose-to-wall; nothing renders in aerial/builder modes; suite
+ e2e green.

## 7. Non-goals (v1)

Weapon-style item switching, inventory, photos/screenshot tool on the slate, citizen
selfies, touch cursor, VR. The slate is one device with three pages until the operator
asks for more.
