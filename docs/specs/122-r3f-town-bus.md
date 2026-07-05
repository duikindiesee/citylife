# Spec 122 — the town bus (R3F)

Phase 3 porting item (`setBusRoute` from the legacy `PlanetRenderer.ts`). Spec 088's bus —
the coach that loops between the neighborhoods — did not render in the v3 world.

## Design

The bus route is deterministic RUNTIME state: `runtime.busRoute` (a `BusRoute` of stops +
a closed road-cell loop) is computed once at boot by `makeBusRoute` from the road graph and
the hood anchors. So `R3FBus` reads it directly — the same idiom the road network uses for
road state — rather than the imperative `setBusRoute` call (which stays a no-op stub on the
R3F renderer; the route is plain state, not a per-frame enriched feed like the avatar
source).

`buildBusLayer` (already extracted to `busLayer.ts`, with its own visual test) is the mesh +
animation builder: it Douglas-Peucker-straightens then Chaikin-smooths the BFS loop so the
coach drives straight and glides through corners, builds the bus + stop markers, and exposes
`update(timeMs)` (advances the coach along the loop at 4 cells/sec with a 1.4s dwell at each
stop) and `dispose()`. `R3FBus` owns the lifecycle: build when the route appears, advance in
`useFrame`, dispose on unmount or route change. Mounts at boot stage 1 (spec 117).

## Tests

The pure route (`busRoute.ts`) and the builder (`busLayer.ts`) are already covered
(`tests/busRoute.test.ts`, `tests/busLayer.visual.test.ts`); this slice adds only the R3F
wiring, so `e2e/bus.spec.ts` is the proof: it probes the scene for the `bus` group and, when
the runtime has a route (true at the live seed — 4 stops, 1680-cell loop), asserts the bus
layer built real geometry (first run: 37 meshes — the coach + stop markers).

## Road-surface height (fixed after the adversarial verify)

The verify CONFIRMED that sampling raw `terrain.worldY` floated/sank the coach by up to
~0.85u on slopes (roads render at `getSmoothRoadY + lift + pitch`, not the raw cell-center
height). Fixed: `R3FBus` now samples `getSmoothRoadY` (exported from `R3FRoadNetwork`, the
exact function the road tiles use) at fractional path coords, so the bus rides the same
surface the roads render on. `buildBusLayer.update` was already dt-clamped, so a backgrounded
tab cannot break the loop advance.

## Deferred (v2)

Body pitch along the travel grade (the coach stays level, tracking the surface height at each
point); passengers; night route signage tied to the day/night cycle.
