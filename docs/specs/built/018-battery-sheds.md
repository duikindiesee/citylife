# Spec 018 — Battery Sheds: store the power, plan the grid

- status: built
- proposed-by: **Mara Venn, night-shift Grid Listener (Dock-Spoke 3)** — **LIVE Hermes** (model hermes-codex-gpt-5.5), her 8th accepted proposal and the 2nd in a row since the inference recovered. A direct follow-up to the brownout grid she proposed last tick (017).
- date: 2026-06-01
- depends-on: 017, 013

## Why (the citizens' case)

Mara Venn: _"One overload and the clinics, the pumps, the ration lifts all dim at the worst moment. We
need **Battery Sheds** — buffers that drink up the noon surplus and pour it back when demand spikes. Build
them from our own reels and components, and the grid becomes something you can READ, forgive, and plan
around. A colony that stores its power doesn't fear the dark."_

## Mechanic

- New building **Battery Shed**. Each one **raises the colony's battery capacity** — more stored power to
  ride out the dark and demand spikes, so the colony **browns out (017) far less**.
- The power sim already charges the battery from surplus solar and discharges it under load (spec 017); a
  Battery Shed just gives it a **bigger tank**, so a passing overload no longer drops it below the brownout
  line.
- The build consumes **reels** — the luxury good (013) finds a **third home** beyond export (012) and
  theatre fuel (014): the colony's own grid infrastructure. Reels now compete three ways, deepening the
  choice of what to do with them.

## Rules & data

- Build cost: treasury + **~10 materials + ~12 components + ~3 reels** + a build crew of 3.
- Each shed adds `batteryShedCapWh` (~40 Wh) to `power.batteryCapWh` (the colony starts at 80 Wh, so a few
  sheds meaningfully fatten the buffer).
- Run: **~1 component/day** upkeep (maintenance).
- autoGrow raises a Battery Shed when the colony has been browning out **and** has the reels + components
  to spare — gated as ever on free labour + materials.

## Cost — materials & labour

- To BUILD: treasury + ~10 materials + ~12 components + ~3 reels + a 3-colonist build crew.
- To RUN: ~1 component/day upkeep.

## Acceptance

- Building a Battery Shed **raises the colony's battery capacity** (a bigger buffer).
- A colony with Battery Sheds rides through a demand spike that would brown out the same colony without
  them (more stored charge before the 25% threshold).
- The build **consumes reels** (and components). Tests: a finished shed increases `batteryCapWh`; a
  shed's build draws down reels + components; a buffered colony holds more charge through a spike.
