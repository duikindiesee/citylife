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
- **C — furniture inventory store** ✅ DONE (this slice). See the log below.
- **D — furniture shop**: economic core ✅ DONE (this slice — pricing + `runtime.buyFurniture()` +
  the `furniture_purchase` ledger mirror); the design-studio UI is the remaining piece. See the log below.
- **E — place owned furniture from inventory into your house** ✅ DONE (this slice — the runtime + pure
  transform; place-controls UI deferred). See the log below.
- **F — Kookerbook marketplace / classifieds**: core ✅ DONE (this slice — the listing store + runtime
  wiring); the visible market tab is in the UI pass. See the log below.

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

## Slice C — furniture inventory store (DONE)

`src/colony/bot/furnitureStore.ts` — a per-player furniture inventory keyed by citizen id (the pieces a
player has designed or bought), the foundation Slice D (buy), E (place) and F (marketplace) build on.

- **Model** — `OwnedFurniture { id, kind, name, qty }`, `FurnitureInventory = Record<citizenId,
  OwnedFurniture[]>`. The `id` is `${kind}:${nameSlug}`, recomputed from kind+name on every read, so the
  same design dedupes and a tampered id can never spoof a stack. Caps: `FURNITURE_STACK_CAP` 99 per
  stack, `FURNITURE_STACKS_CAP` 64 distinct designs per player.
- **Pure ops** (node-testable, no DOM) — `addOwned` (append/increment), `removeOwned` (drop the stack at
  zero and the citizen key when empty), `ownedBy`, `mergeInventories`, `ownedFurnitureId`.
- **Two layers, fail-soft, mirroring `blueprintStore`** — LOCAL `localStorage` map `citylife.furniture.v1`;
  BACKEND best-effort PUT/GET to `/kooker/api/v1/citylife/furniture` as the logged-in player (tolerates a
  404 while the endpoint ships; backend wins per citizen on restore). The kooker-side store lives in
  `kooker-service-user` (consolidated in PR #144 alongside blueprints/commercial/kookerbook).
- **Safety** — every stack is `isPublicSafe`-screened (a custom label can never carry a brand word onto
  the marketplace) and its kind must be a real catalog piece, on every read AND write.
- `tests/furnitureStore.test.ts` (13 tests) covers dedup, caps, screening, the tamper/id-recompute
  defence, immutability, the merge semantics and the local round-trip. 803 tests green, tsc clean. A
  single-agent adversarial review found no high/medium defects; three low fixes folded in (sum duplicate
  stacks, cap-after-sort, reject non-positive qty).

## Slice D — furniture studio: design + buy (economic core DONE)

A player designs a piece (a catalog kind + their own name) and buys it from the studio; the ₭ price moves
citizen -> studio on the in-game ledger, mirrors to the real ledger, and the piece lands in their Slice C
inventory. This slice shipped the economic core; the **design-studio UI** (a panel to pick kind/name and
click buy, plus a `furniture_studio` business in `businesses.ts`) is the remaining piece.

- **`furnitureShop.ts`** (pure) — a deterministic ₭ price table per kind (4 ₭ decor … 22 ₭ bed, well under
  the residential land tier) + the `FURNITURE_SHOP_ACCOUNT` studio till id.
- **`ledgerSync.ts`** — a `furniture_purchase` `LedgerMove` (+ `moveRef`, `furniturePurchaseBody` =
  `FURNITURE_PURCHASE` CREDIT citizen / DEBIT the studio till, `isLedgerMove`, `requestFor`). The ref is
  `citylife:furniture:${citizenId}:${itemId}:${seq}` where `seq` is the LIFETIME purchase count.
- **`furnitureStore.ts`** — `nextPurchaseSeq(citizenId, itemId)`: a monotonic, **uncapped**, persisted
  per-design purchase counter (separate from the held quantity, which caps at 99), so repeat buys never
  collide on a mirror reference.
- **`runtime.buyFurniture(citizenId, kind, name)`** — mirrors `buyCommercialShop`: gate on the exact
  wallet balance, `ledgerPost` citizen -price / studio +price, record into the inventory, `mirror()` the
  move, best-effort `saveInventoryBackend`, `kbPost` a Kookerbook event, `emit`. A blank name falls back
  to the kind (charged + recorded, never free); an unsafe name / unknown kind is refused with no charge.
- `tests/furnitureShop.test.ts` (10 tests): pricing, the mirror body/ref/drain, the uncapped purchase
  seq, conservation, the inventory record, the blank-name fix, and the rejection paths. 813 tests green,
  tsc clean. A single-agent adversarial review found two HIGH bugs (blank-name free furniture; mirror-ref
  collision on the capped qty) — both fixed here and regression-tested.

## Slice E — place owned furniture into a house (DONE)

A player drops a piece they own (Slice C inventory) into their house at a chosen cell, rotation and
storey; the piece is appended to the lot blueprint, the house rebuilds, and one is consumed from
inventory.

- **`blueprintEdit.placeItemAt(p, kind, x, y, rot, storey)`** (pure) — places a furniture item at an
  EXACT cell, clamped into the plot footprint (`p.w`/`p.d`) and the design storeys (`maxStorey`), rotation
  normalised to 0..3, respecting `FURNITURE_ITEM_CAP` (a no-op when full). Its clamps exactly match what
  `validateBlueprint` accepts, so its output never fails validation on item grounds.
- **`runtime.placeFurnitureFromInventory(citizenId, lotId, itemId, x, y, rot?, z?)`** — verifies the
  player OWNS the piece (`ownedBy`) and the lot (`ownerCitizenId`), starts from the lot's blueprint (or
  its `defaultBlueprint` when undesigned, keeping the door), appends the piece via `placeItemAt`, rebuilds
  through the validated `applyBlueprint` path, then consumes one (`removeOwned` + `saveInventoryLocal` +
  best-effort `saveInventoryBackend`). Refuses (consuming/building nothing) when the piece is not owned,
  the lot is not theirs, the design is full, or the result fails validation.
