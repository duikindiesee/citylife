# Spec 097 — Hilltop Rally Point (race rendezvous)

**Status:** R1 + R2 built; R3–R5 planned.
**Lane:** claude2 / car-and-garage. Feeds the race design in the team's rally lane (spec 087)
and the own-car / ghost race plan.

## Why

The race needs a place you GO to. A bus-stop-style **Rally Point** sits on a commanding
**hilltop overlooking the city**. A player walks there in first person; when **two players**
are present they can **join a race** — each eventually in their own customized car (spec 096).
It turns the road network into a destination ritual, not just background infrastructure.

## Slices

- **R1 — place the hilltop (BUILT).** `findRallyOverlookSite` (`sim.ts`) mirrors the founders
  lighthouse picker: maximize elevation + local prominence with a Highland/Mountain bias, require
  a **buildable footprint** (so a spur road can later reach it), avoid the other base structures
  (`used`), and stay within reach of the landing so it overlooks the colony. A new `"rally"`
  `StructureKind` is pushed in the `ColonySim` constructor after the lighthouse. Seed-deterministic,
  no `Math.random`. Verified: lands on a Mountain-biome hilltop (~22 worldY vs the colony's ~0.1),
  on buildable ground.
- **R2 — render the marker (BUILT).** A `"rally"` branch in `PlanetRenderer.makeStructure`: a stop
  platform, a signpost carrying a glowing **checker race-flag** board, a bench, and a landmark
  **beacon** — emissive floor so the point reads from the city below and at night (per the
  day-night rule). Iconographic only (no brand text). Builds as a 10-mesh group.
- **R3 — first-person "walk to rally" (planned).** `runtime.goToRallyPoint()` reusing the civic
  guided-walk (`fpGuidedTarget` + `citizens.setTarget` + `driveFirstPersonGuided` + `leastCostPath`)
  and a HUD button. (A structure does not auto-surface as an Action prompt — use the explicit method.)
- **R3.5 — spur road connector (planned).** Route a road from the nearest terminus to the rally cell
  (`leastCostPath` + `layRoad` + `mergeAvenue`) in the runtime constructor, mirroring the commercial
  connector, so both the walk and the race-start can reach the hilltop.
- **R4 — presence tracking (planned).** `rallyPresentCount` = avatars within ~1.2 cells of the rally
  cell each tick, modelled on the bar-seat presence (`barSeatCells`/`barOccupied`). Include the
  first-person operator avatar; exclude idle wanderers; reset on race start / exit / day boundary.
- **R5 — two-present → join race (planned; coordinate with the rally owner).** When
  `rallyPresentCount >= 2 && raceState === null`, offer "Join Race"; on confirm call the existing
  `startRace()`. To start AT the hilltop, add an **optional** `startCell?` to `startRace` whose
  default preserves today's behavior (the existing Road Rally buttons keep working unchanged).

## Rules honored

Deterministic sim (no `Math.random` / `Date.now`). main is PROTECTED (PR + review gate).
CI-safe commits. Visual-first (renders on the dev server). Night-visible (emissive floor).
The only shared/coordinated touch is R5's additive `startRace` parameter.
