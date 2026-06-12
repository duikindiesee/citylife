import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { reserveParcelLand } from '../src/colony/build'
import { makeNeighborhood } from '../src/colony/neighborhood'

// Roads v2 — the block frame is now ROUTED with the least-cost pathfinder (cellOk + slope weight)
// instead of stamped as rigid straight lines, so roads contour around water and steep ground. These
// pin the planner's contract: dry roads, deterministic layout, and a connected starting frame.

describe('road planning — least-cost routed block frames', () => {
  it('never lays a road cell on water', () => {
    const sim = new ColonySim(42)
    const t = sim.state.terrain
    for (const r of sim.state.roads) {
      expect(t.isWater(r.x, r.y), `road cell ${r.x},${r.y} is wet`).toBe(false)
    }
  })

  it('keeps roads off blocked-steep ground when a route exists (contour, not fall line)', () => {
    const sim = new ColonySim(42)
    const t = sim.state.terrain
    // The landing block sits on chosen-flat ground, so the routed frame should be on buildable cells.
    const bad = sim.state.roads.filter((r) => t.buildable[t.idx(r.x, r.y)] === 0)
    // Allow a tiny fallback remainder (straight-line fill when an edge cannot route), but the frame
    // must be overwhelmingly on good ground.
    expect(bad.length).toBeLessThanOrEqual(Math.ceil(sim.state.roads.length * 0.1))
  })

  it('is deterministic — the same seed lays the identical network', () => {
    const a = new ColonySim(1234).state.roads.map((r) => `${r.x},${r.y}`).join('|')
    const b = new ColonySim(1234).state.roads.map((r) => `${r.x},${r.y}`).join('|')
    expect(a).toBe(b)
  })

  it('PARCEL LAND IS SACRED — reserveParcelLand purges roads under parcels and blocks future laying', () => {
    const sim = new ColonySim(42)
    // reserve a band straight through the existing landing frame
    const roadCell = sim.state.roads[0]!
    const cells: { x: number; y: number }[] = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) cells.push({ x: roadCell.x + dx, y: roadCell.y + dy })
    const purged = reserveParcelLand(sim.state, cells)
    expect(purged).toBeGreaterThanOrEqual(1) // the overlapping road cell was removed
    for (const r of sim.state.roads) {
      const inside = cells.some((c) => c.x === r.x && c.y === r.y)
      expect(inside, `road ${r.x},${r.y} still inside reserved land`).toBe(false)
    }
    for (const c of cells) expect(sim.state.occupied.has(`${c.x},${c.y}`)).toBe(true)
  })

  it('after the runtime-style homestead reservation, NO colony road sits under any parcel', () => {
    const sim = new ColonySim(42)
    const nbhd = makeNeighborhood(sim.state.terrain)
    const cells: { x: number; y: number }[] = []
    for (const lot of nbhd.lots) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const f of lot.fence) {
        minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x)
        minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y)
      }
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) cells.push({ x, y })
    }
    reserveParcelLand(sim.state, cells)
    const reserved = new Set(cells.map((c) => `${c.x},${c.y}`))
    for (const r of sim.state.roads) {
      expect(reserved.has(`${r.x},${r.y}`), `road ${r.x},${r.y} under a homestead`).toBe(false)
    }
  })

  it('the landing frame is non-empty and 4-connected enough to walk (each cell has a road neighbour)', () => {
    const sim = new ColonySim(42)
    const set = new Set(sim.state.roads.map((r) => `${r.x},${r.y}`))
    expect(set.size).toBeGreaterThan(0)
    let isolated = 0
    for (const r of sim.state.roads) {
      const hasNeighbour = set.has(`${r.x + 1},${r.y}`) || set.has(`${r.x - 1},${r.y}`) || set.has(`${r.x},${r.y + 1}`) || set.has(`${r.x},${r.y - 1}`)
      if (!hasNeighbour) isolated++
    }
    expect(isolated).toBe(0)
  })
})
