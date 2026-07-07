# Spec 124 — the Road Rally course (R3F)

Phase 3 porting item (`setRaceState` from the legacy `PlanetRenderer.ts`). The Road Rally
(spec 087) did not render in the v3 world — and two dead-car bugs hid the racing car too.

## The two bugs (both the dead-memo class)

1. **`raceState` was never on `sim.state`.** The runtime kept the race on a private field and
   fed the renderer via `setRaceState()`, a no-op stub in R3F. But `R3FPlayerCar` reads
   `sim.state.raceState` — which nothing set — so the racing car never rendered. Fixed by
   attaching `raceState` to `sim.state` (typed on `ColonyState`) at all three runtime write
   sites: `startRace`, each `raceTick`, and `exitRace` — the same precedent as `neighborhood`.
2. **`R3FPlayerCar` gated rendering on `raceState` at React-render time** (`return null`) with
   no reactivity trigger, so even with the data present it never re-rendered when a race
   started mid-session. Fixed: the group ALWAYS mounts (hidden) and toggles `visible`
   per-frame from `sim.state.raceState.car`, so it appears the instant a race begins.

## Design

`R3FRace` reads `sim.state.raceState` directly (the bus idiom) and wraps the existing
`buildRaceLayer` (track + checkpoint gates, already covered by its visual test): build the
course when a race is active, rebuild on track change, advance in `useFrame`, dispose when the
race ends. It rides the rendered road surface (`getSmoothRoadY`, as the roads and bus do).
Mounts at boot stage 1 (spec 117).

## Tests

- `tests/raceLayer.test.ts` (3): the runtime attaches a live `raceState` to `sim.state` on
  `startRace` (mode/car/track/checkpoints), the car carries the fields `R3FPlayerCar` reads,
  and `exitRace` clears it.
- `e2e/race.spec.ts`: starts a race via the public api and asserts the course builds under
  the `race` group (35 meshes) AND `R3FPlayerCar` flips visible; exiting tears the course down.

## Deferred (slice 11b)

The race chase camera (`updateRaceCamera`) — a follow-cam that takes over during
countdown/running and releases to the district preset on finish. It couples to the R3F camera
controllers, so it is its own slice.
