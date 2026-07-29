// BUS.BOARD.1 — the ONE boarding anchor a route stop has.
//
// A route stop used to be three different points that nobody reconciled:
//   1. the AUTHORED stop cell — a road cell snapped near a hood anchor (busRoute.makeBusRoute),
//      which the mini-map and the world survey publish as "the stop";
//   2. where the BUS actually halts — `samplePath(loop, projectPath(loop, cell))` on the DRIVEN
//      loop, i.e. the Douglas-Peucker + Chaikin smoothed polyline the fleet rides (runtime.ts);
//   3. where the STOP FURNITURE stands — the pole/sign, offset onto the verge from the authored
//      cell (busLayer.buildStop, the stops-on-the-verge fix).
//
// Chaikin corner-cutting moves the driven loop off the authored cell at bends — measured at 3.32
// and 3.40 cells (13.3 m / 13.6 m) on two of the five live stops — and the verge offset is then
// applied from the authored cell, so it can push the pole FURTHER from the halted bus instead of
// standing it beside the doors. Measured pole-to-bus gaps on the live seed were 1.98, 1.63, 1.09,
// 2.78 and 5.34 cells against a boarding gate of COLONY.transit.boardMaxDistanceCells = 3, so the
// player standing at the sign could not board at all at the worst stop and had 0.86 m of slack at
// the next worst.
//
// The fix is not a bigger radius — it is one anchor. The furniture stands on the verge of the point
// the bus actually halts at, so the pole-to-bus gap is exactly the verge offset at EVERY stop.
//
// Pure and deterministic: polyline math only, no three.js, no clock, no Math.random.

import { projectPath, samplePath, type PathData, type Pt } from "./path";

/** Cells the stop furniture stands back from the DRIVEN lane centre-line.
 *
 *  Route roads are authored 4 cells (16 m) wide, so the carriageway reaches 2.0 cells either side of
 *  the centre-line; the pole must stand clear of that. Lives here rather than in the render layer
 *  because the boarding contract — `STOP_VERGE_OFFSET_CELLS < COLONY.transit.boardMaxDistanceCells`
 *  — is a simulation invariant, not a drawing detail. busLayer re-exports it. */
export const STOP_VERGE_OFFSET_CELLS = 2.25;

export interface BusStopAnchor {
  /** The authored stop cell this anchor serves (still the identity the survey/mini-map publish). */
  cell: Pt;
  /** Arc length along the driven loop where the bus halts. */
  arc: number;
  /** Where the bus halts — the boarding point. */
  at: Pt;
  /** Travel heading (radians, grid space) of the halted bus; the doors face `verge`. */
  heading: number;
  /** Unit verge direction: left of travel (the SA near-side kerb, the side the doors open on). */
  verge: Pt;
  /** Where the stop FURNITURE stands: `at + verge * offset`. */
  furniture: Pt;
}

/** The boarding anchor for one authored stop cell on a driven loop. */
export function busStopAnchor(
  loop: PathData,
  cell: Pt,
  offsetCells: number = STOP_VERGE_OFFSET_CELLS,
): BusStopAnchor {
  const arc = projectPath(loop, cell);
  const p = samplePath(loop, arc);
  // Left of travel: the unit tangent rotated +90 degrees in grid space — the same convention
  // stopVergeDirection and runtime.alightBus's kerb use, so the sign, the doors and the alighting
  // spot are all on one side.
  const verge = { x: -Math.sin(p.heading), y: Math.cos(p.heading) };
  return {
    cell: { x: cell.x, y: cell.y },
    arc,
    at: { x: p.x, y: p.y },
    heading: p.heading,
    verge,
    furniture: {
      x: p.x + verge.x * offsetCells,
      y: p.y + verge.y * offsetCells,
    },
  };
}

/** Boarding anchors for a whole route, in the authored stop order. */
export function busStopAnchors(
  loop: PathData,
  cells: readonly Pt[],
  offsetCells: number = STOP_VERGE_OFFSET_CELLS,
): BusStopAnchor[] {
  return cells.map((c) => busStopAnchor(loop, c, offsetCells));
}
