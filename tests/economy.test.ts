import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { autoGrow, freeLabour, stepBuild, housingCapacity, wateredFraction, provisionedFraction, healthFraction, cultureFraction, homeLiveability, colonyLiveability, surveyAvailable, liveabilityTint, tradeExportRate, cultureFuelFactor, courierAvailable, colonyHeadlines, type ColonyBuilding } from '../src/colony/build'
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

describe('Spec 008 — Ration Depot delivers food to the homes in reach', () => {
  const mk = (kind: 'habitat' | 'depot' | 'water', x: number, y: number, residents = 0) => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind, color: 0, height: 1, residents, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('a depot provisions habitats within reach when the stockpile has food', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.food = 50
    s.buildings.push(mk('habitat', 50, 50, 3))
    expect(provisionedFraction(s)).toBe(0) // a home, no depot
    s.buildings.push(mk('depot', 52, 50)) // within radius 8
    expect(provisionedFraction(s)).toBe(1)
  })

  it('a depot out of reach does not provision the home', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.food = 50
    s.buildings.push(mk('habitat', 50, 50, 3))
    s.buildings.push(mk('depot', 80, 80)) // far beyond radius 8
    expect(provisionedFraction(s)).toBe(0)
  })

  it('no provisioning when the stockpile is empty — a depot cannot hand out what is not there', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.food = 0
    s.buildings.push(mk('habitat', 50, 50, 3))
    s.buildings.push(mk('depot', 52, 50))
    expect(provisionedFraction(s)).toBe(0)
  })

  it('immigration is faster when homes are provisioned by a depot than when food sits undelivered', () => {
    const run = (withDepot: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('habitat', 50, 50, 20)) // capacity 22
      s.buildings.push(mk('water', 51, 50)) // watered, so this isolates delivery
      if (withDepot) s.buildings.push(mk('depot', 52, 50))
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      s.food = 1000 // food in stock either way — the difference is whether it reaches the homes
      s.materials = 0 // disable autoGrow so this isolates immigration
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

describe('Spec 006 — housing evolution: homes upgrade when watered + supplied, devolve when dry', () => {
  const mkHab = (x: number, y: number, residents: number): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind: 'habitat', color: 0, height: 1, residents, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })
  const mkWater = (x: number, y: number): ColonyBuilding => ({
    id: x * 1000 + y + 1,
    x,
    y,
    artifact: { id: 2, kind: 'water', color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('a watered habitat with spare components climbs tiers, gains capacity, and consumes components', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mkHab(50, 50, 3)
    s.buildings.push(h)
    s.buildings.push(mkWater(51, 50)) // within radius — the home is watered
    s.components = 100
    s.materials = 0 // disable autoGrow so this isolates housing evolution
    const cap0 = housingCapacity(s)
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60) // 60 sim-hours → several upgrade intervals
    expect(h.tier!).toBeGreaterThan(1)
    expect(housingCapacity(s)).toBeGreaterThan(cap0)
    expect(s.components).toBeLessThan(100) // components were consumed on each upgrade
  })

  it('an unwatered habitat never upgrades', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mkHab(50, 50, 3)
    s.buildings.push(h) // no Water Hub in range
    s.components = 100
    s.materials = 0
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier ?? 1).toBe(1)
  })

  it('a watered habitat with no components cannot upgrade — the component sink gates it', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mkHab(50, 50, 3)
    s.buildings.push(h)
    s.buildings.push(mkWater(51, 50))
    s.components = 0
    s.materials = 0
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier ?? 1).toBe(1)
  })

  it('a habitat devolves a tier when it loses water past the grace period', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mkHab(50, 50, 3)
    h.tier = 3 // start at the top, then go dry (no Water Hub)
    s.buildings.push(h)
    s.materials = 0
    const cap0 = housingCapacity(s)
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier!).toBeLessThan(3)
    expect(housingCapacity(s)).toBeLessThan(cap0)
  })
})

