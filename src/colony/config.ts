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
    stepsPerSec: 15,
    simMinPerStep: 3,
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
    growIntervalHours: 3, // colony starts a new build this often
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
    block: 5, // grid block size — roads run on the block boundaries (no parallel roads)
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
