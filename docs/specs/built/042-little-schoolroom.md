# Spec 042 — The Little Schoolroom: the colony learns its letters
- status: built — slice 37, shipped to mechanics/dev. Engine in src/colony/build.ts (the school building, educationFraction + educationStatus mirroring solace coverage, the desirability lift, and the Academy training speed-up scaled by coverage), knobs in config.ts, uiState in runtime.ts, a HUD Education row in ColonyApp.tsx, and four tests in tests/economy.test.ts. No new ColonyState field; no goods consumed. typecheck clean and all 307 tests pass; live on :5188 a staffed school schooled two homes to 100% coverage and dropped to 0 when unstaffed. v1 ships the Education coverage, its desirability lift and the Academy speed-up read from current coverage; the accumulating Schooled pool and schooling as a hard higher-tier requirement are later deepenings.
- proposed-by: **Tessa Brindle, returning founder and ration-depot clerk of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Tessa Brindle joins the roster of system-authors and names the gap under every home: the colony feeds its children but never teaches them.
- date: 2026-06-02
- depends-on: 006, 020

## Why (the citizens' case)
Tessa Brindle: *"We have kept bodies fed and fevers down, but our children are growing up counting crates by guesswork and reading warning placards too late. A colony that means to last needs basic letters, sums, and civic habits before the Academy ever sees a worker."*

Homes have water, food, health, culture, wares and faith to want — but nothing to *learn*. Education is the one home-service the colony is missing, and it is also the root the Skillhouse Academy (020) has been training without: a literate populace learns the advanced trades faster.

## Mechanic
- A new small home-service building, the **Little Schoolroom** — teachers reaching the homes around it. Once built and **staffed**, it gives homes an **Education** coverage, the sibling of culture and solace.
- **Education** is a coverage like water / health / culture / wares / solace: a home is *schooled* when a staffed schoolroom reaches it. The colony reads an **education fraction** (share of homes schooled).
- While homes are schooled:
  - they are **more desirable**, so the colony draws and keeps settlers a little better (a desirability lift, like culture and solace), and
  - the colony's people are more capable — a schooled populace lets the **Skillhouse Academy (020) train skilled workers faster** (the Academy's training rate scales up with education coverage).
- **Inert until staffed:** with no built, staffed Little Schoolroom, education is zero and nothing changes — old play, the housing ladder, and the Academy's current rate are all unchanged.
- *(Tessa's fuller vision — a slowly-accumulating "Schooled" pool of young residents, and schooling as a hard requirement for a higher housing tier — is a later deepening; v1 ships the Education coverage, its desirability lift, and the Academy speed-up, all gated on a staffed schoolroom and read from current coverage, so the existing tier ladder and tests stay intact.)*

## Rules & data
- A built + staffed Little Schoolroom schools homes within a coverage radius (like the Holo-Theatre / Mooring Shrine); `educationFraction` = schooled homes / total homes. Schools only while staffed; unstaffed → 0.
- **Desirability:** immigration desirability gains a small **education bonus** scaled by `educationFraction` (≈ up to +10%), in the same product as the culture and solace bonuses.
- **Academy speed-up:** the Skillhouse Academy's training rate is multiplied by `(1 + educationAcademyBonus × educationFraction)` (suggest bonus ≈ 0.5, so a fully-schooled colony trains ~50% faster) — a literate people picks up the advanced trades quicker. With no school, the multiplier is 1 (today's rate).
- **Default-neutral:** `educationFraction = 0` with no staffed school, so every existing factor (desirability, the Academy rate, the housing ladder) is unchanged and the suite stays green.

## Cost — materials & labour
- To BUILD: treasury + **~18 materials + a build crew of ~4** free colonists. No components — a humble schoolroom of slate and benches, reachable early.
- To RUN: **~3 colonists** (teachers + a clerk) to keep the lessons going. Unstaffed, the room sits dark and teaches no one — education needs people, not just a building.

## Acceptance
- With a built, staffed Little Schoolroom in reach of homes, `educationFraction` rises, immigration runs a little faster, and any Skillhouse Academy trains skilled workers measurably quicker.
- With **no school, an unstaffed school, or homes out of reach**, education is zero and the colony is unchanged (inert) — existing play, the housing tiers, the Academy rate, and the suite all stay green.
- The HUD shows an **Education** readout (the schooled fraction); tests cover a staffed school schooling homes + lifting desirability, the Academy training faster under education coverage, and full inertness with no school.
