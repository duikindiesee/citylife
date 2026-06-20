# Spec 065 — Deck Fires and the Fire-Watch Post: a blaze that eats the floor

- status: built — slice 60 (mechanics/dev, PR #26). A Fire-Watch Post watches a district; in-district buildings accumulate fire risk deterministically under stress (worn/brownout/warm/industry/full-store/crowded) and the worst ignites; a staffed, watered Post drains risk + suppresses sparks, while an unwatched fire grows spark->blaze, spreads once to the most flammable deck-neighbour, then destroys the building (removed, must rebuild). Inert without a Post; one ignition per ~10-day window; only direct neighbours catch. Deferred: multi-post pooling, overload penalty, wreckage-clear cost, per-stage water tariffs. Engine in src/colony with five economy tests.
- proposed-by: Cael Brun, deckwright and pump-hand on the east-rim maintenance crew (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 046 (Stored Water — bucket barrels need filling), 022 (Maintenance Sheds — worn buildings catch first), 017 (Brownout Grid — stressed power sparks), 023 (Storehouse Platforms — packed stores burn), 054 (Mild Seasons — the warm months are the dangerous ones), 024 (Emergency Bellhouse — the generic incident fire hides inside today)

## Why (the citizens' case)

Cael Brun walks the east rim with a pump on his back and a coil of hose, and he will tell you plainly: greens going sour is a nuisance, but **fire eats the floor under your boots**. Landing One already has everything a real blaze wants — crowded decks, linen and reels and batteries stacked in stores, brownouts that leave hot wiring, machinery running day and night, and tired hands at the end of a long shift. Today a fire is just folded into the colony's generic incident: one building pauses, then recovers, and nothing ever spreads or burns down. That is not how fire works. A spark in a packed, worn, power-stressed workshop in the warm season should **catch, leap to the deck beside it, and take the building if nobody is awake with a bucket-line**. On the old Earth the fire-watch was the very first thing a city built. Cael wants the same for Landing One — and he wants it gentle: a colony that never builds a Fire-Watch runs exactly as it does today, with fire still tucked inside the generic incident.

## Mechanic

A new staffed **Fire-Watch Post** watches a fire district around itself. **Only buildings inside a watched district use the new fire rules** — with no Fire-Watch anywhere, the colony plays exactly as it does now (fire stays hidden in the generic incident, spec 024). Inside a district, a building under sustained stress slowly accumulates **fire risk**; left to climb, the most-at-risk building **ignites**. A staffed Fire-Watch with water on hand puts a young fire out before it can grow. But if the watch is unstaffed, overwhelmed, or dry, the fire **spreads** to the deck-neighbour beside it and, if still unfought, **destroys** the building — which must then be rebuilt.

To fit Landing One's deterministic engine (the colony has no dice — every hazard rises from sustained conditions, like the Fever Watch and the generic incident's `hazardAccum`), fire risk **accumulates** from stress rather than rolling a daily chance, and a fire **grows on a clock** rather than a spread probability. Same truth, no randomness: a calm, maintained, well-powered, well-watched district never burns; a neglected, packed, browning-out one does.

## Rules & data

### Building: Fire-Watch Post (engine kind `firewatch`)

- A small staffed post: bucket barrels, hooks, hoses, a pump. **Safety sector.**
- **Prerequisites to auto-raise:** stored water (a Cistern, spec 046) and an established colony.
- **Coverage:** watches all buildings within **6 deck tiles** (its fire district).
- **Staffing:** 3 crew at full strength; 2 → two-thirds; 1 → one-third; 0 → no protection (but the district still carries fire risk).
- Draws **~6 stored water per day** for barrels and drills while it stands, and a small power load for the pumps.

### Fire risk (deterministic accumulation, per building, only inside a district)

- Each building in a district carries a `fireRisk` that **rises** each day by the sum of its active stressors and **falls** when a staffed Fire-Watch covers it and the stressors clear:
  - **+1** worn past the maintenance line (spec 022)
  - **+1** suffered a brownout today (spec 017)
  - **+1** warm season — Bloom or Highsun (spec 054)
  - **+2** a power, industry, workshop, or drying building (hot work)
  - **+1** a packed store above 90 percent full (spec 023)
  - **+1** crowded: 4 or more directly adjacent buildings
- Risk climbs toward an **ignition threshold**; a **staffed** Fire-Watch in range bleeds risk down faster than a calm district accrues it, so a watched, maintained colony never reaches the line. When a district's worst building crosses the threshold it **ignites** — and a district lights **at most one new fire per onset window** (about 10 days) so a bad day never cascades.

### Fire stages (a clock, not a die)

- **Spark** (the first ~12 hours): the building pauses work; no spread yet. A staffed Fire-Watch with water clears a Spark **quickly** (drawing water + Safety labour). This is where a watched colony stops every fire.
- **Blaze** (if a Spark is not put out): the building stays paused. After a **spread onset** (~6 hours as a Blaze) the fire lights a **Spark in its most flammable deck-neighbour** (a store/industry/power/workshop/drying neighbour catches first; an empty deck gap blocks it — only direct neighbours catch). After a **destruction onset** (~24 hours as a Blaze) the building is **destroyed**.
- A staffed Fire-Watch still fights a Blaze, but it takes far more water and labour; a dry or unstaffed watch cannot stop it.

### Destruction

- A destroyed building is **removed from service** (it must be rebuilt at the normal cost) and **loses half the goods stored in it**. That is the cost of letting a fire run.

### Suppression

- A staffed Fire-Watch spends **water + Safety labour** each step to drain active fires in its district (Sparks first, then the oldest Blaze). Out of water, it cannot fight. This couples fire safety to the water economy (spec 046): a fire-watch with empty tanks is a painted bucket.

### Gentle defaults (inert by design)

- **No Fire-Watch anywhere:** identical to today — no fire risk, no ignition, fire stays inside the generic incident (spec 024).
- A **maintained, staffed, well-powered, well-watched** district keeps risk below the line and never ignites.
- One ignition per district per ~10-day window; only direct deck-neighbours catch; a building already paused by another incident does not double-burn. Fire never touches a colony that has not opted in by building the Post.

### Deferred (to keep the first slice small)

Cael's fuller design — multiple posts pooling on one fire, an overload penalty past 30 covered buildings, a separate wreckage-clearing cost before rebuild, and per-stage exact water/labour tariffs — is noted for a later pass. The first slice ships the core loop: **risk under stress → ignite → a staffed watch suppresses, or it spreads and destroys.**

## Cost — materials & labour

**To build (one Post):**

- 40 materials
- 10 components
- 3 tool-kits (spec 047 — hooks, axes, pump fittings)
- 2 reels and 6 linen (spec 013/031 — hose and gasket stock)
- Labour: **4 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per Post):**

