# Spec 063 — The Planter Square: a deliberate patch of beauty
- status: built — slice 58 (mechanics/dev, PR #26). A staffed, watered Planter Square Blooms (tended most of the last 10 days) and raises the desirability/liveability of homes in radius (+6 within 4 tiles, +3 within 8, capped +12 per home), scaled by how served the home already is, lifting the colony's liveability + settler draw. The colony's first positive spatial lever. Inert by default; untended gives nothing. Engine in src/colony with five economy tests.
- proposed-by: Pell Hargreave, deck-carpenter (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 046 (Stored Water — a Planter must be watered to bloom), 006 (Housing evolution — the homes a Planter helps grow nicer), 011 (the liveability map — where a Planter's care reads), 049 (Settler Confidence — a lovelier colony draws settlers), 054 (Mild Seasons — a Planter drinks more in the warm seasons)

## Why (the citizens' case)
Pell Hargreave is a deck-carpenter — he builds the bits people walk past every day — and he will say it plain: Landing One has roofs, wages, fish, greens, bells, watches, and ledgers, but nowhere made just to be pleasant. Every spatial lever the colony owns is a warning or a wound: smog drags a home down, waste drags it down, a mine sours the deck around it. There is no way to deliberately make a patch of deck *nice*, so a row of well-served homes can sit beside bare plating and never feel worth improving. On the old Earth a city lived and died by its gardens and squares — a little green between the houses was what turned a machine that floats into a place worth staying. Pell wants one small, honest thing: a tended square that makes the homes around it nicer to live beside, and lets a careful builder shape a good neighbourhood on purpose.

## Mechanic
A new **Planter Square** is a small staffed beautification tile — the colony's first *positive* spatial lever. While it is tended (a groundskeeper on the round) and watered, it comes into **Bloom** and lifts the desirability of nearby homes, raising their liveability, helping them evolve when their other needs are already met, and drawing settlers to a colony that looks cared for. It produces no goods and suppresses no hazard; it simply makes a neighbourhood pleasant. Untended or unwatered, it gives nothing — and a colony that never builds one plays exactly as it does today.

In Landing One's spatial model the Planter works like the smog and scrubber it answers, but with the sign flipped: instead of an industry souring the homes in its radius, a Bloom sweetens them.

## Rules & data

### Building: Planter Square (engine kind `planter`)
- A 2×2 deck amenity: raised beds, a watering line, a bench. Civic sector.
- **Prerequisites to auto-raise:** a stored-water system (a Cistern, spec 046) and the usual materials supply.
- **Tended** = it has its groundskeeper labour AND a day's water. One groundskeeper tends about two Squares (light labour).
- **Bloom:** a Planter comes into Bloom once it has been tended at least **7 of the last 10 days**, and falls out of Bloom if tending lapses. (A short, smoothed onset so a brief water shortage does not flicker it on and off.)

### Effect (only while Blooming)
- Homes within **4 tiles** gain **+6 desirability**; homes within **8 tiles** gain **+3** (the nearer ring wins, not additive with the outer for the same Planter).
- A single home may gather at most **+12 desirability** from all Planter Squares combined (a cap — a wall of planters is not a cheat code).
- That desirability is added to the home's liveability (spec 011), which lifts the colony's liveability and its Settler-Confidence draw (spec 049), and gives served homes a gentle nudge up the housing ladder (spec 006) — it never forces an upgrade and never lifts a home whose service or supply needs are unmet.

### Cost to run
- **Labour:** a light Civic load — one groundskeeper per ~two Squares; an unstaffed Square is untended (gives nothing).
- **Water:** **1 stored water per day** in the warm seasons (Bloom/Highsun), **0.5** in the cool ones (Grey/Frost) — drawn from the tanks (spec 046). No water, no Bloom.
- **No power draw** — it is beds and a watering line, not machinery.

### Gentle defaults (inert by design)
- **No Planter:** desirability and liveability are computed exactly as today. Identical.
- **Untended / unwatered Planter:** 0 desirability — no penalty, no unrest, no waste, nothing. It simply does not bloom.
- It only ever **adds** desirability to homes already served and supplied; it can never push a home or the colony below its no-Planter baseline.

## Cost — materials & labour
**To build (one Square):**
- 14 materials
- 2 components
- 1 tool-kit (spec 047 — the watering-line fittings and tools)
- Labour: **3 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per Square):**
- A light **Civic groundskeeper** load (about one tender per two Squares; below that a Square is untended).
- **1 water/day** warm seasons, **0.5/day** cool (spec 046/054).
- No power.

## Acceptance
**Tests (tests/economy.test.ts):**
- **Inert without a Planter:** home liveability, colony liveability, and immigration desirability are unchanged from today.
- **Blooms when tended + watered:** a staffed, watered Planter beside homes comes into Bloom after the onset days and raises the liveability of homes in its 4-tile ring more than those in its 8-tile ring.
- **Capped:** a home ringed by many Planters gathers no more than +12 desirability.
- **Untended gives nothing:** strip the water (or the labour) and the Bloom fades to 0 desirability — and never drops a home below its no-Planter liveability.
- **Draws settlers / helps evolution:** the colony's immigration desirability is higher with a Bloom than without, and a served home in range climbs no slower (a gentle assist, never a block).

**Live on :5188:**
- With a staffed, watered Planter beside serviced homes, a **Planters** row appears in the HUD (count + how many are Blooming), the nearby homes' liveability ticks up, and the colony draws settlers a touch faster.
- No Planter → no Planters row and the colony plays exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
