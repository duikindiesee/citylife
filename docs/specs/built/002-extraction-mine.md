# Spec 002 — Extraction: the materials mine

- status: built
- proposed-by: claude (research-grounded, from the Caesar III study)
- date: 2026-06-01
- depends-on: 001

## Why (the citizens' case)

Spec 001 gave us a materials stockpile but no way to replenish it — once the 40 units are spent,
building halts forever. The research is blunt: extraction is the root of the whole economy, "nothing
downstream can work without raw materials existing." The colony needs to turn the **land** into
materials, or it dies on the launchpad.

## Mechanic

- New building type **Materials Mine** (quarry). Best on rocky terrain (highland/mountain), allowed on
  any land at lower yield. While **staffed**, it produces materials into `state.materials` at a steady
  rate. Understaffed → proportionally less (Caesar III labour model).
- `autoGrow`/planning prioritises a mine when materials are low, so the colony self-heals its supply.

## Rules & data (from the research)

- Full crew: ~6 colonists (count as employed, not free labour). Output scales:
  `materialsPerDay = baseRate * min(1, assignedWorkers / crewFull)`; baseRate ≈ 5 materials/day at full
  staffing (Caesar III's 9.6 cartloads/yr scaled to CityLife's clock).
- Build it like any structure (spec 001): treasury + ~8 materials bootstrap + a build crew.
- Delivered straight to the colony stockpile (no cart logistics yet — a later spec).

## Cost — materials & labour

- To BUILD: ~8 materials + treasury + a temporary build crew (spec 001 rules).
- To RUN: reserves ~6 colonists as miners (employed).

## Acceptance

- With a staffed mine, `state.materials` rises over sim time; with none, it stays flat.
- HUD Materials count climbs once a mine is running; understaffed mine yields less.
- `chooseArtifact` builds a mine when materials run low, so a fresh colony recovers its supply.
- Tests: mine output adds materials; output scales with staffing; no mine ⇒ no materials gain.
