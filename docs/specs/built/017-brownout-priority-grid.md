# Spec 017 — Brownout Priority Grid: power gets teeth

- status: built
- proposed-by: **Mara Venn, CityLife grid electrician** — **LIVE Hermes** (model hermes-codex-gpt-5.5), her 7th accepted proposal, and the **first true Hermes-authored spec after a long upstream outage** (specs 012–016 were written in-character while the inference was dark). The citizens are speaking again.
- date: 2026-06-01
- depends-on: 002, 003

## Why (the citizens' case)

Mara Venn: _"Our grid has no teeth. We pile on mines and foundries and the lights never even flicker until
the whole thing dies. Wire it properly: when demand outruns the sun and the battery drops below a quarter,
we BROWN OUT — the heavy industry runs at half until we catch up, but the homes, the clinics, life-support
stay lit. A weak grid should slow you, not kill you. Build more solar and the lights come back."_

## Mechanic

- When the colony is power-short — **load exceeds supply AND the battery is below ~25%** — it enters a
  **brownout**: production (mines, workshops, foundries, greenhouses) runs at **~50% output**.
- The **priority grid keeps life-support lit**: homes, water, clinics and the other services stay
  powered; only heavy **industry** sheds load. A weak grid **slows** the colony — it doesn't collapse it.
- Recovery: when supply ≥ load, or the battery recharges above the threshold, full output returns. The
  colony already raises a Solar Farm when load runs high (existing logic) — this gives that the teeth.
- (Total blackout — battery at 0 with no sun — still drives emigration as today, spec 004.)

## Rules & data

- Brownout when `load > peakSupply` **AND** `battery% < brownoutBatteryThreshold` (~0.25).
- During brownout, the production factor for mines / workshops / foundries / greenhouses is multiplied by
  `brownoutProductionFactor` (~0.5). **Services are unaffected** (the priority grid).
- Stacks with the health factor (spec 009): a sick, under-powered colony is doubly slow.

## Cost — materials & labour

- **No new building** — the priority grid is the colony's own wiring (Mara's switchgear: ~40 materials +
  ~12 labour of base install, already part of the colony). The real **ongoing** cost is **Solar Farms**
  (materials + a build crew each) raised to keep supply above load and the battery charged. Fall behind,
  and production pays the price.

## Acceptance

- A power-short colony (load > supply, battery low) produces materials / components / reels / food
  **slower** than the same colony with ample solar.
- Service coverage (watered / healthy / cultured) is **unaffected** by a brownout — only industry sheds.
- Full output returns once solar catches up. Tests: brownout halves production; ample power gives full
  output; service coverage is unchanged by power state.
