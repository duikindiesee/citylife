# Spec 007 — Skyfarm Greenhouse: food production

- status: built
- proposed-by: **Mara Venn, workshop quartermaster** — live Hermes citizen (model hermes-codex-gpt-5.5), her 2nd accepted proposal
- date: 2026-06-01
- depends-on: 005

## Why (the citizens' case)

Mara Venn: _"We have water but the people are hungry — there's no food. Build a **Skyfarm Greenhouse**:
grow vegetables in irrigated trays. Tie it to the Water Hub, put settlers to work, and feed the homes so
immigrants don't starve or stop coming. Output is better near water, and nothing grows if no one tends it."_

## Mechanic

- New building **Skyfarm Greenhouse** (food producer). While **staffed**, it produces **food** into a
  food stockpile. Output is **boosted when within a Water Hub radius** (irrigated trays) and scales with
  staffing.
- Homes **consume food** daily (per colonist). When food runs out, **immigration stalls and settlers
  emigrate** (hunger). A fed + watered colony is desirable, so it grows faster.
- New `state.food` resource; HUD shows Food.

## Rules & data (Mara's proposal, adapted to CityLife's scale)

- Build cost: treasury + **~14 materials + ~12 components** + a build crew of 3. (Mara said 45 materials;
  CityLife's materials are scarce — mines make ~5/day — so scaled down, but components 12 keeps the sink.)
- Run: **2 workers**; base output ~6 food/day at full staffing, **+50% within a Water Hub radius**.
- Food consumption: each colonist eats ~0.4 food/day (so one well-placed greenhouse feeds ~15 colonists,
  ≈ Mara's "8–10 homes").
- Liveability: immigration desirability now also depends on a **fed fraction** (food in stock vs daily
  need). Hungry → immigration slows / emigration; fed + watered → full-speed growth.

## Cost — materials & labour

- To BUILD: treasury + ~14 materials + ~12 components + a 3-colonist build crew.
- To RUN: 2 colonists; output boosted if sited near a Water Hub.

## Acceptance

- A staffed greenhouse raises `state.food` over time (more when near a Water Hub); colonists consume food
  daily.
- With food in stock, immigration is healthy; with no food, immigration stalls and emigration begins.
- HUD shows Food. Tests: greenhouse produces food (more near water); food is consumed by colonists;
  immigration slows when food hits zero.
