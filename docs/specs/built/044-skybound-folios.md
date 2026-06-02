# Spec 044 — Skybound Folios: the colony's signature finished export
- status: built — slice 39, shipped to mechanics/dev. Engine in src/colony/build.ts (the folios good in storageCaps/clampStorage/storageStatus, the folio building, produceFolios binding reels + linen 1:1, the Exchange folio sale at folioPrice in tradeStep + tradeExportRate, the chooseArtifact gate, and the Industry sector mapping), the folios state field in sim.ts, knobs in config.ts, the folios resource line in runtime.ts, a HUD Folios row in ColonyApp.tsx, and four tests in tests/economy.test.ts. typecheck clean and all 315 tests pass; live on :5188 a staffed Folio House bound folios from reels + linen and the Exchange exported them at the premium (folioPrice 320 vs reels 120). Inert with no Folio House.
- proposed-by: **Selka Ruun, returning founder and trade clerk of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Selka Ruun joins the roster of system-authors and names what a trading colony still lacks: a treasure of its own that foreign docks would cross the clouds to buy.
- date: 2026-06-02
- depends-on: 012, 013, 031

## Why (the citizens' case)
Selka Ruun: *"We have mines, reels, flax, and linen, but no true 'Landing One' treasure that foreign docks would cross the clouds to buy. Let us stop exporting half-finished prosperity and bind our own signature luxury."*

The colony sells raw-ish goods — components, food, reels, linen — and never the thing only *it* can make. Its two production chains run side by side and never meet. A mature economy needs a **top of chain**: one prized, finished export that converges everything below it and makes a busy Exchange truly pay.

## Mechanic
- A new building, the **Folio House** — bookbinders and gilders who bind the colony's two finest goods into one. Once built and **staffed**, it turns **1 luxury reel (013) + 1 skyflax linen (031) → 1 skybound folio**, a new high-value finished good.
- **Skybound folios** are the colony's **signature finished export**, handled by the existing **Skybridge Exchange (012)** and priced **well above** reels or linen — the premium that makes trade matter.
- The Folio House **only runs while staffed**, drawing on the same labour pool as every workshop and skimmer, so it competes for hands through the existing labour system and the **Roster Office priorities (038)** — folios are a choice to bind hands and goods into export wealth rather than spend them elsewhere.
- **Inert until built:** with no Folio House, no folios are made and nothing about existing production, housing, or trade changes — folios simply don't exist yet.
- This is the first mechanic where the **two goods chains meet** (components→reels and fibre→linen both feed it) and the colony gains a proper export ceiling, **without adding another home service**.

## Rules & data
- A built + staffed Folio House binds folios while inputs are on hand: per day it consumes up to `foliosPerDay × staffing` of **reels AND linen** (1:1) and produces the same count of **folios** — stopping when either input runs dry or folio storage is full.
- **Folios are a new stored good** with their own storage cap (like reels/linen, raised by Storehouse Platforms, 023) and their own Exchange sale: `folioPrice` per unit, set **well above** the reel price (e.g. reels sell at 120; folios at ~320), kept past a small export reserve like the other goods.
- The Exchange exports folios alongside components, food and reels; `tradeExportRate` (the HUD's $/day) includes them.
- **Labour-gated + test-safe:** folios are produced only by a staffed Folio House. With none built, folios stay at 0, no folio trade occurs, and every existing production / housing / trade test is unchanged — the new good is purely additive.

## Cost — materials & labour
- To BUILD: treasury + **~18 materials + ~6 components + a build crew of ~6** free colonists. A fine bindery, not a shed.
- To RUN: **a staff of free colonists** (Selka asked for 8 binders + gilders; v1 maps it to the colony's scale — a substantial workshop of ~3–4 — because folios are slow, exacting work). It consumes **reels + linen** as its raw goods. Understaffed or short of reels/linen, it simply binds fewer folios.

## Acceptance
- With a built, staffed Folio House and reels + linen on hand, the colony **produces skybound folios** (drawing down reels and linen 1:1), and a Skybridge Exchange **exports them for treasury at a premium** above reels and linen.
- Folios respect storage caps and an export reserve; production **stalls (never fails)** when reels, linen, labour, or folio storage run short.
- With **no Folio House**, folios stay 0, no folio trade occurs, and existing production, housing and trade are unchanged (inert) — the suite stays green.
- The HUD shows the **folios** stockpile and the lifted trade income; tests cover a staffed Folio House binding folios from reels + linen, the Exchange selling folios at the premium price, production stalling without inputs, and full inertness with no Folio House.
