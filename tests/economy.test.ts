import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { autoGrow, freeLabour, stepBuild, housingCapacity, wateredFraction, provisionedFraction, healthFraction, cultureFraction, homeLiveability, colonyLiveability, surveyAvailable, liveabilityTint, tradeExportRate, cultureFuelFactor, courierAvailable, colonyHeadlines, inBrownout, polluted, pollutedFraction, commute, maintenanceStatus, storageCaps, storageStatus, incidentStatus, levyActive, feverWatchActive, feverStatus, housewaresSupplied, luxurySupplied, housewaresFraction, wardActive, unrestStatus, payOfficeActive, payrollPerDay, feastDeckActive, canCallFeast, callFeast, feasting, liaisonActive, fulfillRequest, spireComplete, fundSpireStage, stormwatchActive, frontStatus, foundersHallActive, foundersRoster, foundersStatus, FOUNDERS, importOfficeActive, importStatus, solaceCoverage, solaceStatus, comptrollerExists, comptrollerActive, arrearsStrain, arrearsStatus, sectorStaffing, rosterActive, rosterStatus, colonyDistress, departureCause, departureStatus, educationFraction, educationStatus, censusActive, prosperityScore, prosperityRank, prosperityStatus, turbinePower, waterSupplyFactor, waterStatus, toolSupplyFactor, toolStatus, toolStockCap, seedSupplyFactor, seedStatus, seedStockCap, settlerConfidence, confidenceImmigrationFactor, confidenceStatus, birthStatus, effectiveBuildRadius, footprintStatus, veinFactor, veinStatus, calendarStatus, calendarStep, seasonOf, seasonFactor, seasonStatus, solarSeasonOf, solarSeasonFactor, ledgerStep, ledgerStatus, rimfishStatus, driedFishStatus, duskcapStatus, hygieneLevel, bathhouseStatus, bathStep, hygieneDesirabilityFactor, hygieneEvolutionFactor, immigration, libraryStatus, libraryActive, homeCultured, libraryStep, wasteStep, wasteDesirabilityFactor, wasteStatus, securityStatus, dietVarietyStatus, varietyCovered, varietyDesirabilityFactor, varietyEvolutionFactor, labourStatus, planterStatus, planterBlooming, planterLiveabilityBoost, planterDesirabilityFactor, stallStatus, galleryStatus, galleryAppeal, galleryStep, fireStatus, reclaimStatus, waterTankCap, festivalStatus, festBoardActive, type ColonyBuilding } from '../src/colony/build'
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

describe('Spec 034 — The Stormwatch Shelter: weathering the Cloudsea Fronts', () => {
  const mk = (kind: 'mine' | 'stormwatch', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the Stormwatch braces only while a shelter is built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(stormwatchActive(s)).toBe(false) // no shelter
    s.buildings.push(mk('stormwatch', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.totalJobs = 2
    s.colonists = 0
    expect(stormwatchActive(s)).toBe(false) // shelter, but nobody on watch
    s.colonists = 6
    expect(stormwatchActive(s)).toBe(true) // built + staffed
  })

  it('a Cloudsea Front spoils stored goods and batters buildings when unbraced', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 15
    s.totalJobs = 6 // established
    s.materials = 100
    s.components = 100
    const mine = mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6, materialsGen: 5 })
    s.buildings.push(mine)
    s.frontTimer = 5 // a front is about to strike
    stepBuild(s, sim.rng, 10) // it hits, unbraced
    expect(s.materials).toBeLessThan(100) // goods spoiled
    expect(s.components).toBeLessThan(100)
    expect(mine.wear ?? 0).toBeGreaterThan(0.1) // the building took a battering
  })

  it('a staffed Stormwatch braces the colony and cuts the damage sharply', () => {
    const lost = (braced: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 15
      s.totalJobs = 6
      s.materials = 100
      if (braced) s.buildings.push(mk('stormwatch', s.terrain.landing.x + 5, s.terrain.landing.y, { jobs: 2 }))
      s.frontTimer = 5
      stepBuild(s, sim.rng, 10)
      return 100 - s.materials
    }
    expect(lost(true)).toBeLessThan(lost(false)) // braced → far less spoiled
  })

  it('early and short play is calm — a small colony never sees a front', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 6 // below the established threshold
    s.totalJobs = 6
    s.materials = 100
    const t0 = s.frontTimer
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 10)
    expect(s.frontTimer).toBe(t0) // the timer never moves for a founding crew
    expect(s.materials).toBe(100) // nothing spoils
  })

  it("the Spire's Sky Beacon lengthens the warning window", () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 15
    s.totalJobs = 6
    s.frontTimer = COLONY.build.frontWarningMin + 60 // just beyond the base warning window
    expect(frontStatus(s).incoming).toBe(false)
    s.spireStage = 4 // the Beacon stands
    expect(frontStatus(s).incoming).toBe(true) // ...and the colony sees the front coming sooner
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

describe('Spec 035 — The Founders Hall: the Living Roster of the people who built Landing One', () => {
  const mk = (kind: 'hall' | 'liaison' | 'habitat' | 'mine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the Living Roster is seated only while a Founders Hall is built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(foundersHallActive(s)).toBe(false) // no hall
    s.buildings.push(mk('hall', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.totalJobs = 3
    s.colonists = 0
    expect(foundersHallActive(s)).toBe(false) // a hall, but nobody keeps it
    s.colonists = 12
    expect(foundersHallActive(s)).toBe(true) // built + staffed
  })

  it('the seated roster lists the real system-authors, each with a post', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(foundersRoster(s)).toHaveLength(0) // signatures only, no hall
    s.buildings.push(mk('hall', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.totalJobs = 3
    s.colonists = 12
    const roster = foundersRoster(s)
    expect(roster.length).toBeGreaterThanOrEqual(14)
    const names = roster.map((f) => f.name)
    expect(names).toContain('Mara Venn')
    expect(names).toContain('Tessa Quill')
    expect(names).toContain('Tavi Orro')
    expect(roster.every((f) => f.role.length > 0)).toBe(true) // each founder holds a named post
    expect(foundersStatus(s).seated).toBe(roster.length)
    expect(foundersStatus(s).notable?.name).toBe('Tessa Quill') // the founder who raised the Hall keeps it
  })

  it('a seated Roster makes each fulfilled Civic Request earn a little more standing', () => {
    const gain = (withHall: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 12
      s.totalJobs = 4
      s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
      if (withHall) s.buildings.push(mk('hall', s.terrain.landing.x + 4, s.terrain.landing.y, { jobs: 3 }))
      s.standing = 0.5
      s.components = 100
      s.request = { good: 'components', amount: 10, deadline: 4320 }
      const before = s.standing
      expect(fulfillRequest(s)).toBe(true)
      return s.standing - before
    }
    expect(gain(true)).toBeGreaterThan(gain(false)) // the seated founders are a face to the wider world
  })

  it('a seated Roster eases unrest a touch (vs an identical colony with no hall)', () => {
    const run = (withHall: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 6
      s.totalJobs = 6 // fully employed (0 idle) in BOTH runs → the only difference is the seated Roster's relief
      s.buildings.push(mk('mine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 6 }))
      if (withHall) s.buildings.push(mk('hall', s.terrain.landing.x + 4, s.terrain.landing.y, { jobs: 3 }))
      s.unrest = 0.5
      for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 10)
      return s.unrest ?? 0
    }
    expect(run(true)).toBeLessThan(run(false)) // pride in who built this steadies the colony
  })

  it('a seated Roster draws settlers a little faster (vs an identical colony with no hall)', () => {
    const run = (withHall: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mk('habitat', s.terrain.landing.x + 4, s.terrain.landing.y, { residents: 60 })) // ample headroom — never saturates
      s.buildings.push(mk('mine', s.terrain.landing.x + 5, s.terrain.landing.y, { jobs: 6 })) // employ everyone → no idle-unrest confound
      if (withHall) s.buildings.push(mk('hall', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
      s.colonists = 6
      s.totalJobs = 6
      s.standing = 1.0 // amplify absolute immigration so the +10% gap is clearly measurable
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      const col0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - col0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it('the Courier reports the founders by name once the Roster is seated', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.totalJobs = 4
    expect(colonyHeadlines(s).some((h) => h.includes('Living Roster'))).toBe(false) // no hall → founders stay signatures
    s.buildings.push(mk('hall', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    const lines = colonyHeadlines(s)
    expect(lines.some((h) => h.includes('Living Roster'))).toBe(true)
    expect(lines.some((h) => FOUNDERS.some((f) => h.includes(f.name) && h.includes(f.role)))).toBe(true) // a founder named with their post
  })

  it('with no Founders Hall the colony is unchanged — the founders stay signatures (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 6
    s.standing = 0.5
    s.components = 100
    s.request = { good: 'components', amount: 10, deadline: 4320 }
    s.buildings.push(mk('liaison', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    const before = s.standing
    expect(fulfillRequest(s)).toBe(true)
    expect(s.standing - before).toBeCloseTo(COLONY.build.standingReward, 6) // exactly the base reward — no founders multiplier
    expect(foundersRoster(s)).toHaveLength(0)
    expect(foundersStatus(s).active).toBe(false)
  })
})

describe('Spec 036 — The Skybridge Import Office: buying what the colony cannot make in time', () => {
  const mk = (kind: 'import' | 'storehouse', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the Import Office only buys while built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(importOfficeActive(s)).toBe(false) // no office
    s.buildings.push(mk('import', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.totalJobs = 3
    s.colonists = 0
    expect(importOfficeActive(s)).toBe(false) // office, but nobody to clerk it
    s.colonists = 12
    expect(importOfficeActive(s)).toBe(true) // built + staffed
  })

  it('imports cost a premium over the Exchange sell price', () => {
    expect(COLONY.build.importPrice.components).toBeGreaterThan(COLONY.build.tradeComponentPrice)
    expect(COLONY.build.importPrice.food).toBeGreaterThan(COLONY.build.tradeFoodPrice)
    expect(COLONY.build.importPrice.reels).toBeGreaterThan(COLONY.build.reelPrice)
  })

  it('a staffed Import Office spends treasury to land the order good — at the premium', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('import', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.treasury = 2000
    s.components = 0
    s.importOrder = 'components'
    const t0 = s.treasury
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10) // ~0.35 day (clock frozen: no income, no autoGrow)
    expect(s.components).toBeGreaterThan(0) // imported — there are no workshops, so imports are the only source
    expect(s.treasury).toBeLessThan(t0) // and the colony paid for them
    expect(t0 - s.treasury).toBeGreaterThan(s.components * COLONY.build.tradeComponentPrice) // paid MORE than the Exchange would have paid to sell them (the premium holds)
  })

  it('can import materials — which the Exchange never sells', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('import', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.treasury = 2000
    s.materials = 0
    s.importOrder = 'materials'
    for (let i = 0; i < 40; i++) stepBuild(s, sim.rng, 10)
    expect(s.materials).toBeGreaterThan(0) // bought raw materials with money
    expect(s.treasury).toBeLessThan(2000)
  })

  it('imports never overflow a full storehouse', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('import', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.treasury = 100000 // plenty of money
    s.importOrder = 'components'
    const cap = storageCaps(s).components
    s.components = cap // already brim-full
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 10)
    expect(s.components).toBeLessThanOrEqual(cap + 1e-6) // the cap holds — money is not dumped into a full store
  })

  it('is inert with an office but no order, and with no office at all', () => {
    // office built + staffed, but no standing order
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('import', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.treasury = 5000
    s.components = 0
    s.importOrder = null
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 10)
    expect(s.components).toBe(0) // nothing bought
    expect(s.treasury).toBe(5000) // treasury untouched (clock frozen → no income either)

    // an order set but NO office → still inert
    const sim2 = new ColonySim(7)
    const s2 = sim2.state
    s2.colonists = 12
    s2.totalJobs = 4
    s2.treasury = 5000
    s2.components = 0
    s2.importOrder = 'components'
    for (let i = 0; i < 30; i++) stepBuild(s2, sim2.rng, 10)
    expect(s2.components).toBe(0)
    expect(s2.treasury).toBe(5000)
  })

  it('importStatus reports the active order and a positive daily spend when buying', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('import', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    expect(importStatus(s).active).toBe(true)
    expect(importStatus(s).order).toBe(null) // no order yet
    s.importOrder = 'reels'
    const st = importStatus(s)
    expect(st.order).toBe('reels')
    expect(st.perDay).toBeGreaterThan(0)
    expect(st.dailySpend).toBeGreaterThan(0)
  })
})

describe('Spec 037 — The Mooring Shrine: faith, solace, and the first reason to call it home', () => {
  const mk = (kind: 'shrine' | 'habitat' | 'mine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('Solace reaches homes only from a built, staffed shrine — and dims without linen', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 4 }))
    s.buildings.push(mk('habitat', lx + 1, ly, { residents: 4 }))
    s.colonists = 8
    s.totalJobs = 3
    s.linen = 50
    expect(solaceCoverage(s)).toBe(0) // no shrine
    s.buildings.push(mk('shrine', lx, ly + 1, { jobs: 3 }))
    expect(solaceCoverage(s)).toBeCloseTo(1, 5) // both homes within reach of a staffed shrine, linen on hand
    s.colonists = 0
    expect(solaceCoverage(s)).toBe(0) // a shrine, but nobody keeps it → no Solace
    s.colonists = 8
    s.linen = 0
    expect(solaceCoverage(s)).toBeCloseTo(COLONY.build.solaceStarvedFactor, 5) // out of linen → the Solace dims (1.0 coverage × starved factor)
    expect(solaceCoverage(s)).toBeGreaterThan(0)
  })

  it('a consoled colony draws settlers a little faster', () => {
    const run = (withShrine: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('habitat', lx, ly, { residents: 60 })) // ample headroom
      s.buildings.push(mk('mine', lx + 1, ly, { jobs: 6 })) // fully employed → no idle confound
      if (withShrine) s.buildings.push(mk('shrine', lx, ly, { jobs: 3 }))
      s.colonists = 6
      s.totalJobs = 6
      s.linen = 1000 // never runs dry
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      const c0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - c0
    }
    expect(run(true)).toBeGreaterThan(run(false)) // the Solace bonus pulls settlers a little faster
  })

  it('consoled homes shed unrest more slowly (vs an identical colony with no shrine)', () => {
    const run = (withShrine: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('habitat', lx, ly, { residents: 10 }))
      s.buildings.push(mk('mine', lx + 1, ly, { jobs: 6 })) // fully employed: no idle-pressure confound
      if (withShrine) s.buildings.push(mk('shrine', lx, ly, { jobs: 3 }))
      s.colonists = 6
      s.totalJobs = 6
      s.linen = 1000
      s.unrest = 0.5
      for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 10)
      return s.unrest ?? 0
    }
    expect(run(true)).toBeLessThan(run(false)) // Solace eases the squeeze
  })

  it('a shrine draws down linen for its prayer flags and wraps', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 4 }))
    s.buildings.push(mk('shrine', lx, ly, { jobs: 3 }))
    s.colonists = 6
    s.totalJobs = 3
    s.linen = 50
    const l0 = s.linen
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
    expect(s.linen).toBeLessThan(l0) // consumed linen while it ran
  })

  it('with no shrine the colony is unchanged — Solace is zero (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 4 }))
    s.colonists = 6
    s.totalJobs = 3
    s.linen = 50
    expect(solaceCoverage(s)).toBe(0)
    expect(solaceStatus(s).shrines).toBe(0)
  })
})

describe('Spec 039 — Treasury Arrears: giving an empty treasury teeth', () => {
  const mk = (kind: 'comptroller', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('without a Comptroller Office the treasury cannot fall below zero (hard floor)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.treasury = -500 // try to force a deficit with no debt desk
    stepBuild(s, sim.rng, 10)
    expect(s.treasury).toBe(0) // floored — overdraw is not allowed, exactly as the colony ran before
  })

  it('a Comptroller Office is the debt desk only when built and staffed', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(comptrollerExists(s)).toBe(false)
    expect(comptrollerActive(s)).toBe(false)
    s.buildings.push(mk('comptroller', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.totalJobs = 3
    s.colonists = 0
    expect(comptrollerExists(s)).toBe(true)
    expect(comptrollerActive(s)).toBe(false) // built, but no clerks
    s.colonists = 12
    expect(comptrollerActive(s)).toBe(true)
  })

  it('a staffed Comptroller Office lets the treasury hold a deficit down to the ceiling', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('comptroller', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.treasury = -10000 // far beyond the ceiling
    stepBuild(s, sim.rng, 10)
    expect(s.treasury).toBe(-COLONY.build.debtCeiling) // clamped to the ceiling, not erased to zero
  })

  it('interest grows the debt on a payday', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('comptroller', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.colonists = 0 // no income this payday, so the change is interest (+ a touch of upkeep)
    s.totalJobs = 0
    s.treasury = -1000
    s.clock.day = 1
    s.lastIncomeDay = 0 // fire exactly one payday
    stepBuild(s, sim.rng, 10)
    expect(s.treasury).toBeLessThan(-1000) // the debt deepened — interest accrued
    expect(s.treasury).toBeGreaterThanOrEqual(-COLONY.build.debtCeiling) // still within the ceiling
  })

  it('arrears strain begins once the debt passes half the ceiling', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('comptroller', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.treasury = -(COLONY.build.debtCeiling * 0.4) // below half → managed, no strain
    expect(arrearsStrain(s)).toBe(false)
    s.treasury = -(COLONY.build.debtCeiling * 0.6) // past half → strain
    expect(arrearsStrain(s)).toBe(true)
  })

  it('a colony under arrears strain frays faster (unrest creeps)', () => {
    const run = (debt: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 6
      s.totalJobs = 6 // fully employed: no idle-pressure confound
      s.buildings.push(mk('comptroller', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
      s.treasury = -debt
      s.unrest = 0.3
      for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 10)
      return s.unrest ?? 0
    }
    expect(run(3000)).toBeGreaterThan(run(1000)) // past half the 5000 ceiling → strain unrest; below → none
  })

  it('arrears go unmanaged when the office is unstaffed while in the red', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('comptroller', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.colonists = 0
    s.totalJobs = 3 // a desk with no clerks
    s.treasury = -1000
    const st = arrearsStatus(s)
    expect(st.office).toBe(true)
    expect(st.debt).toBe(1000)
    expect(st.unmanaged).toBe(true) // interest doubles until staffed
    s.colonists = 12
    expect(arrearsStatus(s).unmanaged).toBe(false) // clerks back → managed again
  })

  it('with no office the colony is solvent and unstrained (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.treasury = 500
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 10)
    expect(s.treasury).toBeGreaterThanOrEqual(0) // never goes into debt without a desk
    expect(arrearsStatus(s).office).toBe(false)
    expect(arrearsStatus(s).strain).toBe(false)
    expect(arrearsStatus(s).debt).toBe(0)
  })
})

