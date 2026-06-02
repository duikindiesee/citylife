# Spec 055 — The Long Ledger: a life has a span, and the colony renews
- status: built — slice 50, shipped to mechanics/dev. ledgerStep settles the Long Ledger on each calendar year-turn (053); careFactor softens passings by health/water/food/order; ledgerStatus feeds the HUD; the year's renewal (arrivals + births) is accumulated per step in stepBuild before the Ledger reads it. The four ledger state fields (lastLedgerYear, renewalThisYear, renewalLastYear, lastPassings) are in sim.ts, knobs in config.ts, the ledger uiState in runtime.ts, a Long Ledger HUD row in ColonyApp.tsx, an optional Hall of Names building with an auto-build gate, and five tests in tests/economy.test.ts. The three safety invariants hold every year-turn: passings never exceed half the previous year's renewal, never exceed maxPassFraction of the population, and never drop colonists below COLONY.seed.colonists — so a renewing colony always nets positive. Inert below the onset span (naturalSpanYears = 60): natural passings are exactly zero, so all 364 prior tests passed UNCHANGED. typecheck clean and all 369 tests pass; live on :5188 a young colony was inert and an old colony past the span settled a gentle turnover (a fraction of a colonist) at the year-turn, the HUD Long Ledger row rendering its status. The aggregate model (colony-age-gated turnover) is the cradle-end counterpart to births (050); a cohort/mean-age refinement is a future option.
- proposed-by: Mara Vell, Memory-Keeper of Landing One (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 053 (the Founding Calendar — provides the years and the year-turn), 050 (household births), 004 (population), 009 (clinic / health for the care factor).

## Why (the citizens' case)
Mara Vell keeps the names now, and the ledger has a hole in it that has troubled her since the calendar gave us real years: no one in Landing One ever grows old. Colonists are born, they arrive on the skybridges, some pack up and leave — but no life ever quietly reaches its end. There are no elders, no span to a life, no generation handing the decks to the next. A colony that never loses its old also never truly renews; it is a present tense with no memory and no turning of the years. Now that the years are real, the loop should close: people should live a long, full span, and only at the very end pass on — so that births and newcomers are not just growth, but renewal, and so that the colony learns to remember its own. The cradle (050) and the Long Ledger are the two ends of one life.

## Mechanic
- The colony's people have a **generational span**: for a long time — the founding generation's whole working life — there are **no natural passings at all**. Only once the colony has been settled for many years does a **gentle, natural turnover** begin, as the first generation reaches the end of a long life.
- Each year-turn (the calendar's year boundary, 053), once the colony is old enough, a **small fraction** of colonists pass on naturally. The rate is **softened by good care** — health and clinics (009), water (046), food (008), morale/order (028), and housing tier (006): a well-kept colony's people live longer, a neglected one's pass sooner.
- **It can never spiral the colony down (load-bearing):** natural passings in a year are **hard-capped to at most half of the previous year's births + arrivals**, and the population can **never fall below the founding crew**. A healthy colony always renews faster than it ages, so the Long Ledger is turnover, never collapse — exactly the safety Mara asked for.
- A **Hall of Names**, built and staffed, keeps the Long Ledger: it records the colony's elders and its passings, and after a year that takes someone it gives a small **morale comfort** — remembrance eases grief. The Hall is the civic face of the mechanic; it surfaces the readout and turns loss into memory.
- **Inert by default (load-bearing):** until the colony has been settled past the long onset span, natural passings are **exactly zero** — so a young colony, and every test (none of which runs the colony through generations), sees population behave precisely as today. The mechanic only ever wakes in a long-lived, mature colony.

## Rules & data
- **Onset:** no natural passings until the colony's age (years since founding, from 053's clock) reaches `naturalSpanYears` (suggest **60** — the founding generation living a long span). Below this, the yearly passing count is 0.
- **Yearly natural passings** (computed on the year-turn, once past onset):
  - base `passings = colonists * naturalPassRate` with `naturalPassRate` small (suggest **0.015**, ~1.5%/yr), ramping **gently** higher the further the colony is past onset (an older colony has more elders).
  - multiplied by a **care factor** in `[carePassFloor, 1]` (suggest floor **0.4**): a blend of health (009), watered (046), provisioned (008), order `1 - unrest` (028) and mean housing tier (006). Well cared for → fewer passings (toward the floor); neglected → the full rate.
- **Caps and floor (must all hold):**
  - `passings <= renewalCapFraction * (births + immigrants in the last year)` with `renewalCapFraction` = **0.5** — passings never exceed half the colony's renewal, so net population change stays positive whenever the colony is renewing. (Track the last year's births + arrivals across the year boundary.)
  - `passings <= maxPassFraction * colonists` (suggest **0.03**) — a belt-and-braces ceiling.
  - `colonists - passings >= COLONY.seed.colonists` — the founding crew always remains; the colony can never be emptied.
- Apply the passings to `state.colonists` on the year-turn. (Aggregate model: no per-colonist ages are tracked; this is the population's generational turnover, the cradle-end counterpart to births. A later spec may refine to a cohort/mean-age model.)
- **Hall of Names** building (`hallofnames`): staffed civic remembrance room, **2 attendants**, a small power load. When it stands and a year takes someone, ease unrest by a small `remembranceRelief` (the colony mourns and carries on). Expose the colony's age, the elders/turnover readout, and the last year's passings for the HUD.

## Cost — materials & labour
- **The Long Ledger rule itself: no building, no cost** — it rides on the calendar the colony already keeps (053). Passing is a fact of a long life, not a thing the colony buys.
- **The Hall of Names** (optional but wanted): build for a modest **materials + components** cost (Mara's timber, stone and glass), staffed by **2 free colonists** (the attendants). It earns its keep in **remembrance**: the morale comfort after a loss, the record of the colony's elders, and the HUD readout. Without it, people still pass — the colony simply keeps no names and gets no comfort.
- The deeper, intended cost is **renewal**: once the years are long enough to take the founders, the colony must keep **births (050) and immigration (049)** flowing to replace them. The Long Ledger turns growth into the duty of every generation to raise and welcome the next.

## Acceptance
How Review & Build verifies it:
- `npm run typecheck` clean and `npm test` fully green. The mechanic must be **inert below the onset span** — population is unchanged, so every current test still passes. New tests covering:
  1. **Inert:** a colony younger than `naturalSpanYears` has **zero** natural passings across a year-turn; `colonists` is unchanged.
  2. **Turnover past onset:** an old colony (age ≥ onset) loses a small number of colonists on the year-turn.
  3. **Care softens it:** the same old colony loses **fewer** people when well cared for (health/water/food/order high) than when neglected.
  4. **Capped by renewal + floor:** passings never exceed half the last year's births+arrivals, never exceed `maxPassFraction`, and never drop `colonists` below `COLONY.seed.colonists`.
  5. **Hall comfort:** with a staffed Hall of Names, a year with passings eases unrest by `remembranceRelief`; with no Hall, passings still occur but give no comfort.
- On the live game (:5188): age a colony past the onset and watch a small, gentle turnover at the year-turn, a **Hall of Names** readout record the colony's elders, and a healthy colony's births + arrivals keep the net population rising despite it.
