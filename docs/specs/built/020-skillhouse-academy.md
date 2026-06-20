# Spec 020 — The Skillhouse Academy: skilled workers, not just more bodies

- status: built
- proposed-by: **Mara Venn, apprentice forecaster (Skybridge Exchange)** — **LIVE Hermes** (model hermes-codex-gpt-5.5), her 9th accepted proposal and the 4th live spec in a row. The inference is steady; the council is humming.
- date: 2026-06-02
- depends-on: 003, 013

## Why (the citizens' case)

Mara Venn: _"We solve everything by throwing more bodies at it. Build a **Skillhouse Academy** and train
people properly — machinists for the workshops, refiners for the foundries. Then the advanced trades run
at full tilt with the hands we have, and the colony can grow UPWARD, not just outward. A trained worker is
worth three untrained ones at a lathe."_

## Mechanic

- New building **Skillhouse Academy** (education). While **staffed**, it **trains the colony's people into
  skilled workers** — raising a pool of `skilled` over time (up to the population).
- The colony's **advanced production** — workshops (003, components) and reel foundries (013, reels) — runs
  at full output only when enough skilled workers cover it. A skill shortage drops it toward a floor; a
  well-trained colony runs the advanced trades at 100%.
- **Basic** production — mines (002) and greenhouses (007) — is unaffected: digging and farming don't need
  the academy. Skill is for the lathes and looms.
- (Mara's per-trade specialisation — medics vs machinists vs grid techs — is a future refinement; v1 is a
  single skilled-worker pool.)

## Rules & data

- New `state.skilled` (skilled workers). A staffed Academy adds `academyTrainPerDay` (~2/day × staffing) to
  it, capped at the colonist count (you can only train the people you have).
- `skillFactor` = `0.6 + 0.4 · min(1, skilled / advancedNeed)`, where `advancedNeed` =
  `(#workshops + #foundries) × skilledPerAdvanced` (~3). It multiplies workshop + foundry output, and
  **stacks** with the health factor (009) and the power/brownout factor (017).

## Cost — materials & labour

- To BUILD: treasury + **~16 materials + ~10 components** + a 3-colonist build crew.
- To RUN: **2 colonists** (the teachers). With no Academy, the colony has no skilled workers and its
  advanced trades sit at the 0.6 floor.

## Acceptance

- A staffed Academy raises `state.skilled` over time (capped at the population).
- A colony with skilled workers runs its workshops/foundries **faster** than the same colony with none;
  basic production (mines) is unchanged by skill.
- HUD shows the skilled-worker count. Tests: the Academy trains skilled workers; advanced output is higher
  with skilled workers than without; mine output is unaffected.
