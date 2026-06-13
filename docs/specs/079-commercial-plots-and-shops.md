# Spec 079 — Commercial plots and shops

- status: building (P0 done 2026-06-13)
- proposed-by: irwin (operator directive) + claude (architect, commerce + bot-computers design workflow)
- date: 2026-06-10
- depends-on: 075 (citizen accounts + owned Hermes), 076 (bot login + homesteads), 077 (bot house builder)
- siblings: 080 (bot workstations — the storefront site's intranet home), 081 (ad boards)

## Why

The migration spine currently ends at a house. A citizen logs in, crosses the border, founds a
household, holds a real Kookerverse account, designs a home on real land — and then has nothing to
DO with the money. Commerce closes the loop: a resident (human citizen or Hermes bot) BUYS a
commercial plot with their own in-city money, raises a SHOP on it, and the shop gets a STOREFRONT
SITE — a real web page listing what the shop sells, with a checkout that posts a REAL double-entry
transaction to kooker-service-ledger. The money is fake (the Kook, in-city only, never convertible)
but the rails are real: an ACID multi-wallet ledger service, JWT auth, persistent ownership. The
shop becomes an authored artifact like a 077 house — inspectable, ownable, visibly theirs — and the
first economic act a bot performs that another person can buy from.

The brother-bot case makes it multi-tenant for real: a citizen sub-user whose parentUserId is a
DIFFERENT main kooker user than the operator, owning a plot that persists, holding a Kookerverse
wallet that fills with sales. One brother, one bot, one shop — the smallest possible proof that the
city is a product, not a demo.

## Mechanic

1. The survey. A commercial HIGH STREET is surveyed in the east arc (cellZone commercial, the
   harbour side), routed with the same least-cost pathfinder as the residential spine, flanked by
   CommercialParcels — shop plots with frontage on the street. Pure function of terrain + seed.
2. Buy the plot. A resident with a Kookerverse account clicks Buy Shop Plot. The plot price is
   debited from their settler account and credited to the treasury (the colony sold the land) in
   the in-game double-entry ledger, and mirrored best-effort to kooker-service-ledger. Ownership
   (ownerCitizenId) is set and persisted.
3. Build the shop. v1 ships preset shop massings per shopKind (kiosk, store, showroom) raised with
   the 077 greedy mesher, gated on materials + labour exactly like buildHouse. A later slice may
   open the 077 builder with shop room kinds — same DSL family, not required for v1.
4. Author the listing. The owner writes a LISTING — a catalog of items with prices in Kook — as a
   compact single-line DSL (the blueprint-script pattern). Every write and read is validated and
   isPublicSafe-screened before it can reach storage, the backend, or a renderer.
5. The storefront site. Each built shop with a listing gets a web page — shop.html?plot=... — that
   renders the catalog and a checkout. Checkout posts one balanced transaction to
   kooker-service-ledger via the /kooker proxy as the signed-in player (JWT): buyer wallet DEBIT,
   shop wallet CREDIT, appName citylife. The in-game ledger mirrors the sale so the HUD shows shop
   revenue immediately. The storefront also exports as a self-contained static bundle — the first
   tenant of the spec 080 bot workstation intranet.
6. Brother-bot onboarding. A second MAIN kooker user (a real person, fictional alias in anything
   committed) gets the citizen role plus the citylife app allowlist entry. They log in, their
   newcomer is approved at the border, and the citizen sub-user is spawned AS THEM — parentUserId
   is the brother, not the operator. That sub-user buys the plot, owns it persistently (profile +
   backend store), and holds the Kookerverse wallet that receives every sale.
7. The OTA MISSION (operator steer 2026-06-10): the link from bot to plot is dispatched FROM
   KOOKER-WEB. The cron-dashboard bot tooling already gives every registered bot container an OTA
   channel (BOT_BASE_URL, the mapped agent-gateway port used today for OTA updates, health checks
   and the live terminal). A new Move into CityLife action on a bot row: pick the bot, pick a free
   plot from the citylife backend registry, confirm — kooker-web links/creates the citizen
   sub-user under the BOT OWNER (so the brother's bot lands under the brother), records persistent
   plot ownership, creates the Kookerverse wallet, then POSTS A MISSION BRIEF to the bot over its
   OTA channel (gateway-token auth): your plot id and address, your wallet, the builder URL for
   designing your house (the 077 data-build-action grammar), and the listing DSL to stock your
   shop. The bot is an active participant from minute one — it receives its address and goes to
   work, rather than being a passive record an operator wires by hand.

## Rules and data

- CommercialParcel keeps the Parcel public shape the engine already reads (id, x, y, w, h, side,
  ownerCitizenId, built, blueprint) and adds shopKind, listing (the DSL string) and zones: pavement
  (front), shopfront (the build zone) and yard (rear stock). Deterministic from terrain + seed,
  collision-checked against homesteads, roads and water like tryParcel.
- shopKind v1 union: kiosk (4x4), store (6x5), showroom (8x6). Each maps to a preset massing spec
  (storeys, glazing band, signage fascia) compiled through the shared voxel core so shops read as
  deliberate architecture, not boxes.
- Listing DSL grammar v1, single line, CI-safe, no quotes anywhere:
  shop{name:<token> kind:<kiosk|store|showroom>} item{sku:<token> label:<token_words> price:<int> stock:<int>}...
  tokens are lowercase a-z0-9_ only, label underscore-separated words rendered with spaces, price a
  positive integer in Kook, at most 12 items. Parsed to a typed ParsedListing, serialised back
  losslessly, validated + isPublicSafe on every boundary (the blueprintStore contract).
- Accounts. In-game ledger gains shop:<parcelId> accounts beside settler:<id> and treasury. On the
  real service, the shop wallet is the OWNING CITIZEN sub-user wallet (ownerId usr_<subUserId>,
  walletType DEFAULT, appName citylife) so the bot literally holds its income. Convention: 1 Kook
  equals 1 ledger unit; the backend currency label is cosmetic. FAKE MONEY ONLY — no conversion, no
  real-currency path, ever.
- Backend sync is best-effort, never-block (the spawnCitizenSubUser pattern): the game is always
  playable offline; backend writes tolerate 404 while kooker-side endpoints ship separately; on
  restore the backend wins over local (cross-device truth), local fills the gaps.
- Determinism: the survey, massing compile and render-mesh paths contain no Date.now, no
  Math.random, no wall-clock — the 077 rule extends to src/colony/commerce. Checkout and sync are
  runtime side-effects and never feed back into sim state.
- Public-repo safety: committed code and fixtures carry fictional identities and public aliases
  only; no secrets, no internal hostnames; all backend calls ride the /kooker proxy with the
  player JWT.

## Cost — money, materials and labour

- Plot price: config commercialPlotPrice, default 600 Kook, debited from the buyer settler account,
  credited to treasury. The buy is refused below balance — the ledger gate is the law.
- Build: matShopKiosk 12 / matShopStore 24 / matShopShowroom 40 materials plus one free labour hand
  reserved for the build duration (the Caesar III buildHouse rule). Build refused without stock.
- Listing edits are free. Checkout transactions are free to post; the price moves between wallets.
- Backend wallets auto-create on first transaction; the usr_ starter float on the real service is
  treated as the border-arrival deposit — the game must not double-fund it.

## Acceptance

On :5188 the east arc shows the commercial high street with surveyed shop plots. As a resident with
funds: Buy Shop Plot debits exactly the configured price (HUD balance + a txn memo prove it), Build
raises the preset shop massing gated on materials + labour, Edit Listing stores a validated catalog
and rejects an invalid or unsafe one, Storefront opens shop.html?plot=... showing the items with
prices. With the player signed in and the backend reachable, Buy in the storefront posts one
balanced transaction to kooker-service-ledger — GET wallet balances shows the buyer down and the
shop owner up by the price, and the HUD mirrors the sale. Offline or while kooker-side endpoints
are missing, every backend call fails soft with a clear message and the game never blocks. Reload
restores ownership + listing (local immediately, backend wins when it answers). Brother-bot: a
citizen sub-user with parentUserId set to a different main user owns a shop plot that survives
reload and a device switch, and its wallet balance grows with sales.

## Architecture

- src/colony/commerce/district.ts — pure deterministic survey: high street + CommercialParcels,
  unit-tested for determinism, dry land, no overlap with homesteads or roads.
- src/colony/commerce/shopListing.ts — listing DSL parse/validate/serialise, isPublicSafe at every
  boundary; pure, node-tested.
- src/colony/bot/ledgerClient.ts — best-effort wrapper over the /kooker proxy (authClient JWT):
  postTransaction(appName, transactionType, reference, entries) and getBalances(ownerId); never
  throws into the game loop, never blocks, idempotent references (sale_<parcelId>_<n>).
- src/colony/bot/commerceStore.ts — two-layer persistence for ownership + listing, the
  blueprintStore pattern: localStorage map keyed by parcelId, PUT/GET
  /kooker/api/v1/citylife/commercial as the player, merge with backend-wins.
- shop.html + src/colony/storefront/ — a Vite multipage route (the builder.html pattern), seeded by
  URL, every control carrying data-shop-action for Playwright/bot driving. An export script emits a
  self-contained static bundle (page + listing JSON, no proxy dependency for browsing; checkout
  deep-links back to the public game origin) for spec 080.
- runtime wiring — buyCommercialPlot(citizenId, parcelId), buildShop(parcelId),
  applyListing(parcelId, script), storefrontUrl(parcelId) + openStorefront(parcelId), mirroring the
  assignLot / builderUrl / openBuilder shapes; restore on boot beside restoreBlueprints.
- Separate kooker-side PRs (the citizen-spawn-endpoint pattern — the game tolerates 404 until each
  lands):
  - kooker-service-user: player-authenticated POST citizens (the spawn endpoint the client already
    calls), PUT/GET citylife commercial persistence (plots + listings keyed to the calling player),
    GET the player's own sub-users; a migration extending the citylife bot-profile store with plot
    + listing references. botUser sub-users stay blocked from operator web login.
  - kooker-service-ledger: JWT auth guard on the ledger API (it is currently unguarded), a gateway
    route so the /kooker proxy reaches it, and idempotency on the reference field so a retried
    checkout cannot double-post.

## Phased build plan

- P0 — Commercial survey: district.ts + tests; surveyed plots visible on :5188.
- P1 — Buy the plot: buyCommercialPlot + in-game ledger debit/credit + HUD commerce panel.
- P2 — Shop massing: preset kiosk/store/showroom compiled through the shared voxel core, gated on
  materials + labour.
- P3 — Listing DSL: shopListing.ts + isPublicSafe screening + node tests.
- P4 — Storefront route: shop.html catalog + checkout UI (stubbed), data-shop-action hooks, rollup
  multipage input.
- P5 — Real checkout: ledgerClient + the balanced backend transaction + in-game mirror.
- P6 — Persistence: commerceStore.ts local + backend layers, restore on boot.
- P7 — kooker-service-user PR (separate): citizens spawn + commercial persistence + sub-user list.
- P8 — kooker-service-ledger PR (separate): JWT guard + gateway route + idempotent references.
- P9 — Brother-bot onboarding: operator runbook (main user + role + app allowlist), the spawn-as-
  brother flow verified end to end, owner alias shown on the shop.
- P10 — kooker-web OTA mission (separate kooker-web PR): the Move into CityLife action on a bot
  row — plot picker from the citylife registry, sub-user link under the bot owner, wallet
  creation, and the mission brief POSTed to the bot over its existing OTA channel (BOT_BASE_URL,
  gateway-token auth). Replaces the manual half of P9 with one admin click.

Each slice ships on the rolling branch, passes typecheck plus vitest, and is visible on :5188.

## Progress log

### 2026-06-13 — Slice P0: the commercial high street, surveyed + lit (vibrant-first)
DONE
- src/colony/commerce/district.ts (pure): makeCommercialDistrict(terrain, reserve) surveys a high
  street down the reserve midline + shop plots (kiosk 4x4 / store 6x5 / showroom 8x6) flanking it on
  both sides, every cell gated through cellOk (the shared land contract), collision-checked against a
  claimed set, deterministic in (terrain, reserve) — no Date.now, no Math.random. 5 node tests:
  plots placed, every footprint on-land + inside the reserve, no overlap, door on the street-facing
  front row, replays identically.
- config.commerce: per-kind plot prices in city coin (kiosk 220 / store 420 / showroom 720, a
  premium tier over residential land) + build materials; the ZAR bridge reuses economy.land.
- runtime: surveys the district on boot off the existing commercialReserve (the 40x30 land bank at
  the avenue's inland end), exposes it in uiState.commerce (plots, free, byKind, priced parcels), and
  hands it to the renderer. A shopPriceK(kind) helper.
- renderer: every shop plot raises a VIBRANT NEON market stall — a dark slate shopfront, a glowing
  awning canopy, and a bright signage panel facing the street. The neon palette
  (magenta/cyan/amber/lime/violet/orange) cycles per stall and the signs flare brighter after dark
  via the day/night hook, so the strip becomes the lit heart of the city at dusk — the district
  concept-art look (docs/research/2026-06-13-district-concept.md). HUD gains a Commercial district
  panel (plots + per-kind prices).
- 697 tests green, tsc clean. LIVE on :5188: 10 plots surveyed (2 showroom / 4 store / 4 kiosk)
  priced 720/420/220 city coin (R18,000 / 10,500 / 5,500), 10 stalls rendered into the scene, the
  sign emissive flares to 1.46 at dusk, no console errors. Screenshots are broken this session, so
  verified via scene introspection (mesh count, materials, emissive, positions) per the visual standard.
NEXT
- P2: raise the shop massing through the shared voxel core (compileBlueprint + greedyMesh) on a
  bought plot, gated on materials, replacing the placeholder stall with real shop architecture.

### 2026-06-13 — Slice P1: the high street is buyable, on the live ledger
DONE
- runtime.buyCommercialShop(citizenId, shopId): a citizen takes a free high-street plot with their ₭
  wallet. Gated on funds; the price moves citizen -> the city land office on the in-game double-entry
  ledger (the same `land` account residential deeds use) and MIRRORS to the real
  kooker-service-ledger via bot/ledgerSync.ts as a LAND_PURCHASE, keyed by the shop id
  (citylife:purchase:<citizen>:<shop_N>, distinct from a homestead deed). Ownership is set and a
  Kookerbook deed event posts. cheapestFreeShop() + claimNextShop() (the wealthiest shopless citizen
  takes the cheapest free plot) drive the HUD Buy action; the arrival path also claims a shop when a
  newcomer can still afford one after their home.
- HUD: the Commercial district panel gains a funds-gated "Open a shop" button (canClaim + the cheapest
  free kind/price surfaced in uiState.commerce); the free count drops + ownership shows as plots sell.
- 6 node tests (cheapest is the kiosk, the buy debits + credits + conserves to zero + records
  ownership, the mirror posts a content-addressed shop purchase, double-buy + unaffordable rejected,
  claimNextShop is deterministic, the uiState reflects ownership + the gate). 703 green, tsc clean.
- LIVE on :5188: claimNextShop -> Viw (787 ₭, wealthiest) took the cheapest kiosk (220 ₭) -> his
  wallet 567, the land office +220, the ledger nets to zero, free 10 -> 9, and the sale mirrored to
  the real ledger (lastSyncedRef citylife:purchase:citizen_viw:shop_2, no error).
NEXT
- P2: the bought plot raises real shop massing (the placeholder neon stall becomes architecture);
  P3 the listing DSL + storefront + the checkout that posts a sale to the real ledger.

### 2026-06-13 — Themed commercial economy (loop iteration 1): each plot fronts a real kooker app
DONE
- src/colony/commerce/businesses.ts (pure): a catalog of THEMED businesses, each fronting a real
  kooker app — The Nearest (energy/radar) as a BAR with seating, Chef Ott's Market (kitchen +
  exercise), Sportifine Club (sports), Sprout Greenhouse (plant companion), plus generic Trading
  Post / Corner Kiosk. assignBusinesses() deterministically gives the marquee apps the biggest plots
  first (the bar lands on the largest, for its counter + stools); the rest fill generic. district.ts
  tags every surveyed plot with its business.
- renderer: each storefront is themed by its business — the business palette drives the neon
  awning + sign, and a distinct rooftop emblem (radar dish / leaf / ball / pot / crate / tag) reads
  the app at a glance. The Nearest bar gets a wooden counter + three stools with seated patrons on
  the street side (the concept-café look; live bot pathing-to-sit is a later iteration).
- Operator rule honoured: plots stay FOR SALE and are NOT pre-built — this is their business
  identity/destiny, the builder raises the structure when a bot buys in (see project_citylife_commerce).
- 5 node tests (marquee-to-biggest-plots, determinism, exactly-one-seating, live district tagging,
  public-safe names). 711 green, tsc clean. Live-verified on :5188: 10 plots themed by app, the
  Nearest bar shows its counter + stools + patrons, distinct neon per business.
### 2026-06-13 — Loop iteration 2: signature props per marquee business
DONE
- renderer buildBusinessProps(): each marquee storefront gets distinct, recognisable props — the
  Nearest bar a radar mast + dish, four glowing colour vials, and a little bar-chart sign (the
  concept-café look on top of its counter + stools); Sprout a row of plant sprouts + shrubs;
  Sportifine a green pitch + goal + ball; Chef Ott a striped market awning + food crates + a chimney.
  Generic plots keep the simple themed stall. 711 green, tsc clean, verified live.
### 2026-06-13 — Loop iteration 3: live bots gather at the Nearest bar after dark
DONE
- runtime wanderIdleCitizens(): after dark, an idle citizen near the bar claims a free stool and stays
  seated until day, when the bar empties and they return to strolling. barSeats() computes the three
  stool cells in front of the Nearest parcel (street side), cached, matching the three rendered stools.
  barOccupied/barSeatBy track who holds which seat; day clears them. Render-loop cosmetic (Math.random
  like the existing stroll), never the deterministic sim tick.
- renderer: removed the two static patron spheres from the bar build so the live bots taking the
  stools are not doubled by painted-on patrons. The counter + three empty stools stay.
- 711 green, tsc clean. Live-verified on :5188 — forced night, both citizens claimed distinct stools,
  walked to them and sat (pos == seat cell); the third stool stays free with only two citizens; by day
  they release and stroll. Camera framed the bar front showing the radar mast, counter and seated bots.
### 2026-06-13 — Loop iteration 4: Joe the Crab tends the Nearest (the exact concept-image look)
DONE
- renderer: a static crab keeper stands behind the Nearest counter, reusing the founder crab geometry
  (the headset-fixed makeCrabGeometry) on a hidden duckboard riser so his headset, eyes and claws clear
  the counter as he serves the patrons across it — the unmistakable Joe-at-the-bar look the operator
  asked for. He faces the street side (the crab faces +z by default; rotate y by pi when side flips).
  Citizen-Joe stays a separate founder; this is the bar mascot keeper. Disposed with the rest of the
  commercial group on rebuild.
- tsc clean, render-only (no test delta). Live-verified on :5188 — close shot of the bar front shows
  the crab keeper over the wooden counter, orange shell + blue earcup headset + claws, no console errors.
### 2026-06-13 — Loop iteration 5: bespoke storefronts for Sprout, Sportifine and Chef Ott
DONE
- renderer buildBusinessProps() enriched each marquee app into a characterful place (cheap static meshes,
  all emissive < 0.9 so nothing trips the bloom threshold):
  - Sprout — a terracotta planter trough of flowering sprouts (pink/yellow/white/blue blooms), potted
    bushes flanking the door, a white trellis arch with green vines, roof shrubs. Reads as a lush nursery.
  - Sportifine — the green pitch + goal + ball, plus two floodlight poles with glowing lamp heads, a
    stepped grandstand in the club colour, and a corner flag. Reads as a sports club.
  - Chef Ott — the striped awning + produce crates now carry colourful goods, a glowing grill under the
    smoking chimney, an outdoor bistro table with stools, and a kettlebell (the app's exercise side).
- tsc clean, render-only. Live-verified on :5188 — framed all three storefronts street-side; each is
  distinct and busy, no console errors.
### 2026-06-13 — Loop iteration 6: commerce moves to the shore beside the lighthouse (086-P1)
DONE
- The commercial district now fronts the Founders Lighthouse on the coast (see docs/specs/086 Slice P1
  for the reserve-search + connector details). The themed storefronts (Nearest with Joe, Sprout,
  Sportifine, Chef Ott) carry over unchanged — they just sit on the seaside now, a scenic promenade by
  the landmark. LIVE seed 4242: reserve (117,234), district 52 cells off the lighthouse, road-connected
  to the founders (BFS), no shop on the tower, no console errors. tsc clean.
### 2026-06-13 — Loop iteration 7: a lit seaside promenade (street lamps along the high street)
DONE
- renderer buildCommercialDistrict(): after the shopfronts, a lamp-post pass lines the high street on
  alternating verges (every ~5 street cells) — a dark pole + arm + a warm head that glows after dark
  (emissive 0.82, under the 0.9 bloom threshold so it reads as warmth, not a halo). Turns the relocated
  coastal strip into a lit promenade by the lighthouse. Cheap static meshes, disposed with the group.
- tsc clean, render-only. Live-verified on :5188 at night (forced 21:30) — the lamps line the strip and
  glow warm beneath the neon storefronts; no console errors.
NEXT (loop)
- optional: a boardwalk/path linking the lighthouse to the strip; benches facing the sea. Otherwise the
  commercial economy is assembled + sited + lit — bots buy plots over time (still no premature builds).

### 2026-06-13 — Fix: stalls were landing on homestead plots
DONE
- Operator live-screenshot caught neon stalls sitting ON residential gardens/fields: the 40x30
  reserve was anchored at a FIXED offset off the avenue end, which dropped it straight onto the
  inland homestead band, and the survey only checked terrain (cellOk), not the existing parcels.
- Two-part fix: (1) the survey now takes a `blocked` set (every homestead footprint + driveway +
  the carriage + verge) and refuses any shop cell in it — the same collision discipline the homestead
  survey uses; (2) the reserve is no longer a fixed offset — runtime SEARCHES past the avenue's inland
  terminus, in the avenue's own inland direction (a deterministic step/perp sweep), for the 40x30 rect
  with the most clear (dry, unbuilt, non-road) ground; the clearest wins, or null if nowhere near the
  end is open enough (graceful — no district, no crash).
- Tests rewritten to drive the REAL ColonyRuntime boot (no reconstruction drift) with a new assertion
  that NO shop footprint lands on a homestead cell, across seeds 4242/42/7. 706 green, tsc clean.
- LIVE on :5188 (seed 4242): reserve relocated to (376,363); 10 shops in two tidy rows flanking the
  high street, shopFootprintCellsOnResidential = 0, 10 stalls rendered, no console errors.
