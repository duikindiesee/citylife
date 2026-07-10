# Spec 128 — seated houses, draped lot overlays, tree-free lots

The operator's first-person playtest (Sol 34) found: houses rendering as floating plank
piles with trees through them, and translucent green planes hovering mid-air ("unpurchased
land floating above the ground" — their read was right).

## Root causes

1. **`VoxelHouseMesh` rendered at absolute y = 0.05** — sea level. The city terrain is
   8-17m up, so every voxel house was buried underground.
2. **The GLB garage branch passed RAW GRID coordinates as world position**
   (`[hz.x, 0.1, hz.y]`): grid (380, 350) landed at world (380, 350) — every garage model
   stacked in one spot at height 0.1 (the plank piles in the screenshot).
3. **Zone overlays were ONE flat lot-sized box** (up to 44×56m) at the lot-CENTRE height —
   floating/clipping on any slope.
4. **Foliage culled only road cells** — no lot, parcel or house cleared its trees.

## Design

- **Seat formula shared with the leveling**: ZoneManager computes
  `seat = padSeatY(terrain, x, y, w, d) = max(worldYAt(pad centre), RENDER_DRY_FLOOR)` —
  the ONE exported helper (`useTerrainLeveling.ts`) that `useTerrainLeveling` also grades
  the pad with — and passes it to `VoxelHouseMesh` (`seatY` prop) and to the corrected
  grid→world `GlbHouse` transform. House and pad always agree. (Originally each side
  inlined `max(worldY(centre), RENDER_DRY_FLOOR)`; see the NaN regression below for why
  that formula was wrong and is now centralized.)
- **`ZoneLotOverlay`**: one INSTANCED mesh per unbuilt lot — a thin tile per cell, each at
  its own terrain height, so the tint drapes the ground like painted land (and matches the
  operator's purchasable-land mental model). Keeps the `zone-ground-${lot.id}` name so the
  reactivity e2e contract (count grows on placement, shrinks on demolition) is unchanged.
- **`calculateFoliagePositions` takes `clearRects`**: all neighborhood lots
  (centre-anchored) + commercial parcels (origin-anchored), cleared with a 1-cell margin.
  `foliageSignature` now includes lot/parcel counts so zoning re-cuts the forest.

## Also in this change — spec 127 adversarial-verify fixes (P2, P3 CONFIRMED medium)

- **P2 dedup**: `plotRoad` appends a centre-line way ONLY when the stroke created a new
  tile — re-tracing an existing road duplicated its way, making every cell along it read
  as a junction (markings suppressed, whole road slabbed).
- **P2 prune**: builder ways carry `source: 'builder'`; `removeRoad` prunes them once both
  endpoints are bulldozed — fully-removed roads lose their ribbon (middle-cut ghosts remain
  a known limitation).
- **P3 suppression**: junction paint dilation `JR` 1 → 2 — at offset tees (a way ending
  1-2 cells short of another, the standard connector geometry) painted dashes/edges resumed
  INSIDE the junction slab and floated on the pad; JR=2 reaches past the slab in the worst
  constructible offset.

## The NaN-seat regression (2026-07-10) — pad centres must sample bilinearly

The seat formula above originally sampled `Terrain.worldY` directly at the pad CENTRE,
`x + (w-1)/2`. `worldY` indexes the height Float32Array raw, so it is only defined on
integer in-bounds cells: an even-width pad's centre is fractional (`*.5`), the array read
is `undefined`, and the seat came out NaN. Every commercial-district pad has an even
width, so at boot 23 NaN seats smeared across their footprint + skirt cells in the
leveling map, two whole terrain chunks rendered NaN Y vertices, and
`THREE.computeBoundingSphere` dumped the FULL serialized geometry (megabytes) to
`console.error` twice per boot — flooding the vite client-log relay and dragging e2e runs.
(A fractional *y* alone was subtly worse: `y*608` stays integral at `*.5`, so it silently
read an unrelated cell and returned a wrong-but-finite height.)

Fixes, layered:

- **`Terrain.worldYAt(x, y)`** — clamped bilinear over the four surrounding cells; the ONE
  continuous ground sampler (the legacy `PlanetRenderer.groundY` maths, promoted onto
  `Terrain`). `roadSurface.getSmoothRoadY` now delegates to it too, so roads and pads ride
  the same ground model — and so does the legacy `PlanetRenderer` itself: its private
  `groundY` and the inline bilinear inside `smoothRoadY` are delegations now, with
  `tests/groundSamplerParity.test.ts` pinning the exact drop-in (edges included) before the
  private copies were removed. `worldY` keeps raw-index semantics with NO validity check —
  it is the sim's hottest function, and even a DEV-only assertion slowed the suite ~50%
  (tried and reverted); the guards below catch off-grid writes downstream instead.
- **`padSeatY`** — the exported seat formula; `useTerrainLeveling`, ZoneManager
  (`R3FPlanetRenderer`) and the legacy `PlanetRenderer`'s homestead + commercial seats
  (`seatOf`/`seatY`) all call it, so seat and pad can no longer drift in either renderer
  (the legacy module also imports the shared `RENDER_DRY_FLOOR` instead of carrying its own
  copy). Falls to the dry floor on a corrupt (non-finite) zone instead of seating a mesh
  at NaN.
- **The leveling map refuses non-finite overrides** — writes are guarded, the finished map
  is swept (covers `applyCoastalCommercialDryBlend`, which writes with its own putter),
  and one `console.warn` per recompute reports how many were dropped. A corrupt ribbon
  height is also skipped before road grading so its NaN can't shadow finite shoulder ramps.

## Tests

- `tests/lotFoliageAndWays.test.ts` (3): lot rect culls its forest (and the same rect grew
  trees without the cull), re-trace appends no duplicate way, bulldozing prunes the way.
- `e2e/houses.spec.ts`: overlays are instanced + drape (every sampled instance within 0.5
  of its cell's ground), and ZERO foliage instances inside any lot rect (first run: 19
  overlays, 21 lots, 76,237 trees, 0 on lots).
- `tests/groundSamplerParity.test.ts` (3): the retired private formulas, kept verbatim as
  in-test references, equal `max(0, worldYAt)` / `padSeatY` across a dense island sweep,
  at and beyond the grid edges, and on even-width (fractional-centre) pad shapes.
- `tests/terrainLevelingFinite.test.ts` (6): worldYAt matches worldY on integer cells,
  stays finite/bounded at fractional + out-of-range coordinates; the real boot state
  (seed 4242) seats every commercial pad finitely and levels every footprint — a
  regression back to NaN seats shows up as MISSING pad overrides (the guard drops them).
- `e2e/nanGeometry.spec.ts`: a booted scene has zero `computeBoundingSphere` NaN console
  errors and no non-finite geometry vertex or object transform anywhere.
