# Spec 133 — roads pave rough land; the guard is water-only

Second walk-under-the-road report (Sol 34): the operator dropped beneath the ribbon on the
main road, next to a spot where the asphalt looked ragged on one side.

## Root cause

The ribbon's cell guard (`roadSurfaceCellOk`, spec 115 lineage) rejected `buildable === 0`
LAND — steep or sunken pockets — as well as water. The seeded boot ways cross **59 such dry
pockets** (measured live): at each one the mesh skipped segments (the ragged holes) while
neighbouring segments' quads bridged the pocket at rim height, AND the spec-130 grading
skipped the same cells (same guard), so the ground never rose — an ungraded dip under a
floating road surface. The terrain's own doc already said the intent: *"Roads stop at
water (a bridge spans it later); steep land is not water, so roads may cross it and drape
over the slope."*

## Fix

`cellOkOn` keeps roads off WATER only — ocean/shallows/river biomes and any water-flagged
cell (belt + braces: dried-shallows edge cells carry `water = 0` but still read as water) —
and allows rough dry land. The relaxation flows to both consumers at once: the mesh paves
across the pockets (no more holes) and the grading (spec 130) reshapes the ground beneath
them to the road surface (no more walking under). The spec-115 water contract holds,
re-asserted across three seeds.

## Tests

- `tests/roadWaterGuard.test.ts` — ribbon criterion evolved to the water-only contract
  (ocean/shallows/river/water-flag); sim road-cell criterion unchanged; three seeds.
- `tests/roadGrade.test.ts` — the ways' coverage now includes unbuildable LAND pockets
  (grading fills them) and never a water cell.
