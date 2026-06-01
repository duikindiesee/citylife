# Spec 011 — Civic Pulse Survey Office: the liveability map
- status: built
- proposed-by: **Mara Venn, neighbourhood auditor** — live Hermes citizen (model hermes-codex-gpt-5.5), her 6th accepted proposal (Water Hub 005, Greenhouse 007, Ration Depot 008, Clinic 009, Theatre 010, now the survey)
- date: 2026-06-01
- depends-on: 010
- addresses: docs/research/2026-06-01-zoning-redesign.md (replaces the retired static zone overlay)

## Why (the citizens' case)
Mara Venn: *"From above the whole island looks the same. Build a **Civic Pulse Survey Office** and we can
finally SEE which neighbourhoods thrive and which starve — cool where they're served, hot where they're
not. Then we stop wasting buildings and fix the districts that are actually hurting."*

This is the operator's zoning redesign, earned: the ugly static colour-plan is gone; a useful map takes
its place, and you have to **build** it.

## Mechanic
- New civic building **Civic Pulse Survey Office**. Build it (materials + components + crew); staff it.
- While a **staffed** Survey Office exists, the operator can switch on the **Liveability overlay**: each
  home is tinted by a **liveability score** that blends its water (005), food delivery (008), health
  (009), culture (010) coverage and housing tier (006) — **cyan = thriving, amber = starved.**
- Before an office is built (or while it's unstaffed) the overlay is **unavailable** — the old static
  `ZONE_COLOR` plan tints are retired for good.
- **Off by default**; palette is toned to the Dark City house style (deep space, cyan→amber, no flat
  primaries). Upkeep: the office consumes a trickle of materials (sensors, survey crews).

## Rules & data
- Build cost: treasury + **~18 materials + ~12 components** + a build crew of 3 — a premium civic build.
  (Mara said 90 materials + 35 labour; scaled to CityLife's tighter economy.)
- Run: **2 workers** + **~1 material/day** upkeep.
- Liveability score per home (0..1) = mean of its coverage flags `{watered, provisioned, healthy,
  cultured}` (0 or 1 each) blended with a tier term `((tier − 1) / 2)`; e.g. an all-services tier-3 home
  ≈ 1.0 (cyan), a bare unserved tier-1 home ≈ 0.0 (amber).
- The overlay is available only when `≥1` Survey Office is built AND colony staffing `> 0`.

## Cost — materials & labour
- To BUILD: treasury + ~18 materials + ~12 components + a 3-colonist build crew.
- To RUN: 2 colonists + ~1 material/day.

## Acceptance
- Building + staffing a Survey Office unlocks the Liveability overlay; without one it's unavailable and no
  static zone tints render.
- The overlay tints thriving homes cool and starved homes warm, derived from the real service coverage.
- Off by default; toned palette. Tests: the per-home liveability score is high for a fully-served tier-3
  home and low for a bare home; the overlay-available flag is true only with a built, staffed office.
