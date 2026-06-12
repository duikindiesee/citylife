# Spec 085 — Land economy: priced plots + Kook wallets

- status: building
- proposed-by: irwin (operator directive 2026-06-12: an upfront Kook deposit to purchase land, each
  plot priced; ZAR anchor ~25:1) + claude
- date: 2026-06-12
- depends-on: 083 (Viw + the build trade), 084 (the estate plots), the in-game ledger (ledger.ts)

## Why

Land is free today — a citizen is just assigned a plot. The operator wants a real upfront economy:
each plot priced in Kookercurrency (the in-game **Kook, ₭**), and a citizen must hold a deposit and
BUY the deed before they own land. This is the bridge to the real-world framing — buying the Mac
Mini is a "starter package" (the hardware the city runs on + a seeded ₭ wallet) — and it completes
the trade arc: arrive with a deposit → buy a plot → commission Viw to build → the ₭ actually moves
(client → land office on purchase, client → Viw on the build), all on the existing double-entry
ledger so it can sync to kooker-service-ledger later.

## The numbers (operator-anchored, grounded against engine prices)

- **1 ₭ = R25** (`zarPerKook`) — premium, clean math (4₭ = R100).
- **Plot price** = round(houseZoneArea × `plotAreaRate` 0.6 + waterfront premium), the premium
  = max(0, `waterfrontPremium` 120 − distToWater × 2). ESTATE (266 cells) ~160–250 ₭; GRAND
  (368 cells) ~220–340 ₭. Founder/reserved plots are NOT for sale.
- **Starter deposit** on arrival = `starterDepositMin` 600 + seeded(0..`starterDepositSpread` 400)
  = 600–1000 ₭ (R15k–25k ≈ a Mac Mini starter package), deterministic per citizen seed. Always
  covers the dearest plot, so a fresh arrival can always buy in.
- Houses (Viw) keep the spec-083 priceBrief (~150–500 ₭); the commission now debits the wallet.

## Mechanic

1. EVERY CITIZEN HOLDS A ₭ WALLET — a `citizen:${id}` account on the in-game ledger, seeded with the
   starter deposit at arrival (off-world holdings injected at the border, like the old settler
   deposit). balance() is the wallet.
2. PLOTS ARE PRICED — each parcel carries a ₭ price from its zone area + waterfront premium,
   surfaced in the HUD with the ZAR equivalent. Founder plots read "not for sale".
3. BUY THE DEED — purchaseLot(citizenId, lotId) gates on wallet ≥ price, posts the land payment
   (client → land office), assigns the lot, and posts a Kookerbook deed event. The player's "Buy
   (N ₭)" button replaces the free Assign; arrivals auto-buy the cheapest affordable free plot.
4. THE BUILD COSTS TOO — commissionLot now negotiates against the REMAINING wallet (you build what
   you can afford after land) and, on a deal, posts the client → Viw payment. Money conserved
   end-to-end; Viw's account grows as he builds.
5. THE BRIDGE — kookToZar(₭) drives the HUD ZAR readout; the real kooker-service-ledger sync (now
   that its pod is up + jwt-auth'd) is the P1 follow-on (best-effort, never-block).

## Architecture

- src/colony/land.ts — pure: plotPriceKook, kookToZar, starterDeposit. Node-tested.
- config.ts economy.land — the tunables above.
- runtime — wallets (citizen: accounts), purchaseLot, deposit-on-arrival, commission debit; UI
  state exposes per-lot price/priceZar + per-citizen walletK.
- ColonyApp — plot prices + ZAR, the Buy button (gated on funds), wallet per citizen.

## Acceptance

A newcomer arrives with a 600–1000 ₭ deposit; the HUD shows each plot's ₭ + ZAR price; Buy is
gated on funds; buying debits the wallet and assigns the deed (Kookerbook deed event); commissioning
Viw negotiates against the remaining wallet and moves ₭ to Viw on a deal; the ledger conserves
(deposits in = wallets + land office + Viw). Founder plots are unbuyable. Deterministic per seed.

## Phased build plan

- P0 — land.ts + config + wallets + purchaseLot + deposit-on-arrival + commission debit + HUD +
  tests. (this slice)
- P1 — sync the in-game ₭ moves to kooker-service-ledger as the signed-in player (best-effort,
  idempotent reference), now that the service is healthy + auth'd. This is 083-P4b folded in.
- P2 — a commercial plot tier (079) priced higher; shops on bought commercial land.

## Progress log

### 2026-06-12 — Slice: P0 priced land + Kook wallets
DONE
- src/colony/land.ts (pure): plotPriceKook (area × 0.6 + waterfront premium), kookToZar (× 25),
  starterDeposit (600 + seeded 0..400, deterministic per citizen id, always covers the dearest
  plot). config.economy.land carries the tunables.
- Runtime on the existing double-entry ledger: every citizen holds a `citizen:` ₭ wallet
  (walletK), seeded at arrival from an off-world `arrivals` account; plotPriceK prices each parcel
  (Infinity = founder plots, not for sale); purchaseLot gates on funds, moves ₭ client -> `land`,
  assigns the deed, posts a Kookerbook deed event; commissionLot now negotiates against the
  REMAINING wallet and moves ₭ client -> Viw on a deal. The economic arrival is one move: deposit
  -> buy the deed -> hire Viw to build what's left. Founders hold wallets too (Viw's grows as he
  builds). UI state exposes per-lot price/priceZar + per-citizen wallets; HUD shows plot prices in
  ₭ and ZAR and a funds-gated "Buy N ₭" button.
