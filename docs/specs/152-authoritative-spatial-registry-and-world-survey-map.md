# Spec 152 — Authoritative Spatial Registry and World Survey Map

- status: building
- proposed-by: operator
- date: 2026-07-16
- depends-on: v3 renderer and placement-contract foundations

## Status

Implementation plan for Task API WB.1
`ea73f1c1-b25c-45af-9c40-295174e840f7`, under the World Builder Survey Mode
epic `c9cc4107-1069-4a4d-9e23-84c440a8d259`.

The operator has activated implementation. The previously parked discovery gate
is satisfied by the merged v3 renderer and placement-contract foundations.

## Product rule

CityLife has one authoritative spatial registry. The renderer, builder preview,
runtime placement, navigation, persistence, automated tests and survey map must
refer to the same stable spatial IDs, coordinate frames, footprints, volumes and
network edges. A screenshot or hand-copied coordinate is evidence, never a second
source of truth.

## Coordinate hierarchy

The registry is hierarchical instead of one unbounded flat grid:

```text
observable universe
  -> world / celestial body
    -> region / island
      -> surface, subsurface and air frames
      -> building frame
        -> floor / room / interior-mini-world frame
    -> orbital frame
  -> deep-space frame
```

Each frame has a stable ID, parent, origin, scale, extent and layer. Child frames
keep local coordinates numerically small while their transform gives an exact
address in the parent hierarchy. Portals connect frames: doors, gates, stairs,
lifts, shafts, tunnel mouths, stations, docks, runways and orbital transfers.

The current island is immutable in address space. Its existing grid remains
`CELL_SIZE = 4m` and retains the current grid-to-world transform. Adding ocean,
land, islands, sky volumes, orbit or another world adds frames and connections;
it never moves today's ground or rewrites existing object IDs.

## Spatial address and volume

Every placed or navigable item declares:

- stable object ID and kind;
- universe, world, region and frame IDs;
- layer: surface, elevated, interior, subsurface, air, orbital or deep-space;
- grid coordinate and exact world-space position;
- 2D footprint plus vertical range/clearance volume;
- yaw/orientation and named anchors such as door, gate, seat or platform;
- terrain/buildability policy and observed survey result;
- zone, owner and persistence source where applicable;
- network membership and portal/connection IDs;
- revision, seed and provenance needed for deterministic replay.

An underground tunnel may overlap a surface road in X/Z because their vertical
volumes and layers do not collide. Its entrances and stations remain connected
to the surface navigation graph through explicit portals.

## Registry coverage

The registry must cover, rather than merely render:

1. Terrain cells: elevation, relief/slope, biome, water, sea, shallows, shore,
   river, dry land, buildability and grading class.
2. Reservations and zoning separately from occupied footprints.
3. Seed structures, construction buildings, houses, commercial parcels, mall,
   garage, depot, Kooker HQ, landmarks, artifacts, furniture and props that have
   gameplay occupancy.
4. Building interiors: floors, rooms, walls, doors, lifts, stairs, work surfaces,
   boardroom seats and bot/human presence addresses.
5. Logical roads and rendered asphalt extents, endpoints, junctions, crossings,
   grades, clearances and defects.
6. Walking, vehicle, bus, rail/tunnel, utility, ferry/sea, air and future orbital
   networks with nodes, directed edges, modes and capacity metadata.
7. Stops, depots, stations, garages, portals and route polylines.
8. Cameras and named views as references to registry targets, not magic vectors.

## Authoritative placement survey

`surveyPlacement()` becomes the only placement decision boundary. The builder
ghost, survey-map ghost, confirm action, runtime commit and tests all consume the
same explainable result. It evaluates the complete rotated footprint/volume:

- bounds and finite height;
- water/shore/sea and placeable-specific terrain policy;
- buildability, min/max elevation, relief and required grading;
- rendered-road clearance and exact occupied/reserved-volume collision;
- ownership and zoning;
- gate, road, pedestrian and connector feasibility;
- named anchors, seat height and persistence revision.

The result lists every failed cell/volume with stable reason codes. Runtime
revalidates immediately before commit so a stale preview cannot place an invalid
object.

## Survey map

The first user-visible slice is a fixed, north-up, whole-region survey map. It
does not auto-fit only the currently visible road network. Layers include:

- land/shore/sea/shallows/river;
- elevation and buildable/grade/blocked;
- zoning, ownership, reservations and occupied volumes;
- logical road cells, rendered asphalt, junction degree and detected defects;
- buildings, exact plot footprints, garage, Kooker HQ and interior-frame links;
- bus and later transport/utility networks, routes, stops and portals;
- selected placement ghost and invalid cells.

Selecting an item shows its stable address, grid and world coordinates, exact
footprint/volume, elevation/relief, owner/zone, source and connections. Selecting
a map item targets the 3D camera and produces a stable deep link. The same target
can open a building interior or another region without changing its identity.

## Navigation and testing

The spatial registry owns a multimodal graph. Road tests use the exact registry
to detect disconnected cells, accidental endpoints, invalid junction degree,
asphalt overlap, beach/water crossings, grade and clearance failures. Planning
can route a connector or compare proposed roads against current networks before
mutation.

Automated acceptance locks:

- grid/world/frame round trips preserve today's island coordinates exactly;
- registry generation is deterministic for a seed and layout revision;
- every gameplay placeable has an exact footprint/volume and persistence source;
- road graph edges and junction degree match logical road membership;
- preview, map and runtime placement results are identical;
- interior and subsurface child frames route through declared portals;
- adding a second island/frame leaves all original addresses unchanged;
- known seed-4242 red and green placement fixtures remain reproducible;
- deep links target the exact object/cell and camera look-at point.

## Delivery slices

1. **WB.1a — registry foundation:** coordinate frames, terrain-cell survey,
   stable records, road/navigation graph, current-world adapter and unit tests.
2. **WB.1b — read-only survey map:** fixed projection, layers, inspection,
   stable deep links and click-to-camera.
3. **WB.1c — placement parity:** placeable definitions and one shared
   `surveyPlacement()` used by preview, runtime and tests.
4. **WB.1d — layout persistence:** versioned world layout document containing
   seed, revisions, exact placements, roads/ways, terrain edits and frame graph.
5. **WB.1e — nested/expanded worlds:** Kooker HQ interior frames, room presence,
   underground networks and portals; second-island invariance proof; sky/orbit
   address proof without moving the original island.

Mutation remains behind the placement-parity and persistence gates. The initial
map is read-only but must be built from the final extensible address model, not a
throwaway minimap.
