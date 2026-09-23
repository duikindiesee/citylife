# Spec 169 — Showroom Vehicle Selection: Yellow Fiat X1/9 Targa GLB

**Status:** building
**Lane:** Car / Garage spine
**Date:** 2026-09-17
**Depends on:** Spec 096 (Garage and Car Customization), Spec 099 (Street Rod Vision)

## Why

The Street Rod epic (issue #125) is inspired by the operator's brother's yellow 1979 Fiat X1/9 build ritual — two brothers meeting at night to hang out, tune, and race their cars.

While the Gearbox Auto Hub showroom initially shipped with procedural box-geometry vehicles (`Karoo Vonk 1.1` starter hatch and `Karoo Kaap GT-V8` coupe), an authored 3D model (`modern_car.glb` / `fiat_x19.glb`) delivers the authentic wedge silhouette, black targa roof, pop-up headlight pods, Bertone star alloys, and mid-engine proportions on the rotating showroom plinth.

This specification integrates the authored yellow Fiat X1/9 GLB model into the showroom catalog and turntable view, allowing players to inspect and select it in the carousel.

## Mechanic

1. **Asset Placement:**

   - Static models located at:
     - `public/assets/citylife/cars/karoo_vonk.glb` (474 KB): Karoo Vonk 1.1 compact starter hatch with dual-tone Azure Blue body, Bianco White curved roof, chrome grille bar, round LED headlights, and alloy rims.
     - `public/assets/citylife/cars/karoo_kaap_gt.glb` (405 KB): Karoo Kaap GT-V8 coupe with Obsidian Crimson body, carbon-fiber aerodynamics, quad chrome exhausts, active rear spoiler, and twin-spoke alloy wheels.
     - `public/assets/citylife/cars/fiat_x19.glb` (325 KB): Karoo X19 Targa wedge sports coupe with Giallo Yellow body, black targa roof, pop-up headlights, and Bertone star alloys.

2. **Showroom Catalog Interface (`src/colony/showroom/showroomCatalog.ts`):**

   - All `ShowroomVehicle` entries provide authored 3D asset metadata:
     - `glbUrl?: string`
     - `presentationScale?: number` (tuned per vehicle: 0.54 for Vonk, 0.48 for Kaap GT, 0.56 for X19)
     - `rotationOffset?: readonly [number, number, number]` (`[0, -Math.PI / 2, 0]` facing the showroom camera)
   - Catalog lineup:
     - `showroom:karoo-vonk-11`: `Karoo Vonk 1.1`, Compact starter hatch, ₭250 (Top Speed 0.38, Accel 0.42, Grip 0.55, Braking 0.50).
     - `showroom:karoo-kaap-gt-v8`: `Karoo Kaap GT-V8`, Heritage V8 coupe, ₭2,400 (Top Speed 0.82, Accel 0.78, Grip 0.60, Braking 0.62).
     - `showroom:karoo-x19-targa`: `Karoo X19 Targa`, Heritage sports targa, ₭950 (Top Speed 0.65, Accel 0.62, Grip 0.85, Braking 0.72).

3. **Plinth Rendering (`src/colony/render/ShowroomView.tsx`):**

   - Renders within a `<Suspense fallback={null}>` boundary on the rotating dark-stone plinth.
   - Reuses `@react-three/drei`'s `useGLTF` for efficient model caching and asset preloading (`useGLTF.preload("/assets/citylife/cars/fiat_x19.glb")`).
   - Cloned scene enables shadows (`castShadow = true`, `receiveShadow = true`).
   - Retains loader cache ownership without per-instance disposal, explicitly suppressing automatic unmount disposal via `dispose={null}` to preserve shared GPU allocations across carousel selection.

4. **Carousel Navigation (`src/colony/ui/ShowroomOverlay.tsx`):**
   - Arrow keys and HUD navigation buttons cycle across all 3 showroom vehicles.
   - Specification card updates reactively with vehicle class, planned price, blurb, and performance bars.

## Public Safety & Marque Rules

- Real automotive manufacturer trademarks ("Fiat") are strictly forbidden in client copy per repository guidelines and the test assertion `/fiat|ford|capri|perana|uno\b/i`.
- In-game presentation adopts the approved fictional **Karoo Motors** marque:
  - Public Name: `Karoo X19 Targa`
  - Vehicle Class: `Heritage sports targa`
  - Blurb: `A mid-engine wedge targa: agile poise, pop-up lights, built for the winding mountain pass.`
- All player-facing strings validated against `isPublicSafe()`.

## Acceptance Criteria

1. `SHOWROOM_VEHICLES` contains `showroom:karoo-x19-targa` with `glbUrl: "/assets/citylife/cars/fiat_x19.glb"`.
2. `ShowroomView.tsx` renders the GLB car on the turntable plinth without R3F or console errors.
3. Unit test suite `tests/showroomSelection.test.ts` passes, verifying catalog entries, public-safety screens, specification card stats, and loader cache resource retention.
4. `npm run typecheck` (`tsc --noEmit`) passes cleanly with no errors.
5. `GlbTurntableCarModel` retains loader cache ownership (`dispose={null}`), leaving cached geometries and materials intact on unmount or selection change.
