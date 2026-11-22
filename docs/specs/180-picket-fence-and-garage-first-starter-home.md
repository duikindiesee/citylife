# 180 — Picket fence and garage as the first starter home

**Status:** proposed - dev flag off. The renderer/testbed slice is implemented; starter-home claim remains opt-in and disabled by `ColonyRuntime.STARTER_GARAGE_FIRST` (currently `false`).

## Intent

Make the first claimed property legible before a full house build exists: a small starter garage at the inland end of the driveway, enclosed by a low white picket fence. The garage door faces the street through the gate. Keep the lot boundary and driveway opening aligned to the existing 4 m grid.

## Integration plan

1. `claimStarterHome(target, { starterGarageFirst: true })` can set `starterGarage` and mark the plot built only when `ColonyRuntime.STARTER_GARAGE_FIRST` is enabled. Existing callers retain the full-house path.
2. `ParcelFence` renders `fenceType: "fence"` using the checked-in GLB kit. Each 4 m ring edge has cell-centre posts plus a midpoint post and two 2 m panels; the street gate edge keeps a 3.7 m opening and one outer panel on either side meeting the gate posts. Unsold, unbuilt, unreserved fence parcels show a canvas-texture For Sale board beside the gate with the spec 085 house-zone deed total and area rate. The 350 KCO reference is the server starter HOME price, not the parcel land price.
3. The local testbed uses one generated real parcel; unsold mode (`?claimed=0`) shows the priced For Sale board and is served as a standalone dev HTML entry, not added to Vite's production input map.
4. The dev testbed uses deterministic named camera shots and a 14-second drive trajectory. Garage door animation is sampled from shot time, with `?door=open|closed` overrides; it does not depend on camera proximity.
5. Keep placement in world metres (`src/colony/scale.ts`: 1 unit = 1 m, `CELL_SIZE = 4`), Y-up and +Z authored facade orientation.
6. The standalone fence/garage test bed publishes parcel, driveway, garage, road centreline, and generated carriageway coordinates as `window.__testbed.info`. The 4 x 8 m garage sits with its front at the inland edge of the final driveway cell and its footprint inside the house zone. Road paving is outside the fence: a 9 m carriageway centred 7 m street-ward of the first driveway cell, with a kerb and concrete driveway/apron.
7. The driveway gate GLB has exactly two static end posts. Every rail, picket, and hinge is a descendant of `gate_leaf_left` or `gate_leaf_right`; leaf-local X coordinates run from the hinge toward the centre so the closed leaves meet at X=0. Parcel fence placements omit panels touching the gate cell and emit exactly one driveway gate. Tests verify every open-pose mesh bbox clears the lane opening (`|x| < 1.6 m`, `y=0..1.3 m`).

## Round 8 gate correction

The first generated gate's leaf descendants did move with their pivots, but the right-leaf picket positions were generated with positive local X coordinates. After adding the right hinge offset, that placed the pickets beyond the gate's 3.7 m span (up to about 3.7 m from centre) instead of between its hinge and centre. The closed/open test had checked leaf group bounds rather than every mesh and did not detect the outlying geometry. The generator now places all pickets on each leaf's inward local axis, keeps the only non-leaf meshes as the two gate posts, and the regression test checks all meshes and the rendered placement path.

## Round 9 gate ownership and panel spacing

`ParcelFence` owns exactly one driveway gate and accepts `gateOpen` from 0 (closed) to 1 (open), defaulting to closed for existing consumers. The testbed supplies its timeline and `?gate=closed` override to that same gate; it must not mount another GLB instance. `debugScene()` includes per-name instance counts for visible top-level scene pieces. Each ordinary 4 m fence edge places panel centres at its quarter and three-quarter points, producing two 2 m bays that abut without gaps or overlap. Round 10 changes the street gate edge to outer panels terminating at the gate posts.

## Round 11 ground seating and street-side board

