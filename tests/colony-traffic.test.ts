import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { updateTraffic } from '../src/colony/traffic'
import { RNG } from '../src/engine/rng'
import type { Artifact } from '../src/colony/build'

// Spec 084 S6 — re-baselined: these tests INJECT the minimal city (a home and a workplace beside
// the landing road frame) and drive updateTraffic directly, instead of gambling that the economy
// bootstrap raises homes before full employment locks construction crews (on the 608 terrain a
// teleported-in populace deadlocks exactly that way). They test TRAFFIC — spawning, movement,
// intersection discipline — which is what they always claimed to test.

function art(id: number, kind: 'habitat' | 'commercial'): Artifact {
  return {
    id, kind, color: 0xffffff, height: 1,
    residents: kind === 'habitat' ? 3 : 0, jobs: kind === 'commercial' ? 8 : 0,
    powerLoad: 0, powerGen: 0, buildTimeMin: 0, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0,
  }
}

function seededTown() {
  const sim = new ColonySim(4242)
  const s = sim.state
  const streets = s.roads.filter((r) => (r.kind ?? 'street') === 'street')
  expect(streets.length).toBeGreaterThan(8)
  const a = streets[0]!
  const b = streets[streets.length - 1]!
  s.buildings.push({ id: 9001, x: a.x, y: a.y - 1, artifact: art(9001, 'habitat') })
  s.buildings.push({ id: 9002, x: b.x, y: b.y + 1, artifact: art(9002, 'commercial') })
  s.colonists = 40
  return sim
}

describe('Colony — traffic', () => {
  it('spawns commuter cars once there are homes, workplaces and roads', () => {
    const sim = seededTown()
    const rng = new RNG(7)
    for (let i = 0; i < 200; i++) updateTraffic(sim.state, rng, 1.5)
    expect(sim.state.cars.length).toBeGreaterThan(0)
    expect(sim.state.cars.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))).toBe(true)
  })

  it('cars drive (positions change) and none stay permanently stuck at intersections', () => {
    const sim = seededTown()
    const rng = new RNG(7)
    for (let i = 0; i < 200; i++) updateTraffic(sim.state, rng, 1.5)
    const before = sim.state.cars.map((c) => ({ x: c.x, y: c.y }))
    for (let i = 0; i < 300; i++) updateTraffic(sim.state, rng, 1.5)
    const moved = sim.state.cars.filter((c, i) => before[i] && Math.hypot(c.x - before[i]!.x, c.y - before[i]!.y) > 0.5).length
    expect(moved).toBeGreaterThan(0)
    // the wait failsafe must keep every car under the cap (no deadlock)
    expect(sim.state.cars.every((c) => c.waitTimer <= 50)).toBe(true)
  })
})
