# Spec 177 — Commercial Garage Rebuild: Discrete Surfaces, Obstacle Colliders, Swept Footprint Collision, and Flush Road Apron

- status: built
- proposed-by: Antigravity (operator request)
- date: 2026-10-01
- depends-on: Spec 109, Spec 110, Spec 114, Spec 128, Spec 143, Spec 174, Spec 175, Spec 176

## Why (the citizens' and player's case)

During live drive testing of the commercial district and Gearbox Auto Hub showroom, several significant navigation, collision, and layout defects were identified:

1. **"wow, those cars are wrong way" / Sideways Parking Stall Display Cars**:

   - Customer parking stalls (`BAY 01`, `BAY 02`, `BAY 03`) on the forecourt were authored with width along X (0.65 cells = 2.6m) and depth along Z (1.25 cells = 5.0m).
   - Display cars (`buildCarMesh`) have vehicle length along X (0.95 model units = ~4.2m) and width along Z (~1.9m).
   - Authored rotation `rot: 0` placed the car's length perpendicular to the stall depth, causing vehicles to park sideways across the stall boundary lines and concrete wheel stops.
   - **Resolution**: Stalls and parked display cars must be rotated by $\pm \pi/2$ radians so the vehicles align lengthwise along the stall depth, facing naturally into or out of the parking bays.

2. **"what is this pole infront of garage" / Service Bay Approach Obstruction**:

   - A 4.2m high architectural floodlight stanchion was placed at local coordinates $X \approx +6.64, Z \approx +5.15$, dropping a solid physical column directly into the driving approach path of the service bay rollup doors.
   - **Resolution**: Eliminate the obstructing floodlight stanchion from the service bay approach. Recenter exterior lighting onto the building canopy soffit and safe perimeter curb corners ($X \le -7.0$), keeping all vehicle driveways completely clear.

3. **"and this is as far as I can drive ontop of this land. feels weird" / Forecourt Drivability Lock**:

   - A naive heuristic `localZ > -0.6` in `isGaragePadDrivable` permitted driving only 0.6 cells (2.4 metres) onto the pad before triggering vehicle collisions.
   - The setback gap between the municipal road ribbon and the surveyed commercial pad lacked an authoritative paved driveway apron, causing the vehicle to strike an invisible `"parcel"` boundary or rough off-road terrain.
   - **Resolution**: Decouple the legal ownership plot boundary from vehicle surface traversability (GTA V open-world architecture). Construct a dedicated `drivewayApron` connecting the municipal road directly to the forecourt at road surface height, and designate the entire paved forecourt and open service bay as continuous drivable ground.

4. **Monolithic Bounding Box vs. Discrete Obstacle Colliders**:

   - Previously, buildings were tested either as whole-cell occupied squares or single bounding hulls, failing to distinguish between open bays, exterior glass, structural columns, and rollup doors.
   - **Resolution**: Separate the garage asset into 4 distinct layers defined in shared asset-local coordinates:
     - **Visible Mesh**: Visual geometry, high-reflectivity materials, and warm lighting.
     - **Ownership Plot**: Legal property survey bounds.
     - **Drivable Surfaces**: Explicit traversable surface zones (driveway apron, forecourt parking, service bay floor) flush with road height.
     - **Physical Obstacles**: Discrete axis-aligned collision shapes (cuboids and cylinders) for exterior glass walls, solid dividing walls, closed bay rollup doors, structural lift posts, and sign pylons.

5. **Car Swept Footprint Collision**:

   - Testing only single center points or 6-point sparse samples allowed thin poles to slip between wheels or allowed corners to clip when turning into stalls.
   - **Resolution**: Upgrade vehicle footprint inspection to an 8-point perimeter inspection (4 corners, front-center, rear-center, lateral edges) and swept collision verification across movement substeps.

6. **Exit Safety & Pedestrian Access**:

   - Preserve pedestrian walkability across the apron, forecourt, service bay, and glass showroom interior.
   - Preserve bounded, path-connected, sealed-corner-safe car exits (`exitOwnedCar`) so drivers never step out into walls or water.

7. **Showroom Side Pillar Elimination & Architectural Massing Redesign**:
   - The showroom pavilion previously overlapped the service bay along the frontage, placing the showroom's front-right structural corner mullion ($X \approx +0.59, Z \approx +3.36$) directly in front of the workshop's leftmost rollup door ($X \approx +0.66, Z \approx +2.46$).
   - A single monolithic canted roof canopy tilted diagonally across both masses, causing geometric clipping.
   - Rollup door frames were modeled as solid box volumes, occluding the open drive-in bay cavity.
   - **Resolution**: Complete architectural massing redesign of Gearbox Auto Hub:
     - Symmetrical zoning: Glazed Showroom Pavilion on the West wing ($X \in [-7.76, -0.08]$), Motorsport Service Workshop on the East wing ($X \in [+0.16, +7.52]$).
     - Central dividing core at $X = 0.0$ with zero structural columns in front of any bay door.
     - Door 1 opening begins at $X = +0.62$, giving $> 2.5$m clearance from the showroom corner and a 100% unobstructed approach corridor from the municipal road.
     - Hollow architectural door frames (jambs and lintels) ensuring the middle bay is fully open and visible.
     - Dedicated floating canopy roof over the showroom and industrial parapet roof over the service bays.
     - Discrete partitioned workshop shell (`garageAnchorServiceBayBlock`): replaced the monolithic solid workshop block with discrete solid perimeter elements (rear wall, east side wall, concrete floor slab, upper spandrel lintel, front door piers, and interior bay partitions). Bay 2 is an authentic hollow architectural cavity with flat floor lining (`garageAnchorOpenBayInterior`), overhead inspection illumination, and twin-post hydraulic car lift, providing completely unobstructed frontal sightlines and vehicle drive-through access.

