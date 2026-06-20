# Spec 038 — The Roster Office: making a labour shortage a choice, not a random failure

- status: built — slice 35, shipped to mechanics/dev. Engine in src/colony/build.ts (the Sector map over every BuildKind, sectorDemand, rosterActive, and the greedy sectorStaffing allocation whose default is byte-identical to the old uniform fill; the Roster building; rosterStatus), the rosterMode state field in sim.ts (default balanced), knobs in config.ts, the setRosterMode action + uiState in runtime.ts, a HUD Labour control (Ess/Bal/Ind) in ColonyApp.tsx, and five tests in tests/economy.test.ts. The 11 producer staffing sites were converted to sectorStaffing; all 291 prior tests stayed green (proving the refactor is behavior-preserving) and 296 pass total. Live on :5188 the same six hands mined 0 under Essentials, 0.33 under Balanced, and 0.83 under Industry — the same labour, redistributed. v1 prioritises the labour-gated production sectors (Industry/Food/Trade/Civic); services and safety are coverage-based and unaffected, and a fully council-orderable per-sector list is a later deepening.
- proposed-by: **Mara Venn, founding quartermaster of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara Venn, who keeps the colony's stores and rosters, names the gap under the whole economy: there are plenty of places to work, but no civic hand on where the scarce hands go first.
- date: 2026-06-02
- depends-on: 004, 021

## Why (the citizens' case)

Mara Venn: _"Landing One has plenty of places for people to work, but no civic hand on where scarce hands go first. When the colony is short on workers, that shortage should feel like a choice, not just random failure."_

Today, when there are fewer colonists than jobs, the squeeze is spread evenly: every mine, kitchen, clinic and foundry runs at the same fraction. A starving colony and a thriving one shed labour the same blind way. The most foundational lever the colony is missing is the one over its own people: **who gets staffed first.**

## Mechanic

- A new building, the **Roster Office** — civic labour administration. Once built and **staffed**, it unlocks **labour priority by sector**.
- The colony's workplaces are grouped into sectors: **Food, Services, Industry, Logistics, Safety, Trade, Civic.**
- The Roster Office does **not** create workers. When the colony is **short of labour** (free colonists < open jobs), it decides _which sectors fill first_: high-priority sectors staff to full before lower-priority sectors get anyone, instead of every sector running equally short.
- The council sets a **priority mode** — e.g. **Essentials-first** (Food / Safety / Services lead), **Balanced** (today's even split), or **Industry-first** (Industry / Logistics / Trade lead) — so a labour squeeze becomes a real decision: keep the foundries turning, or keep the kitchens and clinics staffed.
- **Inert / unchanged by default:** with **no staffed Roster Office** (or in **Balanced** mode) the colony falls back to today's even, uniform staffing — nothing about existing play changes. The office only ever redistributes labour the colony _already has_; it never adds or removes work done in total when there is no shortage.

## Rules & data

- Let `L` = free colonists available to work and `D` = total open jobs. If `L >= D` there is no shortage — every sector is fully staffed and the priority mode is irrelevant.
- **Without a staffed Roster Office (or in Balanced mode):** every sector's staffing factor = `min(1, L / D)` — exactly the uniform behaviour the producers use today.
- **With a staffed Roster Office in a priority mode:** walk the sectors in priority order, filling each sector's job-demand to full from `L` until `L` is exhausted; the remaining sectors get what's left (down to 0). Each sector's staffing factor = `assigned / demand`. Same total labour, concentrated where the council chose.
- **Sector map (suggested):** Food = greenhouse, ration depot, water hub; Services = clinic, theatre, market, mooring shrine, survey; Industry = mine, workshop, foundry, skimmer, weavery; Logistics = transit depot, maintenance shed, storehouse; Safety = bellhouse, fever watch, ward post, stormwatch, scrubber; Trade = exchange, import office; Civic = levy, pay office, liaison, academy, broadcast mast, founders hall, feast deck, roster office.
- **Labour gate:** the office assigns nothing while unstaffed (the colony reverts to the uniform split). Running it costs clerks, so an early, labour-tight colony must weigh whether central control is worth the workers it occupies.
- _(v1 may ship the building + the three preset modes wired into the producers' staffing, with default Balanced and no-office reproducing today's numbers exactly; a fully council-orderable per-sector priority list is a later deepening.)_

## Cost — materials & labour

- To BUILD: treasury + **~12 materials + ~2 components + a build crew of ~4** free colonists. A modest civic office.
- To RUN: **~3 colonists** (clerks) to keep the roster. Unstaffed, the colony falls back to even, inefficient labour distribution — the office occupies the very hands it directs, so it is never free.

## Acceptance

- **Test-safety:** with no Roster Office, or with one in Balanced mode, every sector's staffing equals today's uniform `min(1, L/D)` — so the existing economy and the whole suite stay green. This is the load-bearing contract.
- Under a real labour shortage with a staffed office in **Essentials-first**, the Food / Safety / Services sectors reach full staffing while Industry / Logistics / Trade absorb the shortfall (and the reverse for **Industry-first**) — the _same_ total labour, redistributed.
- An **unstaffed** Roster Office changes nothing (the colony reverts to the uniform split).
- The HUD shows the Roster Office and the chosen priority mode (a small lever, like the Levy and Wage controls); tests cover the priority concentration under a shortage, the Balanced/no-office equivalence to uniform staffing, and the unstaffed fallback.
