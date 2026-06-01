# Spec 008 — Ration Depot: food distribution reaches the homes
- status: proposed
- proposed-by: **Mara Venn, quartermaster of Dock-Ring 3** — live Hermes citizen (model hermes-codex-gpt-5.5), her 3rd accepted proposal (after the Water Hub 005 and the Skyfarm Greenhouse 007)
- date: 2026-06-01
- depends-on: 007

## Why (the citizens' case)
Mara Venn: *"Food piling up at the farm does no good if it never reaches the bunks. We need a **Ration
Depot** — a little distribution house that draws from the stockpile and hands daily portions to the homes
in its reach. Without it, some homes starve while others sit beside plenty."*

## Mechanic
- New building **Ration Depot** (distribution). While **staffed**, it **provisions** habitats within
  `rationDepotRadius` by drawing **food** from the shared stockpile and delivering it to those homes.
- A habitat counts as **fed only if a depot provisions it** AND the stockpile has food. Homes beyond
  every depot's reach go hungry even when the colony's food total is high — food must be *delivered*,
  not merely produced.
- Immigration desirability now keys off the **provisioned fraction** (homes in depot range vs all homes),
  the same way it keys off the watered fraction (spec 005). Reach + water + food → full-speed growth.
- A depot serves up to `rationDepotHomes` nearest homes; build more depots as the colony spreads.

## Rules & data (Mara's proposal, adapted to CityLife's scale)
- Build cost: treasury + **~12 materials + ~10 components** + a build crew of 3. (Mara said 35 materials
  + 12 components + 20 labour; scaled to CityLife's tighter economy, components kept as the sink.)
- Run: **2 workers**; **~1 component/day** upkeep (fittings, crates).
- Coverage: `rationDepotRadius` ≈ 8 cells; serves the nearest **~8 homes**.
- Delivery draws from the global `state.food`; if food runs out, provisioned homes still go hungry —
  a depot can't hand out what the colony hasn't grown (spec 007).

## Cost — materials & labour
- To BUILD: treasury + ~12 materials + ~10 components + a 3-colonist build crew.
- To RUN: 2 colonists + ~1 component/day.

## Acceptance
- A staffed depot near homes makes them provisioned; immigration runs at full speed.
- Homes outside every depot's reach stay hungry and their growth stalls **even when global food is
  plentiful** (distribution matters, not just production).
- HUD shows a provisioned indicator. Tests: a depot provisions in-range homes; out-of-range homes are
  not fed despite a full stockpile; immigration is faster when homes are provisioned.
