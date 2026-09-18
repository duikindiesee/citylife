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
   - Static model located at `public/assets/citylife/cars/fiat_x19.glb` (and `public/assets/citylife/cars/modern_car.glb`).
   - 325 KB binary GLB with PBR materials (`CarPaint_GialloYellow`, `Black_Targa_Top`, `Black_Rubber_Bumper`, `Glass_Clear`, `Bertone_Star_Alloy`).

2. **Showroom Catalog Interface (`src/colony/showroom/showroomCatalog.ts`):**
   - Extended `ShowroomVehicle` with optional 3D asset metadata:
     - `glbUrl?: string`
     - `presentationScale?: number` (defaults to 0.56 for GLB models to match plinth diameter)
     - `rotationOffset?: readonly [number, number, number]` (defaults to `[0, -Math.PI / 2, 0]` to face the long presentation axis)
   - Registered entry `showroom:karoo-x19-targa`:
     - Public name: `Karoo X19 Targa`
     - Class: `Heritage sports targa`
     - Planned Price: `₭950`
     - Handling Profile: Top speed 0.65, Acceleration 0.62, Grip 0.85 (balanced mid-engine chassis), Braking 0.72.

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
