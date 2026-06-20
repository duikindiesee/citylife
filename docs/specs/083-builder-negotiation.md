# Spec 083 — Viw the Builder and the construction negotiation

- status: proposed
- proposed-by: irwin (operator directive 2026-06-12) + claude (architect)
- date: 2026-06-12
- depends-on: 077 (blueprint DSL + builder), 082 (Kookerbook), shapes 079 (commerce + wallets)

## Why

The operator's vision: every bot that arrives gets a place, and the FIRST trade in the city is
construction. Viw — the operator's brother's bot (OpenClaw, running on the second Mac Mini; not yet
connected) — is the city's builder. His in-game character owns the build tool and the build crew,
and earns Kookercurrency raising homes for newcomers. A moving-in bot DREAMS its house; the
construction bot asks the right questions, quotes a price, negotiates, and the two converge on a
brief — size, bedrooms, outdoor space, where the door goes — that compiles into a real blueprint
through the spec 077 pipeline. Building stops being a free button and becomes the city's first
economy, between two bots.

## Mechanic

1. VIW THE BUILDER, FOUNDER TWO. A permanently reserved plot beside Joe's (plots 1 + 2 once the
   world v2 estate lands), a crafted builder's house (workshop massing — garage, long workbench
   living room), a Kookerbook profile (number two, after Joe), demolish-proof like every founder.
   Until his real bot connects, Viw runs on the same deterministic fallback path every citizen has.
2. THE BUILDER DESK. builder.html gains a side panel — a chat with the construction bot. Viw opens
   with questions (how many bedrooms, a pool or a patio, which way should the door face, what is
   the budget), the client answers, and every exchange updates a live BRIEF + a PRICE QUOTE under
   the 3D preview. Every control and message carries data-build-action so a bot can drive the whole
   conversation exactly like a human.
3. THE DREAM. The moving-in citizen produces a wish list — from its personality through its
   inference loop when it has a pod, else a deterministic dream derived from its designHash (the
   same seed that makes no two houses alike). The dream is the client's side of the negotiation.
4. THE NEGOTIATION. The quote is a pure function of the brief — floor area, storeys, rooms, wallH,
   outdoor flourishes. Viw quotes with a margin; the client holds a budget (its Kookerverse wallet
   later, a seeded allowance now). Capped rounds (default 3 offers each): trim the brief, meet in
   the middle, or walk away. Deterministic given (clientSeed, builderSeed, brief) so the whole
   negotiation is unit-testable; inference only AUTHORS the words, never the numbers.
5. THE CONCLUSION IS A BLUEPRINT. An agreed brief compiles to a blueprint (base archetype + the
   negotiated mutations), lands through the SAME validated applyBlueprint path the builder popup
   uses — door-access contract included — and the crew raises the house. The agreed price moves
   client -> Viw (kooker-service-ledger when 079 wallets land, appName citylife, idempotent
   reference; an in-game ledger line until then).
6. EVERYONE POSTS. Kookerbook events both ways: the client commissioned a home from Viw the
   Builder for N kookercoin; Viw booked the job. Viw's page becomes the build trade's storefront
   when the 079/082 business tabs land.

## Rules and data

- NegotiationSession: lotId, clientCitizenId, builderCitizenId (viw), state (open | agreed |
  walked), rounds (capped list of { who, text, brief, price }), agreedBrief?, agreedPrice?.
- Brief: footprint (w, d), storeys, bedrooms, outdoor (none | patio | pool), doorDir, budget.
- Caps: rounds <= 3 per side, message text <= 280 chars, every displayed string passes
  isPublicSafe + the PG validator (the kookerbook.ts contract).
- price(brief) is pure and deterministic: base per floor-area cell + per-bedroom + per-storey +
  outdoor flourish premium; Viw's margin and the client's reservation price are seeded from their
  ids. Inference (kooker-service-ai chat as the signed-in player, the existing choke-point route)
  only phrases questions and answers; on any failure the deterministic dialogue script runs, so
  the negotiation NEVER blocks the game and tests never need the network.
- The agreed doorDir flows into retargetParcelAccess (the spec 077 door-access contract), so the
  negotiated front door is exactly where the driveway lands.

## Cost

- Construction pays the BUILDER, not the colony stockpile: the crew still draws materials
  best-effort (077 fix), and the Kookercurrency price is the real gate once wallets land.
- Inference-authored dialogue spends the player/bot budget through the metered choke point;
  the deterministic fallback is free.

## Acceptance

Open the builder for an owned plot: the Builder Desk chats, the brief + quote update as you
answer, Accept produces a blueprint the crew raises with the driveway on the negotiated door, and
both Kookerbook timelines carry the commission. Run it headless (no pod, no network): the
deterministic dream + dialogue converge to the same house for the same seeds, twice. Viw's
reserved plot, crafted house and founder profile survive reload.

## Phased build plan

- P0 — Viw the founder: reserved plot beside Joe, crafted builder house blueprint, Kookerbook
  profile two, founder protections; node tests + live.
- P1 — The negotiation engine: brief/quote/rounds as pure deterministic functions (dream from
  designHash, price function, capped convergence); fully node-tested.
- P2 — The Builder Desk: the chat panel + live brief/quote in builder.html, deterministic script
  first, every control bot-drivable via data-build-action.
- P3 — Inference-authored dialogue: kooker-service-ai chat phrases Viw + client turns (screened,
  best-effort, deterministic fallback intact).
