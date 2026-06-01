import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { autoGrow, freeLabour, stepBuild } from '../src/colony/build'
import { COLONY } from '../src/colony/config'

describe('Spec 001 — materials + labour gate construction', () => {
  it('a fresh colony starts with the dropship materials stockpile', () => {
    const s = new ColonySim(7).state
    expect(s.materials).toBe(COLONY.build.materialsStart)
  })

  it('no build starts without materials (no timer pop-up)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.materials = 0
    const before = s.buildings.length + s.jobs.length
    for (let i = 0; i < 12; i++) autoGrow(s, sim.rng)
    expect(s.buildings.length + s.jobs.length).toBe(before)
  })

  it('no build starts without free labour', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.materials = 100
    s.colonists = 0
    const before = s.jobs.length
    for (let i = 0; i < 12; i++) autoGrow(s, sim.rng)
    expect(s.jobs.length).toBe(before)
  })

  it('starting a build consumes materials and reserves a crew', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.materials = 40
    const mat0 = s.materials
    const ok = autoGrow(s, sim.rng)
    expect(ok).toBe(true)
    expect(s.jobs.length).toBe(1)
    expect(s.materials).toBeLessThan(mat0)
    expect(freeLabour(s)).toBe(20 - s.jobs[0]!.artifact.crew)
  })

  it('a 2-colonist colony cannot spam builds — crew never exceeds the population', () => {
    const sim = new ColonySim(7)
    const s = sim.state // fresh: colonists 2, materials 40
    for (let i = 0; i < 20; i++) autoGrow(s, sim.rng)
    const reserved = s.jobs.reduce((n, j) => n + j.artifact.crew, 0)
    expect(reserved).toBeLessThanOrEqual(s.colonists)
  })
})

describe('Spec 002 — extraction: staffed mines produce materials', () => {
  const mineArtifact = () => ({
    id: 1, kind: 'mine' as const, color: 0x6b5a4a, height: 0.7, residents: 0, jobs: 6,
    powerLoad: 0.3, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 5,
  })

  it('a fully staffed mine raises materials over sim time', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.materials = 10
    s.buildings.push({ id: 1, x: s.terrain.landing.x + 3, y: s.terrain.landing.y, artifact: mineArtifact() })
    s.totalJobs = 6
    s.colonists = 6 // fully staffed → no free labour, so autoGrow won't interfere
    const m0 = s.materials
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.materials).toBeGreaterThan(m0)
  })

  it('with no mine and no colonists, materials do not change', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.materials = 10
    s.colonists = 0
    s.totalJobs = 0
    const m0 = s.materials
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.materials).toBe(m0)
  })

  it('an understaffed mine produces less than a fully staffed one', () => {
    const run = (colonists: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.materials = 10
      s.buildings.push({ id: 1, x: s.terrain.landing.x + 3, y: s.terrain.landing.y, artifact: mineArtifact() })
      s.totalJobs = 6
      s.colonists = colonists
      const m0 = s.materials
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(6)).toBeGreaterThan(run(3))
  })
})

describe('Spec 003 — workshops refine materials into components', () => {
  const workshopArtifact = () => ({
    id: 1, kind: 'workshop' as const, color: 0x8a7f3a, height: 1.0, residents: 0, jobs: 5,
    powerLoad: 0.6, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0,
  })

  it('a staffed workshop turns materials into components', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.materials = 100
    s.components = 0
    s.buildings.push({ id: 1, x: s.terrain.landing.x + 4, y: s.terrain.landing.y, artifact: workshopArtifact() })
    s.totalJobs = 5
    s.colonists = 5 // fully staffed → free labour 0, no autoGrow interference
    const m0 = s.materials
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.components).toBeGreaterThan(0)
    expect(s.materials).toBeLessThan(m0)
  })

  it('a workshop with no materials produces no components', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.materials = 0
    s.components = 0
    s.buildings.push({ id: 1, x: s.terrain.landing.x + 4, y: s.terrain.landing.y, artifact: workshopArtifact() })
    s.totalJobs = 5
    s.colonists = 5
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.components).toBe(0)
  })

  it('an understaffed workshop produces fewer components', () => {
    const run = (colonists: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.materials = 100
      s.components = 0
      s.buildings.push({ id: 1, x: s.terrain.landing.x + 4, y: s.terrain.landing.y, artifact: workshopArtifact() })
      s.totalJobs = 5
      s.colonists = colonists
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.components
    }
    expect(run(5)).toBeGreaterThan(run(2))
  })
})
