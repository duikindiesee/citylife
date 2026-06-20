# Spec 001 — Materials + labour-gated construction

- status: built
- proposed-by: claude (founding spec, pre-council)
- date: 2026-06-01
- depends-on: none

## Why (the citizens' case)

"Buildings appear overnight with nobody to raise them and nothing to raise them from." Today `autoGrow`
pops a building every 8 game-hours gated only by treasury — no people, no supplies, no plan. The colony
wants construction to mean something: it should take **hands** (free colonists) and **materials**.

## Mechanic

- New colony resource: **materials** (generic build supply). Starts as a dropship stockpile; later
  produced by extraction (a quarry/mine — future spec).
- A build only starts when the colony has **enough materials** AND **enough free labour** (colonists not
  already employed and not already on a build crew). Otherwise the build is deferred — nothing pops up.
- Starting a build **deducts its materials** and **reserves its crew** for the build duration; the crew
  is released when construction completes.

## Rules & data

- `materialsStart`: 40 units.
- Per build — materialsCost / crew: habitat 6 / 2, commercial 8 / 3, industrial 10 / 3, solar 5 / 2.
- `freeLabour = colonists − filledJobs − reservedBuildCrew`.
- `autoGrow` proceeds only if `materials ≥ cost` AND `freeLabour ≥ crew` (and `treasury ≥ cost` as before).
- No auto-regeneration: once the stockpile is gone, building stops until a materials source exists —
  which forces the next specs (extraction → workshops).

## Cost — materials & labour

This spec _defines_ the materials+labour system. Itself: the dropship grants 40 materials, and the two
founding colonists are the first available crew.

## Acceptance

- A fresh colony does NOT auto-grow buildings once materials or free labour run out (no timer pop-up).
- HUD shows Materials (and free labour).
- Tests: with 0 materials, `autoGrow` builds nothing; with 0 free labour, `autoGrow` builds nothing;
  materials decrease as builds start; crew is freed on completion.
