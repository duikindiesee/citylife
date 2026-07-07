# Spec 123 — road-on-water guard

## Why

A live visual regression showed a road ribbon rendering across the sea. The sim road cells for the reported seeds stayed off water, but the smoothed road ribbon can round/string-pull between valid road cells and paint a surface over Ocean, shallows, rivers, or other non-buildable terrain. This breaks the rule that CityLife roads are drivable land infrastructure, not bridges over unprepared water.

## Mechanic

Road generation and road rendering share the same terrain safety contract:

- A road cell must never sit on `Biome.Ocean`.
- A road cell must never sit on `buildable === 0` terrain.
- Smooth road ribbons must clip their surface and painted markings before they enter Ocean or any non-buildable cell, even if the underlying sim centre-line was legal.
- The guard is deterministic and uses only terrain arrays already owned by the sim.

## Rules and data

- Source terrain is `Terrain.biome` and `Terrain.buildable`.
- Regression seeds: `4242`, `42`, `7`.
- The test checks both `sim.state.roads` and rendered ribbon coverage returned by `buildRoadRibbons`.
- Roads may be absent from unsafe cells; do not grade ocean or non-buildable terrain into validity as a side effect of rendering.

## Acceptance

- `tests/roadWaterGuard.test.ts` is RED on the pre-fix build because ribbon coverage includes non-buildable/ocean-adjacent water cells.
- The road ribbon clips surface/marking triangles off unsafe terrain.
- Focused test, typecheck, build, full test suite pass.
- Day and night browser proof show the reported coastal road no longer paints over sea.
