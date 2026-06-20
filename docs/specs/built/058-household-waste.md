# Spec 058 — Household Waste: a colony that does not handle its filth sickens

- status: built — slice 53, shipped to mechanics/dev. wasteStep makes the waste meter from occupied homes (scaled by occupancy, mean tier and warm season), clears it via staffed Sanitation Posts + a tiny decay, and past the fever line gently feeds the outbreak; wasteDesirabilityFactor dampens immigration above the harmless line; wasteStatus feeds the HUD. The waste state field is in sim.ts, the Sanitation Post building + auto-build gate + knobs in config.ts, the waste uiState in runtime.ts, a Waste HUD row in ColonyApp.tsx, and five tests in tests/economy.test.ts. Inert by default — waste rises over colony-months and does nothing below 0.25, so a young/small colony and every test stay under the threshold and all 379 prior tests passed UNCHANGED. Capped to [0,1] and bounded so it can never empty or badly sicken the colony. typecheck clean and all 384 tests pass; live on :5188 a clean colony was inert, waste at 0.4 read filthy and at 0.6 read breeding fever, a staffed Sanitation Post cleared it net-negative, and the HUD Waste row rendered the level. The compost/reclaimer chain and radius-based clearing remain future refinements.
- proposed-by: Mara Venn, drain-warden and barrel reclaimer (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 006 (housing tiers — waste scales with occupied homes), 026 (the fever watch / outbreak), 009 (clinics/health). Reads the season from 054.

## Why (the citizens' case)

Mara Venn walks the drains, and she will tell you what the scrubber gardens were never built to touch. Spec 019 cleans forge-smog out of the air — but it does nothing for fish guts, nightsoil, spoiled skygrain and damp bedding, the everyday filth that any house full of living people makes. For a long time Landing One was small enough that it simply didn't matter; the rim took it. But the homes have multiplied, the better houses make more of it, and the hot months ripen it faster. A sky-colony that lets its own waste pile up does not stay healthy for long — the fevers find it first. It is time the colony minded its drains: let waste be a real thing that slowly builds, and that a few honest keepers on their rounds can clear before it ever becomes a plague.

## Mechanic

- The colony carries a soft **Household Waste** meter in `[0, 1]`. Each in-game day, occupied homes add a **small trickle** of waste — a touch more from the higher housing tiers (more goods, more refuse) and in the **warm seasons** (054). A colony with no homes makes none.
- **Gentle, banded harm:**
  - **below `wasteHarmlessBelow` (0.25)** → **nothing happens** at all (the rim still copes).
  - **at or above 0.25** → **desirability slips slightly** — a filthy colony draws settlers a little slower (the same shape as the existing draws, in reverse).
  - **at or above `wasteFeverThreshold` (0.50)** → **fever risk rises gently** — unhandled filth breeds sickness, feeding the outbreak (026) a little.
- **A staffed Sanitation Post** sends keepers on their rounds: each one **clears waste** from the meter every day. Enough posts hold the waste low; the cleared filth becomes harmless sealed refuse and simply vanishes (a compost/reclaimer chain is a possible later spec).
- **Capped, never a catastrophe (load-bearing):** waste is clamped to `[0, 1]`; the desirability slip and the fever nudge are both **small and bounded**, and the fever it breeds is still subject to the fever watch (026) and clinics (009). Household Waste can make a neglected colony grimy and a little sickly; it can **never** force abandonment, empty a home, or kill en masse.
- **Inert by default (load-bearing):** waste rises **slowly** — measured in colony-months — and **does nothing below 0.25**, so a young or small colony (and every existing test, which runs far too short to cross the threshold) sees desirability, fever and health behave **exactly as today**. The mechanic only wakes in a large, long-running colony that has let its drains go.

## Rules & data

- New colony meter **`waste`** in `[0, 1]`, starting at 0.
- **Generation** (per in-game day): `waste += wasteRisePerDay * occupancyFactor * tierFactor * seasonFactor`, where `wasteRisePerDay` is small (suggest **0.004** — ~60+ days to reach the 0.25 harmless line at full pressure, far longer than any test runs), `occupancyFactor` scales gently with how many homes are occupied (0 with none), `tierFactor` is mildly higher for higher mean housing tier (006), and `seasonFactor` is a small warm-season bump (suggest ~**1.2** in Bloom/Highsun, ~**0.85** in Grey/Frost, **1** with no calendar). Calibrate so a short run stays well under 0.25.
- **Clearance** (per in-game day): each **staffed Sanitation Post** removes `wasteClearPerPostPerDay` (suggest **0.02**) from the meter, scaled by staffing; plus a tiny natural decay so a depopulated colony drifts clean. Clamp `waste` to `[0, 1]`.
- **Desirability effect:** multiply immigration desirability by `1 - wasteDesirabilityWeight * max(0, waste - 0.25)` (suggest weight **0.4**, so at full filth the draw is dampened by ~0.3, never more). Below 0.25 → factor 1.
- **Fever effect:** while `waste >= 0.50`, add `wasteFeverPerDay * (waste - 0.50)` (suggest **0.05** scale) to the outbreak pressure (026) per day — gentle, and contained by clinics and the fever watch exactly as any other source. Below 0.50 → none.
- New building **Sanitation Post** (`sanitation`): a staffed civic service, **2 keepers**, a small power load, built on labour + materials.
- Expose the **waste** level and the sanitation-post count for the HUD.

## Cost — materials & labour

- **Build the Sanitation Post:** Mara's planks, stone, tools and a water barrel map to a modest **materials + components** cost (suggest ~**16 materials + 3 components**), staffed by **2 free colonists** (the keepers). No upkeep beyond their wages (029).
- **Runs on:** labour. Two keepers on the drains are two fewer hands in the farms or workshops — the colony pays for its cleanliness in people, and a growing city needs more posts to keep up, exactly the Caesar III scaling of a service to a population.
- The deeper, intended cost is **attention**: waste is the price of growth that the colony must keep paying. Let the drains go and the fevers find the filth; mind them and the homes stay sweet.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green. The mechanic must be **inert below the harmless threshold** — desirability, fever and health are unchanged, so every current test still passes (none runs long enough to cross 0.25). New tests covering:
  1. **Inert:** a small colony over a short run keeps `waste < 0.25`, and desirability + outbreak match the pre-058 baseline (no effect).
  2. **Accumulation:** an occupied colony's `waste` rises over many days with no Sanitation Post.
  3. **Banded harm:** with `waste` set above 0.25 the immigration desirability is measurably lower than below it; with `waste` above 0.50 the outbreak gains pressure it does not below 0.50.
  4. **Sanitation clears:** a staffed Sanitation Post lowers the `waste` meter over time; enough posts hold it down.
  5. **Capped / never empties:** waste stays within `[0, 1]`, and even at full filth the colony's population and fever stay bounded (no abandonment, no mass death).
- On the live game (:5188): grow a colony until `waste` climbs past 0.25 and watch a **Waste** HUD readout rise and desirability dip; build and staff a Sanitation Post and watch the meter fall back.