describe('Spec 038 — The Roster Office: making a labour shortage a choice', () => {
  const mk = (kind: 'greenhouse' | 'mine' | 'roster', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })
  // a colony short of labour: 6 food jobs + 6 industry jobs (+ optional roster), 6 colonists
  const shortColony = (withRoster: boolean) => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('greenhouse', lx, ly, { jobs: 6 })) // food demand 6
    s.buildings.push(mk('mine', lx + 1, ly, { jobs: 6 })) // industry demand 6
    if (withRoster) s.buildings.push(mk('roster', lx + 2, ly, { jobs: 3 }))
    s.totalJobs = withRoster ? 15 : 12
    s.colonists = 6 // fewer hands than jobs → a real shortage
    return s
  }

  it('labour priority bites only with a built, staffed Roster Office', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(rosterActive(s)).toBe(false) // no office
    s.buildings.push(mk('roster', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.totalJobs = 3
    s.colonists = 0
    expect(rosterActive(s)).toBe(false) // office, but no clerks
    s.colonists = 6
    expect(rosterActive(s)).toBe(true)
  })

  it('balanced mode and no office both reproduce the uniform split exactly', () => {
    const noOffice = shortColony(false)
    const uniform = Math.min(1, noOffice.colonists / noOffice.totalJobs)
    expect(sectorStaffing(noOffice, 'food')).toBeCloseTo(uniform, 6) // no office → uniform
    expect(sectorStaffing(noOffice, 'industry')).toBeCloseTo(uniform, 6)
    const balanced = shortColony(true)
    balanced.rosterMode = 'balanced'
    const u2 = Math.min(1, balanced.colonists / balanced.totalJobs)
    expect(sectorStaffing(balanced, 'food')).toBeCloseTo(u2, 6) // office but Balanced → still uniform
    expect(sectorStaffing(balanced, 'industry')).toBeCloseTo(u2, 6)
  })

  it('under a shortage, Essentials-first fills Food before Industry — and Industry-first reverses it', () => {
    const s = shortColony(true)
    s.rosterMode = 'essentials'
    expect(sectorStaffing(s, 'food')).toBeGreaterThan(sectorStaffing(s, 'industry'))
    expect(sectorStaffing(s, 'food')).toBeCloseTo(1, 5) // 6 hands fill the 6 food jobs first
    expect(sectorStaffing(s, 'industry')).toBeCloseTo(0, 5) // none left for Industry
    s.rosterMode = 'industry'
    expect(sectorStaffing(s, 'industry')).toBeGreaterThan(sectorStaffing(s, 'food'))
    expect(sectorStaffing(s, 'industry')).toBeCloseTo(1, 5) // now Industry fills first
  })

  it('with no shortage every sector is fully staffed regardless of mode', () => {
    const s = shortColony(true)
    s.colonists = 30 // more hands than jobs — no shortage
    s.rosterMode = 'essentials'
    expect(sectorStaffing(s, 'food')).toBe(1)
    expect(sectorStaffing(s, 'industry')).toBe(1)
  })

  it('priority redistributes labour but conserves the total (essentials)', () => {
    const s = shortColony(true)
    s.rosterMode = 'essentials'
    // sum of (staffing x demand) across the demanded sectors ~ the available labour (6)
    const placed = sectorStaffing(s, 'food') * 6 + sectorStaffing(s, 'industry') * 6 + sectorStaffing(s, 'civic') * 3
    expect(placed).toBeCloseTo(6, 5)
    expect(rosterStatus(s).mode).toBe('essentials')
    expect(rosterStatus(s).active).toBe(true)
  })
})

describe('Spec 041 — Departure Pressure: the colony can lose people, not just gain them', () => {
  const mk = (kind: 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })
  const poweredHomes = (residents: number, colonists: number) => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', s.terrain.landing.x, s.terrain.landing.y, { residents }))
    s.colonists = colonists
    s.totalJobs = 0
    s.power.batteryWh = s.power.batteryCapWh // keep the grid alive so immigration's power-death path never fires
    s.power.solarW = 20
    return { sim, s }
  }

  it('distress is zero with no homes, and rises when homes go unserved', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(colonyDistress(s)).toBe(0) // no homes → no one to fail
    s.buildings.push(mk('habitat', s.terrain.landing.x, s.terrain.landing.y, { residents: 6 }))
    expect(colonyDistress(s)).toBeGreaterThan(0) // a bare, unserved home is failing its people
  })

  it('a brief failure builds only a little pressure and nobody leaves', () => {
    const { sim, s } = poweredHomes(30, 30)
    for (let i = 0; i < 20; i++) stepBuild(s, sim.rng, 60) // ~0.8 day of neglect — a passing shortage
    expect(s.departurePressure).toBeLessThan(1) // nowhere near the threshold
    expect(s.colonists).toBeGreaterThanOrEqual(30 - 0.001) // no household has packed up
  })

  it('sustained failure crosses the threshold and a household leaves', () => {
    const { sim, s } = poweredHomes(30, 30)
    s.departurePressure = 0.99 // already on the brink after a long, failed stretch
    const before = s.colonists
    for (let i = 0; i < 6; i++) stepBuild(s, sim.rng, 60) // a little more failure tips it over
    expect(s.colonists).toBeLessThan(before) // a household took the next mooring out — population fell
    expect(s.colonists).toBeGreaterThanOrEqual(COLONY.seed.colonists) // never below the founding crew
  })

  it('restoring service before the threshold drains the pressure (recovery is default)', () => {
    const { sim, s } = poweredHomes(30, 30)
    s.departurePressure = 0.6
    // no homes failing now? still bare — but simulate recovery by removing the distress source:
    // give the colony a high-liveability stand-in by clearing the homes (no homes → distress 0 → drains)
    s.buildings.length = 0
    for (let i = 0; i < 45; i++) stepBuild(s, sim.rng, 60) // ~1.9 days of calm fully drains the 0.6
    expect(s.departurePressure).toBeCloseTo(0, 6) // drained back to calm
  })

  it('the Courier names the dominant cause of departures', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', s.terrain.landing.x, s.terrain.landing.y, { residents: 6 }))
    expect(['thirst', 'hunger', 'sickness']).toContain(departureCause(s)) // a bare home: the basics are missing
  })

  it('departureStatus flags at-risk only when pressure is high and homes are failing', () => {
    const { s } = poweredHomes(30, 30)
    s.departurePressure = 0.8
    const st = departureStatus(s)
    expect(st.pressure).toBeCloseTo(0.8, 5)
    expect(st.atRisk).toBe(true) // high pressure + a failing colony
  })

  it('with no homes there is nothing to lose — pressure drains to zero (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.departurePressure = 0.5
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 60)
    expect(s.departurePressure).toBeCloseTo(0, 6)
    expect(s.colonists).toBe(12) // nobody leaves a colony with no homes to empty
  })
})

describe('Spec 042 — The Little Schoolroom: the colony learns its letters', () => {
  const mk = (kind: 'school' | 'habitat' | 'academy' | 'mine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('schools homes only from a built, staffed schoolroom', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 6 }))
    s.buildings.push(mk('habitat', lx + 1, ly, { residents: 6 }))
    s.colonists = 8
    s.totalJobs = 3
    expect(educationFraction(s)).toBe(0) // no school
    s.buildings.push(mk('school', lx, ly + 1, { jobs: 3 }))
    expect(educationFraction(s)).toBeCloseTo(1, 5) // both homes within reach of a staffed school
    s.colonists = 0
    expect(educationFraction(s)).toBe(0) // a room, but no teachers
  })

  it('a schooled colony draws settlers a little faster', () => {
    const run = (withSchool: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('habitat', lx, ly, { residents: 60 }))
      s.buildings.push(mk('mine', lx + 1, ly, { jobs: 6 })) // fully employed → no idle confound
      if (withSchool) s.buildings.push(mk('school', lx, ly, { jobs: 3 }))
      s.colonists = 6
      s.totalJobs = 6
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      const c0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - c0
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })

  it('a schooled colony trains skilled workers faster', () => {
    const run = (withSchool: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('habitat', lx, ly, { residents: 20 }))
      s.buildings.push(mk('academy', lx + 1, ly, { jobs: 4 }))
      if (withSchool) s.buildings.push(mk('school', lx, ly, { jobs: 3 }))
      s.colonists = 20
      s.totalJobs = 6
      s.skilled = 0
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.skilled
    }
    expect(run(true)).toBeGreaterThan(run(false)) // a literate populace learns the advanced trades quicker
  })

  it('with no school, education is zero and the colony is unchanged (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', s.terrain.landing.x, s.terrain.landing.y, { residents: 6 }))
    s.colonists = 8
    s.totalJobs = 3
    expect(educationFraction(s)).toBe(0)
    expect(educationStatus(s).schools).toBe(0)
  })
})

describe('Spec 040 — The Census Hall: a colony-wide Prosperity Rank', () => {
  const mk = (kind: 'census' | 'habitat' | 'mine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('the colony reads its Prosperity only with a built, staffed Census Hall', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(censusActive(s)).toBe(false)
    expect(prosperityScore(s)).toBe(0) // dark with no Hall
    s.buildings.push(mk('census', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.totalJobs = 3
    s.colonists = 0
    expect(censusActive(s)).toBe(false) // a Hall, but no clerks
    s.colonists = 12
    expect(censusActive(s)).toBe(true)
  })

  it('Prosperity is a weighted blend of the colony signals', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('census', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.colonists = 10
    s.totalJobs = 10 // employment 1.0
    s.standing = 1.0
    s.treasury = 1000 // solvency 1.0
    // no habitats → liveability 0 and tier share 0, so only the employment/standing/solvency terms count
    const w = COLONY.build
    const expected = w.prospEmploymentWeight + w.prospStandingWeight + w.prospSolvencyWeight
    expect(prosperityScore(s)).toBeCloseTo(expected, 5)
    expect(prosperityRank(s)).toBe(Math.min(4, Math.floor(expected / 0.2)))
  })

  it('a thriving colony out-scores a struggling one and ranks higher', () => {
    const status = (good: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('census', lx + 3, ly, { jobs: 3 }))
      const h = mk('habitat', lx + 1, ly, { residents: 8 })
      h.tier = good ? 3 : 1
      s.buildings.push(h)
      s.colonists = 10
      s.totalJobs = good ? 10 : 40 // good: fully employed; struggling: under-employed
      s.standing = good ? 0.9 : 0.2
      s.treasury = good ? 2000 : 0
      return prosperityStatus(s)
    }
    const hi = status(true), lo = status(false)
    expect(hi.score).toBeGreaterThan(lo.score)
    expect(hi.rank).toBeGreaterThanOrEqual(lo.rank)
    expect(hi.active).toBe(true)
  })

  it('with no Census Hall, Prosperity is dark and the colony is unchanged (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('habitat', s.terrain.landing.x, s.terrain.landing.y, { residents: 8 }))
    s.colonists = 12
    s.totalJobs = 10
    s.standing = 0.9
    s.treasury = 5000
    const st = prosperityStatus(s)
    expect(st.active).toBe(false)
    expect(st.score).toBe(0)
    expect(st.recognised).toBe(false)
    expect(prosperityScore(s)).toBe(0)
  })
})

describe('Spec 044 — Skybound Folios: the colony signature finished export', () => {
  const mk = (kind: 'folio' | 'exchange', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a staffed Folio House binds reels + linen 1:1 into folios', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('folio', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 4 }))
    s.reels = 50
    s.linen = 50
    s.folios = 0
    const r0 = s.reels, l0 = s.linen
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10)
    expect(s.folios).toBeGreaterThan(0) // bound the signature good
    expect(s.reels).toBeLessThan(r0) // drew down reels
    expect(s.linen).toBeLessThan(l0) // and linen
    expect(r0 - s.reels).toBeCloseTo(s.folios, 4) // 1 reel per folio
    expect(l0 - (s.linen ?? 0)).toBeCloseTo(s.folios, 4) // 1 linen per folio
  })

  it('the Exchange sells folios at a premium above reels', () => {
    expect(COLONY.build.folioPrice).toBeGreaterThan(COLONY.build.reelPrice)
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('exchange', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.folios = 50
    s.reels = 0
    s.components = 0
    s.food = 0
    s.treasury = 0
    for (let i = 0; i < 60; i++) stepBuild(s, sim.rng, 10)
    expect(s.folios).toBeLessThan(50) // exported through the Exchange
    expect(s.treasury).toBeGreaterThan(0) // earned the premium
  })

  it('a Folio House binds nothing without both reels and linen (stalls, never fails)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('folio', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 4 }))
    s.reels = 50
    s.linen = 0 // the second input is missing
    s.folios = 0
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10)
    expect(s.folios).toBe(0) // stalled
    expect(s.reels).toBe(50) // nothing consumed
  })

  it('with no Folio House, folios stay at zero (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.reels = 50
    s.linen = 50
    s.folios = 0
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10)
    expect(s.folios).toBe(0) // no bindery → no folios
    expect(s.reels).toBe(50) // reels untouched by folio production
  })
})

describe('Spec 045 — The Wind-Shear Turbine Mast: power that scales', () => {
  const mk = (kind: 'turbine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a staffed Turbine Mast adds power, scaled by staffing; none without a mast', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(turbinePower(s)).toBe(0) // no mast
    s.buildings.push(mk('turbine', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 4 }))
    s.totalJobs = 4
    s.colonists = 4 // fully staffed
    expect(turbinePower(s)).toBeCloseTo(COLONY.build.turbineOutputW, 5) // 1 mast × output × 1.0
    s.colonists = 2 // half-staffed
    expect(turbinePower(s)).toBeCloseTo(COLONY.build.turbineOutputW * 0.5, 5)
    s.colonists = 0 // unstaffed → spun down
    expect(turbinePower(s)).toBe(0)
  })

  it('staffed Turbine Masts raise the supply and ease a brownout', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.power.loadW = 30
    s.power.batteryWh = 0 // drained
    s.power.batteryCapWh = 80
    s.colonists = 40
    s.totalJobs = 10 // staffing 1.0
    expect(inBrownout(s)).toBe(true) // load 30 >> fixed solar peak, battery empty
    for (let i = 0; i < 10; i++) s.buildings.push(mk('turbine', s.terrain.landing.x + i, s.terrain.landing.y + 5, { jobs: 4 }))
    expect(turbinePower(s)).toBeGreaterThan(30) // 10 masts × 4 × 1.0 = 40 > load
    expect(inBrownout(s)).toBe(false) // supply now exceeds load → the grid steadies
  })

  it('with no Turbine Mast the power supply is unchanged (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.power.loadW = 30
    s.power.batteryWh = 0
    s.power.batteryCapWh = 80
    s.colonists = 40
    s.totalJobs = 10
    expect(turbinePower(s)).toBe(0)
    expect(inBrownout(s)).toBe(true) // no turbine → still in brownout, exactly as before
  })
})

