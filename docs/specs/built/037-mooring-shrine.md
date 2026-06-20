# Spec 037 — The Mooring Shrine: giving a drifting platform a reason to feel like home

- status: built — slice 33, shipped to mechanics/dev. Engine in src/colony/build.ts (solaceCoverage + solaceStatus, the shrine building + chooseArtifact gate, the desirability and unrest wiring, the linen upkeep + no-linen dimming), knobs in config.ts, uiState in runtime.ts, a HUD Solace row in ColonyApp.tsx, and five tests in tests/economy.test.ts. No new ColonyState field. typecheck clean and all 283 tests pass; live on :5188 a staffed shrine consoled two homes to 100% Solace and dimmed to the starved factor (30%) when the linen ran out. v1 ships the Solace service, its desirability lift, the unrest relief and the linen upkeep; the consecrated Tier 4 housing step is a later deepening.
- proposed-by: **Mara Venn, founding deck-rigger and ward elder of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara Venn turns from quartermaster to ward elder and opens a dimension the colony has never had: **faith and shared ritual** — the first reason a home is more than a serviced box.
- date: 2026-06-02
- depends-on: 006, 028, 031

## Why (the citizens' case)

Mara Venn: _"We have water, food, wages, and walls against the storms — but people also need a reason to feel this drifting platform is home. A small civic shrine gives households comfort, memory, and shared ritual, without adding a huge new industry."_

Every service so far is a need met (thirst, hunger, sickness, boredom, bare shelves). None of them is a reason to _stay_ once the basics are covered. A colony of fully-serviced strangers is still a colony of strangers. The Mooring Shrine is the first mechanic about belonging.

## Mechanic

- A new small service building, the **Mooring Shrine** — a civic shrine that, once built and **staffed**, carries **Solace** to the homes around it (a new home service, the sibling of culture and wares).
- Solace is a coverage, like water / food / health / culture / wares: a home is _consoled_ when a staffed shrine reaches it. The colony reads a **solace fraction** (share of homes consoled).
- The shrine consumes a slow trickle of **linen (031)** — prayer flags and memorial wraps — to run, on top of its staff.
- While homes are consoled:
  - they are **more desirable**, so the colony draws and keeps settlers a little better (immigration lift, like culture and wares),
  - and they are **steadier** — consoled homes generate **less unrest (028)** during shortages, brownouts, or a failed civic request (comfort carries people through a hard week).
- **Inert by default:** with no built, staffed shrine, solace is zero and nothing changes. Overbuilding shrines strains the labour pool (each needs staff), so it is not free comfort.
- _(Mara's fuller vision — a consoled **Tier 3** home that is consistently served evolving into a new "consecrated" Tier 4 housing step — is flagged as a later deepening; v1 ships the Solace service, its desirability lift, the unrest relief, and the linen upkeep, all gated on a staffed shrine, so the existing housing ladder and tests stay intact.)_

## Rules & data

- A built + staffed Mooring Shrine consoles homes within its reach (a coverage radius like the Housewares Market, spec 027); `solaceFraction` = consoled homes / total homes.
- **Desirability:** immigration desirability gains a small **solace bonus** scaled by `solaceFraction` (≈ up to +10–12% at full coverage), in the same product as the culture and wares bonuses.
- **Unrest relief:** while `solaceFraction` is high, the daily unrest pressure is eased by a small `solaceCalmPerDay × solaceFraction` term (a consoled colony frays slower).
- **Upkeep:** each shrine burns `shrineLinenPerDay` linen while staffed; with no linen the shrine still stands but its Solace dims (no flags, no wraps) until linen returns.
- **Labour gate:** the shrine consoles only while staffed (free colonists clerk and keep it); unstaffed, solace is zero.
- Default-neutral: `solaceFraction = 0` with no shrine, so every existing factor stays at its current value and the suite stays green.

## Cost — materials & labour

- To BUILD: treasury + **~10 materials + ~2 components + a build crew of ~4** free colonists. A small, cheap civic building — comfort should be reachable early, not a late-game luxury.
- To RUN: **~3 colonists** to keep the shrine, plus a slow **linen** trickle for flags and wraps. Without people (or, more softly, without linen) the Solace fades.

## Acceptance

- With a built, staffed Mooring Shrine in reach of homes, `solaceFraction` rises, immigration runs a little faster, and consoled homes shed unrest more slowly under strain; the shrine draws down linen while it runs.
- With **no shrine, an unstaffed shrine, or homes out of reach**, solace is zero and the colony is unchanged (inert) — existing play and tests stay green.
- Running a shrine **out of linen** dims its Solace (coverage drops) until linen returns; staffing it again restores it.
- The HUD shows a **Solace** readout (the consoled fraction); tests cover a staffed shrine consoling homes and lifting desirability, the unrest relief, the linen upkeep + the no-linen dimming, and full inertness with no shrine.
