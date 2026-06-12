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
- P1: buy a shop plot with city coin — the in-game ledger debit (citizen -> the city) mirrored to
  the real kooker-service-ledger via bot/ledgerSync.ts (now live, spec 085 P1), plus the HUD Buy
  action and an arrivals path that claims a shop when funds allow.
- P2: raise the shop massing through the shared voxel core (compileBlueprint + greedyMesh) on a
  bought plot, gated on materials, replacing the placeholder stall with real shop architecture.
