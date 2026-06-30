# Spec 116 — Kookerbos Woods clean reserved plots

## Why

Operator feedback on the live Kookerbos Woods render found three placement failures that block Gerhard's signup/buy test:

1. the woods lane stopped too early for the two intended Kookerbos houses,
2. one plot visually crossed the road,
3. shore-side plots could sit on beach/sea-edge sand.

Kookerbos Woods must provide two small, clean, reserved house plots in the actual woods-side settlement by the island/lagoon: one for the founder and one for Gerhard.

## Mechanic

- `Kookerbos Woods` is the named satellite neighbourhood for the island/lagoon woods side; procedural anchor order must not assign that name to an unrelated road cluster.
- Its first two small woods plots, ordered from the upper/above-road side then left-to-right, are reserved for:
  - `citizen_irwin`
  - `citizen_gerhard`
- These reservations are *not* pre-owned or pre-built. They stay empty so the matching reserved citizen can still buy/build through the normal signup economy, while auto-assignment skips them.
- Small satellite lanes keep a longer road stub past their plots, so the woods road reads as entering the settlement rather than stopping under the houses.

## Placement invariants

For Kookerbos plots, and by construction for all newly placed parcels:

- A parcel footprint must never overlap the carriageway road cells.
- A parcel footprint must be fully buildable and dry.
- A parcel footprint must not include `Beach`, `Ocean`, or `Shallows` biome cells.
- Reserved Kookerbos plots remain small (`COMPACT`/`BIG`-tier dimensions only), unbuilt, and unowned until bought.
- Each reserved Kookerbos plot must keep road frontage through its driveway.

## Determinism

The reservation is derived only from the deterministic neighbourhood placement and stable plot ordering. No wall-clock, randomness, or runtime service data participates in the placement.

## Acceptance

- `tests/kookerbosCleanPlots.test.ts` covers seeds `4242`, `42`, `7`, `99`, `3`, and `11`.
- The test pins exactly two Kookerbos reservations (`citizen_irwin`, `citizen_gerhard`).
- The test asserts Kookerbos footprints are road-clear, buildable, beach-clear, and sea-clear.
- The test asserts both reserved plots retain driveway frontage to the woods road.
