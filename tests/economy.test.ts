import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { autoGrow, freeLabour, stepBuild, housingCapacity, wateredFraction } from '../src/colony/build'
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

describe('Spec 004 — settler immigration fills housing capacity', () => {
  const habitat = (residents = 3) => ({
    id: 1, kind: 'habitat' as const, color: 0, height: 1, residents, jobs: 0,
    powerLoad: 0.5, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0,
  })

  it('a finished habitat adds capacity, not instant colonists', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const cap0 = housingCapacity(s)
    const col0 = s.colonists
    s.buildings.push({ id: 1, x: s.terrain.landing.x + 3, y: s.terrain.landing.y, artifact: habitat(3) })
    expect(housingCapacity(s)).toBe(cap0 + 3)
    expect(s.colonists).toBe(col0)
  })

  it('settlers immigrate toward capacity when liveable', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push({ id: 1, x: s.terrain.landing.x + 3, y: s.terrain.landing.y, artifact: habitat(9) }) // capacity 11
    s.power.batteryWh = s.power.batteryCapWh
    s.power.solarW = 5 // liveable
    const col0 = s.colonists
    for (let i = 0; i < 300; i++) stepBuild(s, sim.rng, 10)
    expect(s.colonists).toBeGreaterThan(col0)
    expect(s.colonists).toBeLessThanOrEqual(housingCapacity(s))
  })

  it('no immigration when housing is full', () => {
    const sim = new ColonySim(7)
    const s = sim.state // capacity 2 (no habitats), colonists already 2
    s.power.solarW = 5
    const col0 = Math.round(s.colonists)
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
    expect(Math.round(s.colonists)).toBe(col0)
  })

  it('a power-dead colony loses settlers', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push({ id: 1, x: s.terrain.landing.x + 3, y: s.terrain.landing.y, artifact: habitat(20) })
    s.colonists = 15
    s.power.batteryWh = 0
    s.power.solarW = 0 // power dead
    const col0 = s.colonists
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
    expect(s.colonists).toBeLessThan(col0)
  })
})

describe('Spec 005 — Water Hub waters habitats and speeds immigration', () => {
  const building = (kind: 'habitat' | 'water', x: number, y: number, residents = 0) => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind, color: 0, height: 1, residents, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('habitats are watered only when a hub is in range', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(wateredFraction(s)).toBe(1) // no habitats yet
    s.buildings.push(building('habitat', 50, 50, 3))
    expect(wateredFraction(s)).toBe(0) // a home, no hub
    s.buildings.push(building('water', 52, 50)) // within radius 7
    expect(wateredFraction(s)).toBe(1)
  })

  it('a hub out of range does not water the habitat', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(building('habitat', 50, 50, 3))
    s.buildings.push(building('water', 80, 80)) // far beyond radius 7
    expect(wateredFraction(s)).toBe(0)
  })

  it('immigration is faster when homes are watered', () => {
    const run = (withHub: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(building('habitat', 50, 50, 20)) // capacity 22
      if (withHub) s.buildings.push(building('water', 51, 50))
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

describe('Spec 007 — Skyfarm Greenhouse grows food; colonists eat; hunger slows immigration', () => {
  const greenhouse = (x: number, y: number) => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind: 'greenhouse' as const, color: 0x4f9d52, height: 0.6, residents: 0, jobs: 2, powerLoad: 0.5, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0, componentsCost: 0 },
  })
  const waterHub = (x: number, y: number) => ({
    id: x * 1000 + y + 7,
    x,
    y,
    artifact: { id: 2, kind: 'water' as const, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })
  const habitat = (x: number, y: number, residents: number) => ({
    id: x * 1000 + y + 3,
    x,
    y,
    artifact: { id: 3, kind: 'habitat' as const, color: 0, height: 1, residents, jobs: 0, powerLoad: 0.5, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('a staffed greenhouse raises food over sim time', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.food = 0
    s.buildings.push(greenhouse(s.terrain.landing.x + 5, s.terrain.landing.y))
    s.totalJobs = 2
    s.colonists = 2 // fully staffed → free labour 0, no autoGrow interference
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.food).toBeGreaterThan(0)
  })

  it('a greenhouse near a Water Hub out-produces one with no water (irrigation boost)', () => {
    const run = (withHub: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.food = 0
      const lx = s.terrain.landing.x + 5
      const ly = s.terrain.landing.y
      s.buildings.push(greenhouse(lx, ly))
      if (withHub) s.buildings.push(waterHub(lx + 1, ly))
      s.totalJobs = 2
      s.colonists = 2
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.food
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it('colonists consume food — with no greenhouse the stockpile drains', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.food = 100
    s.colonists = 10
    s.totalJobs = 10 // fully staffed → free labour 0, no autoGrow interference
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.food).toBeLessThan(100)
  })

  it('immigration is slower when the colony is hungry (food 0) than when fed', () => {
    const run = (fed: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(habitat(50, 50, 20)) // capacity 22
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      s.materials = 0 // disable autoGrow so this isolates immigration
      s.food = fed ? 1000 : 0
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})
