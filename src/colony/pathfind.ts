// Least-cost path routing over the terrain heightfield — the shared land gate + a deterministic
// Dijkstra used to grow roads (the spine) and driveways that BEND around water and steep ground
// instead of cutting straight through them. Pure and deterministic: the same terrain + anchors
// always yield the same path, so the layout is reproducible and unit-testable.
import type { Terrain } from './terrain'
import { Biome } from './terrain'

export interface Cell {
  x: number
  y: number
}

/** A cell is good ground to lay a road, parcel or house on: in-bounds, buildable, dry, not bare rock.
 *  This is THE shared gate — the router, the parcel validator and the house footprint all use it, so
 *  nothing (street, verge, fence, garden, field, driveway) can ever land on water or rock. */
export function cellOk(t: Terrain, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= t.size || y >= t.size) return false
  const i = t.idx(x, y)
  if (t.buildable[i] === 0) return false
  if (t.isWater(x, y)) return false
  const b = t.biome[i]
  return b !== Biome.Mountain && b !== Biome.Peak && b !== Biome.Ocean && b !== Biome.Shallows
}

/** Traversal cost of standing on a cell: 1 on flat ground (buildable 2), 3 on a grade (buildable 1),
 *  Infinity on anything blocked, wet or rocky. Roads physically cannot route over Infinity, so the
 *  water barrier holds by construction. */
export function cellCost(t: Terrain, x: number, y: number): number {
  if (!cellOk(t, x, y)) return Infinity
  const b = t.buildable[t.idx(x, y)]
  return b === 2 ? 1 : b === 1 ? 3 : Infinity
}

// A tiny binary min-heap keyed by (dist, cellIndex). The index tie-break makes pops deterministic
// when two frontier cells share a distance, so the chosen path is stable run-to-run.
class MinHeap {
  private dist: number[] = []
  private idx: number[] = []
  get size(): number {
    return this.dist.length
  }
  private less(a: number, b: number): boolean {
    return this.dist[a] !== this.dist[b] ? this.dist[a]! < this.dist[b]! : this.idx[a]! < this.idx[b]!
  }
  private swap(a: number, b: number): void {
    ;[this.dist[a], this.dist[b]] = [this.dist[b]!, this.dist[a]!]
    ;[this.idx[a], this.idx[b]] = [this.idx[b]!, this.idx[a]!]
  }
  push(dist: number, idx: number): void {
    this.dist.push(dist)
    this.idx.push(idx)
    let i = this.size - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(i, p)) {
        this.swap(i, p)
        i = p
      } else break
    }
  }
  pop(): { dist: number; idx: number } {
    const top = { dist: this.dist[0]!, idx: this.idx[0]! }
    const last = this.size - 1
    this.swap(0, last)
    this.dist.pop()
    this.idx.pop()
    let i = 0
    const n = this.size
    for (;;) {
      const l = 2 * i + 1, r = 2 * i + 2
      let m = i
      if (l < n && this.less(l, m)) m = l
      if (r < n && this.less(r, m)) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
    return top
  }
}

// Fixed neighbour scan order: +x, -x, +y, -y. With the heap's index tie-break this fully determines
// the path, so leastCostPath is a pure function of (terrain, start, goal, opts).
const NEIGH: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** Deterministic least-cost path from start to goal over the 4-connected grid. Returns the cell list
 *  inclusive of both ends, or null if either endpoint is bad ground or no dry-buildable route exists
 *  (e.g. the two are separated by water). `slopeWeight` adds a cost proportional to the height change
 *  per step so the route drapes along the contour rather than climbing the fall line. */
export function leastCostPath(t: Terrain, start: Cell, goal: Cell, opts: { slopeWeight?: number } = {}): Cell[] | null {
  const slopeWeight = opts.slopeWeight ?? 0
  if (!cellOk(t, start.x, start.y) || !cellOk(t, goal.x, goal.y)) return null
  const n = t.size
  const N = n * n
  const dist = new Float64Array(N).fill(Infinity)
  const prev = new Int32Array(N).fill(-1)
  const done = new Uint8Array(N)
  const si = t.idx(start.x, start.y)
  const gi = t.idx(goal.x, goal.y)
  dist[si] = 0
  const heap = new MinHeap()
  heap.push(0, si)
  while (heap.size > 0) {
    const { idx: ci } = heap.pop()
    if (done[ci]) continue
    done[ci] = 1
    if (ci === gi) break
    const cx = ci % n, cy = (ci / n) | 0
    for (const [dx, dy] of NEIGH) {
      const nx = cx + dx, ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue
      const ni = ny * n + nx
      if (done[ni]) continue
      const step = cellCost(t, nx, ny)
      if (!Number.isFinite(step)) continue
      let w = step
      if (slopeWeight > 0) w += slopeWeight * Math.abs(t.worldY(nx, ny) - t.worldY(cx, cy))
      const nd = dist[ci]! + w
      if (nd < dist[ni]!) {
        dist[ni] = nd
        prev[ni] = ci
        heap.push(nd, ni)
      }
    }
  }
  if (!Number.isFinite(dist[gi]!)) return null
  // Reconstruct from goal back to start.
  const path: Cell[] = []
  for (let c = gi; c !== -1; c = prev[c]!) {
    path.push({ x: c % n, y: (c / n) | 0 })
    if (c === si) break
  }
  path.reverse()
  return path
}
