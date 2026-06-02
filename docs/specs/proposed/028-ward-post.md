# Spec 028 — The Ward Post: idleness and hardship finally breed unrest
- status: proposed
- proposed-by: **Niko Darr, night-shift ledger clerk at the Levy Office (18:00–02:00), Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A NEW citizen voice — the council's 12th — and fittingly a Levy Office clerk (025), who sees the books lie about how calm a taxed, jobless block really is. Opens a fresh dimension: social order / unrest — the cost of bad governance.
- date: 2026-06-02
- depends-on: 001, 025

## Why (the citizens' case)
Niko Darr: *"Right now I can tax a hungry, jobless block at the same rate as a fed, working one, and the books pretend
both are equally calm. That is nonsense. Build a **Ward Post**. Without it, idleness is harmless; with it, bad
governance finally leaves marks on the streets."*

## Mechanic
- The colony gains an **Order** measure (its inverse is **unrest**). Unrest **rises** from compounding hardship:
  **unemployment** above all, made worse by overcrowding, missed rations, a hard **levy (025)**, failing services /
  low liveability, and long **brownouts (017)**. A fed, employed, well-served colony stays orderly; a jobless,
  squeezed, neglected one grows restless.
- As Order falls, **petty disorder** sets in — small but real: **tax refusal** (lost levy income), **work slowdowns
  and vandalism** (reduced production), and a **less desirable** colony (settlers avoid disorder, and some leave). It
  starts petty; left unanswered it deepens.
- A new building, the **Ward Post**, patrols nearby housing and **reduces unrest** — staffed wardens keep the streets
  safe and buy the council time. It does **not** cure the causes (poverty, joblessness); it holds the line while the
  council fixes them.
- This finally gives **unemployment a consequence** and the **levy a counterweight**: squeeze the colony too hard, or
  leave too many idle, and it shows on the streets.

## Rules & data
- An `unrest` level (0..1) rises while **unrest pressure** is high, and falls while it is low or a Ward Post patrols.
- Unrest pressure builds from **compounding** hardship: a high **jobless fraction** (free labour vs population) is the
  core driver, multiplied by hardship — overcrowding, poor ration coverage (008), a high levy (025), low
  liveability/services, or a brownout (017). A colony that is employed and well-run has ~zero pressure.
- Consequences scale with unrest: a slice of **levy income is refused**, **production slows** (vandalism /
  slowdowns), and **immigration desirability drops**. Petty at low unrest, harsher as it climbs.
- A built + **staffed Ward Post** drives unrest down (coverage by staffing, like the other services); without one, a
  pressured colony's unrest runs to a high plateau.
- Ward Post: build ~10 materials + ~6 components + a build crew of 3; run 2 wardens; a light power draw. *(Niko asked
  for a 6-warden, two-shift post; v1 uses the colony's standard 2-staff sizing — a bigger ward is a later refinement.)*
- **Testability / safety:** gate unrest hard — compounding (high unemployment AND hardship), sustained, deterministic
  — so a well-run, employed colony at a normal levy stays orderly and the founding economy and the **existing tests are
  unaffected**. Unrest must be drivable **deterministically** in a test (drive high unemployment + hardship, or inject
  an unrest level) so the income/production hit and the Ward Post's effect are verifiable without flaky randomness.

## Cost — materials & labour
- To BUILD: treasury + ~10 materials + ~6 components + a 3-colonist build crew.
- To RUN: 2 colonists (wardens) + a light power draw. Without a Ward Post, a restless colony's disorder runs
  unchecked — lost income, slowed work, and settlers turning away.

## Acceptance
- A colony driven into sustained hardship (high unemployment + a hard levy / poor services / overcrowding) grows
  **unrest** that **cuts its income and production** and slows immigration; a built + staffed Ward Post **reduces** the
  unrest and the colony recovers.
- A fed, fully-employed, well-served colony at a normal levy never grows unrest — the founding economy and existing
  tests stay green.
- HUD shows the Order / unrest level and Ward Post coverage. Tests: a driven unrest reduces income/production; a Ward
  Post brings it down; a well-run colony stays orderly.
