# Spec 003 — Workshop: refine materials into components
- status: built
- proposed-by: Mara Quell (founding colonist) — live Hermes inference returned HTTP 400, so written in-character
- date: 2026-06-01
- depends-on: 002

## Why (the citizens' case)
Mara Quell: *"Raw rock and ore are coming out of the ground, but you can't raise a clinic or a decent
home out of rubble. We need a **workshop** — somewhere hands turn raw materials into proper components:
fittings, panels, parts. Caesar's cities lived or died on this; a quarry alone is just a hole, but pair
it with a workshop and you have a city. One mine should feed about two workshops."*

## Mechanic
- New building **Workshop** (fabricator). While **staffed** and while the materials stockpile is not
  empty, it consumes **materials** and produces **components** (a new refined-goods resource).
- **Components** become the next-tier build input: advanced buildings — and later, house upgrades —
  require components, not just raw materials. (Spec 001 generalises: a build may demand materials
  AND/OR components.)
- Research rule (Caesar III): one extractor's output feeds ~two workshops; input:output ≈ 2:1.

## Rules & data
- Full crew: ~5 colonists (count as employed).
- Conversion at full staffing: ~4 materials/day in → ~2 components/day out; scales with staffing
  fraction; **halts when the materials stockpile is empty** (true chain dependency on spec 002).
- New `state.components` resource (starts 0). HUD shows **Components**.
- Build cost: treasury + ~10 materials + a build crew (spec 001 rules).

## Cost — materials & labour
- To BUILD: ~10 materials + treasury + a temporary build crew.
- To RUN: reserves ~5 colonists as fabricators (employed); consumes materials while producing.

## Acceptance
- A staffed workshop with materials available raises `state.components` over sim time and lowers
  `state.materials`.
- No materials ⇒ workshop idles (no components). Understaffed ⇒ proportionally less output.
- HUD shows Components. Tests: workshop converts materials→components; halts without materials; output
  scales with staffing.
