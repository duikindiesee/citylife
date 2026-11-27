# Spec 181 — Plot ownership and land purchase

- status: proposed
- proposed-by: Forge (operator request 21 Nov 2026: after buying a house, a player can pick any available plot; plots belong to neighbourhoods; a purchased plot is owned exclusively and cannot belong to others. If that is not already true, write the spec so it can later be built.)
- date: 2026-11-21
- updated: 2026-11-22 (operator land-tier and rate decisions; starter-economy contract in spec 182)
- depends-on: 076 (homestead parcels), 078 (founder reserved parcels), 085 (land economy + ledger mirror), 086 (satellite hamlets), 146 (metre grid), 156 (starter-property purchase), 175 (claimStarterHome + GPS), 178 (multiplayer rooms), 180 (picket fence + garage-first starter home, unmerged [PR #583](https://github.com/duikindiesee/citylife/pull/583)), 182 (starter economy)

This is a **proposed contract**, not a claim that the work has shipped. Implementation lands in a later PR after review. Residential land uses `LAND_PRICE_PER_M2_KCO = 0.27`, applied to the full fenced parcel (operator decision 22 Nov 2026). That rate is no longer derived so that a starter-sized parcel costs 350 KCO; the starter **house** remains a separate 350 KCO product (spec 156). The player starter grant and first-day affordability live in [spec 182](182-starter-economy.md).

## Why

Players should be able to walk up to a plot, read its size and price on a for-sale board, and buy that exact piece of land. The plot belongs to a neighbourhood. Once it is bought it has one owner — the purchasing player — and nobody else can take it. Today those rules are only partly true, and the exclusive deed is not server-authoritative, so two clients can disagree about who owns a plot. This spec is the build contract that closes those gaps.

## Audit of today (main `23cecef`, 21 Nov 2026)

Evidence is file:line on that commit. "Partial" means the idea exists in code or an older spec, but does not meet the operator rule.

| Requirement | Status on main | Evidence |
|---|---|---|
| A plot belongs to a neighbourhood | **Partial** | `Parcel` may carry `neighborhoodKey` (`src/colony/neighborhood.ts:28-31`). Satellite hamlets and the western coastal hamlet get keys at world build (`wood1`, `hill2`, `valeN`, `coastN`) (`src/colony/runtime.ts:1363-1365`, `1412-1415`). The primary coastal neighbourhood is deliberately unkeyed ("open land"). `Neighborhood` is an in-memory cluster of parcels around a spine street (`neighborhood.ts:73-86`), not a durable server deed-register of plots. |
| After buying a house, pick any available plot | **Partial / missing** | The dark starter-home overlay (spec 156, flag `new-player-journey-v1`) lets the player pick a **neighbourhood**, not a plot. `POST /players/me/home/purchase` sends `{ neighbourhoodKey }` only; the service is specified to derive `starter-home:<userId>` itself (`src/colony/home/starterProperty.ts:8-10, 35-38, 313-334`; spec 156). After a grant, `ColonyApp` calls `runtime.claimStarterHome(truth)` (`src/colony/ui/ColonyApp.tsx:2220-2224`), which places the house on the server `plotId` if it matches a world lot, otherwise the first free lot in that neighbourhood, otherwise a free unkeyed primary lot (`runtime.ts:4738-4868`). That claim path does **not** debit KCO. A separate HUD "Buy N ₭" button calls `purchaseLot` on a listed homestead, but it buys for the first citizen who does not already hold a lot, not as "pick any plot after my house" (`ColonyApp.tsx:3732-3821`). |
| Exclusive single owner | **Partial, client-only** | The field is `Parcel.ownerCitizenId` (`neighborhood.ts:43`). `assignLot` refuses a lot that already has an owner (`runtime.ts:8662-8665`). It is also **one home per citizen**: assigning a new lot clears `ownerCitizenId` and `built` on every other lot that citizen held, with no refund (`runtime.ts:8666-8671`, comment at `8892`). Founder parcels use `reservedFor` and are not for sale (spec 078; `plotPriceK` returns `Infinity` at `runtime.ts:8299-8300`). |
| Owned plots cannot be bought by others | **Missing as a shared fact** | The refusal in `assignLot` / `purchaseLot` (`runtime.ts:8317`, `8665`) holds only inside **this browser's** `ColonyRuntime`. Parcel owners are not written by `saveColony` (that persists settlers + the in-game ledger only — `src/colony/settlers.ts:64-76`). Spec 085's ledger resets to founders each boot unless restored from that local ledger. Multiplayer (spec 178) syncs vehicle poses and binds rooms to neighbourhood keys; it does not sync plot deeds. Two sessions can therefore assign the same world lot to different citizens. The starter-home **deed** in kooker-service-user (spec 156) is server-owned for that one home, but it does not publish an exclusive, world-wide plot register that every client must honour. |
| Unsold plots show a for-sale board with size and price | **Missing** in-world | Unsold land is a green (or cyan, commercial) draped tint (`ZoneLotOverlay.tsx:4-10, 27`). The homestead HUD lists up to eight lots with a ₭ price, not width × depth or m² (`ColonyApp.tsx:lotHudCopy 311-341`). There is no in-world For Sale board on main. A board with size, total price and price per m² is being added on [PR #583](https://github.com/duikindiesee/citylife/pull/583); until that merges, treat it as proposed art, not shipped behaviour. |
| Price per m² | **Partial, different formula** | Spec 085 prices the **house-zone cell count**, not the fenced parcel in m²: `round(houseZone.w * houseZone.d * plotAreaRate + waterfrontPremium)` with `plotAreaRate: 0.6` and `waterfrontPremium: 120` decaying 2 ₭ per cell from water (`src/colony/land.ts:21-31`; `src/colony/config.ts:1072-1077`; `runtime.ts:8297-8308`). An ESTATE house zone is 19×14 = 266 cells, so inland prices sit around 160 ₭, plus waterfront, not 350 KCO. The starter-home path uses the server's fixed **350 KCO** (spec 156) and never calls `plotPriceK`. `LAND_PRICE_PER_M2_KCO` is not on main. |

### Related systems already in the tree

- **Spec 085 `purchaseLot`.** Client-authoritative: gates on the in-game `citizen:` wallet, posts `citizen → land` on `ledger.ts`, then best-effort mirrors `LAND_PURCHASE` to kooker-service-ledger with reference `citylife:purchase:<citizenId>:<lotId>` (`src/colony/bot/ledgerSync.ts:11-12, 66-69, 115-141`). The in-game ledger is the source of truth; the network path must never block the sim (spec 085 P1). That is the opposite of the vehicle and starter-home contracts.
- **Vehicle purchase (spec 171).** The pattern to copy: the client posts the canonical key only, plus a stable `Idempotency-Key`; the service checks funds, moves KCO, and records ownership. The client re-fetches server truth and never submits a price (`src/colony/car/carAcquisition.ts:1-12, 24-25, 354-382`).
- **Starter home (spec 156).** Same authority pattern, but the selection is a neighbourhood, the price is a fixed 350 KCO, and the plot id is server-derived. Gated fail-closed on `new-player-journey-v1`. Relocate in the overlay ("Select a different coastal plot") still posts a neighbourhood key, not a named lot (`StarterPropertyOverlay.tsx:334-348, 128-134`).
- **Access gate.** `canBuyLotByAccess` checks satellite keys against `GET /kooker/api/v1/citylife/neighbourhoods/by-key/{key}/access/check` and fails closed (`src/colony/bot/neighbourhoodAccess.ts:1-24, 51-55`). Primary unkeyed land skips the network call.
- **Unmerged prior work.** Draft [PR #524](https://github.com/duikindiesee/citylife/pull/524) (`feat/player-parcel-catalogue`, September 2026, not mergeable against current main) already prototypes `GET /players/me/home/available-plots`, purchase by `{ neighbourhoodKey, plotId, layoutRevision }`, reservation-before-debit, and a client spec that collided with main's later `173-glass-showroom-…`. This spec **supersedes that document's number** and should reuse its contracts where they still fit, rather than invent a third purchase shape.

## Decision log

### 22 November 2026 (Africa/Johannesburg)

Operator answers on plot size and land price, after a sourced check of Langebaan / Saldanha Bay stands. The official scheme is the [Saldanha Bay Municipality Integrated Zoning Scheme By-Law](https://sbm.gov.za/wp-content/uploads/Pages/Policies_and_By-laws/INTEGRATED-ZONING-SCHEME-BY-LAW.pdf), approved 26 October 2021 (Council Resolution R28/10-21). A 22 Nov 2026 sweep of current Langebaan listings (median suburban erf 656 m²; beach estates mostly 350–450 m²; Country Estate / Country Club / Shark Bay around 650–850 m²; upper Myburgh Park 900–1,200 m²; Long Acres 1–2 ha against a 1 ha legal smallholding floor) is the typological check. The listing table itself is operator research, not a file in this repo.

**Settled**

1. **Plot tiers**, snapped to the 4 m grid (`CELL_SIZE` in `src/colony/scale.ts:21`):

   | Tier | Size | Cells | Area | Price at 0.27 KCO/m² (`round`) |
   |---|---|---|---:|---:|
   | Compact | 20 × 24 m | 5 × 6 | 480 m² | 130 KCO |
   | Standard | 20 × 32 m | 5 × 8 | 640 m² | 173 KCO |
   | Large | 28 × 36 m | 7 × 9 | 1,008 m² | 272 KCO |
   | Smallholding | 100 × 100 m | 25 × 25 | 10,000 m² (1 ha) | 2,700 KCO |

   These replace the sizes still published on main (compact 36 × 44 m / 1,584 m² through estate 92 × 116 m / 10,672 m², and grand). A 1 ha smallholding is the rare top tier, not the default “estate” lot. A 2 ha Long Acres-like size was considered and not chosen.

2. **Rate:** `LAND_PRICE_PER_M2_KCO = 0.27`, on the **full fenced parcel** (`areaM2 = widthM × depthM`), not the house-zone cell count used by spec 085. The for-sale board must show width × depth, area, total price, and rate that multiply. The house-zone total vs full-area rate mismatch on unmerged [PR #583](https://github.com/duikindiesee/citylife/pull/583) is a defect this contract forbids.

3. **House-fit references** for later tests, from Residential Zone I of the Saldanha Bay IZS (2021), not invented national minima:

   - Maximum coverage (all buildings): **60%** on 250–under 500 m² (Compact 480 m² → 288 m²), **50%** on 500–under 750 m² (Standard 640 m² → 320 m²), **40%** on 750–under 1,500 m² (Large 1,008 m² → 403 m²). Properties 1,500 m² and larger are 30% in RZ I. Langebaan smallholdings are a **different zone** (IZS Smallholding: 20 m street and 10 m side-and-rear lines) and must not silently reuse the suburban coverage table.
   - Street building line for properties larger than 250 m²: **3 m**. Rear line is also 3 m on those stands. Side lines depend on average width (1.5 m above 10 m up to 16 m; 2.5 m above 16 m).
   - A published house must sit inside that envelope. It must not stretch to fill the house zone of a much larger parcel (today an estate house can be drawn on the order of 76 × 56 m).

4. **Starter grant, wallets, and a later earn loop** are recorded in [spec 182](182-starter-economy.md). The grant floor is ≥ 1,300 KCO (house 350 + gold X19 950). That change is not implemented in this PR.

**Still open after this date:** the questions in [Open questions for Irwin](#open-questions-for-irwin) below, including the waterfront premium, plus the grant-amount follow-up in spec 182 (whether 1,300 should rise to ~1,500 so house + a Standard plot + X19 fit).

## Mechanic

1. **Every residential plot is a deeded parcel in a neighbourhood.** The world remains a function of the terrain seed (spec 076 / 086), but each parcel has a stable `plotId`, a `neighbourhoodKey`, a measured size and area, a status, and at most one `ownerId`. The primary coastal neighbourhood gets an explicit key (proposed: `coast-primary`) instead of remaining "no key means open land".
2. **The player chooses a specific available plot.** After (or together with) the house step, the player picks a plot from the live available set — in the world, from the board, or from the property UI — not "any lot in this neighbourhood, server or client decides which".
3. **Purchase is server-authoritative and exclusive.** The client posts the selected `plotId` (plus the neighbourhood key and layout revision for binding), a stable `Idempotency-Key`, and nothing else. The service reserves the plot, checks the token identity and the wallet, moves KCO through kooker-service-ledger, and records the deed. Only then may the client mark the parcel owned and raise the house or garage-first starter (spec 180). A second buyer, a replay, or a stale offer cannot take a reserved or owned plot.
4. **Unsold, unreserved plots carry a For Sale board** at the gate, showing width × depth in metres, area in m², total price, and the price per m².
5. **Price is area × a single rate.** `priceKco = round(areaM2 × LAND_PRICE_PER_M2_KCO)` with `LAND_PRICE_PER_M2_KCO = 0.27`. The client displays the server-quoted price and never submits one. Whether a waterfront surcharge is added on top is still open (see below).

## Rules & data

### Data model

A neighbourhood contains an ordered set of plots. One plot:

| Field | Rule |
|---|---|
| `plotId` | Stable engine id (today's `Parcel.id`, e.g. `lot_3`, `wood1_lot_3`, `coast4_lot_1`). Unique in the published layout revision. |
| `neighbourhoodKey` | Always set. Satellite and coastal hamlet keys stay as generated. The unkeyed primary coastal neighbourhood is named rather than left blank. |
| `widthM`, `depthM` | `Parcel.w * CELL_SIZE` and `Parcel.h * CELL_SIZE` (`CELL_SIZE = 4` in `src/colony/scale.ts:21`). The published player-market tiers are Compact 20 × 24 m, Standard 20 × 32 m, Large 28 × 36 m, and Smallholding 100 × 100 m (see [Decision log](#decision-log)). Main still generates the older cell sizes (an ESTATE plot is 23×29 cells = 92×116 m; spec 084 / `neighborhood.ts:113-121`); those dimensions are superseded for this contract. |
| `areaM2` | `widthM × depthM` (the fenced parcel, not the house-zone only). |
| `priceKco` | `round(areaM2 × 0.27)`, server-quoted. The constant name remains `LAND_PRICE_PER_M2_KCO`. |
| `status` | `available` \| `reserved` \| `owned`. Founder parcels (spec 078, `reservedFor`) are not in the available set and have no board. |
| `ownerId` | The authenticated player's user id when `owned`; empty otherwise. This is the deed. The local `ownerCitizenId` is a projection of that deed onto the operator citizen, never the source of truth. |
| `reservedBy`, `reservedUntil` | Set only while `reserved`. |

Commercial shop parcels (spec 079) stay on their own purchase path unless a later spec folds them in.

### Purchase flow

Mirror vehicles (spec 171) and the starter-home POST (spec 156), but **select a plot**.

1. **List.** `GET /kooker/api/v1/citylife/players/me/home/available-plots` returns the plots this player may buy in the loaded world and layout revision: `plotId`, `neighbourhoodKey`, `frameId`, `width`/`depth` (cells or metres, documented by the service), and `priceKco`. A malformed or cross-revision catalogue is rejected as a whole (same fail-closed rule as PR #524's `parseStarterPlotOffers`). Private neighbourhoods are omitted by the authority, not filtered in the client.
2. **Choose.** The player selects one `plotId` that is in the list just returned. The UI and the in-world board are views of that list. The client refuses locally — without touching the wire — a plot the server did not just offer.
3. **Reserve.** The purchase POST must reserve (lock) that `plotId` for this player before debiting, so two concurrent buys cannot both succeed. A short-lived reservation held by this player can be resumed with the same idempotency key (insufficient funds, reload). A reservation held by someone else is a conflict: the client refreshes the available list and does not retry the same POST blindly. **Reservation lifetime is an open question** (see below).
4. **Pay and grant.** `POST /kooker/api/v1/citylife/players/me/home/purchase` with body `{ neighbourhoodKey, plotId, layoutRevision }` only, plus `Idempotency-Key: citylife:plot-purchase:<userId>:<plotId>:<layoutRevision>`. The service independently re-validates eligibility, geometry, neighbourhood access, availability, and the **server** price; it moves KCO on kooker-service-ledger (`LAND_PURCHASE`, citizen wallet → city land office / treasury) and writes the deed. HTTP mapping stays aligned with spec 156 where possible: `200/201` owned, `422` insufficient funds (no coin moved, reservation may be retained for resume), `202` pending, `401/403/503` disabled, `409` conflict (refresh offers; do not treat as a successful replay).
5. **Project.** The client re-fetches `GET /players/me/home` (and, once it exists, a plot-ownership truth that can list more than one deed). Only an authoritative `owned` (or `PLOT_OWNED` if land is paid and the house is not yet built) updates `Parcel.ownerCitizenId` and allows `buildHouse` / the garage-first starter module. `claimStarterHome` must not assign a plot that the server has not granted.

Local `purchaseLot` / `assignLot` / no-argument `claimStarterHome()` remain for NPC/dev/legacy tools until they are boxed behind a non-player path, but they must **not** be able to overwrite a server-deeded plot, and they must not be the player journey.

### Exclusivity and conflicts

- An `available` plot may be reserved or bought by at most one player.
- A `reserved` or `owned` plot is absent from every other player's available list and has no for-sale board.
- `assignLot`'s current "move house, vacate the old lot, no refund" behaviour must not run against a server deed.
- Demolishing a house does not sell the land. Returning a deed to the market is out of scope until explicitly asked.
- Reloading, a second device, or a multiplayer peer must converge on the same owner for the same `plotId`. Until plot deeds are on the multiplayer wire, the client still treats the user-service deed as authority and must not locally claim a plot another player owns.

### For-sale board

Every `available` residential plot shows one board at the gate (the art and placement land with spec 180 / PR #583). The board text is a view of the server offer:

- neighbourhood name or key;
- width × depth in metres, and area in m²;
- total price in KCO;
- price per m² (the `LAND_PRICE_PER_M2_KCO` rate, or total ÷ area if the service only quotes a total).

`reserved` plots show no buy affordance (a "held" state is allowed, not required). `owned` plots show no board. Founder-reserved parcels never show one.

### Pricing

- Rate constant: `LAND_PRICE_PER_M2_KCO = 0.27` (operator decision 22 Nov 2026). Applied to the full fenced parcel. Worked prices are Compact 130, Standard 173, Large 272, and Smallholding 2,700 KCO. A Standard plot is about half the 350 KCO starter house; a 1 ha smallholding is a premium buy (7.7× the house).
- The earlier working assumption that the rate would be derived so a starter-sized parcel still cost 350 KCO is **withdrawn**.
- Area is the full fenced parcel in m² (`w * h * CELL_SIZE²`). The board's area, rate, and total must agree.
- Spec 085's `plotAreaRate` / house-zone / waterfront formula stays in place for the legacy HUD and NPC `purchaseLot` until the player path has cut over. Do not silently mix the two on one deed.
- Waterfront is still open. Adding the current 120 KCO premium (`src/colony/config.ts:1072-1077`, decaying 2 ₭ per cell from water) on top of a 173 KCO Standard plot is a 69% surcharge and would outweigh the area term. Do not ship 0.27 plus the old 120 premium without an explicit decision.
- The client never authors or submits a price.

### Starter garage-first home and `claimStarterHome`

- The garage-first starter (operator decision 20 Nov 2026; spec 180) is the **house module** that appears on the purchased plot (garage first, then the attached home). It does not replace the land deed and must not be stamped onto every residential lot via the existing `functional_garage` override once this path is live.
- Migration: `claimStarterHome(HomeTruth)` may still project an already-granted starter deed onto the matching world lot and build there. It must refuse when `plotId` is missing, mismatched, or owned by someone else. The no-argument "first free primary lot, no payment" fallback (`runtime.ts:4828-4850`, tested in `tests/onboardingAndGarageDriveIn.test.ts`) is not a player purchase and must be removed from the entitled journey.
- Existing starter-home deeds (`starter-home:<userId>` from spec 156) are grandfathered: do not charge again, and do not silently remap them onto a different shared parcel. If the server-allocated id does not match a world lot, that is a migration defect to fix in the service, not a reason to grab the nearest free land.
- The `new-player-journey-v1` fail-closed gate still wraps the entitled purchase UI.

## Open questions for Irwin

Plot tiers, the 0.27 KCO/m² full-parcel rate, and the 1 ha smallholding are settled in the [decision log](#decision-log). The starter grant floor is settled in [spec 182](182-starter-economy.md). Mark the following before implementation; the rest of the contract can be built around the answers.

1. **One plot per player, or several?** Today `assignLot` is 1:1 and vacates the previous lot. "After buying a house you can pick any plot" can mean (a) the starter house is bought, then the player chooses the one plot it sits on, or (b) a player who already has a home may later buy additional plots and keep them all. This spec treats (a) as the minimum and leaves (b) **undecided**. If (b) is yes, `GET /players/me/home` must grow into a list of deeds, and `assignLot` must stop clearing the previous owner.
2. **Sequence.** Is the intended order "buy the starter house product, then choose its plot", "choose the plot and the garage-first house in one purchase", or "starter home first (current 350 KCO neighbourhood grant), and later a separate land market"?
3. **Relocate.** The overlay already offers "Select a different coastal plot" after ownership. Is a move allowed? If yes, is the old plot returned to the market, and is there a refund or a second charge?
4. **Waterfront / house-zone premium.** Keep spec 085's waterfront surcharge on top of the now-decided 0.27 KCO/m² rate, or is the flat per-m² rate the only residential price? Unresolved, and more acute at the new rate: +120 KCO on a 173 KCO Standard plot is a 69% surcharge.
5. **Reservation lifetime.** How long is a lock held on insufficient funds or an abandoned checkout? PR #524 reserved before debit but left the timeout to the service.
6. **Primary neighbourhood key.** Is `coast-primary` an acceptable stable key for today's unkeyed coastal lots, or should it follow an existing catalogue name?
7. **Commercial land.** Include high-street shop parcels in this deed register, or keep them on spec 079?

## Acceptance

Implementation is a later PR. That PR is not done until all of the following hold:

- A numbered test pins the data model: every residential parcel on the published layout has a `plotId`, a non-empty `neighbourhoodKey`, width/depth in metres, `areaM2 = widthM * depthM`, and a status in `{ available, reserved, owned }`.
- Price tests use `LAND_PRICE_PER_M2_KCO = 0.27` on the full parcel area and pin Compact 130, Standard 173, Large 272, and Smallholding 2,700 KCO. They do not invent a third schedule. Founder parcels remain unpriced and unlisted. A board whose printed total, area, and rate do not multiply fails.
- House-fit tests for each published tier use the Saldanha Bay IZS coverage band and the 3 m street building line in the decision log. A starter house must sit inside that envelope and must not stretch to fill the parcel.
- Purchase tests (same shape as `tests/starterProperty.test.ts` / `tests/carAcquisition.test.ts`): the client posts only `{ neighbourhoodKey, plotId, layoutRevision }` and a stable idempotency key; a key or plot not in the latest offer never reaches the network; classified outcomes match the table above.
- Exclusivity tests: a second buyer, a parallel client, or a local `purchaseLot` / `claimStarterHome` cannot take a reserved or owned `plotId`. Replays with the same idempotency key do not double-charge. A 409 refreshes offers instead of granting.
- Journey tests: the entitled player can choose a **specific** available plot (not only a neighbourhood). `claimStarterHome()` with no grant does not assign open land. An existing spec-156 deed is not re-charged and is not moved to a different lot.
- Board tests: every `available` plot exposes size, area, total price and price per m²; `owned` and founder parcels do not. Visual placement may land with PR #583, but the data contract is this spec's.
- Fail-closed: with `new-player-journey-v1` off, unreachable, or 401/403/503, the new purchase UI is absent and no KCO moves.
- Full CityLife `typecheck` + targeted tests + production `build` green. Nothing merges to `main` without review.

Move this file to `docs/specs/built/` and mark `built` only when the implementation PR has shipped.