describe('Spec 009 — First Aid Clinic: health keeps the workers productive', () => {
  const mk = (kind: 'habitat' | 'clinic' | 'mine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a clinic keeps the homes within reach healthy', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', 50, 50, { residents: 3 }))
    expect(healthFraction(s)).toBe(0) // a home, no clinic
    s.buildings.push(mk('clinic', 52, 50)) // within radius 8
    expect(healthFraction(s)).toBe(1)
  })

  it('a clinic out of reach does not cover the home', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', 50, 50, { residents: 3 }))
    s.buildings.push(mk('clinic', 80, 80)) // far beyond radius 8
    expect(healthFraction(s)).toBe(0)
  })

  it('a colony with clinic coverage out-produces an unhealthy one (sick workers dig slower)', () => {
    const run = (withClinic: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.materials = 10
      s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 }))
      s.buildings.push(mk('habitat', 50, 50, { residents: 3 })) // a home → worker health now matters
      if (withClinic) s.buildings.push(mk('clinic', 51, 50)) // covers the home
      s.totalJobs = 6
      s.colonists = 6 // fully staff the mine; no free labour, so autoGrow stays idle
      const m0 = s.materials
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

describe('Spec 010 — Holo-Theatre: culture draws the skilled settlers', () => {
  const mk = (kind: 'habitat' | 'theatre' | 'water', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a theatre brings culture to the homes within reach', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', 50, 50, { residents: 3 }))
    expect(cultureFraction(s)).toBe(0) // a home, no theatre
    s.buildings.push(mk('theatre', 52, 50)) // within radius 8
    expect(cultureFraction(s)).toBe(1)
  })

  it('a theatre out of reach does not culture the home', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', 50, 50, { residents: 3 }))
    s.buildings.push(mk('theatre', 80, 80)) // far beyond radius 8
    expect(cultureFraction(s)).toBe(0)
  })

  it('immigration is faster with a Holo-Theatre (culture draws settlers) than without', () => {
    const run = (withTheatre: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('habitat', 50, 50, { residents: 20 })) // capacity 22
      s.buildings.push(mk('water', 51, 50)) // watered — equal baseline both runs
      if (withTheatre) s.buildings.push(mk('theatre', 52, 50)) // cultured
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      s.food = 1000 // fed equally either way
      s.materials = 0 // disable autoGrow so this isolates the culture bonus
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

describe('Spec 011 — Civic Pulse Survey Office + the liveability map', () => {
  const mk = (kind: 'habitat' | 'water' | 'depot' | 'clinic' | 'theatre' | 'survey', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a bare home scores near zero; a fully-served tier-3 home scores near one', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const home = mk('habitat', 50, 50, { residents: 3 })
    s.buildings.push(home)
    expect(homeLiveability(s, home)).toBeLessThan(0.1) // unserved, tier 1
    // surround it with every service, stock food, raise its tier
    s.food = 100
    s.buildings.push(mk('water', 51, 50))
    s.buildings.push(mk('depot', 51, 51))
    s.buildings.push(mk('clinic', 49, 50))
    s.buildings.push(mk('theatre', 50, 51))
    home.tier = 3
    expect(homeLiveability(s, home)).toBeGreaterThan(0.9)
    expect(colonyLiveability(s)).toBeGreaterThan(0.9) // the only home, so the colony mean matches
  })

  it('the overlay is available only once a survey office is built and the colony is peopled', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 10
    expect(surveyAvailable(s)).toBe(false) // no office yet
    s.buildings.push(mk('survey', 50, 50))
    expect(surveyAvailable(s)).toBe(true)
    s.colonists = 0
    expect(surveyAvailable(s)).toBe(false) // no one to staff it
  })

  it('the tint runs amber (starved) to cyan (thriving)', () => {
    const red = (h: number) => (h >> 16) & 0xff
    const blue = (h: number) => h & 0xff
    expect(red(liveabilityTint(0))).toBeGreaterThan(red(liveabilityTint(1))) // amber is redder
    expect(blue(liveabilityTint(1))).toBeGreaterThan(blue(liveabilityTint(0))) // cyan is bluer
  })
})

