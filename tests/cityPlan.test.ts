import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { makeCityPlan } from '../src/colony/cityPlan'

describe('makeCityPlan', () => {
  it('derives at least one plot from the default terrain', () => {
    const sim = new ColonySim(42)
    const plan = makeCityPlan(sim.state.terrain)
    expect(plan.plots.length).toBeGreaterThan(0)
  })

  it('is deterministic — same terrain, same plots', () => {
    const a = makeCityPlan(new ColonySim(99).state.terrain)
    const b = makeCityPlan(new ColonySim(99).state.terrain)
    expect(a.plots.map((p) => `${p.id}:${p.name}:${p.x}:${p.y}`)).toEqual(
      b.plots.map((p) => `${p.id}:${p.name}:${p.x}:${p.y}`),
    )
  })

  it('every plot has a name, a vibe, residential zone, and a buildable coordinate', () => {
    const sim = new ColonySim(7)
    const plan = makeCityPlan(sim.state.terrain)
    for (const p of plan.plots) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(['beach', 'hillside', 'riverside', 'plains', 'forest-edge']).toContain(p.vibe)
      expect(p.zone).toBe('residential')
      const i = sim.state.terrain.idx(p.x, p.y)
      expect(sim.state.terrain.buildable[i]).toBeGreaterThan(0)
    }
  })

  it('produces a variety of vibes when the terrain supports it', () => {
    const sim = new ColonySim(123)
    const plan = makeCityPlan(sim.state.terrain)
    const vibes = new Set(plan.plots.map((p) => p.vibe))
    expect(vibes.size).toBeGreaterThanOrEqual(2)
  })
})