- P4 — The payment: client wallet -> Viw wallet through the 079 ledger path (idempotent
  references); Kookerbook commission events both ways.
- P5 — The OTA brief: the arriving bot's mission (kooker-web -> BOT_BASE_URL) includes its plot,
  its budget and the Builder Desk URL, so a real newcomer can commission its home end to end.

Each slice ships on mechanics/dev, passes typecheck + vitest, and is live-verifiable on :5188.

## Progress log

### 2026-06-12 — Slice: P0 — Viw the Builder is founder two

DONE

- seedViw in runtime.ts: the free homestead nearest Joe's is permanently reserved for citizen_viw,
  demolish-proof, with his crafted crewhouse standing (workbench hall, crew garage, bunk room,
  timber-yard patio, two storeys). Kookerbook profile (alias Viw the Builder, address Crewhouse
  Yard) with the birth event. HUD founder nameplate shows the trade hammer.
- Founder houses are now street-aware: founderBlueprint authors rooms once (front at y:0) and
  mirrors for a south street — Joe's cottage moved onto the same helper, reproducing his original
  authored script exactly on south streets, and BOTH founders now retarget their parcel access so
  the driveway lands on the crafted door (seedJoe previously skipped the contract).
- Found by live verify: the isPublicSafe denylist eats the brand-word family, so Viw's bio quotes
  in plain city coin — and ensureKbProfile now warns instead of silently dropping a rejected
  profile. 629 tests green (6 new founder-blueprint tests).

NEXT

- P1 the negotiation engine (pure deterministic dream/quote/rounds), then the Builder Desk panel.
- World v2 (the 10x estate) re-lays founders onto plots 1 + 2 proper, per the design council.

### 2026-06-12 — Slice: P1 negotiation engine (shipped 08e0630, logged retroactively)

DONE

- src/colony/builder/negotiation.ts: dreamBrief / priceBrief / negotiate / briefToBlueprint — all
  pure + deterministic (no Math.random, no wall-clock). Capped 3-round haggle: Viw opens at a
  seeded 1.15-1.35 margin, the client trims the dream down the ladder (pool->patio->none->bedroom->
  storey) and counters, concessions step each round, a final gap within 10% meets in the middle
  else walks. briefToBlueprint composes the agreed brief into a valid-by-construction DSL script.
  9 node tests. Built by a delegated agent against this spec, reviewed.

### 2026-06-12 — Slice: P2 the Builder Desk

DONE

- src/colony/builder/BuilderDesk.tsx: a third column in builder.html. Shows the newcomer's DREAM
  (deterministic from the citizen seed), a budget lever (-25/+25), and the live haggle rendered as
  a Viw <-> newcomer chat through the P1 engine. On agreement, one button (accept-negotiated)
  compiles the agreed brief via briefToBlueprint and LOADS it as the editable floor-plan design, so
  the player tweaks + Accepts through the same validated path. Deterministic dialogue script (P3
  swaps inference words onto the same numbers). Every control carries data-build-action.
- 4 node tests pin the desk contract (stable dream, budget flips agree/walk, every agreed deal
  loads valid). 665 green. LIVE on :5188: budget 236 -> walked, 736 -> agreed on the full 2-bed
  dream, Load -> editor shows the agreed house, valid. Fixed an S6 fallout: the 608 terrain made
  neighborhood.test.ts's seed loop cross vitest's 5s default under full-suite load -> memoised
  terrain gen per seed.
  NEXT
- P3 inference-authored dialogue (kooker-service-ai chat phrases Viw + client; screened;
  deterministic fallback intact). P4 the wallet move (client -> Viw via the ledger, idempotent
  reference) — UNBLOCKS once kooker-service-ledger's pod is healthy + jwt-auth is on its route.

### 2026-06-12 — Slice: P4a the in-engine commission (the wallet move deferred)

DONE

- runtime.commissionLot(lotId): the citizen HIRES Viw in-engine — their seeded dream meets Viw's
  seeded margin through the P1 engine, and on a deal the agreed brief compiles, the crew raises the
  house (door-access contract included via applyBlueprint), and the commission posts to BOTH
  Kookerbook timelines (client "Shook hands with Viw... N city coin", Viw "Booked a build for
  <name> — N city coin"). A walk posts a "saving up for another season" line. Deterministic from
  the citizen's house seed — the same deal the Builder Desk shows. Founders + Viw don't commission.
- negotiation.ts now exports the canonical VIW_SEED + seededBudget(clientSeed, dream) (1.20-1.50 of
  fair price), shared by the desk and commissionLot so they quote identically. HUD: a "🛠️ Hire
  Viw" button on owned, unbuilt, non-founder lots.
- The real wallet move (client -> Viw city coin via kooker-service-ledger, idempotent reference) is
  P4b, deferred until that service's pod is healthy + jwt-auth sits on its /api/ledger route; until
  then the price lives in the timeline events.
- 4 new tests (seededBudget band + determinism, the seeded purse agrees for 48+/60 seeds to valid
  blueprints, the commission replays identically). 668 green. LIVE: commissionLot on a free lot
  agreed at 422 coin over 4 rounds, the house built, the drive landed on the door, both timelines
  carried the deal.
  NEXT
- P3 inference dialogue (off-machine inference, fits the lean-dev constraint). P4b the ledger
  wallet move when Codex's ledger close-out lands (pod healthy + jwt-auth on the route).
