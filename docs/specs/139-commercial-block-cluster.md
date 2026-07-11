# Spec 139 — the giant red building fix (CommercialBlock clustering)

## The complaint

In first person the operator was dwarfed by a towering **red wall**. The scale audit (spec 137)
guessed it was a player-scale issue; a targeted investigation proved otherwise.

## Root cause

`src/render/components/CommercialBlock.tsx` is a hand-authored **~100 m gas-station / garage
STREET SCENE** — a 100×12 m road, two 100 m sidewalks, a forecourt with a pump, four lamps, and
a garage mass with a red (`#aa3333`) canopy floating at 5 m. It is authored in raw metres and is
**not** scaled to a grid cell.

`ZoneManager` stamped one whole 100 m scene **per 4 m commercial lot**. Cells are 4 m apart, so
any run of adjacent commercial lots fused ~25 overlapping copies of the red canopy into one solid
wall. Two facts from the investigation:

- **At boot there are ZERO CommercialBlocks** — `makeCityPlan` only ever emits residential plots,
  and a fresh neighborhood has no built commercial lots. The wall appears only after commercial
  zones are **painted with the builder** (or grown), which is why the operator saw it at Sol 36.
- The `if (state.cityPlan)` commercial branch was **dead code** — `cityPlan.plots` are never
  commercial (`cityPlan.test.ts` asserts this).
- The newer commercial DISTRICT (spec 135, `R3FCommercialDistrict`) reads a *different* field
  (`state.commercialDistrict`) and does not co-render, so CommercialBlock is the only visual for
  builder-painted commercial zones.

## The fix

`src/colony/render/R3FPlanetRenderer.tsx` ZoneManager:

1. **Delete the dead `cityPlan`-commercial branch** (unreachable).
2. **Collect** built commercial lots during the neighborhood pass, and after it render **one
   CommercialBlock per contiguous cluster** at the cluster centroid, via
   `clusterCommercialLots()` (`src/colony/render/commercialClusters.ts`, pure/node-tested).
   Lots within the block's ~25-cell (100 m) width merge into one; far-apart commercial regions
   stay separate. A painted commercial run now reads as a single street scene instead of a wall.

Deliberately minimal — the CommercialBlock asset itself is untouched (a single one is a normal
6 m garage with a 5 m awning). Not touched: the `functional_garage` GLB (residential branch only)
and `R3FCommercialDistrict` (independent). Fewer, non-overlapping trimesh colliders is strictly
safer.

## Pad-seat follow-up

Builder-painted commercial clusters are not present at boot, but their member lots are graded by
the same spec-128 terrain-leveling path as houses. `ZoneManager` previously mounted the clustered
`CommercialBlock` at absolute `y=0`, which floated or buried the street scene on sloped and coastal
terrain.

Each cluster now retains the union of its member `houseZone` footprints. The renderer samples
`padSeatY(terrain, x, y, w, d)` over that union and mounts the block at the resulting graded seat
plus the same `0.02 m` anti-z-fighting epsilon used for houses. This keeps the block and its painted
pad on one shared height formula without changing boot placement or the independent spec-143
district venues.

## Not in this spec

CommercialBlock is a fixed 100 m scene regardless of the painted plot size — a proper
plot-sized commercial building is a later design step. The legacy `R3FCityRenderer.tsx:33`
per-building stamp path is only reachable from the old Simulation runtime, not the v3 boot.

## Verification

`tests/commercialClusters.test.ts` pins the grouping and union footprint (empty → none; a run → one
centroid block; far regions → separate; deterministic keys; threshold). `tests/commercialBlockSeat.test.ts`
pins shared `padSeatY` parity, the `0.02 m` epsilon, and the ZoneManager wiring. Playwright Chromium
paints a commercial run on a slope and asserts the live block's world Y matches its graded footprint
seat. Live: painting a commercial run with the builder yields one clean garage scene seated flush on
its ground, not a red wall or a floating/buried block.