## Mechanic

1. **Shared Asset-Local Coordinate System**:

   - Garage asset model is defined in local grid cell coordinates centered at pad center $(cx, cy)$:
     - Local $X$: tangent to frontage (width). Negative $X$ = Showroom, Positive $X$ = Service Bay.
     - Local $Z$: normal to frontage (depth). Positive $Z$ = Road-facing forecourt and apron, Negative $Z$ = Rear exterior walls.
     - Local $Y$: vertical height relative to seated pad height `padSeatY`.
   - Transformations between world grid $(gx, gy)$ and asset-local $(lx, lz)$:
     $$lx = (gx - cx) \cos(\theta) - (gy - cy) \sin(\theta)$$
     $$lz = (gx - cx) \sin(\theta) + (gy - cy) \cos(\theta)$$
     $$gx = cx + lx \cos(\theta) + lz \sin(\theta)$$
     $$gy = cy - lx \sin(\theta) + lz \cos(\theta)$$

2. **Drivable Surfaces & Road Apron Connection**:

   - `drivewayApron`: Paved throat spanning between the municipal street and the forecourt ($Z \in [3.5, 9.5]$, $W \approx 8.5$ cells).
   - `forecourtParking`: Paved customer parking apron ($Z \in [1.9, 5.5]$, $W \approx 15.0$ cells).
   - `serviceBayFloor`: Paved floor of open Bay 2 ($X \in [1.8, 4.9]$, $Z \in [-3.5, 2.5]$).
   - Height grading connects seamlessly from municipal road height `getSmoothRoadY` into pad seating height `padSeatY` without vertical collision steps.

3. **Discrete Physical Obstacles**:

   - `showroom_glass_front`: Front road-facing showroom glass wall.
   - `showroom_wall_west`: Showroom outer side wall.
   - `showroom_wall_back`: Showroom rear wall.
   - `dividing_wall`: Solid wall separating showroom interior from service bay.
   - `service_bay_wall_back`: Service bay rear exterior wall.
   - `service_bay_wall_east`: Service bay outer side wall.
   - `service_bay_partition_1_2`: Solid interior divider wall isolating Bay 1 from open Bay 2 ($X = 2.69$).
   - `service_bay_partition_2_3`: Solid interior divider wall isolating open Bay 2 from Bay 3 ($X = 4.99$).
   - `service_bay_pier_west`, `service_bay_pier_1_2`, `service_bay_pier_2_3`, `service_bay_pier_east`: Structural piers framing the 3 bay door openings along the front facade ($Z = 2.09$).
   - `rollup_door_1`: Closed rollup door for Bay 1.
   - `rollup_door_3`: Closed rollup door for Bay 3.
   - **Rollup Door 2 (Middle Bay)**: 100% OPEN. Zero door collider.
   - `lift_post_left` & `lift_post_right`: Discrete posts flanking the vehicle lift, leaving a 6.5m clear corridor for driving onto the lift.
   - `corner_pylon`: Discrete 0.45 m corner sign pole collider at the pad's street-facing corner on the `islandCell` side (see section 7).
   - `forecourt_pole_west`: Perimeter light pole situated on the western curb, away from traffic. Zero poles on the bay approach.

4. **Vehicle Swept Footprint Collision**:

   - In `ownedDriving.ts`, `inspectFootprint` checks 8 perimeter points:
     - Front: front-left, front-center, front-right.
     - Sides: left-center, right-center.
     - Rear: rear-left, rear-center, rear-right.
   - Movement substeps ensure no tunneling through thin obstacles or clipping of wall corners.
   - Recovery mechanics allow reversing away when front touches an obstacle, or driving forward when rear touches an obstacle.

5. **Metadata and Debug Overlays**:

   - `GARAGE_ASSET_VERSION = "2.0.0"` exported from `garageAnchorShell.ts`.
   - `R3FDrivableOverlay.tsx` displays:
     - Drivable surface zones in luminous amber/emerald.
     - Physical obstacle colliders in distinct wireframe/translucent crimson volumes.
     - Visual proof of clear open bay and rotated stall lines.

