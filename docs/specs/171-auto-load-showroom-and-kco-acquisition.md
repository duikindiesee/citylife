# Spec 171 — Auto-Load Showroom for New Players & Authoritative KCO Vehicle Acquisition (PLAYER.CAR.1.S5)

**Status:** implementation under review; deployed acceptance pending<br>
**Lane:** Car / Garage spine<br>
**Date:** 2026-09-19<br>
**Tracking:** Issue #516, PR #517<br>
**Depends on:** Spec 096 (Garage and Car Customization), Spec 169 (Showroom Vehicle Selection), Spec 156 (Starter Property & House Projection), Spec 099 (Street Rod Vision)

## Why (the citizens' case)

A newcomer arriving in CityLife needs reliable personal mobility before embarking on their journey out into the wider world, visiting friends, or racing on the coastal pass.

Previously, vehicle acquisition remained locked behind a preview-only dark feature gate (`VITE_CITYLIFE_CAR_ACQUISITION`), and new players were required to manually seek out the showroom affordance from the world HUD. Furthermore, backend acquisition contracts in `kooker-service-user` (PR #224, `PLAYER.CAR.1.S2`) finalized authoritative coin debiting and vehicle ownership tracking under `/api/v1/citylife/players/me/vehicle` and `/api/v1/citylife/players/me/vehicle/purchase`.

This specification completes `PLAYER.CAR.1.S5`:
1. When an authenticated player logs into CityLife without an owned car on their profile, they immediately load into the **Gearbox Auto Hub showroom** interior.
2. The showroom enables acquisition using the player's authoritative **KCO** currency balance.
3. The client integrates with `kooker-service-user` S2 endpoints, mapping canonical vehicle keys per Contract A15 and translating HTTP 422 / 402 statuses into user-friendly outcomes.
4. Acquired vehicles are directly committed to `garageStore` (`citylife.garage.v1`), ensuring only the server-confirmed vehicle is parked and drivable.

## Mechanic

1. **Auto-Load Showroom on Login Without Car (`src/colony/ui/ColonyApp.tsx`):**
   - When identity resolution completes and the session is entitled (`newPlayerJourneyEnabled === true`):
     - An idempotent check evaluates whether the player owns a car across three layers:
       1. Local `garageStore.hasStoredCar(citizenId)`.
       2. Local storage ownership cache `loadOwnedKeysCache()`.
       3. Authoritative backend GET `fetchOwnedVehicleKeysBackend()`.
     - If all three indicate no vehicle is owned, the showroom overlay is automatically opened (`setShowroomOpen(true)`).
     - Guarded by `autoShowroomCheckedRef` so this check occurs once per login session; explicitly exiting the showroom does not re-trigger the auto-spawn.

2. **Authoritative KCO Acquisition Client (`src/colony/car/carAcquisition.ts`):**
   - **Endpoints:**
     - Truth: `/kooker/api/v1/citylife/players/me/vehicle` (falling back to legacy `/kooker/api/v1/citylife/car-ownership` if 404).
     - Purchase: `/kooker/api/v1/citylife/players/me/vehicle/purchase` (falling back to legacy `/kooker/api/v1/citylife/car-acquisitions` if 404).
   - **Contract A15 Canonical Key Mapping:**
     - Client-side showroom catalog keys (`"showroom:karoo-vonk-11"`) are stripped of the `"showroom:"` prefix via `serverVehicleKeyOf()` before being posted to the server as `"karoo-vonk-11"`.
     - Canonical key screening accepts both prefixed (`showroom:*`) and normalized server keys (`karoo-*`).
   - **Status Code Mapping:**
     - `200` / `201`: `{ kind: "owned" }` (server granted or confirms ownership).
     - `402` / `422`: `{ kind: "insufficient_funds" }` (not enough KCO; no coin moved).
     - `202` / `409`: `{ kind: "pending" }` (accepted or in-flight idempotent replay).
     - `401` / `403`: `{ kind: "disabled" }` (signed out or unauthorized).

3. **In-World Garage Synchronization (`src/colony/ui/ShowroomOverlay.tsx`):**
   - Upon confirmed purchase (`result.kind === "owned"`):
     - Resolve a fresh authoritative ownership GET before persistence. A successful POST may confirm a different already-owned car; persist the catalog spec matching that confirmed key, never the selected offer.
     - If truth is unavailable, empty or unknown, show an error without granting a local car or inventing cached ownership.
     - Keep account/citizen and unmount guards across both purchase and subsequent ownership reads.
     - `saveOwnedKeysCache` updates local cache.
     - The specification card renders `✓ In your garage`.
   - On initial mount of the showroom, if the authoritative backend truth indicates existing car ownership but `hasStoredCar(citizenId)` is not yet populated, the store is automatically hydrated with the matching catalog `CarSpec`.

## Public Safety & Economy Rules

- Marque naming strictly adheres to the fictional **Karoo Motors** universe (`Karoo Vonk 1.1`, `Karoo Kaap GT-V8`, `Karoo X19 Targa`).
- Client never authors price, ledger movements, or arbitrary ownership claims: only `vehicleKey` and `Idempotency-Key` are transmitted.
- Server (`kooker-service-user` / `VehicleCatalog`) remains the sole authority on coin debiting and ownership grants.

## Acceptance Criteria

1. Authenticated session without a stored or server-owned vehicle automatically mounts `ShowroomOverlay`.
2. Acquisition button is enabled in the showroom for the new-player journey.
3. Clicking Acquire posts `{ vehicleKey: serverKey }` with `Idempotency-Key` to `/kooker/api/v1/citylife/players/me/vehicle/purchase`.
4. HTTP 422 / 402 renders `Not enough ₭ — try later`.
5. Successful acquisition persists the `CarSpec` to `citylife.garage.v1` via `garageStore.saveCar`.
6. Full test suite (`npm test`) and `npm run typecheck` pass with zero errors.

## Review correction evidence

Regression tests exercise React delegated click handlers and assert that a purchase actually starts before account-switch/unmount guards are tested. Successful controls cover matching and different server-owned vehicles; unavailable and empty ownership never grant the selected offer. Live-backend purchase and deployed driving acceptance remain required after review and rollout.
