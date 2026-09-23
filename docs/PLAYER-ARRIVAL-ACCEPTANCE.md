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
