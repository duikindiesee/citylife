# Spec 009 — First Aid Clinic: health keeps the workers working
- status: built
- proposed-by: **Mara Venn, quartermaster of Block 7** — live Hermes citizen (model hermes-codex-gpt-5.5), her 4th accepted proposal (Water Hub 005, Skyfarm Greenhouse 007, Ration Depot 008, now health)
- date: 2026-06-01
- depends-on: 005

## Why (the citizens' case)
Mara Venn: *"Injuries and sickness should reduce worker output unless they're treated. Build a **First Aid
Clinic** — keep the folk near it healthy, and the mines and workshops keep running as we grow. Let a
colony skip medicine and watch its output sag."*

## Mechanic
- New building **First Aid Clinic** (health service). While **staffed**, it keeps habitats within
  `clinicRadius` healthy.
- **Health coverage** = the fraction of homes within reach of a clinic (like watered, spec 005, and
  provisioned, spec 008).
- **Sick workers produce less**: the colony's production (mines, workshops, greenhouses) scales by a
  health factor — an uncovered colony works at ~60%, a fully-covered one at 100%. As the colony spreads,
  build clinics or output sags. This is the first mechanic where a **service drives the economy**, not
  just immigration.
- Hook for spec 006: the **top housing tier** may later also require health — a future refinement.

## Rules & data (Mara's proposal, adapted to CityLife's scale)
- Build cost: treasury + **~14 materials + ~10 components** + a build crew of 3. (Mara said 45 materials
  + 18 labour; scaled to CityLife's tighter economy, components kept as the sink.)
- Run: **2 workers**; **~1 component/day** upkeep (medicine, supplies).
- Coverage: `clinicRadius` ≈ 8 cells; a staffed clinic keeps the homes in range healthy.
- Health factor on production = `0.6 + 0.4 * healthFraction` (uncovered 0.6 → fully covered 1.0).

## Cost — materials & labour
- To BUILD: treasury + ~14 materials + ~10 components + a 3-colonist build crew.
- To RUN: 2 colonists + ~1 component/day.

## Acceptance
- A staffed clinic near homes raises health coverage, and production rises with it.
- The same colony produces **less with no clinic than with clinic coverage** (sick workers work slower).
- Homes outside every clinic's reach are not covered. HUD shows a health indicator.
- Tests: a clinic raises the health fraction; production is higher with clinic coverage than without;
  out-of-range homes stay uncovered.
