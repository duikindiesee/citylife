# Spec 019 — Smog Drift + Air Scrubber Gardens: dirty growth has a civic price

- status: built
- proposed-by: **Jalen Orro, terrace farmer (Ring 3)** — **LIVE Hermes** (model hermes-codex-gpt-5.5). A NEW voice at last — the council's first proposal not from Mara Venn in four ticks. Opens a fresh dimension: pollution.
- date: 2026-06-02
- depends-on: 002, 013, 011, 015

## Why (the citizens' case)

Jalen Orro: _"I grow on the terraces downwind of the foundries, and I'll tell you — the smog settles on the
homes, the clinics fill, and the finest houses won't hold their tier under a grey sky. Industry's worth
keeping, but dirty growth should cost us something civic. Let me plant **Air Scrubber Gardens** — green
filters that clear a district and make it pleasant besides. Put your mines away from your homes, or pay to
clean the air."_

## Mechanic

- **Smog drift**: mines and foundries (heavy industry) foul the air around them. A home within
  `smogRadius` of a mine or foundry is **polluted** — unless an Air Scrubber Garden covers it.
- A **polluted home** suffers: its **liveability drops** (it shows warmer on the map, 011), and it
  **cannot reach or hold the top housing tier** (015) — a place choking on smog doesn't "want for nothing."
- New building **Air Scrubber Garden**: a green filter that **clears the smog** for every home within
  `scrubberRadius`, so a well-placed garden lets industry and housing coexist.
- The lesson is spatial: keep the mines and foundries away from your homes, or build gardens to clean the
  air. Placement finally matters.

## Rules & data

- `smogRadius` ≈ 6: a home within this of a mine or foundry is polluted, **unless** within `scrubberRadius`
  (~8) of an Air Scrubber Garden.
- Liveability: a polluted home's score drops by a **pollution penalty** (~0.3), so the survey map (011)
  paints smoggy districts warmer.
- Top tier: `fullyServed` (015) now **also requires not-polluted** — a polluted tier-3 home devolves until
  the air clears.

## Cost — materials & labour

- **Air Scrubber Garden**: BUILD treasury + **~12 materials + ~8 components** + a 3-colonist crew; RUN
  **~1 component/day** + its gardeners. Clears `scrubberRadius` of smog. (Jalen said 40 materials + 12
  labour; scaled to CityLife.)
- The smog rule itself is free — it's the physics of industry. The real cost is the gardens you raise (or
  the land you leave between your mines and your homes).

## Acceptance

- A home near a mine or foundry is polluted (lower liveability) unless an Air Scrubber Garden covers it.
- A polluted home **cannot reach the top tier**; a scrubber garden clears the air so it can.
- The liveability map / a HUD indicator reflects smoggy homes.
- Tests: a home beside a mine is polluted; a scrubber clears it; a polluted home is blocked from Tier 3;
  its liveability is lower than a clean equivalent.
