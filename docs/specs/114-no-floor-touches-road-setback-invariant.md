# Spec 114 — no floor touches road setback invariant

Priority live fix for the corner-garage and founder-plot street overlap regression.

## Invariant

No building floor, garage pad, garage forecourt, or plot border/fence footprint may overlap or 4-neighbour touch any cell in the **final** `sim.state.roads` set.

Touch means direct 4-neighbour adjacency:

- same cell as a road cell
- east/west/north/south adjacent to a road cell

## Covered live seeds

The invariant is pinned on the reproduced live seeds:

- `4242`
- `42`
- `7`

## Implementation notes

- `footprintTouchesRoad` is the pure predicate for the invariant.
- Garage candidates are surveyed with a one-cell setback from both road centre-lines before final widening.
- `garagePadFits` rejects direct road cells and 4-neighbour adjacency to the commercial street/cross-street/mall/shop exclusions.
- Runtime commercial road widening excludes the garage pad and pylon island, and also respects residential setback halos.
- The garage forecourt is clamped so its front edge stays inside the pad.
- Plot generation rejects fence rings that overlap or touch the local road corridor; late road merges prune any road cell that would overlap or touch a lot fence in final `sim.state.roads`.
