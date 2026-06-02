# Spec 027 — The Housewares Market: manufactured goods finally reach the home
- status: proposed
- proposed-by: **Sella Brint, second-shift workshop packer (14:00–22:00), Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A NEW citizen voice — the council's 11th — and fittingly a workshop packer, who wants to know where her crates of reels end up. Closes the colony's core loop: goods → homes → housing growth.
- date: 2026-06-02
- depends-on: 006, 013

## Why (the citizens' case)
Sella Brint: *"If my bench turns out good reels, I want to know some child on Deck Seven has a lamp that doesn't flicker
and a wall-screen that works. Right now our goods only feed buildings, exports, and a few abstract upgrades. Give us a
**Housewares Market** — a staffed little market that collects finished goods from the storehouses and sends porters
through the housing decks — and manufactured goods finally become household life, not just crates with invoice tags."*

## Mechanic
- A new building, the **Housewares Market**: a staffed distribution post (clerks, porters, loaders) that carries
  finished **manufactured wares** — **components** as everyday wares, and **luxury reels** as fine wares — from the
  colony's stock out to the homes within its **delivery range**.
- A home in range of a staffed market, while the colony holds the goods, is **housewares-supplied**: it receives
  everyday wares; a market that also has **reels** in stock supplies **luxury wares**.
- **Housing growth now needs wares**, not just services: a home climbs to and holds the **top tier** only while it is
  supplied with **luxury wares** (a market in range + reels), on top of the full service stack (015). Everyday wares
  speed a home's climb and make it more desirable; cut the deliveries and homes stop climbing and slide back after the
  usual grace period.
- The market holds only a small local stock — it **draws on the storehouses (023) and ongoing production**, so the
  workshops and the foundry finally drive how families live, not only construction and trade.
- This closes the colony's core economic loop: extract → refine → **deliver to homes** → homes grow → more people. The
  Caesar III engine.

## Rules & data
- A **Housewares Market** covers homes within `marketRadius` (~8 cells). A staffed market with components in stock →
  covered homes are **wares-supplied**; with reels in stock too → **luxury-supplied**.
- It consumes a trickle of **components** as everyday wares delivered (and a little **reels** as luxury wares) each
  day — a real demand sink scaled to the homes it serves, capped by a per-market home limit (~8 homes).
- **Housing evolution (006/015):** reaching and holding the **top tier (T3)** now also requires **luxury wares** (a
  market in range + reels in stock). Everyday wares add a desirability / upgrade boost at the lower tiers. A home that
  loses its deliveries stops climbing and devolves after the usual grace.
- Housewares Market: build ~12 materials + ~6 components + a build crew of 3; run 2 (clerks/porters); light power draw
  (shuts in a brownout). *(Sella asked for an 8-strong crew — 2 clerks, 4 porters, 2 loaders; v1 uses the colony's
  standard 2-staff sizing — a bigger crew is a later refinement.)*
- **Testability / safety:** scope the new wares-gate so it ADDS to the top tier (and as a soft boost below), and
  update the small number of housing-evolution tests to stand up a market — so the founding path (raising homes,
  T1→T2 on water) does not silently break and the rest of the suite stays green.

## Cost — materials & labour
- To BUILD: treasury + ~12 materials + ~6 components + a 3-colonist build crew.
- To RUN: 2 colonists (clerks/porters) + a daily trickle of components (and reels for luxury wares) as the goods
  actually delivered. Without a market, manufactured goods never reach homes and the top housing tier cannot be held.

## Acceptance
- A fully-served, top-tier-ready home reaches and holds **T3** only when a staffed Housewares Market is in range AND
  the colony holds reels (luxury wares); cut the reels or the market and it slides back after the grace period.
- A market **draws down components (and reels)** as it delivers — a visible new demand on the goods chains.
- Homes out of every market's range never receive wares (delivery is spatial, like the Ration Depot).
- HUD shows housewares coverage. Tests: a market + reels lets a fully-served home reach T3; without it the home stalls
  below T3; the market consumes components/reels as it delivers; the founding economy and existing tests stay green
  (housing tests updated to stand up a market where needed).
