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

WB.1a and WB.1b shipped in CityLife PR 338. WB.1c is implemented on the
`codex/world-placement-parity` review branch: the shared placeable catalog,
explainable placement survey, stale-preview revalidation, runtime/store mutation
gates and transient Survey Map ghost now consume one footprint and revision.
WB.1d persistence is implemented on the `codex/world-layout-persistence` review
branch and is undergoing final acceptance. WB.1e nested-world occupancy remains
a follow-on slice.

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
      -> parcel / site frame
        -> building / enterable-mini-world frame
          -> floor frame
            -> room frame
              -> seat / desk / work / interaction anchor
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

Kooker HQ is the reference nested-world proof. Entering the building loads an
interior scene, but reception, boardroom, offices, floors, rooms, doors, seats,
manifesto walls and work anchors retain addresses beneath the exterior HQ site.
The scene boundary is therefore a streaming boundary, never a coordinate or
identity reset.

## Presence and occupancy addresses

A bot or human has one current presence address pointing at the smallest known
frame or anchor. For example, an occupant may be addressed at a boardroom seat
inside Kooker HQ on another island while the operator remains on the original
island. The presence record carries the complete ancestor chain, local pose,
active portal/route transition and visibility policy.

Moving through a door, lift, tunnel, dock or orbital transfer atomically changes
the presence address from one frame to another. There is no duplicate or ghost
occupancy in both scenes. Viewers may resolve the address to a coarse public
location such as building or neighbourhood while authorized systems resolve the
exact room and anchor. Presence and object addresses use the same frame graph,
so schedules, meetings, buses and future agent work can target real places.

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

## WB.1d layout persistence contract

`WorldLayoutDocument` is the sole durable source for authored spatial state. It
stores intent and exact geometry, not renderer caches or a serialized copy of the
entire simulation. The current schema is:

```ts
interface WorldLayoutDocumentV1 {
  schemaVersion: "citylife.world-layout/v1";
  layoutId: string;
  seed: number; // unsigned 32-bit world-generation seed
  generator: {
    id: "citylife-v3";
    version: string;
    placeableCatalogVersion: string;
  };
  revision: {
    number: number; // non-negative, monotonically increasing integer
    parentHash: string | null; // sha256 of the preceding canonical revision
    contentHash: string; // sha256 of this canonical document projection
  };
  frames: SpatialFrameRecord[];
  terrainEdits: TerrainEditRecord[];
  zones: ZoneRecord[];
  reservations: ReservationRecord[];
  placements: PlacedObjectRecord[];
  roads: {
    cells: LogicalRoadCellRecord[];
    ways: RoadWayRecord[];
  };
  networks: SpatialNetworkRecord[];
  portals: PortalRecord[];
}
```

`layoutId` is the only wire/storage identity field. The current runtime and store
retain a temporary non-enumerable `worldId` property alias so existing TypeScript
call sites can migrate without creating two identities; the alias always equals
`layoutId`, is immutable, and is excluded from canonical bytes, hashes and exports.

Every record has a stable ID. Every child record names its owning frame, and all
coordinates are local to that frame unless a field explicitly says otherwise.
Footprints, volumes, transforms, road cells and way control points use integers
or finite decimal numbers in declared units; `NaN`, infinity, negative zero and
implicit unit conversion are invalid.

| Document field  | Authoritative owner                   | Required invariants                                                           | Never persisted here                            |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `schemaVersion` | layout codec and migration registry   | exact supported version string                                                | application build number                        |
| `layoutId`      | layout repository                     | immutable across revisions and migrations                                     | local-storage key or URL                        |
| `seed`          | world generator                       | immutable unsigned 32-bit value for a layout                                  | live RNG state                                  |
| `generator`     | world generator and placeable catalog | exact supported generator/catalog compatibility IDs                           | application build number                        |
| `revision`      | layout repository transaction         | sequential number, valid parent hash and recomputed content hash              | wall-clock freshness flag                       |
| `frames`        | spatial frame registry                | one acyclic parent graph, one declared root, stable transforms/extents/layers | scene-loader handles and Three.js objects       |
| `terrainEdits`  | terrain authoring layer               | ordered, stable-ID edits against seed-generated terrain                       | generated terrain mesh, normals or GPU buffers  |
| `zones`         | zoning registry                       | frame-bound non-overlapping policy records where required                     | UI filter state                                 |
| `reservations`  | reservation registry                  | stable owner reference, frame and exact footprint/volume                      | authorization tokens or owner profile data      |
| `placements`    | placeable registry                    | catalog kind, frame, pose, exact footprint/volume, anchors and provenance     | React components, meshes and transient ghosts   |
| `roads.cells`   | road authoring service                | unique frame/grid cell with one canonical road kind                           | `roadSet`, junction degree or pathfinding cache |
| `roads.ways`    | road authoring service                | stable ordered control points referencing canonical logical cells             | sampled asphalt/ribbon geometry                 |
| `networks`      | multimodal network registry           | stable nodes/edges, modes and referenced spatial IDs                          | route-search caches and vehicle positions       |
| `portals`       | frame graph                           | two valid endpoints and a declared traversal contract                         | open animations or streamed-scene state         |

