# Spec 137 — draped junction caps: arm-mouth hull geometry, real-heading furniture, phase-locked signals

The operator (playing first person after the spec-134 collider fix): junctions read as a
"large dark slab misaligned with the diagonal approach arms" — wishing "these
intersections from the old world would work as awesome". Measured live at all 8 boot
junctions before this spec: every slab FLOATED (>=1 corner with 1.2-2.1 m of open air
under the plate), all 25 arm entries STEPPED UP onto it (mean 0.73 m, worst 1.49 m — a
kerb wall across an axis-aligned crossroads; slope, not diagonality, was the driver),
6/8 junctions had diagonal arms crossing the square's corners, and two crossings rendered
twin overlapping slabs with step seams.

## Why the slab was wrong by construction (and had been before)

The spec-127 slab was an unrotated `half*2` square box pinned FLAT at the MAX road height
over the zone + 0.19, while the ribbons drape the terrain per-vertex right up to its
edge. Legacy v2 already tried exactly this (flatten-to-max + slab, commit e711432) and
REVERTED it: "a flat plateau at one height that jutted out over sloping terrain, a big
grey plane with hard wedges where it met the roads. Wrong approach." The replacement law
(roadRibbon.ts) is the operative junction constitution: every road vertex samples height
at its OWN position through the shared bilinear sampler, so all road surfaces are
coplanar by construction. The v3 slab existed only to hide the coplanar z-fight shimmer.

## Design

Solve the z-fight in the PAINT axis, not the height axis. The cap is a third ribbon-like
surface (`junctionCap.ts`, pure):

- **Zones from way-pair EVENTS** (`roadJunctions.ts` rewritten): real segment-segment
  intersections of the smoothed centre-lines, plus endpoint-projection TEE events (the
  centre is the perpendicular projection onto the through way — offset tees centre ON
  the road, not on a blob mean). Events merge only when close AND sharing a way (twin
  zones become one junction; distinct junctions in dense grids never chain-merge).
  Near-miss parallel ways produce ZERO events — no phantom "pass" slabs, and their paint
  survives (the old suppression deleted it with no cap). Arms carry REAL unit headings,
  per-arm half-widths, and a MOUTH distance `d = apron + max(h_other/sin(angle))` so the
  junction tarmac clears every crossing carriageway (28-degree sine floor; shallower
  overlap tips are covered by the kerb-corner fillet points).
- **Cap = the EXACT carriageway union** (v2, operator directive after the live review:
  "find the sides of the road ends, and exactly draw it mathematically" — the v1 convex
  hull over-covered, worst on merged zones, "this is antipattern"). The outline is a
  CCW walk over the arms: a square MOUTH edge across each carriageway at `mouthD`, side
  edges COLLINEAR with each arm's kerb lines, corners at the true kerb-line
  intersections `(h_j + h_i cos Δ)/sin Δ` (near-parallel neighbours connect straight
  along the shared kerb; out-of-reach corners chamfer). Generally NON-convex (reflex
  plus-shape corners), star-shaped around the crossing — fan-tessellated from the zone
  CENTRE to <=1.5-cell edges and DRAPED: every vertex at `roadY + CAP_LIFT (0.205)`.
  The road's painted edge flows into the pad edge with no jog, and the corner fields
  the hull used to pave are grass again. Stack preserved: ribbon 0.18 < cap 0.205 <
  markings 0.23+. Material is ribbon-identical + polygonOffset; one merged mesh
  (`RoadJunctionCaps`). Twin crossings on one road are NO LONGER merged (a single star
  centre cannot draw honest kerbs for two crossing points): each gets its own exact
  pad, anchored at its own event, overlapping benignly along the shared road under a
  per-zone 0/4/8 mm micro-lift. Way pairs are AABB-pruned before the segment sweep so
  hand-built cities rebuild fast.
- **Micro-lift backstop** (`assignWayLifts`): ways sharing a zone are greedy-colored and
  lifted `layer * 0.01` (<= 0.03) so overlapping ribbons are never depth-coincident even
  where a cap is skipped (stale ways, water guard) — the systemic end of the shimmer.
- **One boundary for paint**: `buildRoadRibbons(ways, opts, zones)` suppresses dashes and
  edges inside the cap hull inflated 0.6 cells (the old JR=2 cell dilation reached
  16-20 m while the slab covered 9.2 m — a naked unmarked annulus on every approach).
  Zebra crossings moved INTO the cap builder, anchored at the arm mouths (always kissing
  the cap edge, correctly rotated on diagonal arms); lane-wide stop bars and kerb-line
  perimeter paint bake into one `RoadJunctionPaint` mesh. WITHOUT zones (the legacy
  v1/v2 PlanetRenderer call site) buildRoadRibbons behaves exactly as before.
- **Furniture from real headings** (`junctionFurniture` rewritten): signals/signs stand
  on the LEFT VERGE of their approach (SA drive) computed from the arm's unit heading —
  never compass-snapped, never inside any arm's carriageway (validated + pushed clear).
  The STOP board is UPRIGHT now (the old octagon lay face-up — an invisible 3 cm red
  line from eye height) and faces the approaching driver. Signals scale with the lane
  (5.8 m pole, mast reaching over the approach, 1.2 m head) and PHASE-LOCK to the shared
  frame clock: axis group A holds green while group B holds red, all-red inter-greens,
  per-junction hash offset (`signalState`, pure). The per-light setTimeout state machines
  that turned every approach green simultaneously are gone.
- **Grading + foliage know the cap**: `capCoverageCells` unions the hull cells into the
  spec-130 leveling coverage (ground rises under the corner aprons the ribbon sweep
  misses) and junctions clear their trees like lots do (conifers grew through the slab).

## Tests

- `tests/roadJunctions.test.ts` (rewritten, 12): true-intersection centring, offset-tee
  projection, parallel near-miss => zero zones, hairpin twin-merge, per-arm widths,
  45-degree real headings with deeper mouths, per-arm signals with phase groups, poles
  never inside any carriageway, upright-sign placement/left verge, bends bare, axisAngle.
- `tests/junctionCap.test.ts` (8): hull contains the overlap square and the 45-degree
  analytic overlap parallelogram; every cap vertex at roadY+0.205 (1e-6) on sloped
  synthetic terrain; junction paint 20-60 mm above the cap; coverage rasterizes every
  hull cell at road height incl. the corner cells beyond the arm sweep; signal phasing
  never double-green with all-red inter-greens; water-centred zones fail soft.
- `e2e/roadRibbons.spec.ts` (contract updated deliberately): asserts the cap mesh exists,
  samples ~60 live cap vertices and requires |y - (roadY + 0.205)| < 5 mm (the no-float
  invariant the slab failed by up to 2.1 m), junction furniture present, and the old
  slab-count probe is gone.

## Notes / follow-ups

- Zones are recomputed in three memos (ribbons, leveling coverage, foliage) — pure and
  ~ms at boot scale; a shared store entry is a cleanup candidate if road-edit rebuild
  cost ever shows up.
- Vehicles clamp to ribbon height (0.18) and sink 25 mm into the cap at junctions —
  tyre-contact depth, vs up to ~0.7 m under the old slab. A `roadLiftAt(x,y,zones)`
  helper is the hook if it ever reads wrong.
- Stale post-bulldoze ways degrade to capless (water-guarded) junctions; the micro-lift
  keeps the overlap shimmer-free there.
