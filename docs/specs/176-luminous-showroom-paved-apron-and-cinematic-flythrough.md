# Spec 176 — Luminous Showroom Pavilion, Paved Entrance Apron, Road Flora Clearance, and Cinematic Boot Flythrough

- status: built
- proposed-by: Antigravity (operator request)
- date: 2026-09-30
- depends-on: Spec 109, Spec 114, Spec 131, Spec 156, Spec 174, Spec 175

## Why (the citizens' and player's case)

Players and critique review reported several critical visual and navigation defects:

1. **"VERY DARK IN THERE"**: At dusk and nighttime, the Gearbox Auto Hub showroom interior was completely black. Despite outer glass, the absence of real Three.js interior light sources and dark interior materials turned the showroom into an unlit cave, hiding the display cars.
2. **"I cant even drive into the garage" / Unpaved Road Disconnection**: An 8–12 metre wide unpaved dirt verge and a concrete step separated the municipal road ribbon from the garage forecourt, obstructing cars from pulling in cleanly.
3. **"tree in middle of the road"**: Protected _Aloe dichotoma_ (quiver trees) were spawning directly inside travel lanes on highways because `worldClearRects` cleared only intersection junctions rather than the continuous road network.
4. **"The plot needs to be walkable"**: Pedestrian avatars on foot were halted with a `"parcel"` error when stepping onto the garage pad, preventing walk-in customer exploration.
5. **"buttons should never be above others"**: Gameplay driving HUD pills (`HIGHWAY 0 km/h`, `Mission: Claim Your Homestead`) carried `z-index: 1200`, rendering directly over modal dialogs like the "Log Bug" panel (`z-index: 80`).
6. **"buttons in log a bug, and I want a system prompt that I can freelance talk / write there, and then it fills in my form, and allows right click to rework"**: In-game bug reporting needed quick preset buttons, freeform AI-assist text input that populates reproduction fields, and right-click context rework capability.
7. **Cinematic Start-of-Game Flythrough**: Rather than an instantaneous cut, new players without a car needed a road-spline flythrough establishing the glowing showroom, while returning drivers with a car needed an aerial chase camera descent into the vehicle.

## Mechanic

1. **Luminous Architectural Glass Showroom**:

   - In `commercialDistrictLayer.ts`: Added high-output warm key PointLight (`0xfffaed`, intensity 36) directly over the presentation turntable and hero car, and cool secondary rim PointLight (`0xa5dcff`, intensity 18) for paint reflection.
   - Replaced dark ceiling with a luminous LED softbox grid panel (`0xffffff`, emissive `0xfffaed`, intensity 2.2).
   - Showroom floor upgraded to high-reflectivity architectural terrazzo (`0xd8e4ee`, roughness 0.12, metalness 0.28).
   - Glass framing reinforced with vertical warm LED mullion edge strips (`0xffe1a8`, emissive `0xffb24a`, intensity 1.1) and warm architectural wood/bronze feature wall.
   - In the open service bay: Added bright inspection PointLight (`0xfff8ee`, intensity 24), twin yellow hydraulic vehicle lift posts (`0xf5a720`), and hazard warning threshold.
   - Showroom, mullion, ceiling, and plinth materials registered into `C.garageFloorMats` for dynamic nighttime flare.

2. **Paved Driveway Entrance Apron & Parking Bays**:

   - In `garageAnchorShell.ts`: Derived `drivewayApron` bridging the 4–5 cell setback gap from the forecourt slab out to `roadTargetLocal.z`.
   - In `commercialDistrictLayer.ts`: Added paved asphalt entrance throat mesh with tapered yellow-curbed transitions (`0xffc83b`) linking directly to the street.
   - Forecourt equipped with 3 dedicated marked customer parking stalls (`BAY 01`, `BAY 02`, `BAY 03`) with crisp white boundary lines and concrete wheel stops.
   - Added twin forecourt architectural light poles with downward angled floodlights (`0xffeed4`, intensity 18).

3. **Road Network Flora & Quiver Tree Clearance**:

   - In `worldClearRects.ts`: Added full clearance of all road cells from `state.roadSet`, `state.roads`, and `state.roadWays` with a 1-cell safety buffer.
   - Quiver trees and foliage are strictly excluded from spawning within travel lanes and road corridors.

4. **Walkable Commercial Garage Plot on Foot**:

   - In `runtime.ts`: Added `isGaragePadWalkable(x, y, garagePad)` allowing pedestrian access across the paved apron, forecourt parking, open service bay, and glass showroom interior floor.
   - Updated `blockedStepReason`: Bypasses the `"parcel"` lock on walkable garage pad areas while preserving structural wall collisions.

5. **Cinematic Dual-Mode Game Boot Sequence**:

   - In `R3FCameraDirector.tsx`:
     - **New Player (No Car)**: Mode `"road_flythrough"` (4.2s duration) builds a CatmullRom3 road spline gliding low over municipal roads towards the glowing showroom, smoothly establishing the hero car on the turntable, then docks the player at the entrance.
     - **Car Owner (Has Car)**: Mode `"car_descent"` (2.2s duration) starts from an elevated 3/4 aerial view (20m up), swooping smoothly down with cubic ease-out to settle directly into the 3rd-person chase camera behind the vehicle.
     - Player can skip the cinematic at any time with a click or keypress.

6. **Button & Modal Layering Hierarchy**:

   - `OwnedCarControls` z-index normalized to `55` (gameplay HUD tier).
   - `.bug-report-panel` z-index elevated to `1000`.
   - `OwnedCarControls` is suspended while `bugReportOpen` or `roadmapOpen` is active.

7. **Freelance Bug Reporting & Right-Click Rework**:
   - In `BugReportPanel.tsx`: Added quick preset chips (`🌲 Tree on Road`, `💡 Dark Showroom`, `🚗 Garage Driveway`, `🚶 Walk Blocked`, `🔲 Button Overlap`).
   - Added a "Freelance Talk / Write" prompt input with `🪄 Auto-Fill Form` extracting structured Title, Steps, Expected, and Actual fields.
   - Right-click context menu enables `🪄 Rework from prompt`, `✨ Polish & format as QA repro`, and `🧹 Clear form`.

## Verification & Acceptance

- `tests/roadsClearOfFoliage.test.ts`: Passes unit verification ensuring quiver trees and flora are strictly cleared from road networks.
- `tests/onboardingAndGarageDriveIn.test.ts`: Passes 5/5 tests including pedestrian walkability on garage pad.
- `tests/bugReportPanel.test.ts`: Passes rendering and form verification.
- `tests/garageAnchorShellScale.test.ts`: Passes pad sizing and driveway apron geometry verification.
- `npm run typecheck`: 0 errors.
