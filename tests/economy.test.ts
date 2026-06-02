import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { autoGrow, freeLabour, stepBuild, housingCapacity, wateredFraction, provisionedFraction, healthFraction, cultureFraction, homeLiveability, colonyLiveability, surveyAvailable, liveabilityTint, tradeExportRate, cultureFuelFactor, courierAvailable, colonyHeadlines, inBrownout, polluted, pollutedFraction, commute, maintenanceStatus, storageCaps, storageStatus, incidentStatus, levyActive, feverWatchActive, feverStatus, housewaresSupplied, luxurySupplied, housewaresFraction, wardActive, unrestStatus, payOfficeActive, payrollPerDay, feastDeckActive, canCallFeast, callFeast, feasting, liaisonActive, fulfillRequest, spireComplete, fundSpireStage, type ColonyBuilding } from '../src/colony/build'
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
  const svc = (kind: 'water' | 'depot' | 'clinic' | 'theatre' | 'market', x: number, y: number): ColonyBuilding => ({
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
    s.buildings.push(svc('market', 49, 51)) // spec 027 — a Housewares Market delivers the luxury wares the top tier needs
    s.components = 100
    s.reels = 100 // spec 027 — luxury wares (reels) in stock to deliver
    s.linen = 100 // spec 031 — linen on hand, which the top tier also needs
    s.materials = 0
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier).toBe(3) // the whole stack + delivered luxury wares → the grandest tier
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

describe('Spec 017 — Brownout Priority Grid: power gets teeth', () => {
  const mine = (x: number, y: number): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind: 'mine', color: 0, height: 1, residents: 0, jobs: 6, powerLoad: 0.3, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 5 },
  })

  it('a brownout needs BOTH an over-loaded grid and a drained battery', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.power.batteryWh = s.power.batteryCapWh
    s.power.loadW = 100 // full battery, heavy load
    expect(inBrownout(s)).toBe(false) // healthy battery → the grid rides it out
    s.power.batteryWh = 0 // now drained, still over capacity
    expect(inBrownout(s)).toBe(true)
    s.power.loadW = 0 // drained but no load
    expect(inBrownout(s)).toBe(false)
  })

  it('an under-powered colony produces less — heavy industry runs at the brownout factor', () => {
    const run = (powered: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.materials = 10
      s.buildings.push(mine(s.terrain.landing.x + 3, s.terrain.landing.y))
      s.totalJobs = 6
      s.colonists = 6 // fully staffed
      s.power.solarW = 1 // a little sun, so this is a brownout — not a total blackout
      if (powered) {
        s.power.batteryWh = s.power.batteryCapWh
        s.power.loadW = 0
      } else {
        s.power.batteryWh = 0
        s.power.loadW = 100 // drained + over capacity → brownout
      }
      const m0 = s.materials
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})

describe('Spec 018 — Battery Sheds buffer the grid (built from reels)', () => {
  it('a finished Battery Shed raises the colony battery capacity', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const cap0 = s.power.batteryCapWh
    s.jobs.push({
      id: 1,
      x: s.terrain.landing.x + 3,
      y: s.terrain.landing.y,
      artifact: { id: 1, kind: 'battery', color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
      progress: 0.95,
      path: [],
    })
    for (let i = 0; i < 5; i++) stepBuild(s, sim.rng, 10) // the shed finishes
    expect(s.power.batteryCapWh).toBe(cap0 + COLONY.build.batteryShedCapWh)
  })

  it('building a Battery Shed draws down reels (the luxury good) to construct', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 5
    s.materials = 50
    s.components = 50
    s.reels = 10
    s.food = 100
    s.treasury = 5000
    s.power.batteryWh = 0
    s.power.loadW = 100 // brownout-prone grid → autoGrow buffers it with a Battery Shed
    const r0 = s.reels
    const ok = autoGrow(s, sim.rng)
    expect(ok).toBe(true)
    expect(s.jobs[s.jobs.length - 1]!.artifact.kind).toBe('battery')
    expect(s.reels).toBe(r0 - COLONY.build.reelBattery) // reels consumed to build it
  })
})

describe('Spec 019 — Smog Drift + Air Scrubber Gardens', () => {
  const mk = (kind: 'habitat' | 'mine' | 'foundry' | 'scrubber' | 'water' | 'depot' | 'clinic' | 'theatre' | 'market', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a home beside a mine breathes smog; a scrubber garden clears it', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mk('habitat', 50, 50, { residents: 3 })
    s.buildings.push(h)
    expect(polluted(s, h)).toBe(false) // no industry near
    s.buildings.push(mk('mine', 53, 50)) // within the smog radius
    expect(polluted(s, h)).toBe(true)
    expect(pollutedFraction(s)).toBe(1)
    s.buildings.push(mk('scrubber', 51, 50)) // within the scrubber radius
    expect(polluted(s, h)).toBe(false) // air cleared
  })

  it('a polluted home loses liveability and is blocked from the top tier until a scrubber clears it', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mk('habitat', 50, 50, { residents: 3 })
    s.buildings.push(h)
    s.food = 100
    s.buildings.push(mk('water', 51, 50))
    s.buildings.push(mk('depot', 51, 51))
    s.buildings.push(mk('clinic', 49, 50))
    s.buildings.push(mk('theatre', 50, 51))
    s.buildings.push(mk('foundry', 52, 50)) // fouls the air
    s.buildings.push(mk('market', 49, 51)) // spec 027 — delivers the luxury wares the top tier needs
    s.components = 100
    s.reels = 100 // spec 027 — luxury wares in stock
    s.linen = 100 // spec 031 — linen on hand for the top tier
    s.materials = 0
    const livSmoggy = homeLiveability(s, h)
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier!).toBeLessThan(3) // smog blocks the top tier
    s.buildings.push(mk('scrubber', 50, 49)) // plant a garden over the home
    expect(homeLiveability(s, h)).toBeGreaterThan(livSmoggy) // liveability restored once cleared
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    expect(h.tier!).toBe(3) // now it can climb to the top
  })
})

