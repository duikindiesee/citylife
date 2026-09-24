# Spec 171 — Auto-Load Showroom for New Players & Authoritative KCO Vehicle Acquisition (PLAYER.CAR.1.S5)

**Status:** implementation under review; authoritative offer endpoint and deployed acceptance pending<br>
**Lane:** Car / Garage spine<br>
**Date:** 2026-09-19<br>
**Tracking:** Issue #516, original PR #517, follow-up PR #527<br>
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
     - Always read authoritative backend GET `fetchOwnedVehicleKeysBackend()` for the current session. Local garage entries and cached vehicle keys cannot bypass this read or establish ownership.
     - If the server reports no owned vehicle, the showroom overlay is automatically opened (`setShowroomOpen(true)`), even when local data contains an old/default car. Unavailable server truth is not interpreted as no ownership.
     - Guarded by `autoShowroomCheckedRef` so this check occurs once per login session; explicitly exiting the showroom does not re-trigger the auto-spawn.
     - Server-confirmed new-player acquisition eligibility survives closing and manually reopening the showroom in the same session. It resets on identity change; the journey entitlement still gates every entry. Exiting must not strand a qualifying newcomer behind the preview-only control.

2. **Authoritative KCO Acquisition Client (`src/colony/car/carAcquisition.ts`):**

   - **Endpoints:**
     - Truth: `/kooker/api/v1/citylife/players/me/vehicle` (falling back to legacy `/kooker/api/v1/citylife/car-ownership` if 404).
     - Offers: `/kooker/api/v1/citylife/players/me/vehicle/offers`, authenticated and sourced from the same server catalogue as purchase.
     - Purchase: `/kooker/api/v1/citylife/players/me/vehicle/purchase` (falling back to legacy `/kooker/api/v1/citylife/car-acquisitions` if 404).
   - Show each vehicle's server quote, never its planned client catalogue price. If the offer endpoint is missing, unavailable, malformed, or does not include a vehicle, keep its acquire control disabled and show that the price is unavailable/not offered. Do not use a local-price fallback.
   - Compare the server quote with the current player's wallet snapshot. When the snapshot is below the quote, show the exact shortfall (for example, `Need ₭200 more`) and disable Acquire; the purchase service still makes the final balance decision.
   - The client acquisition switch defaults on unless explicitly set off. This does not override the authenticated new-player journey entitlement or the service's own purchase gates.
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
- The client-side default-on switch is a presentation/eligibility default only; it does not enable a server feature flag, bypass the new-player journey entitlement, or authorize release activation.

## Acceptance Criteria

1. Authenticated session without a stored or server-owned vehicle automatically mounts `ShowroomOverlay`.
2. A player with authenticated no-car server truth and an active journey entitlement automatically enters Gearbox; acquisition is enabled by default for that eligible account when a valid server quote is available.
3. Each offered vehicle shows its server-authoritative KCO price; unavailable, malformed or missing quotes never fall back to planned client prices and keep Acquire disabled.
4. If the current wallet snapshot cannot cover the quoted price, show the precise shortfall and disable Acquire. Server HTTP 422 / 402 still renders an insufficient-funds result if the authoritative balance changed after the snapshot.
5. Clicking Acquire posts `{ vehicleKey: serverKey }` with `Idempotency-Key` to `/kooker/api/v1/citylife/players/me/vehicle/purchase`.
6. Successful acquisition persists the `CarSpec` to `citylife.garage.v1` via `garageStore.saveCar`.
7. Full test suite (`npm test`) and `npm run typecheck` pass with zero errors.

## Review correction evidence

Regression tests exercise React delegated click handlers and assert that a purchase actually starts before account-switch/unmount guards are tested. Successful controls cover matching and different server-owned vehicles; unavailable and empty ownership never grant the selected offer. Live-backend purchase and deployed driving acceptance remain required after review and rollout.