Fence, gate, garage, and For Sale board placements now take an optional `GroundAt` sampler in fractional grid coordinates and metres. The live renderer builds that sampler from the same terrain-level map used by the terrain mesh, so props follow both natural grade and visible grading. Flat test fixtures retain a zero-height default. Each fence panel stays horizontal at the higher endpoint ground; its underside clearance is sampled at five points, and lower posts extend by the adjacent panel rise (using a 1.2 m post-height basis). The garage slab is level at the last driveway cell (the door centre). The sale board sits one metre street-side of the fence, offset along the frontage and moved to the opposite side if its chosen cell overlaps the driveway. This corrects the prior inside-the-plot board placement.

## Round 10 unsold parcel board and post support

Ordinary 4 m ring edges now carry posts at 0, 2, and 4 m, with 2 m panels centred at 1 and 3 m. The gate cell is a gap in the fence ring; the driveway-gate GLB owns the two posts at ±1.85 m, and only the outer 2 m panels run from the neighbouring cell-centre posts to those gate posts. Unsold fenced parcels display a canvas-2D board with full parcel dimensions, area, the spec 085 house-zone price, and the 0.0375 KCO/m² area rate. The testbed defaults to a claimed garage (`?claimed=1`) and uses `?claimed=0` for the board view.

## Dimensions and reference sources