describe('Spec 020 — the Skillhouse Academy: skilled workers speed the advanced trades', () => {
  const mk = (kind: 'academy' | 'workshop' | 'mine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a staffed Skillhouse Academy trains skilled workers over time', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('academy', 50, 50, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 10
    s.skilled = 0
    s.materials = 0
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
    expect(s.skilled).toBeGreaterThan(0)
  })

  it('a workshop refines faster with skilled workers than without', () => {
    const run = (trained: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.materials = 200
      s.components = 0
      s.buildings.push(mk('workshop', 50, 50, { jobs: 5 }))
      s.totalJobs = 5
      s.colonists = 5
      s.skilled = trained ? 5 : 0 // trained enough to cover the trade vs none
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.components
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it('basic production (a mine) is unaffected by skill', () => {
    const run = (trained: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.materials = 10
      s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 }))
      s.totalJobs = 6
      s.colonists = 6
      s.skilled = trained ? 100 : 0
      const m0 = s.materials
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(true)).toBe(run(false)) // mining doesn't need the academy
  })
})

describe('Spec 021 — Skybridge Transit Depots: congestion slows production', () => {
  const mk = (kind: 'mine' | 'transit', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a small colony is not congested; a packed one is — until depots carry the crush', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 5
    s.totalJobs = 5
    expect(commute(s).congested).toBe(false) // 5 workers under the base capacity
    s.colonists = 20
    s.totalJobs = 20
    expect(commute(s).congested).toBe(true) // packed in beyond capacity
    s.buildings.push(mk('transit', 50, 50))
    s.buildings.push(mk('transit', 51, 50))
    expect(commute(s).congested).toBe(false) // two depots carry the 20
  })

  it('a congested colony mines less than the same colony with enough Transit Depots', () => {
    const run = (depots: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.materials = 10
      s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 30, materialsGen: 5 }))
      s.totalJobs = 30
      s.colonists = 30 // demand 30 well over the base capacity → congested
      for (let i = 0; i < depots; i++) s.buildings.push(mk('transit', 60 + i, 60))
      const m0 = s.materials
      for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(3)).toBeGreaterThan(run(0)) // depots clear the congestion → more mined
  })
})

describe('Spec 023 — Storehouse Platforms: finite storage, the surplus goes overboard', () => {
  const mk = (kind: 'storehouse' | 'mine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('storage caps grow with each Storehouse Platform', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const base = storageCaps(s)
    expect(base.materials).toBe(COLONY.build.storeBaseMaterials)
    expect(base.reels).toBe(COLONY.build.storeBaseReels)
    s.buildings.push(mk('storehouse', 50, 50, { jobs: COLONY.build.storehouseWorkers }))
    const one = storageCaps(s)
    expect(one.materials).toBe(COLONY.build.storeBaseMaterials + COLONY.build.storePerMaterials)
    expect(one.components).toBe(COLONY.build.storeBaseComponents + COLONY.build.storePerComponents)
  })

  it('a resource is clamped to its cap and the overflow is discarded', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const cap = storageCaps(s).materials
    s.materials = cap + 500 // way over the founders' hold
    s.colonists = 4
    s.totalJobs = 4
    stepBuild(s, sim.rng, 10)
    expect(s.materials).toBe(cap) // overflow lost, pinned at the cap (no consumers here)
    expect(storageStatus(s).full).toBe(true)
  })

  it('a Storehouse Platform lets the colony hold more than the base cap', () => {
    const run = (store: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      if (store) s.buildings.push(mk('storehouse', 50, 50, { jobs: COLONY.build.storehouseWorkers }))
      s.materials = 100000 // try to hoard everything
      stepBuild(s, sim.rng, 10)
      return s.materials
    }
    expect(run(false)).toBe(COLONY.build.storeBaseMaterials) // base hold without a platform
    expect(run(true)).toBe(COLONY.build.storeBaseMaterials + COLONY.build.storePerMaterials) // one platform → higher ceiling
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it('the founding economy stays well under cap (no clamping in normal early play)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 }))
    s.colonists = 6
    s.totalJobs = 6
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10) // ~1.4 days of a small mining colony
    const cap = storageCaps(s)
    expect(s.materials).toBeLessThan(cap.materials) // never touches the ceiling in early play
    expect(storageStatus(s).full).toBe(false)
  })
})

