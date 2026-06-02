# Spec 036 — The Skybridge Import Office: buying what the colony cannot make in time
- status: built — slice 32, shipped to mechanics/dev. Engine in src/colony/build.ts (importStep buyer, importOfficeActive guard, importStatus selector, ImportGood/IMPORT_GOODS, premium pricing capped by storage + staffing), the importOrder state field in sim.ts, knobs in config.ts, the setImportOrder action + uiState in runtime.ts, a HUD Import control (off + five goods) with a daily-spend readout in ColonyApp.tsx, and seven tests in tests/economy.test.ts. typecheck clean and all 278 tests pass; live on :5188 a staffed office bought components at the premium ($64/unit vs the Exchange's $40 sell) and drew down treasury, with the order set from the HUD buttons.
- proposed-by: **Mara Venn, founding quartermaster of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara Venn — the Works Marshal on the Founders' Hall roster, and the voice behind the colony's water, batteries, maintenance and storage — returns to close the trade loop she helped open. Opens the buying side of an economy that, until now, could only sell.
- date: 2026-06-02
- depends-on: 012, 023

## Why (the citizens' case)
Mara Venn: *"We can sell our surplus, but one broken chain or a bad labour shift still stalls the whole colony. Landing One needs a controlled way to buy a critical shortage — without making honest local work pointless."*

The Skybridge Exchange (012) earns the colony treasury by **exporting** surplus, but money has nowhere to go but the bank: a fever that idles the foundry, a storm that spoils the stores, a skimmer line that falls behind — and the colony simply waits. Trade today is a one-way street. Mara wants the other lane.

## Mechanic
- A new building, the **Skybridge Import Office** — the buying side of trade, where the Exchange only sells.
- Once built and **staffed**, the council can set a standing **import order** for ONE basic good at a time: materials, components, food, linen, or reels.
- Each day the office spends **treasury** to land a trickle of the chosen good into colony storage, after the haulers make the run — money turned into goods.
- Imports cost **more per unit** than the Exchange pays to sell them, and are **capped by storehouse space**, so mines, workshops, skimmers, greenhouses and foundries stay the backbone of supply; importing is the expensive stop-gap, not the main source.
- Understaffed, the run is slow; with no order set (or no office), nothing is bought and the money loop is unchanged.

## Rules & data
- A built + staffed Import Office **with a set order** → each day: buy up to `importPerDay` units of the order good, paying `importUnitPrice[good]` treasury per unit, until treasury runs short or storage is full.
- The order is **null by default** — no automatic buying. The council sets the good (the same lever pattern as the Levy and Pay rates: neutral until chosen).
- **Premium pricing:** `importUnitPrice = exchangeSellPrice × importPremiumMult` (≈ ×1.6), so locally produced goods always win on cost and imports never make production pointless.
- **Storage-capped:** imports respect the Storehouse Platform caps (spec 023) — a full store stops the delivery; nothing overflows overboard.
- **Labour-scaled throughput:** a fully staffed office imports at the full daily rate; an understaffed one delivers proportionally less (or not at all with nobody to clerk and haul).
- Ties directly into the Exchange (trade now has both a sell side and a buy side) and into treasury (a real money sink that makes export earnings matter).

## Cost — materials & labour
- To BUILD: treasury + **~22 materials + ~10 components + a build crew of ~4** free colonists. *(Mara asked for 40 materials, 8 components, a 6-strong build crew and 10 clerks and haulers; v1 maps her harbour onto the colony's scale — a sizable trade hall run by a small office — with the larger crew a later refinement.)*
- To RUN: **~3 colonists** (clerks + haulers) to keep the office working. Without them, no imports land — money stays in the bank and the shortage stands.

## Acceptance
- With a staffed Import Office and an order set, **treasury falls and the ordered good rises** over time, capped by storage; an imported unit costs **more** treasury than the Exchange pays to sell that good (the premium holds).
- With **no office, or an office but no order**, the colony is unchanged (inert) and the existing suite stays green.
- **Understaffing slows** delivery; a **full storehouse stops** it.
- The HUD shows the Import Office and the active order (the good + the daily spend); tests cover a staffed import buy, the premium price vs the Exchange, the storage cap, and inertness with no office/order.