describe('Spec 046 — Stored Water: the sky can deny the tanks', () => {
  const mk = (kind: 'cistern' | 'water' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('water is full coverage with no cistern, and scales with the tank once one stands', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(waterSupplyFactor(s)).toBe(1) // no cistern → inert, water is free coverage
    s.buildings.push(mk('cistern', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.water = 0 // bone dry
    expect(waterSupplyFactor(s)).toBeCloseTo(COLONY.build.waterSupplyFloor, 5)
    s.water = COLONY.build.waterComfortBuffer // a full buffer
    expect(waterSupplyFactor(s)).toBeCloseTo(1, 5)
  })

  it('a staffed cistern condenses water into the tank', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.buildings.push(mk('cistern', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 3 }))
    s.water = 0
    s.power.batteryWh = s.power.batteryCapWh // keep the grid up so the condensers run
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 10) // no homes → no draw, just fill
    expect(s.water).toBeGreaterThan(0) // condensed water into the tank
    expect(waterStatus(s).cisterns).toBe(1)
  })

  it('a dry tank weakens water coverage; a full tank leaves it unchanged', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 6 }))
    s.buildings.push(mk('water', lx, ly, {})) // a Water Hub at the home → spatial coverage 1
    s.colonists = 8
    s.totalJobs = 3
    expect(wateredFraction(s)).toBeCloseTo(1, 5) // no cistern → spatial coverage only (full)
    s.buildings.push(mk('cistern', lx + 2, ly, { jobs: 3 }))
    s.water = COLONY.build.waterComfortBuffer // full tank
    expect(wateredFraction(s)).toBeCloseTo(1, 5) // full → unchanged
    s.water = 0 // dry tank
    expect(wateredFraction(s)).toBeCloseTo(COLONY.build.waterSupplyFloor, 5) // weakened to the floor
  })

  it('a dry tank breeds more fever than a full one', () => {
    const run = (full: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('habitat', lx, ly, { residents: 6 }))
      s.buildings.push(mk('cistern', lx + 2, ly, { jobs: 3 }))
      s.colonists = 6
      s.totalJobs = 30 // understaffed: the cistern can barely fill
      s.power.batteryWh = s.power.batteryCapWh
      s.water = full ? COLONY.build.cisternTankCap : 0
      s.outbreak = 0
      for (let i = 0; i < 40; i++) stepBuild(s, sim.rng, 10)
      return s.outbreak ?? 0
    }
    expect(run(false)).toBeGreaterThan(run(true)) // a dry tank sickens the colony; a full one does not
  })

  it('with no cistern, water is the free infinite coverage it has always been (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 6 }))
    s.buildings.push(mk('water', lx, ly, {}))
    s.colonists = 8
    s.totalJobs = 3
    s.water = 0
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 10)
    expect(wateredFraction(s)).toBeCloseTo(1, 5) // unchanged — full spatial coverage, no tank dependence
    expect(s.water).toBe(0) // no cistern → no stored water ever accrues
    expect(waterStatus(s).cisterns).toBe(0)
  })
})

describe('Spec 047 — The Tool Crib: bare hands do not mine forever', () => {
  const mk = (kind: 'toolcrib' | 'mine' | 'workshop', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('tools are full output with no crib, and scale with the rack once a crib stands', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(toolSupplyFactor(s)).toBe(1) // no crib → inert, tooled work is free full-speed work
    s.buildings.push(mk('toolcrib', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.tools = 0 // bone dry rack
    expect(toolSupplyFactor(s)).toBeCloseTo(COLONY.build.toolFloor, 5) // dry → the half-speed floor
    s.tools = COLONY.build.toolComfortBuffer // a full buffer
    expect(toolSupplyFactor(s)).toBeCloseTo(1, 5) // healthy → no penalty (exactly as today)
  })

  it('a staffed crib draws components into tool-kits, capped at the rack', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.powerGen = 100 // keep the grid up so the bench runs
    s.power.batteryWh = s.power.batteryCapWh
    s.buildings.push(mk('toolcrib', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.tools = 0
    s.components = 9999 // plenty to convert (no tooled workplaces → no demand draw)
    const startComp = s.components
    for (let i = 0; i < 600; i++) stepBuild(s, sim.rng, 60)
    expect(s.tools).toBeGreaterThan(0) // converted components into tool-kits
    expect(s.tools).toBeLessThanOrEqual(toolStockCap(s)) // never overfills the rack
    expect(s.tools).toBeGreaterThan(COLONY.build.toolStockCap * 0.8) // a long run fills it near the cap
    expect(s.components).toBeLessThan(startComp) // it spent components to do it
    expect(toolStatus(s).cribs).toBe(1)
  })

  it('a freshly built crib starts its rack charged (no construction-day output crash)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 12
    s.totalJobs = 4
    s.tools = 0
    const a = Object.assign({ id: 1, kind: 'toolcrib', color: 0, height: 1, residents: 0, jobs: 2, powerLoad: 0, powerGen: 0, buildTimeMin: 60, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 })
    s.jobs.push({ id: 999, x: lx + 2, y: ly, artifact: a, progress: 0, path: [] })
    stepBuild(s, sim.rng, 60) // 60 min build time → completes this step
    expect(toolStatus(s).cribs).toBe(1) // the crib now stands
    expect(s.tools).toBeCloseTo(COLONY.build.toolStockCap * COLONY.build.toolStartCharge, 5) // rack starts ~60% charged
  })

  it('a dry rack weakens tooled output toward the floor; a full rack leaves it unchanged', () => {
    const runMine = (mode: 'nocrib' | 'full' | 'dry') => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('mine', lx, ly, { jobs: 3, materialsGen: COLONY.build.mineOutputPerDay }))
      if (mode !== 'nocrib') s.buildings.push(mk('toolcrib', lx + 2, ly, { jobs: 2 }))
      s.colonists = 400 // labour saturates every sector at full in all three modes
      s.totalJobs = 5
      s.powerGen = 100 // no brownout
      s.power.batteryWh = s.power.batteryCapWh
      s.materials = 0
      if (mode === 'full') { s.tools = toolStockCap(s); s.components = 9999 } // crib stays fed → rack stays full
      if (mode === 'dry') { s.tools = 0; s.components = 0 } // crib starved → rack stays at 0
      for (let i = 0; i < 6; i++) stepBuild(s, sim.rng, 60)
      return s.materials
    }
    const base = runMine('nocrib'), full = runMine('full'), dry = runMine('dry')
    expect(base).toBeGreaterThan(0)
    expect(full).toBeCloseTo(base, 4) // healthy tools → the mine digs exactly as it does today
    expect(dry).toBeLessThan(base * 0.75) // a dry rack drags the mine toward the half-speed floor
    expect(dry).toBeCloseTo(base * COLONY.build.toolFloor, 4) // ...specifically to the floor
    expect(dry).toBeGreaterThan(0) // but never zero — the floor keeps the loop recoverable
  })

  it('with no crib, tool-kits never accrue and the factor stays 1 (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('mine', lx, ly, { jobs: 3, materialsGen: COLONY.build.mineOutputPerDay }))
    s.buildings.push(mk('workshop', lx + 1, ly, { jobs: 4 }))
    s.colonists = 20
    s.totalJobs = 7
    s.powerGen = 100
    s.materials = 50
    s.tools = 0
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 60)
    expect(toolSupplyFactor(s)).toBe(1) // never industrialised tools → no penalty ever
    expect(s.tools).toBe(0) // no crib → no tool-kits ever accrue
    expect(toolStatus(s).cribs).toBe(0)
  })
})

describe('Spec 048 — The Seed Loft: food should not grow from bare deck-plating', () => {
  const mk = (kind: 'seedloft' | 'greenhouse' | 'cistern', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('food is full yield with no loft, and scales with the bin once a loft stands', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(seedSupplyFactor(s)).toBe(1) // no loft → inert, food grows free as today
    s.buildings.push(mk('seedloft', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.seed = 0 // bone dry bin
    expect(seedSupplyFactor(s)).toBeCloseTo(COLONY.build.seedFloor, 5) // dry → the half-harvest floor
    s.seed = COLONY.build.seedComfortBuffer // a full buffer
    expect(seedSupplyFactor(s)).toBeCloseTo(1, 5) // healthy → no penalty (exactly as today)
  })

  it('a staffed loft dries food into seed-stock, capped at the bin', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 12
    s.totalJobs = 4
    s.powerGen = 100 // keep the grid up so the racks run
    s.power.batteryWh = s.power.batteryCapWh
    s.buildings.push(mk('seedloft', s.terrain.landing.x + 3, s.terrain.landing.y, { jobs: 2 }))
    s.seed = 0
    s.food = 300 // plenty of harvest to save (no skyfarms → no seed demand)
    for (let i = 0; i < 600; i++) stepBuild(s, sim.rng, 60)
    expect(s.seed).toBeGreaterThan(0) // dried food into seed-stock
    expect(s.seed).toBeLessThanOrEqual(seedStockCap(s)) // never overfills the bin
    expect(s.seed).toBeGreaterThan(COLONY.build.seedStockCap * 0.8) // a long run fills it near the cap
    expect(s.food).toBeLessThan(300) // it spent food to do it
    expect(seedStatus(s).lofts).toBe(1)
  })

  it('a freshly built loft starts its bin charged (no construction-day harvest crash)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 12
    s.totalJobs = 4
    s.seed = 0
    const a = Object.assign({ id: 1, kind: 'seedloft', color: 0, height: 1, residents: 0, jobs: 2, powerLoad: 0, powerGen: 0, buildTimeMin: 60, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 })
    s.jobs.push({ id: 999, x: lx + 2, y: ly, artifact: a, progress: 0, path: [] })
    stepBuild(s, sim.rng, 60) // 60 min build time → completes this step
    expect(seedStatus(s).lofts).toBe(1) // the loft now stands
    expect(s.seed).toBeCloseTo(COLONY.build.seedStockCap * COLONY.build.seedStartCharge, 5) // bin starts ~60% charged
  })

  it('a dry bin cuts skyfarm yield toward the floor; a full bin leaves it unchanged', () => {
    const runFarms = (mode: 'noloft' | 'full' | 'dry') => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      for (let g = 0; g < 20; g++) s.buildings.push(mk('greenhouse', lx + (g % 10), ly + 4 + Math.floor(g / 10), { jobs: COLONY.build.greenhouseWorkers })) // 20 skyfarms, none near a Water Hub (uniform boost = 1)
      if (mode !== 'noloft') s.buildings.push(mk('seedloft', lx, ly, { jobs: 2 }))
      s.colonists = 44 // labour saturates the food sector at full in all three modes
      s.totalJobs = 42
      s.powerGen = 100 // no brownout
      s.power.batteryWh = s.power.batteryCapWh
      s.food = 0
      if (mode === 'full') s.seed = seedStockCap(s) // bin full → seed factor 1 (the loft only tops off the small amount the farms draw)
      if (mode === 'dry') s.seed = 0 // bin empty → one loft cannot out-dry twenty farms, so it stays at the floor
      for (let i = 0; i < 6; i++) stepBuild(s, sim.rng, 60)
      return s.food
    }
    const base = runFarms('noloft'), full = runFarms('full'), dry = runFarms('dry')
    expect(base).toBeGreaterThan(0)
    expect(full).toBeGreaterThan(base * 0.85) // healthy seed → harvest barely below no-loft (only the loft's small fixed food draw)
    expect(dry).toBeLessThan(base * 0.6) // a dry bin drags the harvest down toward the half floor
    expect(dry).toBeGreaterThan(0) // but never zero — the floor keeps the loop recoverable
    expect(full).toBeGreaterThan(dry) // and a full bin always out-yields a dry one
  })

  it('with no loft, seed-stock never accrues and the factor stays 1 (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let g = 0; g < 3; g++) s.buildings.push(mk('greenhouse', lx + g, ly + 4, { jobs: COLONY.build.greenhouseWorkers }))
    s.colonists = 20
    s.totalJobs = 6
    s.powerGen = 100
    s.food = 50
    s.seed = 0
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 60)
    expect(seedSupplyFactor(s)).toBe(1) // never kept its own seed → no penalty ever
    expect(s.seed).toBe(0) // no loft → no seed-stock ever accrues
    expect(seedStatus(s).lofts).toBe(0)
  })
})

describe('Spec 049 — Settler Confidence: word travels faster than skyships', () => {
  const mk = (kind: 'habitat' | 'water' | 'comptroller', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a fed, watered, solvent, orderly colony sits at the plateau (immigration unchanged)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 12 }))
    s.buildings.push(mk('water', lx, ly)) // a hub at the home → watered
    s.food = 100 // fed
    s.colonists = 8
    expect(settlerConfidence(s)).toBeGreaterThanOrEqual(COLONY.build.confPlateau)
    expect(confidenceImmigrationFactor(s)).toBe(1) // healthy → full-speed arrivals, exactly as today
  })

  it('a young or minimal colony stays confident even with no water or food yet (neutral when absent)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 9 })) // a frontier home, no Water Hub, no food, no Pay Office, no debt
    s.food = 0
    s.colonists = 2
    // survival shortfalls weigh light, so a frontier colony with no civic distress is still above the plateau and immigrates as today
    expect(settlerConfidence(s)).toBeGreaterThanOrEqual(COLONY.build.confPlateau)
    expect(confidenceImmigrationFactor(s)).toBe(1)
  })

  it('disorder lowers Confidence and slows arrivals below the plateau', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 12 }))
    s.buildings.push(mk('water', lx, ly))
    s.food = 100
    s.colonists = 8
    expect(confidenceImmigrationFactor(s)).toBe(1) // calm → plateau
    s.unrest = 0.95 // riots on the decks
    expect(settlerConfidence(s)).toBeLessThan(COLONY.build.confPlateau) // word has soured
    expect(confidenceImmigrationFactor(s)).toBeLessThan(1) // arrivals slow
    expect(confidenceStatus(s).slowed).toBe(true)
  })

  it('stacked distress halts immigration entirely while beds sit empty', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 20 })) // capacity 22 — plenty of empty beds
    s.buildings.push(mk('comptroller', lx + 2, ly)) // a Comptroller exists, so deep debt becomes arrears strain
    s.colonists = 5
    s.food = 0 // hunger
    s.unrest = 1 // disorder
    s.treasury = -1_000_000 // deep arrears (no Water Hub either → thirst)
    expect(arrearsStrain(s)).toBe(true)
    expect(housingCapacity(s)).toBeGreaterThan(s.colonists) // beds sit empty — vacancy alone would normally pull settlers in
    expect(settlerConfidence(s)).toBeLessThanOrEqual(COLONY.build.confStop)
    expect(confidenceImmigrationFactor(s)).toBe(0) // terrible → the arrival multiplier is zero, so immigration halts despite the empty beds
    expect(confidenceStatus(s).halted).toBe(true)
  })

  it('Confidence and arrivals climb back when the colony is set right (recovery)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly, { residents: 12 }))
    s.buildings.push(mk('water', lx, ly))
    s.colonists = 8
    s.food = 0
    s.unrest = 1 // wrecked
    expect(confidenceImmigrationFactor(s)).toBeLessThan(1)
    s.food = 100 // rations restored
    s.unrest = 0 // order restored
    expect(settlerConfidence(s)).toBeGreaterThanOrEqual(COLONY.build.confPlateau)
    expect(confidenceImmigrationFactor(s)).toBe(1) // back to full-speed arrivals — no hysteresis trap
  })
})

describe('Spec 050 — Household Births: a colony that can grow its own', () => {
  const home = (x: number, y: number, tier: number, residents: number): ColonyBuilding => {
    const b: ColonyBuilding = { id: x * 1000 + y, x, y, artifact: { id: 1, kind: 'habitat', color: 0, height: 1, residents, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 } }
    b.tier = tier
    return b
  }
  const water = (x: number, y: number): ColonyBuilding => ({ id: x * 1000 + y + 9, x, y, artifact: { id: 2, kind: 'water', color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 } })

  it('a tier-1 colony never breeds — children stay 0 (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(home(lx, ly, 1, 20)) // a tier-1 shack — survival before family
    s.buildings.push(water(lx, ly))
    s.food = 1000
    s.colonists = 8
    s.components = 0 // no components → housing cannot climb to tier 2, so it stays inert
    s.materials = 0
    for (let i = 0; i < 300; i++) stepBuild(s, sim.rng, 60)
    expect(s.children).toBe(0) // no mid-tier home → no births ever
    expect(birthStatus(s).homes).toBe(0)
    expect(birthStatus(s).growing).toBe(false)
  })

  it('a stable mid-tier home raises children over many days', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(home(lx, ly, 2, 20)) // capacity 22
    s.buildings.push(water(lx, ly)) // watered
    s.food = 5000 // fed (food on hand)
    s.unrest = 0 // calm
    s.colonists = housingCapacity(s) // fill the beds so the pool cannot mature/immigrate away — it just accrues
    s.children = 0
    for (let i = 0; i < 300; i++) stepBuild(s, sim.rng, 60)
    expect(s.children).toBeGreaterThan(0) // the household raised children into the pool
    expect(birthStatus(s).homes).toBe(1)
  })

  it('children are extra mouths — food drains faster with them than without', () => {
    const drain = (kids: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(home(lx, ly, 1, 48)) // capacity 50, tier 1 (no births), full below
      s.buildings.push(water(lx, ly))
      s.colonists = housingCapacity(s) // full → no maturation, no immigration; the pool just sits and eats
      s.unrest = 0
      s.children = kids
      s.food = 4000
      const f0 = s.food
      for (let i = 0; i < 5; i++) stepBuild(s, sim.rng, 60)
      return f0 - s.food
    }
    expect(drain(20)).toBeGreaterThan(drain(0)) // 20 dependents eat half a ration each on top of the colonists
  })

  it('children mature into colonists on a vacancy, and the pool holds when housing is full', () => {
    // vacancy → maturation
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(home(lx, ly, 2, 30)) // capacity 32
    s.buildings.push(water(lx, ly))
    s.food = 5000
    s.unrest = 0
    s.colonists = 8 // plenty of room
    s.children = 10
    const col0 = s.colonists
    for (let i = 0; i < 120; i++) stepBuild(s, sim.rng, 60)
    expect(s.children).toBeLessThan(10) // some grew up
    expect(s.colonists).toBeGreaterThan(col0) // ...and joined the workforce

    // full housing → the pool holds (the young wait for a home)
    const sim2 = new ColonySim(7)
    const s2 = sim2.state
    const lx2 = s2.terrain.landing.x, ly2 = s2.terrain.landing.y
    s2.buildings.push(home(lx2, ly2, 2, 20)) // capacity 22
    s2.buildings.push(water(lx2, ly2))
    s2.food = 5000
    s2.unrest = 0
    s2.colonists = housingCapacity(s2) // full → no room to mature into
    s2.children = 8
    for (let i = 0; i < 120; i++) stepBuild(s2, sim2.rng, 60)
    expect(s2.children).toBeGreaterThanOrEqual(8) // held (and may grow), never matured away with no beds
  })

  it('neglect drains the children pool instead of maturing it', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(home(lx, ly, 2, 20)) // a mid-tier home, but with no Water Hub it is unwatered → unstable
    s.food = 0 // and unfed → stability collapses to neglect
    s.colonists = 8
    s.children = 10
    for (let i = 0; i < 80; i++) stepBuild(s, sim.rng, 60)
    expect(s.children).toBeLessThan(10) // families stop raising — the pool drains
  })
})

