# Spec 087 — CityLife Road Rally Mini-Game

- status: reviewed by Claude — approve-with-changes (see review note at the foot)
- proposed-by: operator + Codex
- owner-of-build: Codex (own clone/branch off main)
- depends-on: 086 distributed city roads, 079 commercial district, existing traffic.ts car routing/render
- non-goal: do not replace the city sim traffic loop; this is an optional playable overlay

## Why

The distributed city now has real road maps: widened trunk roads linking hamlets, commercial streets, and visible car traffic. That road network can become a small playable ritual inside the city: a low-stakes road rally where the player drives a tiny car through checkpoint gates across Claude's road web.

This turns the road maps from background infrastructure into something the operator can feel. It should read like a toy race track laid inside the living city, not a separate game mode that hides CityLife.

## Current Live Context

Observed on `:5188`:
- District view shows coastal founders, distributed residential plots, widened road network, and the commercial strip at the lower-right.
- HUD says `2 built / 19 free`, so 21 homestead lots are live.
- Roads are already drivable cells with `roadKind` values: `avenue`, `street`, `path`.
- Existing traffic cars live in `state.cars`, routed by `src/colony/traffic.ts`, rendered in `PlanetRenderer` as instanced meshes with left-lane offset and smoothed turns.
- Claude currently has a local `runtime.ts` change for night bar seating, so racing work should avoid touching that behavior.

## Player Fantasy

"Start the Kooker Cup from the commercial strip, race through the hamlets, skim the coast road, and finish back at town."

The player should see:
- a small bright rally car
- checkpoint arches or glowing gate markers on roads
- a lap timer
- simple rival ghost cars
- confetti / lamps / crowd props near the start
- the city still alive around the route

## Design Rule

This is a mini-game overlay on the existing city, not a second simulation.

The economy, homes, ledger, bots, and traffic should keep their normal state. Race cars may render on top of roads and optionally pause ambient traffic display during an active race, but they must not mutate `state.cars` or break commute routing.

## Game Loop P0

1. Player clicks `Road Rally` in the HUD.
2. Runtime builds a deterministic circuit from existing `state.roads`.
3. Camera switches to a low chase or high-follow view.
4. Player controls one rally car: A/D or arrows steer, W accelerates, S brakes/reverses lightly, Space handbrake/drift.
5. Checkpoints must be crossed in order.
6. Finish after one lap.
7. HUD shows time, checkpoint count, and best local time.

## Track Generation

Pure module `src/colony/racing/track.ts` exporting `makeRaceTrack(state, opts)`, `nearestTrackPoint(track, x, y)`, `trackProgress(track, x, y)`.

Rules: uses only existing roads; never creates new roads; never routes over water; prefer `avenue` and widened trunk roads; start near the commercial district when present; later (after the lighthouse lands) support a `lighthouse` anchor finish/scenic checkpoint; deterministic by seed and current road graph; graceful fallback to an out-and-back sprint route if no good loop exists.

Track shape: P0 can be a checkpoint chain, not a perfect loop. Farthest-road sampling from the commercial start; pick 4–7 checkpoint road cells spread across clusters; connect with BFS; dedupe consecutive cells; ensure total length feels like a race.

## Race State

`src/colony/racing/race.ts` — types `RaceMode = 'idle' | 'countdown' | 'running' | 'finished'`, `RaceCar`, `RaceState`, `RaceInput`, `RaceCheckpoint`. Runtime-owned state, not `ColonyState`.

Race car movement: a light arcade model in road-cell coords; clamp/assist back toward the nearest track centerline so it feels forgiving; off-road penalty; `roadKind` speed modifiers (avenue fastest, street normal, path slow). Keep the left-side flavour visually, but the player car may occupy the centerline for playability.

## Rival Ghost Cars

P0 optional, P1 preferred: 2–3 ghosts follow the track spline with deterministic offsets, no collision physics. Names public-safe: `Viw`, `Joe`, `Courier`.

## Renderer

`src/colony/render/raceLayer.ts`. PlanetRenderer integration is tiny: import `buildRaceLayer`, create/dispose the layer, call `raceLayer.update(raceState, timeMs)`.