- `tests/placeFurniture.test.ts` (8): the pure primitive (clamp, rot, storey, cap, immutability) and the
  runtime placement, multi-stack decrement, and the not-owned / not-your-lot refusal paths. 821 tests
  green, tsc clean. A single-agent adversarial review found NO defects.
- **Known cosmetic item for the UI pass**: each placement routes through `applyBlueprint`, which posts a
  Kookerbook "redesigned their home" event — so furnishing N pieces yields N posts. Revisit (a
  furniture-specific or debounced event) when placement gets a real UI.

## Slice F — Kookerbook furniture marketplace (core DONE)

A player advertises a furniture design they own on a public board; others browse and buy their own copy
from the studio (the classifieds reuse the Slice D studio buy). Core done this slice; the visible market
tab is in the UI pass.

- **`furnitureMarket.ts`** — a two-layer public listing board mirroring `furnitureStore`: local
  `citylife.furniture.market.v1` + best-effort PUT/GET `/kooker/api/v1/citylife/furniture-market` as the
  player. Listing `{id, sellerCitizenId, kind, name, price}`; `id = ${sellerCitizenId}:${ownedFurnitureId(
  kind,name)}` so it embeds the inventory itemId and one seller holds one listing per design. Pure ops
  `addListing` / `removeListing` / `allListings` / `listingsBySeller` / `mergeMarkets` (backend wins per
  id). **Player data isolation**: every listing is `isPublicSafe`-screened on write AND read, so a
  brand-word listing is never stored or returned; the id is recomputed (tamper-proof); board capped at 256.
- **`runtime`** — `listFurnitureForSale(citizenId, kind, name)` (advertise a design you OWN via
  `ownedBy`, at the studio price), `unlistFurniture(citizenId, listingId)` (only the seller may remove),
  `marketListings()` (the screened board), `buyFromMarket(buyerId, listingId)` (acquire your own copy via
  `buyFurniture` — charges the buyer, the advert stays up).
- `tests/furnitureMarket.test.ts` (12): listing id, dedup/cap/re-list, screening, merge, the local
  round-trip, and the runtime list/unlist/buy + ownership paths. 833 tests green, tsc clean. A single-agent
  adversarial review found NO defects.

## The deferred UI pass (after the backends)

All six backend slices (A–F) are done. The remaining work is one **UI pass**, best done together since
all three share the 48px-preview verification constraint and can reuse components:

- **D — furniture studio panel** ✅ DONE (commit `0d867c2`): a "Furniture studio" panel in the game HUD
  (`ColonyApp.tsx`) — shown for a player who owns a citizen (`operatorCitizenId`); lists their wallet +
  owned inventory and a kind-picker + name field + "Design + buy" button wired to `runtime.buyFurniture`.
  Live-verified on the dev server (renders, buy decrements wallet + grows inventory + posts the Kookerbook
  event + queues the ledger mirror, no console errors). Each control carries a `data-build-action`. STILL
  optional: a `furniture_studio` business in `businesses.ts` (a physical shopfront).
- **E — place-controls** ✅ DONE (commit `246b6bd`): a "place ↪" button on each owned inventory stack in
  the Furniture studio panel → `runtime.placeFurnitureAuto(me, itemId)` (finds the player's lot +
  an auto free cell via the new pure `freeItemCell`, delegates to `placeFurnitureFromInventory`); disabled
  until the player owns a home. Live-verified (place appends `item{}` to the lot blueprint + consumes the
  piece, no console errors). New runtime `lotForCitizen`. `data-build-action="place-item-${id}"`.
- **F — Kookerbook market tab**: the board (`runtime.marketListings`), List-for-sale + Unlist
  (`listFurnitureForSale` / `unlistFurniture`), and Buy (`buyFromMarket`). Fix the cosmetic
  "redesigned their home" Kookerbook event on furniture placement here.
- Every control carries a `data-build-action` selector for Hermes-bot driving.

## Hard rules carried from the epic

- Determinism mandatory (no wall-clock, no random in the sim/compile path).
- CI-safe commit bodies (no double quotes / brackets / colon-bullet lines — they break kooker CI).
- `isPublicSafe` denylist eats the brand-word family — nothing shown to players / posted to Kookerbook
  may contain "kooker"; the currency is "city coin" / ₭.
- Every builder control carries a `data-build-action` selector for bot driving.
