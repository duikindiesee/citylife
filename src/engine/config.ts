// All tunable constants live here. No magic numbers in logic (see AGENTS.md).
// Balance the city by editing this file alone.

export const CONFIG = {
  grid: {
    width: 40,
    height: 40,
  },

  time: {
    // 15 steps/sec * 3 sim-min/step = 45 sim-min per real second at 1x speed.
    // => ~32 real seconds per sim-day — calm enough to watch people walk home.
    stepsPerSec: 15,
    simMinPerStep: 3,
    dayStartHour: 6, // daylight window for rendering / "isDay"
    dayEndHour: 20,
    workStartHour: 8,
    workEndHour: 17,
    sleepHour: 22,
    wakeHour: 6,
  },

  population: {
    initial: 40,
    max: 600,
    // Migration is evaluated once per sim-day.
    immigrationPerDayMax: 12,
    emigrationPerDayMax: 10,
    // A citizen needs at least this happiness to stay happily; below -> may leave.
    leaveHappinessThreshold: 28,
    joinHappinessThreshold: 45,
  },

  economy: {
    startingTreasury: 50_000,
    taxRates: { residential: 0.09, commercial: 0.09, industrial: 0.11 },
    budget: { transport: 800, safety: 800, health: 600, environment: 400 },
    // weekly per-resident property tax base (scaled by residential tax rate)
    residentialTaxBasePerResident: 60,
    roadMaintenancePerTile: 1.2,
    serviceUpkeepMultiplier: 1,
    bondInterestAnnual: 0.06,
  },

  wages: {
    min: 14,
    max: 30,
    hoursPerWorkday: 8,
  },

  spending: {
    // Daily consumption a citizen tries to spend at shops (if they have money + hunger/fun needs).
    dailyConsumptionMin: 35,
    dailyConsumptionMax: 75,
  },

  needs: {
    // per sim-hour decay
    energyDecayAwake: 4.5,
    energyRecoverAsleep: 12,
    hungerGain: 5,
    funDecay: 3,
  },

  business: {
    // Production per employee per work-step, by resource business.
    outputPerEmployee: {
      mine: 0.9, // ore
      sawmill: 0.9, // lumber
      farm: 1.1, // crops
      oil_rig: 0.7, // oil
      factory: 0.0, // factory transforms inputs -> goods (handled separately)
      shop: 0.0,
    } as Record<string, number>,
    factoryGoodsPerEmployee: 0.6,
    factoryInputPerGoods: {
      ore: 0.4,
      lumber: 0.4,
      crops: 0.2,
      oil: 0.3,
    } as Record<string, number>,
    shopMarkup: 1.35,
    startingCash: 8_000,
  },

  market: {
    basePrice: { ore: 14, lumber: 11, crops: 8, oil: 22, goods: 40 } as Record<
      string,
      number
    >,
    // price elasticity: how fast price chases demand/supply imbalance
    elasticity: 0.18,
    minPriceFactor: 0.45,
    maxPriceFactor: 2.4,
    smoothing: 0.25,
  },

  happiness: {
    base: 50,
    employmentBonus: 22, // applied * employmentRate
    taxPenalty: 120, // applied * avgTaxRate
    pollutionPenalty: 0.4, // per pollution point
    parkBonus: 9,
    serviceBonus: 14, // applied * serviceCoverage(0..1)
    unemploymentPersonalPenalty: 26,
    brokePenalty: 18, // if wallet near zero
  },

  governor: {
    // The AI check-in routine fires on this interval. CONFIGURABLE at runtime.
    defaultIntervalMs: 10 * 60 * 1000, // 10 minutes
    minIntervalMs: 5 * 1000,
    maxActionsPerCheckIn: 4,
    provider: "heuristic" as "heuristic" | "ollama",
    ollama: {
      baseUrl: "http://localhost:11434",
      model: "gemma3:4b",
      timeoutMs: 30_000,
    },
  },

  logistics: {
    cars: 24,
    trucks: 10,
    carSpeed: 22, // lots per sim-hour (slow enough to follow with your eye)
    truckSpeed: 15,
    lightPeriodTicks: 44, // traffic-light half-cycle, in sim steps
    maxRoadSearch: 8,
  },

  render: {
    seed: 1337,
  },
} as const;

export type Config = typeof CONFIG;
