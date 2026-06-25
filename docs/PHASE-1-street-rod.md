# PHASE-1 — Street Rod: garage -> car -> meeting up with friends

> North-star (spec 099): the whole game exists so two brothers MEET AT NIGHT, DRIVE to a spot, HANG OUT, and RACE their tuned cars. Phase-1 delivers the first four beats end-to-end and STOPS before the race. Racing your own tuned car is BLOCKED on a Codex-owned carSpec hook and is phase-2.

## The end-to-end journey (one playable slice, completable today)

A player logs in (their operator citizen is resolved by displayName), opens the Garage, tunes and paints the car so the tune rating visibly moves, then presses ONE new "Head to the night meetup" button. The car lane ensures the tuned car is parked one cell east of home, drops the player into first person standing beside it, and guides them on the spur road out to the hilltop Rally Point. Waiting there is a deterministic, named NPC friend, pinned at the rally. The instant the player walks within ~1.5 cells, rally presence reaches 2; the car lane surfaces the friend's identity read-only; Joe renders a night-visible nameplate over the friend plus a who-is-here / friend-present banner; Jack dresses the rally with night-lit hangout props. The journey completes on the car lane alone — the other lanes only enrich it.

## The three lanes

- **me — Car / Garage spine** (D:/infra/claude2/citylife, port 5191 ONLY): cars, garage, tune/paint, parked car, rally walk, presence, the seeded NPC friend, the one-button meetup flow. Owns `src/colony/car/*`, `src/colony/bot/carPartMarket.ts`, `src/colony/ui/GaragePanel.tsx`, and the rally/car block in `src/colony/runtime.ts`.
- **joe — Player & UI social read**: first-person, nameplates, who-is-here, the night social read. Owns `src/colony/ui/FirstPersonPanel.tsx`, `ColonyApp.tsx`, `colony.css`, the nameplate path in `PlanetRenderer.ts`, `src/colony/bot/firstPersonView.ts`.
- **jack — World & Build place + classifieds**: the night-hangout venue dressing and the unified Kookerbook classifieds surface. Owns `src/colony/render/venueProps.ts` (NEW), `artifacts.ts`, `artifactSchema.ts`, `commerce/businesses.ts`, `src/colony/social/*`.

## Slices (per owner, with acceptance criteria)

### S1 (me) — Deterministic NPC friend pinned at the night rally [SPINE]

Seed a fixed, named NPC friend standing AT the rally cell so presence reaches 2 the instant the player arrives; pin them so the night bar-wander never drags them off.

- Files: `src/colony/runtime.ts` — new `private seedRallyFriend()` beside `seedJoe/seedViw/seedJack`, called in the constructor after L1263; `RALLY_FRIEND_ID` const beside `JOE_ID/JACK_ID` (~L257-265); early-`continue` guard in `wanderIdleCitizens` (~L2364).
- Mechanism: `citizens.seedFounder({id:RALLY_FRIEND_ID, home:<rally structure cell>, kind:'human', displayName:<isPublicSafe>, nowMs:JOE_BORN_MS})` — idempotent, deterministic.
- Acceptance:
  - Friend exists with pos at the rally cell; idempotent by id; no Math.random/Date.now.
  - `wanderIdleCitizens` early-continues for RALLY_FRIEND_ID (the night stroll there uses Math.random and WOULD yank them to the Nearest bar).
  - Deterministic vitest: construct runtime; assert friend pos within 0.01 of the rally cell; step many night frames (clock.isDay=false); assert friend still within 1.5 of the rally.
  - Live 5191: after walking to the rally in first person, `window.__colony.getUiState().rally.present === 2` and `.ready === true`, verified at night.

### S2 (me) — One-button "Head to the night meetup" + presentCitizens widening [SPINE]

