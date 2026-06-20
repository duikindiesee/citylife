# Spec 067 — The Highsun Lantern Supper: a year the people look forward to

- status: built — slice 62 (mechanics/dev, PR #26). A staffed Festival Board throws the Highsun Lantern Supper once per colony-year (on the Highsun turn), spending greens + rimfish/dried + linen + materials per 20 citizens from the colony's own stores; coverage grants tiered, decaying Lantern Cheer (>=80%: +5 confidence 30d + unrest relief + standing; 50-79%: +2 confidence 15d; <50%: not held, no cost). Inert without a Board/Calendar; once per year; never spends below zero. Engine in src/colony with five economy tests.
- proposed-by: Mara Venn, provisioner and tally-keeper at the east Market Stall (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 053 (the Founding Calendar — the year-turn this festival rides), 060 (the Variety Ration Counter — the two foods the supper serves), 056/061 (Rimfish + Dried Rimfish — the fish course), 049 (Settler Confidence — the cheer it lifts), 028 (unrest — calmed by a good supper), 032 (Kookerverse Standing — a well-fed colony is noticed)

## Why (the citizens' case)

Mara Venn keeps the tally slates and ration queues at the east Market Stall, and she will tell you what the colony is missing now that it has roofs and wages and a calendar on the wall: a small, dependable reason for folk to feel the year turning together. Landing One has thrown one-off feasts when the council had coin to spare, and it marks Founders' Day, but there is no recurring supper the island plans around — nothing the children count down to. Mara wants one proper yearly meal in the long light of Highsun: lanterns strung along the gantries, the trestles out, greens and fish from the colony's own stores on every table. It is not a palace banquet and it makes no food from nothing — just a planned, shared supper that lifts spirits and gives the wider world one more reason to think well of a colony that feeds its people. A colony that never builds the board for it plays exactly as it does today.

## Mechanic

A new staffed **Festival Board** unlocks the **Highsun Lantern Supper**, a once-per-colony-year festival. Each year, when the calendar turns through **Highsun** (spec 053), a built and staffed Board lays a supper for the colony from its own stores — greens, rimfish or dried rimfish, a little linen and materials for lanterns and trestles. How much of the colony it can actually feed (its **coverage**) decides the reward: a well-supplied supper grants **Lantern Cheer**, a temporary lift to Settler Confidence and a calmer, less restless month, and earns the colony a little Standing with the wider Kookerverse. A thin supper helps a little; a failed one simply does not happen — _not this year_ — with no penalty at all. With no Festival Board, the colony's year passes exactly as it does now.

To fit Landing One's deterministic, calendar-driven engine, the supper fires once per year on the year's Highsun turn (the same once-a-year accounting the Founders' Day and the Long Ledger already use), draws its cost from the colony's aggregate stores, and grants its cheer as a timed buff that decays — exactly like the one-off Civic Feast (spec 030), but recurring and earned by being well-stocked rather than bought.

## Rules & data

### Building: Festival Board (engine kind `festboard`)

- A noticeboard, lantern hooks, folding trestles, a planning ledger. **Civic sector.**
- **Prerequisites to auto-raise:** a Calendar Office (spec 053), a Labour Registry (spec 062), a Market Stall (spec 064), and a Variety Ration Counter (spec 060) — the colony must already keep time, books, a market, and a varied table.
- **Staffing:** 1 Festival Steward keeps the board; understaffed, only the share of the colony it can organise counts as served (the colony-wide Civic staffing fraction already models this).

### The annual supper (once per colony-year, on the Highsun turn)

- Round the population up to the next **20**; that many **tables** (`ceil(colonists / 20)`).
- Each table draws, from the colony's stores: **10 greens (food)**, **6 rimfish** (or **6 dried rimfish** when fresh runs short), **1 linen**, **2 materials**.
- A table is **served** only if the colony can supply all of its cost; the supper serves as many tables as the stores (and the steward's organisation) allow.
- **Coverage** = `served citizens / total citizens` (0..1). The supper consumes only what it actually serves — a colony that can feed half its tables spends half the cost.

### Festival result (Lantern Cheer)

- **Coverage >= 0.80** — a full supper: **+5 Settler Confidence** and a **20 percent lower unrest accrual** for **30 days**, and **+1 Standing** (once per year).
- **Coverage 0.50 to 0.79** — a modest supper: **+2 Settler Confidence** for **15 days**; no Standing.
- **Coverage < 0.50** — _not this year_: no effect, and **no penalty** — folk simply get on with their shifts.
- The cheer is a timed buff that decays to nothing; it never stacks beyond one festival and never pushes any signal below its no-festival baseline.

### Gentle defaults (inert by design)

- **No Festival Board (or no Calendar):** the colony's year passes exactly as today — no supper, no cost, no cheer.
- The supper fires **at most once per colony-year**; it creates no food, only spends from genuine surplus, and never drives a stockpile below zero.
- It only ever **adds** cheer (confidence + calm + standing) when earned; a poor year simply does nothing.

## Cost — materials & labour

**To build (one Board):**

- 30 materials
- 8 components
- 2 tool-kits (spec 047)
- 6 linen (spec 031 — the lantern bunting)
- 2 folios (spec 044 — the planning ledgers)
- Labour: **4 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing):**

- **1 Festival Steward** (Civic) to keep the board; unstaffed, the supper does not happen.
- The **annual supper cost** above (greens + fish + linen + materials, scaled to the population it feeds) — paid once a year from the colony's stores, nothing the rest of the year.

## Acceptance

**Tests (tests/economy.test.ts):**

- **Inert without a Board:** a colony's year-turn, confidence, unrest and standing are exactly as today — no supper fires, no stores are spent.
- **A well-stocked colony throws a full supper:** a staffed Board over a populous, well-fed (greens + fish + linen + materials in surplus) colony fires once on the Highsun turn, spends the per-table cost, and grants Lantern Cheer (a positive confidence delta, calmer unrest, +1 standing).
- **A thin supper helps less, a failed one not at all:** at 50–79 percent coverage the colony gets the smaller confidence lift and no standing; below 50 percent nothing happens and no stockpile drops and no penalty lands.
- **Once per year:** the supper fires at most once per colony-year (it does not re-fire on the following step), and never drives greens/fish/linen/materials below zero.
- **The cheer decays:** the confidence/unrest buff fades over its window back to the colony's baseline, never below it.

**Live on :5188:**

- With a staffed Festival Board and a well-stocked, populous colony, a **Festival** row appears in the HUD (next supper / Lantern Cheer active), the Highsun turn fires the supper, stores tick down by the supper cost, and Confidence lifts for the month.
- No Festival Board → no Festival row and the year passes exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