describe('Spec 051 — The Survey Camp: the colony can claim new ground', () => {
  const camp = (x: number, y: number): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind: 'surveycamp', color: 0, height: 1, residents: 0, jobs: COLONY.build.surveyCampWorkers, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('with no Survey Camp the build radius is the base footprint, unchanged (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(effectiveBuildRadius(s)).toBe(COLONY.build.maxBlockRadius)
    expect(s.claims).toBe(0)
    s.powerGen = 100
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 60)
    expect(effectiveBuildRadius(s)).toBe(COLONY.build.maxBlockRadius) // no camp → frontier never moves
    expect(s.claims).toBe(0)
    expect(footprintStatus(s).camp).toBe(false)
  })

  it('the effective radius grows one ring per claim, capped at maxClaims', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    expect(effectiveBuildRadius(s)).toBe(COLONY.build.maxBlockRadius)
    s.claims = 1
    expect(effectiveBuildRadius(s)).toBe(COLONY.build.maxBlockRadius + 1)
    s.claims = 2
    expect(effectiveBuildRadius(s)).toBe(COLONY.build.maxBlockRadius + 2)
    s.claims = COLONY.build.maxClaims + 5 // over the cap
    expect(effectiveBuildRadius(s)).toBe(COLONY.build.maxBlockRadius + COLONY.build.maxClaims) // capped at the island edge
    expect(footprintStatus(s).atEdge).toBe(true)
  })

  it('a built, staffed, supplied camp completes an Outer Claim and widens the radius', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(camp(s.terrain.landing.x + 4, s.terrain.landing.y))
    s.colonists = 8
    s.totalJobs = 4 // fully staffed (min(1, 8/4) = 1)
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.materials = 1000
    s.components = 100
    const r0 = effectiveBuildRadius(s)
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 60) // ~8 days > claimWorkDays
    expect(s.claims).toBeGreaterThanOrEqual(1) // the survey laid a new ring
    expect(effectiveBuildRadius(s)).toBeGreaterThan(r0) // the build footprint widened
  })

  it('completing a claim spends materials and components', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(camp(s.terrain.landing.x + 4, s.terrain.landing.y))
    s.colonists = 8
    s.totalJobs = 4
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.materials = 1000
    s.components = 100
    const m0 = s.materials, c0 = s.components
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 60)
    expect(s.claims).toBeGreaterThanOrEqual(1)
    expect(s.materials).toBeLessThanOrEqual(m0 - COLONY.build.matPerClaim) // paid the materials
    expect(s.components).toBeLessThanOrEqual(c0 - COLONY.build.compPerClaim) // and the components
  })

  it('an unsupplied camp surveys but the claim waits — the frontier does not move on credit', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(camp(s.terrain.landing.x + 4, s.terrain.landing.y))
    s.colonists = 8
    s.totalJobs = 4
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.materials = 0 // cannot pay for a claim
    s.components = 0
    for (let i = 0; i < 300; i++) stepBuild(s, sim.rng, 60)
    expect(s.claims).toBe(0) // no claim completes without stock
    expect(s.claimProgress).toBeGreaterThan(0.5) // ...but the survey work accrued and waits to be paid
  })

  it('claims never exceed the cap — the radius holds at the island edge', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(camp(s.terrain.landing.x + 4, s.terrain.landing.y))
    s.colonists = 8
    s.totalJobs = 4
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.materials = 1000
    s.components = 100
    s.claims = COLONY.build.maxClaims // already at the edge
    const r = effectiveBuildRadius(s)
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 60)
    expect(s.claims).toBe(COLONY.build.maxClaims) // never claims past the island
    expect(effectiveBuildRadius(s)).toBe(r)
  })
})

describe('Spec 052 — The Vein Ledger: ore runs out, so the colony must spread its diggings', () => {
  const mine = (x: number, y: number, vein?: number, gen = COLONY.build.mineOutputPerDay): ColonyBuilding => {
    const b: ColonyBuilding = { id: x * 1000 + y, x, y, artifact: { id: 1, kind: 'mine', color: 0, height: 1, residents: 0, jobs: 3, powerLoad: 0.3, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: gen } }
    if (vein !== undefined) b.vein = vein
    return b
  }

  it('a fresh or unrecorded vein reads at full output (inert / non-regression)', () => {
    const m = mine(10, 10) // no vein recorded
    expect(veinFactor(m)).toBe(1)
    m.vein = COLONY.build.veinLifeDays // a full vein
    expect(veinFactor(m)).toBe(1)
  })

  it('output fades by bands as the vein runs down', () => {
    const m = mine(10, 10, COLONY.build.veinLifeDays)
    const at = (frac: number) => { m.vein = frac * COLONY.build.veinLifeDays; return veinFactor(m) }
    expect(at(0.6)).toBe(1) // still over half → full
    expect(at(0.5)).toBe(1) // exactly half → still full
    expect(at(0.44)).toBe(0.8)
    expect(at(0.3)).toBe(0.6)
    expect(at(0.18)).toBe(0.4)
    expect(at(0.05)).toBe(COLONY.build.veinFloor) // nearly dug out → the floor
  })

  it('an exhausted vein still yields the floor, never zero', () => {
    const m = mine(10, 10, 0)
    expect(veinFactor(m)).toBe(COLONY.build.veinFloor)
    expect(veinFactor(m)).toBeGreaterThan(0)
  })

  it('a staffed, producing mine spends its vein; an incident-stalled one holds', () => {
    // staffed → depletes
    const sim = new ColonySim(7)
    const s = sim.state
    const m = mine(s.terrain.landing.x + 4, s.terrain.landing.y, COLONY.build.veinLifeDays)
    s.buildings.push(m)
    s.colonists = 8
    s.totalJobs = 3
    s.powerGen = 100
    const v0 = m.vein!
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 60)
    expect(m.vein!).toBeLessThan(v0) // dug the vein down

    // incident-stalled → holds (a mine that is not digging does not spend its vein)
    const sim2 = new ColonySim(7)
    const s2 = sim2.state
    const m2 = mine(s2.terrain.landing.x + 4, s2.terrain.landing.y, COLONY.build.veinLifeDays)
    m2.incident = { timer: 1e9 } // stalled mid-incident for the whole run
    s2.buildings.push(m2)
    s2.colonists = 8
    s2.totalJobs = 3
    s2.powerGen = 100
    const v2 = m2.vein!
    for (let i = 0; i < 50; i++) stepBuild(s2, sim2.rng, 60)
    expect(m2.vein!).toBe(v2) // a stalled pit holds its vein
  })

  it('a fresh-vein mine out-digs a thin-vein one over the same run', () => {
    const produced = (veinFrac: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.buildings.push(mine(s.terrain.landing.x + 4, s.terrain.landing.y, veinFrac * COLONY.build.veinLifeDays))
      s.colonists = 8
      s.totalJobs = 3
      s.powerGen = 100
      s.power.batteryWh = s.power.batteryCapWh
      s.materials = 0
      for (let i = 0; i < 10; i++) stepBuild(s, sim.rng, 60)
      return s.materials
    }
    expect(produced(1.0)).toBeGreaterThan(produced(0.1)) // a full vein out-digs a nearly-exhausted one
    expect(produced(0.1)).toBeGreaterThan(0) // ...but the thin pit still trickles (the floor)
    // veinStatus reports the poorest pit's band: a fresh mine + one at 30% vein → poorest is 0.6
    const status = veinStatus({ buildings: [mine(0, 0, COLONY.build.veinLifeDays), mine(1, 1, 0.3 * COLONY.build.veinLifeDays)] } as any)
    expect(status.mines).toBe(2)
    expect(status.poorest).toBe(0.6)
  })
})

describe('Spec 053 — The Founding Calendar: the colony learns to count its years', () => {
  const office = (x: number, y: number): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind: 'calendar', color: 0, height: 1, residents: 0, jobs: COLONY.build.calendarWorkers, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('the colony age readout tracks the clock (year + month since founding)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.clock.day = 0
    expect(calendarStatus(s).year).toBe(0)
    expect(calendarStatus(s).month).toBe(1)
    s.clock.day = COLONY.build.daysPerYear * 2 + COLONY.build.daysPerMonth * 3 // year 2, month 4
    const cs = calendarStatus(s)
    expect(cs.year).toBe(2)
    expect(cs.month).toBe(4)
    expect(cs.monthsToFounders).toBe(13 - 4) // 9 months until the next year turns
  })

  it('with no Calendar Office, a year turns unmarked — no morale shift, but the year is accounted', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.clock.day = COLONY.build.daysPerYear // year 1
    s.lastFoundersYear = 0
    s.unrest = 0.5
    calendarStep(s)
    expect(s.unrest).toBe(0.5) // no office → no Founders' Day lift
    expect(s.lastFoundersYear).toBe(1) // the year still passes (no catch-up later)
    expect(calendarStatus(s).office).toBe(false)
  })

  it('a built, staffed Calendar Office eases unrest a little when a year turns (Founders Day)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(office(s.terrain.landing.x + 4, s.terrain.landing.y))
    s.colonists = 8
    s.totalJobs = 4 // staffed
    s.clock.day = COLONY.build.daysPerYear // year 1
    s.lastFoundersYear = 0
    s.unrest = 0.5
    calendarStep(s)
    expect(s.unrest).toBeCloseTo(0.5 - COLONY.build.foundersDayUnrestRelief, 5) // the free annual lift
    expect(s.lastFoundersYear).toBe(1)
  })

  it('Founders Day fires once per year, not every step', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(office(s.terrain.landing.x + 4, s.terrain.landing.y))
    s.colonists = 8
    s.totalJobs = 4
    s.clock.day = COLONY.build.daysPerYear
    s.lastFoundersYear = 0
    s.unrest = 0.5
    calendarStep(s) // fires
    const afterFirst = s.unrest
    expect(s.lastFoundersYear).toBe(1)
    calendarStep(s) // same year → must not fire again
    expect(s.unrest).toBe(afterFirst) // no second lift
    expect(s.lastFoundersYear).toBe(1)
  })

  it('an unstaffed office lets the year pass unmarked (no lift)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(office(s.terrain.landing.x + 4, s.terrain.landing.y))
    s.colonists = 0
    s.totalJobs = 4 // no labour → unstaffed
    s.clock.day = COLONY.build.daysPerYear
    s.lastFoundersYear = 0
    s.unrest = 0.5
    calendarStep(s)
    expect(s.unrest).toBe(0.5) // unstaffed → no lift
    expect(s.lastFoundersYear).toBe(1) // but the year is still accounted (unmarked)
  })
})

describe('Spec 054 — Mild Seasons: the almanac makes the year turn', () => {
  const mk = (kind: 'calendar' | 'greenhouse' | 'water', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('with no Calendar Office there are no seasons — the factor is 1 in every month (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.clock.day = COLONY.build.daysPerYear * 0 + COLONY.build.daysPerMonth * 8 // month 9 — would be Frost with a calendar
    expect(seasonFactor(s)).toBe(1)
    expect(seasonStatus(s).active).toBe(false)
  })

  it('with a Calendar Office, the season factor follows the month bands', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('calendar', s.terrain.landing.x + 4, s.terrain.landing.y, { jobs: 1 }))
    const at = (day: number) => { s.clock.day = day; return seasonFactor(s) }
    expect(at(0)).toBe(COLONY.build.bloomYield)   // month 1 — Bloom
    expect(at(COLONY.build.daysPerMonth * 3)).toBe(COLONY.build.bloomYield)   // month 4 — Bloom
    expect(at(COLONY.build.daysPerMonth * 4)).toBe(COLONY.build.highsunYield) // month 5 — Highsun
    expect(at(COLONY.build.daysPerMonth * 6)).toBe(COLONY.build.greyYield)    // month 7 — Grey
    expect(at(COLONY.build.daysPerMonth * 8)).toBe(COLONY.build.frostYield)   // month 9 — Frost
    expect(at(COLONY.build.daysPerMonth * 11)).toBe(COLONY.build.frostYield)  // month 12 — Frost
  })

  it('the twelve monthly multipliers average to exactly 1.0 (no net change to the yearly food total)', () => {
    let sum = 0
    for (let m = 1; m <= 12; m++) sum += seasonOf(m).multiplier
    expect(sum / 12).toBeCloseTo(1, 10)
  })

  it('a skyfarm in a Bloom month out-produces the same farm in a Frost month', () => {
    const grown = (day: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('calendar', lx, ly, { jobs: 1 }))
      for (let g = 0; g < 5; g++) s.buildings.push(mk('greenhouse', lx + g, ly + 4, { jobs: COLONY.build.greenhouseWorkers }))
      s.colonists = 20
      s.totalJobs = 12
      s.powerGen = 100
      s.power.batteryWh = s.power.batteryCapWh
      s.food = 0
      s.clock.day = day // frozen across the run (stepBuild does not advance the clock)
      for (let i = 0; i < 6; i++) stepBuild(s, sim.rng, 60)
      return s.food
    }
    expect(grown(0)).toBeGreaterThan(grown(COLONY.build.daysPerMonth * 8)) // Bloom (+10%) out-grows Frost (-10%)
  })

  it('the season factor is always bounded to [0.90, 1.10] — it can never starve the colony', () => {
    for (let m = 1; m <= 12; m++) {
      const mult = seasonOf(m).multiplier
      expect(mult).toBeGreaterThanOrEqual(0.9)
      expect(mult).toBeLessThanOrEqual(1.1)
    }
  })
})

describe('Spec 055 — The Long Ledger: a life has a span, and the colony renews', () => {
  const Y = COLONY.build.daysPerYear
  const hall = (x: number, y: number): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: { id: 1, kind: 'hallofnames', color: 0, height: 1, residents: 0, jobs: COLONY.build.hallOfNamesWorkers, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 },
  })

  it('a colony younger than the span sees zero natural passings (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.clock.day = Y * 5 // year 5 — far below the onset span
    s.lastLedgerYear = 4
    s.renewalThisYear = 100
    s.colonists = 50
    ledgerStep(s)
    expect(s.colonists).toBe(50) // no one passes before the span ends
    expect(s.lastPassings).toBe(0)
    expect(s.lastLedgerYear).toBe(5) // the year is still accounted
    expect(ledgerStatus(s).turning).toBe(false)
  })

  it('an old colony sees a small natural turnover at the year-turn', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.clock.day = Y * (COLONY.build.naturalSpanYears + 10) // past the span
    s.lastLedgerYear = COLONY.build.naturalSpanYears + 9
    s.renewalThisYear = 100 // a renewing colony
    s.colonists = 100
    s.food = 100
    ledgerStep(s)
    expect(s.colonists).toBeLessThan(100) // a few elders pass on
    expect(s.lastPassings).toBeGreaterThan(0)
    expect(ledgerStatus(s).turning).toBe(true)
  })

  it('good care lengthens lives — fewer passings when well cared for than when neglected', () => {
    const passings = (caredWell: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.clock.day = Y * (COLONY.build.naturalSpanYears + 10)
      s.lastLedgerYear = COLONY.build.naturalSpanYears + 9
      s.renewalThisYear = 100000 // huge, so the renewal cap never binds — isolate the care factor
      s.colonists = 1000
      s.food = 100 // fed in both
      s.unrest = caredWell ? 0 : 1 // the only difference: a calm, ordered colony vs a disordered one
      ledgerStep(s)
      return s.lastPassings
    }
    expect(passings(true)).toBeLessThan(passings(false)) // care softens the turnover
  })

  it('passings are hard-capped by renewal, by a small fraction, and never below the founding crew', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.clock.day = Y * (COLONY.build.naturalSpanYears + 20)
    s.lastLedgerYear = COLONY.build.naturalSpanYears + 19
    s.colonists = 500
    s.renewalThisYear = 6 // small renewal → the half-renewal cap should bind
    s.food = 0
    s.unrest = 1 // neglected → the base rate would be much larger without the caps
    const col0 = s.colonists
    ledgerStep(s)
    expect(s.lastPassings).toBeLessThanOrEqual(COLONY.build.renewalCapFraction * 6 + 1e-9) // <= half the year's renewal
    expect(s.lastPassings).toBeLessThanOrEqual(COLONY.build.maxPassFraction * col0 + 1e-9) // <= the small ceiling
    expect(s.colonists).toBeGreaterThanOrEqual(COLONY.seed.colonists) // never empties the colony
    expect(s.colonists).toBeCloseTo(col0 - s.lastPassings, 9) // consistent
  })

  it('a staffed Hall of Names eases the grief of a year that takes someone', () => {
    const relief = (hasHall: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.clock.day = Y * (COLONY.build.naturalSpanYears + 10)
      s.lastLedgerYear = COLONY.build.naturalSpanYears + 9
      s.colonists = 500
      s.totalJobs = 100 // staffed
      s.renewalThisYear = 200
      s.food = 0
      s.unrest = 0.5
      if (hasHall) s.buildings.push(hall(lx, ly))
      const u0 = s.unrest
      ledgerStep(s)
      return u0 - s.unrest
    }
    expect(relief(true)).toBeGreaterThan(relief(false)) // remembrance comforts the colony; without a Hall there is no comfort
    expect(relief(false)).toBe(0)
  })
})

