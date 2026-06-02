# Spec 030 — The Civic Feast: the council buys one honest cheer
- status: proposed
- proposed-by: **Bren Kalo, night-shift winch foreman at Transit Depot Three, Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A NEW citizen voice — the council's 14th — and fittingly a foreman at Transit Depot Three (021), the depot Tessa Quill proposed and Mara Venn dispatched from. Opens a fresh dimension: the colony's first POSITIVE event — turning stored wealth into goodwill.
- date: 2026-06-02
- depends-on: 025, 028

## Why (the citizens' case)
Bren Kalo: *"Taxes and wages make the treasury feel real. But if all surplus becomes girders and pipes, folk start
thinking the council sees us as machinery. A feast turns stored wealth into goodwill — it says the colony is not just
surviving, it belongs to us. Let the council buy one honest cheer before the next brownout."*

## Mechanic
- A new building, the **Feast Deck**: a public deck with cook-tables, lantern rigging, benches and a council notice
  mast, raised beside a ration depot or market. It is not a standing service like the theatre; it is the **venue** for a
  council event.
- When the treasury is healthy, the council funds a **Founding Feast** — a **timed colony event**. It spends
  **treasury + supplies** (rations and housewares) up front, then runs for a **window of several days**, during which:
  - **unrest eases** (a feast calms a restless colony — the first POSITIVE answer to unrest, alongside the Ward Post's
    suppression and generous wages),
  - **immigration rises** (the Courier can honestly broadcast that Landing One fed and thanked its people).
- This is the colony's **first positive, timed event** — every event so far has been a setback (an incident, an
  outbreak). It turns the treasury the levy (025) fills, and a Pay Office surplus, into a reason to stay.
- A feast can be **called by the council** (a one-press civic action) and is **auto-called by the colony** when it can
  afford one and the people need cheering — so a well-run, wealthy colony throws feasts on its own.

## Rules & data
- A **Feast Deck** must be built + staffed to host. While no feast runs, the deck stands idle.
- Calling a **Founding Feast** spends, up front: ~`feastTreasuryCost` (≈300 credits) + ~`feastFoodCost` (≈20 rations) +
  ~`feastWaresCost` (≈6 housewares / components). It requires a built + staffed Feast Deck and enough treasury +
  supplies; otherwise it cannot be called.
- A called feast runs for `feastDurationDays` (≈3 days). While active: unrest gets an extra **feast relief** each day
  (it calms faster, and the feast damps unrest pressure), and immigration desirability gets a **feast bonus** (≈+25%).
- **Auto-call:** when a staffed Feast Deck stands, the treasury sits comfortably above the feast cost, no feast is
  already running, and the colony would benefit (elevated unrest, or simply a periodic civic calendar), the colony funds
  a feast itself.
- Feast Deck: build ~12 materials + ~8 components + ~2 reels + a build crew of 3; run 2 stewards. *(Bren asked for a
  12-builder deck and a 6-crew feast; v1 uses the colony's standard sizing — bigger, district-reaching feasts are a
  later refinement.)*
- **Testability / safety:** a feast only fires when **called** (manually, or auto-gated on a healthy treasury + a
  staffed deck), so with no Feast Deck and no active feast the mechanic is inert and the founding economy and existing
  tests are unaffected. The feast effect must be drivable deterministically (call a feast directly) for tests.

## Cost — materials & labour
- To BUILD the Feast Deck: treasury + ~12 materials + ~8 components + ~2 reels + a 3-colonist build crew.
- To RUN: 2 colonists (stewards) to keep the deck; and **each feast** spends ~300 treasury + ~20 food + ~6 components.
  Without a Feast Deck and the treasury to fund it, the council cannot buy the colony's goodwill — surplus stays cold.

## Acceptance
- With a staffed Feast Deck and a healthy treasury, calling a Founding Feast **spends treasury + food + components** and
  starts a multi-day event during which **unrest falls faster** and **immigration rises**; when the window ends, the
  boosts lapse.
- A feast cannot be called without a Feast Deck, or without enough treasury + supplies.
- No Feast Deck / no active feast → the mechanic is inert; the founding economy and existing tests are unchanged.
- HUD shows a Feast control (call a feast) and, while one runs, the days remaining. Tests: a called feast deducts
  treasury/food/components and eases unrest + lifts immigration for its window; it lapses after; it cannot be called when
  unaffordable or deckless.
