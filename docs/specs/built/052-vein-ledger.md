# Spec 052 — The Vein Ledger: ore runs out, so the colony must spread its diggings

- status: built — slice 47, shipped to mechanics/dev. veinFactor (the band multiplier) and veinStatus live in src/colony/build.ts; produceMaterials folds veinFactor into each mine's output and spends the vein of staffed, producing mines, while a freshly built mine starts on a full vein (set at construction completion). The vein is a per-building field on ColonyBuilding (vein?: number) — no new colony state — knobs in config.ts, the veins uiState in runtime.ts, an Ore veins HUD row in ColonyApp.tsx, and five tests in tests/economy.test.ts. Inert by default — a fresh or unrecorded vein reads at full output, and a fresh mine holds 100 percent until half its 12-month vein is dug, so all 349 prior tests passed UNCHANGED (zero regression on the materials economy). The 0.25 floor means an exhausted pit still trickles, never zero. typecheck clean and all 354 tests pass; live on :5188 a colony with no mines is inert, a 30 percent vein read 60 percent output and a near-exhausted one read the 25 percent floor, and the Ore veins HUD row showed the poorest pit. No new building, materials or labour — it pairs with the Survey Camp (051) to make ore a reason to claim new ground and sink fresh shafts.
- proposed-by: Mara Flint-Eye, pit-boss of Shaft Three (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 002 (the materials mine), 001 (materials economy). Pairs with 051 (Survey Camp — claim new ground to sink fresh shafts).

## Why (the citizens' case)

Mara Flint-Eye has bossed Shaft Three since it was a scratch in the deck, and she will tell you the truth no surveyor wants to hear: a vein is not forever. Today one mine on one spot digs the same ore at the same rate until the end of time, so ore never feels precious, no one prospects, and the diggings never spread. That was tolerable while the colony could not grow its ground — but now the Survey Camp can **claim new ground**, and that changes everything. If a pit's vein ran down, ore would finally become a reason to expand: work the near veins, feel them thin, then claim outward and sink fresh shafts on new land. A mine that never tires makes a lazy colony. Let the rock run out the way real rock does.

## Mechanic

- Every Mine carries a **Vein Ledger**: a local ore reserve set when the shaft is sunk, worth about **12 colony-months of full, staffed output**.
- While a mine is **staffed and producing**, its ledger **ticks down** with the work done. An idle, unstaffed, or incident-stalled mine does **not** deplete — only digging spends the vein.
- A mine's own output fades by **bands** as its vein runs down (a fraction `f` of the vein remaining):
  - **f >= 0.5** (still half-full or better) → **100%** output — a fresh pit digs at full for a long while.
  - **0.375 <= f < 0.5** → **80%**
  - **0.25 <= f < 0.375** → **60%**
  - **0.125 <= f < 0.25** → **40%**
  - **f < 0.125** → a permanent **25% trickle** — an old pit becomes a poor pit, but it never dies, so Landing One does not collapse overnight.
- The fade is **per mine**, not colony-wide: a brand-new mine on freshly claimed ground digs at 100% even while an old one beside it trickles. This is what pushes the colony to keep sinking new shafts on new ground (051) rather than leaning on one pit forever.
- **Inert by default (load-bearing):** a fresh mine (full vein) — and any mine with no recorded vein — reads at **100%** output, and a fresh mine stays at 100% until **half** its 12-month vein is dug (~6 colony-months). No test or young colony runs anywhere near that long, so the materials economy and every existing mine test are **unchanged**. The Ledger only bites in a mature, long-running colony.

## Rules & data

- New per-building field **`vein`** on a Mine (days of life remaining), set to `veinLifeDays` (suggest **360** = 12 colony-months) when the mine finishes construction. A mine whose `vein` is undefined is treated as **full** (factor 1) — so existing buildings and test fixtures are never penalised.
- **`veinFactor(mine)`** returns the band multiplier from `f = vein / veinLifeDays`: `f>=0.5 → 1.0`, `>=0.375 → 0.8`, `>=0.25 → 0.6`, `>=0.125 → 0.4`, else **0.25** (floor). Undefined `vein` → 1.0.
- **Output:** in the mine production step, each mine's contribution is multiplied by its own `veinFactor` (alongside the existing maintenance factor): a worn-out vein digs less, independent of staffing/power/health.
- **Depletion:** each in-game day, a producing mine spends `staffing * frac` days of vein (so 12 months of life at full staffing; slower when half-staffed; nothing when idle/unstaffed/mid-incident). Clamp `vein` at 0 — at 0 the floor band (25%) holds forever, so the vein never yields literally nothing.
- Expose a **vein readout** for the HUD: e.g. the number of mines and the richness of the poorest pit (its band), so the player can see when it is time to claim ground and sink a fresh shaft.
- **No interaction with the Survey Camp is required to ship** — they simply reinforce each other. The Ledger stands alone as a rule on the Mine.

## Cost — materials & labour

- **No new building. No new materials, no extra labour.** The Vein Ledger is a **rule on each existing Mine** — it changes nothing about how a mine is built or staffed (002 is untouched).
- The real, emergent cost lands later: a mature colony must **spend to keep its ore flowing** — claim new ground (051: materials + a survey crew), then sink fresh mines (002: materials + a mining crew) as the old veins thin. Ore stops being free-forever and becomes something the colony must keep re-earning by expanding — exactly the pressure a Caesar III economy is built on.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green. Because this touches mine output, the **existing materials economy must be unchanged for a fresh mine** — every current test still passes. New tests covering:
  1. **Inert / non-regression:** a mine with a full (or undefined) vein produces at its full baseline; `veinFactor` is 1.
  2. **Bands:** setting a mine's vein to fractions across the thresholds yields `veinFactor` of exactly 1.0 / 0.8 / 0.6 / 0.4 / 0.25.
  3. **Floor:** a fully-exhausted vein (`vein` = 0) yields the 0.25 floor — reduced, never zero.
  4. **Depletion ticks with work:** a staffed, producing mine's `vein` falls over many days; an unstaffed (or idle) mine's `vein` holds.
  5. **Per-mine fade:** an old, thin-vein mine and a fresh full-vein mine in the same colony produce at different rates (the fresh one out-digs the old).
- On the live game (:5188): drive a mine's vein down and watch its materials output drop band by band and a HUD **vein** readout thin out, while a freshly built mine on claimed ground digs at full.