describe('Spec 056 — Rimfish: a second food from the cloudsea rim', () => {
  const mk = (kind: 'netdock' | 'habitat' | 'water', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('with no Net Dock there is no rimfish and the food economy is unchanged (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 20
    s.food = 1000
    s.rimfish = 0
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 60)
    expect(s.rimfish).toBe(0) // no dock → no rimfish ever
    expect(rimfishStatus(s).docks).toBe(0)
    expect(rimfishStatus(s).varied).toBe(false)
    expect(s.food).toBeLessThan(1000) // skygrain eaten exactly as today
  })

  it('a staffed Cloudsea Net Dock nets rimfish over several days, capped at storage', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('netdock', s.terrain.landing.x + 4, s.terrain.landing.y, { jobs: COLONY.build.netDockWorkers, rimfishGen: COLONY.build.rimfishPerDay }))
    s.colonists = 6
    s.totalJobs = COLONY.build.netDockWorkers
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.rimfish = 0
    s.food = 1000
    for (let i = 0; i < 600; i++) stepBuild(s, sim.rng, 60)
    expect(s.rimfish).toBeGreaterThan(0) // the nets brought in rimfish
    expect(s.rimfish).toBeLessThanOrEqual(storageCaps(s).rimfish) // never past its store
    expect(rimfishStatus(s).docks).toBe(1)
  })

  it('rimfish spares skygrain — the grain falls more slowly with it than without', () => {
    const skygrainAfter = (withRimfish: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 20
      s.food = 1000 // no greenhouse, so food only drains
      s.rimfish = withRimfish ? 100 : 0
      for (let i = 0; i < 20; i++) stepBuild(s, sim.rng, 60)
      return s.food
    }
    expect(skygrainAfter(true)).toBeGreaterThan(skygrainAfter(false)) // rimfish covered a portion of the meals
  })

  it('rimfish only ever spares grain — it never reduces food below the rimfish-less baseline, and food never goes negative', () => {
    const foodAfter = (withRimfish: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      s.colonists = 20
      s.food = 5 // scarce — without help it drains to nothing
      s.rimfish = withRimfish ? 100 : 0
      for (let i = 0; i < 20; i++) stepBuild(s, sim.rng, 60)
      return s.food
    }
    expect(foodAfter(true)).toBeGreaterThanOrEqual(foodAfter(false)) // rimfish never costs grain, only spares it
    expect(foodAfter(false)).toBeGreaterThanOrEqual(0) // never negative
    expect(foodAfter(true)).toBeGreaterThanOrEqual(0)
  })

  it('a varied table draws settlers a little faster', () => {
    const grew = (withRimfish: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.buildings.push(mk('habitat', lx, ly, { residents: 40 })) // capacity 42 — lots of room
      s.buildings.push(mk('water', lx, ly)) // watered → liveable
      s.power.batteryWh = s.power.batteryCapWh
      s.power.solarW = 5
      s.food = 5000
      s.colonists = 8
      s.rimfish = withRimfish ? 90 : 0 // a varied table on offer (held high so it stays > 0 across the run)
      const c0 = s.colonists
      for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 10)
      return s.colonists - c0
    }
    expect(grew(true)).toBeGreaterThan(grew(false)) // the richer table pulls settlers in faster
  })
})

describe('Spec 057 — Seasonal Solar Angling: the sun keeps the calendar too', () => {
  const M = COLONY.build.daysPerMonth
  const mk = (kind: 'calendar' | 'turbine', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('with no Calendar Office solar is flat all year — the factor is 1 in every month (inert)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.clock.day = M * 8 // month 9 — would be the Frost dip with a calendar
    expect(solarSeasonFactor(s)).toBe(1)
  })

  it('with a Calendar Office, solar output follows the month bands (peaks in Highsun, dips in Frost)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('calendar', s.terrain.landing.x + 4, s.terrain.landing.y, { jobs: 1 }))
    const at = (day: number) => { s.clock.day = day; return solarSeasonFactor(s) }
    expect(at(0)).toBe(COLONY.build.solarBloom)        // month 1 — Bloom
    expect(at(M * 4)).toBe(COLONY.build.solarHighsun)  // month 5 — Highsun (the peak)
    expect(at(M * 6)).toBe(COLONY.build.solarGrey)     // month 7 — Grey
    expect(at(M * 8)).toBe(COLONY.build.solarFrost)    // month 9 — Frost (the dip)
  })

  it('the twelve monthly solar multipliers average to exactly 1.0 (annual solar yield unchanged)', () => {
    let sum = 0
    for (let m = 1; m <= 12; m++) sum += solarSeasonOf(m)
    expect(sum / 12).toBeCloseTo(1, 10)
  })

  it('wind-shear turbines are unaffected by the season (wind has no season)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.buildings.push(mk('calendar', s.terrain.landing.x + 4, s.terrain.landing.y, { jobs: 1 }))
    s.buildings.push(mk('turbine', s.terrain.landing.x + 5, s.terrain.landing.y, { jobs: COLONY.build.turbineWorkers }))
    s.colonists = 8
    s.totalJobs = 4 // staffed
    s.clock.day = M * 4 // Highsun
    const highsun = turbinePower(s)
    s.clock.day = M * 8 // Frost
    const frost = turbinePower(s)
    expect(highsun).toBeGreaterThan(0) // the turbine is producing
    expect(frost).toBe(highsun) // ...and the season never changes it
  })

  it('the solar factor is always bounded to [0.90, 1.15] — it can never black out the colony', () => {
    for (let m = 1; m <= 12; m++) {
      const f = solarSeasonOf(m)
      expect(f).toBeGreaterThanOrEqual(0.9)
      expect(f).toBeLessThanOrEqual(1.15)
    }
  })
})

describe('Spec 058 — Household Waste: a colony that does not handle its filth sickens', () => {
  const mk = (kind: 'habitat' | 'sanitation', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a small colony over a short run stays under the harmless line (inert — no effect)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let h = 0; h < 3; h++) s.buildings.push(mk('habitat', lx + h, ly, { residents: 4 }))
    s.colonists = 8
    for (let i = 0; i < 30; i++) stepBuild(s, sim.rng, 60)
    expect(s.waste).toBeLessThan(COLONY.build.wasteHarmlessBelow) // far below 0.25
    expect(wasteDesirabilityFactor(s)).toBe(1) // no draw penalty below the line
    expect(wasteStatus(s).harmful).toBe(false)
  })

  it('an occupied colony with no Sanitation Post slowly accumulates waste', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let h = 0; h < 20; h++) s.buildings.push(mk('habitat', lx + (h % 10), ly + Math.floor(h / 10), { residents: 4 }))
    s.colonists = 8
    const w0 = s.waste
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 60)
    expect(s.waste).toBeGreaterThan(w0) // the filth builds
  })

  it('waste harms in bands: desirability slips above 0.25, fever breeds above 0.50 — nothing below', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.waste = 0.1
    expect(wasteDesirabilityFactor(s)).toBe(1) // harmless
    s.waste = 0.5
    expect(wasteDesirabilityFactor(s)).toBeLessThan(1) // a filthy colony draws slower

    const feverGain = (waste: number) => {
      const sub = new ColonySim(7)
      const s2 = sub.state
      s2.buildings.push(mk('habitat', s2.terrain.landing.x, s2.terrain.landing.y, { residents: 4 }))
      s2.waste = waste
      s2.outbreak = 0
      for (let i = 0; i < 10; i++) wasteStep(s2, 60)
      return s2.outbreak ?? 0
    }
    expect(feverGain(0.6)).toBeGreaterThan(feverGain(0.1)) // filth past the fever line breeds sickness
    expect(feverGain(0.1)).toBe(0) // below the line, waste breeds no fever
  })

  it('a staffed Sanitation Post clears the waste meter over time', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let h = 0; h < 20; h++) s.buildings.push(mk('habitat', lx + (h % 10), ly + Math.floor(h / 10), { residents: 4 }))
    s.buildings.push(mk('sanitation', lx, ly + 5, { jobs: COLONY.build.sanitationWorkers }))
    s.colonists = 8
    s.totalJobs = 4 // staffed
    s.waste = 0.5
    for (let i = 0; i < 50; i++) stepBuild(s, sim.rng, 60)
    expect(s.waste).toBeLessThan(0.5) // the keepers cleared it down
  })

  it('waste is clamped to [0,1] and the fever it breeds stays bounded (never a catastrophe)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let h = 0; h < 20; h++) s.buildings.push(mk('habitat', lx + (h % 10), ly + Math.floor(h / 10), { residents: 4 }))
    s.colonists = 8
    s.waste = 0.99
    for (let i = 0; i < 100; i++) stepBuild(s, sim.rng, 60)
    expect(s.waste).toBeLessThanOrEqual(1)
    expect(s.waste).toBeGreaterThanOrEqual(0)
    expect(s.outbreak ?? 0).toBeLessThanOrEqual(1) // the fever it breeds is bounded
  })
})

describe('Spec 059 — The Watch Nook: a rich colony keeps honest lamps burning', () => {
  const mk = (kind: 'watchnook', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('a poor or small colony loses nothing to theft (inert below the floors)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.food = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    s.colonists = 30; s.treasury = 400 // rich enough in people but the coffers are below the floor
    expect(securityStatus(s).active).toBe(false)
    s.colonists = 10; s.treasury = 1000 // rich coffers but too few people to tempt theft
    expect(securityStatus(s).active).toBe(false)
  })

  it('a rich, populous, unguarded colony bleeds a little treasury over time', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 30
    s.treasury = 1000
    s.food = 100
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.unrest = 0
    expect(securityStatus(s).active).toBe(true)
    const t0 = s.treasury
    for (let i = 0; i < 200; i++) stepBuild(s, sim.rng, 60)
    expect(s.treasury).toBeLessThan(t0) // skimmed by petty theft
  })

  it('theft can never push the treasury below zero (never creates debt)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 30
    s.treasury = 501 // just over the floor
    s.food = 100
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.unrest = 0
    for (let i = 0; i < 2000; i++) stepBuild(s, sim.rng, 60)
    expect(s.treasury).toBeGreaterThanOrEqual(0) // theft never makes debt
    expect(s.treasury).toBeLessThanOrEqual(501) // ...it only ever took coin
  })

  it('a staffed Watch Nook cuts theft, and two stop it entirely', () => {
    const stolen = (nooks: number) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.colonists = 30
      s.totalJobs = 4 // staffed
      s.treasury = 1000
      s.food = 100
      s.powerGen = 100
      s.power.batteryWh = s.power.batteryCapWh
      s.unrest = 0
      for (let n = 0; n < nooks; n++) s.buildings.push(mk('watchnook', lx + n, ly, { jobs: 2 }))
      const t0 = s.treasury
      for (let i = 0; i < 300; i++) stepBuild(s, sim.rng, 60)
      return t0 - s.treasury
    }
    expect(stolen(0)).toBeGreaterThan(stolen(1)) // one Nook cuts the bleed
    expect(stolen(2)).toBe(0) // two stop it entirely
  })

  it('thieves lie low in a crisis — a shortage pauses theft', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    s.colonists = 30
    s.treasury = 1000
    s.powerGen = 100
    s.power.batteryWh = s.power.batteryCapWh
    s.unrest = 0
    s.food = 0 // an empty larder — the colony is watching the stores, not the coffers
    expect(securityStatus(s).active).toBe(false)
    s.food = 100 // larder restored
    expect(securityStatus(s).active).toBe(true) // ...and the petty theft resumes
  })
})

describe('Spec 060 — The Variety Ration Counter: two foods finally beat one', () => {
  const mk = (kind: 'rationvar', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  // Drive the colony for `steps` hour-steps, topping up whichever foods are on the table each step so the trailing diet window fills.
  const feed = (sim: ColonySim, steps: number, sky: boolean, fish: boolean) => {
    const s = sim.state
    for (let i = 0; i < steps; i++) {
      if (sky) s.food = 500
      if (fish) s.rimfish = 500
      stepBuild(s, sim.rng, 60)
    }
  }

  it('inert without a counter — both foods on the table change nothing', () => {
    const sim = new ColonySim(11)
    const s = sim.state
    s.colonists = 40; s.totalJobs = 4; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    feed(sim, 30, true, true) // eating greens AND rimfish, but no Variety Ration Counter built
    expect(dietVarietyStatus(s).counters).toBe(0)
    expect(varietyCovered(s)).toBe(0)
    expect(dietVarietyStatus(s).varied).toBe(false)
    expect(varietyDesirabilityFactor(s)).toBe(1) // no reputation lift
    expect(varietyEvolutionFactor(s)).toBe(1) // no evolution speed-up
  })

  it('a counter on one food earns no bonus and no penalty', () => {
    const sim = new ColonySim(11)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 40; s.totalJobs = 4; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    s.buildings.push(mk('rationvar', lx, ly, { jobs: 2 }))
    feed(sim, 40, true, false) // skyfarm only — rimfish never reaches the table
    expect(varietyCovered(s)).toBeGreaterThan(0) // the counter covers people...
    expect(dietVarietyStatus(s).varied).toBe(false) // ...but one food is no varied diet
    expect(s.dietStanding ?? 0).toBe(0)
    expect(varietyDesirabilityFactor(s)).toBe(1) // no bonus AND no penalty
    expect(varietyEvolutionFactor(s)).toBe(1)
  })

  it('a staffed, powered counter on two foods earns a Varied Diet', () => {
    const sim = new ColonySim(11)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 40; s.totalJobs = 4; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    s.buildings.push(mk('rationvar', lx, ly, { jobs: 2 }))
    feed(sim, 40, true, true) // greens AND rimfish both on the table
    const d = dietVarietyStatus(s)
    expect(d.varied).toBe(true)
    expect(d.standing).toBeGreaterThan(0)
    expect(d.share).toBeGreaterThanOrEqual(COLONY.build.varietyMinShare) // both foods genuinely share the table
    expect(d.share).toBeLessThanOrEqual(COLONY.build.varietyMaxShare)
    expect(varietyDesirabilityFactor(s)).toBeGreaterThan(1) // a varied table lifts the colony's draw on newcomers
    expect(varietyEvolutionFactor(s)).toBeLessThan(1) // ...and helps served homes climb a touch sooner
  })

  it('the bonus scales with coverage and never dips below the no-counter baseline', () => {
    const sim = new ColonySim(11)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('rationvar', lx, ly, { jobs: 2 }))
    s.colonists = 160 // one counter (capacity 80) covers half
    expect(varietyCovered(s)).toBeCloseTo(0.5, 5)
    s.dietStanding = 1 // a standing in force
    expect(varietyDesirabilityFactor(s)).toBeCloseTo(1 + COLONY.build.varietyDesirabilityBonus * 0.5, 5) // half coverage → half the lift
    expect(dietVarietyStatus(s).bonus).toBeCloseTo(COLONY.build.varietyDesirabilityBonus * 0.5, 5)
    s.colonists = 40 // one counter now covers everyone (capped at 1)
    expect(varietyCovered(s)).toBe(1)
    s.dietStanding = 0 // no standing → exactly the no-counter baseline, never below
    expect(varietyDesirabilityFactor(s)).toBe(1)
    expect(varietyEvolutionFactor(s)).toBe(1)
  })

  it('a lost crew or grid holds the standing a few days, then it fades — never a penalty', () => {
    const sim = new ColonySim(11)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 40; s.totalJobs = 4; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    s.buildings.push(mk('rationvar', lx, ly, { jobs: 2 }))
    feed(sim, 40, true, true)
    expect(s.dietStanding ?? 0).toBeGreaterThan(0.99) // a full standing earned

    // pull the grid: force a brownout (huge load, flat battery) so the counter goes dark; keep a trickle of solar so no one emigrates
    s.power.loadW = 100000; s.power.batteryWh = 0; s.power.solarW = 1; s.powerGen = 0
    expect(inBrownout(s)).toBe(true)
    feed(sim, 24 * 3, true, true) // ~3 days dark (under the 5-day hold), still serving both foods
    const held = s.dietStanding ?? 0
    expect(held).toBeGreaterThan(0) // the standing held, not dropped off a cliff
    expect(held).toBeLessThan(1) // ...but winding down
    expect(varietyDesirabilityFactor(s)).toBeGreaterThanOrEqual(1) // never a penalty during the fade

    feed(sim, 24 * 6, true, true) // past the 5-day hold
    expect(s.dietStanding ?? 0).toBe(0) // faded to neutral
    expect(varietyDesirabilityFactor(s)).toBe(1) // back to the no-counter baseline, never below
  })
})

