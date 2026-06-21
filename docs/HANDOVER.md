# CityLife — Session Handover (2026-06-12)

A cold-start brief for a fresh assistant session. Read this top to bottom, then the linked spec
docs for whatever slice you pick up. Your persistent memory (`MEMORY.md` + the `project_*` /
`feedback_*` files) carries the durable facts; this doc carries the live build state + history.

---

## 0. LATEST STATE (2026-06-21) — supersedes stale branch info below

- **Main is at `0.4.0`** (`deb8355`, PR #66). The **player-onboarding epic is MERGED** (citylife
  #65 idle-cinematic login, #67 KOOKER-as-Builder + per-player data isolation; kooker-service-user
  #142 `CITYLIFE_PLAYER` role; kooker-web #362 create+fund 750 KCO+telegram bot). Still pending
  (operator): seed the `system_cl` KCO reserve; decide on the accounts-lineup fix (first-login player
  provisioning keyed by the kooker `userId`).
- **Active branch: `feat/citylife-builder-expansion`** (off `main`) — the **house-builder expansion
  epic** (/loop). Rolling **PR #68**. A 6-slice plan (see `project_citylife_builder_expansion`
  memory): **Slice A DONE** = author-able furniture in the blueprint DSL (`item{kind x y rot}` token,
  `furniture.ts` 11-piece catalog, 8 new furniture BlockKinds, `buildFurnitureItems` compiler stamp,
  builder furniture palette). **Slice B DONE (2026-06-21, commit `32b7419`)** = multi-level floor
  plans: optional storey `z` on room{}/item{} (parsed-when-present, serialised-when-nonzero → existing
  scripts byte-identical), **content-driven** inter-storey floors + a stacked stairwell (only under
  upper rooms/furniture, so an estate stays under the 60k budget), per-storey dividers, new `stair`
  BlockKind, editor storey selector + per-floor 2D ghosting + floor ▲/▼ (all `data-build-action`),
  `setWallH` re-homes stranded content. `tests/multiLevel.test.ts` (21 tests), **790 green**, tsc
  clean; verified via tests not the 48px preview. Multi-agent adversarial review caught+fixed 3 issues
  pre-commit. Spec `docs/specs/088-builder-expansion.md`. **Slice C DONE (2026-06-21, commit `86f5939`)** =
  furniture inventory store `src/colony/bot/furnitureStore.ts` (per-player `OwnedFurniture` keyed by
  citizenId; two-layer local `citylife.furniture.v1` + best-effort `/kooker/api/v1/citylife/furniture`
  as the player, mirroring `blueprintStore`; pure add/remove/merge/dedupe ops; isPublicSafe-screened;
  id recomputed from kind+name so a tampered id cannot spoof). `tests/furnitureStore.test.ts` (13),
  **803 green**, tsc clean. The kooker-service-user backend it syncs to is **PR #144** (consolidated
  the old CX-1/CX-2 stores; #139/#140 closed). **Slice D economic core DONE (2026-06-21, commit `60e64a8`)** = furniture studio buy: `furnitureShop.ts`
  (pure ₭ price table + studio account), `ledgerSync.ts` `furniture_purchase` move (+ `furniturePurchaseBody`
  FURNITURE_PURCHASE, ref keyed on a lifetime `nextPurchaseSeq`), `runtime.buyFurniture(citizenId,kind,name)`
  mirroring `buyCommercialShop` (gate→ledgerPost citizen/studio→record inventory→mirror→kbPost). 2 HIGH
  review bugs fixed (blank-name free furniture; mirror-ref collision on capped qty). `tests/furnitureShop.test.ts`
  (10), **813 green**. REMAINING for D: the design-studio UI (pick kind/name + buy button, `furniture_studio`
  business). **Slice E DONE (2026-06-21, commit `c6505e6`)** = place owned furniture into a house:
  `blueprintEdit.placeItemAt` (pure: place at exact clamped cell/rot/storey, cap-respecting) +
  `runtime.placeFurnitureFromInventory(citizenId,lotId,itemId,x,y,rot?,z?)` (own-piece + own-lot gated →
  append to lot blueprint → rebuild via applyBlueprint → consume via removeOwned + best-effort backend).
  `tests/placeFurniture.test.ts` (8), **821 green**, adversarial review found 0 defects. Known cosmetic
  for the UI pass: each placement posts a Kookerbook "redesigned" event (N pieces → N posts). **Slice F CORE DONE (2026-06-21, commit `dc69156`)** = Kookerbook furniture marketplace:
  `src/colony/bot/furnitureMarket.ts` (two-layer public listing board, mirrors furnitureStore; listing
  `{id,sellerCitizenId,kind,name,price}`, id embeds ownedFurnitureId; isPublicSafe-screened both ways,
  tamper-proof id, cap 256, backend `/kooker/api/v1/citylife/furniture-market`) + runtime
  `listFurnitureForSale` / `unlistFurniture` / `marketListings` / `buyFromMarket` (reuses buyFurniture).
  `tests/furnitureMarket.test.ts` (12), **833 green**, adversarial review 0 defects.
  **ALL SIX BACKEND SLICES A–F DONE.** UI pass IN PROGRESS: **D furniture-studio panel DONE
  (commit `0d867c2`)** — a "Furniture studio" HUD panel in `ColonyApp.tsx` (player-gated on
  `operatorCitizenId`; wallet + owned inventory list + kind/name/Buy → `runtime.buyFurniture`; all
  `data-build-action`; LIVE-VERIFIED on the dev server via preview tools — set `__colony.setOperatorName(
  'Joe the Crab')` to reveal the player-gated panel). REMAINING UI: E place-controls (drop owned furniture
  into the house → `placeFurnitureFromInventory`), F Kookerbook market tab in `kookerbookMain.tsx`
  (`marketListings`/`listFurnitureForSale`/`unlistFurniture`/`buyFromMarket`); optional `furniture_studio`
  business; fix the cosmetic per-placement "redesigned" Kookerbook event. Dev server: preview 'citylife' on :5188.