describe('Spec 024 — Emergency Bellhouse: incidents strike, get answered, or hit a consequence', () => {
  const mk = (kind: 'mine' | 'bellhouse', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a building with an active incident produces nothing', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    s.materials = 5
    const mine = mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 })
    s.buildings.push(mine)
    mine.incident = { timer: 100000 } // a long-running emergency — the mine stays paused
    const m0 = s.materials
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10)
    expect(s.materials - m0).toBeLessThan(0.001) // paused → no mining
    expect(incidentStatus(s).active).toBe(1)
  })

  it('a staffed Emergency Bellhouse resolves an incident and the building recovers', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 8
    s.totalJobs = 8
    s.materials = 5
    const mine = mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 })
    s.buildings.push(mine, mk('bellhouse', s.terrain.landing.x + 4, s.terrain.landing.y, { jobs: COLONY.build.bellhouseWorkers }))
    mine.incident = { timer: COLONY.build.incidentMin }
    const steps = Math.ceil(COLONY.build.incidentMin / 10) + 5
    for (let i = 0; i < steps; i++) stepBuild(s, sim.rng, 10)
    expect(mine.incident).toBeUndefined() // a crew answered in time
    expect(mine.wear ?? 0).toBeLessThan(1) // resolved, not destroyed
    const m1 = s.materials
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10)
    expect(s.materials - m1).toBeGreaterThan(0) // mining resumed
  })

  it('an unanswered incident times out: the building is worn out and stored goods are lost', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    s.materials = 100
    const mine = mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 })
    s.buildings.push(mine) // no Bellhouse → nobody answers
    mine.wear = 0.3
    mine.incident = { timer: COLONY.build.incidentMin }
    const steps = Math.ceil(COLONY.build.incidentMin / 10) + 2
    for (let i = 0; i < steps; i++) stepBuild(s, sim.rng, 10)
    expect(mine.incident).toBeUndefined() // the incident is over
    expect(mine.wear).toBe(1) // left worn-out by the disaster
    expect(s.materials).toBeLessThanOrEqual(80) // a chunk of materials destroyed (cave-in), ~25% of 100
  })

  it('a healthy colony in normal play sees no incidents', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 }))
    s.colonists = 6
    s.totalJobs = 6
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10)
    expect(s.buildings.every((b) => !b.incident)).toBe(true) // calm, well-kept colony — nothing catches
  })

  it('a worn building under colony stress eventually suffers an incident', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const mine = mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 })
    s.buildings.push(mine)
    mine.wear = 0.95 // badly worn
    s.colonists = 30
    s.totalJobs = 30 // congested (demand 30 over capacity 8) → stressed
    let fired = false
    for (let i = 0; i < 1500 && !fired; i++) {
      stepBuild(s, sim.rng, 10)
      if (mine.incident) fired = true
    }
    expect(fired).toBe(true) // sustained worn + stressed → it goes up
  })
})

