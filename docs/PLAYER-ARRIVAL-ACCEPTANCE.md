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
