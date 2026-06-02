# Spec 061 — Rimfish Drying Racks: bank the second food for a lean season
- status: proposed
- proposed-by: Soren Hale, rim-net mender and fish-drier (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 056 (Rimfish — the fresh food this preserves), 031 (Linen — the rack lines and wrapping), 047 (Tool-kits — the knives the racks need), 023 (Storehouse Platforms — where the dried fish is banked), 054 (Mild Seasons — the lean Frost this insures against), 060 (the Variety Ration Counter — dried fish counts as the fish food for a varied diet)

## Why (the citizens' case)
Soren Hale mends the rim nets and, on the slow days, sweeps good rimfish scales off the storehouse planks. The colony pulls fine fish off the cloudsea and then just piles it as if the seasons will never turn mean and the net docks will never go dark. They do both. When a Cloudsea Front rolls in, or the grid browns out, or the dock crews are pulled to other work, the fresh fish stops coming and the stockpile drains in days — and with it goes the varied table the homes only just learned to expect. Soren wants a proper preserving line: dry the surplus catch on good net-days into something shelf-stable that keeps for the lean stretch. It gives steady work to hands that would otherwise stand about between hauls, and it turns the second food from a day-to-day ration into a reserve the colony can actually lean on.

## Mechanic
A new staffed worksite, the **Rimfish Drying Rack**, turns **surplus fresh rimfish** (plus linen for the lines and wrapping, spent when the rack is built) into **dried rimfish** — a shelf-stable food banked in the ordinary storehouses. Dried rimfish counts as the colony's fish food: when the homes have eaten through the fresh catch, they fall back on the dried reserve, so fish stays on the table — and the diet stays varied (spec 060) — straight through a net-dock outage or a lean season. A rack only ever consumes the fresh fish **above a working reserve**, so it never takes a meal the homes need today; it banks the genuine surplus.

This is the colony-aggregate adaptation of Soren's per-rack proposal: rather than per-building input/output bins, each rack draws from the colony's rimfish stock (above the reserve) and adds to a colony dried-rimfish stock, exactly as the Weavery and the refineries already convert one aggregate good into another.

## Rules & data

### Building: Rimfish Drying Rack (engine kind `dryrack`)
- A small preserving line: slatted racks, hooks, drying cords, a cleaning board.
- **Sector:** Industry (it is a refining/preserving worksite, like the Weavery and the workshops).
- **Staffing:** 2 workers at full rate; 1 worker at half rate; 0 workers idle (the colony-wide Industry staffing fraction already models this).
- Carries a small power load while operating and sheds first in a brownout (spec 017).

### Conversion (per rack, per day, at full staffing × power)
- Consumes up to **12 fresh rimfish**, but only the surplus **above a working reserve of 20 rimfish** — so a colony short on fresh fish dries nothing and the homes keep every meal.
- Produces **8 dried rimfish** (a real trimming/weight loss — no magic barrel-stuffing).
- Stops when the colony's dried-rimfish store is at its cap (storage headroom gates it, like every other good).

### Storage
- **Dried rimfish** is a new stored good, banked in the ordinary Storehouse Platforms (spec 023): base cap **40**, plus **40 per Storehouse**. It is clamped to that cap like every stockpile.

### Eating rules (spec 056 extended)
- The day's fish meals draw **fresh rimfish first, then dried rimfish** — so the dried store accumulates as a reserve and is only spent once the fresh catch is gone.
- Dried rimfish counts as the **fish food** for the Variety Ration Counter (spec 060): a colony eating greens + dried rimfish still keeps a Varied Diet through a fresh-fish outage.
- With no rack and no dried store, the fish meal math is exactly today's (spec 056) — inert.

## Cost — materials & labour
**To build (one rack):**
- 40 materials
- 16 components
- 4 tool-kits (spec 047 — the drying knives and rack fittings)
- 8 linen (spec 031 — the drying lines and wrapping cloth, spent up front for the rack and its first run of lines)
- Labour: **4 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per rack):**
- **2 staffed crew** (Industry sector). Below 2 it runs at half rate; at 0 it is idle.
- A small power load (**~0.4**) on the brownout priority grid while operating.
- (Soren also asked for a slow slats-and-knives upkeep — a material every few days, a tool-kit a season. Deferred to keep this slice small; the dominant gates are crew, power, and a fresh-fish surplus.)

## Acceptance
**Tests (tests/economy.test.ts):**
- **Inert without a rack:** a colony netting and eating rimfish with no Drying Rack shows dried rimfish 0 and the exact spec-056 fish-meal behaviour — existing rimfish tests unchanged.
- **Dries only the surplus:** a staffed, powered rack with fresh rimfish above the reserve banks dried rimfish over a run; a rack with fresh rimfish at or below the reserve dries nothing (the homes keep their fish).
- **Conversion loss:** dried rimfish produced is less than fresh rimfish consumed (8 per 12), never more.
- **Reserve insurance:** a colony with a dried store whose fresh rimfish then runs out (net docks idle) still serves fish meals from the dried reserve, and a Variety Ration Counter still reads a Varied Diet until the dried store is gone.
- **Capped + never negative:** dried rimfish never exceeds its storehouse-scaled cap and never goes below zero.

**Live on :5188:**
- With a staffed Drying Rack and a fresh-fish surplus, a **Dried fish** row appears in the HUD and the banked count climbs; draw the fresh rimfish to zero and the dried reserve falls as the homes eat it.
- No rack → no Dried fish row, and the colony plays exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
