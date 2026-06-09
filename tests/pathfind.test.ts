import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { cellOk, cellCost, leastCostPath, type Cell } from '../src/colony/pathfind'

function terrain(seed: number) {
  return new ColonySim(seed).state.terrain
}

/** Find a dry-buildable cell near a target by spiralling outward — every terrain has good ground
 *  near the landing, so this gives the tests stable anchors without hardcoding coordinates. */
function nearestLand(t: ReturnType<typeof terrain>, cx: number, cy: number): Cell {
  for (let r = 0; r < t.size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx, y = cy + dy
        if (cellOk(t, x, y)) return { x, y }
      }
    }
  }
  throw new Error('no land found')
}

describe('pathfind — least-cost terrain router', () => {
  it('cellCost is 1 on flat, 3 on grade, Infinity off-land', () => {
    const t = terrain(42)
    // The landing is always flat dry ground.
    expect(cellCost(t, t.landing.x, t.landing.y)).toBe(1)
    // An out-of-bounds / water cell is Infinity.
    expect(cellCost(t, -1, -1)).toBe(Infinity)
    // Every finite cost is one of the allowed values.
    for (let y = 0; y < t.size; y += 7) {
      for (let x = 0; x < t.size; x += 7) {
        const c = cellCost(t, x, y)
        expect(c === 1 || c === 3 || c === Infinity).toBe(true)
      }
    }
  })

  it('returns a connected path between two land anchors', () => {
    const t = terrain(42)
    const a = nearestLand(t, t.landing.x - 8, t.landing.y)
    const b = nearestLand(t, t.landing.x + 8, t.landing.y)
    const path = leastCostPath(t, a, b)
    expect(path).not.toBeNull()
    const p = path!
    expect(p[0]).toEqual(a)
    expect(p[p.length - 1]).toEqual(b)
    // Each step is a single 4-connected move.
    for (let i = 1; i < p.length; i++) {
      const man = Math.abs(p[i]!.x - p[i - 1]!.x) + Math.abs(p[i]!.y - p[i - 1]!.y)
      expect(man).toBe(1)
    }
  })

  it('never routes a path over water or non-buildable rock', () => {
    const t = terrain(7)
    const a = nearestLand(t, t.landing.x - 10, t.landing.y - 4)
    const b = nearestLand(t, t.landing.x + 10, t.landing.y + 4)
    const path = leastCostPath(t, a, b)
    expect(path).not.toBeNull()
    for (const c of path!) {
      expect(cellOk(t, c.x, c.y)).toBe(true)
      expect(t.isWater(c.x, c.y)).toBe(false)
      expect(Number.isFinite(cellCost(t, c.x, c.y))).toBe(true)
    }
  })

  it('returns null when an endpoint is off-land', () => {
    const t = terrain(42)
    const a = { x: t.landing.x, y: t.landing.y }
    // Pick a guaranteed-water cell: the very corner is ocean under the island mask.
    expect(leastCostPath(t, a, { x: 0, y: 0 })).toBeNull()
    expect(leastCostPath(t, { x: 0, y: 0 }, a)).toBeNull()
  })

  it('is deterministic — same anchors yield the identical path', () => {
    const t = terrain(99)
    const a = nearestLand(t, t.landing.x - 9, t.landing.y - 2)
    const b = nearestLand(t, t.landing.x + 9, t.landing.y + 2)
    expect(leastCostPath(t, a, b)).toEqual(leastCostPath(t, a, b))
  })
})