- **Note:** the builder's 3D preview pane renders ~48px wide in its 3-column layout — verify furniture
  via tests (a quadCount render-path proof), the 2D plan markers, and the DSL textarea, not the canvas.
- **Scheduler note (updated):** in-session `ScheduleWakeup` IS firing this session — the /loop runs on
  it plus background-task completions.

---

## 1. Where everything is

- **CityLife game (your main lane):** `D:\infra\projects\citylife-visual` — a git **worktree** of the
  public repo `github.com/duikland/citylife`, on branch **`mechanics/dev`**. Last commit `aa88495`.
- **Dev server:** `npm run dev` → http://localhost:5188 (binds 127.0.0.1; `?skipauth=1` bypasses the
  login gate in dev). Restart with `npm run dev` run in the background if it's dead.
- **Stack:** React 19 + TypeScript + Vite + plain three.js. Tests: **vitest** (node env). Pure
  deterministic sim — **no `Math.random` / `Date.now()` in the sim tick**; everything seeded.
- **Verify a slice:** `npx tsc --noEmit` (typecheck) + `npx vitest run` (currently **711 tests**). NOTE
  Vite HMR does NOT re-instantiate the singleton `ColonyRuntime`, so after editing runtime/uiState do a
  full page reload before live-checking `window.__colony` — a hot-swap alone shows stale state.
- **Active branch is now `feat/rally-and-bot-worklife`** (fresh off `main` after PR #42 squash-merged
  all the commerce + lighthouse work). It carries: Codex's Spec 087 P0 Road Rally (his PR #44 merged in
  then closed — same consolidate-then-close flow as the lighthouse #43), **081-P0 ad boards** (billboards
  - deterministic canvas posters), and the **080 CityLife Workstation badge**. 746 green, tsc clean,
    pushed; ready to PR into `main`. `feat/commercial-visuals` and `mechanics/dev` on the remote are stale
    pre-squash orphans — don't push to them. The rolling lane convention continues on this branch.
    Then LIVE on :5188 — drive `window.__colony` via JS evals (see §6). NOTE: Chrome CDP **screenshots
    are broken this session** (`clip.scale` error) — verify with JS evals + `read_console_messages`,
    not screenshots.
