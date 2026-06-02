# Spec 053 — The Founding Calendar: the colony learns to count its years
- status: proposed
- proposed-by: Mara Vell, timekeeper's apprentice and rope-reel clerk (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 001 (labour + materials-gated construction). Distinct from 030 (the Civic Feast — see below).

## Why (the citizens' case)
Mara Vell keeps the rope-reels and, lately, a tally of days scratched on a spare deck-plate, because nobody else does. Landing One has births and debts, dry mines and old promises, claims laid and storms ridden out — and no shared memory of *when* any of it happened. The colony has never known how old it is. There is no new year, no anniversary, no sense that time is passing at all; the clock ticks but no one is counting. A colony that cannot mark its own years has no story, only a present tense. Give the people a calendar and a clerk to keep it, and Landing One gains something nothing else on the deck provides: a past, a rhythm, and one honest holiday a year — without touching the food, the wages, or the housing.

## Mechanic
- A small **Calendar Office**, staffed by **one clerk**, makes the colony's **age** real: it reads the existing clock and surfaces the **year and month since founding** (e.g., "Year 3, Month 7") for the colony to see.
- Every twelfth month is **Founders' Day** — the colony's birthday. If the Calendar Office is **built and staffed** when a year turns, the colony gets a **small, free morale lift** (a brief easing of unrest — the people mark the day). If there is **no office, or it is unstaffed**, the year simply **passes unmarked** — nothing bad happens.
- **Distinct from the Civic Feast (030):** the Feast is a *council-funded* party — it spends treasury and goods on demand to buy a burst of cheer. Founders' Day is the opposite: **free, automatic, smaller, and annual**, paid for by nothing but the clerk's presence. One is a deliberate splurge; the other is the colony quietly being a year older. They stack but never overlap in cost.
- **Inert / gentle by default (load-bearing):** with **no Calendar Office**, nothing changes at all — the clock ticks exactly as today, just uncounted. The Founders' Day lift is **small and only annual**, so even a colony that builds the office barely notices it day to day, and it can never harm anything (it only ever eases unrest a little). A young colony can ignore the whole mechanic safely.

## Rules & data
- New building **Calendar Office** (`calendar`): staffed civic clerkery, **1 job** (the clerk), a tiny power load (~0.2). Built on labour + materials like any building.
- **Colony age:** computed from the existing sim clock — `year = floor(daysSinceFounding / daysPerYear)` and the current month, with `daysPerYear = 360` (12 months of 30 days). This is a *readout*; it changes no economy on its own.
- **Founders' Day trigger:** when the colony crosses a year boundary (the integer year increments) **and** a Calendar Office is built and staffed, apply a one-time morale lift: `unrest = max(0, unrest - foundersDayUnrestRelief)` with `foundersDayUnrestRelief` small (suggest **0.08**). Track the last year already celebrated so the lift fires **once per year**, never repeatedly.
- No office, or unstaffed at the turn → no lift; the year still advances (the age readout keeps counting regardless), it is simply not marked.
- Expose the colony **age (year + month)** and **months until the next Founders' Day** for the HUD, plus whether the office stands.
- **Keep it small:** the core is the age readout + the once-a-year staffed morale lift. Recording specific past events (first export, first claim) is explicitly out of scope for this slice — a later spec can layer a milestones log on top of the calendar this one establishes.

## Cost — materials & labour
- **Build the Calendar Office:** a modest **materials + components** cost plus a few **reels** (fine printed ledgers and bound almanacs — Mara's "made of good cloth and paper"); the Review & Build routine maps the exact goods to what the build system already supports, keeping it a cheap civic building.
- **Labour:** **1 free colonist** (the clerk) to staff it. Unstaffed, the office keeps no calendar and Founders' Day passes unmarked.
- **Upkeep:** none beyond the clerk's normal wages (029). The Founders' Day lift itself is **free** — it spends no treasury and no goods, which is exactly what sets it apart from the Civic Feast.

## Acceptance
How Review & Build verifies it:
- `npm run typecheck` clean and `npm test` fully green. The mechanic must be **inert with no Calendar Office** — the existing economy and morale are unchanged, so every current test still passes. New tests covering:
  1. **Inert:** with no Calendar Office, crossing a year boundary changes nothing (no morale shift); the age readout still computes from the clock.
  2. **Age readout:** the colony's reported year/month tracks the sim clock (e.g., after ~one colony-year of stepping, the year reads 1).
  3. **Founders' Day lift:** with a built, staffed Calendar Office, crossing a year boundary eases unrest by about `foundersDayUnrestRelief`, once.
  4. **Once per year:** the lift fires a single time per year, not every step after the boundary.
  5. **Unstaffed passes unmarked:** an unstaffed (or unbuilt) office gives no lift at the year turn.
- On the live game (:5188): build and staff a Calendar Office, watch a **Year / Founders' Day** HUD readout count the colony's age, and confirm the annual morale lift lands once when the year turns.
