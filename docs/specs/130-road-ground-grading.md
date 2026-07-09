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
