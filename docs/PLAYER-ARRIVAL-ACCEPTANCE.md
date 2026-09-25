# Player arrival acceptance — 2026-09-23

Status: active implementation and deployed acceptance; not complete.

## Required player journey

1. Resolve the current user's vehicle and home from authoritative server state on login/reload.
2. With an owned car, enter that exact car. With an owned home, place it safely in front of the home on a usable driveway connected to the road.
3. Without a car, open Gearbox Auto Hub, show the actual models including X19, and allow server-priced acquisition. Closing and reopening must preserve the qualifying player's acquisition eligibility.
4. Without a home, show available plots and prices, purchase a selected plot, continue into house building, then arrive at the completed owned home with the owned car.
5. Fund the intended starter path, including X19, plot and house completion. New-player grants and existing-player recovery must be authoritative, idempotent and auditable; never replenish ordinary spending on every login.
6. Preserve ownership, balance, house and spawn across reload/login and isolate users. No guessed ownership, duplicate charges or client-authored money.

## Evidence and gaps

| Requirement  | Current evidence                                                                                                     | Remaining gap                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| X19 showroom | MoJoJo approved PR517, merged as `6dc295c`; release 35874372776 succeeded; live Chrome rendered X19 as 3/3 on 0.55.0 | Acquisition and subsequent arrival need full acceptance                                                          |
| Re-entry     | Live exit/re-entry reverted Acquire to preview-only; ColonyApp cleared eligibility in both handlers                  | Preserve same-identity eligibility; test and deploy correction                                                   |
| Funds        | Ledger StarterGrantService grants 750 KCO; service-user X19 costs 950 and starter home costs 350                     | Minimum 1300 for existing contracts; calculate actual plot/build path before final funding and one-time recovery |
| Home         | Spec156 selects neighbourhoods and projects a deterministic house for a 350 KCO deed                                 | Actual priced plot choice and house-building transition unproven                                                 |
| Plot settlement | Local Chromium journey verifies purchase confirmation settles before a deliberately delayed ownership read; Build House waits for that server truth | Fixture only; live debit and deployed readback remain unverified |
| Arrival      | Runtime parks a locally loaded car east of citizen home; DriveHomeOverlay moves a separate cursor                    | Server-owned car, real spawn/entry, driveway and home geometry must converge                                     |

## Dependency-ordered integration

1. Finish narrow showroom re-entry repair; obtain MoJoJo independent review.
2. Establish authoritative arrival decisions for no car/no home, owned car/no home, and owned car/owned home. Unavailable truth must not become guessed ownership.
3. Connect plot selection, owned house building/completion, driveway geometry, and real vehicle spawn/entry.
4. Calculate starter-path cost and implement server funding/recovery while preserving accounting and concurrency guarantees.
5. Route exact heads through the bridge review queue; merge only after approval and required checks; use normal release/GitOps.
6. Verify all three ownership states, insufficient funds, re-entry, reload/login, and identity isolation in the deployed interface. Retain screenshots and runtime receipts and explicitly record gaps.

Tests, asset HTTP200, merge and release are separate evidence layers. None substitutes for the complete live player journey.

## Arrival authority correction (2026-09-23, not yet deployed)

Task dd18507c-8ce4-4405-b7f2-10fb78b9f313: login must read current server vehicle ownership even when a local garage or ownership cache already contains a car. The no-car route now ignores those local hints; an explicit empty server result opens Gearbox. Unsupported/malformed server vehicle keys and token-refresh failures remain unavailable truth, never an empty ownership list. The existing cancellation guard drops responses from a previous session.

Coverage: pure stale-cache decisions, unknown server-owned model and refresh-rejection cases; browser regression seeds stale X19 ownership before authenticated login and expects a server read plus enabled Gearbox acquisition after an explicit no-vehicle response.

This change does not yet hydrate the exact owned car into the driving runtime, resolve an owned home's real parcel, invoke player house building, or place a car on a road-connected driveway. These remain required acceptance work. Deployed browser evidence remains outstanding.

# Owned-car hydration follow-up (not complete arrival)

Browser acceptance on 2026-09-23 exposed an additional prerequisite: a fresh authenticated
owner without a matching local CitizenRoster entry received correct vehicle truth but
had no rendered operator car. Existing unit coverage seeded a matching citizen and missed
this case. The runtime now stages this verified car at the surveyed Gearbox road entrance,
only when that entrance belongs to the live road network. The Chromium regression checks
the exact model, no invented citizen, a real road cell and stable placement after reload.
This does not seat the player or establish a home. User-keyed driving/presence and owned
home placement remain required; do not claim another citizen by name or invent a deed.

Authenticated bootstrap now resolves the exact catalog model from server ownership even
when onboarding is off. A different cached model is replaced; matching model tuning is
retained. Missing, empty, unsupported or ambiguous truth cannot render a fabricated
default owned car. Identity changes clear the runtime ownership binding and stale
responses cannot hydrate the new account. Showroom refresh and confirmed purchase use
the same binding.

This is a prerequisite, not seated gameplay acceptance. Runtime vehicle controls,
authoritative purchased parcels, completed house persistence and road-connected driveway
spawn remain required. The legacy drive-home overlay cursor is not evidence of driving.

The world renderer now uses the owned catalog vehicle's actual showroom GLB instead of
giving every model the same procedural block body. It retains loader ownership of cached
geometry/materials, centres the asset on the runtime anchor and seats its bounds on the
surface. Catalog model failure shows an explicit loading/error state rather than a
different car. Legacy non-catalog custom cars retain the procedural renderer.

