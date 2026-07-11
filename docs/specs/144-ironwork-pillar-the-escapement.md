# Spec 144 — The Ironwork Pillar: a wheel over the works, turned one held tooth at a time

- status: proposed
- proposed-by: **Hennerik Vos, clocksmith and night gauge-reader at the Watch Nook (Landing One)** — a new citizen voice from the colony's small security-and-vigilance world (059). Where Mara Venn gave the colony aspiration (033), Hennerik gives it something quieter: the first monument to the _unseen work_ that keeps a world true — and to the Wizard beyond the dark who minds his own town the same way.
- date: 2026-07-10
- depends-on: 001 (materials + labour construction), 053 (founding calendar — the Retune uses its once-per-boundary accounting idiom), 049 (the neutral-when-absent payoff discipline), 059 (the Watch Nook — Hennerik's post). Placement is bound by the road-setback invariant (114) and the roads-never-over-water guard (115).

## Why (the citizens' case)

Hennerik Vos: _"I keep the small clocks; someone keeps the big one. At midnight I hear the world get trued — a floor settles flush, a road remembers its line, and by morning nobody says thank you because nobody knows. Build the pillar over the works. Grate the pit so the light shows and the machine doesn't. Put a wheel in the iron and TWO hands on the wheel — one of ours, one of the Wizard's who minds his own town beyond the dark the same way, gated and held. Let the children watch it pass one tooth at a time and learn the only thing worth learning here: this place isn't magic. It's minded. Nothing moves unheld."_

## Mechanic

- The **Ironwork Pillar** is the colony's second grand staged monument — smaller than the Spire, stranger, and the first built to the Visual Artifact Standard from its first stage. It is called **"The Wizard's Gift"** in the ledgers, and it is built in **three stages**, each a bundle of materials + goods + treasury and a reserved crew over a long build:
  1. **Undercroft Collar** — the riveted curb, the grate, and the warm machine-light beneath it (plus the old half-buried iron fragments the diggers turn up — the works are older than Landing One).
  2. **Iron Frame** — the three stepped see-through tiers, the two frozen mid-lift gantry arms, and the brass escapement ring with its two maker-marked pallet hands. The tower silhouette appears.
  3. **Lantern Crown** — the held-not-seated lantern cage, the sky iris, and the corner light seams. The midnight Retune begins.
- **Stage 0 is nothing**: no geometry, no cost, no reserved plot works — the founding economy and every existing test are byte-identical. The colony funds the **next stage only when it can afford the bundle AND spare the crew** (the Spire's opt-in gate, 033), so a struggling colony never starts it.
- **The Midnight Retune (stage 3 standing):** every sim-midnight, from 00:00 to 01:00, the mechanism free-runs while the town is quietly trued — a founding-calendar event (053) the whole colony can set its life by. The escapement's resting tooth is a **pure function of the sim day + hour**; the sim sees only deterministic snaps at the hour boundaries. All smooth motion is presentation-only.
- **The lasting payoff (permanent, deliberately small and flavourful):**
  - a **standing nightly unrest relief** — the colony sleeps easier under a minded world (like a standing Ward Post, smaller than the Spire's),
  - each night's Retune **slightly deepens that night's rest** — a small once-per-night unrest easing at the 00:00 boundary, in the Founders' Day idiom (053).
  - **No market, wage or immigration coupling.** The Pillar is a clock and a promise, not an engine.

## Rules & data

- The Pillar tracks a **stage** (0..3) and the **progress** of the current stage, mirroring the Spire exactly: `pillarStage`, `pillarProgress`, `pillarBuilding` on `ColonyState` (beside `spireStage` at sim.ts:414), reset in `initBuild` (build.ts:260), crew reserved while building (build.ts:3244), stepped by a `pillarStep` beside `spireStep` (called from the build pass at build.ts:6490).
- **Stage gates** (config knobs beside the Spire's at config.ts:422): `pillarStageCount: 3`, `pillarStageCrew: 5`, `pillarStageBuildHours: 36`, `pillarStartColonists: 22`, `pillarSurplusMargin: 2`, `pillarTreasuryMargin: 4000`. Suggested bundles (mapped to existing goods, smaller than the Spire's):
  - Undercroft Collar: ~90 materials + ~40 components + treasury ~600.
  - Iron Frame: ~140 components + ~40 linen + ~30 reels + treasury ~1200 (the brass wheel is the reel-founders' finest casting).
  - Lantern Crown: ~80 components + ~40 reels + ~20 linen + treasury ~1500.
- **Payoff knobs:** `pillarUnrestReliefPerDay: 0.06` (permanent, stage 3; applied in the daily pass beside the Spire's at build.ts:4213) and `retuneNightRelief: 0.02` applied **once per sim-day** at the 00:00 boundary, guarded by a `lastRetuneDay` field in the 053 `lastFoundersYear` idiom. Both are relief-only — they can never harm anything.
- **Determinism (load-bearing):** the escapement's **resting tooth index** and the undercroft's shadow-bar phase are **pure functions of the sim clock** via the `hashCell(x, y, salt)` idiom (shoreProps.ts:335) — e.g. `restingToothIndex(day, hour) = (hour * 7 + floor(hashCell(day, 0, salt) * 12)) % 12` (stride 7 is coprime with 12, so the ring visits all twelve states over any twelve hours; the hashCell term gives each day its own phase). v1 **snaps** at 00:00 with one seam pulse — constitution-pure and snap-testable. The smooth 00:00–01:00 free-run is a `performance.now()` presentation bonus that must land exactly on `restingToothIndex(day, 1)` at 01:00. **No `Math.random`, no `Date.now` anywhere the sim reads.**
- **Placement:** a free-standing **3x3-cell buildable on-land plot** chosen deterministically at founding by a `findIronworkPillarSite` beside `findRallyOverlookSite` (sim.ts:477) — near the landing block, modest slope, deterministic score tie-break (then lowest y, then lowest x). The plot + a one-cell halo are reserved in `occupied` so the road-setback invariant (114) holds by construction; the site never touches water (115); a spur `path` connects an approach node on the road graph to the plot edge (the rally-spur idiom). The plot is flattened to slope with **pitch only — roll locked to 0** (V3 Constitution, Article I.3). The Pillar **does not straddle a road**.
- **Render contract:** a dedicated `src/colony/render/ironworkPillarProps.ts` layer (`{ group, update(daylight, timeMs, clock), dispose }`, the shoreProps/venueProps contract), one merged vertex-coloured static geometry + ~13 kept-ref dynamic meshes, geometry emitted **per stage** and rebuilt on stage change (the spec-084 named-mesh rebuild pattern) so the silhouette grows 1 → 3. Night-readable per the VISUAL-STANDARD day-night rule; **animation is a bonus, never required** — the monument reads fully with all motion frozen.
- Expose `pillar` in the runtime `uiState` (stage, progress, building, retuneTonight) and a Game API method to **fund the next stage** (beside `fundSpireStage`, runtime.ts:3824), so stage advance and completion are drivable deterministically for tests.

## Cost — materials & labour

- To BUILD: the three-stage bundle above — spent stage by stage, each reserving a 5-hand crew for ~36 sim-hours. Meant to be **slow, deliberate, and watched**: half the point is the colony seeing the wheel arrive before it ever ticks.
- To RUN: nothing. The Pillar is a finished monument, not a staffed service; its payoff is permanent and its Retune is free. While building, each stage ties up its crew like any great work.

## Acceptance

- `npm run typecheck` clean, `npm test` fully green. With `pillarStage` 0 and nothing funded, the founding economy and **all existing tests are byte-identical**. New Vitest coverage:
  1. **Purity:** `restingToothIndex(day, hour)` is deterministic (same inputs, same tooth), lands in `[0, 12)`, and cycles through **all twelve states** across any twelve consecutive hours of a fixed day; the shadow-bar phase function likewise.
  2. **Stage advance:** funding a stage consumes exactly its bundle and reserves the crew; stage count rises 0 → 3; a colony below the gates never starts it.
  3. **Inert:** stage 0 changes nothing — no relief, no calendar event.
  4. **Payoff persists:** at stage 3, the standing nightly relief applies each day and the Retune relief fires **once** per 00:00 boundary (never repeatedly), forever after.
- Playwright, per the VISUAL-STANDARD **"renders on :5188 or it is not done"** rule: a screenshot at **stage 3 in daylight** (iron tiers, brass ring, both maker-marked pallets, frozen hooks, buried fragments) and a screenshot during a **forced sim-midnight Retune** (set the sim clock to 00:30: iris open, undercroft glow risen, seam pulse) — both from the live game.
- HUD shows the Pillar's stage and progress (e.g. "Ironwork Pillar — Stage 2/3, 40%") beside the Spire's row, and at stage 3 a small calendar note that the Retune comes at 00:00.
