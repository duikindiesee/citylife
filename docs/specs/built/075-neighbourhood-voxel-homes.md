# Spec 075 — the Neighbourhood: buildable lots, voxel homes and demolition

- status: built
- proposed-by: irwin (operator directive) + claude (build)
- date: 2026-06-05
- depends-on: 074 (citizen avatars)

## Why (the citizens' case)

The citizens had names, avatars and first-person eyes, but nowhere that was truly theirs to build.
The plots were scattered wilderness flags. The operator asked for a real neighbourhood — a street with
decent-sized lots laid out in neighbourhood form — where a citizen gets a plot and raises an actual house
you can see, minecraft-style, with walls, a roof, a door, a bed and a table. And, like a legend, the power
to tear it all down and destroy the citizen and their Hermes agent with it.

## Mechanic

- A **Neighbourhood** is laid out once from the terrain: a straight street on the flattest dry ground a
  short walk from the core, with square lots flanking it on both sides, each facing the street with a door
  cell. The street cells are merged into the colony roads, so the avatars walk it and it renders as pavement.
- A citizen is **assigned** a free lot (their avatar walks to the door). On a lot they can **build** a
  voxel home, gated on MATERIALS + a free hand (the Caesar III rule).
- The home is a deterministic block cottage (voxelHouse): a floor slab, perimeter walls with a doorway
  facing the street and the odd window, a roof, and a bed + a table inside. Each lot grows a distinct house.
- **Demolish** tears the house down and frees the lot, keeping the citizen. **Raze-and-evict**
  (demolishLotAndCitizen) razes the house AND destroys the citizen — dropping them from the roster, exiting
  first-person if you were inside them, and tearing down their Hermes pod (server-side, best-effort).

## Rules & data

- Lot size LOT = 4x4 cells; up to 8 lots on a street of 18 cells; placement only on buildable, dry,
  non-rock ground (never over water).
- House: 3-4 wide x 3-4 deep, 2-3 walls tall, blocks rendered as 0.96 x 0.56 x 0.96 cubes coloured by kind
  (floor / wall / window / roof / door / bed / table).
- Build cost: COLONY.build.matNeighborHouse (20 materials) + at least one free colonist.

## Cost — materials & labour

- 20 materials + 1 free hand to raise a home. Demolition is free. Eviction also destroys the citizen.

## Acceptance

- `src/colony/neighborhood.ts` (makeNeighborhood) + `src/colony/voxelHouse.ts` (buildVoxelHouse) — pure,
  deterministic, tested (tests/neighborhood.test.ts, tests/voxelHouse.test.ts).
- Renderer draws lot pads (free / owned / built colours) + the voxel homes as instanced cubes, rebuilt only
  when a lot's owned/built state changes.
- Runtime: assignLot, buildHouse (gated), demolishLot, demolishLotAndCitizen, removeCitizen (with pod
  teardown). uiState.neighborhood drives a HUD panel with Assign / Build / Demolish / Evict.
- typecheck + 519 tests pass; live-verified on :5188 — a citizen assigned lot_1 built a 35-block home,
  stepping into them parks the camera at the lot, demolish clears the voxels, and evict destroys the citizen.

## Not yet (the operator said not that far ahead)

- Walkable interiors, decorating the inside, sleeping in the bed. The walls, bed and table are real blocks
  now; the rest is a later slice.