`roadSet`, `roadKind`, rendered-road blocked cells, junction degree, adjacency,
route graphs, world-space transforms, spatial indexes and survey-map layers are
always rebuilt from the document. Persisting any of those derived views would
create a second source of truth.

Every portal connects two distinct frames. Portal endpoints and network-node
positions are frame-local metres; when a frame declares a grid, `x` and `z` must
fall within the half-open physical extent from `grid.origin` through
`origin + dimensions * cellSize`. A non-grid frame accepts any finite local
position. Zone and reservation collision checks use each effective vertical
envelope, `[min - clearanceBelow, max + clearanceAbove]`; envelopes that only
touch at one boundary do not overlap.

### Canonical bytes, hash and revision

Before hashing or writing, the codec creates a canonical projection of the whole
document except `revision.contentHash`. It validates and normalizes numeric values,
sorts object keys lexicographically, and sorts set-like record collections by
stable ID (road cells by frame ID, `y`, `x`, kind; ordered way control points and
terrain-edit operations retain their authored order). The normalized projection
is encoded as UTF-8 JSON using RFC 8785 JSON Canonicalization Scheme rules.
`revision.contentHash` is the lowercase, 64-character SHA-256 digest of those
bytes. Audit timestamps, display labels and storage metadata live outside the
hashed layout document.

The externally visible `layoutRevision` consumed by `surveyPlacement()` is
`wl:v1:<revision.number>:<revision.contentHash>`. Any successful spatial mutation
creates a complete candidate document, sets `parentHash` to the current content
hash, increments `number` exactly once, recomputes the hash and atomically swaps
the revision. A byte-equivalent no-op retains both revision number and hash.
Changing any placement-relevant state must change the hash; array insertion order
or JSON property order alone must not. A parent mismatch, hash mismatch, skipped
revision or reused revision number with different content is rejected as a
conflict rather than silently repaired.

The layout repository advances a single head pointer with compare-and-swap against
the caller's expected `layoutRevision`. It verifies `parentHash` against the
preceding retained snapshot, so two writers based on the same head cannot both
commit. Rollback creates a new revision whose content matches the selected old
snapshot; it never rewinds history.

Full snapshots are bounded to `maxRollbackDepth + 1` (default 101, hard maximum
1001), preserving the current head plus every supported rollback target. Older
snapshot evidence is folded, in sequence, into one SHA-256 repository chain.
Every retained revision row stores the accumulator derived from the previous row
or checkpoint plus its sequence, revision token, content hash and parent hash;
the active head mirrors the final accumulator. The checkpoint takes the last
pruned row's accumulator and records that row's sequence, revision token,
content/parent boundary and immutable seed. Validation recomputes the whole
retained chain from the checkpoint and requires the final value to match the
head, so changing a syntactically valid checkpoint or row digest is detected.
Pruning rows and advancing checkpoint evidence happen in the same transaction as
the new head. Thus ordinary load, save, rollback and history costs are bounded
while the constant-size checkpoint remains cryptographically linked to every
retained revision. Reducing retention compacts once on the next open; increasing
it affects future history only and cannot recreate pruned snapshots.

Opening an older or previously unbounded database may perform one complete,
transactional history scan to verify/migrate the chain and establish the first
checkpoint. After that one-time recovery/compaction, ordinary repository reads
and writes inspect at most the configured retained snapshot window plus the
constant-size checkpoint.

IndexedDB schema v3 introduces the per-row and head accumulator fields. Existing
Dexie-v1/v2 current histories are fully verified and then backfilled with the
repository chain in one read-write transaction. Numeric-v1 and string-v0
document migration constructs that chain while replacing the verified legacy
rows. Failed verification leaves the predecessor row/head data unchanged.

