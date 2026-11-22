# Spec 130 — the ground grades up to the road (spec 095, un-stubbed)

Operator playtest: "I can see underneath the road, as if I am walking into the ground" —
on slopes the ribbon floated above the local terrain with a visible black underside.

## Root causes

1. **The v3 road-grading pass was a stubbed no-op**: it compared `t.worldY` against itself
   ("approximation for now"), so the deadzone always skipped and no ground was ever graded
   to the road. Legacy's `gradeRoadsInto` (spec 095) did this for every ribbon cell.
2. **The leveling was fed the TILE cells** (the widened band), not the ribbon's actual
   coverage — the smoothed, wider (width-4) ribbon overhangs cells the band never contains.
3. **Bridged dips**: ribbon stations sit every 1.5 cells; between stations the mesh is a
   flat quad, so a dip is spanned at RIM height — grading a dip cell to its own local road
   height cannot close that gap. And boot roads follow least-cost paths that avoid slopes;
   the floating happens on HAND-DRAWN roads and where other leveling passes (the coastal
   dry-blend) lowered the ground under a road.

## Design

- **`ribbonCoverage(ways, terrain, roadY)`** (pure, `roadRibbon.ts`): the cells the mesh
  actually covers — the mesh's own chaikin/densify/centered-perpendicular sweep plus a
  segment-midpoint sweep — each mapped to the SURFACE height the mesh renders there
  (segment-bridged max of adjacent stations). Verified against `buildRoadRibbons`' recorded
  cells: zero missing.
- **`useTerrainLeveling`** grades each covered cell to that surface height when it differs
  from the EFFECTIVE ground (existing pad/dry-blend overrides included) by more than the
  0.6 DEADZONE (flat roads stay flush, no berms), then ramps a 3-cell smoothstep SKIRT
  shoulder around graded cells — legacy's exact scheme. Pads are never disturbed.
- **R3FWorld** feeds the coverage (unioned with tile cells for gravel/cul-de-sac guards)
  instead of tile keys. The physics heightfield reads the leveled map, so the walker now
  walks UP ONTO the road grade instead of under the mesh.

## Tests

`tests/roadGrade.test.ts`: pure coverage misses zero build cells; the steepest 6-cell
player-style stroke on the seeded map yields real over-deadzone gaps for the grading to
close (boot roads alone yield none — that's why the bug hid until hand-drawn roads).

## Amendment (2026-07-11, spec 137 v2 era) — the deadzone is now ASYMMETRIC

Operator invariant from the live walk: "the ground go above the roads; that should
never happen." The original symmetric deadzone (|surface - ground| <= 0.6) tolerated
ground up to 0.6 ABOVE the road surface, but the ribbon rides only +0.18 — tolerated
bumps crested through the asphalt as sand/grass islands. Ground above the road surface
is now ALWAYS cut to it; only the raise direction keeps the 0.6 deadzone (a shallow
hollow under a flush road is invisible and not worth a berm). Pinned by
`tests/terrainLevelingFinite.test.ts` ("ground above a road surface is ALWAYS cut").
Remaining tail: between grading cells the terrain mesh interpolates, so a sharp crest
can still shave mid-cell on ridges — per-vertex grading is the follow-up if it shows.

## Amendment — S4 sloped parcel testbed (2026-11-22)

The fence/garage dev testbed now accepts `?fixture=downhill|uphill|gentle|flat`; omitted and
`flat` retain the flat capture mode. Sloped fixtures use the real seeded runtime terrain and
parcel grading, a metre-spaced 180 m terrain window, draped carriage/verge, driveway, pad,
banks and retaining walls, and the metre-scale estate house GLB. The `slope-aerial` and
`slope-side` camera modes frame the grade. Capture metadata is exposed at
`window.__testbed.info`, including the fixture, graded parcel, house corners, garage floor,
board placement, and ground samples for every fence post.

Pure acceptance lives in `tests/slopeTestbed.test.ts`; the selectors and house pose are
framework-free in `src/colony/testbed/slopeFixtures.ts` and
`src/colony/render/housePlacement.ts`.
