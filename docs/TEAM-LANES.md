# CityLife — Team lanes + way of work

CityLife is built by three coding lanes on one repo, on protected `main` (PRs + review only). This
doc is the in-repo source of truth for who owns what, how the lanes avoid collisions, the cadence
they run on, and how work gets reviewed and merged. The active phase plan is
[PHASE-1-street-rod.md](PHASE-1-street-rod.md); the north-star is [EPIC-street-rod.md](EPIC-street-rod.md).

## The three lanes

| Lane                   | Owns                                                                                                                                             | Key files                                                                                                                                                  | Dev port |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Car / Garage spine** | cars, garage, tune/paint, the parked car, the rally walk + presence, the seeded meetup friend, the one-button meetup flow, racing                | `src/colony/car/*`, `src/colony/bot/carPartMarket.ts`, `src/colony/ui/GaragePanel.tsx`, the rally/car block in `src/colony/runtime.ts`                     | 5191     |
| **Player & UI**        | first-person / mobile / camera / controls, in-world characters + avatars, nameplates, the social read, the Kookerbook UI + in-browser navigation | `src/colony/ui/FirstPersonPanel.tsx`, `ColonyApp.tsx`, `colony.css`, the nameplate path in `render/PlanetRenderer.ts`, `src/colony/bot/firstPersonView.ts` | —        |
| **World & Build**      | the artifact/world model, houses/buildings, plots + landscaping, world-prop dressing, the catalog, the Kookerbook commerce surface               | `src/colony/render/venueProps.ts`, `artifacts.ts`, `artifactSchema.ts`, `commerce/businesses.ts`, `src/colony/social/*`                                    | —        |

Each lane stays strictly in its own files. Collisions have happened (the road-grading clash between
the car lane and a world-lane edit), so the boundaries are hard rules, not guidelines.

## The two seams

The lanes only touch at two read-only / additive seams (full contracts in
[PHASE-1-street-rod.md](PHASE-1-street-rod.md)):

1. **Rally point + presence.** The car lane PRODUCES the rally, the walk-to-rally, the presence
   count, the seeded friend, and the `uiState.rally` read-model. The only shared change is additively
   widening `uiState.rally` with the present citizens' identities. Player & UI CONSUMES it read-only
   for nameplates + a who-is-here panel; World & Build dresses props AROUND the rally structure.
   Nobody but the car lane edits the proximity logic.
2. **Classifieds / Kookerbook.** Each lane owns its listing model (car parts vs furniture); the
   World & Build lane owns the unified Kookerbook surface that reads both models read-only and never
   edits a producer. The real-ledger mirror is coordination-gated and out of the current phase.

## Cadence — budget-safe, task-driven

Running the bots on 24/7 every-20-minute crons once burned about a week of inference in 1-2 days.
That pattern is retired. The lanes now run on a conservative, fixed-schedule, hard-capped cadence:

| Lane          | Roughly             | Per fire                                                                                                                      |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lead          | 08:00 + 14:00 daily | advance the car spine by one slice, feed the other lanes, review + merge via the review gate, keep the knowledge base current |
| Player & UI   | 09:00 + 15:00 daily | at most one bounded slice                                                                                                     |
| World & Build | 10:00 + 16:00 daily | at most one bounded slice                                                                                                     |

Each fire: do the lead's fed phase-1 task if present (from the phase doc), otherwise dry-fall-back to
one lean in-lane slice. One bounded slice per fire, a hard cap of two fires/day, a fresh bounded
session each time. Lower-spend alternatives: one fire/day per lane (lean), or zero standing crons and
assign on demand (minimal). The lead can re-aim a lane between fires.

## Review + merge flow

`main` is protected; no lane self-merges. The author opens a rolling PR per slice and stops; the lead
reviews the diff + CI; if happy, the review-and-approve gate approves; the lead merges; the deploy
monitor watches the release roll out. A slice is not done until its docs are updated (below) and CI
is green.

## Branch + PR discipline (rolling PR per slice)

Before coding each fire, check your own open PRs. If one exists for the active slice, extend it (new
commit, push) — the rolling PR updates. Open a new branch + PR only when the current slice has merged
or you are starting a genuinely different slice. One rolling branch + PR per active slice; never two
open PRs touching the same files.

## Documentation discipline (always-documented)

Every PR updates the knowledge base in the same PR that ships the code — a change is not done until
the docs reflect it. New system → a numbered spec under `docs/specs/`; changed behavior → edit the
owning doc; a decision → write the why; an open question or blocker → record it in the doc. Reviewers
treat a missing doc update like a missing test. Full rule in [../AGENTS.md](../AGENTS.md); the
knowledge-base map is [README.md](README.md).

## Hard rules (every lane)

- **Determinism** — no `Math.random` / `Date.now` in the sim/tick. (Render-loop cosmetics that use
  `Math.random` are the exception to design around, not to copy.)
- **isPublicSafe** — every player-authored or displayed string is screened.
- **Night emissive floor** — every new lit mesh, nameplate, or UI element carries an emissive floor
  so it does not go black at night; verify changes at low light, never only at noon.
- **Protected main + small tested PRs** — PR-only, one bounded slice per fire, every commit
  tsc-clean and suite-green.
- **CI-safe commit messages** — no double quotes, brackets, angle brackets, apostrophes, or
  colon-bullet lines in the body (CI shell-interpolates the head commit message); write the body to a
  temp file and `git commit -F` it.
- **Public repository safety** — never commit secrets, tokens, private namespaces, internal
  hostnames, preview URLs, or operator state. Identities are fictional and screened.
- **Stay in your lane** — the two seams above are the only cross-lane contact points, both read-only
  / additive.
