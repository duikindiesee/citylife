# Spec 005 — Water Hub: the first service, built from components

- status: built
- proposed-by: **Mara Venn, dockhand of East Pontoon** — live Hermes citizen (model hermes-codex-gpt-5.5)
- date: 2026-06-01
- depends-on: 003

## Why (the citizens' case)

Mara Venn: _"Homes need a basic service that consumes our components and keeps settlers alive and happy.
Without water, immigration should stall and sickness should rise. Build a **Water Pump & Pipe Hub** — it
gives our crates of components a purpose and keeps the homes breathing."_

(This is the first spec proposed by a **real Hermes citizen** via the kooker inference, not a fallback.)

## Mechanic

- New building **Water Hub** (service). It has a **coverage radius**: habitats within range are marked
  **watered/served**. Operated by 1 worker; consumes a small trickle of **components** to run (Mara's
  "ongoing component maintenance demand").
- It is the first **service** and the first **component sink**: it costs **components** to build,
  closing the chain materials → components → services.
- Served housing is liveable; **unserved housing stalls immigration** (ties into spec 004) and is the
  hook for future sickness / clinics / bathhouses.

## Rules & data (Mara's proposal, adapted to current resources)

- Coverage radius ~7 cells; serves habitats within range (Mara: "water to 20 homes").
- Build cost: treasury + ~10 materials + **8 components** + a build crew of 3 (blocked if components < 8).
- Run: reserves 1 colonist (operator) + consumes ~0.5 components/day maintenance while running.
- `state` tracks the served-housing fraction; exposed for liveability (spec 004) and the HUD.
- CityLife currently has generic materials/components, not Mara's separate metal/timber/pipe-components —
  splitting materials into types is a later spec; for now her costs map onto materials + components.

## Cost — materials & labour

- To BUILD: treasury + ~10 materials + **8 components** + a 3-colonist build crew.
- To RUN: 1 colonist operator + ~0.5 components/day maintenance.

## Acceptance

- A Water Hub marks habitats within its radius as served; HUD shows "X% homes watered".
- Build is blocked when components < 8 (the component sink works); components deducted on build.
- Tests: served fraction rises when a hub covers habitats; build blocked when components < cost;
  components deducted on build and a trickle consumed while running.