describe('Spec 025 — The Levy Office: the council sets a fiscal rate with a real tradeoff', () => {
  const mk = (kind: 'levy' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the levy is inert until a Levy Office is built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(levyActive(s)).toBe(false) // no office
    s.buildings.push(mk('levy', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 0
    expect(levyActive(s)).toBe(false) // office, but nobody to clerk it
    s.colonists = 6
    expect(levyActive(s)).toBe(true) // built + staffed
  })

  const incomeAfterOneDay = (rate: 'low' | 'normal' | 'high', withOffice: boolean) => {
    const sim = new ColonySim(7)
    const s = sim.state
    if (withOffice) s.buildings.push(mk('levy', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 12
    s.totalJobs = 2
    s.levyRate = rate
    s.treasury = 0
    s.clock.day = 1
    s.lastIncomeDay = 0 // force the daily income to settle on this step
    stepBuild(s, sim.rng, 10)
    return s.treasury
  }

  it('with a staffed office, a higher levy earns more treasury per day', () => {
    expect(incomeAfterOneDay('high', true)).toBeGreaterThan(incomeAfterOneDay('normal', true))
    expect(incomeAfterOneDay('normal', true)).toBeGreaterThan(incomeAfterOneDay('low', true))
  })

  it('with no Levy Office the rate is inert — income is identical at every setting', () => {
    expect(incomeAfterOneDay('high', false)).toBe(incomeAfterOneDay('low', false))
    expect(incomeAfterOneDay('normal', false)).toBe(incomeAfterOneDay('low', false))
  })

  it('a gentle levy draws more settlers than a hard one', () => {
    const immigrationUnder = (rate: 'low' | 'high') => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('levy', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      s.buildings.push(mk('habitat', s.terrain.landing.x + 4, s.terrain.landing.y, { residents: 9 })) // room to grow
      s.colonists = 4
      s.totalJobs = 2
      s.levyRate = rate
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5 // liveable, so settlers can arrive
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(immigrationUnder('low')).toBeGreaterThan(immigrationUnder('high')) // gentle dues → more settlers
  })
})

describe('Spec 026 — The Fever Watch: an outbreak that spreads, sickens, and is contained', () => {
  const mk = (kind: 'habitat' | 'mine' | 'clinic' | 'feverwatch', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the Fever Watch only contains while a post is built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(feverWatchActive(s)).toBe(false) // no post
    s.buildings.push(mk('feverwatch', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 0
    expect(feverWatchActive(s)).toBe(false) // post, but nobody to crew it
    s.colonists = 6
    expect(feverWatchActive(s)).toBe(true) // built + staffed
  })

  it('a well-served colony never sees an outbreak (normal play is unaffected)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x + 2, L.y, { residents: 9 }))
    s.buildings.push(mk('clinic', L.x + 2, L.y, { jobs: 2 })) // covers the home → healthy
    s.buildings.push(mk('mine', L.x + 5, L.y, { jobs: 6, materialsGen: 5 }))
    s.colonists = 4
    s.totalJobs = 8
    for (let i = 0; i < 300; i++) stepBuild(s, sim.rng, 10)
    expect(s.outbreak).toBe(0) // healthy homes → zero fever pressure, even as it fills
    expect(feverStatus(s).outbreak).toBe(0)
  })

  it('a sick colony (injected outbreak) produces less than a healthy one', () => {
    const run = (outbreak: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 }))
      s.colonists = 6
      s.totalJobs = 6
      s.materials = 5
      s.outbreak = outbreak
      const m0 = s.materials
      for (let i = 0; i < 40; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(0.6)).toBeLessThan(run(0)) // a fevered workforce digs less
  })

  it('a staffed Fever Watch Post contains an outbreak — it decays back down', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('feverwatch', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 6
    s.totalJobs = 6
    s.outbreak = 0.6
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10) // ~1.4 days of response work
    expect(s.outbreak).toBeLessThan(0.1) // the curve bends back down
  })

  it('sustained bad conditions (crowded + smoggy + unhealthy) grow an outbreak from nothing', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x + 2, L.y, { residents: 3 }))
    s.buildings.push(mk('habitat', L.x + 3, L.y, { residents: 3 }))
    s.buildings.push(mk('mine', L.x + 2, L.y + 1, { jobs: 6, materialsGen: 5 })) // smog over the homes, no scrubber
    s.colonists = 8 // packed in (cap 2 + 3 + 3 = 8) and no clinic
    s.totalJobs = 8
    expect(s.outbreak).toBe(0)
    for (let i = 0; i < 400; i++) stepBuild(s, sim.rng, 10) // ~2.8 days
    expect(s.outbreak).toBeGreaterThan(0.1) // the fever takes hold and spreads
  })

  it('clinics soften an outbreak — a covered colony out-produces an uncovered one at the same fever', () => {
    const run = (withClinic: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const L = s.terrain.landing
      s.buildings.push(mk('habitat', L.x + 2, L.y, { residents: 3 }))
      s.buildings.push(mk('mine', L.x + 3, L.y, { jobs: 6, materialsGen: 5 }))
      if (withClinic) s.buildings.push(mk('clinic', L.x + 2, L.y, { jobs: 2 }))
      s.colonists = 6
      s.totalJobs = 6
      s.materials = 5
      s.outbreak = 0.6
      const m0 = s.materials
      for (let i = 0; i < 20; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(true)).toBeGreaterThan(run(false)) // a clinic lowers the severity → more mined
  })
})

describe('Spec 027 — The Housewares Market: manufactured goods reach the home', () => {
  const mk = (kind: 'habitat' | 'water' | 'depot' | 'clinic' | 'theatre' | 'market', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a market delivers wares to homes in range while the colony holds the goods', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mk('habitat', 50, 50, { residents: 3 })
    s.buildings.push(h)
    expect(housewaresSupplied(s, h)).toBe(false) // no market at all
    s.buildings.push(mk('market', 49, 50))
    s.components = 0
    expect(housewaresSupplied(s, h)).toBe(false) // a market, but no wares in stock to deliver
    s.components = 50
    expect(housewaresSupplied(s, h)).toBe(true) // market in range + stock on hand
    expect(luxurySupplied(s, h)).toBe(false) // ...but no reels → no luxury wares
    s.reels = 10
    expect(luxurySupplied(s, h)).toBe(true) // reels in stock → luxury wares delivered
    const far = mk('habitat', 85, 85, { residents: 3 })
    s.buildings.push(far)
    expect(housewaresSupplied(s, far)).toBe(false) // out of every market's range — delivery is spatial
  })

  const topTier = (opts: { market: boolean; reels: boolean }) => {
    const sim = new ColonySim(7)
    const s = sim.state
    const h = mk('habitat', 50, 50, { residents: 3 })
    s.buildings.push(h, mk('water', 51, 50), mk('depot', 51, 51), mk('clinic', 49, 50), mk('theatre', 50, 51))
    s.food = 100
    s.components = 100
    s.materials = 0
    if (opts.market) s.buildings.push(mk('market', 49, 51))
    s.reels = opts.reels ? 100 : 0
    s.linen = 100 // spec 031 — linen on hand so the top tier isn't blocked on the second chain
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
    return h.tier
  }

  it('a fully-served home reaches the top tier only when a market delivers luxury wares', () => {
    expect(topTier({ market: true, reels: true })).toBe(3) // full stack + delivered luxury wares → T3
    expect(topTier({ market: false, reels: true })).toBe(2) // no market → wares never reach the home → stalls at T2
    expect(topTier({ market: true, reels: false })).toBe(2) // a market but no reels → no luxury wares → stalls at T2
  })

  it('a market draws down components and reels as it delivers (a new demand sink)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', 50, 50, { residents: 3 }))
    s.buildings.push(mk('market', 49, 50))
    s.components = 50
    s.reels = 50
    s.materials = 0
    const c0 = s.components
    const r0 = s.reels
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60) // ~2.5 days of deliveries
    expect(s.components).toBeLessThan(c0) // everyday wares consumed
    expect(s.reels).toBeLessThan(r0) // luxury wares consumed
  })

  it('housewares coverage is zero without a market and rises once one reaches the homes', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', 50, 50, { residents: 3 }))
    s.components = 50
    expect(housewaresFraction(s)).toBe(0) // no market
    s.buildings.push(mk('market', 49, 50))
    expect(housewaresFraction(s)).toBe(1) // the home is in range and the colony holds wares
  })
})

