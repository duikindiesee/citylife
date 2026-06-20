# Spec 050 — Household Births: a colony that can grow its own

- status: built — slice 45, shipped to mechanics/dev. birthStep, birthStability, birthableHomes and birthStatus live in src/colony/build.ts; the dependent ration cost folds into the food eat-down. The children state field is in sim.ts, knobs in config.ts, the births uiState in runtime.ts, a HUD Children row in ColonyApp.tsx, and five tests in tests/economy.test.ts. Built as the small core (pool + accrual + dependent food cost + maturation-on-vacancy + neglect drain); the clinic-care need and schoolroom-capacity maturity gate were deferred as the spec allowed. Inert by default — no mid-tier home and no children means the step early-returns, the pool stays zero and the food draw is unchanged, so all 338 prior tests passed UNCHANGED (zero regression on population/food). typecheck clean and all 343 tests pass; live on :5188 a tier-2 home read as growing and accrued children, the HUD Children row rendered, and a colony with no mid-tier home stayed inert. No building, no materials, no staff.
- proposed-by: Mara Venn, cradle-nurse (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 006 (housing evolution / tiers), 004 (population), 008 (ration delivery), 049 (the stability signals). Soft: 009 (clinic), 042 (schoolroom).

## Why (the citizens' case)

Mara Venn has nursed the cradles since Landing One was three decks and a mooring line, and she has watched the whole colony depend on one thing: strangers stepping off skybridges. Every soul here is a newcomer. That is a thin way to live — the moment the colony's name sours and Settler Confidence (049) dips, the skyships thin out and growth simply stops. A real colony grows its own. Give a household a stable home, full rations, clean water and a calm deck, and in time it raises a child. Slow, costly, and entirely earned — but it means Landing One is no longer hostage to its reputation abroad. The cradle is the one form of growth no border can close.

## Mechanic

- The colony carries a small **children** pool (dependents being raised). It starts at 0 and only grows under good conditions.
- **Births:** a home that is **mid-tier or better (tier >= 2)**, **watered**, **fed** (provisioned by delivery), and on a **calm deck** (colony unrest low) slowly adds to the children pool. Tier-1 shacks and homes that are missing a service do **not** breed — survival comes before family.
- **Dependents cost:** each child consumes **half a colonist's food and water** and provides **no labour**. They are mouths before they are hands. (This load only exists once children do — inert until the first birth.)
- **Maturation:** while the colony keeps a **housing vacancy** (room to live) and conditions hold, children mature into **free colonists** at a slow rate, filling vacancies exactly as an immigrant would. Maturity may also be gated on **schoolroom room** (042) as a soft refinement.
- **Neglect:** if the homes go unfed, unwatered, or the decks turn disorderly, the children pool **drains** (families stop raising, or leave) rather than maturing — growth you do not sustain is growth you lose.
- **Inert by default (load-bearing):** with **no tier-2+ home under good conditions**, there are **no births**, the children pool stays 0, and nothing changes — so a young colony, a tier-1 colony, and the existing tests are all unaffected. Births are a slow accrual measured in colony-months, so short runs never trip them.

## Rules & data

- New colony stock **`children`** (dependents), clamped `[0, childrenCap]`. Suggested cap scales with the workforce: `childrenCap = colonists * childrenMaxFraction` (suggest **0.5**) so dependents never dwarf the hands that feed them.
- **Birth accrual** (per in-game day): for each qualifying home (tier >= 2, watered, provisioned, colony unrest below a calm threshold), add `birthRatePerHomePerDay` (suggest **0.02** — about one child per home per ~50 days). Scale the whole accrual by a colony-wide stability factor (reuse the Settler Confidence inputs so an unhealthy colony breeds slower).
- **Dependent consumption:** food and water draw gains `children * childDependentLoad` (suggest **0.5**) colonist-equivalents. Fold into the existing food eat-down (007) and water draw (046); only nonzero once children exist.
- **Maturation** (per in-game day): if `colonists < housingCapacity`, move `min(children, children * childMatureFraction)` (suggest **childMatureFraction = 0.025/day**, ~40 days to grow up) from `children` into `colonists`, never exceeding capacity. No vacancy → maturation pauses (the young wait for a home), it does not vanish.
- **Neglect drain** (per in-game day): if the colony is unfed, unwatered, or unrest is above the calm threshold, drain the pool by `childNeglectDrainPerDay` (suggest **0.05 × children**) instead of maturing.
- Expose `children` (and a simple growth state) for the HUD.
- **Keep it small:** the core is the children pool + accrual + dependent cost + maturation-on-vacancy + neglect drain. The **clinic-care** need and the **schoolroom-capacity** maturity gate are explicitly optional refinements the Review & Build routine may defer to keep this one slice small.

## Cost — materials & labour

- **No building. No materials, no components, no staff.** Household Births is a **rule on the existing population + housing systems**.
- The real cost is **ongoing and steep**: every child is half a colonist's worth of food and water for ~40 days before it returns a single hour of labour, it needs the homes kept at mid-tier and fully serviced the whole time, and neglect throws the investment away. Growth from the cradle is the most expensive growth there is — paid in rations, water, and patience — which is exactly why it only happens when Landing One is genuinely thriving.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green. Because this touches population + food/water, the **whole existing suite must still pass** — calibrate so a tier-1 or minimal colony reads zero births and the food/water draw is unchanged until a child exists. New tests covering:
  1. **Inert:** a colony with only tier-1 homes (or no homes) produces no children over a long run; `children` stays 0 and food/water consumption is unchanged.
  2. **Births under good conditions:** a fed, watered, calm, tier-2+ home grows the children pool over many days.
  3. **Dependents cost:** with children present, food and water draw is measurably higher than the same colony with none.
  4. **Maturation fills vacancies:** with housing room and sustained good conditions, children mature into colonists over time; with housing full, the pool holds and waits.
  5. **Neglect drains:** cut the rations or spike unrest and confirm the children pool drains instead of maturing.
- On the live game (:5188): grow a prosperous tier-2+ district and watch a **Children** HUD readout rise, then mature into colonists as beds open; wreck the rations and watch the pool fall.
