# Spec 040 — The Census Hall: a colony-wide Prosperity Rank

- status: built — slice 38, shipped to mechanics/dev. Engine in src/colony/build.ts (the census building, censusActive, prosperityScore as a weighted blend of liveability/Tier-2+3 share/employment/standing/solvency, prosperityRank over 5 bands, prosperityStatus, the high-rank immigration lift, and a Recognised-Sky-Colony Courier headline), knobs in config.ts, uiState in runtime.ts, a HUD Prosperity row in ColonyApp.tsx, and four tests in tests/economy.test.ts. No new ColonyState field — it reads existing signals. typecheck clean and all 311 tests pass; live on :5188 a thriving colony read Prospering at score 78 with a staffed Hall and went dark (0) when unstaffed. v1 derives the milestone from the current rank; a permanent once-earned latch is a later deepening.
- proposed-by: **Edrin Vale, returning founder and ledger-keeper of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Edrin Vale joins the roster of system-authors and names the one thing a deep economy still lacks: a single measure of whether the colony is truly thriving.
- date: 2026-06-02
- depends-on: 006, 011, 032

## Why (the citizens' case)

Edrin Vale: _"We have full granaries, busy reels, paid wages, and fine shrines — but no single civic measure that says whether Landing One is truly thriving. A staffed Census Hall would turn the colony's existing pulse into a clear Prosperity Rank, without changing how homes, trade, labour, or debt already work."_

Liveability (011) reads a single home; nothing reads the _whole colony_. The colony has a hundred dials but no gauge — no goal beyond building more. The Census Hall is the gauge.

## Mechanic

- A new civic building, the **Census Hall**. Once built and **staffed**, it computes a colony-wide **Prosperity** score (0..1) from signals the colony _already produces_ — it reads, it does not change anything, and it consumes no goods and adds no household service.
- **Prosperity** is a weighted blend of: average home **liveability** (011), the **share of Tier 2 + Tier 3 homes** (006), **employment coverage** (jobs filled), **Kookerverse standing** (032), and **Treasury solvency** (039 — in the black is full marks; deep arrears drag it down).
- Prosperity is shown as **five ranks** — _Struggling, Modest, Steady, Prospering, Renowned_ — giving players a clear civic **goal** beyond production volume.
- **Payoff at the top:** at the higher ranks the colony draws settlers a little faster (a modest **immigration lift** that scales with prosperity), and reaching the top rank unlocks a civic **milestone** — _Recognised Sky-Colony_ — carried by the Kookerverse Courier (016).
- **Inert until staffed:** with no built, staffed Census Hall the score is frozen at zero and grants nothing — old play is entirely unchanged. If the Hall loses its clerks, the rank freezes and the payoff lapses until it is staffed again.

## Rules & data

- **Prosperity score** (only while a staffed Census Hall stands; else 0): a weighted average, each term in 0..1 —
  - liveability ≈ 0.30, Tier 2+3 share ≈ 0.20, employment (min(1, colonists / totalJobs)) ≈ 0.20, standing ≈ 0.15, solvency ≈ 0.15 (solvency = 1 when `treasury >= 0`, else `max(0, 1 - debt / debtCeiling)`).
- **Rank:** five bands across 0..1 (e.g. < 0.2 Struggling, < 0.4 Modest, < 0.6 Steady, < 0.8 Prospering, else Renowned).
- **Immigration lift:** desirability × `(1 + prosperityImmigrationBonus * max(0, score - prosperityBonusFloor))` (suggest bonus ≈ 0.2, floor ≈ 0.6) — nothing below the floor, a small pull at the top. Gated on a staffed Hall.
- **Milestone:** at the top rank, a _Recognised Sky-Colony_ flag the Courier reports. (v1 may derive the flag from the current rank; a permanent once-earned latch is a later refinement.)
- Reads only existing state — no new resource, no new household need — so it is a pure synthesis layer.

## Cost — materials & labour

- To BUILD: treasury + **~20 materials + ~4 components + a build crew of ~5** free colonists. _(Edrin asked for 24 materials and an 8-clerk hall; v1 maps it to a ~3-clerk census office on the colony's scale, with the grand statistical hall a later refinement.)_
- To RUN: **~3 colonists** (census clerks) to keep the count current. Unstaffed, the rank freezes and the prosperity payoff lapses — the gauge needs hands to read it.

## Acceptance

- With a staffed Census Hall, a healthy colony reads a high Prosperity rank and a struggling one reads low; the rank rises and falls as liveability, tiers, employment, standing and solvency move.
- At high prosperity the colony draws settlers a little faster, and the top rank flags the _Recognised Sky-Colony_ milestone in the Courier.
- With **no Census Hall, or an unstaffed one**, prosperity is zero and the colony is unchanged (inert) — existing play and the suite stay green.
- The HUD shows the Census Hall's Prosperity rank; tests cover the score reading high vs low from the underlying signals, the staffed-vs-unstaffed gating, the high-rank immigration lift, and full inertness with no Hall.
