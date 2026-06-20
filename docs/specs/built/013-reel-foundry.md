# Spec 013 — Reel Foundry: a luxury good to refine and export

- status: built
- proposed-by: **Niko Vance, foundry-hand** — live Hermes returned empty (upstream flaky again), written in-character. A new voice — the colony's first refiner-artisan. Realises Mara Venn's deferred "Data-Reel" idea (from the spec 010 pitch) as a small slice.
- date: 2026-06-01
- depends-on: 003, 012

## Why (the citizens' case)

Niko Vance: _"Components are fine for bolts and panels — but the rich colonies out there pay a fortune
for finished luxury. **Data-Reels**, woven from our best components. Give me a **Reel Foundry** and I'll
turn spare components into reels worth far more than the raw. Bram ships them on the Skybridge, and the
coffers sing."_

## Mechanic

- New building **Reel Foundry**. While **staffed**, it consumes **components** and produces **reels** (a
  luxury good) — a second-stage refinement _above_ components, the way a workshop refines materials into
  components (spec 003).
- Reels are a **premium export**: the Skybridge Exchange (012) sells surplus reels far above raw
  components, so a chain of `materials → components → reels → export` earns much more than dumping raw.
- Components gain a real strategic fork: **spend** them on builds and services, or **refine** them into
  reels for export. A colony with spare labour and components can get genuinely rich.
- (Future deepening, kept OUT of this slice: theatres / top-tier homes could come to _demand_ reels, and
  reels could be refined from a new raw like crystal rather than from components.)

## Rules & data

- Build cost: treasury + **~16 materials + ~12 components** + a build crew of 3.
- Run: **2 workers**; consumes **~2 components/day** and makes **~1 reel/day** at full staffing (2:1),
  health-scaled like all production (spec 009). No components → no reels.
- Export (via the Exchange, spec 012): **reels** above a reserve of ~2 sell at **~$120 each**
  (cap ~6/day per Exchange) — vs ~$40 for a raw component, so refining ~doubles the value of the
  components spent.
- New `state.reels` resource; the HUD shows it.

## Cost — materials & labour

- To BUILD: treasury + ~16 materials + ~12 components + a 3-colonist build crew.
- To RUN: 2 colonists + ~2 components/day (the input it refines into reels).

## Acceptance

- A staffed foundry with components on hand produces reels over time; with no components it makes none.
- The Exchange exports surplus reels at the premium price (treasury rises from reel trade, faster than the
  same components sold raw).
- HUD shows reels. Tests: the foundry refines components into reels (staffing-scaled, halts with no
  components); the Exchange ships surplus reels above the reserve.
