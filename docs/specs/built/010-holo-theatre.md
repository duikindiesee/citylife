# Spec 010 — Holo-Theatre: culture draws the skilled settlers

- status: built
- proposed-by: **Mara Venn, ration-depot quartermaster** — live Hermes citizen (model hermes-codex-gpt-5.5), her 5th accepted proposal (Water Hub 005, Greenhouse 007, Ration Depot 008, Clinic 009, now culture)
- date: 2026-06-01
- depends-on: 009

## Why (the citizens' case)

Mara Venn: _"People want more than to just get by. Build a **Holo-Theatre** — wealthy homes need
entertainment, or they sour and the skilled folk drift away. Give a colony culture and the good migrants
come."_

## Mechanic

- New building **Holo-Theatre** (culture service). While **staffed**, it covers habitats within
  `theatreRadius`, screening shows that draw on the colony's manufactured goods.
- **Culture coverage** = the fraction of homes in reach of a theatre (like watered 005, healthy 009).
- A **cultured colony is more desirable**: immigration gains a bonus scaled by culture coverage, so a
  colony with theatres grows faster and pulls in skilled settlers. (Health 009 keeps the workers you have
  productive; culture is how you attract _more_.)
- Upkeep: a theatre **consumes components per day** (entertainment media — the most expensive ongoing
  sink yet). Mara's dedicated "Data-Reel" goods chain (crystal → reels) is noted as a **future spec** to
  keep this slice small; for now components stand in for the media.

## Rules & data (Mara's proposal, adapted to CityLife's scale)

- Build cost: treasury + **~16 materials + ~14 components** + a build crew of 3 — a premium build.
  (Mara said 80 materials + 25 components + 30 labour; scaled to CityLife's tighter economy.)
- Run: **2 workers**; **~1.5 components/day** upkeep.
- Coverage: `theatreRadius` ≈ 8 cells.
- Desirability: up to **+40% immigration** at full culture coverage (`× (1 + 0.4 · cultureFraction)`).

## Cost — materials & labour

- To BUILD: treasury + ~16 materials + ~14 components + a 3-colonist build crew.
- To RUN: 2 colonists + ~1.5 components/day.

## Acceptance

- A staffed theatre near homes raises culture coverage, and immigration is faster than the same colony
  with no theatre.
- Homes outside every theatre's reach are not covered. HUD shows a culture indicator.
- Tests: a theatre raises the culture fraction; immigration is faster with culture coverage than without;
  out-of-range homes stay uncovered.
