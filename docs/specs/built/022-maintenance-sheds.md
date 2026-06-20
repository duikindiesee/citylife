# Spec 022 — Maintenance Sheds: a colony that never repairs itself quietly rusts out

- status: proposed
- proposed-by: **Mara Venn, battery-shed attendant, dusk shift (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara's 10th spec and Hermes's 6th live proposal in a row. Opens a fresh dimension: upkeep / decay over time.
- date: 2026-06-02
- depends-on: 001, 003

## Why (the citizens' case)

Mara Venn: _"Right now, once a district is built it mostly stays fixed unless power, labour, health, skill or
commute fails. Landing One needs a basic upkeep layer so dense, high-value districts require ongoing care —
not just one-time construction. If my battery banks need checking every night, so do the ration depots,
clinics, theatres and skybridge machinery holding this island together. Build **Maintenance Sheds** and send
repair crews along the paths, or everything quietly rusts out over the cloudsea."_

## Mechanic

- Every **working building** (anything that employs a crew — mines, workshops, foundries, greenhouses,
  depots, clinics, theatres, exchanges, academies, transit depots, scrubbers, masts, the survey office)
  slowly accrues **wear** while it operates. Homes don't wear — only the machinery.
- A new building, the **Maintenance Shed**, dispatches repair crews across a local radius: any working
  building within reach of a _staffed_ shed has its wear steadily repaired back down.
- **Wear has teeth.** Past a healthy threshold a worn building loses efficiency; left long enough it wears
  out and barely limps until a crew reaches it. This is the first mechanic where neglect _degrades what you
  already built_, not just slows new growth.
- Wear is **per-building** (unlike the colony-wide health/power/skill/commute factors): a single uncovered
  foundry can rust while the rest of the colony hums. It multiplies that building's own output, stacking
  with the colony-wide factors.

## Rules & data

- Each working building carries `wear` in 0..1, starting 0. While it operates: `wear += wearPerDay × dt`
  (`wearPerDay ≈ 0.06`/day → fresh to fully worn in ~16 days if never serviced).
- A **staffed** Maintenance Shed within `maintRadius` (~8 cells) of a building repairs it:
  `wear -= repairPerDay × dt` (`repairPerDay ≈ 0.5`/day) — a covered building stays pinned near 0.
- Effect on that building's output (`maintFactor`):
  - `wear ≤ wearHealthyThreshold` (~0.5) → factor 1 (grace period; new machines don't need a wrench).
  - above it, factor ramps linearly down to `maintFloor` (~0.25) at `wear = 1` (worn out — it barely limps
    until repaired).
  - `maintFactor` multiplies that building's production, stacking with staffing × health × power × skill ×
    commute.
- Maintenance Shed: build ~12 materials + ~8 components + a build crew of 3; run 2 fitters; consumes
  ~1 component/day as spare parts (the ongoing sink). One shed covers everything in its radius.
- _(Mara asked for a 4-fitter, 6-crew shed; v1 uses the colony's standard 2-staff / 3-crew service sizing to
  match the existing buildings — a larger crew, and faster wear on heavy industry, are later refinements.)_

## Cost — materials & labour

- To BUILD: treasury + ~12 materials + ~8 components + a 3-colonist build crew.
- To RUN: 2 colonists (fitters) + ~1 component/day in spare parts. Without sheds, every working building
  slowly wears and loses output; dense industrial districts rust fastest and need coverage first.

## Acceptance

- An uncovered working building (e.g. a mine) accrues wear over many days and produces measurably **less**;
  the same building inside a staffed Maintenance Shed's radius keeps wear low and output high.
- A freshly built building under the healthy threshold pays no penalty.
- Wear is recoverable: a worn building brought back under a shed's coverage repairs and returns to full
  output.
- HUD shows an upkeep indicator (worst wear %, or a count of buildings needing maintenance). Tests: wear
  climbs and output drops without a shed; a shed keeps wear low / restores output; under-threshold has no
  penalty.