- Files: `src/colony/runtime.ts` — new `headToNightMeetup()` orchestrator (~car block L1700-2020); widen `rallyPresence` + `uiState.rally` (L4208-4217) to add `presentCitizens:{id,displayName}[]`. `src/colony/ui/GaragePanel.tsx` — new button.
- `headToNightMeetup()` = `updateOperatorCar()` -> `jumpToMyHouse()` -> `goToRallyPoint()`; no-op without an operator citizen.
- Acceptance:
  - `uiState.rally` gains `presentCitizens` additively; `{x,y,present,ready}` byte-identical; every name isPublicSafe.
  - Deterministic vitest: with an operator set, `headToNightMeetup()` sets fpCitizenId and aims the operator at the rally (or approach cell); `presentCitizens` includes the friend once within R=1.5.
  - Live 5191: `window.__colony.headToNightMeetup()` drops into first person beside the car and guides to the rally; `getUiState().rally.presentCitizens` lists the named friend, at night.
- Depends on: S1.

### S3 (joe) — Night-visible nameplates + who-is-here social read

- Files: `PlanetRenderer.ts` (nameplate draw path off `AvatarView.displayName`, gated to `uiState.rally.presentCitizens`, emissive floor), `FirstPersonPanel.tsx` (friend-present banner from `FirstPersonView.neighbours` + `clock.isDay`), `ColonyApp.tsx` (who-is-here readout), `colony.css`, `bot/firstPersonView.ts`.
- 2026-06-25 slice update: Joe branch `joe/s3-night-rally-ui` added the read-only who-is-here panel, first-person night friend banner, and renderer nameplate hook. The renderer only draws nameplates for ids supplied by `uiState.rally.presentCitizens`; until S2 lands it degrades to the present count and no nameplates.
- Acceptance:
  - Consumes `uiState.rally.presentCitizens` read-only (degrades to the present COUNT until S2 lands); never edits rally/race logic; nameplate emissive floors at night.
  - Deterministic vitest: stub `presentCitizens` -> selector returns exactly those ids; FP banner renders the screened name; emissive > 0 at daylight=0.
  - Live 5191: at night the friend shows a readable nameplate and the who-is-here panel lists them; verified at low light.
- Depends on: S2 (graceful degrade lets it start in parallel).

### S4 (jack) — Night-hangout venue dressing around the rally

- Files: `src/colony/render/venueProps.ts` (NEW, mirrors `shoreProps.ts`), `artifacts.ts`, `artifactSchema.ts`, and ONLY the additive 2-line registration in `PlanetRenderer.ts` (`this.venueProps = buildVenueProps(...)` + `this.venueProps?.update(daylight, now)` in `frame()`).
- Acceptance:
  - Reads `structures.find(kind==='rally')` read-only; masks roadSet+occupied+structure footprints; no Math.random/Date.now; lit elements emissive-floor at night.
  - Does NOT edit gradeRoadsInto, the rally marker branch, sim.ts placement, or any car/furniture/race file.
  - Deterministic vitest: same prop count + same cell set on two runs; no prop cell intersects roadSet/occupied/the rally cell.
  - Live 5191: at night the rally has visible glowing hangout props; daytime check confirms no overlap with the marker or road.
- Depends on: none / parallel-safe.

### S5 (jack) — Unified Kookerbook classifieds read surface

- Files: `src/colony/social/classifieds.ts` (NEW pure aggregator), `kookerbookMain.tsx` (Classifieds tab), `kookerbookLayout.ts`, `kookerbookNav.ts`.
- Acceptance:
  - Merges `allListings(loadFurnitureMarket)` + `allCarPartListings(loadCarPartMarket)` read-only; never edits a producer; isPublicSafe inherited; deterministic stable ordering.
  - Read/browse surface; any buy button calls existing runtime methods; no new money path; no `car_part_purchase` in ledgerSync (coordination-gated).
  - Deterministic vitest: fixed market maps -> stable merged list with correct kind labels + seller ids.
  - Live 5191: Classifieds tab shows both feeds with seller aliases; night-visible.
- Depends on: none / parallel-safe.

