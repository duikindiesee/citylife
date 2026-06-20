// Spec 088 — a city BUS that loops between the neighbourhoods. This is the PURE, deterministic ROUTE:
// a circuit over the existing road network (state.roadKind drivable cells) that visits each hood's
// nearest road cell, ordered into a non-crossing loop (by angle about the stops' centroid) and
// connected by BFS over drivable cells into one closed polyline. No Date.now / no Math.random — the
// route is a pure function of (roadKind, hood anchors), so it replays identically and is node-testable.
// A render-loop bus (busLayer) drives this fixed route; nothing here touches the deterministic sim.

export interface Cell {
  x: number;
  y: number;
}

export interface BusRoute {
  /** The hood stops, snapped to road cells, in visiting order around the loop. */
  stops: Cell[];
  /** The full closed polyline over road cells (after loop[last] it wraps to loop[0]). */
  loop: Cell[];
}

export interface BusRoadState {
  /** Drivable road cells, keyed "x,y" (state.roadKind). */
  roadKind: ReadonlyMap<string, unknown>;
}

const key = (x: number, y: number) => `${x},${y}`;

/** Build the bus route from the road graph + the hood anchor cells (founders + each hamlet centre).
 *  Snaps each anchor to its nearest road cell, orders the stops into a non-crossing loop, and
 *  BFS-connects consecutive stops (closing the loop). Returns null if fewer than two hoods are
 *  reachable over roads. Deterministic in (roadKind, anchors). */
export function makeBusRoute(
  state: BusRoadState,
  anchors: Cell[],
): BusRoute | null {
  const road = state.roadKind;
  if (anchors.length < 2) return null;
  const snap = (a: Cell): Cell | null => {
    for (let r = 0; r <= 18; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only (nearest-first)
          const x = Math.round(a.x) + dx,
            y = Math.round(a.y) + dy;
          if (road.has(key(x, y))) return { x, y };
        }
    }
    return null;
  };
  const seen = new Set<string>();
  const stopsUniq: Cell[] = [];
  for (const a of anchors) {
    const s = snap(a);
    if (!s) continue;
    const k = key(s.x, s.y);
    if (seen.has(k)) continue;
    seen.add(k);
    stopsUniq.push(s);
  }
  if (stopsUniq.length < 2) return null;
  // Order into a non-crossing loop: sort by angle about the centroid of the stops.
  const cx = stopsUniq.reduce((s, c) => s + c.x, 0) / stopsUniq.length;
  const cy = stopsUniq.reduce((s, c) => s + c.y, 0) / stopsUniq.length;
  const stops = [...stopsUniq].sort((a, b) => {
    const aa = Math.atan2(a.y - cy, a.x - cx),
      ab = Math.atan2(b.y - cy, b.x - cx);
    return aa !== ab ? aa - ab : a.x - b.x || a.y - b.y; // stable tie-break -> deterministic
  });
  // BFS-connect consecutive stops over the road graph, closing the loop.
  const loop: Cell[] = [];
  for (let i = 0; i < stops.length; i++) {
    const seg = bfsPath(road, stops[i]!, stops[(i + 1) % stops.length]!);
    if (!seg) return null; // a hood is unreachable over roads -> no coherent route
    for (let j = loop.length ? 1 : 0; j < seg.length; j++) loop.push(seg[j]!); // skip the shared join cell
  }
  while (
    loop.length > 1 &&
    loop[0]!.x === loop[loop.length - 1]!.x &&
    loop[0]!.y === loop[loop.length - 1]!.y
  )
    loop.pop();
  if (loop.length < 2) return null;
  return { stops, loop };
}

/** Shortest road path (4-connected over roadKind cells), inclusive of both ends, or null. Deterministic
 *  (fixed neighbour scan order). */
function bfsPath(
  road: ReadonlyMap<string, unknown>,
  from: Cell,
  to: Cell,
): Cell[] | null {
  const startK = key(from.x, from.y),
    goalK = key(to.x, to.y);
  if (!road.has(startK) || !road.has(goalK)) return null;
  const prev = new Map<string, string | null>([[startK, null]]);
  const q: Cell[] = [from];
  let head = 0;
  while (head < q.length) {
    const c = q[head++]!;
    if (c.x === to.x && c.y === to.y) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = c.x + dx,
        ny = c.y + dy,
        nk = key(nx, ny);
      if (road.has(nk) && !prev.has(nk)) {
        prev.set(nk, key(c.x, c.y));
        q.push({ x: nx, y: ny });
      }
    }
  }
  if (!prev.has(goalK)) return null;
  const path: Cell[] = [];
  let cur: string | null = goalK;
  while (cur) {
    const [x, y] = cur.split(",").map(Number);
    path.push({ x: x!, y: y! });
    cur = prev.get(cur) ?? null;
  }
  path.reverse();
  return path;
}
