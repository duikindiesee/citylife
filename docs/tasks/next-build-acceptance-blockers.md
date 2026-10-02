# Next-Build Acceptance Blockers & Hardening Record

- **Document ID:** TASK-2026-09-30-ACCEPTANCE-BLOCKERS-01
- **Severity / Priority:** Required for Next Build (P1)
- **Status:** Implemented & Verified in Local Test Environment / Awaiting Operator PR Review & ArgoCD Pipeline Rollout
- **Branch:** `antigravity/next-build-acceptance`
- **Base Commit:** `ad1f8dcef8ae2a137becd5f2b1567effcaad7637` (Merge of PR #549 on `main`)
- **Epic Reference:** `docs/EPIC-street-rod.md` · Specs 173–176
- **Release Path Compliance:** Strict zero-drift policy. No SSH/kubectl pod copies. Release strictly through PR -> review -> `main` merge -> GitHub Actions container build -> ArgoCD rollout.

---

## 1. Executive Summary & Problem Inventory

This task record documents the investigation, root causes, implementation fixes, and test verifications for the five acceptance blockers reported by Irwin following the merge of PR #549:

1. **Showroom Geometry & Placement Acceptance Blocker:**
   - _Observation:_ Overlapping cars near the rotating turntable display; yellow Karoo X19 protruding through the showroom exterior wall and intersecting the red Karoo Kaap GT-V8's bumper/boot area.
2. **Coastal Road Grounding, Road Classification & Water Entrapment:**
   - _Observation:_ Car sinking into the coastal road with wheels submerged while HUD reports `OFF-ROAD`. Driving into dark blue coastal water causes car to get permanently stuck, preventing exit or walking.
3. **Testing Diagnostic Readout HUD:**
   - _Requirement:_ Compact diagnostic readout beside version stamp with world coordinates (X, Y, Z with elevation clearly labelled), heading, world seed, version/commit SHA, and compile-time build date/time with timezone, without obscuring controls.
4. **Top-Bar UI Acceptance & Map Entry Points Rationalization:**
   - _Observation:_ `OFF-ROAD` badge and `Your Plot` controls floated on top of other UI at `marginTop: 16px`, colliding with the topbar and intercepting pointer clicks. Multiple confusing map buttons ("Map", "Survey Map", "Road Map") created confusion.
5. **Wallet / Purchase Edge-Case Hardening:**
   - _Requirement:_ Harden purchase flows against missing wallet, zero balance, request failure, expired session (401/403), logout/account-switch stale balance clearing, server-authoritative funds/ownership, atomic purchase, idempotent retries, and concurrent request protection.
6. **Bug Logger Black Capture & Coordinates Display:**
   - _Observation:_ Bug report capture returned black PNG; coordinates readout did not track active player position or display permanently on HUD captures.
7. **Showroom Wall Protrusion, Forecourt Parking Misalignment, and Roadside / Apron Drive-in Lockup ("Able to turn only"):**
   - _Observation:_ Yellow Karoo X19 protruding through showroom dividing wall; display cars crooked and straddling parking bays; car unable to drive into garage apron due to border shrink and parcel blockers; car stuck on roadside verge unable to drive forward or reverse ("able to turn only").

---

## 2. Root Cause Analysis & Resolutions

### Blocker 1: Showroom Vehicle Overlap & Wall Protrusion

- **Root Cause:**
  - In `src/colony/render/commercialDistrictLayer.ts`, the shell model applies a `renderScale = 4.0`.
  - Inside the shell, the placeholder car group was scaled by `1.55` (hero car) and `1.42` (secondary car).
  - In `src/colony/render/R3FCommercialDistrict.tsx`, `replaceCar` applied a GLB scale factor of `0.45` to imported models that were already 4.08m in raw length.
  - Effective length was `4.08m * 4.0 * 1.55 * 0.45 = 11.38m` for the hero car and `12.05m` for the secondary car!
  - In a showroom of 33m width, two ~12m vehicles placed 10.65m apart collided by over a meter, and the secondary car clipped through the exterior side wall.
- **Resolution:**
  - Sized placeholder car scales to `1.0` in `commercialDistrictLayer.ts`.
  - Positioned hero turntable at `x: showroom.x - showroom.w * 0.10`, `y: 0.17`, `z: showroom.z + showroom.d * 0.04`.
  - Positioned secondary display bay at `x: showroom.x + showroom.w * 0.24`, `y: 0.05`, `z: showroom.z - showroom.d * 0.04`, `rotation.y: 0.12`.
  - Scaled GLBs by `0.262` in `R3FCommercialDistrict.tsx`, yielding true 4.28m life-size car dimensions.
  - Added smooth continuous turntable spin (`hero.rotation.y += delta * 0.22`, `plinth.rotation.y += delta * 0.22`).
- **Clearance Evidence:**
  - Regression test: `tests/showroomGeometryClearance.test.ts` (PASS).
  - Minimum clearance to secondary car across full 360° rotation: **9.10m** (exceeds the >= 2.5m walkway requirement).
  - Clearance to walls throughout rotation: **7.77m to 17.62m** (zero wall clipping).

---

### Blocker 2: Coastal Road Grounding & Water Entrapment

- **Root Cause:**
  - Teleport button in `DrivableRoadTestModal.tsx` targeted `(98, 362)`. On seed 4242, the coastal road centerline at `x = 98` is `y = 358`. `(98, 362)` was 4.2 cells into the dirt embankment outside the road polygon.
  - At `(98, 362)`, `isRoadSurface` evaluated to `false`, reporting `OFF-ROAD` and snapping car elevation down by 37cm to raw terrain level, sinking wheels into the road apron mesh.
  - In `exitOwnedCar()`, the exit search only examined lateral cells `[-1, 1]` relative to car orientation. If the car entered coastal water, both candidate exit cells were submerged (`t.isWater === true`), permanently trapping the player inside the vehicle.
  - In `tickOwnedDrive`, water blocking executed before road surface check, blocking elevated road bridges over water.
- **Resolution:**
  - In `src/colony/runtime.ts`: Prioritized `isRoadSurface` check before water check, allowing cars to drive over causeways and bridges.
  - Rewrote `exitOwnedCar()` with a 5-stage search: lateral door offsets -> fore/aft offsets -> diagonals -> outwards spiral (up to 4 cells) -> nearest roadSet cell. Player is guaranteed a dry, walkable exit cell.
  - In `src/colony/render/R3FOperatorCar.tsx`: Added slope pitch/roll calculation from surface elevation samples and shoulder verge height clamping (`centerY = onRoad ? roadY : Math.max(groundY, isPointOnRoadSurface ? roadY : groundY)`).
  - Corrected test teleport target in `DrivableRoadTestModal.tsx` to `(98, 358)`.
- **Evidence:**
  - Regression test: `tests/coastalRoadAndExit.test.ts` (3/3 PASS).

---

### Blocker 3: Testing Diagnostic Readout HUD

- **Implementation:**
  - In `src/colony/ui/BuildStamp.tsx`, added a compact diagnostic readout (`data-testid="diagnostic-readout"`) displaying:
    - Coordinates: `X: <x>m`, `Elev: <elev>m`, `Z: <z>m`
    - Heading: `Hdg: <deg>°`
    - Seed: `Seed: 4242`
    - Build metadata: `v<ver> · <sha> · <builtAt>` using compile-time build date/time with timezone (never substituted with page-load time).
  - Connected `runtime` prop from `ColonyApp.tsx` and `FirstPersonPanel.tsx`.

---

### Blocker 4: Top-Bar UI Integration & Map Rationalization

- **Root Cause:**
  - `OwnedCarControls.tsx` previously rendered a floating container at `marginTop: 16px` with custom colors, thick borders, and 24px rounded corners. It sat directly on top of the CityLife topbar (`.topbar`), obscuring the clock/builder controls and intercepting pointer clicks.
  - Three distinct features were titled "Map": topbar "Map" (transit), builder "Survey Map" (spatial registry), and in-car "Road Map" (QA test overlay).
- **Resolution:**
  - Integrated `🏎️ Highway` / `🏜️ Off-Road` status, speed (`km/h`), and `Park & Exit` button (`data-testid="exit-owned-car"`) directly into the topbar (`header.topbar`) using native `.group` styling.
  - Integrated the starter plot banner (`data-testid="onboarding-claim-home-banner"`, `🏡 Starter Plot [Select →]`) directly into the topbar matching `.topbar > button` styling.
  - Removed the floating header and duplicate `Road Map` button from `OwnedCarControls.tsx`.
  - Docked the in-car GPS navigation HUD cleanly below the topbar (`marginTop: 56px`), with dark glass styling and zero overlap.
  - Rationalized map button labels:
    - Topbar shortcut: `Transit Map` (`data-testid="player-map-shortcut"`, opens `BusNetworkMiniMap`).
    - TopbarMenu item: `Transit Map`.
    - BuilderPanel: `Survey Map` (2D parcel grid) and `World View` (3D aerial camera).
    - Removed confusing `Road Map` QA test button from driving HUD.

---

### Blocker 5: Wallet & Purchase Edge-Case Hardening

- **Root Cause:**
  - In `StarterPropertyOverlay.tsx`, `walletKco` was not passed from `ColonyApp.tsx`, preventing pre-flight affordability checks.
  - `purchaseButtonView` and `acquireButtonView` left `disabled: false` on `insufficient_funds`, allowing rapid clicks with 0 balance.
- **Resolution:**
  - Passed `walletKco={playerWalletKco}` to `StarterPropertyOverlay.tsx`.
  - Added pre-flight affordability check: if `walletKco < selectedChoice.priceKco`, disables purchase button with `Need ₭<shortage> more` / `Not enough ₭ — try later`.
  - Explicitly handles `missing` wallet status (ledger 404 "no DEFAULT wallet exists yet"): disables button with `Wallet not set up`.
  - Stale balance clearing: upon logout or identity switch, `walletAccountKey` resets immediately to `null`, clearing prior user's balance and preventing cross-account leaks.
  - Atomic purchase & idempotency: sent stable `Idempotency-Key` headers (`citylife:home-purchase:${userId}:${key}`, `citylife:car-acquire:${userId}:${key}`).
  - Concurrent request protection: button disabled while in-flight (`pending === true`), replay 409/202 maps to neutral pending state without double-charging.
- **Evidence:**
  - Unit test: `tests/walletAndPurchaseHardening.test.ts` (11/11 PASS).

---

### Blocker 6: Bug Logger Black Capture & Coordinates Display

- **Root Cause:**
  - In `R3FPlanetRenderer.tsx`, `<Canvas>` lacked `gl={{ preserveDrawingBuffer: true, antialias: true }}`. In Chromium/WebGL, drawing buffers are discarded by the compositor immediately after presenting, causing `canvas.toDataURL()` in user event callbacks to return a blank/black canvas.
  - `capturePNG()` called `gl.render(scene, camera)` without resetting `gl.setRenderTarget(null)`. Because `EffectComposer` was mounted, `gl.getRenderTarget()` pointed to an offscreen postprocessing buffer; `gl.render` rendered into that offscreen target instead of `gl.domElement`.
  - `BugReportPanel.tsx` lacked an `<img>` preview of `capture.pngDataUrl`, concealing black captures from the user.
  - `BuildStamp.tsx` prioritized `opCar?.cell` over `fpCell`, causing players on foot to display parked car coordinates instead of their walking coordinates.
- **Resolution:**
  - Added `gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: "high-performance" }}` to `<Canvas>`.
  - In `capturePNG()`:
    - Detaches active postprocessing render target with `gl.setRenderTarget(null)`.
    - Forces camera world matrix update with `camera.updateMatrixWorld(true)`.
    - Renders direct frame to `gl.domElement` with `THREE.ACESFilmicToneMapping`.
    - Restores previous tone mapping and render target cleanly in `finally`.
    - Composites frame onto an offscreen 2D canvas with the spatial coordinates (`X`, `Elev`, `Z`), heading (`Hdg`), world seed, commit SHA, version, and build timestamp permanently burned into a sleek bottom HUD banner.
  - In `BugReportPanel.tsx`:
    - Added thumbnail preview `<img>` (`data-testid="bug-capture-preview"`) displaying `capture.pngDataUrl` immediately after capture, with a warning if the screenshot buffer is missing.
    - Fixed React hook ordering rules by keeping all `useState` calls at the top of the component.
  - In `BuildStamp.tsx`:
    - Reordered coordinate priority to active player (`drivePose` $\to$ `fpCell` $\to$ `citizenPos` $\to$ `opCar?.cell`).
    - Unconditionally displays diagnostic coordinate readout for in-game HUD and FP variants (`variant !== "login"`).
    - Corrected Z axis display to `diag.z`.
- **Evidence:**
  - Unit tests: `tests/bugCaptureAndCoordinates.test.ts` (4/4 PASS), `tests/bugReportPanel.test.ts` (2/2 PASS), `tests/buildStamp.test.ts` (5/5 PASS).

---

### Blocker 7: Showroom Dividing Wall Penetration, Parking Bay Misalignment, and Roadside / Apron Drive-in Lockup ("Able to turn only")

- **Root Cause:**
  1. _Showroom Dividing Wall Penetration:_ In `src/colony/render/garageAnchorShell.ts`, the showroom and service bay overlap along the X axis between `-0.08 * footprint.w` and `+0.04 * footprint.w`. The dividing partition wall sits at `-0.08 * footprint.w`. `secondaryCar` (yellow Karoo X19 Targa) was positioned at `x = showroom.x - showroom.w * 0.0952` (`-0.0952 * footprint.w`), placing the 1.92m-wide vehicle 0.97m into the solid dividing wall.
  2. _Forecourt Parking Misalignment:_ Display cars on the garage forecourt were positioned using hardcoded, crooked coordinates and orientations that straddled parking stalls instead of aligning with designated parking bays (`BAY 01`, `BAY 02`, `BAY 03`).
  3. _Garage Forecourt Drive-in Barrier:_ In `src/colony/runtime.ts`, `isGaragePadDrivable` applied an artificial 4% boundary shrink (`0.96`), and entrance apron cells (`localZ > -0.6`) were blocked by `canOccupy()` treating open unbuilt roadside `"parcel"` buffers as physical obstacles.
  4. _Roadside Verge Lockup ("Able to turn only"):_ In `src/colony/car/ownedDriving.ts`, collision checking previously tested all perimeter footprint points unconditionally. When a front wheel touched a curb or obstacle, `speed` was zeroed. When attempting to reverse, `isFootprintClear` failed because the front still slightly overlapped the obstacle, preventing backward movement. Meanwhile, steering only tested `canOccupy(center)` (which remained clear), so players could rotate in place but were completely trapped translationally.
- **Resolution:**
  1. _Showroom Wall Clearance:_ In `src/colony/render/commercialDistrictLayer.ts`, repositioned `secondaryCar` to `x: model.showroom.x + model.showroom.w * 0.085`, `y: 0.05`, `z: model.showroom.z - model.showroom.d * 0.02`, `rotation.y: -0.06`. This centers the vehicle inside the showroom bay, providing $>5.0\text{m}$ clearance to the dividing wall, $>3.0\text{m}$ clearance to the turntable plinth, and $>3.5\text{m}$ clearance to exterior glass and rear walls.
  2. _Parking Lot Bay Alignment:_ In `src/colony/render/garageAnchorShell.ts` and `commercialDistrictLayer.ts`, aligned `displayCars` to `parkingBays`:
     - `displayCars[0]` (Karoo Vonk): Centered squarely in `BAY 01` (`rot: parkingBays[0].rot`, `scale: 1.0`).
     - `displayCars[1]` (Karoo Kaap): Centered squarely in `BAY 02` (`rot: parkingBays[1].rot`, `scale: 1.0`).
     - `BAY 03` remains unobstructed and designated for player / customer vehicles.
  3. _Apron & Forecourt Access:_ In `src/colony/runtime.ts`, removed the artificial `0.96` border shrink in `isGaragePadDrivable` and permitted entrance apron approach (`localZ > -0.6`). Updated `canOccupy()` to ignore non-physical `"parcel"` roadside buffers for vehicle navigation.
  4. _Directional Footprint Unsticking:_ In `src/colony/car/ownedDriving.ts`, implemented `inspectFootprint(front, center, rear)` and directional gating `isStepAllowed`:
     - Forward drive (`speed > 0`) validates that front corners are unobstructed (`target.front === 0`).
     - When stopped against an obstacle, Reverse (`speed < 0`) is allowed because the rear path is clear (`target.rear === 0`), enabling instant unsticking.
- **Evidence:**
  - Unit and integration tests: `tests/parkingLotAndWallClearance.test.ts` (5/5 PASS), `tests/showroomGeometryClearance.test.ts` (1/1 PASS).

---

### Blocker 8: Exact-Head Review Hardening & Regression Resolution (Joekookerbot Review #551)

- **Root Causes & Findings:**
  1. _Occupied Parcel Off-Road Drivability:_ In `runtime.ts` `tickOwnedDrive`, accepting `"parcel"` allowed vehicles to drive through occupied/reserved plots off-road.
  2. _Vehicle Slope Axes Inversion:_ In `R3FOperatorCar.tsx`, longitudinal elevation gradient was applied as Euler X and roll as Euler Z. In `carMesh.ts`, headlights are on local +X and doors along +/-Z, so pitching required rotation around local Z and roll around local X in `"YXZ"` order.
  3. _Unbounded Water-Exit Teleport:_ In `runtime.ts` `exitOwnedCar`, scanning all of `roadSet` without a distance cap allowed teleporting hundreds of cells away across the map when stranded in deep water.
  4. _Dead Starter-Plot Entry:_ In `ColonyApp.tsx`, topbar button rendered on `!runtime.hasOperatorHome()` alone and called `setHomeOpen(true)`, but the modal was additionally gated by `newPlayerJourneyEnabled`.
  5. _Wallet Snapshot Refresh Path:_ `StarterPropertyOverlay.tsx` previously offered a Retry button only on missing/unavailable states, leaving ready-but-insufficient balance without a direct refresh affordance when funds arrive.
  6. _Playwright E2E Button Name:_ Renaming the topbar map button aria-label broke `e2e/playerHud.spec.ts` selector `getByRole("button", { name: "Open map" })`.
- **Resolutions:**
  1. Restored strict `if (this.blockedStepReason(x, y) !== null) return false;` in `tickOwnedDrive`, blocking non-road occupied parcels while preserving garage pad and homestead driveway clearance.
  2. Corrected vehicle rotation in `R3FOperatorCar.tsx` to `group.current.rotation.set(-roll, -heading, pitch, "YXZ")`.
  3. Bounded `exitOwnedCar` road fallback to `MAX_EXIT_TELEPORT_RADIUS = 6.0` cells (24m). Stranded vehicles with no reachable dry land fail safely (`return false`) without teleporting.
  4. Gated topbar starter plot button on `newPlayerJourneyEnabled` and routed click through `openHome`.
  5. Added `Refresh Balance` button beside the balance when `isInsufficient === true` in `StarterPropertyOverlay.tsx`.
  6. Preserved `aria-label={mapOpen ? "Hide map" : "Open map"}` on the topbar Transit Map button.
  7. Reconciled `docs/specs/170-player-state-hud.md` §3.2 and `docs/specs/175-smooth-onboarding-homestead-acquisition-gps-and-garage-drive-in.md` §§2, 4.
- **Evidence:**
  - `tests/parkingLotAndWallClearance.test.ts` (5/5 PASS, including occupied parcel collision).
  - `tests/vehicleSlopeTransform.test.ts` (3/3 PASS, including 1m grade Three.js vector probe and bounded exit).
  - `tests/bugCaptureAndCoordinates.test.ts` (5/5 PASS, including coordinate derivation and 2D canvas banner burn-in).
  - `tests/walletAndPurchaseHardening.test.ts` (12/12 PASS, including refresh affordance).

---

### Blocker 9: SAT Hard Gate for Clear-to-Overlap Transitions & Directional Unsticking (Joekookerbot Review #553)

- **Root Causes & Findings:**
  1. _SAT Soft Collision Gate:_ In `src/colony/car/ownedDriving.ts`, SAT overlap was added only to `center`. `isStepAllowed` permitted forward motion when `target.front === 0`, or reverse motion when `target.rear === 0`. Narrow obstacles (such as poles) passing between the 19 perimeter sample points did not trigger `target.front`, allowing the car to penetrate into SAT-detected obstacles from clear space.
  2. _Clear-to-Overlap Bypass:_ Clear-to-overlap transitions were not strictly gated against the prior step state, allowing forward steps to enter obstacles.
- **Resolutions:**
  1. _SAT Hard Gate:_ Added explicit check in `isStepAllowed`: if vehicle was clear at `current` (`isFootprintValid` clear and `current.total === 0`), any step resulting in `!isFootprintValid` or `target.total > 0` is strictly blocked.
  2. _Longitudinal SAT Probing:_ In `inspectFootprint`, when continuous SAT detects overlap, probed front half (`+hL`) and rear half (`-hL`) to accurately attribute obstacle impingement to `front`, `rear`, or spanning both.
  3. _Directional Unsticking:_ Preserved unsticking from an already overlapping pose: reversing away from an obstacle in front is allowed if `speed < 0 && target.rear === 0 && current.rear === 0`; driving forward away from an obstacle behind is allowed if `speed > 0 && target.front === 0 && current.front === 0`.
  4. _Negative Proof & Escape Regression:_ Added comprehensive regression test in `tests/garageRebuildAndCollision.test.ts` matching the exact negative proof fixture (0.035-cell pole at local 0.51, 0.08), verifying forward drive stops before penetration, forward drive while overlapping is blocked, and reverse unsticking escape successfully reaches a clear pose.
- **Evidence:**
  - `tests/garageRebuildAndCollision.test.ts` (12/12 PASS, including SAT hard gate and reverse escape).
  - `tests/citylifeQaExpandedFindings.test.ts` (4/4 PASS).
### Blocker 10: Service Bay Interior Partition and Structural Pier Colliders (Joekookerbot Review #553 / 5392115777)

- **Root Causes & Findings:**
  1. _Mesh / Collider Disconnect:_ In `commercialDistrictLayer.ts`, the solid workshop block was partitioned into discrete walls, including full-depth solid interior partition walls (`garageAnchorWorkshopPartition.1_2` / `2_3`) and front facade piers. However, `garageAnchorShell.ts` `obstacles` did not contain matching obstacle colliders for the partitions or piers.
  2. _Drivable Floor Boundary Spill:_ `open_service_bay_floor` surface width was $1.35 \times \text{bayDoorW}$ ($2.484$ cells), which crossed laterally into the west partition center at $X = 2.69$. A probe at $X = 2.69, Z = -0.55$ returned `isPointInDrivableSurface = true` and `isPointInsideGarageObstacle = false`.
- **Resolutions:**
  1. _Discrete Partition & Pier Obstacles:_ Added `service_bay_partition_1_2` ($X = 2.69$), `service_bay_partition_2_3` ($X = 4.99$), and front piers (`west`, `1_2`, `2_3`, `east`) to `model.obstacles` in `garageAnchorShell.ts`.
  2. _Constrained Bay Floor Width:_ Resized `open_service_bay_floor` to $1.05 \times \text{bayDoorW}$ ($1.932$ cells), fitting cleanly within the $2.14$-cell corridor between partition inner faces.
  3. _Standardized Mesh Thickness:_ Aligned visual partition thickness in `commercialDistrictLayer.ts` to $0.22$ cells to match collider thickness.
  4. _Regression Testing:_ Added exact runtime-model probe assertions and production movement-path regression in `tests/garageRebuildAndCollision.test.ts`. Updated Spec 177.
- **Evidence:**
  - `tests/garageRebuildAndCollision.test.ts` (15/15 PASS, including exact partition/pier probes and movement regression).
  - `tests/garageBayCavityAndSightline.test.ts` (6/6 PASS).

---

## 3. Verification & Test Summary

- `npm test`: **278 test files passed, 2427 tests passed**.
- `npm run typecheck`: **0 errors**.
- `npm run build`: **Built successfully**.
- `c:\kooker`: `npm test`, `npm run validate`, `npm run public-safety` **all PASS**.

---

## 4. Task API & Operator Write Authority Path

- **Status of Direct Task API Mutation:**
  - `POST /api/swarm/workstreams/tasks` returns `HTTP 403 Forbidden` for automated bot actors due to lack of `FLEET_ADMIN` role.
- **Supported Operator Write Path:**
  - Authoritative Task API records must be updated via user JWT authenticated with `FLEET_ADMIN` role through `kooker-web` (`/workstreams`) or operator CLI.
  - Local repository records in `docs/tasks/` remain the durable source of truth until synchronized by operator Irwin.
