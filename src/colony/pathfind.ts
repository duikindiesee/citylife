// Least-cost path routing over the terrain heightfield — the shared land gate + a deterministic
// Dijkstra used to grow roads (the spine) and driveways that BEND around water and steep ground
// instead of cutting straight through them. Pure and deterministic: the same terrain + anchors
// always yield the same path, so the layout is reproducible and unit-testable.
import type { Terrain } from "./terrain";
import { Biome } from "./terrain";

export interface Cell {
  x: number;
  y: number;
}

/** A cell is good ground to lay a road, parcel or house on: in-bounds, buildable, dry, not bare rock.
 *  This is THE shared gate — the router, the parcel validator and the house footprint all use it, so
 *  nothing (street, verge, fence, garden, field, driveway) can ever land on water or rock. */
export function cellOk(t: Terrain, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= t.size || y >= t.size) return false;
  const i = t.idx(x, y);
  if (t.buildable[i] === 0) return false;
  if (t.isWater(x, y)) return false;
  const b = t.biome[i];
  return (
    b !== Biome.Mountain &&
    b !== Biome.Peak &&
    b !== Biome.Ocean &&
    b !== Biome.Shallows
  );
}

/** A cell is good ground for a ROAD specifically: cellOk AND not beach sand. Spec 140 — roads
 *  never run on Biome.Beach (operator rule: no roads on beaches, ever); water was already excluded
 *  by cellOk. Beach stays legal for parcels, houses and walking (the Beach Cove plots, and the
 *  future boat-launch pad), so this is a separate gate rather than a change to cellOk. */
export function roadCellOk(t: Terrain, x: number, y: number): boolean {
  return cellOk(t, x, y) && t.biome[t.idx(x, y)] !== Biome.Beach;
}

/** Traversal cost of standing on a cell: 1 on flat ground (buildable 2), 3 on a grade (buildable 1),
 *  Infinity on anything blocked, wet or rocky. Roads physically cannot route over Infinity, so the
 *  water barrier holds by construction. */
export function cellCost(t: Terrain, x: number, y: number): number {
  if (!cellOk(t, x, y)) return Infinity;
  const b = t.buildable[t.idx(x, y)];
  return b === 2 ? 1 : b === 1 ? 3 : Infinity;
}

