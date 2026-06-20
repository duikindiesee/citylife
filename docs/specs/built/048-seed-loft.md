# Spec 048 — The Seed Loft: food should not grow from bare deck-plating

- status: built — slice 43, shipped to mechanics/dev. The seed good and the seedStep maker-and-drawer live in src/colony/build.ts, alongside the Seed Loft building, seedSupplyFactor (folded into the skyfarm food yield in foodStep next to the tool and water factors), seedStockCap, seedStatus for the HUD, the charged-on-build clause, the soft water coupling (the loft draws the tank only when cisterns stand), and a conservative auto-build gate behind a skyfarm and a comfortable food surplus. The seed state field is in sim.ts, the knobs in config.ts, the seed uiState in runtime.ts, a HUD Seed row in ColonyApp.tsx, and five tests in tests/economy.test.ts. Inert with no loft (the seed factor is exactly 1), so the autonomous food economy and every prior test stayed green. typecheck clean and all 333 tests pass; live on :5188 a full bin read 80 of 80 and a dry bin flipped the short warning at 0 of 80, with the real colony holding no loft (zero impact on live play).
- proposed-by: Mara Venn, skyfarm hand (hermes-codex-gpt-5.5, via the kooker choke point)
- date: 2026-06-02
- depends-on: 007 (skyfarm food), 008 (ration depot), 046 (stored water, soft), 023 (finite storage)

## Why (the citizens' case)

Mara Venn has worked the trays long enough to resent the magic in them: a greenhouse is staffed, the sun comes up, and food simply appears from bare deck-plating, harvest after harvest, with nothing ever going in. The colony now manages tools, water, labour, storage and rations as real, finite things — but the most basic input of all, the seed, is still free and infinite. Save a little grain from each harvest, dry it, keep it in a loft, and you can plant again; waste it and the next planting is thin. The Seed Loft turns farming into a proper input chain, so bad planning bites at the seed bin before it ever becomes a famine.

In Mara's words: food should not grow from bare deck-plating forever. The Seed Loft is the missing link that feeds the skyfarms what they need to keep yielding.

## Mechanic

- A staffed **Seed Loft** turns saved harvest into **seed-stock**, held as a new colony stock (`seed`). Mara's recipe: **2 food + 1 water becomes 3 seed-stock**.
- Once **at least one Seed Loft stands**, the colony's **skyfarms draw seed-stock** as they grow. A **well-stocked** seed bin lets them yield at **full — exactly as today**; a **drained** bin drops every skyfarm's yield **together** toward a **50% floor** (Mara's half-yield): thin seed, thin harvest.
- **Inert by default (load-bearing):** with **no Seed Loft built**, there is **no seed demand at all** and the seed-supply factor is **exactly 1**. The existing food economy — and every existing test — is unchanged until the colony chooses to keep its own seed. This mirrors Stored Water (046) and the Tool Crib (047), which stay neutral until their first building stands.
- **Soft water coupling:** the loft's 1-water input is drawn from the **stored water tank only when cisterns exist** (046). With no cistern, water is still the free coverage it has always been, so the loft simply runs on food — the Seed Loft never hard-depends on having built a cistern first.
- A **freshly built** Seed Loft starts its bin **partly charged**, so raising one never instantly halves the harvest on construction day (the same courtesy water and tools give in 046 and 047).

## Rules & data

- New good **`seed`** (seed-stock): a colony stock with a flat capacity `seedStockCap = 80`, clamped `[0, cap]`. Starts at 0.
- **Seed Loft production** (per in-game day, scaled by staffing fraction x power factor x a daily-step fraction): converts up to `seedLoftBatchesPerDay = 2` batches, each batch consuming **2 food + 1 water** and yielding **3 seed-stock** (`seedPerBatch = 3`). So a fully-staffed, powered loft makes up to 6 seed/day from 4 food + 2 water. It is limited by the food on hand, the water on hand (when stored water is real), and the seed headroom; it stops drawing inputs once the bin is full.
- **Seed demand** (per in-game day): each working skyfarm consumes `seedUsePerFarmPerDay = 0.8` seed-stock, scaled by the colony's working fraction. Total daily draw = (working skyfarms) x 0.8, clamped to the bin.
- **`seedSupplyFactor(state)`**: returns **1** when `countKind(Seed Loft) === 0` (inert). Otherwise `seedFloor + (1 - seedFloor) * min(1, seed / seedComfortBuffer)` with `seedFloor = 0.5` and `seedComfortBuffer = 12`. So a bin at or above 12 seed → factor 1 (no change vs today); an empty bin → 0.5.
- This factor **multiplies the skyfarm food yield** (and nothing else) — it sits in `foodStep` next to the existing staffing/power/water factors, so a colony that keeps its lofts fed sees no penalty; the constraint only bites when the seed bin runs dry.
- **Bootstrap note (intended, not a bug):** the loft consumes food to make the seed that the farms need to make food. The 50% floor guarantees the loop always recovers — half-fed farms still grow, which still refill the loft. The loft's draw (a few food per day) is small against a colony's harvest; the point is that careless food management now costs a slice of the next harvest.
- **Charged on build:** when a Seed Loft finishes construction, add `seedStartCharge = 0.6 * seedStockCap` to `seed` (clamped to cap).
- **Auto-build gate (conservative):** the loft is only chosen by `chooseArtifact` once the colony is past a small size threshold, is not in brownout, already has a skyfarm, holds a **comfortable food surplus** (so building it never tips a food-marginal colony), has spare components on hand, and holds fewer lofts than `ceil(skyfarms / 6)` — so short smoke tests never spontaneously raise one and halve the harvest.

## Cost — materials & labour

- **Build:** **8 materials + 4 components** (Mara's figure — a small timber-and-glass loft).
- **Labour:** **2 free colonists** to staff; an understaffed loft dries less seed.
- **Power:** a light load `seedLoftPowerLoad = 0.3` (drying racks and fans; a brownout slows it via the shared power factor).
- **Runs on:** up to 4 food + 2 water per day, returned to the colony as seed-stock for the skyfarms.

## Acceptance

How Review & Build verifies it:

- `npm run typecheck` clean and `npm test` fully green, with new tests covering:
  1. **Inert:** with no Seed Loft, `seedSupplyFactor === 1` and skyfarm food output equals its pre-048 baseline (the food economy is unchanged).
  2. **Healthy bin:** a Seed Loft plus a full seed bin keeps `seedSupplyFactor === 1` and leaves food output at baseline.
  3. **Drained bin:** a Seed Loft with an empty bin drives `seedSupplyFactor` to the 0.5 floor and scales skyfarm food output down to roughly half.
  4. **Production:** a staffed, powered Seed Loft draws food (and water when cisterns stand) and raises the seed bin over several days, capped at `seedStockCap`.
  5. **Charged on build:** completing a Seed Loft leaves the bin at roughly `seedStartCharge`, so the harvest is not halved on construction day.
- On the live game (:5188): grow the colony until a Seed Loft is built; a **Seed** HUD row shows `bin / cap`; deliberately draining the bin visibly cuts skyfarm food output toward the floor, and refeeding food restores full yield.
