// BUS.ROUTE.TURN.1 — boot a world and measure its bus route against the drivable grid.
// Shared by scripts/busRoutePlates.ts (still SVGs) and scripts/busRouteFilm.ts (narrated cut), so
// both are describing the same numbers. Not part of src/: it boots a whole ColonyRuntime and exists
// for evidence, not for the game.
import { ColonyRuntime } from "../src/colony/runtime";
import {
  buildPath,
  busLoopPath,
  samplePath,
  simplifyClosed,
  smoothClosed,
  ROUTE_SIMPLIFY_EPS_CELLS,
  ROUTE_SMOOTH_ITERS,
  type Pt,
} from "../src/colony/transit/path";
import type { RouteMeasure } from "../src/colony/render/routePlates";

/** Distance in cells to the nearest drivable cell, by expanding ring: ring r holds nothing closer
 *  than r - 0.5, which is the stopping rule. Saturates at 24 cells. */
export function cellsFromRoad(
  road: ReadonlyMap<string, unknown>,
  px: number,
  py: number,
): number {
  let best = Infinity;
  const cx = Math.round(px),
    cy = Math.round(py);
  for (let r = 0; r <= 24 && best > r - 0.5; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!road.has(`${cx + dx},${cy + dy}`)) continue;
        best = Math.min(best, Math.hypot(px - (cx + dx), py - (cy + dy)));
      }
  return best;
}

/** BEFORE is the shipped-then expression with the cap lifted; AFTER is read through busLoopPath —
 *  whatever the runtime actually drives today — so a plate can never claim a geometry the fleet
 *  does not use. `stepCells` is the sampling step: quote arc length, not sample counts, because the
 *  count is an artefact of this number. */
export function measureRoute(seed: number, stepCells = 1): RouteMeasure | null {
  const rt = new ColonyRuntime(seed);
  const road = rt.sim.state.roadKind;
  const route = rt.busRoute;
  if (!route) return null; // not every seed sites a depot, and no depot means no route
  const cells: Pt[] = [...road.keys()].map((k) => {
    const comma = k.indexOf(",");
    return { x: Number(k.slice(0, comma)), y: Number(k.slice(comma + 1)) };
  });
  const before = buildPath(
    smoothClosed(
      simplifyClosed(route.loop, ROUTE_SIMPLIFY_EPS_CELLS),
      2,
      Infinity,
    ),
    true,
  );
  const after = busLoopPath(route.loop);
  const walk = (path: ReturnType<typeof buildPath>) => {
    const pts: Pt[] = [];
    const dist: number[] = [];
    for (let s = 0; s < path.total; s += stepCells) {
      const p = samplePath(path, s);
      pts.push({ x: p.x, y: p.y });
      dist.push(cellsFromRoad(road, p.x, p.y));
    }
    return { pts, dist };
  };
  const b = walk(before);
  const a = walk(after);
  return {
    seed,
    cells,
    before: b.pts,
    after: a.pts,
    beforeDist: b.dist,
    afterDist: a.dist,
  };
}

/** The real smoother on an OPEN bend, for the scaling plate — injected into the renderer so the
 *  picture can never drift from the code it describes. */
export function bendCut(bend: Pt[], maxCut: number): Pt[] {
  let pts = bend;
  for (let i = 0; i < ROUTE_SMOOTH_ITERS; i++) {
    const out: Pt[] = [pts[0]!];
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j]!,
        b = pts[j + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const f = len > 1e-9 ? Math.min(0.25, maxCut / len) : 0;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      out.push({ x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

/** How much ARC the route spends off the paved surface, in cells — the step-independent figure.
 *  A sample count answers a different question every time the step changes. */
export function arcBeyond(
  dist: readonly number[],
  cells: number,
  stepCells = 1,
): number {
  return dist.filter((d) => d > cells).length * stepCells;
}
