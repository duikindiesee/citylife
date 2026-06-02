# Spec 045 — The Wind-Shear Turbine Mast: power that scales with the colony
- status: built — slice 40, shipped to mechanics/dev. Engine in src/colony/build.ts (the turbine building, turbinePower as a staffing-scaled steady output folded into peakSupply, and a power-short build gate preferring a mast once components are on hand), the steady (non-daylight) turbine term added to live generation in sim.ts, knobs in config.ts, a power.windW readout in runtime.ts, a HUD Wind row in ColonyApp.tsx, and three tests in tests/economy.test.ts. No new ColonyState field. typecheck clean and all 318 tests pass; live on :5188 ten staffed masts lifted Wind to 40 kW and cleared a brownout, spinning down to 0 when unstaffed. Inert with no mast.
- proposed-by: **Brannic Sore, returning founder and deck-rigger of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Brannic Sore joins the roster of system-authors and names the ceiling under the lights: solar is fixed, and a widening colony will simply brown out.
- date: 2026-06-02
- depends-on: 017

## Why (the citizens' case)
Brannic Sore: *"Solar has carried us this far, but every new deck and Tier 3 block leans harder on the same fixed sun. If Landing One is going to widen without living under permanent brownout rules, we need a buildable generator that grows with the colony."*

Every other resource in the colony can be grown — mines, skimmers, workshops, even soon the deck itself — but **power cannot**. Solar peak is a fixed number; batteries only buffer it; the brownout grid (017) only rations it. As the colony adds homes and the deck widens, demand climbs and supply does not. Generation is the one input with no throttle.

## Mechanic
- A new building, the **Wind-Shear Turbine Mast** — raised on open deck edge where it bites into the upper crosswinds. Once built and **staffed**, it adds a steady block of **power generation** to the colony.
- Its output feeds the **existing brownout priority grid (017)** exactly like solar: it raises the colony's peak supply, pushing back the point at which heavy industry sheds load. Build more masts and generation **scales with the colony**.
- It **only generates while staffed** by trained operators (free colonists); understaffing cuts its output proportionally, and an unstaffed mast generates nothing.
- It **consumes no goods** to run — it harvests the cloudsea wind — but it is anchored in the materials economy by its build cost, and its components cost gives workshops another civic demand beyond export.
- **Inert until built:** with no Turbine Mast, the colony's power supply is exactly the fixed solar + batteries it is today, so existing play, the brownout behaviour, and tests are unchanged.

## Rules & data
- A built + staffed Turbine Mast contributes `turbineOutputW × staffing` to the colony's **peak power supply** (the same supply solar feeds, used by the brownout check, spec 017). Suggest `turbineOutputW` comparable to a meaningful fraction of solar peak, so one mast noticeably lifts the ceiling and several scale it well past solar.
- **Staffing-scaled:** output = `turbineOutputW × min(1, colonists / totalJobs)` per mast (or the colony's staffing factor) — fully staffed → full output; unstaffed → 0.
- **Brownout tie-in:** raising peak supply lifts `peakSupply(state)`, so `inBrownout` (load over supply with a drained battery) triggers later; a well-turbined colony rarely browns out even as it grows.
- **Default-neutral:** no Turbine Mast → no added supply → the power grid behaves exactly as today, so the suite and current brownout tests stay green.

## Cost — materials & labour
- To BUILD: treasury + **~40 materials + ~12 components + a build crew of ~8** free colonists — a tall, substantial mast, not a panel. The components cost gives the workshops a real domestic customer.
- To RUN: **a crew of free colonists** (Brannic asked for 6 operators; v1 maps it to the colony's scale — a few trained hands) to keep the turbine turning. Understaffed, it spins down and gives less; unstaffed, it gives nothing. It burns no goods — only the wind and the wages of the hands that mind it.

## Acceptance
- With a built, staffed Wind-Shear Turbine Mast, the colony's **peak power supply rises** and it browns out **less** under the same load; more masts scale generation further. Understaffing a mast cuts its contribution.
- With **no Turbine Mast**, the power supply is exactly today's fixed solar + batteries and the brownout grid behaves unchanged (inert) — the suite stays green.
- The HUD shows the lifted power supply (and/or the turbines' generation); tests cover a staffed mast raising peak supply and easing a brownout, staffing-scaled output, and full inertness with no mast.
