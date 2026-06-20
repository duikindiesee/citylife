# Spec 060 — The Variety Ration Counter: two foods finally beat one

- status: built — slice 55 (mechanics/dev, PR #26). A staffed Variety Ration Counter grants a Varied Diet to the covered share of the colony when both skyfarm food and rimfish share the table over a 20-day window, lifting immigration desirability and shortening the housing-evolution interval. Inert by default (no counter, or one food, changes nothing); the standing holds 5 days then fades on lost crew or power; it only ever adds. Engine in src/colony with five economy tests.
- proposed-by: Mara Venn, lamp-watch captain who keeps the night food counts by the granaries (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 056 (Rimfish — the second food this mechanic finally rewards), 008 (Ration Depot — food distribution this builds beside), 006 (Housing evolution — the ladder a varied diet helps homes climb), 049 (Settler Confidence — a well-fed, varied colony reads better to newcomers), 054 (Mild Seasons — variety matters most when one food dips)

## Why (the citizens' case)

Mara Venn walks the dark gantries behind the granaries every night with her lamp, and lately she has been tallying the food counts while she rounds. She has noticed something that nags at her: a belly filled on rimfish counts for exactly the same as a belly filled on greens. The colony worked hard to string nets off the cloudsea rim and haul fish up the cliffs (spec 056), and all it bought was a second way to plug the same calorie hole. That is not how a household actually lives. A family that eats greens one day and fish the next is a happier, healthier family than one stuck on a single dish forever, and on the old Earth that variety was always what lifted a home from a hovel to a proper house. Mara does not want hunger trouble added — a young Landing One that never builds this should run exactly as it does today. She just wants a fair little ledger and serving hatch so the homes that get **both** greens and rimfish feel the difference, and so the rim nets finally earn their keep.

## Mechanic

A new staffed service building, the **Variety Ration Counter**, records what is actually flowing onto the colony's tables and hands out mixed rations. While a counter is built, staffed, powered and supplied, the share of the population it covers earns a **Varied Diet** standing — but only when the colony is genuinely eating two foods, not one food with a token sprinkle of the other. A Varied Diet gently lifts settler confidence (the colony's reputation with newcomers) and helps served homes climb the housing ladder a little faster. It never punishes a one-food colony; it simply withholds the bonus.

This is the colony-aggregate adaptation of Mara's per-home proposal: rather than walker coverage of individual houses, each counter covers a fixed slice of the population (consistent with how Landing One's other service posts already work), and the diet test reads the colony's real food intake over a trailing window.

## Rules & data

### Building: Variety Ration Counter (engine kind `rationvar`)

- A small civic service: counter, cold shelf, ledger desk, serving hatch.
- **Coverage:** one counter serves up to `varietyCounterCapacity` = **80 residents**. Covered fraction across the colony is `varietyCovered = min(1, 80 * staffedCounters / colonists)`.
- **Staffed** means it has its run crew; **operating** means staffed AND not in a brownout (it carries a small power load on the priority grid, spec 017).

### The Varied Diet test (trailing window)

- Track meals served from each food over a trailing **20-day** window: `skyfarmMeals` (greenhouse, spec 007) and `rimfishMeals` (spec 056).
- Let `totalMeals = skyfarmMeals + rimfishMeals` and `rimfishShare = rimfishMeals / max(1, totalMeals)`.
- **Varied Diet is active** for the colony only when ALL hold:
  - at least one counter is built, staffed and operating;
  - the colony was not in a food shortage during the window (`totalMeals` met demand — no empty larder);
  - **both foods genuinely shared the table:** `rimfishShare` is between `varietyMinShare` = **0.20** and `varietyMaxShare` = **0.80**.
- The band is the aggregate form of Mara's "at least 6 of each per 10 residents": neither food may be a token. A colony eating 95 percent greens (share 0.05) or 95 percent fish (share 0.95) is a one-food colony and earns nothing.

### Effect of a Varied Diet

While active, scaled by `varietyCovered` (so a half-covered colony gets half the effect):

- **Settler confidence (spec 049):** `+ confVarietyBonus * varietyCovered`, with `confVarietyBonus` = **0.04** (a small, well-earned reputation lift; word of a colony that eats well travels with newcomers).
- **Housing evolution (spec 006):** served homes accrue evolution progress `+ evoVarietyNudge * varietyCovered` per day, `evoVarietyNudge` = **+5 percent** of the normal daily evolution accrual. Homes still need every other requirement; this only helps those already climbing. It never forces an upgrade and never causes devolution.

### Gentle defaults (inert by design)

- **No counter built:** nothing changes anywhere. `varietyCovered = 0`, no bonus, no penalty — identical to today.
- **Counter built but only one food exists** (share outside the 0.20–0.80 band): no bonus and **no penalty**. Rimfish still works as substitute calories exactly as it does now.
- **Staffing fails or the grid browns out:** the counter pauses. An existing Varied Diet standing **persists for 5 days**, then fades to neutral (no cliff, no penalty — just the bonus winding down).
- The mechanic only ever **adds** a bonus; it can never reduce confidence, happiness, or a housing tier below its no-counter baseline.

## Cost — materials & labour

**To build (one counter):**

- 35 materials
- 8 components
- 1 tool-kit (spec 047)
- Labour: **4 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per counter):**

- **2 staffed crew:** 1 ration clerk + 1 food handler. Below 2 crew the counter is unstaffed and inert.
- Upkeep: **1 component every 60 days** (shelf and scale upkeep). If components are unavailable, the counter pauses (then the 5-day fade applies).
- **1 unit of water per day** for cleaning (spec 046).
- Small power load (**~0.3**) on the brownout priority grid (spec 017) while operating; it is a low-priority load and sheds first in a brownout.

## Acceptance

**Tests (tests/economy.test.ts):**

- **Inert without the counter:** a colony with both foods flowing but no counter shows `varietyCovered = 0`, no confidence bonus, no evolution nudge — existing confidence/evolution tests unchanged.
- **Inert on one food:** a colony with a built, staffed, powered counter but eating ~95 percent one food (share outside 0.20–0.80) earns no bonus and takes no penalty.
- **Active on two foods:** a colony with a staffed, powered counter, no shortage, and `rimfishShare` inside the band shows Varied Diet active, a positive confidence delta (≤ 0.04 × covered), and a small positive evolution accrual.
- **Coverage scales:** with capacity below population, the bonus equals `0.04 × min(1, 80·counters/colonists)`, not the full amount.
- **Fades, never punishes:** removing staff or forcing a brownout keeps the standing for 5 days, then returns it to neutral; confidence never drops below the no-counter baseline at any point.

**Live on :5188:**

- With a counter built and both foods on the table, a **Diet** row appears in the HUD reading the covered/served residents and a `varied` marker; with one food it reads `one food` and shows no bonus.
- No counter → no Diet row at all, and the colony plays exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