Elements: player rally car (brighter/larger than ambient); ghost cars (translucent/tinted); checkpoint arches (two posts + glowing top bar); start/finish gantry near the commercial strip; directional chevrons at corners; finish pulse/confetti as cheap instanced particles.

Hard visual rules: do not reuse the normal commuter car mesh directly if it makes the player hard to see; keep geometry cheap and instanced; no road text labels on the ground; do not obscure homestead plots or shop fronts.

## UI

Minimal HUD additions: a `Road Rally` button; during a race show countdown, timer, checkpoint `N / total`, best time, restart/exit. Keyboard active only during a race; Escape exits; idle race leaves normal app controls unchanged. Mobile: P0 desktop keyboard only, touch later.

## Camera

P0: high chase camera (not first-person), keep enough map context, smooth-follow the player car, on finish ease back to District view. P1: toggle between chase and overhead rally camera.

## Integration Points

Preferred files: `src/colony/racing/track.ts`, `src/colony/racing/race.ts`, `src/colony/render/raceLayer.ts`, small additions in `runtime.ts`, `PlanetRenderer.ts`, and `src/colony/ui/ColonyApp.tsx`.

Avoid: changing `traffic.ts` commute logic for P0; mutating `state.cars`; using nondeterministic randomness in track generation; touching Claude's night-bar seating behavior except for merge-conflict resolution.

## Acceptance P0

On `:5188`: `Road Rally` starts a playable timed route on existing roads; track generation deterministic for seed 4242; checkpoints on real road cells only; player car remains visible and controllable; leaving the road slows the car and guides it back; race can finish and display a time; exiting returns to District view; ambient CityLife state remains intact; `npx tsc --noEmit` green; `npx vitest run` green. Tests cover: deterministic track generation; checkpoints are roadKind cells; no checkpoint on water; fallback route; checkpoint progression order; race finish timing.

## Phased Build

- P0 — playable solo rally: deterministic route, player car, checkpoints, timer, exit/restart.
- P1 — race flavor: ghost cars, start/finish gantry, corner chevrons, finish pulse.
- P2 — city integration: start at the commercial strip, route through multiple hamlets, scenic checkpoint at the lighthouse/Rockery Beach once merged, local best time in localStorage.
- P3 — bot/citizen flavor: citizens can sponsor a race, Kookerbook post after a best lap, no real ledger money yet.

## Naming Ideas

Kooker Cup, Rockery Rally, Landing One Road Rally, Viw's Builder Dash, The Nearest Night Run.

---

## Claude review — Spec 087 Road Rally (2026-06-13)

**Verdict: approve-with-changes.** Ship a deliberately small P0+P1 delight feature. The architecture is right — pure track gen + runtime-owned race state + a self-contained render layer — but it cannot go to build until the changes below are folded in. Greenlight is conditional on them.

### What is strong
- The module split is idiomatic, not novel: `raceLayer.ts` mirrors the proven `ShorePropsLayer` contract (`src/colony/render/shoreProps.ts:6-10` — `{ group: THREE.Group; update(daylight, timeMs); dispose() }`, built by a factory, returns `null` when its anchor is absent).
- The purity boundary is correct. `makeRaceTrack` as a pure function of the road graph matches `makeCommercialDistrict` (`src/colony/commerce/district.ts:1-6`, "no Date.now, no Math.random"); race car motion in the RAF loop is correctly classed as render-cosmetic.
- `RaceState` runtime-owned (NOT `ColonyState`) is the single most important correctness call. `state.cars` is a mutable `Car[]` consumed by the deterministic `updateTraffic()` at `sim.step()` (`traffic.ts:175-229`) — any write corrupts the next tick.

