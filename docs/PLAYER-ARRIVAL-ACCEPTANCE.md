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

### Deployed showroom offer blocker — 2026-09-25

| Claim | Status | Evidence | Remaining gap |
| ----- | ------ | -------- | ------------- |
| The deployed showroom currently receives vehicle data but cannot load authoritative vehicle offers; the card still presents an Acquire control while the price is unavailable. | Observed in the user-provided deployed-browser capture; not independently reproduced in this work session | [Chrome Network capture](evidence/player-onboarding-2026-09-25/showroom-offers-404-devtools.png) shows `vehicle` 200 and `offers` 404 alongside “Price unavailable”, “Server price unavailable”, and “Acquire”. | Reproduce after service rollout and verify the exact response from the live service. User Service PR #243 is open as draft; PR #245 is open and not draft; both inspected deploy jobs were skipped. |
| With no server quote, the showroom hides the Acquire control; with a quote above the fixture balance, it shows the exact shortfall and disables purchase. | Verified locally | Focused Chromium run passed `e2e/vehicle-offer-prices.spec.ts`; the fixture returned an X19 quote of ₭1,247 and a ₭700 balance, showing “Need ₭547 more” and a disabled “Insufficient funds” button, with no purchase POST. [Local screenshot](evidence/player-onboarding-2026-09-25/showroom-insufficient-funds-local.png) | Fixture-backed only. The deployed browser still showed `offers` 404; live service rollout and real-wallet refusal remain unverified. |
| The focused ownership/property regression set still works with the showroom change. | Verified locally | The focused Chromium run passed 5/5 cases in 8.5 minutes: showroom price/retry, returning-owner car hydration, paid plot persistence, plot purchase idempotency, and driving to an owned home. | Fixture-backed only; this does not establish service integration, funding, deployment, or complete deployed player acceptance. |
| Journey re-entry, identity isolation, plot failure/recovery, and insufficient-funds recovery still behave correctly after fixture alignment. | Verified locally | Five additional focused Chromium cases passed together; the re-entry case passed separately after updating its old button-label expectation. The unavailable-ownership branch shows the full-screen “Retry arrival” gate with no showroom or Acquire control. | Fixture-backed only. The test simulates unavailable ownership; live backend recovery, funding and deployed behavior remain unverified. |
| The source-defined API gateway route covers the CityLife prefix and requires JWT authentication. | Source configuration verified | `kooker-infra-uat/manifests/base/apisix-routes/apisix-routes.yaml` maps `/api/v1/citylife/*` to `kooker-service-user` with `jwt-auth`; CityLife `docker/default.conf.template` proxies `/kooker/` to the gateway and does not override the browser Authorization header. | No live APISIX route/config or authenticated deployed offers request was inspected in this session. The broad route makes a missing prefix route less likely; the unmerged/un-deployed service controller is the leading explanation for the observed 404. |

Local correction: `ShowroomOverlay` now omits Acquire while its authoritative offer is unavailable, retains the retry control, and labels an underfunded quoted car “Insufficient funds” with the exact gap. The 5-case core Chromium run passed in 8.5 minutes; five additional focused cases passed together and the corrected re-entry case passed in a separate 2.2-minute run. Changes remain in the isolated PR #524 worktree and have not been deployed.

Admin flag audit note: while inspecting the feature-flag control, a click briefly saved `new-player-journey-v1=OFF`; a second click restored `UAT_ALLOWLIST`, and the admin UI read back the restored state. This produced two audit writes. The flag was not set to global `ON`; no purchase, deployment, or balance mutation was performed. The existing funded-player/recovery safety gate and the API's lack of an `ON` state remain blockers to global default enablement.

### Mainline refresh and wallet/HUD reconciliation — 2026-09-26

The isolated PR #524 refresh was resolved against current `main` at
`b4afe825c7ed888221bff1fbe925a5ffc9ceac67`, starting from PR head
`40b4dea79759f657262fbea7a46487e3338478f0`. The refresh keeps the server-owned plot offers,
purchase/resume flow, published player inventory and house-builder transition while using the
current account-keyed, self-scoped wallet snapshot for the HUD, showroom and property overlay. An
unavailable ownership read keeps the full-screen retry gate; it does not guess “no car” or open
Acquire. This refresh remains an uncommitted local candidate: the GitHub PR is still draft at its
previous head, dirty against `main`, and reports no hosted checks.

| Claim | Status | Evidence | Remaining gap |
| ----- | ------ | -------- | ------------- |
| Current wallet and property-flow changes typecheck and pass the full unit suite. | Verified locally | `npm run typecheck`; `npm test` passed 276 files / 2,395 tests; the wallet, plot-offer, garage-arrival and journey-entitlement focus passed 70/70. | Fixture/source coverage does not prove privacy or balances against the deployed Ledger. |
| Returning-owner, showroom-reentry, stale-cache ownership and journey-gate browser cases pass with the current HUD. | Verified locally with fixture APIs | `e2e/new-player-journey-mobile.spec.ts`: returning owner 1/1; showroom re-entry 1/1; stale-cache/server ownership 1/1; journey gate 1/1. The 150-second combined harness reached its process-tree bound after the first two cases; the remaining cases were then run separately and passed. | No live purchase, plot settlement, house completion, logout/account-switch privacy or deployed player-flow proof. |
| The refreshed production bundle builds. | Verified locally | `npm run build` completed. | Existing `CommercialBlock` output is 2.65 MB, above Vite's 500 kB advisory threshold. |
| PR #524 is ready for independent review or merge. | Not yet | `gh pr view 524`: remote head `40b4dea79759f657262fbea7a46487e3338478f0`, draft, `DIRTY` / `CONFLICTING`; `gh pr checks 524` reports no checks. | Publish the reviewed local refresh after the current MoJoJo queue item is reconciled, run hosted checks and route the exact resulting head. User Service #243's release hold also remains a dependency; do not merge #524 until the service contract is integrated and its release gate is cleared. |

These checks establish source and fixture regressions only. They do not establish a deployed wallet, live transaction outcome, car/plot/home ownership, or the complete visible arrival journey.