describe('Spec 012 — Skybridge Exchange trades surplus for treasury', () => {
  const mk = (kind: 'exchange', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a staffed exchange ships surplus components above the reserve and earns treasury', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('exchange', 50, 50, { jobs: 2 }))
    s.components = 60
    s.food = 0
    s.totalJobs = 2
    s.colonists = 2 // fully staffed
    s.treasury = 1000
    const c0 = s.components
    const t0 = s.treasury
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10)
    expect(s.components).toBeLessThan(c0) // surplus shipped out
    expect(s.components).toBeGreaterThanOrEqual(COLONY.build.tradeComponentReserve) // never traded below the reserve
    expect(s.treasury).toBeGreaterThan(t0) // earned coin
  })

  it('nothing is exported when the stockpiles sit at the reserve', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('exchange', 50, 50, { jobs: 2 }))
    s.components = COLONY.build.tradeComponentReserve
    s.food = COLONY.build.tradeFoodReserve
    s.totalJobs = 2
    s.colonists = 2
    s.treasury = 1000
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
    expect(s.components).toBe(COLONY.build.tradeComponentReserve) // no surplus → no component trade
    expect(s.treasury).toBe(1000) // nothing sold, so no trade income (food only fell to colonists eating)
  })

  it('an exchange with no staff trades nothing', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('exchange', 50, 50, { jobs: 2 }))
    s.components = 60
    s.totalJobs = 0
    s.colonists = 0 // nobody to work it → staffing 0
    const c0 = s.components
    expect(tradeExportRate(s)).toBe(0)
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
    expect(s.components).toBe(c0)
  })
})

describe('Spec 013 — Reel Foundry refines components into luxury reels', () => {
  const mk = (kind: 'foundry' | 'exchange', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a staffed foundry turns components into reels', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('foundry', 50, 50, { jobs: 2 }))
    s.components = 50
    s.reels = 0
    s.totalJobs = 2
    s.colonists = 2 // fully staffed
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.reels).toBeGreaterThan(0)
    expect(s.components).toBeLessThan(50) // components consumed to weave the reels
  })

  it('a foundry with no components makes no reels', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('foundry', 50, 50, { jobs: 2 }))
    s.components = 0
    s.reels = 0
    s.totalJobs = 2
    s.colonists = 2
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.reels).toBe(0)
  })

  it('the Exchange exports surplus reels above the reserve, earning the premium', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('exchange', 50, 50, { jobs: 2 }))
    s.reels = 20
    s.components = 0
    s.food = 0
    s.totalJobs = 2
    s.colonists = 2
    s.treasury = 1000
    const r0 = s.reels
    const t0 = s.treasury
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10)
    expect(s.reels).toBeLessThan(r0) // reels shipped out
    expect(s.reels).toBeGreaterThanOrEqual(COLONY.build.reelReserve) // never below the reserve
    expect(s.treasury).toBeGreaterThan(t0) // the premium earned
  })
})

