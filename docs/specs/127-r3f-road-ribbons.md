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
