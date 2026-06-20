# Spec 015 — The full-service top tier: grand homes demand everything

- status: built
- proposed-by: **Ravi Okondo, colony architect** — live Hermes returned empty (upstream flaky for a fourth tick), written in-character. Ravi returns to deepen the housing ladder he first proposed (spec 006), now that the whole service stack exists.
- date: 2026-06-01
- depends-on: 006, 008, 009, 010

## Why (the citizens' case)

Ravi Okondo: _"I gave you homes that grow on water and goods — but a true estate, the top tier, should
demand everything we've learned to provide. Let the grandest homes rise only where the people are watered
AND fed AND healed AND entertained. Then every hub, depot, clinic and theatre we raise earns its keep in
the housing itself, and a tier-3 district becomes a banner: this is a place that wants for nothing."_

## Mechanic

- Housing evolution (006) deepens. A habitat climbs:
  - **T1 → T2**: watered + spare components — _as today_ (spec 006).
  - **T2 → T3**: now requires the **full service stack** — watered AND **fed** (a Ration Depot in range
    with food, 008) AND **healthy** (a Clinic in range, 009) AND **cultured** (a Theatre in range, 010) —
    plus spare components.
- A **T3 home that loses any of those services devolves** to T2 after the grace period.
- Every service finally matters for the grandest homes; a tier-3 district is a colony firing on all
  cylinders, and the liveability map (011) lights up cyan where it has happened.

## Rules & data

- **No new building** — a rule on the housing ladder (006), reusing the per-home coverage helpers from
  005 / 008 / 009 / 010 (the same ones the liveability score uses).
- T2 → T3 gate: `watered AND provisioned AND healthy AND cultured` (each within that service's radius of
  the home) AND `components ≥ housingUpgradeCost`.
- T3 devolve: if a tier-3 home loses water, food, health OR culture coverage past the existing grace
  period, it steps down to T2.

## Cost — materials & labour

- **No build cost** (a rule, like 006 and 014). The real cost is **indirect**: to grow a single T3 home
  you must have built and staffed the whole service stack — Water Hub + Ration Depot + Clinic + Theatre —
  within reach of it, i.e. the materials, components and crews of all four. Nothing reaches the top tier
  for free.

## Acceptance

- A watered home with components reaches T2 but **cannot** reach T3 unless it is also fed, healthy and
  cultured.
- A fully-served home with components climbs to T3; remove any one service and it devolves to T2.
- Tests: a partial-service home caps at T2; a full-service home reaches T3; losing a service devolves a
  T3 home.
