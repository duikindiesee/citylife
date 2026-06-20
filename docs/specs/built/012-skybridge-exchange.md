# Spec 012 — Skybridge Exchange: trade surplus for treasury

- status: built
- proposed-by: **Bram Teel, dock-trader** — live Hermes returned empty (upstream flaky on this tick), written in-character. A new voice — the colony's first trader, not Mara Venn.
- date: 2026-06-01
- depends-on: 003

## Why (the citizens' case)

Bram Teel: _"We're not alone out here — there are other rocks in the dark, and they'll pay for what we
make too much of. Right now our spare components and grain just sit in the stores going nowhere. Give me
a **Skybridge Exchange** and I'll ship the surplus out and bring back coin — coin you can spend on the
next mine, the next clinic. A colony that only feeds itself never gets rich."_

## Mechanic

- New building **Skybridge Exchange** (trade post). Once **built and staffed**, each day it **exports the
  SURPLUS** of the colony's goods to neighbouring colonies for **treasury**.
- Only surplus is sold — the Exchange keeps a **reserve** of each good so the colony never trades away
  what its own builds, upgrades and services still need.
- This is the colony's first link to the wider Kookerverse: overproduction becomes **income**, giving the
  operator a reason to overbuild mines and workshops and a new lever to fund growth.

## Rules & data

- Build cost: treasury + **~16 materials + ~12 components** + a build crew of 3.
- Run: **2 workers** (an unstaffed Exchange trades nothing).
- Export, per day, per staffed Exchange (throughput-capped so more trade needs more Exchanges):
  - **components** above a reserve of ~20 sell at **~$40 each** (cap ~10/day);
  - **food** above a reserve of ~30 sells at **~$12 each** (cap ~15/day).
- Selling deducts the goods from the stockpile and adds the proceeds to `treasury`. Below the reserve,
  nothing is exported.

## Cost — materials & labour

- To BUILD: treasury + ~16 materials + ~12 components + a 3-colonist build crew.
- To RUN: 2 colonists (and surplus goods to sell — no surplus, no trade).

## Acceptance

- A staffed Exchange with surplus components/food raises treasury each day and draws the surplus down to
  the reserve; with stockpiles at or below the reserve, it exports nothing.
- No Exchange → no export income (the mechanic is gated on the building + its crew).
- HUD shows recent trade income (or the Exchange's export rate). Tests: surplus above reserve is sold
  (treasury up, surplus down); at/below reserve nothing sells; an unstaffed Exchange trades nothing.