6. **Kooker HQ Landmark & World Foliage Alignment**:
   - Sited on the parcel setback directly behind the Gearbox Auto Hub commercial garage (approx. 42m behind garage center, separated by an authentic 16m courtyard plaza).
   - Architecture: 3-storey central command tower with ribbon windows, East ("Forge") and West ("Flow") operations wings, double-height glazed entrance reception lobby with brass pilasters, illuminated "KOOKER HQ" fascia sign, and rooftop telemetry array with satellite dish and aviation warning beacon.
   - Terrain leveling: footprint pad leveled in `useTerrainLeveling.ts`.
   - Foliage clearing: footprint registered in `worldClearRects.ts`.
   - Desert flora alignment: legacy cone foliage (`R3FFoliage`) is completely retired so that only authentic _Aloe dichotoma_ (`R3FQuiverTrees` / kokerboom) remain across dunes and rocky ground.

7. **P0 Player Acceptance Corrections (2026-10-04)**:
   - **Road Carriageway Clearance**: The overgrown apron and glowing yellow/brown floor slab previously reached world $Y = 265.10$, intruding into the road carriageway ($Y \in [263.0, 267.0]$) up to the yellow centerline. The driveway apron is bounded strictly at local $Z \le 7.80$ (world $Y \ge 267.20$), kissing the road edge while keeping the carriageway completely clear.
   - **Frontage Alignment with Blue Shop**: The building facade previously sat 5 cells ($20$m) back from the road. The showroom and service bay centers were moved forward to $Z = 1.45$ (front facade at $Z = 4.20$, world $Y = 270.80$), aligning with the adjacent blue shop (`shop_21` / Tool Library).
   - **Road-Compatible Asphalt Forecourt**: Replaced the yellow-tinted floor slab and glowing lane strips with neutral foundation underneath the building and road-compatible asphalt (`0x595f6a, roughness: 0.92`) across forecourt and driveway apron, eliminating any gravel gap or step.
   - **Display Vehicle Models & Scale**: Exterior sale cars use the identical models and scale as actual drivable vehicles (`buildCarMesh`, world length ~3.8m), parked in Bay 01 and Bay 02, leaving Bay 03 open as a usable visitor stall.
   - **Petrol-Station Corner Pylon Signage** (corrected after MoJoJo review 5410400845): sign dimensions are authored in REAL METRES (`GARAGE_PYLON_METRES`: 6.2 m pole, 1.8 m x 1.1 m x 0.22 m black panel, 0.45 m base collider) and rendered inside a sub-group scaled by `1/renderScale`, because the garage group is scaled cells to metres by `CELL_SIZE = 4` (the earlier head drew a 24.8 m pole and 7.2 m x 4.4 m panel). The model stores the same values in cells. The pole stands at the pad's street-facing corner on the `islandCell` side, inset 0.4 cells from both pad edges: with the facade moved to local $Z = 4.20$ the exact `islandCell` ($Z = 4.0$) lies inside the workshop, so the contract is now "within 1.5 cells of `islandCell` per axis, on the pad, outside building, driveway, forecourt and stalls, and in front of the door line". The misplaced rooftop wrench and yellow placeholder bars are eliminated.
   - **Junction Furniture & Paint Alignment**: `onAnyRoad` in `roadJunctions.ts` checks both raw way polylines and smoothed polylines; `placeClear` spirals up to 9 cells and **fails closed**: if no validated clear spot exists it returns `null` and the light or stop sign is omitted, never planted at an unvalidated fallback (MoJoJo review 5410400845 finding 2; synthetic exhaustion regression in `tests/roadJunctions.test.ts`). `roadRibbon.ts` tests edge line station points, eliminating diagonal cut lines across junction caps.

## Verification & Acceptance

- `tests/garageAlignmentAndJunctionAcceptance.test.ts`: Discriminating regression suite covering road carriageway clearance, frontage alignment with the blue shop, display car dimensions (3.8m), tall corner pole with hammer logo, and road furniture carriageway clearance across seeds 4242, 7, 99.
- `tests/garageRebuildAndCollision.test.ts`: Unit test suite verifying asset version metadata, parking stall car rotation ($\pi/2$), open bay clearance, closed door blocking, wall collision, lift post clearance, swept footprint obstacle detection, drive-in/drive-out trajectories, pedestrian walkability, and car exit safety.
- `tests/garageBayCavityAndSightline.test.ts`: Verifies Bay 2 drive-in corridor cavity, height clearance, and frontal sightline.
- `tests/junctionPaintLayoutProof.test.ts`: Proves no overlapping quads, one crosswalk per approach, and arm-axis aligned stripes across seeds 4242, 7, 99, 1234.
- `tests/roadFurnitureClearance.test.ts`: Proves furniture stands clear of carriageway across seeds.
- `tests/kookerHqGarageSetback.test.ts`: Kooker HQ landmark placement behind garage, architectural components, and footprint foliage clearance.
- `tests/roadJunctions.test.ts`, `tests/junctionCap.test.ts`, `tests/junctionCapEdgeProof.test.ts`, `tests/junctionContinuityProof.test.ts`: All passing.
- `npm run typecheck`: 0 errors.
- `npm test`: 87 test files, 635 tests passed.
