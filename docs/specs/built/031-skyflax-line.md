# Spec 031 — The Skyflax Line: a second resource, a second chain

- status: proposed
- proposed-by: **Mara Venn, rim-tether winchhand on the blue-dawn shift, Landing One** — **LIVE Hermes** (model hermes-codex-gpt-5.5). Mara Venn returns — the colony's most prolific founder-voice, now working the rim tethers — with the colony's first PARALLEL production line. Opens a fresh dimension: a second raw resource and goods chain, making the economy a web instead of a single line.
- date: 2026-06-02
- depends-on: 003, 006

## Why (the citizens' case)

Mara Venn: _"Right now every industry begins in the mines, so a materials shortage strangles the whole colony. Skyflax
gives Landing One a true second production line: edge-gathering into weaving, not mining into components. If the rims
are going to snag cloudweed anyway, we may as well turn it into sheets before folk start sleeping on ration sacks."_

## Mechanic

- A new raw resource, **skyflax fibre** — a tough reed-fibre the island's lower rims snag from the cloudweed mats. It
  comes from nowhere near the mines: a genuinely **second resource**.
- A new chain, parallel to mining:
  - **Flax Skimmer Dock** — a staffed extractor that gathers **fibre** (as a mine gathers materials). Best raised on
    the island's rim.
  - **Weavery** — a staffed refinery that weaves **fibre into linen bolts** (as a workshop refines materials into
    components), a 2:1 conversion that halts when fibre runs out.
- A new good, **linen bolts**, with real demand:
  - **Housing** needs linen to climb and hold a tier — folk want sheets, not ration sacks.
  - **Clinics** consume a little linen as bandage cloth, more so during a **fever outbreak** (026) — the sick need dressings.
- The point is **balance**: planners must now choose between staffing mines or skimmers, hauling components or fibre,
  and feed homes with more than one kind of made good. A materials shortage no longer strangles everything — but a
  fibre shortage now bites too.

## Rules & data

- **Skyflax fibre** and **linen** are new stockpiles (capped by storage, 023, and never negative). A **Flax Skimmer
  Dock** produces fibre while staffed (≈ a mine's rate); a **Weavery** consumes fibre and produces **linen** (2:1)
  while staffed, halting when fibre runs out.
- **Demand:** housing needs **linen on hand** to climb and hold a tier (alongside its existing needs); clinics draw a
  small **linen upkeep**, rising during a fever outbreak.
- Flax Skimmer Dock: build ~8 materials + a build crew of 3; run 2 skimmers. Weavery: build ~10 materials + ~4
  components + a build crew of 3; run 2 weavers. _(Mara asked for 4-skimmer / 6-weaver crews and rim-only placement; v1
  uses the colony's standard 2-staff sizing and places like any building — rim-only docks and bigger crews are a later
  refinement.)_
- The colony raises a Skimmer Dock when fibre runs low and a Weavery when fibre is plentiful, gated on labour +
  materials, just like the mine and workshop.
- **Testability / safety:** scope the linen housing-demand so the **founding path is unchanged** (raising homes, the
  base tier) — gate a single named tier on linen and update that tier's small set of tests to supply linen, exactly as
  the Housewares Market (027) did for the top tier; or, if cleaner, deliver linen as a comfort bonus rather than a hard
  gate. With no Weavery and no linen demand reached, the mechanic is inert and existing tests stay green.

## Cost — materials & labour

- To BUILD: a Flax Skimmer Dock (~8 materials + a 3-colonist crew) and a Weavery (~10 materials + ~4 components + a
  3-colonist crew).
- To RUN: 2 skimmers + 2 weavers; and the colony now spends **fibre** to weave linen, and **linen** to climb homes and
  dress the sick. Without the Skyflax Line, the linen-gated housing tier stalls and clinics run short of cloth in an
  outbreak.

## Acceptance

- A Flax Skimmer Dock produces skyflax fibre while staffed; a Weavery turns fibre into linen (2:1) and halts when fibre
  runs out.
- A home reaches/holds its linen-gated tier only when the colony has linen (plus its existing needs); without linen it
  stalls below that tier. The founding path (raising homes) is unchanged.
- Clinics draw a little linen, more during a fever outbreak.
- Both new goods are capped by storage (023) and never go negative.
- HUD shows the fibre + linen stockpiles. Tests: the dock makes fibre; the weavery makes linen and stops without fibre;
  the gated tier needs linen; clinic linen upkeep rises in an outbreak; the founding economy and existing tests stay
  green (the affected tier's tests updated to supply linen).
