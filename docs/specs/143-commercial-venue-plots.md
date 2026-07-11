# Spec 143 — commercial venue plots: seated, road-facing, plot-filling, GLB-ready

> Numbering note: the v3 lane ran several parallel branches that reused spec numbers as
> they landed, then reconciled them (PRs #283, #284). After the reconcile the lane holds
> 137 junction caps / 137 world metric system, 138 first-person slate, 139 commercial-
> block-cluster, 140 no-roads-on-beaches, 141 citizen-characters-scale, 142 crowd-on-roads.
> This spec started as 140, chased the moving numbers through 141, and settled on 143 —
> the first free number once the reconcile landed. The renumber precedent is spec 115→123.

## The complaint (operator, 2026-07-11, reviewing the v3 world)

> "There is lots wrong with the placement of those shops, and they should be scaled to
> fit large plots, so we can build .glbs for them later where you can e.g. walk into a
> bar on a street and sit there and be able to get special signal inference indicators
> for your bots."

The screenshots (junction at world (-716,-156), seed 4242) showed the roadside shops —
Tarentaal Tours, Builder Studio, the green nursery — floating above the ground, sitting
at odd offsets to their street with one practically on the junction pad, and rendered as
knee-high kiosks rattling around 4–8-cell (16–32 m) parcels.

## The audit (why each symptom happened)

Every commercial placement path was traced. Four distinct defects stacked up:

1. **Toy boxes** — the whole legacy commercial layer (`commercialDistrictLayer.ts`,
   spec 135, extracted verbatim from the legacy `PlanetRenderer`) authors its mesh
   DIMENSIONS in grid-cell units, but the v3 mount maps coordinates at `wx = (x−N/2)·4`
   — 1 cell = 4 m. Positions were scaled ×4, sizes were not: a 6-cell store parcel got a
   ~5 m body with ~1.2 m walls. The metric-system audit had already flagged this
   ("commercial shell footprints derive width/depth from cell counts used as world
   units; mall/shop heights are sub-human").
2. **Floating** — shops seated on the LOWEST-CORNER of a `surfaceY` sample of the
   terrain-leveling map that the layer BAKES at build time (`useMemo` keyed on the
   commercial signature only). When roads regrade the leveling afterwards, the baked
   heights go stale; and the lowest-corner formula wasn't `padSeatY` (spec 128), the
   height the pad is actually graded to.
3. **On the road / on the junction** — the district survey fronts its parcels 2 cells
   from the street CENTRE-line, but the high street is a 4-cell-wide ribbon way: the
   carriageway edge lands 8 m out, HALF A CELL INSIDE every parcel's front row. Bar
   stools (both rendered and the runtime's separately-computed sitter cells) landed on
   the carriageway; promenade lamps stood at 5.6 m from the centre-line — on the
   asphalt; junction slabs at the district crossing overlapped the front of the corner
   parcels outright.
4. **ZoneManager's `CommercialBlock`** (builder-painted commercial lots) was stamped at
   absolute `y=0`, unrotated. (Its fixed-100 m-scene layout is the commercial-cluster
   fix's job — the in-flight "138-commercial-block-cluster" branch; this spec only seats
   it on its pad.)

## The fix

### One survey: `src/colony/render/venuePlacement.ts` (pure, node-tested)

`surveyVenuePlacements(district, junctionPads, blockedCells)` decides, per parcel:

- **Seat** — `venueSeatY` delegates to the ONE pad-seat formula `padSeatY` (spec 128),
  so the venue sits at exactly the height the terrain leveling grades its parcel pad to.
  No baked leveling map, no lowest-corner improvisation, stale-proof by construction.
- **Facing** — `frontDir` derives from the survey's own door-vs-centre geometry (the
  door row IS the street-facing row), snapped to the axis; `facing = atan2(x, y)`, the
  same world-yaw convention the road furniture uses. The building group gets ONE
  rotation; everything street-side builds at local +z.
- **Footprint** — the building fills its plot: width ≈ 80–85 % of the parcel frontage
  (1 m side margins), depth from the front face to a 1 m back margin, capped at 72–75 %
  of parcel depth. Coverage lands at ~50 % (kiosk) to ~65 % (store/showroom) of parcel
  area — the "16–32 m parcel gets a 12–27 m building" the operator asked for.
- **Setback** — the front face stands `FRONT_STRIP_M = 4 m` past the CARRIAGEWAY EDGE
  (ribbon half-width, not the parcel line), leaving a real pavement strip where the
  awnings, counters, stools and crates live — all clear of the asphalt by construction.
- **Junction pads + ribbon clearance** — the live junction zones map to circular
  no-build pads (`junctionZonesToPads`: `rBound` once the junction-caps rework lands,
  `half`+apron today), and `venueRoadBlockedCells` contributes every cell the road
  ribbon actually covers (a corner parcel's flank can sit under the CROSS street's
  ribbon, which the frontage setback alone can't see). The placement slides along its
  frontage away from obstructions, then shrinks (to 85 %, then 70 %), then gives up:
  `buildable: false` renders as an open glowing forecourt with crates — nothing ever
  stands inside a junction's bound. On seed 4242 the two parcels hugging the district
  crossing become forecourts; 19 of 21 build.
- **Storeys** — kiosk 1, store/showroom 2, on the scale constitution (1 cell = 4 m,
  storey ≈ 3.5 m, door 2.4–2.6 m, citizens 1.8 m).

### Massing in metres (`commercialShopMassing.ts`)

The per-business massing table now speaks metres: `wallHeight` = storeys × 3.5 m +
per-business flair, `roofRise` 0.45–2.4 m, and `bodyW/bodyD` ARE the placement footprint
(the GLB contract needs the primitive and the model to claim the same ground).
`shopKindWallHeightM` is shared with `businessLabels` so the floating name plates ride
the real roofline (they kept legacy cell-unit heights and would have hovered inside the
new walls).

### The layer builds in the venue's local frame

`buildShopVenue` (in `commercialDistrictLayer.ts`) replaces the old parcel loop: group
at `(wx(center), padSeatY, wz(center))`, `rotation.y = facing`, then a walk-in
storefront in metres — window bays per ~3.6 m of frontage (two bands on two-storey
shells), a 1.4×2.5 m door at the surveyed entrance cell, fascia sign, strip awning,
posts, crates, and the per-business signature props re-authored at human scale on the
frontage strip. The mall/garage anchor shells also seat via `padSeatY` now (their
internal massing scale is deferred — they have their own spec lineage 104/106/109/111).
Promenade lamps/benches/planters move to 2.35 cells off the centre-line (past the 2-cell
ribbon edge — they stood ON the road) and grow to human scale; the spec-081 ad boards
become real 4.6 m billboards.

### The runtime sits bots on the SAME stools

`runtime.barSeats()` used its own inline stool formula — one cell street-ward of the
parcel, i.e. ON the widened carriageway. It now calls the shared
`surveyVenuePlacements(...)` + `barStoolGridPositions(...)` with the same inputs the
renderer uses, so citizens walk to exactly the three stools the layer draws (frontage
strip, 1.85 m off the building face, 1.15 m spacing).

## The GLB-ready venue contract

Each venue group is named `venue.<parcelId>.<businessId>` and carries
`userData.venue`:

```ts
{
  venueType: "bar" | "nursery" | "club" | "market" | "garage" | "studio"
           | "shop" | "kiosk" | "showroom",
  seatY: number,        // padSeatY of the parcel — mount the GLB at exactly this Y
  facing: number,       // rotation.y; GLB local +Z must be its street face
  footprint: { w, d },  // metres the shell may claim (the primitive claims exactly this)
  entrance: { gx, gy, localX, localZ }, // the walk-in door on the frontage
  frontStripM: number,  // pavement depth in front of the face (awnings/furniture zone)
  buildable: boolean,   // false = junction forecourt — do NOT drop a GLB here
}
```

Swap-in pattern (same as GlbHouse/VoxelHouseMesh, specs 128/129): a future `GlbVenue`
mounts at `(origin, seatY, facing)` and replaces the `venueShell` mesh; plot furniture
(night floor, label) stays. The primitive massing IS the placeholder — ship order:
primitives now, GLBs per venue type as they land.

### Jack's work order — `venue-bar.glb` (the walk-in Nearest bar)

Precedent: joe-crab.glb (spec 078) and the fp-arms-slate order (first-person slate spec
§5). Branch `jack/venue-bar`, PR to `r3f-colony-migration`. File:
`public/assets/citylife/venues/venue-bar.glb`.

**Content & conventions**

- Units metres, +Y up, **+Z is the street face** (the mount group's `facing` rotation
  makes local +Z the frontage). Origin at the FOOTPRINT CENTRE at ground level (y=0 =
  the pad seat) — not at a corner, not at the door.
- Budget footprint: fit within `footprint.w × footprint.d` of the showroom-class bar
  parcel — design to **20 × 14 m**, walls ~2 storeys (7–8 m eaves; tower-cap flourish
  welcome, ≤ 12 m total). The code scales nothing: model at true size.
- **Walk-in interior shell**: the street face carries an OPEN doorway (≥ 1.4 m wide,
  2.4–2.6 m tall) at local `entrance.localX` (assume door centred; the code clamps the
  entrance inside the shell) — the player/citizens walk through it, so no door-blocking
  geometry; interior floor at y=0 (the pad seat IS the floor), ceiling clearance ≥ 3 m.
- **Counter + seats inside**: a bar counter (top ~1.05–1.1 m) with **4–6 stools**, seat
  height **0.65 m**, each stool carrying an empty node named **`SIT.0` … `SIT.5`** at
  the seat surface, facing the counter. These anchors must be compatible with the
  `Citizen_sit` pose of the scale constitution (hips at the anchor, feet reaching y=0):
  the bot lane parks sitters exactly on them.
- Node names (code contracts): `VenueShell` (the swappable building), `Counter`,
  `SIT.<n>` empties, optional `Keeper` spot marker for Joe behind the counter.
- Neon: emissive sign band on the street face in the Nearest palette; keep emissive
  intensities ≤ 0.9 (under the bloom threshold).
- Budgets: ≤ 15 k triangles, textures ≤ 512², everything embedded, file ≤ 500 KB. No
  lights, no cameras in the export.
- Acceptance tests in the same PR (mirror `joeAvatarGlbRenderer`):
  `tests/venueBarGlb.test.ts` — raw import parses; `VenueShell` + `SIT.0–3` (at least 4)
  present; door opening on the +Z face (no face-spanning geometry within the door
  rectangle); triangle/file budgets.

Queue line for the operator:
`/queue jack Build venue-bar.glb per docs/specs/143-commercial-venue-plots.md — walk-in Nearest bar shell (20x14 m, open +Z doorway, interior counter + 4-6 SIT.n stool anchors at 0.65 m), on branch jack/venue-bar.`

## Venues as BOT SIGNAL SITES (vision — recorded, not built)

The operator's end-state: a citizen/bot that walks into a venue and sits down gains
**signal inference indicators** — venue-scoped inference context for the Hermes bots. A
bot on a stool at the Nearest should "hear the room": venue-flavoured signals (the bar
surfaces nearest-app chatter, the studio surfaces builder activity, the market surfaces
trade) that its owner sees as indicators and its brain can consume as digest context.

The intended data hook (for the bot lane to build on — none of it ships in this spec):

- **Venue identity**: `userData.venue.venueType` + `parcelId`/`businessId` already
  identify every venue in the scene; the placement survey is pure, so the runtime can
  compute the same registry headlessly (`surveyVenuePlacements`).
- **Occupancy**: the runtime already tracks who sits where (`barSeatBy`/`barOccupied`
  for the Nearest). Generalise to `{ venueId, seatIdx, citizenId }` records when more
  venues gain seats (the GLB `SIT.n` anchors are the seat registry).
- **Surface**: `FirstPersonView` (spec 074/076) is the deterministic snapshot both the
  slate HUD and the bots read — add a `venue: { id, type, occupancy } | null` block
  when the viewer is inside a venue footprint (point-in-footprint against the placement
  survey), and mirror it on the runtime UI state so the slate can draw the indicators.
- **Inference side** (bot lane, separate spec): venue-scoped context injected into the
  sitter's Hermes digest — NOT built here; this spec only guarantees the geometry and
  identity layer the hook needs (venues exist, face streets, have entrances and seats
  with stable ids).

## Not in this spec

- The mall/garage anchor INTERNAL massing scale (still legacy cell-unit proportions;
  they now seat correctly — their rescale belongs to their own spec lineage).
- `CommercialBlock`'s fixed 100 m scene (the in-flight commercial-cluster branch owns
  its layout; this spec seats it on `padSeatY` so it stops floating/burying).
- The `CELL_SIZE` migration of the hardcoded `4`s across the ~14 render layers
  (metric-system follow-up, spec 137). The venue module anchors its `CELL_M` to the
  shared `scale.ts` `CELL_SIZE` now that the metric system has landed on the v3 lane.
- Venue GLBs themselves (Jack's work order above) and the bot signal inference.

## Verification

- `tests/venuePlacement.test.ts` — real runtime boots (seeds 4242, 42, the
  commerceDistrict.test.ts pattern): seat = `padSeatY` parity on every placement
  (groundSamplerParity style); facing walks out of the door onto a road cell; buildable
  coverage ∈ [0.3, 0.85] with median ≥ 0.5; no footprint probe on a road cell, under
  the ribbon coverage, or inside a junction pad; bar stools clear of carriageway and
  ribbon; determinism; synthetic pad forces slide-or-forecourt.
- `tests/commercialShopMassing.test.ts` — variety preserved; massing in metres (storey
  walls, body = placement footprint, label heights shared).
- `e2e/commercialVenues.spec.ts` (Playwright chromium) — in the live booted world:
  every built venue's `venueShell` bounding-box bottom within 0.3 of its `seatY`, group
  mounted at the seat, no shell corner on a road cell, no XZ overlap with any junction
  slab. (21 venues, 19 buildable, 8 slabs on the live boot.)
- Before/after screenshots at identical cameras (the junction-shoot pattern) at the
  operator's junction (-716,-156) and the strip: attached to the PR. Before: floating
  pastel wafers, one on the junction pad. After: two-storey street-facing venues filling
  their parcels; the two crossing-corner parcels render as open forecourts.
