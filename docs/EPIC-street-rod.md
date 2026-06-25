<!-- Canonical source: GitHub issue #125 (duikindiesee/citylife). This file mirrors that epic so the Street Rod design is version-controlled in-repo. Keep them in sync. -->

# CityLife — Street Rod: The Definitive Epic

> **Canonical home for the whole idea.** This document is the single source of truth for the CityLife "Street Rod" game. If the autonomous cron jobs are cancelled, nothing is lost — everything that has been built, planned, decided, researched, blocked, and questioned lives here. Audience: Irwin (owner) and both dev lanes (the car/garage lane in `D:\infra\claude2\citylife`, and the team-lead world/catalog lane). Specs: 099 (north-star), 096 (garage), 097 (rally point), 087 (road rally), plus supporting 095/085/082/079.

---

## 1. North-Star Vision

### The fantasy

CityLife exists so **two brothers can meet at night, drive to a spot, hang out, and race** — building and tuning their cars Street Rod style. That is the whole point. Irwin and his brother meet in the city after dark, drive out to a hilltop, talk, and race the cars they have been quietly making faster. The brother is building a _real_ car in real life; this is the digital version of that ritual — a place to meet, show off the build, and run it.

Everything that does not ladder toward **brothers meeting and racing** is a side quest. That is the north-star guardrail (spec 099): if a feature does not move toward the meetup-and-race loop, keep it out of scope.

### The 6-step core loop

```
   Meet  ──▶  Drive  ──▶  Hang  ──▶  Race  ──▶  Tune  ──▶  (Repeat)
    ▲                                                          │
    └──────────────────────────────────────────────────────────┘
```

1. **Meet** — Sign in, drop into first person beside your own parked car, and head out. Two players converge at the night rally point.
2. **Drive** — Take the road network out to the meetup. The roads are a destination ritual, not background.
3. **Hang** — Stand at the hilltop overlook, see who else is present, talk (voice comms — planned pillar, section 6). The night framing makes this a social beat.
4. **Race** — When two are present, a race begins from the rally point. Each player races their own tuned car.
5. **Tune** — Back in the garage: buy parts, open the bonnet, mount upgrades, repaint, watch the tune rating climb.
6. **Repeat** — Each loop makes the car a little faster and a little more _yours_.

The loop is the product. Each turn of it should make the next meet feel different because the car changed.

---

## 2. Two-Lane Structure and the Seam

The work is split across two dev lanes that **must not edit each other's files**. They converge at exactly two seams.

