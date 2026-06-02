# Spec 064 — The Market Stall: local custom returns a little coin
- status: built — slice 59 (mechanics/dev, PR #26). A staffed Market Stall sells surplus linen/folios (above a 10-unit reserve) to paid colonists, returning +4 coin/sale (one sale per 20 of up to 60 served colonists per day) to the treasury — the colony's first domestic revenue. Wage-arrears gate (full/half/closed). Pure revenue, inert by default, never sells below the reserve. Engine in src/colony with five economy tests.
- proposed-by: Joss Tamm, stall-carpenter and tally hand on Dock Three (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 029 (the Pay Office — paid colonists are the only ones who shop), 039 (Treasury Arrears — unpaid wages shut the stalls), 023 (Storehouse Platforms — the surplus the stall sells from), 031 (Linen) and 044 (Folios — the wares on the counter), 012 (the Skybridge Exchange — the stall trades the surplus the Exchange has not exported)

## Why (the citizens' case)
Joss Tamm builds stalls and keeps a tally on Dock Three, and he will tell you plainly: the colony earns from only two places — the levy it charges its own people, and the Exchange that sells abroad. But folk inside Landing One draw wages and want small household wares, and right now that coin just vanishes into the floorboards. There is no honest shop where local custom comes back as a little margin for the public box. Joss does not want a grand bazaar or a new tax — just a plain stall: surplus cloth or a spare folio on the counter, two clerks behind it, and a few coins returning to the treasury from the life that already happens here. A colony that never builds one runs exactly as it does today; one that does turns its own bustle into a trickle of income.

## Mechanic
A new staffed **Market Stall** sells the colony's **surplus** finished wares — linen or folios — to its own paid colonists, returning a small margin to the treasury each day. It is the demand side of the economy the colony has never had: wages paid out (spec 029) finally circulate back as a little coin. The stall only ever sells genuine surplus (it keeps a reserve so it never robs the export trade or the top-tier homes), and it only sells while the colony is actually paying its people — if wages fall into arrears, custom dries up and the stalls go quiet. It touches nothing else: no food, no prosperity, no housing, no immigration — only the treasury.

## Rules & data

### Building: Market Stall (engine kind `stall`)
- A small staffed commercial stall: a counter, an awning, a tally box. Trade sector.
- **Prerequisites to auto-raise:** a Pay Office (spec 029) stands and the colony holds a surplus of linen or folios above the reserve.
- **Staffing:** 2 clerks at full strength; 1 clerk runs it at half capacity; 0 closed.

### Who it serves
- One staffed stall serves up to **60 housed colonists** (`servedCap = 60 × staffingFraction × stalls`). The colony's served custom is `served = min(servedCap, colonists)`.
- **Sales per day** = `floor(served / 20)` — so a single fully-used, fully-staffed stall makes up to **3 sales/day**.

### What it sells (surplus only)
- Each sale moves **1 linen OR 1 folio** — whichever the colony holds more of **above its reserve**. The stall will not sell the last **10 linen** or the last **10 folios** (the reserve protects the Exchange's export stock and the top-tier homes).
- If neither ware sits above its reserve, the stall simply sits quiet (no sale, no income) that day.

### Income
- Each sale returns **+4 coin** to the treasury. So one fully-used stall earns up to **+12 coin/day**, consuming up to **3 linen/folios/day**.
- This is a margin from local custom, **not** a tax and **not** an export — it never touches the levy or the Exchange.

### Wage-arrears gate (paid colonists only)
- While the colony is paying its people (solvent, no arrears strain), the stall runs at **full** rate.
- As wages slip into arrears (the treasury sinks toward its debt ceiling, spec 039), custom **halves**.
- Under deep, sustained arrears strain (wages long unpaid), the stalls **close** — nobody shops on an empty purse.
- (Implementation note: Landing One tracks treasury arrears as one signal rather than per-citizen wage-days; map Joss's 7-day / 8–20-day / 20-day+ bands onto solvent / in-arrears / deep-arrears-strain.)

### Gentle defaults (inert by design)
- **No stall:** the treasury earns exactly as today — only levy + Exchange. Identical.
- **No surplus wares, or unstaffed, or wages in deep arrears:** the stall earns nothing — no penalty, no debt, no side effect.
- It only ever **adds** coin from genuine surplus; it can never reduce the treasury, and it never sells below the reserve.

## Cost — materials & labour
**To build (one stall):**
- 10 materials
- 2 components
- 1 tool-kit (spec 047)
- 2 linen (spec 031 — the awning and counter cloth)
- Labour: **3 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per stall):**
- **2 clerk crew** (Trade sector). Below 2 it serves at half; at 0 it is closed.
- A small upkeep (a little material now and then for the counter). Deferred to keep this slice small; the dominant gates are the two clerks, a surplus to sell, and paid wages.

## Acceptance
**Tests (tests/economy.test.ts):**
- **Inert without a stall:** a colony with surplus linen/folios and a Pay Office earns exactly its usual treasury — no extra coin, no ware consumed.
- **Sells surplus for coin:** a staffed stall over a populous, paid, surplus-stocked colony raises the treasury by +4 per sale and draws down the ware sold, capped at floor(served/20) sales/day.
- **Reserve respected:** the stall never sells linen or folios below the 10-unit reserve; with stock at or below the reserve it sits quiet.
- **Wages gate custom:** with the colony in deep arrears strain the stall earns nothing (sells nothing); restore solvency and it sells again.
- **Treasury-only, never negative:** the stall changes no food/housing/prosperity/immigration signal, and it can only ever add coin (never reduces the treasury).

**Live on :5188:**
- With a staffed stall, a populous paid colony, and surplus linen/folios, a **Market** row appears in the HUD (stalls + coin/day), the treasury ticks up daily, and the sold ware draws down toward its reserve.
- No stall → no Market row and the treasury earns exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