### REQUIRED CHANGES before build
1. **`makeRaceTrack` must never touch `sim.rng`.** It is a stateful mulberry32 stream threaded into `sim.step()→updateTraffic(s, this.rng, dt)` (`sim.ts:393`); consuming it desyncs all traffic. Make track gen fully pure over `(state.roads, state.roadKind, state.terrain)`, or construct its OWN `new RNG(seed)` it owns exclusively. Required test: a generated track leaves traffic byte-identical after N steps vs a no-track run.
2. **Lap timer + countdown accumulate the loop's clamped `dtReal`** (`runtime.ts:1297`, capped at 0.25s) — `raceTime += clamp(dtReal)`. NOT `endWallClock − startWallClock`, NOT `Date.now()`. This is what makes the finish-timing test deterministic and tab-throttle safe.
3. **`race.ts` must be a pure dt-injectable stepper** — `stepRace(state, input, dtMs): RaceState` plus pure `crossedCheckpoint`/`finish` predicates. Without an injectable dt the required "race finish timing" test cannot be honored within the repo's conventions (mirror `colony-traffic.test.ts` `updateTraffic(state, rng, 1.5)`-in-a-loop).
4. **Track graph is built from `state.roadKind`, NOT `state.roadSet`.** `roadSet` includes undrivable verge cells (`build.ts:157-159`); `getTraffic` deliberately keys on `roadKind` (`traffic.ts:50-53`) for exactly this reason. Checkpoints store integer `(x,y)`, validated via `state.roadKind.has(x + ',' + y)` — the same string key the graph uses — placed at cell centre via `wx`/`wz` with NO commuter lane offset.
5. **Camera ownership must be reconciled.** OrbitControls is `update()`-ed unconditionally at `PlanetRenderer.ts:1296` unless `fpCitizenId` gates the first-person branch. Gate the race chase camera on an explicit named flag (e.g. `raceCamActive`) the same way, and skip `controls.update()` when racing, or it fights the camera every frame. Before entering race camera, assert first-person is inactive (or call `exitFirstPerson()`); route the finish restore through the existing `applyPreset('district')` tween with no competing chase write.
6. **`raceLayer.dispose()` must run on race EXIT, not only renderer teardown.** Unlike `shoreProps` (built once), the race layer is created/destroyed per race — every exit without disposing geometry/material/InstancedMesh buffers leaks GPU memory per cycle. Implement the full `shoreProps.ts:44-52` traversal-dispose, remove the group from the scene, null the ref. Acceptance: "no GPU growth across N race start/exit cycles."
7. **All race-layer emissive pinned below the 0.9 bloom threshold** (`PlanetRenderer.ts:237`). Target the 0.4–0.7 shop/lamp band for confetti, finish pulse, gate glow, gantry. Player-car legibility comes from colour/size/scale, NOT a bloom halo. Forbid any screen-filling particle field at ≥0.9 (it would white-out against the beacon-only bloom language).
8. **Ambient-traffic hide is render-only.** A single branch that forces `carsMesh.count = 0` / skips the cars block (`PlanetRenderer.ts:1198-1247`); clear `carRender` on resume so smoothing re-anchors via the >3-unit snap. NEVER `setPaused()` (freezes homes/ledger/clock), NEVER read/write/filter `s.cars`, `car.path`, `car.held`, or the `td.occ` map. Default recommendation: keep ambient cars running in P0 — it serves the living-city vision. Acceptance assertion: `s.cars` and commute routing unchanged after a race.
9. **Keyboard mode must be mutually exclusive with first-person.** `ColonyApp.tsx:77-112` already binds W/A/S/D + all arrows to `setFpKey` when `firstPerson.active`. The race keydown handler short-circuits on `raceMode !== 'idle'` BEFORE the first-person dispatch, reuses the INPUT/TEXTAREA guard, and must NOT rebind Space/1/2/3/Z (owned by the base app).
10. **`makeRaceTrack` takes the resolved anchors as inputs.** `commercialDistrict`/`commercialReserve` live on `ColonyRuntime` (NOT `ColonyState`) and the commercial centre is found at runtime and can be null (`runtime.ts:206-232`); lighthouse may be undefined (`sim.ts:226-230`). Pass `{ commercialCenter, lighthouse, seed }` in from the runtime. The null-commercial out-and-back sprint is a first-class P0 path with its own test.
11. **End-to-end on-roads test is REQUIRED, not just checkpoints.** Assert EVERY waypoint cell of the connecting polyline satisfies `roadKind.has(key)` and `terrain.isWater === false`, mirroring `roadKind.test.ts:67-74`. This is the verge/kerb bug class that motivated `roadKind` existing — a checkpoint-only test misses it.
12. **Ghosts are deterministic by spline arc-length, not a physics integrator.** Position ghosts as `s = f(accumulatedRaceTime)` along the track spline with per-ghost constant offsets. Only the player car uses input-driven variable-dt arcade physics. Settle the P0-optional ambiguity: ghosts are P1, and when they land they are deterministic gameplay (seed-reproducible `toEqual` test), not nondeterministic cosmetics.
13. **Replace vague criteria with numbers.** Assert checkpoint count in [4,7]; total track length ≥ a stated lot threshold; start checkpoint within K cells of `commercialReserve` centre. "Feels like a race" / "near commercial district" are untestable as written.
14. **Start-gantry placement exclusion.** The gantry and start checkpoint must not occupy the Nearest bar frontage. Read `commercialDistrict.parcels`, exclude the `nearest_bar` footprint + one frontage cell (honours both the "do not obscure shop fronts" rule and Claude's read-only bar-seating feature). Add a test.

### Recommended trimmed P0 scope
Solo timed rally only: deterministic route from existing roads (seed 4242), player car visible+controllable, checkpoints on real `roadKind` cells, off-road slow + assist-back, finish-with-time, exit/restart, ambient CityLife intact. **Cut from P0:** ghosts (→P1), gantry/chevrons/confetti (→P1), ambient-traffic pause (drop or keep cars running), lighthouse anchor (→P2), localStorage best time (→P2). **P3 citizen sponsorship / Kookerbook stays out of scope** until the buy-a-plot/migration spine is further along — do not let the race grow a second economy.

### HARD integration constraints (do-not-touch, real symbols)
- `runtime.ts:159-161, 537-583` — `barSeatCells` / `barOccupied` / `barSeatBy` / `barSeats()` / `wanderIdleCitizens()` are Claude's lane. Read-only at most; never write. Merge-conflict resolution only.
- `traffic.ts` — do not touch at all. No edits to `updateTraffic`, `getTraffic`, `bfs`, `td.occ`, `car.held`, the speed model, or the lane offset. Track gen keeps its OWN graph/BFS for isolation.
- `state.cars` and every `Car` field (`path`, `x`/`y`/`heading`, `held`, `waitTimer`) — read-only forever.
- The commercial render block in `updateColonyLayer` — additive race hooks only, no edits to existing commerce/signage rendering.
- The three shared files (`runtime.ts`, `PlanetRenderer.ts`, `ColonyApp.tsx`) take ADDITIVE hooks only: new import + create/dispose/update call + new keydown branch. Codex owns the three new files in `src/colony/racing/` and `src/colony/render/raceLayer.ts` in full.

### P2 lighthouse checkpoint — how the anchor is read
The lighthouse is `state.structures.find(s => s.kind === 'lighthouse')` (`sim.ts:226-230`) and **may be undefined** — `buildShoreProps` itself returns `null` on a missing lighthouse (`shoreProps.ts:25-26`). The runtime passes the resolved structure (or undefined) into `makeRaceTrack` as the optional `lighthouse` input; the track adds a scenic checkpoint at its `(x,y)` cell centre ONLY when present, and otherwise falls back silently. The lighthouse/shoreProps merge has now landed on `feat/commercial-visuals`, so a real `structures.lighthouse` exists to read. The scenic checkpoint cell still must pass the `roadKind.has` / not-water validation like any other checkpoint (snap the lighthouse to its nearest drivable road cell, do not place a gate on the tower base).

### Open questions for the operator
- Is the racing slice the right next spend vs the buy-a-plot/migration commerce spine? It is honestly a side quest; its one real virtue is making the spec-086 road web FELT. Time-box it.
- Naming: pick one (Kooker Cup / Rockery Rally / Landing One Road Rally) so the HUD label and gantry copy are settled before P1.
- Confirm ghosts are deterministic gameplay (recommended) vs purely cosmetic — this draws the test/render boundary.
- Mobile/touch: confirm it stays out of scope for P0–P2 (desktop keyboard only).
