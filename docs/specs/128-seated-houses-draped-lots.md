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
  `seat = max(worldY(houseZone centre), RENDER_DRY_FLOOR)` — the exact expression
  `useTerrainLeveling` grades the pad with — and passes it to `VoxelHouseMesh` (`seatY`
  prop) and to the corrected grid→world `GlbHouse` transform. House and pad always agree.
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

## Tests

- `tests/lotFoliageAndWays.test.ts` (3): lot rect culls its forest (and the same rect grew
  trees without the cull), re-trace appends no duplicate way, bulldozing prunes the way.
- `e2e/houses.spec.ts`: overlays are instanced + drape (every sampled instance within 0.5
  of its cell's ground), and ZERO foliage instances inside any lot rect (first run: 19
  overlays, 21 lots, 76,237 trees, 0 on lots).