Validation: 2,356 unit tests in 265 files passed for authority hydration and the no-citizen
spawn. The subsequent actual-model renderer change passed TypeScript and the Chromium
returning-owner regression, which checks the mounted X19 GLB has mesh geometry and verifies
ownership/placement after reload. API responses in this browser regression are fixtures;
this is not deployed ownership, acquisition, camera seating or driving acceptance.

## Local fixture journey evidence — 2026-09-25

| Claim | Status | Evidence | Remaining gap |
| ----- | ------ | -------- | ------------- |
| An underfunded player can see the X19 quote and shortfall without submitting a purchase. | Verified locally | The player-onboarding-journey Chromium test passed; [insufficient-funds screenshot](evidence/player-onboarding-2026-09-25/insufficient-funds.png) | Fixture balance only; live player balance and purchase refusal remain unverified. |
| The player wallet display follows the fixture's successful X19 and plot debits. | Verified locally | The onboarding journey reads the fixture Ledger endpoint, checks ₭350 after the X19 debit and ₭0 after the plot debit; [paid-plot screenshot](evidence/player-onboarding-2026-09-25/paid-plot.png) | Fixture Ledger only; deployed balance reads and live transaction readback remain unverified. |
| A successful plot response clears the busy state while the separate home-truth read is delayed. | Verified locally | The Chromium journey holds the read open, observes PLOT_OWNED, then releases it; [paid-plot screenshot](evidence/player-onboarding-2026-09-25/paid-plot.png) | Fixture APIs only; no real debit or deployed confirmation. |
| The house builder can save a house and the journey returns through reload to the expected owned-car/home runtime pose. | Runtime assertions and a presented world frame passed locally; visual proof of the property-car relationship is incomplete | [house-builder screenshot](evidence/player-onboarding-2026-09-25/house-saved.png); [presented arrival frame](evidence/player-onboarding-2026-09-25/home-arrival.png) | The frame shows the road, trees, map and driving HUD, but not the house and driveway together with the car. Fixture APIs only; deployed purchase, ownership and arrival remain unverified. |
| The expanded player map keeps the player marker on-map, shows live bus markers, and leaves the on-screen throttle usable. | Verified locally in the fixture journey | The browser test hit-tests the throttle, holds it, observes owned-car movement and confirms the map marker follows; [map and driving screenshot](evidence/player-onboarding-2026-09-25/home-map-driving.png) | Local fixture/session only; authoritative cross-client presence, live deployment and multiplayer movement remain unverified. |
| Seated owned-car view is unobstructed; Park and exit finds a validated driveway/road cell, faces the parked car, and re-entry restores the seated view. | Verified locally in Chromium | [clear seated view](evidence/player-onboarding-2026-09-25/owned-car-seated-view.png), [parked car after exit](evidence/player-onboarding-2026-09-25/owned-car-parked-view.png), [parked camera measurements](evidence/player-onboarding-2026-09-25/owned-car-parked-camera-measurements.json), and `e2e/owned-car-arrival-view.spec.ts` | The fixture scene still does not show the house, parked car and driveway together. Service APIs are fixtures; deployed ownership, exit, persistence and player flow remain unverified. |

### Renderer frame-presentation follow-up — 2026-09-25

The renderer host is now placed at z-index 0 above the opaque page fallback. Browser capture immediately after the runtime pose becomes available can still precede the next presented R3F frame. The E2E polls the actual page screenshot for a foreground landscape pixel (up to 10 seconds) and checks that the connected canvas receives the viewport center hit-test. Sampling sky color was brittle because a legitimate night scene keeps the sky nearly black. The current frame is visibly rendered, but does not show the house, driveway and car together.

Latest reconciliation-worktree validation: `npm run typecheck` passed; 116 focused tests passed across 14 files; the fixture-backed onboarding Chromium journey passed in 1.4 minutes; `owned-car-arrival-view.spec.ts` passed in 45.7 seconds; and `npm run build` passed. The build reports an existing 2.65 MB `CommercialBlock` chunk above Vite's 500 kB advisory threshold. Evidence screenshots and camera measurements are retained in this directory. The onboarding journey proves that the fixture arrival pose survives reload, wallet display follows fixture debits, and the expanded map tracks the car while the visible throttle is held. The car-view test proves a seated view, driveway exit, parked-car visibility and re-entry. These tests do not prove deployed ownership, live ledger debit/funding, the visible house/driveway/car relationship, or multiplayer movement.

The earlier run passed one fixture-backed Chromium journey in 6.4 minutes. Focused tests passed
80/80 across five files, npm run typecheck passed, and the production build passed. The
full npm test run completed with 2,406 passing tests and two timeouts in
worldLayoutImportPreflight.test.ts. Both timed-out cases passed alone with retries disabled
in 57.0 s and 54.3 s against a 60 s timeout, suggesting suite contention around tests already
near their budget. The full suite is not green and still needs a faster fixture or an
appropriate measured timeout. None of these checks establish live funding, authoritative
service integration, account isolation, deployment or player-visible arrival.

### Full-suite follow-up — 2026-09-25

`worldLayoutImportPreflight.test.ts` now builds one seeded survey-only runtime and caches the
valid/invalid surveyed placements for its four cases. The suite passed 4/4 with retries
disabled in 81.74 seconds. After that change, the full `npm test` run passed 2,411 tests in
278 files with no failures or timeouts (222.54 seconds elapsed). The command was issued as
`npm test -- --maxWorkers=1 --retry=0`, but npm launched only `vitest run` and the Vitest
process used its normal worker pool; the worker limit was not actually applied. This run
resolves the earlier timeout outcome, but does not prove live funding, authoritative service
integration, account isolation, deployment or player-visible arrival.
