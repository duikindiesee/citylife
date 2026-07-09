# Spec 129 — house voxel scale (the pancake fix)

After spec 128 seated the houses on their pads, the operator could finally see them — and
they were knee-high pancakes: "I still look taller than the house... I can even walk over
houses."

## Root cause

The legacy renderer meshes houses in a 1-world-unit-per-grid-cell world (its placement even
offsets by half a unit per half-cell), and `VOXEL_Y = 0.22` — the height of one voxel
micro-block — is calibrated for that world. The R3F world is 4 units per cell. The port
scaled the footprint (`cell: LOT_SIZE`) but kept the legacy height, so every house rendered
at full width but a QUARTER of its height: 20m wide, ~1-3m tall.

## Fix

`VoxelHouseMesh` scales the storey height by the same world factor: `voxelY: VOXEL_Y *
LOT_SIZE`. Also adds the legacy half-cell corner offset so the micro-grid seats flush on
the house zone. Proportions are now EXACTLY legacy's, at 4x world scale.

## Tests

`tests/houseScale.test.ts` (3): the R3F mesh bbox is exactly 4x legacy's in every axis; a
house is taller than the first-person walker; and the regression guard pins the old bug
(same width, exactly 1/4 the height).

Known follow-ups: houses have no colliders (the walker/car pass through — legacy behavior);
walk-over is gone simply because the walls are real now.