- **Kooker monorepo:** `D:\infra` (NOT `D:\infra\projects`). Each kooker service is its own dir.
- **Repo-mirroring way-of-work (operator-blessed):** clone any repo you do branch/PR work on under
  **`D:\infra\claude\<repo>`** (mirrors Codex's `D:\infra\codex\`). `D:\infra\claude\kooker-infra`
  already cloned. Cross-agent trees are **read-only** to you. `kooker-infra` is shared collab with
  Codex. See `feedback_repo_mirroring` memory.

## 2. Hard rules (do not violate)

- **`main` is PROTECTED** — PRs only, the operator/joekookerbot merges, **never self-merge**. Squash
  or rebase only (no merge commits). PR #40 (the rolling 077 PR) is MERGED, so `mechanics/dev` now
  carries unmerged 082/083/084/085 work → **a fresh PR into `main` is an open action** (operator
  squash-merges; after merge, reset `mechanics/dev` onto `main`).
- **CI-safe commit bodies:** no double quotes, brackets, or colon-bullet lines — they break
  kooker CI via shell injection of `head_commit.message`. Write to `.git-commit-msg.tmp` and
  `git commit -F`. End with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`isPublicSafe` denylist eats the brand-word family** (`/kooker/i`, `/token/i`, `/secret/i`…).
  Any string shown to players / posted to Kookerbook / in a bot profile must NEVER contain
  "kooker" — the in-game currency is shown as **"city coin"** or **₭**, never "Kookercurrency". This
  silently dropped Viw's first profile; `ensureKbProfile` now warns on a screened-out profile.
- **Secrets:** `.env.local` values (`VITE_OPERATOR_PASSWORD`, `VITE_CITYLIFE_PAT`) are never echoed
  or committed. `KOOKER_GATEWAY` stays `https://api.kooker.co.za` ("all is dev, no separate prod").
- **Scheduler caveat:** in-session `ScheduleWakeup`/`CronCreate` timers DO NOT reliably fire in this
  build. The loop runs on user pings + background-task completions. Don't promise autonomous wakeups.
- **Don't probe the shared cluster unprompted** (kubectl into prod MySQL, reading secrets) — the
  classifier blocks it and it's the operator's/Codex's call. Read-only HTTP probes through the
  game's own `/kooker` proxy are fine.

## 3. What's shipped (the recent arc, all on `mechanics/dev`)

- **Spec 077 — Bot House Builder** (DONE, merged via PR #40): blueprint DSL → compiler (N=6
  micro-grid) → greedy mesher → visual builder (`builder.html`) → per-citizen variety → bot
  self-design. `src/colony/blueprintScript.ts`, `houseBuilder.ts`, `builder/`, `render/voxelMesh.ts`.
- **Spec 082 — Kookerbook** (P0–P2): a mini social net for bots. `social/kookerbook.ts` (model),
  `bot/kookerbookStore.ts` (local + best-effort backend, the backend `kooker-service-social` is
  UNIMPLEMENTED — local layer carries it), `social/kookerbookMain.tsx` + `kookerbook.html` (the
  site). Engine events auto-post to timelines.
- **Spec 084 — World v2** (S0–S6 ALL DONE): the **608-cell world** (~10×), masterplanned ESTATE
  (19×14 zone) + GRAND (23×16) plots, **Joe = lot_1, Viw = lot_2** (renumbered GRAND-first by
  distance to water), road kinds (avenue/street/path, the avenue is a real drivable road now),
  enforced voxel budget, chunked terrain + follow-shadows, A\*+searchRect. `docs/specs/084-world-v2.md`
  has the full slice log + named deferrals (road-following citizen walks, gravel driveway ribbons).
- **Spec 078 — Joe the Crab** + **Viw the Builder** = the two founders (reserved, demolish-proof,
  crafted houses). Viw's door is fixed EAST so the side-walkway contract is dogfooded every boot.
- **Spec 083 — the builder trade** (P0, P1, P2, P4a DONE): Viw negotiates builds.
  `builder/negotiation.ts` (pure: `dreamBrief`/`priceBrief`/`negotiate`/`briefToBlueprint` +
  `VIW_SEED`/`seededBudget`), `builder/BuilderDesk.tsx` (the haggle panel in builder.html),
  `runtime.commissionLot` (in-engine "Hire Viw" → house builds + posts both timelines).
- **Spec 085 — land economy** (P0 + P1 DONE): priced plots + ₭ wallets on the in-game double-entry
  `ledger.ts`. `land.ts` (pure pricing/deposit, **25 ZAR : 1 ₭**), `runtime.purchaseLot` /
  `walletK` / `plotPriceK`, deposit-on-arrival, commission debits the wallet. Full loop CONSERVES:
  deposit → buy deed → pay Viw → Viw earns. HUD: ₭+ZAR plot prices + funds-gated Buy button.
  **P1** (`bot/ledgerSync.ts`) mirrors every ₭ move onto the REAL `kooker-service-ledger` as the
  signed-in player — best-effort, persisted FIFO queue, idempotent on the in-game txn id; LIVE-verified
  200/COMMITTED end-to-end. Folds in 083-P4b (the Viw payment is now a real BUILD_FEE txn).
- **Spec 086 — the distributed city** (P0 DONE): the world no longer crams plots on one avenue.
  `neighborhood.makeNeighborhoodAt(anchor, {small,blocked})` + `findSatelliteAnchors` scatter small
  hamlets across biomes (coast primary keeps the founders; satellites in woods/hills), a shared
  `taken` set keeps every cluster overlap-free, and trunk roads (leastCostPath around homesteads)
  stitch them to the coast. Commercial reserved BEFORE satellites so it keeps its room. Order of ops
  in `runtime` is a council invariant — see `docs/specs/086`. LIVE: 4+ clusters, all road-connected,
  0 overlaps. **086-P1 DONE (2026-06-13):** commerce now sits on the shore beside the lighthouse — the
  reserve search anchors on `structures.lighthouse` (tower + 4-cell buffer blocked), scores clear COASTAL
  ground biased toward the founders' side, falls back to the inland search if no lighthouse; the connector
  spur routes from the founders' nearest carriage cell. LIVE seed 4242: reserve (117,234), ~52 cells off
  the lighthouse, road-connected to the founders by BFS, no shop on the tower. Note: a ColonyRuntime boot
  is now heavy → vite.config testTimeout bumped to 20s.

## 4. What to build next (the queue, with priorities)

0. **085-P1 / 083-P4b — sync ₭ to the REAL ledger — DONE (2026-06-12).** `src/colony/bot/ledgerSync.ts`
   mirrors the in-game ₭ moves onto `kooker-service-ledger` as the signed-in player (best-effort,
   persisted FIFO queue, idempotent on the in-game txn id). deposit→POST `/wallets` (initialBalance,
   idempotent), purchase→`/transactions` LAND_PURCHASE, commission→`/transactions` BUILD_FEE. Auth =
   player Bearer (clears gateway jwt-auth) + `X-Kooker-User-Id` = player userId = `initiatorId`
   (clears the service caller==initiator check; the ledger route does NOT inject the header). 15 new
   tests, 688 green. LIVE-verified against api.kooker.co.za: deposit/purchase/commission all 200 +
   COMMITTED in FIFO order, ledger conserves, synced-set survives reload with no double-post. See
   `docs/specs/085-land-economy.md` P1 log.
1. **083-P3 — inference-authored Viw dialogue.** kooker-service-ai chat phrases the haggle (screened,
   deterministic fallback intact). Off-machine inference, fits the lean-dev constraint. **Recommended next.**
2. **079 — commercial plots + shops (P0 DONE 2026-06-13).** `commerce/district.ts` surveys a vibrant
   neon high street (10 shop plots: kiosk/store/showroom, priced 220/420/720 ₭) on the reserved 40×30
   land bank; the renderer raises glowing market stalls that flare at dusk. **P1 DONE** — shops are
   buyable: `runtime.buyCommercialShop` / `claimNextShop` debit ₭ (citizen -> land office) mirrored to
   the real ledger as a LAND_PURCHASE, a funds-gated HUD "Open a shop" button, arrivals claim a shop
   when affordable. NEXT: **079-P2** real shop massing via the voxel core (replace the placeholder
   stall). See `docs/specs/079` P0+P1 log + `docs/research/2026-06-13-district-concept.md`.
3. **082-P3** narration + generated portraits (via the existing kooker image-gen APIs, off-machine).
4. **Named deferrals from 084:** road-following citizen walks (citizens cut across lawns today),
   gravel driveway ribbons, foliage chunk-bucketing.

## 5. In-flight / blocked / cross-agent state

- **Codex is active + reliable** (`D:\infra\codex\`): built the ledger (kooker-service-ledger PRs,
  CX-3 hardening) and the password rotation. Just closed the ledger auth bypass.
- **CROSS-AGENT RENDERER LANE (2026-06-13):** Codex is taking the **Founders Lighthouse + Rockery
  Beach** shore-render slice (`sim.ts` StructureKind `lighthouse` + a deterministic shore placement,
  `PlanetRenderer.makeStructure` + static shore props, placement tests). Claude owns **commerce**
  (`commerce/*`, the commercial render block in `PlanetRenderer`). BOTH edit `PlanetRenderer.ts`, so:
  (a) Codex works in his OWN clone/branch off `main` (a different dev port), NOT this worktree;
  (b) lowest-friction is to merge PR #42 first, then Codex branches fresh (zero conflict); (c) Codex
  should factor the lighthouse + shore props into their own `render/shoreProps.ts` so the
  `PlanetRenderer.ts` diff is a couple of call-sites; (d) Claude keeps 079-P1+ OUT of the renderer
  (runtime/ledger/HUD only) until the lighthouse lands. The two places don't overlap in-world (shore
  vs the inland avenue). NB the existing red shore beacon is the ROCKET/dropship nav beacon, not a
  lighthouse — keep them distinct.
- **MERGED 2026-06-13:** Codex's lighthouse (PR 43, `ce79b88`) is now merged INTO `feat/commercial-visuals`
  (merge commit `1df3afe`). Factored exactly as planned into `render/shoreProps.ts` (217 lines); the only
  conflict was vite.config testTimeout (kept 20s). Placement is `findFoundersLighthouseSite` in `sim.ts` —
  Rockery Beach headland first, dry-shore fallback — pushed into `state.structures` as kind `lighthouse`
  (live-verified at grid (85,249), renders correctly on the shore). 729 green, tsc clean, no console errors.
  **086-P1 is now UNBLOCKED** — anchor the commercial reserve near `structures.find(s => s.kind ===
'lighthouse')` instead of the inland avenue terminus.
- **Spec 087 Road Rally (2026-06-13):** operator + Codex proposed a road-rally mini-game overlay; Claude
  reviewed it (multi-agent) — verdict **approve-with-changes**, see `docs/specs/087-road-rally-minigame.md`
  (14 required changes, the critical ones: track gen must never touch `sim.rng`; build from `roadKind` not
  `roadSet`; lap timer accumulates clamped dtReal; gate chase camera like first-person; `raceLayer.dispose()`
  on race EXIT; emissive < 0.9 bloom threshold). **Codex builds it** in his own clone/branch; the do-not-touch
  list protects the bar-seating lane, `traffic.ts`, and `state.cars`. Brief handed to operator
  (`Desktop\codex-road-rally-prompt.txt`).
- **Antigravity is DEAD to us** — leaving this machine (resource hunger). Its delegated work
  (`kooker-service-social` = the Kookerbook backend) won't be picked up; Kookerbook stays on its
  local layer as designed. Don't watch `origin/antigravity/*`.
- **Two operator durability loose ends** (see `project_pentest_kooker` memory): (1) the ledger
  jwt-auth route is APISIX **data-plane only** — kooker-infra #147 must merge + an unrelated
  kooker-metrics-proxy reconciliation must clear, else it can revert; (2) the DB password rotation
  patched live secrets but the **operator confirmed they saved the Machine env var**, so rebuilds
  survive. kooker-infra #146 (committed-secret removal) was merged.
- **Latent security:** `AutomationFactory` decode-without-verify still latent (pentest memory).
- **Resource reality:** this machine is DEV; a prod server is the near-term goal. Heavy inference +
  image gen are already off-machine (ultra account / vast.ai). The local `kind` cluster (full kooker
  stack) is the heavy local tenant. **Prefer local-only slices that keep the dev box lean.**

## 6. How to live-verify (since CDP screenshots are broken)

`window.__colony` is the runtime. Useful handles:

- `c.lots()` — parcels (`.priceK` via `c.plotPriceK(lot)`, `.ownerCitizenId`, `.built`, `.reservedFor`).
- `c.walletK('citizen_id')`, `c.purchaseLot(id, lotId)`, `c.commissionLot(lotId)`, `c.selfDesignLot(lotId)`.
- `c.kbProfile('citizen_id')`, `c.kbProfiles()` — Kookerbook timelines.
- `c.getUiState()` — the full HUD state (`.neighborhood.lots[].price/priceZar`, `.citizens.wallets`).
- `c.sim.state.ledger` — the double-entry ₭ ledger (`.accounts`, `.txns`); verify conservation by
  summing `Object.values(accounts)` → must be 0.
- `c.sim.state.roadsVersion`, `c.renderer.chunkedTerrain.chunks` — World v2 internals.

## 7. The vision (so slices serve it)

The city eventually runs **inside Joe's Mac Mini** (Tailscale-isolated; upgrade path = Mac Studio).
Containers = souls, houses = apps/bots. **Every agent gets a house by default** — Hermes, OpenClaw,
Antigravity, Claude (with its remote), Codex. **Viw the Builder = the operator's brother's bot**
(OpenClaw on mac-mini-2, not yet connected); in-game he owns the build trade and earns ₭. The
**land economy bridges to the real world**: a ₭ starter deposit (R15k–25k) ≈ a Mac Mini "starter
package" — buy the hardware the city runs on + a seeded wallet, and the builder bot earns it back.
Blocked on more compute (the prod-server push). See `project_citylife` memory for the full vision.