### Version and migration policy

The reader accepts the current schema plus explicitly registered older versions.
An unknown future version is rejected without mutation. The source revision is
first validated and its digest checked with its own versioned codec. Each migration
is then a pure, deterministic `vN -> vN+1` function over a copy: it performs no
I/O, reads no wall clock or randomness, preserves stable IDs and the current island
transform, and emits the next complete schema. The loader validates after every
migration step, then canonicalizes and hashes the current-version result. Migration
fixture hashes are committed with the codec, so changing a historical migration
requires an explicit new schema version rather than rewriting history.

The production predecessor emitted numeric `schemaVersion: 1` in commit
`5eeb814`. It used `worldId`, omitted generator/catalog, zones, reservations and
networks, and did not carry stable terrain-edit IDs or import provenance. Its
digest was SHA-256 over a specifically ordered plain `JSON.stringify` projection,
not the current recursive RFC 8785 encoding; its CAS token was already
`wl:v1:<number>:<oldHash>`. A separate frozen verifier reproduces that exact
contract. The repository verifies every numeric row, old token, contiguous
sequence, immutable identity/seed and old parent chain before constructing any
replacement. It then deterministically adds current defaults and provenance,
recalculates each new parent from the preceding **new** hash, and replaces all rows
plus the head in one read-write transaction. A mixed/incomplete chain, tamper,
unrepresentable non-uint32 seed, ID collision or semantic validation failure
aborts without changing any source byte. The fixed fixture is
`tests/fixtures/world-layout-numeric-v1.json`.

The additional registered string reader is `citylife.world-layout/v0`. It has the
same missing semantic fields but uses its own RFC 8785 digest. Because an isolated
v0 revision cannot rewrite an older parent hash without its complete repository
chain, this migration accepts only the unambiguous initial revision (`number: 0`,
`parentHash: null`); later v0 revisions fail with `MIGRATION_FAILED` and remain
untouched. Its fixture lives at `tests/fixtures/world-layout-v0.json`.

When the IndexedDB repository finds exactly one verified v0 revision-zero row and
its matching v0 head, it replaces both with the canonical v1 row and v1 head in
one read-write transaction. A missing head, mismatched metadata, mixed-version
history, multiple v0 rows or failed source digest aborts the transaction and
leaves the original serialized row and head unchanged. Load, history, save,
rollback and boot therefore cannot observe or publish a mixed v0/v1 repository.

Migrations may add deterministic defaults whose meaning is defined by the target
schema. They may not infer exact geometry, ownership, occupants or portals from a
screenshot or renderer output. If required information cannot be derived without
ambiguity, migration fails with a stable diagnostic and the source remains
untouched. Writers only emit the current version; successful persistence never
writes an older schema back.

### Validate-before-mutate hydration and boot order

Hydration is a transaction. Parsing, migration, canonical-hash verification,
schema validation, reference resolution, frame-cycle detection, bounds/volume
checks and derived-index construction all happen in an isolated candidate. The
candidate must also pass `surveyPlacement()` parity, road/way consistency, portal
endpoint and original-island invariance checks. Only then may one commit boundary
replace the live registry, terrain edits, placements, roads and derived graphs.
Any failure leaves the previous live state byte-for-byte observable, emits stable
diagnostics and never exposes a half-loaded layout to the renderer or simulation.

Boot order is fixed:

1. Load configuration, placeable catalog, schema codecs and migration registry.
2. Generate immutable base terrain and the root/current-island frame from `seed`
   in an isolated candidate.
3. Read one layout revision; parse, migrate, normalize and verify its canonical
   hash and parent/revision metadata before consulting any of its records.
4. Apply terrain edits, then resolve frames, zones and reservations in the
   candidate.
5. Validate placements through the authoritative placement contract; then load
   logical road cells/ways, portals and networks.
6. Rebuild all derived sets, rendered-road occupancy, frame transforms, indexes
   and navigation/survey graphs; run whole-document invariants.
7. Atomically publish the candidate and its `layoutRevision`, then restore
   non-layout simulation state and start schedules, vehicles and occupants.
8. Mark the world ready and only then mount/enable renderer and builder mutation.

