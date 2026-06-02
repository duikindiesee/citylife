# Spec 066 — The Greywater Reclaimer: get some of our own water back
- status: proposed
- proposed-by: Talla Venn, pipewright on the lower utility decks (kooker-codex, via the kooker choke point)
- date: 2026-06-02
- depends-on: 046 (Stored Water — the tanks this refills), 017 (Brownout Grid — it draws power and halves in a brownout), 062 (Labour Registry — the crew it must be staffed from), 065 (Deck Fires — the Fire-Watch barrels are one more draw on the tanks this eases)

## Why (the citizens' case)
Talla Venn works the pipes on the lower utility decks, and she watches good water go overboard every single day — every wash-basin, every galley drain, every cooling line throws usable water away in spirit. In a calm week nobody notices. But in a storm week, or a brownout, or a hot crowded Highsun when the greenhouses and the new Fire-Watch barrels are all pulling on the tanks at once, that waste hurts. Talla is not asking for new water from nowhere — the sky gives what it gives. She is asking for one humble plant that gets some of the colony's own water back: pay a couple of hands and some parts, run it on power, and a careful colony keeps a steadier tank through the lean stretches. It will not save a reckless colony that builds nothing and drinks everything. It just rewards a careful one.

## Mechanic
A new staffed **Greywater Reclaimer** returns part of the colony's daily used water back into **Stored Water** (spec 046). While it is built, staffed and powered, a share of the water the colony consumed that day is captured as **greywater** and treated back into the tanks at a real loss (two greywater make one clean unit — no magic). It is the water economy's first recycling loop: not a new source, just a careful colony getting its own back. It adds no sickness, smog, or unrest — only water. A colony that never builds one drinks and refills exactly as it does today.

In Landing One's aggregate water model, the colony's daily **water draw** (homes + staffed posts + the Fire-Watch barrels) is the greywater pool; the Reclaimer captures a fraction of it and returns a smaller fraction to the tanks, capped by its treatment capacity, its power, its filters, and the headroom left in the tanks.

## Rules & data

### Building: Greywater Reclaimer (engine kind `reclaimer`)
- A small utility plant: settling drums, filters, a treatment pump. **Logistics sector** (infrastructure, like the Maintenance Sheds and Storehouses).
- **Prerequisites to auto-raise:** stored-water tanks (a Cistern, spec 046), the power grid, and a Labour Registry (spec 062) so its crew is on the books.
- **Staffing:** 2 crew at full strength; 1 → half rate; 0 → idle.

### Greywater + treatment
- Each day, a share — about **half** — of the water the colony drew that day is available as **greywater** (untreated greywater is discarded at day's end; it is never stored).
- One Reclaimer treats up to **80 greywater per day** at a **2:1** loss, returning up to **40 stored water per day** to the tanks at full work.
- **Power:** draws ~**1 power** while running; if power is gone it stops, and in a brownout (spec 017) it runs at **half rate** (20 water/day).
- **Filters:** consumes **1 linen per 100 greywater treated** for filters; with no linen it still runs but at **half rate** until filters are supplied.

### Tank limit (no waste, no overfill)
- Returned water is capped by the tank headroom — if the tanks are full, the surplus is simply lost (no overflow).
- If the tanks are **above 95 percent** full, the Reclaimer **idles automatically** to save its filters (it only works when the water is actually wanted).

### Gentle defaults (inert by design)
- **No Reclaimer:** the colony draws and refills water exactly as today. Identical.
- **Unstaffed, unpowered, or tanks already full:** it returns nothing — no penalty, no side effect.
- It only ever **adds** water (capped, lossy, never overfilling); it can never reduce the tanks or any other stockpile, and it touches no signal but Stored Water.

## Cost — materials & labour
**To build (one plant):**
- 45 materials
- 14 components
- 3 tool-kits (spec 047 — pump and seal fittings)
- 2 reels (spec 013 — gasket stock)
- Labour: **4 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per plant):**
- **2 Logistics crew** at full strength (1 → half, 0 → idle).
- **~1 power** while running (sheds in a brownout, which halves it).
- **1 linen per 100 greywater treated** for filters (half rate without); a tool-kit a season for pump upkeep (deferred to keep the slice small).

## Acceptance
**Tests (tests/economy.test.ts):**
- **Inert without a Reclaimer:** a colony's stored water rises and falls exactly as today — no extra water appears.
- **Returns water when staffed + powered:** a colony with water draw, a staffed, powered Reclaimer, and tank headroom gains stored water over a run, bounded by the 40/day treatment cap.
- **Brownout / no-filter halves it:** the same Reclaimer in a brownout (or with no linen) returns at half rate.
- **Never overfills, idles near full:** the Reclaimer never pushes stored water above the tank cap, and idles (returns nothing) when the tanks are above 95 percent.
- **Water-only, never negative:** the Reclaimer changes no food/health/unrest signal and can only ever add water (never reduces the tanks or any stockpile below zero).

**Live on :5188:**
- With a staffed, powered Reclaimer and a colony drawing water with tank headroom, a **Reclaim** row appears in the HUD (plants + water/day returned) and the stored-water tank ticks up faster than it would without one; force a brownout and the return halves.
- No Reclaimer → no Reclaim row and the water economy is exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