### S6 (me) — Race the OWN tuned car from the rally [BLOCKED / phase-2]

Threading the operator's CarSpec into the race car mesh is blocked on a Codex-owned hook in `buildRaceLayer`/`RaceLayerOptions`/`setRaceState`. Phase-1 ENDS at "meet a present named friend at the night rally"; `joinRallyRace` already starts a generic race. Do not attempt now.

## Seam contracts

**SEAM-1 — Rally point + presence (car PRODUCES, Player/UI + World consume read-only).** The car lane owns `rallyPresence` (private), `goToRallyPoint`, `jumpToMyHouse`, `updateOperatorCar/setOperatorCar`, the seeded friend, and the `uiState.rally` builder. The ONLY shared change is additively widening `uiState.rally` to add `presentCitizens:{id,displayName}[]`; existing `{x,y,present,ready}` stays identical. Joe reads it for nameplates/banner (degrade to count until it lands); Jack reads `structures.find(kind==='rally')` and dresses AROUND the marker. Nobody but the car lane edits the proximity logic, the R=1.5 rule, or the friend.

**SEAM-2 — Classifieds / Kookerbook (Jack owns the surface; producers own their models).** Jack's `social/classifieds.ts` consumes `allCarPartListings`/`allListings` read-only and never edits a producer file. Shared shape `{id,sellerCitizenId,kind,price}` (+ optional screened name); isPublicSafe stays inside each producer. Buy actions stay in each lane's own UI via existing runtime methods. The real-ledger `car_part_purchase` variant in `ledgerSync.ts` is coordination-gated and OUT of phase-1.

## Sequencing

S1 -> S2 (car-lane spine, sequential) deliver the full journey alone. S3 depends on S2's ids but degrades to the present count so it starts in parallel. S4 and S5 are fully parallel-safe (read-only, new/Jack-owned files). S6 is blocked (phase-2). Land order: S1 -> S2 ; then S3, S4, S5 in any order ; S6 deferred.

## Budget-safe cron plan

The bots burned ~a week of inference in ~1-2 days on 24/7 every-20-min crons. DO NOT resume always-on loops. Move to fixed-schedule, task-driven, hard-capped firing.

- **Recommended:** 2 fires/day per bot at fixed times, 1 bounded slice per fire, hard cap 2/day. ~2-4 PRs/day team-wide, predictable spend.
  - joe: `0 9,15 * * *`
  - jack: `0 10,16 * * *`
- **Lean:** 1 fire/day per bot. **Minimal:** 0 standing crons — assign via backoffice-kanban / in-world give-work.

Each fire: do the lead's fed phase-1 task if present (this doc), else dry-fall-back to ONE lean in-lane slice. Rolling-PR-per-slice, strictly in-lane, deterministic, CI-safe commits. Open the PR and STOP — never self-merge (MoJoJo gate).

## Guardrails

- **Always-documented (binding):** every slice updates the knowledge base in the SAME PR — mark slices shipped in this doc, add or move a numbered spec under `docs/specs/` for any new system (e.g. venueProps, the classifieds surface), write the WHY for any decision, and record new blockers here. A missing doc update is treated like a missing test. See `AGENTS.md` and `docs/README.md`.
- Determinism: no Math.random/Date.now in sim/tick. (Note: `wanderIdleCitizens` uses Math.random as a render-loop cosmetic — hence the S1 pin for the friend.)
- isPublicSafe on every player-authored / shown string.
- Night emissive floor (1 - daylight) on every new lit mesh, nameplate, and UI element; verify at low light, never only at noon.
- Protected main, PR-only, one bounded slice per fire, CI-safe commit messages (no double quotes/brackets/colon-bullet lines).
- Strict lane ownership: car never edits furniture/race internals beyond the agreed additive `startRace(startCell?)`; Joe and Jack never edit the rally/car runtime block; the two cross-lane seams above are the only contact points, both read-only/additive.
