import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'

describe('Colony — traffic', () => {
  it('spawns commuter cars once there are homes, workplaces and roads', () => {
    const sim = new ColonySim(4242)
    for (let i = 0; i < 480 * 8; i++) sim.step() // grow a town with jobs + roads
    expect(sim.state.cars.length).toBeGreaterThan(0)
    expect(sim.state.cars.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))).toBe(true)
  })

  it('cars drive (positions change) and none stay permanently stuck at intersections', () => {
    const sim = new ColonySim(4242)
    for (let i = 0; i < 480 * 8; i++) sim.step()
    const before = sim.state.cars.map((c) => ({ x: c.x, y: c.y }))
    for (let i = 0; i < 300; i++) sim.step()
    const moved = sim.state.cars.filter((c, i) => before[i] && Math.hypot(c.x - before[i]!.x, c.y - before[i]!.y) > 0.5).length
    expect(moved).toBeGreaterThan(0)
    // the wait failsafe must keep every car under the cap (no deadlock)
    expect(sim.state.cars.every((c) => c.waitTimer <= 50)).toBe(true)
  })
})