describe('Spec 061 — Rimfish Drying Racks: bank the second food for a lean season', () => {
  const mk = (kind: 'dryrack' | 'rationvar' | 'storehouse', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('inert without a rack — no dried store and no fish drying', () => {
    const sim = new ColonySim(13)
    const s = sim.state
    s.colonists = 30; s.totalJobs = 6; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    expect(driedFishStatus(s).racks).toBe(0)
    for (let i = 0; i < 40; i++) { s.rimfish = 100; s.food = 500; stepBuild(s, sim.rng, 60) }
    expect(s.driedFish ?? 0).toBe(0) // nothing is dried without a rack
    expect(driedFishStatus(s).stock).toBe(0)
  })

  it('a staffed rack dries the SURPLUS catch, but a colony at the reserve dries nothing', () => {
    const dried = (rimfishHeld: number) => {
      const sim = new ColonySim(13)
      const s = sim.state
      const lx = s.terrain.landing.x, ly = s.terrain.landing.y
      s.colonists = 30; s.totalJobs = 6; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
      s.buildings.push(mk('dryrack', lx, ly, { jobs: 2 }))
      s.driedFish = 0
      for (let i = 0; i < 40; i++) { s.rimfish = rimfishHeld; s.food = 500; stepBuild(s, sim.rng, 60) }
      return s.driedFish
    }
    expect(dried(100)).toBeGreaterThan(0) // plenty above the 20 reserve → the surplus is dried
    expect(dried(15)).toBe(0) // below the reserve → nothing dried, the homes keep their fish
  })

  it('drying loses weight — dried banked never exceeds the loss-adjusted fresh consumed', () => {
    const sim = new ColonySim(13)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 30; s.totalJobs = 6; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    for (let n = 0; n < 3; n++) s.buildings.push(mk('storehouse', lx + 2 + n, ly, {})) // raise the caps so nothing clamps
    s.buildings.push(mk('dryrack', lx, ly, { jobs: 2 }))
    s.rimfish = 300; s.driedFish = 0
    const rim0 = s.rimfish
    for (let i = 0; i < 30; i++) { s.food = 500; stepBuild(s, sim.rng, 60) } // do NOT top rimfish — let it draw down
    const rimfishConsumed = rim0 - (s.rimfish ?? 0)
    const driedProduced = s.driedFish ?? 0
    const ratio = COLONY.build.dryRackOutputPerDay / COLONY.build.dryRackRimfishPerDay
    expect(COLONY.build.dryRackOutputPerDay).toBeLessThan(COLONY.build.dryRackRimfishPerDay) // the loss is real by design (8 per 12)
    expect(driedProduced).toBeGreaterThan(0)
    expect(driedProduced).toBeLessThanOrEqual(rimfishConsumed * ratio + 1e-6) // dried gained is at most the loss-adjusted fresh spent
  })

  it('the dried reserve keeps fish (and a varied diet) on the table when the fresh catch runs out', () => {
    const sim = new ColonySim(13)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 30; s.totalJobs = 6; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    for (let n = 0; n < 2; n++) s.buildings.push(mk('storehouse', lx + 2 + n, ly, {})) // headroom so the reserve lasts
    s.buildings.push(mk('dryrack', lx, ly, { jobs: 2 }))
    s.buildings.push(mk('rationvar', lx + 1, ly, { jobs: 2 })) // a Variety Ration Counter watching the table
    // bank a dried reserve while eating both foods (earns a Varied Diet too)
    for (let i = 0; i < 60; i++) { s.rimfish = 200; s.food = 500; stepBuild(s, sim.rng, 60) }
    const driedBefore = s.driedFish ?? 0
    expect(driedBefore).toBeGreaterThan(0)
    expect(dietVarietyStatus(s).varied).toBe(true)
    // the net docks go idle: no fresh fish at all
    for (let i = 0; i < 10; i++) { s.rimfish = 0; s.food = 500; stepBuild(s, sim.rng, 60) }
    expect(s.driedFish ?? 0).toBeLessThan(driedBefore) // the homes ate into the dried reserve...
    expect(dietVarietyStatus(s).varied).toBe(true) // ...and the diet stayed varied on dried fish
  })

  it('dried rimfish never exceeds its cap and never goes negative', () => {
    const sim = new ColonySim(13)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.colonists = 30; s.totalJobs = 6; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    s.buildings.push(mk('dryrack', lx, ly, { jobs: 2 }))
    const cap = storageCaps(s).driedFish
    for (let i = 0; i < 300; i++) { s.rimfish = 300; s.food = 500; stepBuild(s, sim.rng, 60) } // overproduce
    expect(s.driedFish ?? 0).toBeLessThanOrEqual(cap) // clamped to the cap
    expect(s.driedFish ?? 0).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < 400; i++) { s.rimfish = 0; s.food = 0; stepBuild(s, sim.rng, 60) } // starve it down
    expect(s.driedFish ?? 0).toBeGreaterThanOrEqual(0) // never negative
  })
})

describe('Spec 062 — The Labour Registry Desk: idle hands finally show in the books', () => {
  const mk = (kind: 'census' | 'registry', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  // Hold a colony at a fixed unemployment (workers vs jobs) across `days`, re-pinning the levers each day so the rate stays put.
  const holdIdle = (sim: ColonySim, workers: number, jobs: number, days: number) => {
    const s = sim.state
    for (let i = 0; i < days; i++) {
      s.colonists = workers; s.totalJobs = jobs; s.treasury = 5000; s.standing = 1; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
      stepBuild(s, sim.rng, 24 * 60) // one whole day per step, so the day-counters tick cleanly
    }
  }

  it('inert without a desk — heavy unemployment does not drag Prosperity', () => {
    const sim = new ColonySim(17)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('census', lx, ly, { jobs: 2 }))
    s.colonists = 100; s.totalJobs = 30; s.treasury = 5000; s.standing = 1 // 70% idle, but no Registry
    const rankBefore = prosperityRank(s)
    holdIdle(sim, 100, 30, 20)
    expect(s.registryPenalty ?? 0).toBe(0) // no Registry → the books never book it
    expect(prosperityRank(s)).toBe(rankBefore) // Prosperity unchanged by idleness
    expect(labourStatus(s).active).toBe(false)
  })

  it('a staffed Registry surfaces the employment rate', () => {
    const sim = new ColonySim(17)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('registry', lx, ly, { jobs: 2 }))
    s.colonists = 100; s.totalJobs = 60
    const st = labourStatus(s)
    expect(st.active).toBe(true)
    expect(st.unemployment).toBeCloseTo(0.4, 5) // 1 - 60/100
    expect(st.covered).toBeGreaterThan(0)
  })

  it('chronic idleness drags the Prosperity Rank a step, then two', () => {
    const sim = new ColonySim(17)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('census', lx, ly, { jobs: 2 }))
    s.buildings.push(mk('registry', lx + 1, ly, { jobs: 2 }))
    s.colonists = 100; s.totalJobs = 50; s.treasury = 5000; s.standing = 1 // 50% unemployment (above both lines)
    const baseRank = prosperityRank(s)
    expect(baseRank).toBeGreaterThan(0) // a meaningful starting rank, so the drag is visible
    holdIdle(sim, 100, 50, 8) // past the 7-day high line, short of the 14-day severe line
    expect(s.registryPenalty).toBe(1)
    expect(prosperityRank(s)).toBe(Math.max(0, baseRank - 1))
    holdIdle(sim, 100, 50, 8) // now past the 14-day severe line (16 days total)
    expect(s.registryPenalty).toBe(2)
    expect(prosperityRank(s)).toBe(Math.max(0, baseRank - 2))
  })

  it('the penalty clears once the colony returns to full employment', () => {
    const sim = new ColonySim(17)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('census', lx, ly, { jobs: 2 }))
    s.buildings.push(mk('registry', lx + 1, ly, { jobs: 2 }))
    holdIdle(sim, 100, 50, 16) // earn the -2
    expect(s.registryPenalty).toBe(2)
    holdIdle(sim, 100, 120, 8) // jobs now outnumber workers → 0% unemployment, held a week
    expect(s.registryPenalty).toBe(0) // the drag lifts
  })

  it('a fresh desk applies no penalty until the day-count, and the drag never sinks the rank below the floor', () => {
    const sim = new ColonySim(17)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('census', lx, ly, { jobs: 2 }))
    s.buildings.push(mk('registry', lx + 1, ly, { jobs: 2 }))
    holdIdle(sim, 100, 50, 5) // only 5 days of idleness — under the 7-day onset
    expect(s.registryPenalty ?? 0).toBe(0) // raising the desk did not snap the rank down
    holdIdle(sim, 100, 50, 20) // now well past the severe line
    expect(s.registryPenalty).toBe(2)
    expect(prosperityRank(s)).toBeGreaterThanOrEqual(0) // floored — never below the bottom rank
  })
})

describe('Spec 063 — The Planter Square: a deliberate patch of beauty', () => {
  const mk = (kind: 'planter' | 'habitat' | 'water', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('inert without a Planter — desirability and liveability are exactly as today', () => {
    const sim = new ColonySim(19)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('habitat', lx, ly), mk('water', lx, ly))
    expect(planterStatus(s).squares).toBe(0)
    expect(planterDesirabilityFactor(s)).toBe(1)
    expect(planterLiveabilityBoost(s, s.buildings[0]!, 1)).toBe(0)
  })

  it('a tended, watered Planter comes into Bloom, and fades when the water stops', () => {
    const sim = new ColonySim(19)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    const planter = mk('planter', lx, ly, { jobs: 1 })
    s.buildings.push(planter)
    s.colonists = 20; s.totalJobs = 4; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    for (let i = 0; i < 8; i++) { s.water = 100; s.colonists = 20; s.totalJobs = 4; stepBuild(s, sim.rng, 24 * 60) }
    expect(planterBlooming(planter)).toBe(true) // tended + watered 8 days → Blooming
    for (let i = 0; i < 5; i++) { s.water = 0; s.colonists = 20; s.totalJobs = 4; stepBuild(s, sim.rng, 24 * 60) } // the tanks run dry
    expect(planterBlooming(planter)).toBe(false) // untended → the Bloom fades
  })

  it('a Bloom lifts a served home, the near ring more than the far ring', () => {
    const sim = new ColonySim(19)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    const planter = mk('planter', lx, ly, { jobs: 1 }); planter.tend = COLONY.build.planterBloomCap // Bloom it directly
    const near = mk('habitat', lx + 2, ly); const far = mk('habitat', lx + 6, ly); const control = mk('habitat', lx + 40, ly)
    // each home served by its own co-located Water Hub (distance 0 → always in range)
    s.buildings.push(planter, near, mk('water', lx + 2, ly), far, mk('water', lx + 6, ly), control, mk('water', lx + 40, ly))
    expect(planterBlooming(planter)).toBe(true)
    const lNear = homeLiveability(s, near), lFar = homeLiveability(s, far), lControl = homeLiveability(s, control)
    expect(lNear).toBeGreaterThan(lFar) // +6 within 4 tiles beats...
    expect(lFar).toBeGreaterThan(lControl) // ...+3 within 8 tiles beats no Planter at all
  })

  it('a home gathers at most the cap from a wall of Planters, and never drops below baseline untended', () => {
    const sim = new ColonySim(19)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    const home = mk('habitat', lx, ly)
    s.buildings.push(home, mk('water', lx, ly))
    // ring the home with five Blooming Planters, all in the near ring (5 x 6 = 30 raw points, capped at 12)
    for (let i = 0; i < 5; i++) { const p = mk('planter', lx + 1 + i, ly + 1, { jobs: 1 }); p.tend = COLONY.build.planterBloomCap; s.buildings.push(p) }
    expect(planterLiveabilityBoost(s, home, 1)).toBeCloseTo(COLONY.build.planterMaxBonus * COLONY.build.planterLiveabilityPerPoint, 6) // capped at +12 points
    // now strip the Bloom: untended Planters give nothing, and the home returns to exactly its no-Planter liveability
    for (const b of s.buildings) if (b.artifact.kind === 'planter') b.tend = 0
    expect(planterLiveabilityBoost(s, home, 1)).toBe(0)
    const withUntended = homeLiveability(s, home)
    s.buildings = s.buildings.filter((b) => b.artifact.kind !== 'planter')
    expect(homeLiveability(s, home)).toBe(withUntended) // untended Planters changed nothing — no penalty
  })

  it('a Bloom draws settlers — immigration desirability rises, and is neutral untended', () => {
    const sim = new ColonySim(19)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    const planter = mk('planter', lx, ly, { jobs: 1 }); planter.tend = COLONY.build.planterBloomCap // Bloom it directly
    s.buildings.push(planter, mk('habitat', lx + 2, ly))
    expect(planterDesirabilityFactor(s)).toBeGreaterThan(1) // a cared-for colony draws settlers a touch faster
    planter.tend = 0 // untended → no Bloom
    expect(planterDesirabilityFactor(s)).toBe(1) // ...and neutral again, never below 1
  })
})

describe('Spec 064 — The Market Stall: local custom returns a little coin', () => {
  const mk = (kind: 'stall' | 'comptroller', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('inert without a stall — surplus wares earn no extra coin', () => {
    const sim = new ColonySim(23)
    const s = sim.state
    s.colonists = 40; s.totalJobs = 8; s.treasury = 1000; s.linen = 100; s.folios = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    const t0 = s.treasury, l0 = s.linen
    for (let i = 0; i < 5; i++) { s.colonists = 40; s.totalJobs = 8; stepBuild(s, sim.rng, 24 * 60) }
    expect(stallStatus(s).stalls).toBe(0)
    expect(s.treasury).toBe(t0) // no stall → the treasury earns exactly as before
    expect(s.linen).toBe(l0) // ...and no ware is consumed
  })

  it('a staffed stall sells surplus wares to paid colonists for coin', () => {
    const sim = new ColonySim(23)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('stall', lx, ly, { jobs: 2 }))
    s.colonists = 40; s.totalJobs = 8; s.treasury = 1000; s.linen = 100; s.folios = 5 // folios below the reserve → it sells linen
    const t0 = s.treasury, l0 = s.linen
    for (let i = 0; i < 2; i++) { s.colonists = 40; s.totalJobs = 8; stepBuild(s, sim.rng, 24 * 60) }
    expect(s.treasury).toBeGreaterThan(t0) // coin came back to the public box
    expect(s.linen).toBeLessThan(l0) // ...from selling surplus linen
    expect(s.treasury - t0).toBe((l0 - s.linen) * COLONY.build.stallCoinPerSale) // every coin matches a ware sold at the set price
  })

  it('the stall never sells linen or folios below the reserve', () => {
    const sim = new ColonySim(23)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('stall', lx, ly, { jobs: 2 }))
    s.colonists = 40; s.totalJobs = 8; s.treasury = 1000
    s.linen = COLONY.build.stallReserve; s.folios = COLONY.build.stallReserve // exactly at the reserve → nothing to sell
    const t0 = s.treasury
    for (let i = 0; i < 10; i++) { s.colonists = 40; s.totalJobs = 8; stepBuild(s, sim.rng, 24 * 60) }
    expect(s.linen).toBe(COLONY.build.stallReserve) // never dipped below the reserve
    expect(s.treasury).toBe(t0) // and earned nothing (no surplus)
    s.linen = COLONY.build.stallReserve + 6 // a small surplus
    for (let i = 0; i < 60; i++) { s.colonists = 40; s.totalJobs = 8; stepBuild(s, sim.rng, 24 * 60) }
    expect(s.linen).toBe(COLONY.build.stallReserve) // drew the surplus down to exactly the reserve, no further
  })

  it('wages in deep arrears close the stalls; solvency reopens them', () => {
    const sim = new ColonySim(23)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('stall', lx, ly, { jobs: 2 }), mk('comptroller', lx + 1, ly, { jobs: 2 })) // a Comptroller lets the treasury run negative
    s.colonists = 40; s.totalJobs = 8; s.linen = 100
    for (let i = 0; i < 3; i++) { s.colonists = 40; s.totalJobs = 8; s.treasury = -COLONY.build.debtCeiling; stepBuild(s, sim.rng, 24 * 60) } // deep arrears strain
    expect(s.linen).toBe(100) // nobody shops on an empty purse → nothing sold
    s.treasury = 1000 // wages paid again
    for (let i = 0; i < 2; i++) { s.colonists = 40; s.totalJobs = 8; stepBuild(s, sim.rng, 24 * 60) }
    expect(s.linen).toBeLessThan(100) // custom returns → the stall sells again
  })

  it('the stall only ever adds coin — the treasury never falls from selling', () => {
    const sim = new ColonySim(23)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('stall', lx, ly, { jobs: 2 }))
    s.colonists = 40; s.totalJobs = 8; s.treasury = 1000; s.linen = 100; s.folios = 100 // food left at 0 so no other treasury effect stirs
    for (let i = 0; i < 10; i++) { s.colonists = 40; s.totalJobs = 8; const before = s.treasury; stepBuild(s, sim.rng, 24 * 60); expect(s.treasury).toBeGreaterThanOrEqual(before) }
    expect(s.treasury).toBeGreaterThan(1000) // ...and it did earn a margin
  })
})

