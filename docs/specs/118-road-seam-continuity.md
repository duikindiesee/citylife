# Spec 118 — road seam continuity (shared boundary heights)

Operator screenshot 2026-07-04: a visible step where two road segments meet at a grade
change. Root cause in `R3FRoadNetwork`: each tile box pitched around its own center with a
slope sampled from NEIGHBOR CENTERS 8m apart, and intersections/corners were forced flat
at their own height — adjacent segments never agreed on the height of their shared
boundary, so every grade change and every corner-on-a-slope produced a ledge.

## Design (`src/colony/render/roadPitch.ts`, pure + node-testable)

- **One shared edge height per boundary** — `roadEdgeHeight` is symmetric by construction
  (both neighbors compute the identical value): flat tiles win (a flat slab has one
  height, so pitched neighbors bend to meet it), two pitched tiles meet at the midpoint,
  a missing neighbor means the dead end holds its own height. That symmetry IS the
  no-seam invariant, pinned by tests.
- **Segments land exactly on their edges** — `pitchBetweenEdges(hIn, hOut)` returns
  rot = atan2(drop, 4), centerY = midpoint, length = hypot(4, drop). Exactness identities
  (tested to 1e-12): the ends land on the edge heights and the projected footprint stays
  exactly one 4m cell (orthogonal purity).
- **Half-segments per cell** (added after the adversarial verify CONFIRMED crest
  clipping): a single edge-to-edge box dives under the cell's own surface on a convex
  crest, because both edges are dragged down by lower neighbors. `pitchCellHalves` renders
  each pitched cell as two half-segments meeting at the CELL'S OWN height in the middle —
  outer ends still land exactly on the shared edges (the no-seam invariant survives the
  split), and the crest guarantee returns: the surface never dips below the cell's sampled
  height at its center. On a monotone grade the two halves are collinear (no kink).
- Article I holds: straights pitch along travel only, roll locked at zero, intersections
  and corners stay flat. Curbs, center lines and the surface boxes all stretch to the
  pitch hypotenuse so nothing shortens or gaps on slopes.
- Improvement over the old sampling: a road edge with NO road neighbor no longer pitches
  toward empty terrain — dead ends stay level.
- Bonus verify finding fixed: `getSmoothRoadY`'s float loop (`dx += 0.2`) accumulated to
  0.6000000000000001 and silently sampled an asymmetric -0.6..+0.4 footprint; integer
  loop indices restore the symmetric +/-0.6 coverage.

## Known limitation

Two ADJACENT flat tiles (e.g. two touching intersections) on ground with different
heights still step — a single flat slab cannot honor two different edge heights. Both
sides agree on max, halving the visual error. Rare on the 90-degree grid; a ramp skirt is
a possible follow-up if it ever shows up in play.

## Tests

`tests/roadPitch.test.ts` (11): mask classification (pitch axes disjoint, junctions
flat), edge symmetry from both sides, flat-wins, dead-end behavior, exact edge landing,
exact footprint, and the chain test — a six-cell road over rolling ground has zero step
at every boundary.