describe('Spec 028 — The Ward Post: idleness and hardship breed unrest', () => {
  const mk = (kind: 'mine' | 'levy' | 'ward', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a Ward Post keeps order only while a post is built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(wardActive(s)).toBe(false) // no post
    s.buildings.push(mk('ward', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 0
    expect(wardActive(s)).toBe(false) // post, but nobody to crew it
    s.colonists = 6
    expect(wardActive(s)).toBe(true) // built + staffed
  })

  it('an idle colony with no squeeze stays orderly — idleness alone is not enough', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 2 // badly under-employed, but no hard levy and no brownout
    for (let i = 0; i < 300; i++) stepBuild(s, sim.rng, 10)
    expect(s.unrest).toBe(0) // unrest needs hardship too — idleness on its own breeds nothing
  })

  it('a restless colony (injected unrest) produces less than an orderly one', () => {
    const run = (unrest: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 }))
      s.colonists = 6
      s.totalJobs = 6
      s.materials = 5
      s.unrest = unrest
      const m0 = s.materials
      for (let i = 0; i < 40; i++) stepBuild(s, sim.rng, 10)
      return s.materials - m0
    }
    expect(run(0.6)).toBeLessThan(run(0)) // vandalism + slowdowns sap the mine
  })

  it('unrest refuses a slice of the levy income', () => {
    const incomeWith = (unrest: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 12
      s.totalJobs = 12 // fully employed, so unrest does not grow — we isolate the income effect
      s.materials = 0
      s.unrest = unrest
      s.treasury = 0
      s.clock.day = 1
      s.lastIncomeDay = 0
      stepBuild(s, sim.rng, 10)
      return s.treasury
    }
    expect(incomeWith(0.6)).toBeLessThan(incomeWith(0)) // tax refusal cuts the take
  })

  it('a staffed Ward Post calms unrest back down', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('ward', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 6
    s.totalJobs = 6
    s.unrest = 0.6
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10) // ~1.4 days of patrols
    expect(s.unrest).toBeLessThan(0.1) // the wardens hold the line
  })

  it('an idle population under a hard levy grows restless', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('levy', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 12
    s.totalJobs = 2 // most of them idle
    s.levyRate = 'high' // and squeezed hard
    expect(s.unrest).toBe(0)
    for (let i = 0; i < 400; i++) stepBuild(s, sim.rng, 10) // ~2.8 days
    expect(s.unrest).toBeGreaterThan(0.1)
    expect(unrestStatus(s).unrest).toBeGreaterThan(0.1)
  })

  it('an idle population through a long brownout grows restless', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 2 // idle
    s.power.batteryWh = 0
    s.power.solarW = 1 // a brownout, not a total blackout
    s.power.loadW = 100 // drained + over capacity → brownout
    expect(s.unrest).toBe(0)
    for (let i = 0; i < 400; i++) stepBuild(s, sim.rng, 10)
    expect(s.unrest).toBeGreaterThan(0.1)
  })
})

