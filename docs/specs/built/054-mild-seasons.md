# Spec 054 — Mild Seasons: the almanac makes the year turn

- status: built — slice 49, shipped to mechanics/dev. seasonOf maps a calendar month (1..12) to its band, seasonFactor gates the whole mechanic on a Calendar Office (053) and returns the month's multiplier, and seasonStatus feeds the HUD; seasonFactor is folded into the skyfarm yield in foodStep beside the staffing/power/tool/seed factors. Knobs in config.ts, the season uiState in runtime.ts, a Season HUD row in ColonyApp.tsx, and five tests in tests/economy.test.ts. No new building, materials, labour or state — it rides on the calendar the colony already paid for. Inert by default — with no Calendar Office seasonFactor is 1, so skyfarm food is exactly flat and all 359 prior tests passed UNCHANGED. The twelve monthly multipliers average to exactly 1.0 (annual total unchanged) and stay in [0.90, 1.10] so a lean season can never starve the colony. typecheck clean and all 364 tests pass; live on :5188 a colony with no calendar saw flat food, and with a Calendar Office the season swept Bloom +10 / Highsun +5 / Grey -5 / Frost -10 across the year, the HUD Season row rendering Frost -10% food.
- proposed-by: Mara Venn, almanac-keeper and skyfarmer (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 053 (the Founding Calendar — provides the months and is the unlock), 007 (skyfarm food). Pairs with 023 (storehouses), 048 (seed), 008 (rations).

## Why (the citizens' case)

Mara Venn keeps the almanac now, and the first thing the almanac shows her is how strange the old way was: the Founding Calendar gives the colony real months and years, Founders' Day comes round — and yet the fields behave as if every single day is identical. There is no growing season, no lean stretch, no reason to put a surplus by. On a real sky-island the light and the cloud-warmth swing through the year; the skygrain knows it even when the ledgers don't. Now that the colony actually _keeps_ a calendar, the seasons can finally mean something: farm a little fat in the bloom months, lay it up, and ride out the frost. It makes Founders' Day, the storehouses, the seed bins and the ration runs all feel like parts of one turning year instead of a flat forever-noon.

## Mechanic

- Once a **Calendar Office stands (053)** — the almanac is being kept — the skyfarms' food yield gains a gentle **seasonal multiplier** that depends on the current month:
  - **Bloom** (4 months): **+10%** yield (x1.10)
  - **Highsun** (2 months): **+5%** (x1.05)
  - **Grey** (2 months): **-5%** (x0.95)
  - **Frost** (4 months): **-10%** (x0.90)
- The bonuses and penalties are built to **balance to zero across the year**: the twelve monthly multipliers average to **exactly 1.0**, so the colony's _annual_ food total is unchanged. The season only moves output around _within_ the year — fat months and lean months — it never lowers the total.
- **Bounded, never starving:** the multiplier sits in **[0.90, 1.10]**, so even the deepest Frost only trims a tenth off the harvest. Seasons can make a thin year tight, but they can never starve Landing One outright — they make the **storehouses (023) and seed bins (048) matter**, nothing more.
- **Inert by default (load-bearing):** with **no Calendar Office**, there are **no seasons at all** — the skyfarm yield is exactly flat, as today. The whole mechanic is gated on the almanac, so a young colony (and every existing test, none of which keeps a calendar) sees food behave precisely as it does now. Seasons switch on only once the colony chooses to keep time.

## Rules & data

- **`seasonOf(month)`** maps the calendar month (1..12, from 053) to a named season and a yield multiplier. Suggested layout (a descending arc across the year):
  - months **1-4 → Bloom (1.10)**, **5-6 → Highsun (1.05)**, **7-8 → Grey (0.95)**, **9-12 → Frost (0.90)**.
  - These weights (4 x +0.10, 2 x +0.05, 2 x -0.05, 4 x -0.10) sum to 0, so `mean(multiplier) = 1.0` exactly.
- **`seasonFactor(state)`**: returns **1** when `countKind(Calendar Office) === 0` (inert — no almanac, no seasons). Otherwise returns `seasonOf(calendarStatus(state).month).multiplier`.
- **Coupling:** multiply the **skyfarm food yield** in `foodStep` by `seasonFactor(state)`, alongside the existing staffing/power/tool/seed factors. Because the factor is 1 without a Calendar Office and averages 1 with one, neither a calendar-less colony nor the long-run annual total changes — only the month-to-month rhythm does.
- It touches **only skyfarm food output** for this slice; power and other goods stay flat. (A later spec could add a winter power dip if the world wants it — out of scope here to keep it small.)
- Expose the **current season name and its modifier** for the HUD (shown only once a Calendar Office stands).

## Cost — materials & labour

- **No new building. No materials, no extra labour.** Mild Seasons is an **almanac rule** that rides on the **Calendar Office the colony already built and staffed (053)** — the same clerk who counts the years also reads the season. Nothing new to construct or crew.
- The real, intended cost is **planning**: in the fat Bloom months the colony must **put food by** in its storehouses and seed bins so the Frost months do not bite, instead of eating hand-to-mouth on a flat harvest. Seasons turn idle storage into a deliberate buffer — the colony pays in foresight, not in goods.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green. The mechanic must be **inert with no Calendar Office** — skyfarm food is unchanged, so every current test still passes. New tests covering:
  1. **Inert:** with no Calendar Office, `seasonFactor === 1` for every month, and skyfarm output equals its pre-054 baseline.
  2. **Bands:** with a Calendar Office, stepping the clock through the year yields `seasonFactor` of 1.10 / 1.05 / 0.95 / 0.90 in the right months.
  3. **Balances to zero:** the mean of the twelve monthly multipliers is exactly 1.0 (the annual food total is unchanged).
  4. **Food coupling:** with a Calendar Office, a skyfarm in a Bloom month out-produces the same farm in a Frost month over the same run.
  5. **Bounded:** `seasonFactor` never leaves `[0.90, 1.10]` for any month, so it cannot collapse the harvest.
- On the live game (:5188): with a Calendar Office up, advance the clock through the months and watch a **Season** HUD readout (e.g., "Bloom +10%") change, and the skyfarm food rate rise and fall with it across the year.
