// Colony (v2) tunables. The planet, the seed, the early power loop.
export const COLONY = {
  world: {
    size: 192, // heightfield resolution AND region width in world units (1 cell = 1 unit)
    heightScale: 17, // world-units of relief from sea level to highest peak
    seaLevel: 0.34, // normalised elevation below which is ocean
    planetRadius: 1500, // the "ball" the flat region sits on (apex at y=0)
    coastSearch: 7, // how far a landing site may be from water and still count as coastal
    rivers: 6,
    noise: {
      elevFreq: 2.6,
      elevOctaves: 5,
      mountainFreq: 3.1,
      moistFreq: 1.7,
      moistOctaves: 4,
    },
  },
  time: {
    stepsPerSec: 6, // physics ticks/sec (kept high so motion stays smooth)
    simMinPerStep: 1.5, // sim-minutes per tick — slowed so a sim-day is ~160 real sec at 1x (use 2x/5x)
    dayStartHour: 6,
    dayEndHour: 20,
  },
  power: {
    solarPeakW: 4.5, // peak solar output at noon
    baseLoadW: 1.1, // caravan idle draw
    batteryCapacityWh: 80,
    batteryStartWh: 44,
  },
  seed: {
    colonists: 2,
    name: 'Landing One',
  },
  build: {
    treasuryStart: 24000,
    habitatCost: 1500,
    roadCostPerCell: 35,
    buildTimeHours: 5, // sim-hours to construct one habitat
    growIntervalHours: 8, // colony starts a new build this often (slower, more deliberate growth)
    maxBuildings: 60,
    residentsPerHabitat: 3,
    powerLoadPerHabitat: 0.5,
    growRadius: 22, // cells from the landing the colony will expand into
    solarFarmCost: 2600,
    solarFarmOutput: 9, // kW peak generation
    solarFarmBuildHours: 4,
    powerHeadroom: 0.72, // build a farm when load exceeds this fraction of peak supply
    // workplaces (commercial / industrial) — create jobs
    commercialCost: 1800,
    industrialCost: 2000,
    jobsPerCommercial: 4,
    jobsPerIndustrial: 5,
    commercialLoad: 0.6,
    industrialLoad: 0.9,
    workplaceBuildHours: 5,
    jobDeficitThreshold: 5, // build a workplace when unemployment exceeds this
    // Materials + labour economy (spec 001): construction consumes materials and reserves a crew of
    // free colonists. No build starts without both — so buildings no longer pop up on a bare timer.
    materialsStart: 40, // dropship stockpile; later produced by extraction (quarry/mine)
    matHabitat: 6,
    matCommercial: 8,
    matIndustrial: 10,
    matSolar: 5,
    crewHabitat: 2,
    crewWork: 3,
    crewSolar: 2,
    // Extraction (spec 002): a mine is the cheapest build (so a low-supply colony can still raise it)
    // and produces materials while staffed; output scales with how staffed the colony is.
    matMine: 4,
    crewMine: 2,
    mineCost: 1200,
    mineWorkers: 6, // employment slots; full output needs all filled
    mineOutputPerDay: 5, // materials/day at full staffing
    mineBuildHours: 5,
    materialsLowThreshold: 16, // build a mine when the stockpile drops below this
    // Workshops (spec 003): refine surplus materials into components (2:1) while staffed.
    matWorkshop: 10,
    crewWorkshop: 3,
    workshopCost: 1600,
    workshopWorkers: 5,
    workshopMaterialsIn: 4, // materials/day consumed at full staffing
    workshopComponentsOut: 2, // components/day produced at full staffing (2:1 ratio)
    materialsSurplus: 30, // raise a workshop to refine once the stockpile exceeds this
    block: 7, // grid block size (bumped 5→7) so the base spreads out and the city feels less cramped
    maxBlockRadius: 7, // how many blocks out from the landing the colony can spread
    pollutionPerIndustrial: 3,
  },

  economy: {
    incomePerColonistPerDay: 150,
    buildingUpkeepPerDay: 14,
    roadUpkeepPerDay: 0.4,
    pollutionPenaltyScale: 320, // income is dragged down as pollution rises (capped)
  },

  traffic: {
    maxCars: 22,
    carSpeed: 14, // lots per sim-hour
    laneOffset: 0.22, // how far cars sit to the LEFT of their travel direction
    maxWaitSteps: 50, // failsafe so a jammed car eventually proceeds (no deadlock)
  },

  render: {
    seed: 4242,
  },
} as const
