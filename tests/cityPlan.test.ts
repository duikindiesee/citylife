import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { makeCityPlan, cellZone, ZONE_COLOR, VIBE_COLOR } from '../src/colony/cityPlan'

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

describe('cellZone (the surveyed arcs the patrol bot reasons over)', () => {
  const L = { x: 100, y: 100 }
  it('the centre is civic', () => {
    expect(cellZone(L, 100, 100)).toBe('civic')
    expect(cellZone(L, 102, 100)).toBe('civic')
  })
  it('east → commercial (harbour arc)', () => {
    expect(cellZone(L, 110, 100)).toBe('commercial')
    expect(cellZone(L, 120, 102)).toBe('commercial')
  })
  it('south → industrial (downwind arc)', () => {
    expect(cellZone(L, 100, 115)).toBe('industrial')
    expect(cellZone(L, 102, 120)).toBe('industrial')
  })
  it('north + west → residential (family arc)', () => {
    expect(cellZone(L, 100, 85)).toBe('residential') // due north
    expect(cellZone(L, 80, 100)).toBe('residential') // due west
    expect(cellZone(L, 85, 90)).toBe('residential') // northwest
  })
  it('far cells (> reach) are off-plan', () => {
    expect(cellZone(L, 0, 0)).toBeNull()
    expect(cellZone(L, 200, 200)).toBeNull()
  })
})

describe('ZONE_COLOR and VIBE_COLOR', () => {
  it('every zone has a colour', () => {
    for (const z of ['residential', 'commercial', 'industrial', 'civic'] as const) {
      expect(typeof ZONE_COLOR[z]).toBe('number')
    }
  })
  it('every vibe has a colour', () => {
    for (const v of ['beach', 'hillside', 'riverside', 'plains', 'forest-edge'] as const) {
      expect(typeof VIBE_COLOR[v]).toBe('number')
    }
  })
})