describe('Spec 029 — The Pay Office: the colony pays the hands that hold it up', () => {
  const mk = (kind: 'payoffice' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('wages are paid only while a Pay Office is built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(payOfficeActive(s)).toBe(false) // no office
    s.buildings.push(mk('payoffice', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 0
    expect(payOfficeActive(s)).toBe(false) // office, but nobody to clerk it
    s.colonists = 6
    expect(payOfficeActive(s)).toBe(true) // built + staffed
  })

  it('payroll is zero without an office and scales with the wage rate with one', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 10
    s.totalJobs = 10
    expect(payrollPerDay(s)).toBe(0) // no office → labour is free, as before
    s.buildings.push(mk('payoffice', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.wageRate = 'standard'
    expect(payrollPerDay(s)).toBe(10 * COLONY.build.wagePerWorkerPerDay) // 10 employed × the per-worker wage
    s.wageRate = 'generous'
    expect(payrollPerDay(s)).toBeGreaterThan(10 * COLONY.build.wagePerWorkerPerDay) // generous costs more
    s.wageRate = 'low'
    expect(payrollPerDay(s)).toBeLessThan(10 * COLONY.build.wagePerWorkerPerDay) // low costs less
  })

  const treasuryAfterDay = (rate: 'low' | 'standard' | 'generous', withOffice: boolean) => {
    const sim = new ColonySim(7)
    const s = sim.state
    if (withOffice) s.buildings.push(mk('payoffice', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 12
    s.totalJobs = 12 // fully employed → a full payroll
    s.wageRate = rate
    s.materials = 0
    s.treasury = 0
    s.clock.day = 1
    s.lastIncomeDay = 0
    stepBuild(s, sim.rng, 10)
    return s.treasury
  }

  it('a generous wage drains more treasury per day than a low one', () => {
    expect(treasuryAfterDay('generous', true)).toBeLessThan(treasuryAfterDay('low', true)) // bigger payroll → less left
  })

  it('without a Pay Office the wage rate is inert — the treasury is identical', () => {
    expect(treasuryAfterDay('generous', false)).toBe(treasuryAfterDay('low', false)) // no office → no payroll
  })

  it('a low wage on idle workers breeds unrest', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('payoffice', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 12
    s.totalJobs = 2 // most of them idle
    s.wageRate = 'low'
    expect(s.unrest).toBe(0)
    for (let i = 0; i < 400; i++) stepBuild(s, sim.rng, 10)
    expect(s.unrest).toBeGreaterThan(0.1) // a cheap wage is a squeeze
  })

  it('a generous wage calms unrest back down', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('payoffice', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 12
    s.totalJobs = 2
    s.wageRate = 'generous'
    s.unrest = 0.5
    for (let i = 0; i < 400; i++) stepBuild(s, sim.rng, 10)
    expect(s.unrest).toBeLessThan(0.2) // loyal workers settle down
  })

  it('a generous wage draws more settlers than a low one', () => {
    const immigrationUnder = (rate: 'low' | 'generous') => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('payoffice', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      s.buildings.push(mk('habitat', s.terrain.landing.x + 4, s.terrain.landing.y, { residents: 9 }))
      s.colonists = 4
      s.totalJobs = 2
      s.wageRate = rate
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(immigrationUnder('generous')).toBeGreaterThan(immigrationUnder('low')) // better pay draws people
  })
})

describe('Spec 030 — The Civic Feast: the council buys one honest cheer', () => {
  const mk = (kind: 'feast' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a feast can only be hosted from a built, staffed Feast Deck', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(feastDeckActive(s)).toBe(false) // no deck
    s.buildings.push(mk('feast', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 0
    expect(feastDeckActive(s)).toBe(false) // deck, but no stewards
    s.colonists = 6
    expect(feastDeckActive(s)).toBe(true) // built + staffed
  })

  it('calling a feast spends treasury + food + components and starts the window', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.treasury = 1000
    s.food = 100
    s.components = 100
    expect(callFeast(s)).toBe(false) // no Feast Deck → cannot call
    s.buildings.push(mk('feast', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 6
    expect(canCallFeast(s)).toBe(true)
    const t0 = s.treasury
    const f0 = s.food
    const c0 = s.components
    expect(callFeast(s)).toBe(true)
    expect(s.treasury).toBe(t0 - COLONY.build.feastTreasuryCost)
    expect(s.food).toBe(f0 - COLONY.build.feastFoodCost)
    expect(s.components).toBe(c0 - COLONY.build.feastWaresCost)
    expect(feasting(s)).toBe(true)
    expect(callFeast(s)).toBe(false) // one feast at a time
  })

  it("a feast can't be called without the treasury to fund it", () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('feast', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 6
    s.treasury = 10 // far short of the feast cost
    s.food = 100
    s.components = 100
    expect(canCallFeast(s)).toBe(false)
    expect(callFeast(s)).toBe(false)
  })

  it('a feast eases unrest faster while it runs', () => {
    const run = (withFeast: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('feast', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      s.colonists = 6
      s.totalJobs = 6
      s.unrest = 0.5
      if (withFeast) {
        s.treasury = 1000
        s.food = 100
        s.components = 100
        callFeast(s)
      }
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.unrest
    }
    expect(run(true)).toBeLessThan(run(false)) // the feast cheers the colony down faster
  })

  it('a feast draws more settlers while it runs', () => {
    const run = (withFeast: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('feast', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      s.buildings.push(mk('habitat', s.terrain.landing.x + 4, s.terrain.landing.y, { residents: 9 }))
      s.colonists = 4
      s.totalJobs = 2
      s.food = 100
      s.components = 100
      s.treasury = 1000
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      if (withFeast) callFeast(s)
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(true)).toBeGreaterThan(run(false)) // good cheer draws settlers
  })

  it('a feast lapses after its window', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('feast', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.colonists = 6
    s.totalJobs = 6
    s.treasury = 1000
    s.food = 100
    s.components = 100
    callFeast(s)
    expect(feasting(s)).toBe(true)
    s.food = 0 // so it can't auto-throw another once this one ends
    for (let i = 0; i < 500; i++) stepBuild(s, sim.rng, 60) // ~20 days, well past the feast window
    expect(feasting(s)).toBe(false) // the cheer fades
  })
})

describe('Spec 031 — The Skyflax Line: a second resource and chain', () => {
  const mk = (kind: 'skimmer' | 'weavery' | 'habitat' | 'water' | 'depot' | 'clinic' | 'theatre' | 'market', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a Flax Skimmer Dock gathers skyflax fibre while staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    s.buildings.push(mk('skimmer', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, fibreGen: 5 }))
    const f0 = s.fibre
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
    expect(s.fibre).toBeGreaterThan(f0) // the rims yield fibre
  })

  it('a Weavery weaves fibre into linen and halts when fibre runs out', () => {
    const run = (fibre: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 6
      s.totalJobs = 6
      s.buildings.push(mk('weavery', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6 }))
      s.fibre = fibre
      const l0 = s.linen
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return { linen: s.linen - l0, fibre: s.fibre }
    }
    const fed = run(50)
    expect(fed.linen).toBeGreaterThan(0) // fibre on hand → linen woven
    expect(fed.fibre).toBeLessThan(50) // ...consuming the fibre
    expect(run(0).linen).toBe(0) // no fibre → no linen
  })

  it('the top housing tier needs linen on hand', () => {
    const topTier = (linen: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const h = mk('habitat', 50, 50, { residents: 3 })
      s.buildings.push(h, mk('water', 51, 50), mk('depot', 51, 51), mk('clinic', 49, 50), mk('theatre', 50, 51), mk('market', 49, 51))
      s.food = 100
      s.components = 100
      s.reels = 100
      s.materials = 0
      s.linen = linen
      for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 60)
      return h.tier
    }
    expect(topTier(100)).toBe(3) // full stack + luxury wares + linen → the grandest tier
    expect(topTier(0)).toBe(2) // everything but linen → stalls below the top
  })

  it('clinics draw linen as bandage cloth, more during a fever outbreak', () => {
    const drained = (outbreak: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 6
      s.totalJobs = 6
      s.buildings.push(mk('clinic', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      s.linen = 100
      s.outbreak = outbreak
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return 100 - s.linen
    }
    expect(drained(0)).toBeGreaterThan(0) // a clinic always uses a little
    expect(drained(0.8)).toBeGreaterThan(drained(0)) // an outbreak burns through dressings
  })

  it('fibre and linen are capped by storage and the founding economy never has them', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const caps = storageCaps(s)
    expect(caps.fibre).toBe(COLONY.build.storeBaseFibre)
    expect(caps.linen).toBe(COLONY.build.storeBaseLinen)
    s.fibre = 100000
    s.linen = 100000
    s.colonists = 4
    s.totalJobs = 4
    stepBuild(s, sim.rng, 10)
    expect(s.fibre).toBe(caps.fibre) // overflow clamped (spec 023)
    expect(s.linen).toBe(caps.linen)
  })
})

describe('Spec 032 — The Kookerverse Liaison Office: standing and Civic Requests', () => {
  const mk = (kind: 'liaison' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the Kookerverse only deals with a built, staffed Liaison Office', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(liaisonActive(s)).toBe(false) // no office
    s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 0
    expect(liaisonActive(s)).toBe(false) // office, but nobody to clerk it
    s.colonists = 6
    expect(liaisonActive(s)).toBe(true) // built + staffed
  })

  it('a staffed office draws a Civic Request from the wider world', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    s.components = 50
    s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    expect(s.request).toBe(null)
    stepBuild(s, sim.rng, 10) // requestCooldown starts at 0 → the first request arrives
    expect(s.request).not.toBe(null)
    expect(s.request?.good).toBe('components') // the colony's most-stocked good
  })

  it('fulfilling a request spends the good and raises standing', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    s.components = 50
    s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.request = { good: 'components', amount: 15, deadline: 4320 }
    s.standing = 0.5
    const c0 = s.components
    expect(fulfillRequest(s)).toBe(true)
    expect(s.components).toBe(c0 - 15) // dispatched through the Bank
    expect(s.standing).toBeGreaterThan(0.5) // standing rose
    expect(s.request).toBe(null) // the request is closed
  })

  it('missing a request lowers standing', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    s.components = 5 // far short of the quota
    s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.request = { good: 'components', amount: 15, deadline: 60 } // a short fuse
    s.standing = 0.5
    for (let i = 0; i < 20; i++) stepBuild(s, sim.rng, 10) // past the deadline
    expect(s.standing).toBeLessThan(0.5) // the miss cost standing
    expect(s.request).toBe(null)
  })

  it('high standing draws more settlers than low standing', () => {
    const run = (standing: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      s.buildings.push(mk('habitat', s.terrain.landing.x + 4, s.terrain.landing.y, { residents: 9 }))
      s.colonists = 4
      s.totalJobs = 2
      s.standing = standing
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(1.0)).toBeGreaterThan(run(0.0)) // recognition draws people, disrepute repels them
  })

  it('with no Liaison Office, standing stays neutral and no requests arrive (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10)
    expect(s.request).toBe(null)
    expect(s.standing).toBe(0.5)
  })
})

describe('Spec 033 — The Horizon Spire: a monument the colony builds toward', () => {
  const mk = (kind: 'liaison' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('funding a stage spends its bundle and begins the build', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.totalJobs = 0 // 20 free hands
    s.materials = 500
    s.components = 500
    s.treasury = 10000
    expect(s.spireStage).toBe(0)
    expect(fundSpireStage(s)).toBe(true)
    expect(s.spireBuilding).toBe(true)
    expect(s.materials).toBe(500 - COLONY.build.spireStageMaterials[0]!)
    expect(s.components).toBe(500 - COLONY.build.spireStageComponents[0]!)
    expect(s.treasury).toBe(10000 - COLONY.build.spireStageTreasury[0]!)
  })

  it('a stage builds over its long span and the Spire advances', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.totalJobs = 0
    s.materials = 500
    s.components = 200
    s.treasury = 10000
    fundSpireStage(s)
    const steps = Math.ceil((COLONY.build.spireStageBuildHours * 60) / 60) + 2
    for (let i = 0; i < steps; i++) stepBuild(s, sim.rng, 60)
    expect(s.spireStage).toBe(1) // the first stage stands
    expect(s.spireBuilding).toBe(false)
  })

  it('a stage cannot be funded without the goods', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.totalJobs = 0
    s.materials = 10
    s.components = 10
    s.treasury = 100 // far short of the bundle
    expect(fundSpireStage(s)).toBe(false)
    expect(s.spireBuilding).toBe(false)
  })

  it('a stage under construction ties up a crew', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.totalJobs = 0
    s.materials = 500
    s.components = 500
    s.treasury = 10000
    const free0 = freeLabour(s)
    fundSpireStage(s)
    expect(freeLabour(s)).toBe(free0 - COLONY.build.spireStageCrew)
  })

  it('a finished Spire makes the Kookerverse reward standing more', () => {
    const standingGain = (complete: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      if (complete) s.spireStage = 4
      s.colonists = 6
      s.totalJobs = 6
      s.components = 50
      s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      s.request = { good: 'components', amount: 15, deadline: 4320 }
      s.standing = 0.3
      fulfillRequest(s)
      return s.standing - 0.3
    }
    expect(standingGain(true)).toBeGreaterThan(standingGain(false)) // the Beacon amplifies recognition
  })

  it('a finished Spire draws more settlers and calms unrest', () => {
    const immigration = (complete: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      if (complete) s.spireStage = 4
      s.buildings.push(mk('habitat', s.terrain.landing.x + 3, s.terrain.landing.y, { residents: 9 }))
      s.colonists = 4
      s.totalJobs = 2
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(immigration(true)).toBeGreaterThan(immigration(false)) // the landmark draws people

    const unrestAfter = (complete: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      if (complete) s.spireStage = 4
      s.colonists = 6
      s.totalJobs = 6
      s.unrest = 0.5
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.unrest
    }
    expect(unrestAfter(true)).toBeLessThan(unrestAfter(false)) // pride in the work calms the colony
  })

  it('an unstarted Spire is inert — a small colony never sinks itself into a monument', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10)
    expect(s.spireStage).toBe(0)
    expect(spireComplete(s)).toBe(false)
  })
})

