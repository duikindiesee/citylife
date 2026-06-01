# Spec 021 — Skybridge Transit Depots: a colony that can't move its people grinds to a crawl
- status: proposed
- proposed-by: **Tessa Quill, night-shift lift operator (Dock Spire 6)** — **LIVE Hermes** (model hermes-codex-gpt-5.5), an 8th distinct citizen voice and Hermes's 5th live spec in a row. Opens a fresh dimension: movement / connectivity.
- date: 2026-06-02
- depends-on: 001, 002

## Why (the citizens' case)
Tessa Quill: *"The nurses, the miners, the cooks — they spend half the day crossing the island. Pack more
workers onto the rock and the lifts jam, everyone arrives late, and late workers make less. Build
**Skybridge Transit Depots** to carry the crush. A dense colony that can't move its people grinds to a
crawl, no matter how rich it is."*

## Mechanic
- New building **Transit Depot**. Each raises the colony's **commute capacity** — how many workers it can
  move to their jobs each day.
- The colony has a **commute demand** = its working colonists. When demand exceeds capacity the colony is
  **congested**: workers arrive late and **ALL production runs at a reduced transit factor** (down to a
  floor). As the colony grows, you must raise more depots to keep the people flowing.
- Connectivity finally has teeth — like the power grid (017), but for *movement*. It stacks with the
  health (009), power (017) and skill (020) factors.
- (Tessa's full vision — actual routes between named districts, per-line overload — is a future deepening;
  v1 is a single colony-wide commute capacity.)

## Rules & data
- `transitDemand` = employed colonists (`min(colonists, totalJobs)`).
- `transitCapacity` = `transitBaseCapacity` (~8 — the founders walk) + `#depots × transitPerDepot` (~10).
- `transitFactor` = `clamp(capacity / max(1, demand), congestedFloor (~0.6), 1)` — multiplies all
  production (mines, workshops, foundries, greenhouses).
- Transit Depot: build ~16 materials + ~10 components + a build crew of 3; run 2 dispatchers. (Tessa asked
  for skilled dispatch; skilled-staffed depots are a future refinement, v1 uses plain workers.)

## Cost — materials & labour
- To BUILD: treasury + ~16 materials + ~10 components + a 3-colonist build crew.
- To RUN: 2 colonists (dispatchers). Without enough depots, a growing colony congests and **all** its
  production slows until the lines are expanded.

## Acceptance
- A congested colony (more workers than capacity) produces **less** than the same colony with enough
  Transit Depots; building depots clears the congestion and restores output.
- A small, under-capacity colony pays no transit penalty.
- HUD shows commute demand vs capacity (or a congestion indicator). Tests: over-capacity reduces
  production; depots restore it; under-capacity has no penalty.