describe('Spec 014 — reel-fed theatres: culture needs the luxury good', () => {
  const mk = (kind: 'theatre' | 'habitat' | 'water', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a theatre runs at full culture with reels, dampened without, and no theatre is unaffected', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(cultureFuelFactor(s)).toBe(1) // no theatre at all
    s.buildings.push(mk('theatre', 50, 50))
    s.reels = 10
    expect(cultureFuelFactor(s)).toBe(1) // fuelled
    s.reels = 0
    expect(cultureFuelFactor(s)).toBe(COLONY.build.cultureStarvedFactor) // halls go dark
  })

  it('a staffed theatre burns reels from the stockpile', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('theatre', 50, 50, { jobs: 2 }))
    s.reels = 10
    s.totalJobs = 2
    s.colonists = 2
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.reels).toBeLessThan(10) // the shows consumed reels
  })

  it('immigration is faster when theatres are reel-fed than when they have run dry', () => {
    const run = (fed: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('habitat', 50, 50, { residents: 20 })) // capacity 22
      s.buildings.push(mk('water', 51, 50))
      s.buildings.push(mk('theatre', 52, 50))
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      s.food = 1000
      s.materials = 0 // disable autoGrow
      s.reels = fed ? 1000 : 0 // plenty of reels vs none — same theatre coverage either way
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

describe('Spec 015 — the full-service top tier: grand homes demand the whole stack', () => {
  const mkHab = (x: number, y: number, residents: number): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind: 'habitat', color: 0, height: 1, residents, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })
  const svc = (kind: 'water' | 'depot' | 'clinic' | 'theatre', x: number, y: number): ColonyBuilding => ({
    id: x * 1000 + y + 7,
    x,
    y,
    artifact: { id: 2, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('a watered home with components reaches T2 but cannot reach T3 without the full stack', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mkHab(50, 50, 3)
    s.buildings.push(h)
    s.buildings.push(svc('water', 51, 50))
    s.components = 100
    s.materials = 0
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier).toBe(2) // climbs to T2, then stuck — no food / health / culture
  })

  it('a fully-served home (water + food + clinic + theatre) climbs to T3', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mkHab(50, 50, 3)
    s.buildings.push(h)
    s.food = 100
    s.buildings.push(svc('water', 51, 50))
    s.buildings.push(svc('depot', 51, 51))
    s.buildings.push(svc('clinic', 49, 50))
    s.buildings.push(svc('theatre', 50, 51))
    s.components = 100
    s.materials = 0
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier).toBe(3) // the whole stack in reach → the grandest tier
  })

  it('a tier-3 home devolves when it loses a service', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mkHab(50, 50, 3)
    h.tier = 3
    s.buildings.push(h)
    s.food = 100
    s.buildings.push(svc('water', 51, 50))
    s.buildings.push(svc('depot', 51, 51))
    s.buildings.push(svc('clinic', 49, 50))
    // no theatre in range → not fully served
    s.components = 100
    s.materials = 0
    const cap0 = housingCapacity(s)
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier!).toBeLessThan(3)
    expect(housingCapacity(s)).toBeLessThan(cap0)
  })
})

describe('Spec 016 — the Kookerverse Courier broadcasts the colony news', () => {
  const mk = (kind: 'mast' | 'water' | 'habitat' | 'theatre', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the Courier is available only from a built, staffed mast', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 10
    expect(courierAvailable(s)).toBe(false) // no mast
    s.buildings.push(mk('mast', 50, 50))
    expect(courierAvailable(s)).toBe(true)
    s.colonists = 0
    expect(courierAvailable(s)).toBe(false) // nobody to operate it
  })

  it('headlines reflect real state — a T3 district, reels out, and a named citizen', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('water', 40, 40)) // Mara's hub
    const h = mk('habitat', 50, 50, { residents: 3 })
    h.tier = 3
    s.buildings.push(h)
    s.buildings.push(mk('theatre', 60, 60))
    s.reels = 0
    const lines = colonyHeadlines(s)
    expect(lines.some((l) => /Tier 3/i.test(l))).toBe(true)
    expect(lines.some((l) => /reels run dry/i.test(l))).toBe(true)
    expect(lines.some((l) => /Mara Venn/i.test(l))).toBe(true)
  })

  it('reports the reels gleaming when there is stock and no shortage', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.reels = 10 // no theatre, plenty of reels
    const lines = colonyHeadlines(s)
    expect(lines.some((l) => /reels gleam/i.test(l))).toBe(true)
    expect(lines.some((l) => /reels run dry/i.test(l))).toBe(false)
  })
})
