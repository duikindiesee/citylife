# Spec 127 — ribbon roads + way-based junctions (R3F), and the builder/frame-speed polish

The operator's playtest of the merged v3 found roads rendering as 2-3 overlapping bordered
strips ("laid triple and double"), ~7 FPS, and painfully slow plot placement.

## Root cause

The road CELLS (`sim.state.roads`) are a deliberately ~3-cell-wide carriageway so traffic,
the bus and the rally have width. The legacy renderer hid that behind ONE smooth centre-line
ribbon per road (spec 088) and explicitly retired per-cell quads. The R3F port never mounted
the ribbon (`setRoadWays` was a no-op) and drew a bordered box per widened cell instead —
plus junction furniture detected off tile-neighbour counts, which on a wide carriageway fires
on nearly EVERY interior cell. Measured live: 70,869 scene meshes, of which the road subtree
held ~102k nodes (3,412 "junction" decoration groups); 7 FPS with roads visible, 12 hidden.

## Design

- **Data path (raceState precedent):** the runtime attaches its centre-lines as
  `sim.state.roadWays`; `roadwaySignature` (roadsVersion + way count) drives rebuilds.
  `useRoadNetwork.plotRoad` appends the drawn blueprint's `[first, last]` centre-line
  (width 1 = a 4m ribbon) so hand-drawn roads render; single-cell roads stay cul-de-sac
  bulbs. Known one-shot limitation (as legacy): bulldozing prunes cells but the ribbon
  polyline lingers until reload; deriving ways from the tile graph is follow-up work.
- **`R3FRoadRibbons`:** builds the proven `buildRoadRibbons` group (~4 merged meshes:
  street/avenue surfaces, edge lines, centre dashes, crosswalks baked in), disposes the
  superseded group on every rebuild (spec 119).
- **Way-based junctions (`roadJunctions.ts`, pure/node-tested):** a junction is where 2+
  DISTINCT ways' smoothed centre-lines pass within ~2 cells (the ribbon's own marking-break
  rule), flood-filled into zones; long thin parallel-run blobs are skipped (not junctions).
  Each zone gets a flat SLAB just above the ribbon surface — capping the coplanar-ribbon
  z-fight that makes main's junctions read broken — plus street furniture from
  `roadFurniture.tsx`: 4 traffic lights + 4 stop lines on a crossing, a stop sign + stop
  line per terminating arm of a tee (left-hand drive). 8 real junctions vs 3,412 false ones.

  **Furniture placement revision (the mid-road bus-stop regression, 2026-07-10).** The
  operator found a "bus stop" standing in the carriageway with yellow paint marching down
  the road. Measured live: 8 of 12 boot-town stop lines and both stop signs stood on
  someone's asphalt. Three rules the layout now follows: a **pass** zone (a merge or chain
  point of collinear ways — the boot generator chains ways end-to-start along corridors)
  gets NO furniture, only the slab; lateral offsets scale with the arm's OWN way width
  (boot roads are 4 cells wide — the fixed 1.9-cell sign shift used to land inside the
  side road's own carriageway); and every item is anchored to the arm's OWN smoothed
  centre-line — walking back by arc length and offsetting perpendicular to the local
  tangent, so own-way clearance holds by construction and only foreign carriageways
  gate the walk (0.35-cell margin; the item is skipped when nowhere in reach clears).
  An adversarial verify round caught the first cut walking a compass-snapped axis from
  the flood-fill centroid instead: a few degrees of arm tilt self-blocked every step and
  silently deleted ALL the boot towns' stop signs while count-free assertions passed
  vacuously. Two more of its findings are law here: opposed terminating-arm pairs are a
  chained corridor flowing THROUGH the zone and get no furniture even when a real side
  road makes the zone a tee, and diagonal arms keep their paint on their own asphalt
  because the offsets follow the true tangent, not the compass. Arms and items carry
  their `wayIndex` so paint is attributed, not just counted. Pinned by
  `tests/roadFurnitureClearance.test.ts` against three real boot towns: signs on zero
  carriageways, every line ON its own carriageway, and signs REQUIRED wherever an
  eligible tee approach exists. Known minor: an item that walks far down a graded
  approach renders at the zone slab's height (sampled within 3 cells of the centroid);
  measured walks stop within ~4.4 cells, so exposure is cosmetic and rare.

- **`R3FRoadNetwork`** keeps only the cul-de-sac bulbs; its per-mesh trimesh colliders are
  gone (nothing collides road meshes — first-person, car and race ride `terrain.worldY` /
  `getSmoothRoadY`). `getSmoothRoadY` moved to `roadSurface.ts` (bus + race re-pointed).

## The rest of the polish (same PR)

- **Build mode always daylight:** both frame loops clamp the clock to noon while
  `builderActive || worldViewActive`.
- **Placement speed:** the terrain heightfield collider (first-person-only) freezes during
  building and recommits when the builder closes; its boxed args are memoized so unrelated
  re-renders stop rebuilding the Rapier collider. The zoning hover preview is one
  mount-once InstancedMesh (cap 154) recolored/re-matrixed per hover instead of 154 fresh
  meshes per pointer-move; `hoverCell` only updates on an actual cell change.
- **Frame speed:** shadow map 4096²→2048²; `shadowMap.autoUpdate` off with a 4-frame
  refresh cadence and the sun re-aimed only when it moves; the static artifacts place once
  on mount instead of per frame.

## Evidence

Scene meshes 70,869 → **204** (ribbon = 4 merged meshes; junctions 8 groups). Tests:
`tests/roadJunctions.test.ts` (zones, arms, furniture), `tests/roadRibbonsState.test.ts`
(attach, merged build, signature, plotRoad append), `e2e/roadRibbons.spec.ts` (scene
collapse + builder-not-broken).