|          | **Car / Garage lane** (claude2)                                                                                         | **World / Catalog lane** (team-lead)                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Location | `D:\infra\claude2\citylife`, dev port **5191 only**                                                                     | main CityLife checkout / team-lead domain                                                     |
| Owns     | garage, car spec, parts, engine upgrades, rally point, racing, car classifieds                                          | world generation, houses, characters, Kookerbook/artifact catalog, storefronts, UI foundation |
| Files    | `src/colony/car/*`, `src/colony/bot/carPartMarket.ts`, `src/colony/ui/GaragePanel.tsx`, rally placement in `runtime.ts` | `commerce/businesses.ts`, furniture lane, Kookerbook, world spine                             |
| Branch   | `feat/citylife-garage-cars` (rolling PR #105)                                                                           | own branches                                                                                  |

### The seam

The two lanes converge at **the rally point** (where the brothers meet and race) and at **the classifieds** (the catalog / Kookerbook + KCO ledger). The classifieds _are_ the catalog spine: the car-part marketplace is a sibling of the furniture marketplace, both feeding the same Kookerbook social/commerce surface and the same double-entry KCO ledger. The world lane provides the catalog/Kookerbook backbone and the characters who inhabit it; the car lane plugs cars and parts into that backbone.

**Hard rule:** the car lane never edits furniture lane files (`furniture.ts`, `furnitureShop.ts`, `bot/furnitureStore.ts`, `bot/furnitureMarket.ts`), never edits rally internals (`traffic.ts`, `raceLayer.ts`, `race.ts`, `state.cars`) beyond the agreed `startRace(startCell?)` param, and coordinates before touching `bot/ledgerSync.ts` or adding a car-shop storefront to `commerce/businesses.ts`.

---

## 3. The Garage

The garage is the home base of the tuning half of the loop. **One car per player**, loaded from `localStorage`, fully serializable and deterministic.

### Features as built (PR #105, merged)

- **Jump to your car, first person** (`jumpToMyHouse`, slice E, commit `5518190`) — a HUD button drops the player into first person beside their parked car, facing it, as their own citizen. Reuses `fpGuidedTarget` + `leastCostPath`. Operator-gated via `operatorCitizenId()`.
- **In-world parked car** (`setOperatorCar`, commit `ec2fb39`) — the signed-in player's car renders one cell **east** of their home, rebuilt on operator/car change, visible and interactable in first person.
- **Open the bonnet, engine-bay view** (`openBonnet`/`closeBonnet`, slice F, commit `ce0be8d`) — toggles reveal the engine bay, listing the engine and hood sockets with the mounted part and an install state per socket (occupied / installable / empty). Per-socket fit / buy / remove buttons. No dependency DAG — one part per socket.
- **Buy / own / mount** (slice D, commit `258fc92`) — `buyCarPart()` gates on the exact in-game ledger balance, moves coin buyer→shop (`CAR_SHOP_ACCOUNT = 'shop:car'`), and marks the part owned in `citylife.carparts.owned.v1`. `mountCarPart`/`unmountCarPart` enforce one part per socket (new part replaces old). Free parts (street tyres) are implicitly owned.
- **Paint** (`setCarPaint`, slice H1, commit `55651a5`) — repaint body / cabin / accent from curated palettes; palette-validated, deterministic; active swatch shows a ring. Stock paint seeded per player id via `hash32` so different players auto-start different colors.
- **Body mod — the roof chop** (slice H2, commit `f33405b`) — a `body` socket part that _reshapes_ the cabin (lowers `0.26→0.16`) for the classic hot-rod silhouette, rather than bolting on a child mesh.
- **Tune rating headline** (`tunePoints`, commit `11979fd`) — a single performance number out of 100: `round(sum of four effective stats × 25)`. Stock car = 50; performance parts push toward 100. Pure derivation from `deriveStats`.
- **Effect badges** (`partEffects`, commits `955aa76` flat list, `dadf54d` engine bay) — up/down/cosmetic badges per stat delta (green up, red down, "cosmetic" flat) under each part, in both the flat list and the engine-bay view, so the stat impact is transparent (Spd / Acc / Grip / Brk).
- **Wallet balance** displayed in the garage UI.

### Planned / not yet built

- **Visual hood-raise** (F2, deferred) — `carMesh` has no separate hood-mesh geometry yet; CDP screenshots are broken so the visual cannot be verified. Deferred until screenshots work.
- **Car rename** — free-text name with `isPublicSafe` screening (HUD text-input re-render risk noted).
- **More parts and body styles**, engine-bay badge consistency polish.
- **Wear / consumable tyres** (H3) — needs a usage signal from the race loop (Codex-owned); gated on own-car rally.
- **Physical car-shop plot** in the commercial district — team-lead domain (`commerce/businesses.ts`); coordinate on storefront strategy.

---

## 4. All Parts, Sockets, and Paint

### Parts model: mesh composition (not a voxel DSL)

A part is a **child THREE mesh mounted at a socket anchor**, or a **reshape** of existing geometry (the roof chop lowers the cabin like wheels reshape the stance). This was a deliberate architecture choice over a voxel/DSL approach because: it is simpler (no second DSL or compiler to build and maintain), it avoids colliding with the furniture lane's DSL work, and it keeps `carMesh` as pure data plus one builder. `carParts.ts` is pure data — no THREE, no rng — which keeps it node-testable. This diverges from the earlier `PLAN-garage-cars.md` voxel-DSL sketch; the divergence is documented in spec 096 commit `0f42d51`.

### The parts table

| Label               | Socket  | Category    | Effect                                              | Cost (KCO)                     |
| ------------------- | ------- | ----------- | --------------------------------------------------- | ------------------------------ |
| Street tyres        | wheels  | cosmetic    | No stat changes; cosmetic                           | **0** (free, implicitly owned) |
| Drag slicks         | wheels  | performance | Grip +0.25, Acceleration +0.1, Top Speed −0.05      | 180                            |
| Four-barrel carb    | engine  | performance | Acceleration +0.15, Top Speed +0.1                  | 240                            |
| Supercharger blower | engine  | performance | Top Speed +0.2, Acceleration +0.15, Grip −0.1       | 460                            |
| Tuned headers       | exhaust | performance | Top Speed +0.1, Acceleration +0.05                  | 200                            |
| Chrome side pipes   | exhaust | cosmetic    | No stat changes; cosmetic                           | 120                            |
| Ducktail spoiler    | spoiler | performance | Grip +0.12                                          | 160                            |
| Hood scoop          | hood    | cosmetic    | Top Speed +0.03; minor cosmetic boost               | 90                             |
| Roof chop           | body    | performance | Acceleration +0.06, Grip +0.04; reshapes silhouette | 280                            |

### Sockets

`engine` · `exhaust` · `wheels` · `spoiler` · `hood` · `body` — **one part per socket** (first wins; `validCarParts` enforces). Engine and hood sockets are the ones surfaced in the open-bonnet engine-bay view. The `body` socket is the reshape socket (roof chop).

### Stats model

`CarStatVector { topSpeed, acceleration, grip, braking }`, each in `0..1`, stock `0.5`. Stats are derived by summing base + mounted-part deltas, clamping to `0..1`, and rounding to 6 decimal places (`r6`) so the result is **order-independent** and fully deterministic. `tunePoints = round((topSpeed + acceleration + grip + braking) × 25)`.

### Paint palettes (three repaintable channels, curated hex)

- **Body (6):** `0xd64545` red · `0xe0a24d` tan · `0x4d8be0` blue · `0x4dbf73` green · `0xb84de0` purple · `0xe0d24d` yellow
- **Cabin (4):** `0x2a2d33` black · `0x3a3f47` dark grey · `0x52341f` brown · `0x1f3a52` dark blue
- **Accent stripe (4):** `0xffd25a` yellow · `0xff6a55` orange · `0xf4f4f0` off-white · `0x39d353` green

`setCarPaint` validates the chosen color against the curated palette. Stock cars seed paint deterministically from the player id (`hash32`, no `Math.random`), so different players auto-start in different colors.

---

## 5. Meeting and Racing

### The hilltop rally point — the night-meetup spot

A Rally Point sits on a commanding hilltop overlooking the city — a bus-stop-style rendezvous where the brothers meet at night. Placement (`findRallyOverlookSite`, spec 097, commit `3a4abb0`) is fully deterministic: it maximizes elevation + local prominence with a Highland/Mountain bias, requires a buildable footprint, avoids water and other base structures, and stays within colony reach.

- **Marker rendering** (R2, `3a4abb0`) — a 10-mesh iconographic group: stop platform, signpost with a glowing checker race-flag, bench, and an emissive beacon visible at night and from the city below. No brand text.
- **Reachable placement fix** (R3.5a) — excludes Mountain/Peak from the footprint and flood-fills reachable land so the rally lands on the highest _walk-reachable_ Highland overlook (`cellOk` true). Verified on all 8 seeds, so the guided walk can actually arrive on foot.
- **Saturating-ruggedness placement bias** (R1, commit `7d73122`) — a capped ruggedness term breaks ties toward a mountain-shoulder knoll without dragging the overlook to a low, maximally-rough spot. Tuned over a 120-seed sweep: lifted spur connection 110→116/120 while holding elevation steady, no regression.
- **Spur road connector** (R3.5b, commit `e0021bb`) — a runtime-constructor spur paves from the nearest road _down_ to the rally (so no road runs through houses), mirroring the commercial connector, with an optional `margin` param to `leastCostPath` (spur uses 160 vs default 40). Connects on 8/10 seeds; demo seed 4242 fails soft (rally embedded in homesteads).

### First-person walk-to-rally, presence, join-race

- **Guided walk** (`goToRallyPoint`, R3, commit `bfb6e79`) — a HUD button walks the operator's citizen to the rally, reusing `fpGuidedTarget` + `citizens.setTarget` + `leastCostPath`. Operator-gated.
- **Presence tracking** (`rallyPresence`, R4) — counts avatars within ~1.2–1.5 cells of the rally cell each tick (modelled on bar-seat cells). Includes the first-person operator, excludes idle wanderers, resets on race start / exit / day boundary. Returns `{ x, y, present }`.
- **Two-present join race** (R5) — when `rallyPresence().present >= 2 && raceState === null`, `joinRallyRace()` offers a **Join Race** button; confirming calls `startRace({ x, y })` from the rally. The `startCell` param is additive and optional, preserving the existing solo road-rally button (which starts from the commercial center).

### The race itself (spec 087, road rally base)

A playable timed route overlaid on the **real road web**: a deterministic track from existing roads (prefers avenue / widened trunk roads), checkpoints in order (each ~1.15 cell radius), off-road penalty, lap timer, restart/exit. Track generation is a pure function of `(state.roads, roadKind, terrain)` — never `Math.random`, never `sim.rng`. Race state is runtime-owned (not in `ColonyState`); the lap timer uses clamped `dtReal` not `Date.now`; the race stepper is injectable. Controls in first person: WASD/arrows for accel/brake/steer, shift for handbrake. Race mode runs idle → 3s countdown (`RACE_COUNTDOWN_MS=3000`) → running → finished; first to cross all checkpoints wins.

### THE BIG REMAINING PIECE — racing your OWN tuned car

The payoff of the whole loop is that the car you tuned is the car you race. The hook for this is **blocked** (see §9). Once the additive `carSpec` hook lands in `buildRaceLayer`, `runtime.startRace` will source the player's `CarSpec` from `garageStore` so the race uses `buildCarMesh(opts.carSpec)` and the tuned `CarStatVector` drives physics handling:

- **Stat-to-physics handling** — `topSpeed`, `acceleration`, `grip`, `braking` (derived from mounted parts) feed the car's race physics, so tuning is felt, not just displayed.
- **Ghost-replay race-a-friend** (spec 087 / PLAN-rally-owncar-friend) — async, no netcode: record a trajectory, then render the friend's translucent car in _their_ CarSpec running alongside. Optional leaderboard (fallback localStorage; deferred kooker-service-games).
- **Night / time-of-day framing** — the meetup is a night ritual; the emissive beacon and race-flag are tuned to be visible after dark and from the city below.

---

## 6. Voice Comms With Friends (NEW planned pillar)

> **This is a new pillar Irwin wants.** Not built. Design sketch below — the goal is that the brothers can actually _talk_ while they hang at the meetup and during the drive/race, which is the whole emotional point of meeting up at night.

### The pillar

Proximity / party voice so friends can talk while they hang at the rally point and during the drive and race. Voice should feel like standing next to each other: you hear who is **near you** (proximity) or who is **in your race party** (party channel).

### Design sketch

- **Topology:** likely **WebRTC peer-to-peer** for a 2-person brother session (lowest latency, no server media cost). For larger groups, a small **SFU** (selective forwarding unit) to avoid the N² mesh. Start P2P for the two-brother case; SFU is the scale path.
- **Push-to-talk** as the default input mode (clear, low-noise, mobile-friendly), with an open-mic option.
- **Presence-gated:** you can hear someone only if you are within proximity range at the rally / on the drive, OR you are in the same race party. This reuses the existing `rallyPresence` proximity logic as the gate for "who can hear whom."
- **Channels:** a proximity channel (the hang) and a party channel (the race) so racers stay audible to each other even as they spread out on the track.

### Platform reality

The **only realtime primitive in the platform today is the Hermes chat WebSocket proxy** (`kooker-service-ai`). That is a chat/text path, not a media/signalling path. Voice therefore needs a **new signalling path** — a small WebRTC signalling endpoint (offer/answer/ICE exchange) plus STUN/TURN for NAT traversal. This is net-new infrastructure, not an extension of the chat WS.

### Open questions (voice)

1. **P2P vs server (SFU)** — accept P2P-only for the two-brother MVP, or stand up an SFU from the start for groups?
2. **Who can hear whom** — strict proximity only, or persistent party channel that survives leaving proximity during a race?
3. **Moderation** — voice cannot be `isPublicSafe`-screened like text. Recording/abuse handling? Friends-only gating so strangers can never be in voice range?
4. **Mobile** — push-to-talk ergonomics, autoplay/permission prompts, battery, and TURN bandwidth on cellular.
5. **Signalling host** — new lightweight service, or piggyback on an existing kooker service? TURN server sourcing/cost?

Framed as a **planned pillar with a design sketch — not built yet.**

---

## 7. Classifieds + Economy

### The in-game KCO loop (shipped)

The buy → own → mount loop runs entirely on the in-game **double-entry KCO ledger**:

- `carShop.ts` defines `CAR_SHOP_ACCOUNT = 'shop:car'` (distinct from the furniture till) and `carPartPriceK`.
- `carStore.ts` tracks ownership in `citylife.carparts.owned.v1`.
- `buyCarPart()` gates on exact balance, moves coin buyer→shop, marks the part owned.

### Player-to-player classifieds board (shipped, slice G, commit `c8df0b6`)

A **Kookerbook car-part public marketplace** in `bot/carPartMarket.ts` — a _sibling_ of `furnitureMarket` that never edits furniture files.

- Players list owned bolt-on parts for city coin; **one listing per kind per seller**; deterministic listing id `seller:kind`.
- Listing **escrows** the part out of the seller's owned inventory onto the public board.
- Buying transfers coin buyer→seller via the in-game ledger and transfers part ownership.
- Guards: cannot buy your own listing or a part you already own; **free parts (cost 0) cannot be listed**.
- Board capped at 256 listings (`CARPART_MARKET_CAP`); pure ops (add/remove/find/dedupe/cap/sort), fail-soft `localStorage` (`citylife.carparts.market.v1`, namespace distinct from furniture).
- Surfaced in the GaragePanel Classifieds section. **In-game ledger only for now.**

### Remaining: the real-kooker-ledger mirror

The real-ledger mirror (G2 — appending a `car_part_purchase` event to `bot/ledgerSync.ts` so KCO moves are mirrored to the real `kooker-service-ledger` as the signed-in player, idempotent and best-effort) is **deferred** — `bot/ledgerSync.ts` is the highest-conflict shared file with the furniture lane (Jack). Requires a coordination window. (Pattern reference: spec 085 P1 land-economy ledger sync, and the live CityLife real-wallet adapter that sends `X-Kooker-User-Id`.)

### Tie to the Kookerbook / artifact catalog

The classifieds board **is** the catalog/Kookerbook surface for cars: car parts and furniture both list onto the same Kookerbook commerce spine, both settle on the same KCO ledger. This is the seam where the car lane meets the world lane — the Kookerbook is the classifieds spine, and the car-part market is one feed into it.

---

## 8. All the Research

Every research doc and working plan captured so the research survives the cron jobs.

### Research docs (`D:\infra\claude2\citylife\docs\research\`)

| File                                           | Summary                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-05-31-low-power-radio.md`                | YouTube-iframe radio playback (royalty-clean), house ads every 90s, monetization roadmap, TV/Chromecast mode — ambient audio + in-world narrative channel, deterministic or LLM DJ banter.                                                                                      |
| `2026-05-31-storytelling-and-first-person.md`  | Three systems: persistent Lifepath journals on arrival; first-person drop-in with tunable FOV/walk/run (no jump); bot-to-bot dialogue UI with trust meters + viseme ASR/TTS. Grounds first-person citizenship and NPC conversation.                                             |
| `2026-06-01-caesar3-economy-and-population.md` | Caesar III economy blueprint: housing tiers gated by goods/services, walker service coverage, 1-raw→2-workshop ratios, sentiment-driven immigration, desirability zones, ≤54-tile block roads, 9-mechanic roadmap. The canonical economy architecture replacing timer autoGrow. |
| `2026-06-01-the-scrolls-citizen-news-radio.md` | Buildable Citizen News Radio broadcasting deterministic colony events now, deepening to personal citizen stories once Hermes bots gain persistent memory.                                                                                                                       |
| `2026-06-01-zoning-redesign.md`                | Retire the flat zone-color overlay; three futures (emergent districts from the built economy, liveability heatmap, or deletion); spec-pipeline treatment. Zoning becomes a living readout of player choices.                                                                    |
| `2026-06-02-citizen-as-bot.md`                 | Spawn real Hermes pods per citizen in an isolated DMZ namespace (strict NetworkPolicy), mounted with city docs + first-person vision snapshots, wired to read state and propose specs to the governor loop. Operationalizes "the city that builds itself."                      |
| `2026-06-02-land-organisation-and-roads.md`    | Four-phase L1–L4: terrain-aware roads via least-cost pathfinding, GIS land-suitability metadata, road-first settlement, OBB-recursion parcel subdivision with frontage/access rules. Towns emerge from terrain; every parcel has an address.                                    |
| `2026-06-02-living-economy.md`                 | Embodied logistics (people walk, trucks drive) over abstract counters; standing rule: prefer specs that make the world visibly more alive.                                                                                                                                      |
| `2026-06-02-the-people-are-the-citizens.md`    | Five-phase P1–P5: crowd matches real citizen count, bind figures to a named roster (Mara/Saskia/…), tents as T0 dwellings, needs-and-job agency, per-user persistence via kooker backend. Citizens are the cast.                                                                |
| `2026-06-08-homesteads-roads-parcels.md`       | Spine-and-homestead model replacing cramped 4×4 lots: 3-cell terrain-aware carriageway, large ~14×18 parcels zoned front-to-back (setback→house→garden→farm), fenced boundaries, deterministic instanced geometry.                                                              |
| `2026-06-09-bot-house-builder.md`              | Fine 4×4×4 micro-voxels with greedy meshing (low-poly silhouettes, not Minecraft blocks); git-diffable text DSL blueprints; bot design-loop with self-inspection + mutation. Houses are data-first, inspectable, mutable.                                                       |
| `2026-06-13-district-concept.md`               | Operator's visual north star: Joe the Crab at centre (inference mascot); districts as kooker surfaces (builder's yard, cloud compute, night-market commercial, sports, residential with crests); neon commercial vs calm residential teal. Sets the whole visual tone.          |

### Working plans (`D:\infra\claude2\`)

| File                              | Summary                                                                                                                                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAN-garage-cars.md`             | Spec 096 plan: socket/part model, deterministic performance stats, a `carScript.ts` DSL + `carBuilder.ts` compiler, eight slices A–H. Adopts the retro arcade-garage look (brother's Fiat X1/9). **Note:** the shipped implementation chose mesh-composition over the DSL described here (see §4). |
| `PLAN-rally-point-and-players.md` | Two tracks: (A) test players John/Jane Doe (`CITYLIFE_PLAYER`, 750 KCO, real login); (B) Rally Point R1–R5 (place, render, guided walk, road connector, presence, two-present join). Stage 2: Playwright bot player.                                                                               |
| `PLAN-rally-owncar-friend.md`     | Spec 087 integration: solo rally drives the player's custom garage car (mesh + StatVector physics); race-a-friend via **ghost replay** (async, no netcode); optional leaderboard (fallback localStorage; deferred kooker-service-games). This is the plan for §5's big remaining piece.            |
| `garage-look-reference.md`        | Operator's brother's garage visual reference: arcade-cabinet bezel, yellow 1979 Fiat X1/9, pegboard tools, red tool chest, shelving, warm fluorescent + work-lamp lighting, motorsport posters. The garage-UI styling target.                                                                      |
| `citylife-cron-routines.md`       | The autonomous cron (every 20 min, 07:00–22:00, 7-day expiry) implementing rally R3→R3.5→R4→R5 then garage 096 A–H. Rules: main PROTECTED (PR + MoJoJo gate), one slice per fire, CI-safe commits, :5191 verify, deterministic sim, no furniture/rally-internals edits.                            |

---

## 9. Status

### Shipped (PR #105 merged — ~11 commits, garage A–H + rally R1–R5)

- **Garage:** car spec + mesh + store (slice A, `258fc92`); mount loop + derived stats; in-world parked car (`ec2fb39`); economy buy→own→mount (slice D, `258fc92`); jump-to-car (slice E, `5518190`); open bonnet (slice F, `ce0be8d`); car-part classifieds (slice G, `c8df0b6`); paint (slice H1, `55651a5`); roof-chop body mod (slice H2, `f33405b`); part-effect badges (`955aa76` + `dadf54d`); tune rating (`11979fd`); spec 096 doc (`0f42d51`).
- **Rally (set / placement):** rally placement PR **#116** (rally R3.5 spur road bias / placement, commit `7d73122` / `e0021bb`); rally point initial **#91** (R1–R2 placement + marker, `3a4abb0`); R3 guided walk (`bfb6e79`); R3.5a reachable placement; R4 presence; R5 two-present join.
- **Road foundation:** road grading PR **#89 / #98** (spec 095 — terrain grades up to the road ribbon, render-only height override).
- **Verification:** 120-seed spur sweep (110→116/120, no regression), 8-seed walk-reachability (`cellOk` true), demo seed 4242 regression pinned, node tests (`openBonnet.test.ts`, `tunePoints.test.ts`, `rallySpur.test.ts`), tsc clean + suite green on every commit, live `window.__colony` checks on :5191.

### Remains (in-lane, not gated)

- Visual hood-raise (F2, deferred until CDP screenshots work).
- Car rename (isPublicSafe text input).
- More parts / body styles, UX polish.

### Blocked / gated — with exact unblock

| Item                             | Blocker                                                                                | Exact unblock                                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Own-car rally race (BIGGEST)** | Race internals (`raceLayer.ts`, `race.ts`, `state.cars`) owned by the Codex rally lane | Land the additive `carSpec` hook in `buildRaceLayer` per PLAN-rally-owncar-friend 2b. Then `runtime.startRace` sources the player CarSpec from `garageStore`, no regression. **Do not edit rally internals unilaterally.** |
| **Race-a-friend ghost replay**   | Same as above                                                                          | Same hook; then record/render translucent friend car in their CarSpec.                                                                                                                                                     |
| **Wear / consumable tyres (H3)** | Needs a usage signal from `race.ts` (Codex-owned)                                      | Gated behind own-car rally above.                                                                                                                                                                                          |
| **Real-ledger mirror (G2)**      | `bot/ledgerSync.ts` is highest-conflict with furniture lane (Jack)                     | Coordination window with furniture lane; append `car_part_purchase` carefully, idempotent + best-effort.                                                                                                                   |
| **Car-shop plot (storefront)**   | `commerce/businesses.ts` is team-lead domain                                           | Coordinate storefront strategy with team lead (storefronts front real kooker apps).                                                                                                                                        |
| **Rally spur on seed 4242**      | Rally embedded among homesteads → spur fails soft                                      | Further bias `findRallyOverlookSite` toward overlooks with a guaranteed clean approach (follow-up to R3.5).                                                                                                                |
| **Voice comms**                  | No media/signalling primitive exists (only Hermes chat WS)                             | Stand up a new WebRTC signalling path + STUN/TURN (see §6).                                                                                                                                                                |

**Lane status (2026-06-24):** substantive in-lane garage/rally slices complete; the queue is drained. Remaining items are coordination-gated or Codex-blocked. **Strong recommendation: merge PR #105 before more polish** — diminishing returns reached.

---

## 10. Open Questions for Irwin

1. **Engine depth** — how deep should engine tuning go? Current model is flat per-part stat deltas (carb, blower, headers). Do you want multi-stage engine builds, displacement/induction choices, tradeoffs (reliability vs power), or keep it arcade-simple?
2. **Classifieds source** — should the car-part classifieds stay player-to-player only, or also pull from a real Kooker catalog / artifact source (the Kookerbook spine)? Should parts ever bridge to the real kooker-ledger economy?
3. **Race format** — timed checkpoint rally (current 087 model) only, or add head-to-head, drag, circuit laps, or point-to-point night runs?
4. **Multiplayer realtime vs ghosts** — accept the async **ghost-replay** model (record-and-replay, no netcode) as the shipping answer for racing a friend, or invest in real-time synchronized multiplayer racing?
5. **Voice — P2P vs server?** Two-brother P2P MVP, or SFU for groups from day one?
6. **Voice — who hears whom?** Strict proximity only, or a persistent party channel during a race?
7. **Voice — moderation & mobile?** Voice can't be isPublicSafe-screened — friends-only gating? Recording/abuse policy? Push-to-talk ergonomics and TURN cost on mobile?

---

## 11. Guardrails

- **Determinism** — no `Math.random`, no `Date.now` in the car or rally core. Stats are order-independent via `r6` (6dp rounding); all world placement (rally overlook, spur footprint, stock paint per player via `hash32`) is seed-reproducible. Verified via multi-seed sweeps (120-seed spur tuning, 8-seed walk-reachability). Race timers use clamped `dtReal`, stepper injectable.
- **isPublicSafe** — every player-authored string (names, listings, posts) screened by `isPublicSafe` + the PG validator at write and read. Voice is the open exception (see §6 Q3).
- **Night-visible emissive floor** — night-visible elements (rally beacon, race-flag) need an emissive floor so they don't go black at low light; verify changes at night, not just forced daylight/noon (a tree-goes-black bug once hid behind noon-only checks).
- **Protected main + small tested PRs** — main is PR-only (MoJoJo gate). One bounded slice per cron fire, then stop and ask. Every commit tsc-clean and suite-green. CI-safe commit bodies: **no double quotes, square brackets, angle brackets, apostrophes, or colon-bullet lines**; trailer `Co-Authored-By: Claude Opus 4.8 noreply at anthropic.com`.
- **Lanes stay in their seams** — car lane never edits furniture files (`furniture.ts`, `furnitureShop.ts`, `bot/furnitureStore.ts`, `bot/furnitureMarket.ts`) or rally internals (`traffic.ts`, `raceLayer.ts`, `race.ts`, `state.cars`) beyond the agreed `startRace(startCell?)` param; ping furniture lane before touching `bot/ledgerSync.ts`; car-shop storefront is team-lead domain. Distinct localStorage namespaces (`citylife.garage.v1`, `citylife.carparts.owned.v1`, `citylife.carparts.market.v1`), all fail-soft.
- **North-star scope** — if a feature does not ladder toward two brothers meeting at night and racing their tuned cars, it is a side quest (spec 099). Keep it out of scope.

---

### Appendix — key files & handles

- **Car lane:** `src/colony/car/{carSpec,carMesh,carParts,garageStore,carShop,carStore}.ts`; marketplace `src/colony/bot/carPartMarket.ts`; UI `src/colony/ui/GaragePanel.tsx`; runtime `src/colony/runtime.ts`.
- **Tests:** `tests/openBonnet.test.ts`, `tests/tunePoints.test.ts`, `tests/rallySpur.test.ts`.
- **Specs:** `docs/specs/096-garage-and-car-customization.md`, `097-rally-point.md` (note: 097 is stale — states R3–R5 as planned, but all shipped on #105), `099` north-star, `087` road rally, `095` world-meets-road, `085` land economy, `082` Kookerbook, `079` commercial plots.
- **Live verify:** `window.__colony` on dev port **5191** (`jumpToMyHouse`, `openBonnet`, `buyCarPart`, `mountCarPart`, `setCarPaint`, `listCarPartForSale`, `buyCarPartListing`, `goToRallyPoint`, `joinRallyRace`). DOM/panel checks need a cache-bust reload (`location.href=…&cb=`).
- **Memory:** `C:\Users\kooker\.claude\projects\C--Users-kooker\memory\project_citylife_garage_rally.md`.
