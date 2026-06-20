# Spec 046 — Stored Water: the sky can deny the colony its tanks

- status: built — slice 41, shipped to mechanics/dev. Engine in src/colony/build.ts (the water good + tank, the cistern building, waterTankCap, waterSupplyFactor coupling wateredFraction, waterStatus, and waterStep that condenses + draws water and applies dry-tank fever/unrest), the water state field in sim.ts, knobs in config.ts, the water uiState in runtime.ts, a HUD Water row in ColonyApp.tsx, and five tests in tests/economy.test.ts. A freshly built cistern starts its tank charged so it never crashes water on construction day. With no cistern the supply factor is 1 so wateredFraction is exactly today — the autonomous economy + smoke test stayed green. typecheck clean and all 323 tests pass; live on :5188 a full tank held water coverage at 100% and a dry tank dropped it to the 30% floor. The Cloudsea-front intake cut is a flagged later refinement (brownout already cuts production via powerFactor).
- proposed-by: **Halric Voss, cistern keeper and founding deckhand of Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Halric Voss joins the roster of system-authors and names the one need the colony never has to _fear_: water is a promise on the map, not a thing the sky can take away.
- date: 2026-06-02
- depends-on: 005, 017

## Why (the citizens' case)

Halric Voss: _"We have water as a promise on the map, not as something the sky can deny us. A floating colony should fear dry tanks during heat, storms, brownouts, or bad staffing as much as it fears debt."_

Every other input can run short — materials, food, reels, linen, power — but **water cannot**: it is pure coverage, a Water Hub in range and the home is watered forever, free and infinite. A floating colony hanging in the cloudsea, of all places, should have to _make_ its water and watch the tanks. Water is the last free thing.

## Mechanic

- A new building, the **Mist Condenser Cistern** — it draws passing cloud-mist into a tank as stored **water units**. Once built and **staffed**, each cistern consumes **grid power** and free-colonist labour to condense water into the colony's tank, up to a fixed capacity.
- Once **any cistern exists**, water becomes a **stored, consumed resource**: the colony's Water Hubs (005) draw from the tank to serve homes. While the tank holds water, coverage is as strong as ever; if the **tanks run dry**, water coverage **weakens**, and the homes it can no longer reach gain **fever (026)** and **unrest (028)** pressure — thirst is the oldest emergency.
- **Tied into power + risk:** a **brownout (017)** slows or halts the condensers (they are heavy draw), and a **Cloudsea Front (034)** cuts their mist intake for a spell — so a colony that lets its power or its skies go untended can be squeezed dry.
- **Inert until built:** with **no cistern**, nothing changes — water stays the free, infinite coverage it is today, and existing play and tests are unchanged. The fear only begins when the colony chooses to make its water real.

## Rules & data

- A new stored good, **water** (units), with a tank capacity (the cisterns' combined tanks; suggest a base per cistern, raisable). Default 0; only ever non-zero once a cistern stands.
- A built + staffed cistern produces `waterPerDay × staffing × powerFactor` water into the tank (capped), and is cut by a Cloudsea Front for its duration. Condensing **consumes grid power** (a `powerLoad`), so it competes on the brownout grid.
- **Coupling (only when ≥1 cistern exists):** effective water coverage = the current Water-Hub coverage × a **supply factor** that is 1 while the tank has water and falls toward a floor as the tank empties (homes draw the tank down over time). With the tank full, homes are watered exactly as today; with it dry, coverage drops to the floor.
- **Dry-tank pressure:** while the tank is dry and cisterns exist, add a small daily **fever** and **unrest** pressure scaled by how many homes lost water — a real emergency, not a silent stat.
- **Test-safety (load-bearing):** with **no cistern**, `wateredFraction` and every downstream factor are computed exactly as today (the supply factor is 1, no draw, no pressure), so the suite and current water behaviour are unchanged. Water only becomes scarce-able once a cistern is built.

## Cost — materials & labour

- To BUILD: treasury + **~18 materials + ~4 components + a build crew of ~4** free colonists. A squat condenser and its tank.
- To RUN: **a staff of free colonists** (Halric asked for 6 tank-keepers; v1 maps it to the colony's scale — a few hands) plus **grid power**. Understaffed or browned-out, it condenses less and the tank can run dry. It is the first building whose _failure_ takes a basic need away — water must now be made and minded, not assumed.

## Acceptance

- With a built, staffed Mist Condenser Cistern, the colony **accumulates stored water**; its Water Hubs draw on the tank, and homes stay watered while it holds. Brownouts and Cloudsea Fronts cut condenser output.
- If the tank **runs dry** (overbuilt homes, lost power, a storm, or no staff), water coverage **weakens** and the affected homes gain fever + unrest pressure — and recovers when the tank refills.
- With **no cistern**, water is the free infinite coverage it is today and nothing changes (inert) — the suite stays green.
- The HUD shows the **water** tank (units / capacity) and any dry-tank warning; tests cover a staffed cistern filling the tank, homes drawing it down, coverage weakening when dry, the brownout/front cuts, and full inertness with no cistern.