describe('Spec 022 — Maintenance Sheds: working buildings wear and need upkeep', () => {
  const mk = (kind: 'mine' | 'maintshed', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a fresh building under the healthy threshold pays no penalty', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    s.materials = 5
    s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 }))
    const m0 = s.materials
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10) // ~0.35 day → wear ~0.02, well under the threshold
    expect(maintenanceStatus(s).worstWear).toBeLessThan(COLONY.build.wearHealthyThreshold)
    expect(s.materials - m0).toBeGreaterThan(1.5) // full-rate mining: 5/day × ~0.35 day ≈ 1.74
  })

  it('an uncovered mine wears down and produces less than one kept under a Maintenance Shed', () => {
    const run = (shed: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 6
      s.totalJobs = 6
      s.materials = 5
      const mx = s.terrain.landing.x + 3
      const my = s.terrain.landing.y
      s.buildings.push(mk('mine', mx, my, { jobs: 6, materialsGen: 5 }))
      if (shed) s.buildings.push(mk('maintshed', mx + 1, my, { jobs: COLONY.build.maintShedWorkers }))
      s.buildings[0]!.wear = 0.9 // already worn — the penalty is active from the first step
      const m0 = s.materials
      for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10) // ~1.4 day
      return s.materials - m0
    }
    expect(run(true)).toBeGreaterThan(run(false)) // the shed repairs the mine → it digs more
  })

  it('a Maintenance Shed repairs a worn building back below the healthy threshold', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6
    s.totalJobs = 6
    const mx = s.terrain.landing.x + 3
    const my = s.terrain.landing.y
    s.buildings.push(mk('mine', mx, my, { jobs: 6, materialsGen: 5 }))
    s.buildings.push(mk('maintshed', mx + 1, my, { jobs: COLONY.build.maintShedWorkers }))
    s.buildings[0]!.wear = 0.9
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10)
    expect(s.buildings[0]!.wear!).toBeLessThan(COLONY.build.wearHealthyThreshold) // repaired back to healthy

    // ...and a mine with no shed only wears further toward fully worn.
    const sim2 = new ColonySim(7)
    const s2 = sim2.state
    s2.colonists = 6
    s2.totalJobs = 6
    s2.buildings.push(mk('mine', mx, my, { jobs: 6, materialsGen: 5 }))
    s2.buildings[0]!.wear = 0.9
    for (let i = 0; i < 200; i++) stepBuild(s2, sim2.rng, 10)
    expect(s2.buildings[0]!.wear!).toBeGreaterThan(0.9) // no fitters → it rusts further
  })
})
