# Spec 115 — R3F sim reactivity bridge (the dead-memo fix)

QA hardening for the R3F render port (branch `r3f-colony-migration`). Top item of `qa_report.md`:
the ported components hung `useMemo` dependencies off properties of the **mutable** `sim.state`
class instance (`[sim.state.roadsVersion]`, `(state as any).neighborhood`) — but React never
observes mutation, so nothing ever re-rendered. The world rendered its initial frame and stayed a
still photo. A second, deeper cut of the same wound: `neighborhood` and `commercialDistrict` were
never attached to `sim.state` at all in the R3F path (the legacy renderer received them via
`setNeighborhood()` / `setCommercialDistrict()`, which the R3F `PlanetRenderer` stubs as no-ops),
so `ZoneManager`, `useTerrainLeveling`, the spawn-point picker and the bulldozer plot detection all
read `undefined` forever.

## Design

Two halves, no new dependency:

1. **Data path** — the runtime attaches its live `neighborhood` and `commercialDistrict` onto
   `sim.state` right after construction, typed on `ColonyState`, exactly the precedent
   `state.cityPlan` set ("attached by the runtime after construction so the renderer can paint
   zones"). Same object references, mutated in place — never replaced.

2. **Reactivity** — `useSimSignal(runtime, getSignature)` (`src/colony/render/useSimSignal.ts`)
   bridges the mutable sim to React with `useSyncExternalStore`. The subscription source is the
   `ColonyRuntime.subscribe`/`emit` loop that already fires on every public mutation and on a
   200ms heartbeat. Snapshots are cheap **primitive string signatures** over exactly the state a
   component renders (`src/colony/render/simSignals.ts`): equal string → no re-render (Object.is
   on primitives), changed string → re-render. Components then key their existing `useMemo` on
   the signature.

Signature rules (binding for new signatures): pure read, deterministic (an unstable snapshot
re-renders every emit — or loops), and covering every mutable field the component renders.

## Wired components

- `R3FFoliage` — `foliageSignature` (roadsVersion, buildings count).
- `ZoneManager` — `zoneSignature` (cityPlan plots, per-lot id + built flag).
- `useTerrainLeveling` — `levelingSignature` (roadsVersion, built parcels, commercial district).
- `R3FWorld` spawn point — `spawnSignature` (roadsVersion, lot count).

`SceneProbe` (in `R3FPlanetRenderer.tsx`) exposes the live three.js scene as `window.__r3fScene`,
the render-side sibling of the `window.__colony` probe, so tests can assert on what is actually
drawn rather than on sim state.

## Tests

- `tests/simSignals.test.ts` — signature stability + mutation coverage, and the runtime
  regression: booting the real `ColonyRuntime` attaches neighborhood/commercialDistrict to
  `sim.state`, and a public-api lot mutation notifies subscribers and moves the zone signature.
- `e2e/reactivity.spec.ts` (Playwright, constitution Article II) — places a commercial plot via
  `__colony.placeZonedPlot`, asserts its zone overlay mesh APPEARS in `window.__r3fScene`, then
  demolishes it and asserts the mesh leaves the scene.

## Notes

- Known limitation: a signature covers only what its component renders — new mutable render
  inputs must be added to the signature (see rules above).
- The remaining qa_report.md items (GPU ocean waves, foliage disposal, PlanetRenderer no-op
  typing) are separate slices.