No founder, commercial, neighbourhood or road seeder may write spatial state
after step 6. Seeders either contribute to the deterministic base candidate before
validation or are suppressed when an authoritative layout document is present.

### One-time legacy road import

When no layout document exists, a one-time importer may build V1 from the legacy
seeded world. It reads `state.roads` as canonical logical cells and `roadWays` as
authored ways. It sorts and deduplicates identical cells, rejects conflicting
kinds for one frame/cell, validates every way point against the logical network,
assigns deterministic stable IDs, records `legacy-seed-v3` provenance and then
runs the same candidate validation and atomic write as any normal revision.

Legacy `roadSet` and `roadKind` may be compared for diagnostics but are never
imported as authorities; both are regenerated from `roads.cells`. Rendered road
ribbons, adjacency and junctions are also regenerated. Running the importer twice
against the same seed yields identical canonical bytes and hash. Once a document
exists, boot must load it or fail explicitly—legacy roads are never silently
merged into or substituted for persisted roads.

### Privacy and security exclusions

The layout document may contain an opaque owner principal ID only where zoning,
reservation or placement authorization requires it. It must not contain names,
contact details, credentials, session/PAT tokens, chat or prompt content, private
schedules, inference traces, wallet balances, KCO transactions, live vehicle
positions, or bot/human presence and room/seat occupancy. Those belong to
separate access-controlled services and reference stable spatial IDs.

Exact room/anchor presence remains privacy-filtered as defined above: an
authorized occupancy response can resolve a presence reference through this frame
graph, while public projections reveal only the permitted coarse location. Saving
or exporting a world layout can therefore never disclose who is currently inside
Kooker HQ, another island's house, an underground facility or a transport route.

### Deterministic replay and required WB.1d tests

Implementation is intentionally staged. WB.1d provides the strict V1 codec and
hash (including generator/catalog compatibility, zones, reservations and
multimodal networks), transactional migration of the pushed numeric-v1 chain and
verified string-v0 revision, bounded IndexedDB history with compare-and-swap and
checkpoint evidence,
validate-before-mutate runtime hydration, boot/readiness ordering, canonical
road/terrain capture, deterministic one-time legacy seeded-world import with
`legacy-seed-v3` provenance, revision save/adoption, canonical export, bounded
history, rollback-as-a-new-revision and validated JSON import. Runtime hydration
rebuilds the authoritative placement, terrain, zoning, reservation and network
projections before publishing one complete candidate.

This slice does not claim bespoke rendered objects for every generic placeable,
adoption of the persisted network graph by every live vehicle/utility consumer,
or a presence/location ledger. Presence remains a separate privacy-governed
service that references stable frame, placement and portal IDs from this
document; it is never serialized into the layout. Those follow-on items remain
open until their own runtime proofs pass.

The document's generator/catalog compatibility IDs, `seed` and canonical
current-version records are the complete inputs to spatial replay. Hydration must not depend on
wall clock, locale, object/map iteration order, network responses, GPU/renderer
state or ambient randomness. Two cold boots produce the same canonical document
hash, registry records, transforms, exact occupied/reserved cells, road/network
graphs and survey results.

WB.1d cannot ship without automated proof of:

- V1 schema round-trip to byte-identical canonical JSON and hash;
- hash invariance under JSON property and set-like input ordering, with authored
  way/edit order preserved;
- a real spatial mutation advancing one revision and changing the hash, while a
  no-op advances neither;
- rejection of tampered hashes, invalid parent chains, duplicate/conflicting IDs,
  unknown future versions and non-finite/invalid-unit coordinates;
- deterministic migration fixtures for every supported old version, including
  stable-ID and original-island transform preservation;
- atomic failure at parse, migration, reference, geometry, road and portal stages,
  proving the prior live registry and revision remain unchanged;
- the declared boot order and a renderer/builder readiness barrier that prevents
  observation or mutation of a partial candidate;
- deterministic, idempotent legacy-road import and regeneration of `roadSet`,
  `roadKind`, ribbons, junctions and graph edges from the imported sources;
- serialization allow-list tests proving every privacy/security exclusion above
  is absent even when runtime presence and account data are populated;
- two independent cold replays producing identical registry snapshots and
  placement survey results;
- persisted-layout boot suppressing conflicting seeders and preserving known
  seed-4242 placement and road fixtures;
- adding later interior, subsurface, second-island, sky, orbital or deep-space
  frames without changing any original-island address or transform.

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
