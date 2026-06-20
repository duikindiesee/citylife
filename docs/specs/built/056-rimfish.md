# Spec 056 — Rimfish: a second food from the cloudsea rim

- status: built — slice 51, shipped to mechanics/dev. produceRimfish nets rimfish from staffed Cloudsea Net Docks (food sector, deliberately NOT season-gated so it is the off-season buffer); foodStep draws up to rimfishMealFraction of the day's meals from rimfish before skygrain (sparing the grain); the immigration desirability gains a varied-table bonus when rimfish is on hand; storageCaps + clampStorage give rimfish its own store; rimfishStatus feeds the HUD. The rimfish state field is in sim.ts, the netdock building + auto-build gate + knobs in config.ts, the rimfish uiState in runtime.ts, a Rimfish HUD row in ColonyApp.tsx, and five tests in tests/economy.test.ts. Inert by default — with no Net Dock rimfish stays 0, the eat-down is byte-for-byte the old skygrain consumption, and the desirability factor is 1, so all 369 prior tests passed UNCHANGED. Never punitive: rimfish only ever spares grain, never reduces food or starves. typecheck clean and all 374 tests pass; live on :5188 a colony with no dock was inert, a staffed dock netted rimfish, and the HUD Rimfish row rendered a varied table. The deferred housing-tier-demands-variety refinement remains a future option.
- proposed-by: Mara Venn, cloudsea netter (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 007 (skyfarm food), 008 (ration delivery), 023 (finite storage). Pairs with 054 (Mild Seasons — Rimfish is the off-season buffer) and 051 (claimed rim ground, flavour).

## Why (the citizens' case)

Mara Venn works the nets off the deck-edge, where the cloudsea churns past the rim, and she has watched the colony eat one thing its whole life: skygrain. One crop, one table, one risk. When a skyfarm season runs thin — and now that the seasons are real (054), they do — it strikes everyone at once, because there is nothing else to put on the plate. A colony with a single food is a colony one bad harvest from hunger. The cloudsea rim teems with rimfish, and they answer to the nets, not to the fields or the seed or the sun: a second food, gathered a wholly different way. Net them and the colony eats from two larders instead of one — a buffer when the grain runs short, and a richer table that the better homes are glad to see. Skygrain stays the staple; rimfish is the resilience.

## Mechanic

- A new good **`rimfish`** — a second food — is gathered by a staffed **Cloudsea Net Dock** on the colony's rim, stored separately from skygrain (its own stock and storage cap).
- **Inert by default (load-bearing):** with **no Net Dock**, there is no rimfish and **nothing changes at all** — every home eats skygrain exactly as today, and the existing food economy (and every test) is untouched. Rimfish only ever exists once the colony chooses to net it.
- **Effect 1 — dietary resilience (the point):** when rimfish is on hand, colonists take a **portion of their meals from rimfish, sparing skygrain**. The colony draws down rimfish first for that portion, so its **skygrain stock lasts longer** and a thin Frost season (054) or a stumbled harvest bites far less. It can **never reduce** the colony's food or starve anyone — rimfish only ever _adds_ to what is eaten; with none, the colony eats all skygrain as before.
- **Effect 2 — the richer table:** while the colony is netting rimfish (a varied diet is on offer), homes find Landing One a little more worth coming to — a **small immigration desirability bonus** (the richer-table draw, alongside culture, wares and solace). With no rimfish, no bonus.
- **Never punitive:** rimfish is pure upside. Running short of it never devolves a home, never cuts food, never causes hunger — it only removes the buffer and the richer-table draw. Skygrain remains the emergency staple for everyone. (A future spec may let the top housing tier actively _demand_ variety; this slice deliberately keeps rimfish a benefit, not a new tax.)

## Rules & data

- New good **`rimfish`**, a colony stock clamped to a storage cap (suggest it shares the finite-storage system, 023, with its own cap), starting at 0.
- New building **Cloudsea Net Dock** (`netdock`): a staffed gatherer like the mine (002) or the Flax Skimmer (031). Per in-game day a staffed, powered dock nets `rimfishPerDay` (suggest **6** at full staffing), scaled by staffing x power x the usual factors. Crucially it is **not subject to the skyfarm seasons (054)** — the rim does not have a growing season — which is exactly what makes it a buffer.
- **Eat-down (Effect 1):** in the food step, colonists' daily consumption is met **partly from rimfish when available** — up to `rimfishMealFraction` of consumption (suggest **0.35**): `fishMeals = min(rimfish, consumption * rimfishMealFraction)`; draw that from `rimfish`, and draw the remaining `consumption - fishMeals` from skygrain (`food`) as today. With `rimfish = 0` this is byte-for-byte the current eat-down (full skygrain), so it is inert by default.
- **Desirability (Effect 2):** when `rimfish > 0` (the colony is offering variety), multiply immigration desirability by `1 + rimfishDesirabilityBonus` (suggest **0.06**), the same shape as the culture/wares/solace draws. Zero rimfish → factor 1.
- Expose a **Rimfish** readout for the HUD (stock, dock count, and whether the varied table is being served).
- **Auto-build gate:** `chooseArtifact` raises a Net Dock only once the colony is past a size threshold, not in brownout, has spare materials + components, and holds fewer docks than its skyfarms (so it scales with the colony, never pops up early).

## Cost — materials & labour

- **Build the Cloudsea Net Dock:** Mara's timber, rope and tools map to a modest **materials + components** cost (suggest ~**16 materials + 5 components**), staffed by **6 free colonists** (the netters), with a small power load for the winches.
- **Runs on:** labour and power only — the rim provides the fish; the colony provides the hands. Output is modest, so rimfish supplements skygrain rather than replacing it.
- The deeper, intended cost is the **labour trade-off**: six colonists on the nets are six fewer in the mines, farms or workshops. A colony buys dietary resilience and a richer table with the hands it could have spent on growth — exactly the Caesar III choice between breadth and depth.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green. The mechanic must be **inert with no Net Dock** — skygrain consumption and immigration are unchanged, so every current test still passes. New tests covering:
  1. **Inert:** with no Net Dock, `rimfish` stays 0 and the food eat-down (and immigration desirability) match the pre-056 baseline exactly.
  2. **Netting:** a staffed, powered Cloudsea Net Dock raises the rimfish stock over several days, capped at its storage.
  3. **Resilience:** with rimfish on hand, a colony's **skygrain stock falls more slowly** than the same colony with none (rimfish spares the grain), and rimfish is drawn down.
  4. **Never reduces food:** rimfish never lowers the skygrain stock below the no-rimfish baseline, and never below 0 — it only ever spares grain, never costs it.
  5. **Richer table:** with rimfish present, immigration desirability is measurably higher than the same colony with none.
- On the live game (:5188): build and staff a Cloudsea Net Dock, watch a **Rimfish** HUD readout rise, and confirm that during a lean Frost season a colony with rimfish holds its skygrain better than one without.