| Element | Asset target | Reference range | Source |
|---|---:|---:|---|
| Picket height | 1.15 m (45.3 in) | 36–48 in | [Lumberama picket guide](https://lumberama.com/blog/picket-fence-guide), [First Fence white picket fence](https://firstfence.com/white-picket-fence) |
| Panel bay | 2.00 m | Posts commonly 6–8 ft apart; intermediate support at 2 m supports 4 m cells | Same sources; grid alignment is project choice |
| Starter garage | 4 x 8 m | 12 x 20 ft minimum to 16 x 24 ft | [SpecMyGarage size chart](https://specmygarage.com/guides/garage-size-chart), [Viking Steel Structures guide](https://vikingsteelstructures.com/blog/standard-garage-size-dimension-diagrams) |
| Garage door | 2.74 x 2.13 m | 9 x 7 ft | Common single-car door reference |
| Driveway | 4 m paved gate approach | 10–12 ft | [Angi driveway width guide](https://www.angi.com/articles/driveway-width-guide.htm) |

The fence and garage dimensions are authored asset targets; local bylaws, access requirements, and final house design may require different dimensions.

## Round 2 placement and camera decisions

- The driveway vector from gate to the road-facing first driveway cell is authoritative for street direction and garage yaw; `parcel.side` is only a fallback. This handles all four cardinal street approaches while retaining the generated side-1 result.
- The road centre is a metre-space presentation derived 7 m along the street vector from `driveway[0]`; the neighborhood's real `carriage` cells are also exposed for diagnosis. The visual road remains a straight 120 m strip because one parcel's local view does not render the neighborhood's entire routed spine.
- Five camera poses are independently defined: aerial, street gate, driveway approach, garage closed, and garage open. Animation state is a pure function of time and the explicit door override.

## Round 11 — real-measure plot tiers (approved by Irwin, 22 Nov 2026)

The old tiers were authored in spec 084 at smallholding scale (ESTATE 23×29 cells = 92 × 116 m = 10,672 m²). They are re-pointed to real South African stand sizes. The exported names `COMPACT`/`BIG`/`ESTATE`/`GRAND` are kept so persisted dynamic-plot ids still resolve; `STANDARD`, `LARGE` and `SMALLHOLDING` are aliases and `PARCEL_TIER_LABEL` gives the display names.

| Tier (legacy key) | Cells W×D | Metres | Area | House envelope | Front / side / rear from boundary | Coverage (limit) | Inland price | Real-world analogue |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Compact (`COMPACT`) | 5×6 | 20×24 m | 480 m² | 12×12 m | 8 / 4 / 4 m | 30% (60%) | 130 KCO | Irwin's ~350 m² stand; Langebaan beach estates 350–450 m² |
| Standard (`BIG`) | 5×8 | 20×32 m | 640 m² | 12×12 m | 8 / 4 / 12 m | 22.5% (50%) | 173 KCO | Irwin's ~600 m² stand; Langebaan median erf 656 m²; FNB 2017 average 552 m² |
| Large (`ESTATE`) | 7×9 | 28×36 m | 1,008 m² | 12×16 m | 8 / 8 / 12 m | 19% (40%) | 272 KCO | Upper Myburgh Park 900–1,200 m²; FNB 1970–74 average 1,063 m² |
| Smallholding (`GRAND`, rare) | 25×25 | 100×100 m | 10,000 m² | 20×16 m | 24 / 40 / 60 m | 3.2% (5%) | 2,700 KCO | 1 ha, Saldanha Bay Smallholding zone minimum; Long Acres is mostly 1–2 ha |

House-fit limits are the Saldanha Bay (Langebaan) Integrated Zoning Scheme By-Law 2021: coverage 60% (250–500 m²), 50% (500–750 m²), 40% (750–1,500 m²); street line 3 m; side line 2.5 m when the stand is wider than 16 m; rear line 3 m; Smallholding zone (≥ 1 ha) 20 m street, 10 m side and rear, 5% coverage. The Smallholding setback was raised from 2 to 5 cells (farm depth 13 → 10) so the house sits 24 m from the street.

Sources (Forge research notes, 22 Nov 2026, plot sizes and Langebaan erf sizes): Saldanha Bay IZS 2021; FNB Property Barometer, *Long Term Building Characteristics* (Aug 2017); CSIR *Guidelines for Human Settlement Planning and Design* ch. 5.6; Agricultural Holdings (Transvaal) Registration Act 22 of 1919; 83 Langebaan listings observed 22 Nov 2026.

**House envelope, not a stretched plot.** `compileBlueprint` draws each house-zone cell at 4 m, so the house zone is the building envelope. It is now a fixed real-metre footprint per tier (`houseEnvelopeM`, capped by `MAX_HOUSE_ENVELOPE_M` = 20 × 16 m) instead of growing with the plot; the 11.5 × 11.5 m proof house fits every tier. `tests/plotTiersFit.test.ts` checks every generated parcel's envelope against the Saldanha Bay street, side and rear lines and coverage band above. The 4 × 8 m starter garage fits inside every envelope.

**Land price.** `price = round(full parcel m² × 0.27 KCO/m² × (1 + waterfront))`. The board prints dimensions, m², total, the rate and, where it applies, the waterfront part, so `round(m² × rate)` equals the base price exactly. Board total equals `plotPriceK` for every unreserved lot (tested).

- ASSUMPTION (waterfront): the old flat +120 KCO (−2 KCO per cell) would be most of a 130 KCO Compact plot. It is now +25% at the waterline, fading linearly to 0 at 60 cells (240 m), the same reach as before. On the seed-180 coast nearly every plot is within that reach, so most boards show a premium (e.g. a Large plot at 272 + 60 = 332 KCO).
- ASSUMPTION (deposit): the 600–1,000 KCO arrival deposit covers every suburban plot (dearest: waterfront Large, 340 KCO) but not a Smallholding. Auto-arrival now buys the first free plot the newcomer can afford.
- ASSUMPTION (spacing): `GAP` = 2 cells, an 8 m green strip between neighbouring boundaries. Real erven share a boundary; here each parcel owns its fence/hedge/wall ring and mixed types would overlap, and the bus-corridor router needs a lane clear of parcel boxes (GAP 1 left seed 4242 with no bus loop; GAP 2 and 3 route). The seed-4242 wood3 bus stop now uses the hamlet's own centroid instead of the hard-coded (441,128). `FRONT_OFFSET` stays 4 cells: 6 m half carriageway + 4 m verge + 4 m front strip puts the boundary 14 m from the street centreline (spec 114 keeps the ring off the verge).

**Masterplan.** Per side: slot 0 = Large (shore-ward; founders Joe and Viw keep `lot_1`/`lot_2`, still reserved, and Large keeps the 4 m side strip Viw's east door needs), then Standard, Standard, Compact, Large; slot 5 on one side tries a Smallholding and falls back to Standard if the ground cannot take 100 × 100 m. Hamlets: Compact then Standard. On seeds 180 and 42 the Smallholding slot fell back to Standard, so no Smallholding is generated there yet.

**Picket fence on the true boundary.** Posts and panels now run along the outer edge of the boundary cells (previously cell centres, which would have enclosed only 16 × 20 m on a 20 × 24 m plot). Posts every 2 m from corner to corner, the driveway gate (3.7 m opening, posts at ±1.85 m) sits on the front boundary, and the short panels either side meet the gate posts. `plotTiersFit` checks every fenced parcel's perimeter for gaps over 50 mm; that check found missing panels between the corner and the gate on the street edge, which are fixed.

**Test bed.** Shows the generated street: carriage and verge cells, every neighbour's boundary, and 3 m-wall hipped-roof envelope houses on alternate "sold" neighbours. New cameras: `street-mixed`, `for-sale-board`, `street-view`. `window.__testbed.info.parcels` lists tier, metres, m², price and envelope per plot.

## Open decisions

- Which parcel metadata field is authoritative when `parcel.gate` and `parcel.driveway` disagree?
- Should a pedestrian gate be included on every claimed parcel, or only where a footpath connects?
- Which garage socket/orientation should be canonical for each street-facing house layout?
- Should the blank sign remain purely decorative or later receive a separately governed lot-state display?
- What state/event owns the door animation when a player uses the garage portal?
- Should the starter garage have a shallow gable roof in the final art direction, or retain the simple low-cost flat roof?

## Round 13 — sloped plots (22 Nov 2026)

Research: `sloped-plots-2026-11-22.md` (78 real plots on seeds 180/42/4242: median front-to-back fall 1.87 m, steepest compact 3.4-3.6 m; flattening whole yards would need >2 m walls on 34 plots). Builders level a **house platform** and let the garden, fence and drive follow the ground.

Modules: `src/colony/render/kitGround.ts` (GroundAt), `src/colony/slope/plotGrading.ts` (gradePlot), `src/colony/parcelGeometry.ts`, `src/colony/render/forSaleBoardPlacement.ts`, `src/colony/render/housePlacement.ts`, `src/colony/testbed/slopeFixtures.ts`.

Technique per band (whole-plot plane fit, sampled every 1 m):

| Band | Technique |
|---|---|
| < 3% (`level`) | Level pad, near-flat drive. |
| 3-8% (`gentle`) | House-only platform, ramped drive, fence follows grade, 1:2 bank. |
| 8-12.5% (`moderate`) | Platform + retaining wall; one face <= 2.0 m, terrace above 2.5 m cumulative; walls > ~1.3 m flagged "engineer required". |
| steep uphill | Garage at street level, cut into the slope (`street-level-garage-cut`). |
| steep downhill | Lower-level garage under the street side of the house (`undercroft-garage`). |
| > 25% or no legal combination | Rejected at layout (`tryParcel`), never placed. |
| Smallholding (GRAND) | Never flattened; only the house footprint is graded. |

Limits (`SLOPE_LIMITS`): drive <= 1:25 within 5 m of the street (SANS 10400-D), <= 1:8 beyond; pad fill <= 1.0 m (SANS 10400-H); ground floor <= 0.5 m above natural ground (Saldanha IZS s27); floor >= 150 mm above finished ground; banks <= 1:2; single wall face <= 2.0 m (Saldanha s27(b)). If the on-pad drive violates, the grader falls back to a street garage (not for reject-band plots).

Kit seating: fence posts at ground, panels stepped (horizontal at the higher end's ground), gates, starter garage (`garageFloorY`), For Sale board and drive profile all sample the real heightfield. For Sale board: always outside the front fence line on the street side, 1 m from it, off the driveway cells and the gate swing, y = ground (tested, `tests/kitOnGround.test.ts`).

Placement filters: grading runs on raw terrain in `tryParcel` and claims cells only after acceptance; the smallholding is looked-up across up to 40 columns of the corridor and then the opposite side (previously it was tried once at the last slot and never retried).

Final lots per seed (graded on raw terrain, 0 rejected / 0 not ok): seed 180: 20 lots (11 gentle, 2 level, 5 moderate, 2 steep-downhill, 1 smallholding); seed 42: 36 (21 gentle, 1 level, 11 moderate, 3 steep-downhill, 1 smallholding); seed 4242: 26 (17 gentle, 1 level, 5 moderate, 2 steep-uphill, 1 steep-downhill); seed 7: 24 (17 gentle, 4 level, 3 moderate).

Test bed (`?fixture=downhill|uphill|gentle|flat`): real seeded terrain, 1 m heightfield with 0.5 m contour banding (no vertical exaggeration), draped carriage/verge from the parcel's own (satellite) hamlet, real 11.5 m garage house GLB (`estate-motor-home-seed9`, see PROVENANCE.md) posed by `housePoseForParcel` inside fence and Saldanha building lines (street 3 m, side 2.5 m for stands > 16 m, rear 3 m), one fence kit colour for all plots. Fixtures: downhill = seed 42 `hill5_lot_3` (steep-downhill 14.0%, undercroft); uphill = seed 4242 `wood1_lot_1` (steep-uphill 12.7%, street-level cut); gentle = seed 180 `lot_2` (4.3%, on-pad). Tests: `tests/slopeTestbed.test.ts` (house inside fence and building lines, every post y == groundAt, garage y == garageFloorY, drive profile and grades, wall faces <= 2 m, board street-side and seated, cameras above ground, carriage meets the gate), `tests/plotGrading.test.ts`, `tests/placementFilters.test.ts`. Captures: `docs/assets/previews/slopes-v1/`.

Camera pose selection for the test bed lives in `fixtureCameraPose`, used by both `Scene.setTime()` and slope-camera tests. Sloped poses receive the fixture terrain callback and real house/board/row placement inputs; they never fall back to the frame state's terrain-blind camera. `slope-side` stands 34 m laterally on a side no higher than plot grade where possible and keeps 3 m above the highest ground along the house sightline. `slope-aerial` looks at the house from the street side, 45 m along-street and 25 m lateral. Board-line shots stay street-side of the fence and raise the target and camera as needed to keep the full sightline at least 1 m above sampled terrain; the first unsold neighbour's board remains in frame. The tests exercise downhill, uphill and gentle fixtures across the nine production camera modes with the Canvas 48°/16:9 perspective: eye clearance > 1.5 m for elevated views or > 1.2 m for eye-level views, no below-ground sightline at 1 m samples, upright camera, house in frame for the two slope views, and board in frame for board views.

Sloped fixture camera poses first pass parcel landmarks through the pure `groundedInfo` transform: gate, driveway, road, plot and frontage points are seated on `groundAt`, while the garage retains its graded `garageFloorY`. Every camera mode then uses these grounded landmarks and the shared `slopeCameraPose` clearance solver. The solver keeps the eye above the terrain, raises targets to at least 1.5 m above their local ground, and preserves at least 1 m clearance along sampled sightlines. Flat fixtures retain their original landmark data and authored poses.

Known limits: the live renderer seats the kit on `groundAtFromLeveling`; the ramp/retaining-wall/bank meshes driven by `gradePlot` exist in the test bed only (live renderer wiring is the next step). Whole-plot gradients were sampled on raw terrain; roads are graded separately (spec 130).