// A tiny binary min-heap keyed by (dist, cellIndex). The index tie-break makes pops deterministic
// when two frontier cells share a distance, so the chosen path is stable run-to-run.
class MinHeap {
  private dist: number[] = [];
  private idx: number[] = [];
  get size(): number {
    return this.dist.length;
  }
  private less(a: number, b: number): boolean {
    return this.dist[a] !== this.dist[b]
      ? this.dist[a]! < this.dist[b]!
      : this.idx[a]! < this.idx[b]!;
  }
  private swap(a: number, b: number): void {
    [this.dist[a], this.dist[b]] = [this.dist[b]!, this.dist[a]!];
    [this.idx[a], this.idx[b]] = [this.idx[b]!, this.idx[a]!];
  }
  push(dist: number, idx: number): void {
    this.dist.push(dist);
    this.idx.push(idx);
    let i = this.size - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) {
        this.swap(i, p);
        i = p;
      } else break;
    }
  }
  pop(): { dist: number; idx: number } {
    const top = { dist: this.dist[0]!, idx: this.idx[0]! };
    const last = this.size - 1;
    this.swap(0, last);
    this.dist.pop();
    this.idx.pop();
    let i = 0;
    const n = this.size;
    for (;;) {
      const l = 2 * i + 1,
        r = 2 * i + 2;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

// Fixed neighbour scan order: +x, -x, +y, -y. With the heap's index tie-break this fully determines
// the path, so leastCostPath is a pure function of (terrain, start, goal, opts).
const NEIGH: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
// 8-connected scan order (orthogonals first, then diagonals) for diagonal:true routing — roads opt in
// so they run clean 45-degree diagonals instead of 90-degree Manhattan stair-steps. Driveways and
// everything else stay on NEIGH, so their layouts are byte-identical.
const NEIGH8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Spec 084 S1 — module-level scratch reused across calls. At a 608-cell world the three per-call
// typed arrays were ~4.4 MB of fresh allocation per route, and boot routes dozens. A generation
// stamp marks which cells were touched by the CURRENT call, so the buffers never need clearing
// between calls (an O(N) fill would defeat the point). leastCostPath stays a pure function of its
// inputs — the scratch carries no information between calls by construction, and the algorithm,
// scan order and tie-breaks are UNCHANGED, so every routed layout is byte-identical to before.
let scratchCap = 0;
let sDist = new Float64Array(0);
let sPrev = new Int32Array(0);
let sSeen = new Int32Array(0); // sSeen[i] === sGen ⇔ dist/prev are valid for this call
let sDone = new Int32Array(0); // sDone[i] === sGen ⇔ the cell is settled in this call
let sGen = 0;

/** Deterministic least-cost path from start to goal over the 4-connected grid. Returns the cell list
 *  inclusive of both ends, or null if either endpoint is bad ground or no dry-buildable route exists
 *  (e.g. the two are separated by water). `slopeWeight` adds a cost proportional to the height change
 *  per step so the route drapes along the contour rather than climbing the fall line. */
export function leastCostPath(
  t: Terrain,
  start: Cell,
  goal: Cell,
  opts: {
    slopeWeight?: number;
    blocked?: (x: number, y: number) => boolean;
    diagonal?: boolean;
    /** Spec 140 — treat Biome.Beach as impassable, exactly like water. ROAD routing opts in so
     *  boot roads bend inland along the grass line; walking and driveway routing do not, so
     *  citizens still cross the sand on foot. Composed into `blocked`, so endpoints, neighbour
     *  steps and diagonal corner-cuts all get the same guard. */
    forbidBeach?: boolean;
    /** Half-width of the search rect around the start/goal bounding box. Defaults to 40 — every
     *  existing caller omits it, so their routes stay byte-identical. A remote spur (e.g. the rally
     *  overlook, which can need a long detour around a ridge) opts into a larger margin. */
    margin?: number;
  } = {},
): Cell[] | null {
  const slopeWeight = opts.slopeWeight ?? 0;
  let blocked = opts.blocked;
  if (opts.forbidBeach) {
    const user = blocked;
    const beach = (x: number, y: number) =>
      t.biome[t.idx(x, y)] === Biome.Beach;
    blocked = user ? (x, y) => beach(x, y) || user(x, y) : beach;
  }
  const neigh = opts.diagonal ? NEIGH8 : NEIGH;
  const SQRT2 = Math.SQRT2;
  if (!cellOk(t, start.x, start.y) || !cellOk(t, goal.x, goal.y)) return null;
  if (blocked && (blocked(start.x, start.y) || blocked(goal.x, goal.y)))
    return null;
  const n = t.size;
  const N = n * n;
  if (scratchCap < N) {
    sDist = new Float64Array(N);
    sPrev = new Int32Array(N);
    sSeen = new Int32Array(N);
    sDone = new Int32Array(N);
    sGen = 0;
    scratchCap = N;
  }
  sGen++;
  const si = t.idx(start.x, start.y);
  const gi = t.idx(goal.x, goal.y);
  // Spec 084 S6 — two scale guards for the 608 world, landed inside the atomic re-baseline because
  // both can change equal-cost tie-breaks (never land them separately):
  // 1. A* — the heap is ordered by g + h with h = manhattan distance x the minimum step cost (1).
  //    slopeWeight only ADDS cost, so h stays admissible and the found path cost is optimal.
  // 2. A SEARCH RECT — exploration is bounded to the start/goal bounding box + 40 cells. Every
  //    route we lay (corridor spans, block frames, driveways) detours far less than that (the road
  //    planner caps detours at ~1.6x anyway); without the bound a watery dead-end could flood the
  //    whole 370k-cell grid.
  const MARGIN = opts.margin ?? 40;
  const bx0 = Math.max(0, Math.min(start.x, goal.x) - MARGIN);
  const bx1 = Math.min(n - 1, Math.max(start.x, goal.x) + MARGIN);
  const by0 = Math.max(0, Math.min(start.y, goal.y) - MARGIN);
  const by1 = Math.min(n - 1, Math.max(start.y, goal.y) + MARGIN);
  // h = min-step-cost (1) x distance to goal. 4-conn -> Manhattan; 8-conn -> OCTILE (admissible with
  // diagonal moves, so the path stays optimal).
  const hCost = opts.diagonal
    ? (x: number, y: number) => {
        const ax = Math.abs(x - goal.x),
          ay = Math.abs(y - goal.y);
        return ax + ay + (SQRT2 - 2) * Math.min(ax, ay);
      }
    : (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  sDist[si] = 0;
  sPrev[si] = -1;
  sSeen[si] = sGen;
  const heap = new MinHeap();
  heap.push(hCost(start.x, start.y), si);
  while (heap.size > 0) {
    const { idx: ci } = heap.pop();
    if (sDone[ci] === sGen) continue;
    sDone[ci] = sGen;
    if (ci === gi) break;
    const cx = ci % n,
      cy = (ci / n) | 0;
    for (const [dx, dy] of neigh) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
      const ni = ny * n + nx;
      if (sDone[ni] === sGen) continue;
      const step = cellCost(t, nx, ny);
      if (!Number.isFinite(step)) continue;
      if (blocked && blocked(nx, ny)) continue; // reserved land (parcels, structures) is impassable
      const diag = dx !== 0 && dy !== 0;
      if (diag) {
        // no corner-cutting: both orthogonal cells the diagonal squeezes between must be passable, so a
        // diagonal can never clip across a water/rock corner.
        if (
          !Number.isFinite(cellCost(t, cx + dx, cy)) ||
          !Number.isFinite(cellCost(t, cx, cy + dy))
        )
          continue;
        if (blocked && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue;
      }
      let w = step * (diag ? SQRT2 : 1);
      if (slopeWeight > 0)
        w += slopeWeight * Math.abs(t.worldY(nx, ny) - t.worldY(cx, cy));
      const nd = sDist[ci]! + w;
      if (sSeen[ni] !== sGen || nd < sDist[ni]!) {
        sDist[ni] = nd;
        sPrev[ni] = ci;
        sSeen[ni] = sGen;
        heap.push(nd + hCost(nx, ny), ni);
      }
    }
  }
  if (sSeen[gi] !== sGen || sDone[gi] !== sGen) return null;
  // Reconstruct from goal back to start (every cell on the chain was stamped by this call).
  const path: Cell[] = [];
  for (let c = gi; c !== -1; c = sPrev[c]!) {
    path.push({ x: c % n, y: (c / n) | 0 });
    if (c === si) break;
  }
  path.reverse();
  return path;
}