describe('Spec 065 — Deck Fires and the Fire-Watch Post: a blaze that eats the floor', () => {
  const mk = (kind: 'firewatch' | 'workshop' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: kind === 'firewatch' ? 3 : kind === 'workshop' ? 10 : 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })
  const forceBrownout = (s: ColonySim['state']) => { s.power.loadW = 100000; s.power.batteryWh = 0; s.powerGen = 0; s.power.solarW = 0 }

  it('inert without a Post — stressed buildings never carry fire risk or ignite', () => {
    const sim = new ColonySim(29)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    const ws = mk('workshop', lx, ly); ws.wear = 1 // worn + hot work, but no Fire-Watch anywhere
    s.buildings.push(ws)
    s.colonists = 20; s.totalJobs = 8
    forceBrownout(s)
    for (let i = 0; i < 6; i++) { s.colonists = 20; s.totalJobs = 8; forceBrownout(s); stepBuild(s, sim.rng, 24 * 60) }
    expect(fireStatus(s).posts).toBe(0)
    expect(ws.fire).toBeUndefined() // no Post → fire stays inside the generic incident
    expect(ws.fireRisk ?? 0).toBe(0)
  })

  it('an unwatched district accrues risk and ignites its worst building; a calm one does not', () => {
    const sim = new ColonySim(29)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('firewatch', lx, ly, { jobs: 3 }))
    const ws = mk('workshop', lx + 2, ly); ws.wear = 1 // worn + hot work
    const home = mk('habitat', lx + 5, ly) // calm: not worn, not hot work, and NON-adjacent (no spread can reach it)
    s.buildings.push(ws, home)
    s.colonists = 20; s.totalJobs = 8; s.water = 0 // dry tanks → the watch cannot protect
    forceBrownout(s)
    expect(inBrownout(s)).toBe(true)
    for (let i = 0; i < 5; i++) { s.colonists = 20; s.totalJobs = 8; s.water = 0; forceBrownout(s); stepBuild(s, sim.rng, 24 * 60) }
    expect(ws.fire).toBeGreaterThan(0) // the worst building caught
    expect(home.fire).toBeUndefined() // the calm one did not
    expect(s.fireCooldown).toBeGreaterThan(0) // ...and the district's one-per-window rate-limit is armed
  })

  it('a staffed, watered Post puts a Spark out', () => {
    const sim = new ColonySim(29)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('firewatch', lx, ly, { jobs: 3 }))
    const ws = mk('workshop', lx + 2, ly); ws.fire = 1 // a fresh Spark
    s.buildings.push(ws)
    s.colonists = 20; s.totalJobs = 8; s.water = 200; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh // staffed + watered
    for (let i = 0; i < 3; i++) { s.colonists = 20; s.totalJobs = 8; s.water = 200; stepBuild(s, sim.rng, 60) }
    expect(ws.fire).toBeUndefined() // the bucket-line put it out before it grew
  })

  it('an unfought fire spreads to a deck-neighbour, then destroys the building', () => {
    const sim = new ColonySim(29)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('firewatch', lx, ly + 3, { jobs: 3 })) // a Post stands but the tanks are dry
    const a = mk('workshop', lx, ly); a.fire = COLONY.build.fireSpreadAt - 30 // a Blaze about to spread
    const near = mk('workshop', lx + 1, ly) // a direct deck-neighbour (distance 1)
    const far = mk('workshop', lx + 4, ly) // across an empty gap (distance 4) — never catches
    s.buildings.push(a, near, far)
    s.colonists = 20; s.totalJobs = 8; s.water = 0 // dry → no suppression
    for (let i = 0; i < 3; i++) { s.colonists = 20; s.totalJobs = 8; s.water = 0; stepBuild(s, sim.rng, 60) }
    expect(near.fire).toBeGreaterThan(0) // the blaze leapt to the neighbour
    expect(far.fire).toBeUndefined() // ...but not across the gap
    for (let i = 0; i < 40; i++) { s.colonists = 20; s.totalJobs = 8; s.water = 0; stepBuild(s, sim.rng, 60) }
    expect(s.buildings.some((b) => b.id === a.id)).toBe(false) // the original building burned down and is gone
  })

  it('a dry Post cannot suppress, and destruction never drives a stockpile below zero', () => {
    const sim = new ColonySim(29)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('firewatch', lx, ly, { jobs: 3 }))
    const ws = mk('workshop', lx + 2, ly); ws.fire = 100 // a young fire
    s.buildings.push(ws)
    s.colonists = 20; s.totalJobs = 8; s.water = 0; s.materials = 0; s.components = 0 // dry tanks, empty stores
    const before = ws.fire
    stepBuild(s, sim.rng, 60)
    expect(ws.fire).toBeGreaterThan(before) // a dry watch is a painted bucket — the fire grew
    ws.fire = COLONY.build.fireDestroyAt - 30 // push it to the brink of destruction
    for (let i = 0; i < 3; i++) { s.colonists = 20; s.totalJobs = 8; s.water = 0; stepBuild(s, sim.rng, 60) }
    expect(s.buildings.some((b) => b.id === ws.id)).toBe(false) // destroyed
    expect(s.materials).toBeGreaterThanOrEqual(0) // ...and no stockpile went negative
    expect(s.components).toBeGreaterThanOrEqual(0)
  })
})

describe('Spec 066 — The Greywater Reclaimer: get some of our own water back', () => {
  const mk = (kind: 'reclaimer' | 'cistern' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: kind === 'reclaimer' ? 2 : 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })
  // a populous, powered, tanked colony with headroom in the tanks (the cisterns give the tank cap; water starts empty)
  const setup = (withReclaimer: boolean) => {
    const sim = new ColonySim(31)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let i = 0; i < 8; i++) s.buildings.push(mk('cistern', lx + i, ly + 4, { jobs: 2 }))
    if (withReclaimer) s.buildings.push(mk('reclaimer', lx, ly, { jobs: 2 }))
    s.colonists = 20; s.totalJobs = 6; s.water = 0; s.linen = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    return { sim, s }
  }

  it('inert without a Reclaimer; a staffed, powered one returns water to the tanks', () => {
    const without = setup(false)
    const withR = setup(true)
    // one day, while the tanks still have headroom (cisterns fill fast, so the plant's value shows before the tank brims)
    for (const c of [without, withR]) { c.s.colonists = 20; c.s.totalJobs = 6; stepBuild(c.s, c.sim.rng, 24 * 60) }
    expect(reclaimStatus(without.s).plants).toBe(0) // no plant → the water economy is exactly as before
    expect(withR.s.water).toBeGreaterThan(without.s.water) // ...and the plant got some of the colony's own water back
  })

  it('a brownout halves the return', () => {
    const { s } = setup(true)
    expect(reclaimStatus(s).perDay).toBe(40) // 20 colonists -> 80 greywater, treated 2:1 -> 40/day
    s.power.loadW = 100000; s.power.batteryWh = 0; s.power.solarW = 1 // force a brownout (keep a trickle of solar so it is not power-dead)
    expect(inBrownout(s)).toBe(true)
    expect(reclaimStatus(s).perDay).toBe(20) // ...the heavy pump sheds, so the return halves
  })

  it('without filter linen the plant runs at half rate', () => {
    const { s } = setup(true)
    expect(reclaimStatus(s).perDay).toBe(40) // filters on hand → full rate
    s.linen = 0
    expect(reclaimStatus(s).perDay).toBe(20) // no filters → half rate
  })

  it('never overfills, and idles when the tanks are near full', () => {
    const { sim, s } = setup(true)
    s.water = waterTankCap(s) // tanks brim-full
    expect(reclaimStatus(s).perDay).toBe(0) // idles to save filters
    expect(reclaimStatus(s).active).toBe(false)
    for (let i = 0; i < 10; i++) { s.colonists = 20; s.totalJobs = 6; s.water = waterTankCap(s); stepBuild(s, sim.rng, 24 * 60) }
    expect(s.water).toBeLessThanOrEqual(waterTankCap(s)) // never pushed above the tank cap
  })

  it('water-only — it adds water and changes no other stockpile, and never reduces the tanks', () => {
    const without = setup(false)
    const withR = setup(true)
    for (const c of [without, withR]) { c.s.food = 200; c.s.materials = 300; c.s.components = 150 }
    for (const c of [without, withR]) { c.s.colonists = 20; c.s.totalJobs = 6; stepBuild(c.s, c.sim.rng, 24 * 60) } // one day
    expect(withR.s.water).toBeGreaterThan(without.s.water) // the plant earned water...
    expect(withR.s.food).toBe(without.s.food) // ...and touched no food
    expect(withR.s.materials).toBe(without.s.materials) // ...no materials
    expect(withR.s.components).toBe(without.s.components) // ...no components
    expect(withR.s.colonists).toBe(without.s.colonists) // ...and no population
  })
})

describe('Spec 067 — The Highsun Lantern Supper: a year the people look forward to', () => {
  const mk = (kind: 'festboard' | 'calendar', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: kind === 'festboard' ? 1 : 2, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })
  const HIGHSUN_Y1 = 485 // day 485 → year 1, month 5 (Highsun)
  // a calendar-keeping colony sitting in Highsun of year 1, with stores for a supper. Materials is the clean consumption signal — nothing
  // else in this scenario touches it (no mines/workshops/jobs), so the supper's spend shows on it without the daily food-eating confound.
  const setup = (withBoard: boolean) => {
    const sim = new ColonySim(37)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('calendar', lx + 1, ly, { jobs: 2 }))
    if (withBoard) s.buildings.push(mk('festboard', lx, ly, { jobs: 1 }))
    s.clock.day = HIGHSUN_Y1
    s.colonists = 40; s.totalJobs = 6; s.food = 400; s.rimfish = 400; s.linen = 100; s.materials = 200; s.standing = 0.5; s.unrest = 0.5
    s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    return { sim, s }
  }

  it('inert without a Board — the Highsun year passes with no supper', () => {
    const { sim, s } = setup(false)
    const mats0 = s.materials, standing0 = s.standing
    stepBuild(s, sim.rng, 24 * 60)
    expect(festivalStatus(s).board).toBe(false)
    expect(s.materials).toBe(mats0) // no supper → no stores spent
    expect(s.standing).toBe(standing0)
    expect(festivalStatus(s).active).toBe(false)
    expect(s.lastFestivalYear ?? 0).toBe(0)
  })

  it('a well-stocked colony throws a full supper and earns Lantern Cheer', () => {
    const { sim, s } = setup(true)
    expect(festBoardActive(s)).toBe(true)
    const mats0 = s.materials, standing0 = s.standing
    stepBuild(s, sim.rng, 24 * 60)
    const fs = festivalStatus(s)
    expect(fs.active).toBe(true) // the supper was laid
    expect(fs.bonus).toBe(COLONY.build.festFullCheerBonus) // full coverage → the best cheer
    expect(s.materials).toBe(mats0 - 2 * COLONY.build.festMaterialsPerTable) // 40 colonists → 2 tables, materials spent
    expect(s.standing).toBeGreaterThan(standing0) // ...the wider world noticed
    // the cheer lifts confidence: toggling it off (at the same state) lowers confidence
    const confWith = settlerConfidence(s)
    const saved = s.festivalCheer; s.festivalCheer = 0
    const confWithout = settlerConfidence(s); s.festivalCheer = saved
    expect(confWith).toBeGreaterThan(confWithout)
  })

  it('a thin supper helps less, and a failed one is not held at all', () => {
    // partial: 40 colonists (2 tables) but materials for only 1 → coverage 0.5
    const partial = setup(true)
    partial.s.materials = COLONY.build.festMaterialsPerTable // one table's worth
    const stand0 = partial.s.standing
    stepBuild(partial.s, partial.sim.rng, 24 * 60)
    expect(festivalStatus(partial.s).bonus).toBe(COLONY.build.festPartialCheerBonus) // the modest cheer
    expect(partial.s.standing).toBe(stand0) // ...but no standing from a thin supper
    // fail: 60 colonists (3 tables) but materials for only 1 → coverage 0.33, below the line
    const fail = setup(true)
    fail.s.colonists = 60; fail.s.materials = COLONY.build.festMaterialsPerTable
    const mats0 = fail.s.materials
    stepBuild(fail.s, fail.sim.rng, 24 * 60)
    expect(festivalStatus(fail.s).active).toBe(false) // not this year
    expect(fail.s.materials).toBe(mats0) // ...and nothing was spent
  })

  it('the supper fires at most once per colony-year and never spends below zero', () => {
    const { sim, s } = setup(true)
    const mats0 = s.materials
    stepBuild(s, sim.rng, 24 * 60) // the Highsun supper fires
    const afterOne = s.materials
    expect(afterOne).toBeLessThan(mats0) // it was held
    expect(s.lastFestivalYear).toBe(1)
    stepBuild(s, sim.rng, 24 * 60) // same Highsun, same year — must NOT fire again
    expect(s.materials).toBe(afterOne) // no second supper
    expect(s.food).toBeGreaterThanOrEqual(0)
    expect(s.linen ?? 0).toBeGreaterThanOrEqual(0)
    expect(s.materials).toBeGreaterThanOrEqual(0)
  })

  it('the Lantern Cheer decays back to baseline', () => {
    const { sim, s } = setup(true)
    stepBuild(s, sim.rng, 24 * 60) // throw the supper → cheer active
    expect(festivalStatus(s).active).toBe(true)
    for (let i = 0; i < COLONY.build.festFullCheerDays + 2; i++) stepBuild(s, sim.rng, 24 * 60) // run out the 30-day window
    expect(festivalStatus(s).active).toBe(false) // the cheer faded
    expect(s.festivalCheer ?? 0).toBe(0)
  })
})

describe('Spec 068 — The Fungus Cellar: a third food the dark decks can grow', () => {
  const mk = (kind: 'cellar' | 'rationvar', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: kind === 'cellar' ? 3 : 2, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('inert without a Cellar — no duskcap appears', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    s.colonists = 20; s.totalJobs = 6; s.food = 200; s.rimfish = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    for (let i = 0; i < 10; i++) { s.colonists = 20; s.totalJobs = 6; s.food = 200; stepBuild(s, sim.rng, 24 * 60) }
    expect(duskcapStatus(s).cellars).toBe(0)
    expect(s.duskcap ?? 0).toBe(0) // no Cellar → no third food
  })

  it('a staffed, watered Cellar grows duskcap, even in a brownout', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('cellar', lx, ly, { jobs: 3, duskcapGen: COLONY.build.duskcapPerDay }))
    s.colonists = 20; s.totalJobs = 6; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    // keep the colony fed on rimfish so the homes don't eat the duskcap — isolating the cellar's growth
    for (let i = 0; i < 5; i++) { s.colonists = 20; s.totalJobs = 6; s.water = 100; s.rimfish = 100; stepBuild(s, sim.rng, 24 * 60) }
    const grown = s.duskcap ?? 0
    expect(grown).toBeGreaterThan(0) // the dark decks earned their keep
    expect(grown).toBeLessThanOrEqual(storageCaps(s).duskcap) // ...bounded by the store
    // force a brownout — the low-draw cellar keeps growing where the greenhouses would falter
    s.power.loadW = 100000; s.power.batteryWh = 0; s.power.solarW = 1; s.powerGen = 0
    expect(inBrownout(s)).toBe(true)
    const before = s.duskcap ?? 0
    for (let i = 0; i < 3; i++) { s.colonists = 20; s.totalJobs = 6; s.water = 100; s.rimfish = 100; stepBuild(s, sim.rng, 24 * 60) }
    expect(s.duskcap ?? 0).toBeGreaterThan(before) // still growing in the dark week
  })

  it('duskcap spares the other foods — the homes eat it for the protein course', () => {
    const make = (dusk: number) => {
      const sim = new ColonySim(41)
      const s = sim.state
      s.colonists = 20; s.totalJobs = 6; s.food = 120; s.rimfish = 0; s.driedFish = 0; s.duskcap = dusk; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh // food below the 160 cap so no clamp confound
      stepBuild(s, sim.rng, 24 * 60) // one day's meals (no fish on hand)
      return s
    }
    const withDusk = make(100), withoutDusk = make(0)
    expect(withDusk.food).toBeGreaterThan(withoutDusk.food) // duskcap took the protein course, so skygrain lasted longer
    expect(withDusk.duskcap ?? 0).toBeLessThan(100) // ...and the cellar's harvest was eaten
  })

  it('keeps the diet varied — greens + duskcap with no fish still reads a Varied Diet', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('rationvar', lx, ly, { jobs: 2 }))
    s.colonists = 40; s.totalJobs = 8; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    for (let i = 0; i < 40; i++) { s.colonists = 40; s.totalJobs = 8; s.food = 500; s.rimfish = 0; s.driedFish = 0; s.duskcap = 500; stepBuild(s, sim.rng, 24 * 60) }
    expect(dietVarietyStatus(s).varied).toBe(true) // greens + duskcap is a varied table even with the nets idle
  })

  it('duskcap is capped and never goes negative', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('cellar', lx, ly, { jobs: 3, duskcapGen: COLONY.build.duskcapPerDay }))
    s.colonists = 20; s.totalJobs = 6; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    const cap = storageCaps(s).duskcap
    for (let i = 0; i < 200; i++) { s.colonists = 20; s.totalJobs = 6; s.water = 100; stepBuild(s, sim.rng, 24 * 60) } // overproduce
    expect(s.duskcap ?? 0).toBeLessThanOrEqual(cap) // clamped to the store
    // now eat it down with no fish and an empty larder
    for (let i = 0; i < 200; i++) { s.colonists = 20; s.totalJobs = 6; s.rimfish = 0; s.food = 0; s.water = 0; stepBuild(s, sim.rng, 24 * 60) }
    expect(s.duskcap ?? 0).toBeGreaterThanOrEqual(0) // never negative
  })
})

