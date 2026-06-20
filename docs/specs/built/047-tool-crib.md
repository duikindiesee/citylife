# Spec 047 — The Tool Crib: bare hands do not mine forever

- status: built — slice 42, shipped to mechanics/dev. The tools good and the toolStep maker-and-drawer live in src/colony/build.ts, alongside the Tool Crib building, toolSupplyFactor (folded into the mine, workshop, skyfarm, maintenance and turbine outputs), the waterTankCap-style toolStockCap, toolStatus for the HUD, the charged-on-build clause, and an auto-build gate behind a mine and a workshop. The tools state field is in sim.ts, the knobs in config.ts, the tools uiState in runtime.ts, a HUD Tools row in ColonyApp.tsx, and five tests in tests/economy.test.ts. Inert with no crib (the tool factor is exactly 1), so the autonomous economy and every prior test stayed green. typecheck clean and all 328 tests pass; live on :5188 a full rack read 120 of 120 and a dry rack flipped the short warning at 0 of 120, with the real colony holding no crib (zero impact on live play).
- proposed-by: Mara Venn, storehouse tally-clerk (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 001 (materials + labour), 002 (the mine), 003 (workshop -> components)

## Why (the citizens' case)

Mara Venn keeps the storehouse tallies, and the same line nags her every day: components come in, components sit. Today a component is spent once when a building goes up, and after that the shelves just grow while the mines, the workshops, the skyfarms, the maintenance crews and the new turbines all work with bare hands, forever, at full speed. That is not how Landing One was built. Ore does not lift itself; a turbine blade does not re-seat without a wrench. The colony needs a steady, internal use for components before exports and luxuries tempt the council to drain the shelves down to nothing. Give the hands tools, and give the tools a cost.

In Mara's words: bare hands should not mine ore, mend turbines, or harvest skygrain forever. The Tool Crib is the missing link that turns a finished component into everyday working kit.

## Mechanic

- A staffed **Tool Crib** converts **components into tool-kits**, held as a new colony stock (`tools`). Mara's recipe: **1 component becomes 4 tool-kits**.
- Once **at least one Tool Crib stands**, the colony's **tooled workplaces** draw tool-kits while they work. Tooled workplaces are: the materials **mine**, the **workshop**, the **skyfarm**, the **maintenance shed**, and the **wind-shear turbine**.
- A **well-stocked** tool supply lets those workplaces run at **full output — exactly as today**. A **drained** tool stock weakens their output **together** toward a **50% floor** (Mara's number): bare-handed work is half-speed work.
- **Inert by default (load-bearing):** with **no Tool Crib built**, there is **no tool demand at all** and the tool-supply factor is **exactly 1**. The entire existing economy — and every existing test — is unchanged until the colony chooses to industrialise its tools. This mirrors how Stored Water (046) stays neutral until the first cistern.
- A **freshly built** Tool Crib starts its stock **partly charged**, so raising one never instantly halves output on construction day (same courtesy the cistern gives water in 046).

## Rules & data

- New good **`tools`** (tool-kits): a colony stock with a flat capacity `toolStockCap = 120`, clamped `[0, cap]`. Starts at 0.
- **Tool Crib production** (per in-game day, scaled by staffing fraction x power factor x a daily-step fraction):
  - draws up to `toolCribComponentsPerDay = 2` components from the colony,
  - yields `toolKitsPerComponent = 4` tool-kits per component actually drawn (so up to 8 tool-kits/day at full staffing and power),
  - never overfills past `toolStockCap`; stops drawing components once the stock is full.
- **Tool demand** (per in-game day): each tooled workplace that is actually working consumes `toolUsePerWorkplacePerDay = 0.6` tool-kits, scaled by that workplace's own working fraction. Total daily draw = (number of working tooled workplaces) x 0.6, clamped to the stock on hand.
- **`toolSupplyFactor(state)`**: returns **1** when `countKind(Tool Crib) === 0` (inert). Otherwise `toolFloor + (1 - toolFloor) * min(1, tools / toolComfortBuffer)` with `toolFloor = 0.5` and `toolComfortBuffer = 16`. So a stock at or above 16 kits -> factor 1 (no change vs today); an empty stock -> 0.5.
- This factor **multiplies the output** of every tooled workplace in the same way (one shared factor, applied to: mine ore yield, workshop component yield, skyfarm food yield, turbine power, and maintenance shed effectiveness). Because the factor is 1 whenever the stock is healthy, a colony that keeps its cribs fed sees no penalty — the constraint only bites when tools run dry.
- **Bootstrap note (intended, not a bug):** the crib consumes components, and the workshop that makes components is itself tooled. The 50% floor guarantees the loop can always recover — a tool-starved workshop still makes half its components, which still feed the crib back toward full. This is the foundational tension Mara is asking for, not a deadlock.
- **Charged on build:** when a Tool Crib finishes construction, add `toolStartCharge = 0.6 * toolStockCap` to `tools` (clamped to cap).
- **Auto-build gate:** the crib is only chosen by `chooseArtifact` once the colony is past a small size threshold, is not in brownout, already has a mine and a workshop, has spare components on hand, and holds fewer cribs than `ceil(tooledWorkplaces / 6)` — so short smoke tests never spontaneously raise one and halve output.

## Cost — materials & labour

- **Build:** **18 materials + 6 components** (Mara's figure).
- **Labour:** **2 free colonists** to staff; understaffed cribs produce proportionally fewer tool-kits.
- **Power:** a small bench load `toolCribPowerLoad = 0.6` (brownout slows tool-kit output via the shared power factor).
- **Runs on:** up to 2 components/day, converted to tool-kits for the whole extraction-and-production base.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green, with new tests covering:
  1. **Inert:** with no Tool Crib, `toolSupplyFactor === 1` and mine/workshop/skyfarm outputs equal their pre-047 baseline (the economy is unchanged).
  2. **Healthy stock:** a Tool Crib plus a full tool stock keeps `toolSupplyFactor === 1` and leaves those outputs at baseline.
  3. **Drained stock:** a Tool Crib with an empty stock drives `toolSupplyFactor` to the 0.5 floor and scales the tooled outputs down together.
  4. **Production:** a staffed, powered Tool Crib draws components and raises the tool stock over several days, capped at `toolStockCap`.
  5. **Charged on build:** completing a Tool Crib leaves the stock at roughly `toolStartCharge`, so output is not halved on construction day.
- On the live game (:5188): grow the colony until a Tool Crib is built; a **Tools** HUD row shows `stock / cap`; deliberately draining the stock visibly slows mine and workshop output toward the floor, and refeeding components restores full speed.
