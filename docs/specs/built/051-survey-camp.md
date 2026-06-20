# Spec 051 — The Survey Camp: the colony can claim new ground

- status: built — slice 46, shipped to mechanics/dev. effectiveBuildRadius, claimStep, footprintStatus and designSurveyCamp live in src/colony/build.ts; effectiveBuildRadius replaced the fixed maxBlockRadius in the cell-finder (nextBlock), so a completed claim immediately opens the next ring of buildable land. The claims and claimProgress state fields are in sim.ts, knobs in config.ts, the footprint uiState in runtime.ts, a HUD Footprint row in ColonyApp.tsx, an auto-build gate (only once nextBlock returns null — the colony has filled its current footprint), and six tests in tests/economy.test.ts. Inert by default — no camp means the effective radius equals the base maxBlockRadius exactly, so all 343 prior tests passed UNCHANGED (zero regression on placement). Claims are slow, capped at maxClaims, and wait when unpaid. typecheck clean and all 349 tests pass; live on :5188 a colony with no camp held at radius 7, and the effective radius widened one ring per claim up to the island edge at radius 11. This is the small, ship-now realisation of the long-deferred 043 (Deck Extension Works) — 043 can now layer its heavier visuals on top or be retired.
- proposed-by: Mara Venn, deck-wright and boundary surveyor (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 001 (materials + labour-gated construction), 002 (materials), 003 (components). Relates to 043 (Deck Extension Works) — this is the small, ship-now first step of that footprint-expansion idea.

## Why (the citizens' case)

Mara Venn has walked the boundary line since the first deck was bolted down, and she has run out of room to walk. The homes and workshops are pressed right up against the old landing limit — a soft legal cap a few blocks out from where the first skybridge touched down. And yet she can stand at the edge and see **solid island ground stretching further out**, flat and buildable, that no one is allowed to set a footing on. So growth chokes. The colony can be perfectly fed, tooled, watered, and worked, raise children and draw settlers, and still have nowhere to put them. Every other limit in Landing One can be answered by building something — except the one limit on _where_ you may build. The colony needs to be able to claim the ground it can already see.

## Mechanic

- The colony has an **effective build radius** — how far out from the landing construction is allowed. Today it is a fixed constant; this spec makes it **grow**.
- A staffed **Survey Camp** runs **Outer Claims**. While the camp is built, staffed, and supplied, it accrues claim-work over time; when a claim completes it **expands the build footprint by one deck-ring** (effective radius + 1) onto **existing island terrain only** — no new terrain is generated, the claim just opens ground that is already there.
- Each further ring needs **another completed claim**, each costing its own materials and crew-time. Expansion is **capped** at a maximum number of rings so the colony never claims past the buildable island.
- **Inert by default (load-bearing):** with **no Survey Camp**, the effective build radius equals today's fixed cap exactly, so the existing buildable area — and every test and the live colony — is unchanged. Claims are slow (measured in colony-days of staffed work), so short runs never move the frontier.
- New plots opened by a claim are filled by the **normal labour- and materials-gated construction** (spec 001) — claiming ground does not pop up buildings, it only makes more cells eligible.

## Rules & data

- New building **Survey Camp** (`surveycamp`): staffed civic worksite. Build cost **20 materials + 6 components**, **crew of 4 free colonists** (Mara's 2 surveyors + 2 deck-wrights), a small power load (~0.3). Like every workplace it must be built on labour + materials and staffed to function.
- New colony counter **`claims`** (completed Outer Claims), starts 0, clamped to `maxClaims` (suggest **4**).
- **Effective build radius** = `COLONY.build.maxBlockRadius + min(claims, maxClaims)`. Wire this everywhere the current fixed `maxBlockRadius` gates placement (the cell-finder / plot search), so a completed claim immediately makes the next ring of land eligible. Suggest base stays 7 → up to 11 with all claims (the Review & Build routine must keep the top ring on solid, non-water terrain — cap `maxClaims` lower if the island is smaller).
- **Claim accrual** (per in-game day): a Survey Camp staffed at fraction `f` and powered accrues `claimWorkPerDay` (suggest **1/claimWorkDays**, with `claimWorkDays` ~ **6**) toward the current claim, scaled by `f` and the power factor. An unstaffed or browned-out camp makes no progress.
- **Claim completion:** when accrued work reaches 1.0 **and** the colony holds the claim's materials (suggest **40 materials + 10 components**), spend them, increment `claims`, reset the work meter. If the colony cannot pay when the survey is done, the claim **waits** (work holds at full) until it can — the frontier does not move on credit.
- **No camp, or `claims` already at `maxClaims`** → no accrual, effective radius holds.
- Expose the effective radius, `claims`/`maxClaims`, and the current claim progress for the HUD.

## Cost — materials & labour

- **Build the camp:** 20 materials + 6 components, staffed by **4 free colonists** (who are then unavailable for other work, exactly like any crew).
- **Each Outer Claim:** ~6 colony-days of that staffed crew's work **plus 40 materials + 10 components** spent on stakes, beams, planks and fittings to lay the new boundary. Undersupplied or understaffed, the frontier simply does not advance.
- The deeper cost is the standing commitment: four colonists tied to the boundary instead of the mines or farms, and a materials drain every time the city decides to grow outward — so a colony expands its ground only when it has hands and stock to spare.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green. Because this touches placement, the **existing buildable area must be unchanged with no Survey Camp** — every current test still passes. New tests covering:
  1. **Inert:** with no Survey Camp, the effective build radius equals `COLONY.build.maxBlockRadius` and `claims` stays 0.
  2. **A claim expands the radius:** a built, staffed, supplied Survey Camp completes an Outer Claim over several days, `claims` rises by 1, and the effective radius rises by one ring.
  3. **Cost is paid:** completing a claim spends the claim's materials + components.
  4. **Capped:** claims never exceed `maxClaims`, so the radius stops growing at the island's edge.
  5. **Gated:** an unstaffed or unsupplied camp makes no progress (the frontier holds).
  6. **Opens plots:** after a claim, the plot search admits at least one cell that was outside the old radius (more buildable ground exists).
- On the live game (:5188): build and staff a Survey Camp, let a claim complete, and confirm a **Build radius** HUD readout ticks up and a building can now be placed on a ring that was previously off-limits.
