# Spec 076 — Homesteads: large household parcels with house + garden + farm, on a terrain-aware street

- status: built
- proposed-by: irwin (operator directive) + claude (architect)
- date: 2026-06-08
- depends-on: 074 (citizen avatars), 075 (voxel homes — this replaces its lot model)
- research: `docs/research/2026-06-08-homesteads-roads-parcels.md`

## Why (the citizens' case)

The spec-075 neighbourhood gave the citizens homes, but the operator's screenshot shows the truth: the 4x4 lots are crammed wall-to-wall with one verge cell between them, each voxel house fills its whole lot (no yard), and the street is a broken black strip with no width or hierarchy cutting past the boxes. That is a barracks, not a colony. The citizens asked for **homesteads**: a big plot they own, a real house set back from the road behind a front garden, a vegetable garden and a worked farm field behind it, fenced off from the neighbours — served by a street that actually bends with the land and never runs over the water. Big plots, gardens, big houses, proper spacing.

## Mechanic

- A **Homestead Parcel** is the new unit of household land (it replaces the spec-075 `Lot`). It is a large rectangle (default 14 wide x 18 deep cells) zoned internally **front-to-back from the street**: a FRONT VERGE setback, the HOUSE build-zone, a GARDEN band, then a FARM field at the rear, the whole thing ringed by a 1-cell BORDER (fence/hedge) with a single GATE gap where the driveway meets the street.
- Parcels are laid in a band flanking a **terrain-aware main street (the spine)**. The spine is routed as a **least-cost path** over the heightfield (slope is a cost, water and non-buildable are impassable), so it bends around lakes, rivers and steep ground instead of cutting through them. It has a real profile: a **3-cell carriageway** with a **1-cell verge** on each side.
- Each parcel connects to the spine by a short **driveway path** (1 cell wide, distinct material) from its gate to the parcel's house door, carved with the same least-cost step so it never crosses a bad cell.
- A citizen is **assigned** one whole parcel (their avatar walks to the house door). On the parcel they **build** a voxel home in the house-zone (gated on MATERIALS + a free hand — the Caesar III rule). The garden, field, fence and driveway render with the homestead. **Demolish** clears the house; **raze-and-evict** also destroys the citizen + their Hermes pod, as in spec 075.
- The parcel is one household: `parcel.ownerCitizenId` is the ownership key, and the house/garden/field look is seeded from the parcel's cell coords for determinism.

## Rules & data

- **Parcel**: default footprint 14x18 cells (range 12x16 ... 16x20, picked per-parcel from the seed). Internal depth budget 18, allocated from the street inward: front setback 2, house-zone 5, garden 4, farm 7. Side inset 2 cells each side of the house so the side border separates neighbours.
- **House-zone**: the voxel house grows to ~6–8 wide x 5 deep (parameterised by the zone, not the hardcoded {3,4,4}), door on the street-facing edge, laterally jittered +/-1 cell from the seed so fronts align but houses are not a perfect grid.
- **Garden**: 4 deep x house-width, instanced veg-bed rows (2–3 colours) + 1–2 tree instances + one focal prop.
- **Farm**: rear 7 deep x full inner width, parallel instanced furrow rows (alternating tilled/crop), consistent direction; orchard variant = trees on a 2-cell grid.
- **Border**: 1-cell fence/hedge ring (type chosen per parcel from the seed), with exactly one gate gap on the street side.
- **Spacing**: the on-street pitch is parcelWidth + a GAP of >=2 cells; parcels sit >=2 cells back from the verge. Parcels never share a cell.
- **Spine**: carriageway width 3 + verge 1 each side (5-cell corridor reserved). Cell traversal cost = `1 + slopePenalty` (flat buildable===2 cheap, grade buildable===1 ~3x, buildable===0 / water = Infinity). Snap radius for junctions = 2 cells.
- **Counts**: 2–4 parcels per side (fewer, larger than the old 4 tiny lots). World is 192x192; parcels lay within ~growRadius (22 cells) of the landing.
- **Build cost**: `COLONY.build.matNeighborHouse` (20 materials) + >=1 free colonist, unchanged.
- **Determinism**: `makeNeighborhood(t)` is a pure function of the terrain — fixed scan order, no `Math.random`; `houseSeed`/parcel seeds derived from cell coords.

## Cost — materials & labour

- 20 materials + 1 free hand to raise a home on a parcel (unchanged). The spine, driveways, garden, field and fence are surveyed/laid for free as part of the parcel (they are land, not built goods) — only the house consumes materials + labour. Demolition is free; eviction also destroys the citizen.

## Acceptance

- `src/colony/neighborhood.ts` exposes a `Parcel` (keeping the public fields the engine reads: `id, x, y, doorX, doorY, built, ownerCitizenId, houseSeed`) with named sub-zones (house/garden/farm/border/gate) + the spine route + per-parcel driveway. `makeNeighborhood(t)` is pure + deterministic.
- `src/colony/voxelHouse.ts` grows the house to the house-zone (parameterised), keeping the floor-covers-footprint, single-door, interior-bed/table and "every kind has a colour" invariants.
- Renderer draws, as instanced meshes: the spine carriageway + verge + centre line (its own ribbon, not a generic black strip), the parcel border fences, the garden veg-beds + trees, the farm furrows, the driveway path, and the voxel house set back in the house-zone — rebuilt only on the owned/built signature.
- Runtime: `assignLot`/`buildHouse`/`demolishLot`/`demolishLotAndCitizen`/`removeCitizen` operate on parcels (`homeXY` = house-zone centre, target = parcel door); `uiState.neighborhood` drives the existing HUD panel.
- Vitest (`tests/neighborhood.test.ts`, `tests/voxelHouse.test.ts`) updated + extended.
- typecheck + all tests pass; live-verified on :5188 — homesteads with visible house + garden + field + fence read as roomy, the spine bends with the land and never touches water, and stepping into a citizen parks at their parcel.

## Phased build

- **P0** — least-cost router + shared cellOk (pure, no visuals).
- **P1** — Parcel data model + makeNeighborhood rewrite (layout only).
- **P2** — grow the voxel house to fill the house-zone.
- **P3** — renderer: parcel ground + border + garden + farm + driveway + set-back house.
- **P4** — the spine as a proper residential street (fix the black strip).
- **P5** — runtime + HUD wiring, determinism audit, full verify.

## Not yet

- Walkable interiors; multiple parcel rows / a branching street network beyond one spine (a later slice); crop growth over time; livestock pens.
