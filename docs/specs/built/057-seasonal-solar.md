# Spec 057 — Seasonal Solar Angling: the sun keeps the calendar too
- status: built — slice 52, shipped to mechanics/dev. solarSeasonOf maps a calendar month to its solar band, solarSeasonFactor gates the whole mechanic on a Calendar Office (053) and returns the month multiplier, and seasonStatus now carries the solar modifier alongside the food one. The factor multiplies ONLY the solar term of the power tick in sim.ts ((solarPeakW + powerGen) * daylight * solarSeasonFactor + turbinePower) — turbines (045) are untouched. Knobs in config.ts, the season uiState extended in runtime.ts, the Season HUD row now showing both food and sun in ColonyApp.tsx, and five tests in tests/economy.test.ts. No new building, materials or labour — it rides on the calendar the colony already paid for. Inert by default — with no Calendar Office solarSeasonFactor is 1, solar is flat all year, and all 374 prior tests passed UNCHANGED. The twelve monthly solar multipliers average to exactly 1.0 (Frost set to 0.90, not the citizen's 0.85 sketch) and stay in [0.90, 1.15]. typecheck clean and all 379 tests pass; live on :5188 a calendar-less colony had flat solar, and with a Calendar Office the sun swept Bloom +5 / Highsun +15 / Grey -5 / Frost -10 across the year while turbines held steady, the HUD Season row rendering both food and sun. The symmetric twin of Mild Seasons (054): food season → power season, same almanac.
- proposed-by: Mara Venn, sun-reader of the South Glass Walk (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 053 (the Founding Calendar — the unlock and the months), 017 (brownout priority grid / power). Pairs with 054 (Mild Seasons — the same almanac), 018 (battery sheds), 045 (wind-shear turbines).

## Why (the citizens' case)
Mara Venn reads the sun off the South Glass Walk, and the contradiction has nagged her since Mild Seasons arrived: the skygrain feels the turning year now — bloom and frost, fat months and lean — but the *sunlight* does not. The solar farms throw the same power in the deep grey of Frost as they do at the height of Highsun, as if the colony orbited a lamp that never moved. That is not a real year. The light should swing too: long and strong in the high season, short and thin in the dark months. And the colony is finally ready for it — it has battery sheds to store the summer surplus and wind-shear turbines that answer to the wind, not the sun, to carry the dark season. Let the sun keep the calendar like everything else, and winter light becomes a small planning question instead of a free lunch.

## Mechanic
- Once a **Calendar Office stands (053)** — the almanac is kept — **solar** power output follows the year by month, peaking in the high season and dipping in the dark one:
  - **Bloom** (4 months): **x1.05**
  - **Highsun** (2 months): **x1.15** (the long, strong days)
  - **Grey** (2 months): **x0.95**
  - **Frost** (4 months): **x0.90** (short, thin light)
- The twelve monthly multipliers are weighted (4 + 2 + 2 + 4 months) to average to **exactly 1.0** — the colony's *annual* solar yield is unchanged. Power is only **redistributed** within the year, never reduced. (I have set Frost to 0.90 rather than the 0.85 first sketched, so the average lands on exactly 1.0 — "redistributed, not reduced" as Mara intends; the floor still sits comfortably above her 0.85 safety line.)
- **Wind-shear turbines (045) are unaffected** — wind has no season, so turbine power is identical every month. This is the point: the dip pushes the colony to lean on **batteries (018)** and **turbines** to carry Grey and Frost, rewarding exactly the season-proof power it has already learned to build.
- **Bounded, never a blackout:** the multiplier sits in **[0.90, 1.15]**, so even the deepest Frost only trims a tenth off the *solar* share, and the **brownout priority grid (017) still protects** homes, water pumps, clinics and food first. Seasonal solar can make a winter grid tight; it can never black the colony out.
- **Inert by default (load-bearing):** with **no Calendar Office**, solar output is **flat all year, exactly as today** — the whole mechanic is gated on the almanac, so a young colony (and every existing test, none of which keeps a calendar) sees power behave precisely as it does now. The sun only starts keeping the calendar once the colony does.

## Rules & data
- **`solarSeasonFactor(state)`**: returns **1** when `countKind(Calendar Office) === 0` (inert). Otherwise returns the current month's band from `calendarStatus(state).month`: months **1-4 → 1.05**, **5-6 → 1.15**, **7-8 → 0.95**, **9-12 → 0.90** (mirroring the Mild Seasons months, 054). The weights `4*1.05 + 2*1.15 + 2*0.95 + 4*0.90 = 12.0`, so `mean = 1.0` exactly.
- **Coupling:** in the power tick (where `solarW` is computed), multiply **only the solar generation** — `(COLONY.power.solarPeakW + state.powerGen) * daylight` — by `solarSeasonFactor(state)`. **Do not** multiply `turbinePower(state)`: `solarW = (solarPeakW + powerGen) * daylight * solarSeasonFactor + turbinePower`. Because the factor is 1 without a Calendar Office and averages 1 with one, neither a calendar-less colony nor the annual energy budget changes — only the month-to-month solar rhythm does.
- It touches **only solar generation** for this slice; load, batteries and turbines are untouched (they simply matter more in the dip).
- Expose the current **solar season modifier** for the HUD (alongside, or folded into, the existing Season readout from 054), shown only once a Calendar Office stands.

## Cost — materials & labour
- **No new building. No materials, no extra labour.** Seasonal Solar Angling is an **almanac rule** that rides on the **Calendar Office the colony already built and staffed (053)** — the same clerk who counts the years reads the sun's angle. (In Mara's words the engineers re-mark the panels' seasonal tilt-stops each year — a Sun-Scale Kit of glass, timber and a tool — but mechanically it costs the colony nothing new; it is knowledge, not construction.)
- The real, intended cost is **planning**: in the bright Highsun the colony banks the surplus in its **battery sheds (018)**, and through Grey and Frost it leans on **stored power and the wind-shear turbines (045)** instead of the dimmed farms. Seasonal solar turns idle batteries and season-proof turbines into a deliberate winter strategy — the colony pays in foresight, not in goods.

## Acceptance
How Review & Build verifies it:
- `npm run typecheck` clean and `npm test` fully green. The mechanic must be **inert with no Calendar Office** — solar output is unchanged, so every current test still passes. New tests covering:
  1. **Inert:** with no Calendar Office, `solarSeasonFactor === 1` for every month.
  2. **Bands:** with a Calendar Office, stepping the clock through the year yields `solarSeasonFactor` of 1.05 / 1.15 / 0.95 / 0.90 in the right months.
  3. **Averages to one:** the mean of the twelve monthly solar multipliers is exactly 1.0 (the annual solar yield is unchanged).
  4. **Turbines unaffected:** `turbinePower` is identical regardless of the month / season (wind has no season).
  5. **Bounded:** `solarSeasonFactor` never leaves `[0.90, 1.15]`, so it can never black the colony out.
- On the live game (:5188): with a Calendar Office up, advance the clock through the months and watch solar output rise in Highsun and dip in Frost while turbine output holds steady, and confirm a colony that banked battery charge and built turbines rides the Frost dip without browning out its homes.
