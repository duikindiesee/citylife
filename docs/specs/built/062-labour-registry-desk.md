# Spec 062 — The Labour Registry Desk: idle hands finally show in the books

- status: built — slice 57 (mechanics/dev, PR #26). A staffed Labour Registry Desk surfaces the employment rate and makes chronic unemployment drag the Prosperity Rank (-1 above 10% held 7 days, -2 above 20% held 14 days, clears below 5% held 7 days), floored at the bottom tier. Inert by default; the penalty only bites after the idleness persists. Engine in src/colony with five economy tests.
- proposed-by: Nella Voss, wage clerk at the Pay Office (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 040 (Census Hall — the Prosperity Rank this finally makes honest), 029 (Pay Office — the wage book Nella keeps), 038 (Roster Office — labour priority, which this complements), 028 (Ward Post — unrest already reads idleness, but only under a squeeze)

## Why (the citizens' case)

Nella Voss keeps the wage book at the Pay Office, and she is the one who has to look a jobless colonist in the eye when they come asking why their hands are idle. The colony has people, jobs, wages, and a Census Hall that prints a proud Prosperity Rank — but there is no proper desk where idle hands are matched to the empty posts that do exist, and no place where long idleness is written down. Today a colonist can sit jobless for half a season and the books barely notice: unemployment only stirs unrest if something else is already going wrong (a brownout, a high levy, a stingy wage), and the Prosperity Rank never falls for idleness on its own. That feels wrong to any clerk. A colony with many idle hands is not as prosperous as its ledgers pretend, and Nella wants the books to say so — and a desk that helps people find the work that is already there before trouble starts.

## Mechanic

A new staffed civic office, the **Labour Registry Desk**, keeps an honest count of the colony's working-age idle hands and makes chronic idleness tell on the Prosperity Rank. While a staffed Registry stands, the colony surfaces its live **employment rate**, and unemployment that stays high for days on end drags the Census Hall's Prosperity Rank down a step (or two) — clearing again once the colony puts its people back to work. Without a Registry, nothing changes: unemployment behaves exactly as it does today (it can still feed unrest under a squeeze, but the Prosperity Rank ignores it).

The Registry is the colony's labour-market book. In Landing One's pooled-labour model the desk does not hand-assign individual workers (the Roster Office already orders how the shared pool fills under a shortage); what the Registry adds is the **truth**: it measures the idle share, surfaces it, and makes sustained idleness count against Prosperity — the one place the colony currently looks away.

## Rules & data

### Building: Labour Registry Desk (engine kind `registry`)

- A small civic office: desks, a posting board, runners, and a fair list of who needs work.
- **Prerequisites to auto-raise:** a Census Hall (spec 040) and a Pay Office (spec 029) must already stand (the rank and the wage book it reads).
- **Staffing:** 2 clerk jobs at full strength; 1 clerk runs it at half strength; 0 idle. (Civic sector.)
- **No power draw** — it is desks and paperwork, not machinery.

### Coverage and the employment rate

- One Registry covers up to **120 working-age colonists** at full staffing (60 at half). Covered fraction = `min(1, 120 * registries * staffingFraction / colonists)`.
- **Unemployment** = `max(0, 1 - totalJobs / colonists)` — the share of working-age colonists with no post (children are dependents, not workers, and are excluded). The **employment rate** is `1 - unemployment`.
- Only the covered portion of the workforce counts toward the penalty below; an over-large workforce beyond capacity is not yet on the books (build another desk).

### Chronic-unemployment → Prosperity (only while a staffed Registry stands)

- Track consecutive days the covered unemployment sits above each line:
  - above **10%** for **7 straight days** → **Prosperity Rank -1**
  - above **20%** for **14 straight days** → **Prosperity Rank -2** (instead of -1)
- The penalty **clears** after covered unemployment stays **below 5%** for **7 straight days** (hysteresis — a brief dip does not flip it on and off).
- The penalty floors the rank at its lowest tier; it never pushes Prosperity below the bottom rank, and it adds no unrest by itself (it only tells the truth in the books).

### Gentle defaults (inert by design)

- **No Registry:** the Prosperity Rank is computed exactly as today — idleness does not drag it. The employment rate is not surfaced. Identical to now.
- **Registry built but understaffed or just raised:** no penalty until the unemployment has actually persisted for the full day-count, so raising the desk never snaps Prosperity down.
- A colony at or near full employment (the common, healthy case) pays nothing — the Registry simply keeps the books honest, like the Census Hall it sits beside.

## Cost — materials & labour

**To build (one desk):**

- 20 materials
- 4 components
- 2 tool-kits (spec 047)
- 2 folios (spec 044 — the bound ledgers and notices)
- Labour: **4 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per desk):**

- **2 clerk crew** (Civic sector). Below 2 it runs at half strength; at 0 it is idle and the books look away again.
- Upkeep: a folio a season for fresh ledgers and a little material for the desks. (Deferred to keep this slice small; the dominant gates are the two clerks and the prerequisites.)

## Acceptance

**Tests (tests/economy.test.ts):**

- **Inert without a desk:** a colony with heavy unemployment and no Registry shows the same Prosperity Rank as today — idleness does not drag it.
- **Surfaces the rate:** with a staffed Registry, the readout reports the live employment/unemployment rate and the covered share.
- **Chronic idleness drags Prosperity:** a staffed Registry over a colony held above 10% unemployment for 7+ days lowers the Prosperity Rank by 1; held above 20% for 14+ days lowers it by 2.
- **Clears on recovery:** once unemployment sits below 5% for 7 straight days, the penalty lifts and the rank returns.
- **Never below the floor, never just-built-snap:** the penalty never pushes the rank below its lowest tier, and a freshly raised desk applies no penalty until the day-count is met.

**Live on :5188:**

- With a staffed Labour Registry and a workforce held idle, an **Employment** row appears in the HUD showing the rate, and after the onset days the Prosperity readout drops a step; put the colony back to work and it recovers.
- No Registry → no Employment row and the Prosperity Rank is unchanged from today.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
