# Spec 026 — The Fever Watch: health stops being a number and starts to spread

- status: proposed
- proposed-by: **Tavi Orro, dawn-shift sorter at Ration Depot 3 (Landing One)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A NEW citizen voice — the council's 10th — and an _Orro_, kin to Jalen Orro (who proposed an earlier mechanic); fittingly one who works the ration queues, where a cough travels. Opens a fresh dimension: population-wide dynamics — the first thing that _spreads_ through the people.
- date: 2026-06-02
- depends-on: 001, 009

## Why (the citizens' case)

Tavi Orro: _"Right now we are just workers in boxes. A clinic keeps a home 'healthy' as a number, but sickness never
breaks out and travels the lift queue. A real colony should fear a cough in the ration line. Build a **Fever Watch** —
hard systems should touch bodies, neighbours, shifts and streets."_

## Mechanic

- A colony-wide **outbreak** can now arise and **spread**. When the colony is in sustained bad shape — poor health
  coverage, crowded homes, and an environmental stressor (smog or a brownout) — a fever takes hold and **compounds**
  (spreads), sickening a growing share of the population.
- A sick population **works less** (production falls as the outbreak grows), and a hot, uncontained outbreak makes
  families **leave**.
- **Clinics (009) reduce severity** — they soften the blow — but they do **not** stop the chain by themselves.
- A new building, the **Fever Watch Post**, is what actually **contains** an outbreak: staffed crews post quarantines
  and send response teams, slowing the spread and speeding recovery. Ignore an outbreak with no Fever Watch and whole
  districts lose their labour at once; build and staff one and the curve bends back down.
- This is the colony's first **population-wide** dynamic — something that travels through the people, not a
  per-building event. (The Bellhouse, 024, answers a single building's incident; the Fever Watch answers the health of
  the whole society.)

## Rules & data

- An `outbreak` level (0..1 — the share of people unwell) rises while **fever pressure** is high, and falls while it
  is low or contained.
- Fever pressure builds from **compounding** bad conditions: low health coverage (009), crowded housing, and an
  environmental stressor — **smog** (019) or a **brownout** (017). A well-served, uncrowded, clean colony has ~zero
  pressure and never sees an outbreak.
- Without a Fever Watch, a sustained-pressure outbreak **grows** (spreads) toward a high plateau; a built + **staffed
  Fever Watch Post** contains it — the outbreak decays back down even while some pressure remains.
- Effect: production scales by roughly `1 − outbreak × penalty` (sick crews are slow); a hot, uncontained outbreak
  also nudges **emigration**. Clinics lower the effective severity (the penalty), not the spread.
- Fever Watch Post: build ~12 materials + ~6 components + a build crew of 3; run 2 (medics + watch aides); a trickle of
  components (medical supply) as upkeep. _(Tavi asked for a 6-strong crew with 2 trained medics; v1 uses the colony's
  standard 2-staff sizing — skilled medics tie to the Academy (020) as a later refinement.)_
- **Testability / safety (important):** the outbreak must be gated hard — compounding conditions, sustained over time,
  deterministic — so the founding economy and the **existing tests see no outbreak** in normal play. An outbreak must
  be drivable **deterministically** in a test (drive the colony into crowded + smoggy/browned-out + unhealthy, or
  inject an outbreak level) so the spread, the production hit, and the Fever Watch's containment are verifiable without
  flaky randomness.

## Cost — materials & labour

- To BUILD: treasury + ~12 materials + ~6 components + a 3-colonist build crew.
- To RUN: 2 colonists (medics + watch aides) + a trickle of components (medical supply). Without a Fever Watch, an
  outbreak runs its course unchecked and the colony can lose whole shifts of labour at once.

## Acceptance

- A colony driven into sustained bad shape (crowded + unhealthy + smog/brownout) suffers a growing outbreak that
  **cuts its production**; a built + staffed Fever Watch Post **contains** it and production recovers.
- A clinic-covered colony suffers a **milder** outbreak (lower severity) than one with no clinics — but clinics alone
  do not end it.
- A healthy, uncrowded, clean colony never sees an outbreak — the founding economy and existing tests are unaffected.
- HUD shows the outbreak level and Fever Watch coverage. Tests: a driven outbreak reduces production; a Fever Watch
  contains it and output returns; clinics reduce severity; normal play stays outbreak-free.