- **3 Safety crew** at full strength (2 → two-thirds, 1 → one-third, 0 → no protection).
- **~6 stored water per day** (spec 046) for barrels and drills; a small power load for the pumps.

## Acceptance

**Tests (tests/economy.test.ts):**

- **Inert without a Post:** a colony with worn, packed, browning-out buildings carries no `fireRisk` and never ignites — existing incident behaviour unchanged.
- **Risk climbs under stress, ignites unwatched:** an established district of stressed buildings with an **unstaffed** Fire-Watch accumulates risk and ignites its worst building; a calm, maintained district never does.
- **A staffed Post puts a Spark out:** the same stressed district with a **staffed, watered** Fire-Watch drains the Spark before it becomes a Blaze — no spread, no destruction.
- **Unfought fire spreads then destroys:** an ignited building left unsuppressed becomes a Blaze, lights a Spark in a direct neighbour after the spread onset, and is removed (destroyed) after the destruction onset; an empty-gap neighbour never catches.
- **Water-gated + capped:** a Fire-Watch with empty tanks cannot suppress; a district lights at most one new fire per onset window; destruction never drives any stockpile below zero.

**Live on :5188:**

- With a staffed, watered Fire-Watch over a stressed district, a **Fire** row appears in the HUD (district risk + active fires), a deliberately-stressed building ignites and is then put out before it spreads; strip the water or the crew and the same fire spreads and destroys a building.
- No Fire-Watch → no Fire row and the colony plays exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
