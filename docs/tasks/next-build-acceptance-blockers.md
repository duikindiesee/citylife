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
   - *Observation:* Overlapping cars near the rotating turntable display; yellow Karoo X19 protruding through the showroom exterior wall and intersecting the red Karoo Kaap GT-V8's bumper/boot area.
2. **Coastal Road Grounding, Road Classification & Water Entrapment:**
   - *Observation:* Car sinking into the coastal road with wheels submerged while HUD reports `OFF-ROAD`. Driving into dark blue coastal water causes car to get permanently stuck, preventing exit or walking.
3. **Testing Diagnostic Readout HUD:**
   - *Requirement:* Compact diagnostic readout beside version stamp with world coordinates (X, Y, Z with elevation clearly labelled), heading, world seed, version/commit SHA, and compile-time build date/time with timezone, without obscuring controls.
4. **Top-Bar UI Acceptance & Map Entry Points Rationalization:**
   - *Observation:* `OFF-ROAD` badge and `Your Plot` controls floated on top of other UI at `marginTop: 16px`, colliding with the topbar and intercepting pointer clicks. Multiple confusing map buttons ("Map", "Survey Map", "Road Map") created confusion.
5. **Wallet / Purchase Edge-Case Hardening:**
   - *Requirement:* Harden purchase flows against missing wallet, zero balance, request failure, expired session (401/403), logout/account-switch stale balance clearing, server-authoritative funds/ownership, atomic purchase, idempotent retries, and concurrent request protection.

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

## 3. Verification & Test Summary

- `npm test`: **273 test files passed, 2395 tests passed** (including all unit and integration tests).
- `npm run typecheck`: **0 errors**.
- `npm run build`: **Built successfully** in 438ms.
- `c:\kooker`: `npm test`, `npm run validate`, `npm run public-safety` **all PASS**.

---

## 4. Task API & Operator Write Authority Path

- **Status of Direct Task API Mutation:**
  - `POST /api/swarm/workstreams/tasks` returns `HTTP 403 Forbidden` for automated bot actors due to lack of `FLEET_ADMIN` role.
- **Supported Operator Write Path:**
  - Authoritative Task API records must be updated via user JWT authenticated with `FLEET_ADMIN` role through `kooker-web` (`/workstreams`) or operator CLI.
  - Local repository records in `docs/tasks/` remain the durable source of truth until synchronized by operator Irwin.
