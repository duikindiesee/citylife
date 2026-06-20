# Spec 029 — The Pay Office: the colony finally pays the hands that hold it up

- status: proposed
- proposed-by: **Hessa Morn, night-shift tally clerk at Storehouse Platform C, Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A NEW citizen voice — the council's 13th — and fittingly a tally clerk at the same storehouse as Jory Pell (who authored the Levy Office, 025): two clerks who keep Landing One's books. The other half of the ledger — the colony's first wage lever, the counterweight to the levy.
- date: 2026-06-02
- depends-on: 025, 028

## Why (the citizens' case)

Hessa Morn: _"Every worker on Landing One is treated like a free gear in the floor. The levy takes from us, but the
colony never pays back. That is why a hard tax feels like a hand around the throat: there is no wage to soften it.
Build a **Pay Office** and let the colony finally pay the hands that hold it up."_

## Mechanic

- A new building, the **Pay Office**: a staffed payroll counter. Once built and staffed, the council can set a
  colony-wide **Wage Rate**: **Low**, **Standard**, or **Generous**. Without an office, labour is free as it is today
  (no payroll, no lever).
- Each cycle the colony pays a **payroll** from the treasury, scaled by the **number of employed workers** and the
  wage rate — the colony's first labour EXPENSE, the counterweight to the levy's income.
- The rate is a real tradeoff, and it directly answers the unrest (028) that a hard levy (025) can cause:
  - **Low** — cheap payroll, but workers grow restless (it feeds unrest) and settlers come slower.
  - **Standard** — fair pay; a steady workforce, no mood change.
  - **Generous** — costly payroll, but loyal workers: unrest eases and settlers arrive faster.
- This gives the council the missing lever: **raise the levy to fund the colony, then pay generous wages to offset the
  anger** — or run cheap and risk strikes and empty bunks.

## Rules & data

- `wageRate` ∈ {low, standard, generous}, default **standard**. It only takes effect while a **staffed Pay Office** stands.
- **Payroll** (treasury, per day) = `employed workers × wagePerWorkerPerDay × wageFactor` (low ≈ 0.6×, standard 1.0×,
  generous ≈ 1.6×). Subtracted alongside the daily building upkeep; no office → no payroll.
- **Unrest (028):** a **Low** wage is a hardship signal that feeds unrest (alongside a hard levy and a brownout); a
  **Generous** wage actively **calms** unrest (an extra recovery each day). Standard is neutral.
- **Immigration:** wage scales desirability — low ≈ 0.85×, standard 1.0×, generous ≈ 1.2×.
- Pay Office: build ~10 materials + ~4 components + ~1 reel (secure ledger spools) + a build crew of 3; run 2 payroll
  clerks. _(Hessa asked for a 6-strong roll; v1 uses the colony's standard 2-staff sizing — a bigger office is a later
  refinement.)_
- Default (standard rate / no office) leaves the founding economy exactly as today, so existing behaviour and tests are
  unaffected.

## Cost — materials & labour

- To BUILD: treasury + ~10 materials + ~4 components + ~1 reel + a 3-colonist build crew.
- To RUN: 2 colonists (payroll clerks) + the ongoing **payroll** itself — the colony now pays every employed worker each
  day at the chosen rate. Without a Pay Office, labour stays free but the council has no wage lever to ease unrest or
  draw settlers.

## Acceptance

- With a staffed Pay Office, a **Generous** wage costs more treasury per day than a **Low** one (a real payroll expense
  that scales with employment); **Low** feeds unrest while **Generous** eases it; wage scales immigration the matching way.
- Without a Pay Office, or at the default **Standard** rate, there is no payroll and no effect — the founding economy is
  unchanged.
- The rate is settable at runtime (e.g. `window.__colony.setWage('low'|'standard'|'generous')`) and shown in the HUD with
  the current payroll.
- Tests: a generous wage drains more treasury than a low one; a low wage raises unrest and a generous one lowers it (with
  an office); no office → no payroll; the founding economy stays green.
