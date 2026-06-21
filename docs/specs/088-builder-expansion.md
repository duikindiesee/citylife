# Spec 088 — House-builder expansion: multi-level, furniture, inventory, marketplace

- status: building
- proposed-by: irwin (operator /loop directive 2026-06-21: expand the house builder and "what is
  possible to build" — multi-level floor plans, interiors; a furniture shop that designs custom
  furniture and stores virtual items as inventory against players + in their houses; a shop front in
  Kookerbook like a marketplace / classifieds) + claude
- date: 2026-06-21
- depends-on: 077 (the blueprint DSL → compiler → builder), 082 (Kookerbook), 085 (₭ ledger + the
  real-ledger sync), 086 (the distributed city)
- branch: `feat/citylife-builder-expansion` (rolling PR #68 into PROTECTED main)

## Why

The house builder (spec 077) raises a single-storey shell with hard-coded per-room props. The operator
wants the builder to become a real creative surface: design homes across **multiple floors**, furnish
their **interiors** with authored pieces, **buy** custom furniture from a shop, hold it as **per-player
inventory**, place it in your house, and **trade** it on a Kookerbook marketplace. It turns "a house"
into "a home you outfit and a market you participate in" — and every piece is a deterministic voxel
stamp the game, the builder preview and the Kookerbook card all mesh identically.

## The 6-slice plan

- **A — author-able furniture in the DSL** ✅ DONE (commits c4a85d4 + d27bca9). New `item{kind x y rot}`
  token; `furniture.ts` catalog (11 pieces) as deterministic micro-block stamps + rotation; 8 new
  furniture `BlockKind`s + colours; `buildFurnitureItems` compiler stamp; pure `addItem/removeItem/
  moveItem/rotateItem`; builder furniture palette + 2D markers + controls. Ground floor only.
- **B — multi-level floor plans** ✅ DONE (this slice). See the log below.
- **C — furniture inventory store** (net-new): a `furnitureStore.ts` two-layer store like
  `kookerbookStore` (localStorage `citylife.furniture.v1` + best-effort `/kooker/api/v1/...`), keyed
  by citizenId, isPublicSafe-screened.
- **D — furniture shop**: a `furniture_studio` business; a design sub-app; `runtime.buyFurniture()`
  mirroring `buyCommercialShop`; a `furniture_purchase` ledger move synced to the real ledger.
- **E — place owned furniture from inventory into your house**: an inventory item → a blueprint
  `item{}` token, consuming the inventory entry.
- **F — Kookerbook marketplace / classifieds tab**: list furniture for sale (public-safe only,
  respecting player data isolation); Buy wired to `runtime.buyFurniture`.

## Slice B — multi-level floor plans (DONE)

### What it adds

Rooms and furniture gain an optional **storey** `z` (0 = ground). The compiler builds a real
inter-storey floor under upper content, a stacked **stairwell** up from the ground, and each upper
storey's own dividers, flourishes and furniture. The builder gets a **storey selector**: pick the
floor you are editing, drop rooms/furniture onto it, and the 2D plan shows that floor solid while the
others ghost behind.

### DSL (`blueprintScript.ts`)

- `Room` and `FurnitureItem` gain an **optional** `z?: number`. Parsed only when the script names a
  storey, and serialised only when non-zero — so a ground-floor script is **byte-identical** to before
  (the 711 pre-existing tests and exact serialised-script assertions depend on this). `room{… z:1}`,
  `item{… z:1}`.
- Validation: a room/item storey must be `0..storeys-1` where `storeys = clamp(wallH,1,3)`.

### Compiler (`houseBuilder.ts`)

- The build splits **ground** (the original single-level pipeline, unchanged) from **upper storeys**.
  `groundRooms`/`owner`/`outdoor` and the single top roof are ground concerns.
- **Content-driven floors + stairs.** Floors and the stairwell appear only where an upper room or piece
  of furniture actually sits — NOT across the whole footprint of every tall shell. This is deliberate:
  a full-footprint slab on a GRAND estate blew the 60k voxel budget (62.6k); sizing floors to the rooms
  keeps it bounded, and a tall shell with all-ground rooms stays byte-identical (zero upper blocks).
- Vertical model: `floorSub=1`, `n=HOUSE_VOXEL_N=6`. Storey `s` stand-level `baseZ = floorSub + s*n`
  (ground 1, floor1 7). Upper floor slab for storey `s` at `z = floorSub + s*n - 1` (floor1 slab 6).
  Stair treads for transition `s` rise `z = floorSub + s*n + i`, `i in 0..n-1`.
- `buildUpperFloors` floors each upper room footprint + a pad under each upper item + a landing under
  the stairwell on every used storey (force=false: yields to the brick walls passing through).
- `pickStairCell` chooses the enclosed interior cell farthest from the door (seed tie-break), so the
  stair never blocks the entrance; `placeStairs` lays a 2-wide diagonal flight per storey transition and
  punches the floor slab open above the run head FIRST so the top tread survives.
- `buildDividers`/`buildRoomDetails`/`buildFurnitureItems` now take a `baseZ`/band so they run per
  storey. When rooms STACK, ground partitions shrink to one storey tall so an upper room is never
  bisected by a wall rising from the floor below; with no stacking, ground dividers keep full height.
- New `stair` `BlockKind` + colour (`voxelHouse.ts`), `KIND_CODE` entry (`houseBuilder.ts`).

### Editor (`blueprintEdit.ts`, `BuilderApp.tsx`)

- Pure ops: `maxStorey`, `addRoom(p,kind,storey)`, `addItem(p,kind,storey)`, `setRoomStorey`,
  `moveRoomStorey`, `setItemStorey`, `moveItemStorey` — all clamp to `0..maxStorey` and drop `z` back to
  absent on the ground (so the design serialises to its bare single-level form).
- UI: an `activeStorey` state + a **storey selector** strip (`select-storey-N`); add-room / add-furniture
  drop onto the active floor; the 2D plan ghosts off-storey rooms/items (non-interactive, dashed); the
  selected room/item panels gain **floor ▲ / ▼** controls (`room-floor-up/down`, `item-floor-up/down`).
  Every control keeps its `data-build-action` selector so a Hermes bot drives the same grammar.

### Determinism + verification

Pure, no wall-clock / randomness — same script → byte-identical blocks. The builder's 3D preview pane
renders ~48px wide so interiors can't be eyeballed there; Slice B is verified by `tests/multiLevel.test.ts`
(18 tests: DSL z round-trip + back-compat, storey-range validation, upper floor slab, stairwell z-span,
per-storey furniture/flourishes, grid bounds, determinism, a quadCount render-path proof, and the editor
storey ops) plus the 2D plan markers + the DSL textarea. 787 tests green, tsc clean.

## Hard rules carried from the epic

- Determinism mandatory (no wall-clock, no random in the sim/compile path).
- CI-safe commit bodies (no double quotes / brackets / colon-bullet lines — they break kooker CI).
- `isPublicSafe` denylist eats the brand-word family — nothing shown to players / posted to Kookerbook
  may contain "kooker"; the currency is "city coin" / ₭.
- Every builder control carries a `data-build-action` selector for bot driving.
