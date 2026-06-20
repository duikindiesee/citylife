# Spec 039 — Treasury Arrears: giving an empty treasury teeth

- status: built — slice 34, shipped to mechanics/dev. Engine in src/colony/build.ts (the Comptroller building, comptrollerExists/comptrollerActive guards, colonyDebt + arrearsStrain, a clampTreasury floor of 0 without an office and -debtCeiling with one, payday interest doubled while unstaffed, the desirability + unrest strain wiring, and arrearsStatus), knobs in config.ts, uiState in runtime.ts, a HUD Debt row in ColonyApp.tsx, and eight tests in tests/economy.test.ts. No new ColonyState field — the debt is a negative treasury. typecheck clean and all 291 tests pass; live on :5188 the treasury floored at 0 with no office, held a deficit to the -5000 ceiling with a staffed one, and flagged the strain past half the ceiling. v1 ties the debt floor to the office standing with staffing governing the interest rate; the literal levy-seizure ordering Toma described is folded into the payday interest.
- proposed-by: **Toma Rill, ledger-keeper and founding dockhand of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A new founder steps forward (Toma Rill joins the roster of system-authors), naming the one place the economy has no consequence: going broke costs the colony nothing.
- date: 2026-06-02
- depends-on: 025, 028, 029

## Why (the citizens' case)

Toma Rill: _"Right now, an empty treasury is only an embarrassment, not a danger. If Landing One is to feel like a real colony, debt should keep us alive for a while — but make everyone feel the strain."_

The colony earns (exports, levy) and spends (construction, wages, imports, feasts, Spire), but the bank has no floor and no consequence: it simply sits at whatever it sits at. The most foundational thing the money axis is missing is a **downside** — what happens when the colony spends more than it has.

## Mechanic

- A new building, the **Comptroller's Office** — the colony's debt desk. Until one is built and **staffed**, the treasury has a hard floor of **zero**: civic spending that would overdraw simply cannot happen (exactly as today).
- Once a staffed Comptroller's Office stands, the colony may run a **deficit** — the treasury can fall below zero, down to a fixed **debt ceiling** (`-debtCeiling`). This is **Arrears**.
- **Interest** accrues on the debt: each payday a portion of the outstanding debt is added to it (the bank's cut), so arrears grow if left unpaid — funded first, before wages and services.
- **Strain:** once the debt passes **half the ceiling**, the colony is visibly stretched — Pay-Office wages count **one step lower** for settler attraction and for Ward-Post unrest (a squeezed treasury means a squeezed colony). Settlers slow; unrest creeps.
- **Unmanaged arrears:** if the treasury is negative but the Comptroller's Office is **unstaffed** (the clerks walked, or were never enough), the debt is mismanaged and **interest doubles** until staffing is restored.
- **Recovery:** paying the treasury back to zero or above **clears Arrears** — wages, immigration and unrest return to normal. Debt is a bridge through a hard stretch, not a way of life.

## Rules & data

- **Floor without an office:** with no built, staffed Comptroller's Office, the treasury is clamped at `>= 0` (overdrawing spend is blocked/deferred, as today). This is the load-bearing test-safety contract — nothing about today's economy changes.
- **Debt ceiling:** with a staffed office, treasury may fall to `-debtCeiling` (suggest ~5000). Spend that would breach the ceiling is still blocked.
- **Interest:** on each income day, if `treasury < 0`, `treasury -= debtInterestRate * |treasury|` (suggest ~3% per payday), doubled when the office is unstaffed while negative.
- **Strain threshold:** when `|debt| > debtCeiling / 2`, apply a one-step-down shift to the effective wage rate used by immigration desirability (spec 029) and by the unrest checks (spec 028), plus a small direct unrest pressure (`arrearsUnrestPerDay`).
- **Clear:** when `treasury >= 0`, Arrears end and all penalties lift.
- Ties into the Levy (025) and Pay Office (029) — the levers that fill and drain the bank — and into Ward unrest (028); the Import Office (036), feasts (030) and the Spire (033) are the big spenders that can now push the colony into the red on purpose.

## Cost — materials & labour

- To BUILD: treasury + **~18 materials + ~4 components + a build crew of ~4** free colonists. _(Toma asked for a 6-clerk office; v1 maps it to a ~3-clerk desk on the colony's scale, with the fuller counting-house a later refinement.)_
- To RUN: **~3 colonists** (clerks) to keep the debt managed. Leave it unstaffed while in the red and interest doubles — the office must be manned exactly when money is tightest, which is the hard choice.

## Acceptance

- **Test-safety:** with no Comptroller's Office, the treasury never falls below zero and nothing about the existing economy or the suite changes. This is the load-bearing contract.
- With a staffed office, civic spending may drive the treasury negative down to the ceiling; interest grows the debt each payday; paying back above zero clears it.
- Past half the ceiling, settlers slow and unrest creeps (the one-step wage strain); an **unstaffed** office while negative **doubles** the interest.
- The HUD shows the Comptroller's Office, the current debt, and an Arrears/strain warning; tests cover the no-office zero-floor (inert), entering and clearing debt with a staffed office, the payday interest, the unmanaged doubling, and the half-ceiling strain.
