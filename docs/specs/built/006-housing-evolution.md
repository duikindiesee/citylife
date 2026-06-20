# Spec 006 — Housing evolution: homes upgrade when served and supplied

- status: built
- proposed-by: Ravi Okondo (colony architect) — live Hermes returned 502/empty (upstream flaky), written in-character
- date: 2026-06-01
- depends-on: 005

## Why (the citizens' case)

Ravi Okondo: _"A bunk is not a home. Give a house water and a steady trickle of components — fittings,
panels, comforts — and it earns its keep: it grows, holds more families, and folk are glad to stay.
Starve it of water or goods and it slides back to a shed, and the newcomers stop coming."_

## Mechanic

- Habitats gain a **tier** (1..3). A habitat **upgrades** to the next tier when it is **watered** (in
  range of a Water Hub, spec 005) AND the colony has spare **components** (consumed on upgrade).
- Higher tiers hold **more capacity** and raise colony **desirability** (faster immigration, spec 004).
- A habitat **devolves** a tier if it loses water or components run dry past a grace period.

## Rules & data (research-grounded — Caesar III housing ladder)

- Tier capacities: **3 / 5 / 8** residents. `housingCapacity` sums each habitat's current-tier capacity.
- Upgrade: a watered habitat below max tier upgrades on an interval if `components >= upgradeCost`
  (~3 components), consuming them. Unwatered / under-supplied habitats cannot upgrade.
- Devolve: an unwatered habitat steps down a tier after a grace period (slow), lowering capacity.
- Desirability: higher mean tier → higher immigration rate (hooks into spec 004).

## Cost — materials & labour

- Upgrading consumes **~3 components per tier step** — the second real component sink (after the Water
  Hub). No extra labour to upgrade (residents improve their own home), but the water it needs costs the
  Hub's upkeep (spec 005).

## Acceptance

- A watered habitat with spare components upgrades over time (capacity rises); an unwatered one does not,
  and devolves.
- Components are consumed on each upgrade (the sink works).
- HUD shows the housing tier mix (e.g. "Homes: T1 ×3 · T2 ×2 · T3 ×1").
- Tests: a watered+supplied habitat upgrades, gains capacity, consumes components; an unwatered one does
  not; devolution triggers on water loss.
