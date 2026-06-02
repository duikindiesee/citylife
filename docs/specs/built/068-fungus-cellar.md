# Spec 068 — The Fungus Cellar: a third food the dark decks can grow
- status: built — slice 63 (mechanics/dev, PR #26); duskcap third food, power-resilient non-seasonal Fungus Cellar, eaten as a third protein course and counted as a varied-table dish; 434 tests pass, verified live on 5188
- proposed-by: Wren Solano, cellar-keeper and fungus-grower on the lower under-decks (claude — council fallback; the kooker inference quota was exhausted this tick, so the council wrote in-character)
- date: 2026-06-02
- depends-on: 056 (Rimfish — the second food this joins), 060 (the Variety Ration Counter — the varied table a third dish deepens), 046 (Stored Water — the cellars need a little moisture), 054 (Mild Seasons — duskcap is the food the seasons cannot touch)

## Why (the citizens' case)
Wren Solano keeps the dark under-decks where no skyfarm light reaches and the air sits cool and damp, and she will tell you what those wasted decks could be: a third dish on the table. Landing One eats greens from the skyfarms and rimfish off the rim, and the new ration counters reward a household that eats both — but two dishes is a thin table, and on the old Earth a proper house needed several. More than that, both of the colony's foods are fragile in their own way: the greens dip in a lean Frost, and the rim nets fall idle in a storm or a brownout. Wren grows **duskcap**, a hardy fungus that asks for nothing the colony cannot always give — no sunlight, no season, barely any power, just a cool dark deck and a trickle of water. It is the food that keeps coming when the light fails and the nets hang slack. She wants the council to let the under-decks earn their keep: a quiet cellar, a few growers, and a third food the colony can lean on when the others falter.

## Mechanic
A new staffed **Fungus Cellar** grows **duskcap**, the colony's third food, on the cool dark lower decks. Duskcap is a hardy, low-input food: it needs no sunlight (no skyfarm season touches it, spec 054), draws only a little water, and carries no heavy power load — so it keeps growing through a lean Frost, a storm, or a brownout, exactly when the greens dip and the rim nets fall idle. The homes eat it as a third dish alongside greens and rimfish; it spares the other foods the way rimfish already spares skygrain, and it counts as a varied-table dish for the Variety Ration Counter (spec 060), so a colony whose rim nets fail can still keep a Varied Diet on greens + duskcap. A colony that never builds a Cellar eats exactly as it does today.

## Rules & data

### Building: Fungus Cellar (engine kind `cellar`)
- A cool dark grow-deck: stacked beds, a damp-line, spore trays. **Food sector** (it competes with the skyfarms and net docks for food labour).
- **Prerequisites to auto-raise:** an established colony and a stored-water tank (a Cistern, spec 046) for the damp-line.
- **Staffing:** standard food-sector crew; understaffed cellars grow proportionally less.

### Growth + storage
- A fully-staffed Cellar grows **duskcap** at a modest, steady rate (suggest **5 duskcap/day** per Cellar) — like a Net Dock, not subject to the skyfarm seasons (spec 054), and with only a **small water draw** (suggest **1 water/day**) and a **light power load** (it is a dark cellar, not a lit greenhouse), so it keeps producing in a brownout where the greenhouses falter.
- **Duskcap** is a new stored good, banked in the ordinary Storehouse Platforms (spec 023): base cap **80**, plus **80 per Storehouse**, clamped like every stockpile.

### Eating (foodStep extended, spec 056)
- The day's meals draw the **fish/protein portion** from rimfish (or dried rimfish) first, then fall back on **duskcap**, then on skygrain — so a colony short on fish keeps the meal whole on the cellar's harvest. Duskcap thus **spares** the other foods, deepening the colony's calorie resilience.
- For the **Variety Ration Counter** (spec 060): duskcap counts as a non-greens varied-table dish like rimfish, so a household eating greens + duskcap (when fish runs short) still earns a Varied Diet. (A small extra bonus for a genuine THREE-dish table — greens + fish + duskcap together — is noted as a gentle deepening the build may add.)

### Gentle defaults (inert by design)
- **No Cellar:** duskcap stays 0 and the food + diet math is exactly today's (spec 056/060). Identical.
- Duskcap is a pure, additive food source: it only ever **adds** a third food and a little resilience; it never reduces any stockpile (beyond its own small water draw) and touches no other signal.
- Unstaffed or unpowered enough, a Cellar simply grows less — no penalty.

## Cost — materials & labour
**To build (one Cellar):**
- 30 materials
- 6 components
- 1 tool-kit (spec 047 — the bed frames and damp-line fittings)
- Labour: **4 builders** for the construction job (gated on labour + materials like every Landing One build — no timer pop-up).

**To run (ongoing, per Cellar):**
- **Food-sector crew** (suggest **3 growers**); understaffed, it grows proportionally less.
- **~1 stored water per day** (spec 046) for the damp-line, and a **light power load** for the fans.

## Acceptance
**Tests (tests/economy.test.ts):**
- **Inert without a Cellar:** duskcap is 0 and the colony's food + Varied-Diet behaviour is exactly spec 056/060 — existing food tests unchanged.
- **Grows a third food:** a staffed, watered Cellar banks duskcap over a run, bounded by the daily cap and its storehouse-scaled storage cap; it grows even out of the skyfarm season (unlike greenhouses).
- **Spares the other foods:** with duskcap on hand and the rim nets idle, the homes eat duskcap for the protein course, so skygrain and the fish stores fall slower than they would without it.
- **Keeps the diet varied:** a colony with a Variety Counter, greens, and duskcap (no fresh rimfish) still reads a Varied Diet — duskcap counts as the varied dish.
- **Capped + never negative:** duskcap never exceeds its cap and never goes below zero; building a Cellar reduces no other stockpile beyond its small water draw.

**Live on :5188:**
- With a staffed, watered Fungus Cellar, a **Duskcap** row appears in the HUD (stock) and the banked count climbs even in a brownout or a Frost season; draw the rim nets down and the homes keep eating from the cellar.
- No Cellar → no Duskcap row and the colony plays exactly as before.
- `npm run typecheck` and `npm test` both pass; no regression in the live readout or console.