describe('Spec 069 — The Steam Bathhouse: hygiene the colony can wash in', () => {
  const mk = (kind: 'bathhouse' | 'habitat' | 'mine' | 'clinic', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('inert without a Bathhouse — hygiene stays 0 and the fever math is unchanged', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    s.colonists = 20; s.totalJobs = 6; s.water = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    expect(bathhouseStatus(s).baths).toBe(0)
    expect(hygieneLevel(s)).toBe(0) // no Bathhouse → no hygiene
    for (let i = 0; i < 10; i++) { s.colonists = 20; s.totalJobs = 6; stepBuild(s, sim.rng, 60) }
    expect(s.hygiene ?? 0).toBe(0) // stays 0 with no Bathhouse
  })

  it('a staffed, watered Bathhouse raises the colony hygiene', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('bathhouse', lx, ly, { jobs: COLONY.build.bathWorkers }))
    s.colonists = 20; s.totalJobs = COLONY.build.bathWorkers; s.water = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    // coverage min(1, 50/20)=1, staffing min(1,20/3)=1, watered 1, power 1 → full hygiene
    expect(hygieneLevel(s)).toBeGreaterThan(0)
    expect(hygieneLevel(s)).toBeCloseTo(1, 5)
    stepBuild(s, sim.rng, 60)
    expect(s.hygiene ?? 0).toBeGreaterThan(0) // the mirror tracks it for the HUD
    expect(bathhouseStatus(s).baths).toBe(1)
  })

  it('a clean colony slows how fast the fever takes hold', () => {
    const run = (withBath: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const L = s.terrain.landing
      s.buildings.push(mk('habitat', L.x + 2, L.y, { residents: 3 }))
      s.buildings.push(mk('habitat', L.x + 3, L.y, { residents: 3 }))
      s.buildings.push(mk('mine', L.x + 2, L.y + 1, { jobs: 6, materialsGen: 5 })) // smog over the homes, no scrubber, no clinic
      let jobs = 6
      if (withBath) { s.buildings.push(mk('bathhouse', L.x + 4, L.y, { jobs: COLONY.build.bathWorkers })); jobs += COLONY.build.bathWorkers }
      // 20 colonists fully staff EITHER layout, so the mine smog (and thus the fever pressure) is identical — only hygiene differs
      s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh // no brownout
      for (let i = 0; i < 400; i++) { s.colonists = 20; s.totalJobs = jobs; s.water = 200; stepBuild(s, sim.rng, 10) }
      return s.outbreak ?? 0
    }
    const plain = run(false)
    const washed = run(true)
    expect(plain).toBeGreaterThan(0.1) // the fever takes hold in a crowded, smoggy, unwashed colony (spec 026)
    expect(washed).toBeLessThan(plain) // ...and a Bathhouse slows how fast it builds
  })

  it('water gates the baths — an empty tank washes worse, and the baths draw on the tanks', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('bathhouse', lx, ly, { jobs: COLONY.build.bathWorkers }))
    s.colonists = 20; s.totalJobs = COLONY.build.bathWorkers; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    s.water = 100
    const wet = hygieneLevel(s)
    s.water = 0
    const dry = hygieneLevel(s)
    expect(dry).toBeLessThan(wet) // a dry bathhouse washes worse
    expect(dry).toBeCloseTo(wet * COLONY.build.bathDryFloor, 5) // ...down to the dry-floor fraction
    // the baths draw water each day — a real customer for the cisterns + reclaimer
    s.water = 100
    bathStep(s, 24 * 60)
    expect(s.water).toBeLessThan(100)
    expect(s.water).toBeCloseTo(100 - COLONY.build.bathWaterPerDay, 5) // one bath, one day
  })

  it('hygiene is clamped to [0,1] and the fever it damps never goes negative', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let i = 0; i < 5; i++) s.buildings.push(mk('bathhouse', lx + i, ly, { jobs: COLONY.build.bathWorkers })) // five baths cover 250 >> 20 colonists
    s.colonists = 20; s.totalJobs = 5 * COLONY.build.bathWorkers; s.water = 1000; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    expect(hygieneLevel(s)).toBeLessThanOrEqual(1) // never above 1 however many baths
    expect(hygieneLevel(s)).toBeCloseTo(1, 5) // ...and reaches the ceiling
    s.outbreak = 0
    for (let i = 0; i < 50; i++) { s.colonists = 20; s.totalJobs = 5 * COLONY.build.bathWorkers; s.water = 1000; stepBuild(s, sim.rng, 60) }
    expect(s.outbreak ?? 0).toBeGreaterThanOrEqual(0) // the damped spread never drives it below zero
  })
})

describe('Spec 070 — The Clean-Home Standing: a washed colony draws settlers and lifts its homes', () => {
  const mk = (kind: 'bathhouse' | 'habitat', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('inert without a Bathhouse — both factors are exactly 1 and the standing is nil', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    s.colonists = 20; s.totalJobs = 6; s.water = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    expect(bathhouseStatus(s).baths).toBe(0)
    expect(hygieneDesirabilityFactor(s)).toBe(1) // no Bathhouse → no draw lift
    expect(hygieneEvolutionFactor(s)).toBe(1) // ...and no climb speed-up
    expect(bathhouseStatus(s).drawBonus).toBe(0)
    expect(bathhouseStatus(s).climbBonus).toBe(0)
  })

  it('a clean colony lifts the settler draw and speeds the housing climb', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('bathhouse', lx, ly, { jobs: COLONY.build.bathWorkers }))
    s.colonists = 20; s.totalJobs = COLONY.build.bathWorkers; s.water = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    expect(hygieneLevel(s)).toBeCloseTo(1, 5) // full hygiene
    expect(hygieneDesirabilityFactor(s)).toBeGreaterThan(1) // draws better
    expect(hygieneEvolutionFactor(s)).toBeLessThan(1) // shorter upgrade interval → climbs sooner
    const st = bathhouseStatus(s)
    expect(st.drawBonus).toBeGreaterThan(0)
    expect(st.climbBonus).toBeGreaterThan(0)
  })

  it('the clean-home draw pulls more settlers in a day than a grimy colony', () => {
    const draw = (withBath: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const L = s.terrain.landing
      for (let h = 0; h < 20; h++) { const b = mk('habitat', L.x + (h % 10), L.y + Math.floor(h / 10), { residents: 4 }); b.tier = 1; s.buildings.push(b) } // plenty of vacant housing in both
      if (withBath) s.buildings.push(mk('bathhouse', L.x, L.y + 4, { jobs: COLONY.build.bathWorkers }))
      s.colonists = 10; s.totalJobs = withBath ? COLONY.build.bathWorkers : 0
      s.food = 500; s.water = 100; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh; s.power.solarW = 50
      immigration(s, 24 * 60) // one day of arrivals
      return s.colonists
    }
    const clean = draw(true), grimy = draw(false)
    expect(clean).toBeGreaterThan(10) // settlers did arrive
    expect(clean).toBeGreaterThan(grimy) // ...and the clean colony drew more of them
  })

  it('the standing fades when hygiene lapses — dry tanks shrink it, no baths zero it', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    s.buildings.push(mk('bathhouse', lx, ly, { jobs: COLONY.build.bathWorkers }))
    s.colonists = 20; s.totalJobs = COLONY.build.bathWorkers; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    s.water = 100
    const wetDraw = hygieneDesirabilityFactor(s)
    s.water = 0
    const dryDraw = hygieneDesirabilityFactor(s)
    expect(dryDraw).toBeLessThan(wetDraw) // empty tanks shrink the standing
    expect(dryDraw).toBeGreaterThanOrEqual(1) // ...but never below the no-effect floor
    // pull the baths entirely — the standing goes to nothing
    s.buildings = s.buildings.filter((b) => b.artifact.kind !== 'bathhouse')
    expect(hygieneDesirabilityFactor(s)).toBe(1)
    expect(hygieneEvolutionFactor(s)).toBe(1)
  })

  it('both factors are bounded by their small ceilings however high hygiene climbs', () => {
    const sim = new ColonySim(41)
    const s = sim.state
    const lx = s.terrain.landing.x, ly = s.terrain.landing.y
    for (let i = 0; i < 5; i++) s.buildings.push(mk('bathhouse', lx + i, ly, { jobs: COLONY.build.bathWorkers })) // five baths cover 250 >> 20
    s.colonists = 20; s.totalJobs = 5 * COLONY.build.bathWorkers; s.water = 1000; s.powerGen = 100; s.power.batteryWh = s.power.batteryCapWh
    expect(hygieneLevel(s)).toBeCloseTo(1, 5)
    expect(hygieneDesirabilityFactor(s)).toBeCloseTo(1 + COLONY.build.hygieneDesirabilityGain, 5) // exactly the ceiling, not beyond
    expect(hygieneEvolutionFactor(s)).toBeCloseTo(1 - COLONY.build.hygieneEvolutionGain, 5)
  })
})

describe('Spec 071 — The Folio Library: the colony keeps some of its own books', () => {
  const mk = (kind: 'habitat' | 'library' | 'theatre', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  it('inert without a Library — culture is the theatres exactly as before', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
    s.buildings.push(mk('theatre', L.x, L.y, { jobs: 2 }))
    s.colonists = 20; s.totalJobs = 2; s.folios = 50
    expect(libraryStatus(s).libraries).toBe(0)
    expect(libraryActive(s)).toBe(false)
    expect(cultureFraction(s)).toBe(1) // the theatre cultures the home, just as before
    s.reels = 0
    expect(cultureFuelFactor(s)).toBe(COLONY.build.cultureStarvedFactor) // theatre with no reels and no library → dampened, unchanged
    s.reels = 5
    expect(cultureFuelFactor(s)).toBe(1) // theatre with reels → fuelled
  })

  it('a staffed, folio-stocked Library cultures the homes (a culture source on its own)', () => {
    const cultured = (kind: 'none' | 'library' | 'theatre') => {
      const sim = new ColonySim(7)
      const s = sim.state
      const L = s.terrain.landing
      s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
      if (kind === 'library') s.buildings.push(mk('library', L.x, L.y, { jobs: COLONY.build.libraryWorkers }))
      if (kind === 'theatre') s.buildings.push(mk('theatre', L.x, L.y, { jobs: 2 }))
      s.colonists = 20; s.totalJobs = COLONY.build.libraryWorkers; s.folios = 10; s.reels = 10
      return cultureFraction(s)
    }
    expect(cultured('none')).toBe(0) // no culture source → no culture
    expect(cultured('library')).toBeGreaterThan(0) // a stocked, staffed library cultures the home
    expect(cultured('library')).toBe(1) // ...fully, the home is in reach
    expect(cultured('theatre')).toBe(1) // sanity: the theatre path still works
  })

  it('the domestic demand is real — a Library draws folios to lend, and bare shelves lend nothing', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
    s.buildings.push(mk('library', L.x, L.y, { jobs: COLONY.build.libraryWorkers }))
    s.colonists = 20; s.totalJobs = COLONY.build.libraryWorkers; s.folios = 3
    expect(libraryActive(s)).toBe(true) // staffed + folios in stock
    libraryStep(s, 24 * 60) // one day's lending
    expect(s.folios).toBeCloseTo(3 - COLONY.build.libraryFoliosPerDay, 5) // drew a folio from the stores
    // ship the rest out — the shelves go bare
    s.folios = 0
    expect(libraryActive(s)).toBe(false) // no folios → nothing to lend
    expect(cultureFraction(s)).toBe(0) // the home loses its library culture when the shelves are bare
    for (let i = 0; i < 10; i++) libraryStep(s, 24 * 60)
    expect(s.folios ?? 0).toBeGreaterThanOrEqual(0) // folios never go negative
  })

  it('reel-free resilience — a stocked Library keeps culture when the theatres go dark', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
    s.buildings.push(mk('library', L.x, L.y, { jobs: COLONY.build.libraryWorkers }))
    s.buildings.push(mk('theatre', L.x + 1, L.y, { jobs: 2 }))
    s.colonists = 20; s.totalJobs = COLONY.build.libraryWorkers + 2; s.reels = 0; s.folios = 10 // theatres dark (no reels), shelves stocked
    expect(cultureFuelFactor(s)).toBe(1) // the stocked Library carries the culture fuel
    expect(homeCultured(s, s.buildings[0])).toBe(true) // the home stays cultured
    // pull the Library — now only dark theatres remain
    s.buildings = s.buildings.filter((b) => b.artifact.kind !== 'library')
    expect(cultureFuelFactor(s)).toBe(COLONY.build.cultureStarvedFactor) // theatres dark, no library → dampened
  })

  it('a Library with no folio supply drains to bare over time, then lends nothing (no error)', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
    s.buildings.push(mk('library', L.x, L.y, { jobs: COLONY.build.libraryWorkers }))
    s.colonists = 20; s.totalJobs = COLONY.build.libraryWorkers; s.folios = 5
    for (let i = 0; i < 30; i++) { s.colonists = 20; s.totalJobs = COLONY.build.libraryWorkers; stepBuild(s, sim.rng, 24 * 60) } // a month, no Folio House to refill
    expect(s.folios ?? 0).toBeGreaterThanOrEqual(0) // never negative
    expect(libraryActive(s)).toBe(false) // drained to bare → the shelves go quiet
  })
})

describe('Spec 072 — The Skydeck Gallery: the colony renown becomes coin', () => {
  const mk = (kind: 'habitat' | 'water' | 'depot' | 'clinic' | 'theatre' | 'gallery', x: number, y: number, extra: Record<string, number> = {}): ColonyBuilding => ({
    id: x * 1000 + y,
    x,
    y,
    artifact: Object.assign({ id: 1, kind, color: 0, height: 1, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: 1, cost: 0, materialsCost: 0, crew: 0, materialsGen: 0 }, extra),
  })

  // a liveable colony: one home with water + depot + clinic + theatre in reach (so colonyLiveability > 0), food on hand
  const services = (buildings: ColonyBuilding[], lx: number, ly: number) => {
    buildings.push(mk('water', lx, ly, { jobs: 1 }))
    buildings.push(mk('depot', lx, ly, { jobs: 1 }))
    buildings.push(mk('clinic', lx, ly, { jobs: 2 }))
    buildings.push(mk('theatre', lx, ly, { jobs: 2 }))
  }

  it('inert without a Gallery — no visitor coin, treasury untouched', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
    services(s.buildings, L.x, L.y)
    s.colonists = 20; s.totalJobs = 6; s.food = 200; s.treasury = 1000
    expect(galleryStatus(s)).toEqual({ galleries: 0, open: false, coinPerDay: 0 })
    const t0 = s.treasury
    galleryStep(s, 24 * 60)
    expect(s.treasury).toBe(t0) // no Gallery → no visitor coin
  })

  it('a staffed Gallery in a liveable colony earns visitor coin', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
    services(s.buildings, L.x, L.y)
    s.buildings.push(mk('gallery', L.x + 1, L.y, { jobs: COLONY.build.galleryWorkers }))
    s.colonists = 20; s.totalJobs = 6 + COLONY.build.galleryWorkers; s.food = 200; s.treasury = 1000
    expect(colonyLiveability(s)).toBeGreaterThan(0) // serviced homes give the colony some appeal
    expect(galleryStatus(s).open).toBe(true)
    expect(galleryStatus(s).coinPerDay).toBeGreaterThan(0)
    const t0 = s.treasury
    galleryStep(s, 24 * 60)
    expect(s.treasury).toBeGreaterThan(t0) // a day of visitor coin
  })

  it('the take scales with appeal — a liveable colony out-earns a drab one', () => {
    const earn = (serviced: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const L = s.terrain.landing
      s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
      if (serviced) services(s.buildings, L.x, L.y)
      s.buildings.push(mk('gallery', L.x + 1, L.y, { jobs: COLONY.build.galleryWorkers }))
      s.colonists = 20; s.totalJobs = COLONY.build.galleryWorkers + (serviced ? 6 : 0); s.food = 200; s.treasury = 1000
      const t0 = s.treasury
      galleryStep(s, 24 * 60)
      return s.treasury - t0
    }
    expect(earn(true)).toBeGreaterThan(earn(false)) // a beautiful colony draws more visitors
  })

  it('a finished Horizon Spire lifts the take', () => {
    const earn = (spireDone: boolean) => {
      const sim = new ColonySim(7)
      const s = sim.state
      const L = s.terrain.landing
      s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
      services(s.buildings, L.x, L.y)
      s.buildings.push(mk('gallery', L.x + 1, L.y, { jobs: COLONY.build.galleryWorkers }))
      s.colonists = 20; s.totalJobs = 6 + COLONY.build.galleryWorkers; s.food = 200; s.treasury = 1000
      if (spireDone) s.spireStage = COLONY.build.spireStageCount
      const t0 = s.treasury
      galleryStep(s, 24 * 60)
      return s.treasury - t0
    }
    expect(earn(true)).toBeGreaterThan(earn(false)) // the monument is a marquee draw
  })

  it('an unstaffed Gallery earns nothing, and the appeal is bounded', () => {
    const sim = new ColonySim(7)
    const s = sim.state
    const L = s.terrain.landing
    s.buildings.push(mk('habitat', L.x, L.y, { residents: 4 }))
    services(s.buildings, L.x, L.y)
    s.buildings.push(mk('gallery', L.x + 1, L.y, { jobs: COLONY.build.galleryWorkers }))
    s.totalJobs = 6 + COLONY.build.galleryWorkers; s.food = 200; s.treasury = 1000
    s.colonists = 0 // nobody to guide → no fares
    const t0 = s.treasury
    galleryStep(s, 24 * 60)
    expect(s.treasury).toBe(t0) // unstaffed → no coin
    // however renowned, the appeal never runs past the ceiling
    s.colonists = 20; s.spireStage = COLONY.build.spireStageCount
    expect(galleryAppeal(s)).toBeLessThanOrEqual(COLONY.build.galleryAppealCeiling)
    expect(galleryAppeal(s)).toBeGreaterThanOrEqual(0)
  })
})
