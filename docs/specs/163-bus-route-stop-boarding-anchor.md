# 162 — Bus route stop boarding anchor (BUS.BOARD.1)

A bus stop is ONE place. The sign the player walks to, the point the bus halts at and the point the
Board prompt measures from must all be the same anchor.

## The defect

The operator could not board a bus standing at an ordinary route stop. Boarding at the DEPOT gate
shelter worked (spec 149, `e2e/busDepot.spec.ts`), so the affordance itself was sound — the geometry
was not.

A route stop was three unreconciled points:

1. the **authored stop cell** — a drivable road cell snapped near a hood anchor
   (`busRoute.makeBusRoute`), which the mini-map and world survey publish as "the stop";
2. where the bus **halts** — that cell projected onto the DRIVEN loop, which is
   `smoothClosed(simplifyClosed(loop, 1.5), 2)`. Chaikin corner-cutting pulls the driven line off the
   authored cell at bends;
3. where the **furniture** stands — the verge offset applied from the authored cell.

Measured on the live seed (five route stops), authored cell → halted bus:
`0.37 / 0.66 / 3.32 / 0.53 / 3.40` cells. Composing that with the verge offset gave sign → halted bus
gaps of `1.98 / 1.63 / 1.09 / 2.78 / 5.34` cells against `COLONY.transit.boardMaxDistanceCells = 3`
(12 m). At stop `(165,467)` the sign stood **5.34 cells (21.4 m)** from the doors, so no Board prompt
appeared; standing on the authored cell itself (3.40 cells, and in the carriageway) did not help
either. At `(296,331)` the player had 0.22 cells (0.86 m) of slack — boardable only by standing
exactly on the pole.

Dwell was never the cause: `stopDwellMin` 1.5 in-sol minutes is **22.5 REAL seconds** with the doors
open (one in-sol minute = 15 real seconds), against a 2.25-cell (9 m) walk of about 2.6 s.

## The rule

The stop furniture stands on the verge of the point the bus actually halts at. One anchor, derived
from the same driven-loop `PathData` the fleet samples poses from, so the sign-to-doors gap is
exactly `STOP_VERGE_OFFSET_CELLS` at every stop on every seed.

The Board radius is **not** widened. Widening it enough to cover the worst broken stop (5.34 cells)
would have let a player board a bus 21 m away across a road, and would have left the sign in the
wrong place anyway.

## Rules & data

| Value                                      | Where                                 | Meaning                                                                                                                      |
| ------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `STOP_VERGE_OFFSET_CELLS = 2.25`           | `src/colony/transit/busStopAnchor.ts` | cells the pole stands back from the driven lane centre-line (clears the 4-cell carriageway, spec ROAD.JUNCTIONS.1 / PR #409) |
| `COLONY.transit.boardMaxDistanceCells = 3` | `src/colony/config.ts`                | unchanged — the walker-to-bus gate that surfaces Board/Exit                                                                  |
| `BusStopAnchor`                            | `src/colony/transit/busStopAnchor.ts` | `{ cell, arc, at, heading, verge, furniture }` — pure in (driven loop, stop cell)                                            |
| `runtime.busStopAnchors()`                 | `src/colony/runtime.ts`               | the route's anchors, built at boot beside the fleet geometry                                                                 |

Invariant: `STOP_VERGE_OFFSET_CELLS < COLONY.transit.boardMaxDistanceCells`.

The verge side stays LEFT of travel — the SA near-side kerb, the same side `runtime.alightBus` drops
a rider on, so the doors, the sign and the alighting kerb agree.

## Cost — materials & labour

None. Pure geometry; no new sim state, no new config knob, no new prompt kind.

## Acceptance

- `tests/busStopBoarding.test.ts` — the anchor is the fleet's own projection; the furniture sits
  exactly the verge offset from the halted bus, perpendicular to travel, on the door side; and in the
  LIVE world, at EVERY route stop where a bus dwells, standing at `furniture` yields
  `interactionPrompt.kind === "bus"` labelled `Board bus N` and E boards it. Two-sided: at twice the
  gate along the same verge there is no bus prompt and E cannot board; and the authored-cell
  placement is proven to fall outside the gate on the same geometry.
- `e2e/busRouteStop.spec.ts` — Playwright proof at an ordinary route stop (asserts `mode === "service"`
  and that the stop is not the depot gate), then rides away with the citizen pinned to the bus.
- `e2e/busDepot.spec.ts` and `tests/busStopVerge.test.ts` stay green — depot boarding and the
  stops-on-the-verge contract are untouched.
