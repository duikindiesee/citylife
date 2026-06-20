# Spec 004 — Settler immigration fills housing vacancies

- status: built
- proposed-by: Tomas Vren (works-foreman) — live Hermes inference returned no usable response, so written in-character
- date: 2026-06-01
- depends-on: 001

## Why (the citizens' case)

Tomas Vren: _"Six of us. Six! A single mine swallows every spare hand and there's no one left to build,
let alone refine. We don't need another clever machine — we need **people**. Build the homes and let
settlers come fill them, the way any frontier grows. No homes, no newcomers; no work or no power, they
turn round at the dock."_

## Mechanic

- Habitats provide **housing capacity** (empty homes), not instant residents. `colonists` becomes the
  count of settlers actually living in the colony.
- While there is **vacant capacity** AND the colony is liveable, settlers **immigrate** at a steady
  trickle to fill the vacancies (arriving at the landing/dock).
- If conditions turn bad (power-dead, or capacity removed below the population), settlers **emigrate**
  slowly.

## Rules & data (research-grounded)

- Housing capacity = Σ over habitats of `residentsPerHabitat` (3 each).
- Immigration rate ≈ 1 settler per ~2 in-game hours while vacancies exist and the colony is liveable.
- Liveability v1 (simple; refined by services/goods in later specs): power not in deep deficit AND
  (open jobs exist OR `colonists < capacity`).
- Completing a habitat no longer instantly adds colonists — it adds **capacity**; settlers fill it over
  time. The 2 founding colonists remain as the bootstrap. Population caps at total capacity.

## Cost — materials & labour

- Immigration itself is free (people arrive), but it is **gated by housing** — which costs materials +
  a build crew per spec 001 — and by liveability. No homes ⇒ no settlers.

## Acceptance

- A colony with vacant housing + liveable conditions gains colonists over sim time (up to capacity);
  a full or unliveable (power-dead) colony does not.
- Building a habitat raises capacity, not colonists directly; colonists then rise toward capacity.
- HUD shows population vs capacity (e.g. "Colonists 6 / 9").
- Tests: immigration fills vacancies to capacity; none when full or power-dead; a finished habitat adds
  capacity, not instant residents.
