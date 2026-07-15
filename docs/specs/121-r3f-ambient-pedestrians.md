# Spec 121 — the ambient pedestrian crowd (R3F)

Phase 3 porting item (`initPedestrians` / `updatePedestrians` / `pickPedTarget` from the
legacy `PlanetRenderer.ts`). The streets in the v3 world were empty of background life —
only the named citizen avatars (spec 120) rendered.

## Design

Unlike the citizen avatars, which the runtime feeds every frame, the pedestrian crowd is a
DECORATIVE render-layer flourish whose stepping lived entirely in the legacy renderer (dead
in the R3F path). So `R3FPedestrians` is **self-contained**: it owns a pool of 28 figures,
seeds them near the landing, and steps them toward nearby road cells each frame.

- `pedestrianLayer.ts` — the PURE math (node-testable, no three.js): legacy-verbatim
  constants (28-pool, capsule 0.13/0.34 +0.33, head 0.1 +0.72, six-color palette, skin-tone
  heads), `visiblePedCount` (one figure per colonist, capped and rounded), `initPedPool`,
  `pickPedTarget` (road-cell in the 1.5..16 band nudged to the kerb, wander fallback before
  streets exist), `stepPed` (move toward target, re-target on arrival, bob), `pedTransform`,
  and a seeded mulberry32 (`makePedRng`) so motion is reproducible and `Math.random` stays
  out of the render loop. rand and the on-land predicate are injected so every function is
  pure.
- `R3FPedestrians.tsx` — two fixed-capacity instanced meshes (bodies + heads sharing the
  transform) allocated once at 28; `mesh.count` varies with the population. Per-instance
  body colors set once; geometry/material disposed on unmount (spec 119). Mounts at boot
  stage 1 with the city (spec 117).

The visible count tracks `sim.state.colonists`: the streets are as busy as the colony
actually is — these are its people, not a fixed droid army.

## Tests

- `tests/pedestrianLayer.test.ts` (11): constants, palette wrap, population-tracking count,
  deterministic/on-land pool seeding (+ guard against an infinite loop when no land),
  target band + wander fallback, step + re-target + bob bound, transform + sea-level floor.
- `e2e/pedestrians.spec.ts`: probes the scene for the pedestrian instanced meshes and
  asserts the drawn count equals `min(28, round(colonists))` (first run: 2 colonists → 2
  figures, bodies == heads).

## Deferred

Rally nameplates (`makeRallyNameplate` — canvas sprites) are a separate slice (9b).
