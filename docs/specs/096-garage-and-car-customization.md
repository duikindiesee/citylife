# Spec 096 — Garage and Car Customization

**Status:** the buy → own → mount → tune loop is built and shipping on the rolling garage PR. Open
items (own-car rally, wear, the real-ledger mirror, a car-shop plot) are coordination-gated or blocked
on another lane — see the bottom.
**Lane:** claude2 / car-and-garage. Pairs with the hilltop Rally Point (spec 097) and the road rally
minigame (spec 087, the team's rally lane).

## Why

A Street-Rod-style garage. You log in, drop into the world, jump into first person beside your own
parked car, open the bonnet, and bolt parts onto its sockets — each part both VISIBLE on the car and a
real change to how it drives. Parts are bought with city coin, owned, fitted, repainted, sold to other
players on a classifieds board, and summed into a single tune rating. It turns the car from set dressing
into a thing you build over time, and feeds the rally (spec 097): eventually you race the car you tuned.

## Architecture — mesh composition, not a voxel DSL

The original plan sketched a voxel car DSL (a `carScript` / `carBuilder` mirroring the house builder).
We built a simpler **mesh-composition** model instead, and the divergence is deliberate:

- A part is a child THREE mesh mounted at a fixed socket anchor (or, for the wheels and body sockets, a
  RESHAPE of an existing part of the car), not a stamped voxel volume. This keeps the car pure data +
  one small mesh builder, with no second DSL/compiler to maintain and no risk of colliding with the
  house `item{}` grammar or Jack's furniture lane.
- The data model is pure and serializable (no THREE, no `Math.random`, no `Date.now`), so the whole
  thing is node-testable and deterministic.

Files (all new, in our lane):
- `car/carSpec.ts` — `CarSpec {id, name, stats, paint, parts}`, `CarStatVector {topSpeed, acceleration,
  grip, braking}` (0..1, stock 0.5), `defaultCarSpec` (seeded paint per player, no rng), `safeCarSpec`
  (clamps, isPublicSafe screens a custom name), the curated paint palettes.
- `car/carParts.ts` — the socket/part model: sockets engine, exhaust, wheels, spoiler, hood, body; nine
  parts; `partFits`, `validCarParts` (one part per socket, first wins), and `deriveStats` (base plus each
  mounted part's deltas, clamped 0..1, rounded to 6dp so the sum is order-independent).
- `car/carMesh.ts` — `buildCarMesh(spec)`: body, cabin, stripe, four wheels, headlights, plus each
  mounted part. Wheels and body parts reshape the car (slicks resize the tyres, a roof chop lowers the
  cabin). Emissive stays under the 0.9 bloom threshold with a night-visible floor.
- `car/garageStore.ts` — the per-player CarSpec (localStorage `citylife.garage.v1`, fail-soft, default
  for an empty garage).
- `car/carShop.ts` — `CAR_SHOP_ACCOUNT` of shop:car and the part price.
- `car/carStore.ts` — owned parts per player (localStorage `citylife.carparts.owned.v1`); free parts are
  owned implicitly so the base car always works.
- `bot/carPartMarket.ts` — the classifieds board (localStorage `citylife.carparts.market.v1`), a sibling
  of the furniture market that never edits it.
- `ui/GaragePanel.tsx` — the Garage HUD, bound to `uiState.garage` (operator-gated).
- `runtime.ts` — a contiguous block of garage methods; `render/PlanetRenderer.ts` gains `setOperatorCar`.

## Slices (built)

- **A — car spec + mesh + store.** `defaultCarSpec`, `buildCarMesh`, `garageStore`. A custom-painted car
  in isolation; spec serializes round-trip.
- **mount loop + derived stats.** `mountCarPart` / `unmountCarPart` (one per socket), `deriveStats`, and
  the Garage HUD with four stat bars.
- **in-world parked car.** `setOperatorCar` renders the signed-in player's car a cell off their home,
  rebuilt when the operator or the car changes.
- **D — the economy.** `carShop` price + `carStore` ownership + `buyCarPart`: a part must be bought with
  city coin (gated on the exact in-game ledger balance) before it can be mounted, free parts implicitly.
- **E — jump to your car.** `jumpToMyHouse` drops the player into first person on a walkable cell beside
  their parked car, facing it, as their own citizen.
- **F — open the bonnet.** `openBonnet` / `closeBonnet` reveal the engine bay: the engine and hood
  sockets, each with its fitting parts and an install state (occupied, installable, empty).
- **G — the classifieds.** `listCarPartForSale` / `unlistCarPart` / `buyCarPartListing`: list an owned,
  unmounted part for city coin; another player buys it, the coin moves buyer to seller on the in-game
  ledger and the part changes hands. In-game ledger only for now.
- **H — cosmetics + body.** Paint customisation (`setCarPaint`, palette-validated), a roof-chop body mod
  (the body socket reshapes the cabin and sheds weight for a little accel + grip), a single tune rating
  out of 100 (`tunePoints`, 50 = stock), and a handling-effect badge on every part in the HUD (up/down
  per stat, or cosmetic) so fitting a part is an informed choice.

All handles live on `window.__colony` for live verification on the non-5188 dev port (jumpToMyHouse,
openBonnet, buyCarPart, mountCarPart, setCarPaint, listCarPartForSale, buyCarPartListing).

## Open / blocked (need another lane or a gate to open)

- **Own car in the rally (the big one).** Race the car you tuned. Blocked on an additive hook in the
  rally renderer (`raceLayer.ts`, owned by the rally lane): an optional `carSpec` on `RaceLayerOptions`
  so `buildRaceLayer` uses `buildCarMesh(opts.carSpec)` when present (per PLAN-rally-owncar-friend 2b).
  Once that lands, `runtime.startRace` can source the player's CarSpec from `garageStore` with no
  regression. Stat-to-physics tuning and ghost replay follow.
- **Wear / consumable tyres.** Needs a usage signal to accrue against, which is the race — so it waits on
  the own-car rally above.
- **Real-ledger mirror for purchases.** A `car_part_purchase` variant appended to `bot/ledgerSync.ts`.
  That file is the highest-conflict shared file with the furniture lane — coordinate an edit window first.
- **A car-shop plot.** A physical car shop in the commercial district. `commerce/businesses.ts` is the
  team's commerce lane (storefronts front real kooker apps); do not add one there unilaterally.

## Car lane — coordination note

- DO NOT edit the furniture lane: `furniture.ts`, `furnitureShop.ts`, `bot/furnitureStore.ts`,
  `bot/furnitureMarket.ts`, or reuse its symbols. Our parts model is a parallel sibling.
- DO NOT edit the rally internals beyond the agreed additive `startRace(startCell?)` parameter:
  `traffic.ts`, `raceLayer.ts`, `race.ts`, `state.cars` are the rally lane's.
- The car shop ledger account is `shop:car` (distinct from the furniture till).
- localStorage namespaces: `citylife.garage.v1` (the car), `citylife.carparts.owned.v1` (ownership),
  `citylife.carparts.market.v1` (the classifieds). All distinct from the furniture keys.
- Ping the furniture lane before touching `bot/ledgerSync.ts` (the real-ledger mirror slice).

## Rules honored

Deterministic sim (no `Math.random` / `Date.now`). main is PROTECTED (PR + review gate). CI-safe commits.
Visual-first, verified on the dev port. Night-visible (emissive floor under the bloom threshold).
isPublicSafe on every player-facing string (custom car name on read and write); prices read as city coin,
never the brand word.
