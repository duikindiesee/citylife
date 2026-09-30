# Spec 175 — Smooth Onboarding Journey: Homestead Acquisition, In-Car GPS Navigation, and Garage Drive-in Clearance

- status: built
- proposed-by: Antigravity (operator request)
- date: 2026-09-30
- depends-on: Spec 109, Spec 114, Spec 156, Spec 172, Spec 173, Spec 174

## Why (the citizens' and player's case)

Players entering CityLife with their newly acquired hero sports car (`Karoo X19 Targa` / `Karoo Kaap GT-V8`) encountered several immersion-breaking obstacles in the onboarding experience:

1. **Showroom Window Car Discrepancy**: The player vehicle is a sleek, authentic 3D sports car model (`/assets/citylife/cars/fiat_x19.glb` / `karoo_kaap_gt.glb`), but the showroom window and forecourt display vehicles rendered outdated low-poly procedural boxes (`buildCarMesh`), looking mismatched.
2. **Invisible Wall at the Garage**: When driving off the road toward the Gearbox Auto Hub forecourt or open service bay, an invisible collision boundary (`blockedStepReason` returning `"parcel"`) arrested the vehicle, preventing players from driving into the garage or servicing their car.
3. **Cluttered Mobile Controls**: Stacked bottom-right action buttons ("🚗 Drive home", "🏡 Choose your home", etc.) clashed with and overlapped the mobile touch pedals (GAS, BRAKE, REV).
4. **Disjointed Onboarding**: Rather than navigating multiple standalone modal menus, first-time drivers needed a seamless 9/10 onboarding flow: an in-game mission prompt in the car to claim their homestead, instant house construction in the 3D world upon purchase, and in-car GPS navigation with a 3D waypoint beacon guiding them directly along roads to their new home driveway.

## Mechanic

1. **Authentic Showroom & Forecourt 3D Cars**:
   - In `R3FCommercialDistrict.tsx`, `R3FGarageCars` dynamically populates the showroom window and forecourt display plinths with cloned, authentic GLB models from `SHOWROOM_VEHICLES` (`Karoo Kaap GT-V8`, `Karoo X19 Targa`, `Karoo Vonk 1.1`), ensuring the showroom vehicles match the player's authentic car quality.
   - `buildCarMesh` in `carMesh.ts` has been upgraded with rear taillight styling for procedural fallbacks.
2. **Garage Pad & Homestead Driveway Clearance**:
   - In `runtime.ts` `tickOwnedDrive`, `isGaragePadDrivable(x, y, garagePad)` permits driving onto the concrete forecourt apron (`localZ > -0.4`) and inside open service bay 1 (`localX: 0.4..2.8, localZ > -2.9`), while maintaining collision against the solid showroom glass and closed rear walls.
   - `isHomesteadDriveway(ix, iy)` ensures the operator citizen's owned homestead driveway, gate, and yard are drivable, while the solid house structure blocks.
3. **Clean Driving HUD & Suppression of Corner Rails**:
   - In `ColonyApp.tsx`, all bottom-right corner action buttons are gated with `!runtime.getOwnedDrivePose()`, ensuring the mobile pedals (`OwnedCarControls`) have an unobstructed, dedicated touch surface while driving.
4. **Seamless Homestead Acquisition & In-Car GPS Navigation**:
   - When driving without a home, `OwnedCarControls` renders a top in-car mission HUD banner: `🏡 Mission: Claim Your Homestead [Select Plot →]`.
   - Selecting a plot in `StarterPropertyOverlay` calls `runtime.claimStarterHome(lotId)`, which immediately assigns the plot to the operator citizen and triggers `buildHouse(lotId)` so the house raises in 3D right away.
   - Upon purchase, GPS navigation automatically activates:
     - In 3D: `R3FHomeGpsBeacon` renders a 32m tall glowing cyan/green waypoint beam with pulsing ground rings over the home driveway.
     - In HUD: A dynamic GPS navigation bar displays live distance (meters), dynamic directional arrows (`⬆️`, `↗️`, `➡️`, `↖️`, `⬅️`, `⬇️`), and turn-by-turn guidance.
     - Upon reaching the home (distance <= 14m), the HUD celebrates arrival and presents `[🅿️ Park & Walk In]`, transitioning the driver directly to their front door.

## Rules & data

- Garage Pad Forecourt Drivable Z: `localZ > -0.4`
- Open Service Bay Drivable Bounds: `localX ∈ (0.4, 2.8)`, `localZ > -2.9`
- GPS Waypoint Beacon Height: 32 meters
- Arrival Radius Threshold: 14 meters (3.5 grid cells)
- Mobile Pedal Area: 100% dedicated, zero corner button overlap while driving.

## Verification & Acceptance

- `tests/onboardingAndGarageDriveIn.test.ts`: passes 4/4 tests verifying garage pad drivability, back wall blocking, homestead acquisition, and showroom catalog GLB consistency.
- `npm run typecheck`: 0 errors.
- `npm run build`: production build passes in <500ms.