- Numbers (operator-anchored 25:1): live ESTATE ~172-230 ₭ (R4,300-5,750), GRAND not-for-sale
  founders; deposits ~675-787 ₭ on the founders. 10 new tests (pricing band, deposit covers
  dearest, ledger conservation, post rejects an unbalanced txn). 673 green.
- LIVE end-to-end + CONSERVED: a buyer with 675 ₭ bought a 196 ₭ plot (-> 479), commissioned Viw
  who agreed at 472 ₭ against the remaining purse (-> 7), the house built, Viw's account rose
  exactly +472, and the whole ledger nets to zero before AND after. The memos read true.
- Real-world bridge: the deposit band (R15k-25k) ≈ a Mac Mini starter package — buy the hardware
  (the land the city runs on) + a seeded ₭ wallet, and Viw (the brother's bot) earns it back.
NEXT
- P1: sync the ₭ moves to kooker-service-ledger as the signed-in player (best-effort, idempotent
  reference) — folds in 083-P4b, now that the service is healthy + jwt-auth'd.
- P2: a commercial plot tier (079), priced higher, for shops on bought land.

### 2026-06-12 — Slice: P1 sync the ₭ moves to the REAL ledger (folds in 083-P4b)
DONE
- src/colony/bot/ledgerSync.ts: a best-effort, never-block mirror of the in-game ₭ moves onto
  kooker-service-ledger as the signed-in player, same shape as bot/citizenSpawn + kookerbookStore.
  A localStorage-persisted FIFO queue drains in order through the /kooker proxy; each move carries a
  deterministic reference (the in-game ledger txn id) and a persisted synced-set, so a reload or a
  retry never double-posts (the service has no idempotency key of its own). Stops on the first
  failure with the queue intact and order preserved; a transient 5xx/429 schedules a retry, a 4xx
  waits for the next notice. The three move kinds map to the service primitives: deposit -> POST
  /wallets with initialBalance (idempotent on owner+type+app, seeds the citizen wallet so later
  txns have funds), purchase -> POST /transactions LAND_PURCHASE (CREDIT citizen, DEBIT the city
  land office), commission -> POST /transactions BUILD_FEE (CREDIT client, DEBIT Viw).
- Auth: the player's signed Bearer clears the gateway jwt-auth; the service reads identity from a
  client X-Kooker-User-Id header (no gateway injection on the ledger route), so the sync sends the
  player's own userId there and as the transaction initiatorId, which clears the service's
  caller==initiator check. Counterparty wallets (land office, Viw) auto-create at 0.
- runtime wires three notice() calls (seedDeposit / purchaseLot / commissionLot) behind a mirror()
  guard that never lets the best-effort path disturb the deterministic sim; uiState.bank.sync +
  __colony.ledgerSyncStatus()/flushLedgerSync() surface the queue health. ColonyApp drains a
  prior session's queue once on mount.
- 15 node tests (pure payload builders balance + carry the right type/ref/initiator, userId decode,
  FIFO order, dedup within a batch and after sync, stop-on-failure preserves order + resumes,
  transient-vs-4xx retry, no-session = silent queue, a thrown transport never escapes, persistence
  restores the queue + blocks re-posting across instances). 688 green (was 673). tsc clean.
- LIVE on :5188 against api.kooker.co.za: the two founder deposits POSTed /wallets 200 on boot; a
  full arrival (Dax) drained deposit -> /wallets 200, then purchase -> /transactions 200 COMMITTED
  (reference citylife:4) and commission -> /transactions 200 COMMITTED, in FIFO order (deposit
  seeds the wallet before the purchase debits it). In-game ledger still conserves to zero; sync
  status read synced:5 pending:0 lastError:null; the persisted synced-set restored across a reload
  with no duplicate posts. No ledgerSync errors (the 404s are the still-unimplemented social /
  blueprint / sub-user backends).
NEXT
- P2: a commercial plot tier (079), priced higher, for shops on bought commercial land — the
  storefront + checkout posts to this same sync as LAND_PURCHASE/TRANSFER.
- Latent on the service side (operator/Codex's call, NOT this slice): the ledger has no idempotency
  key and trusts a client X-Kooker-User-Id with the same userId as the (jwt-auth-validated) Bearer,
  so the gateway jwt-auth is what gates forgery — see project_pentest_kooker. The route's jwt-auth
  is still APISIX data-plane only until kooker-infra #147 merges.
