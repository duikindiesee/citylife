// World generation + shared queries/helpers over SimState.
import { CONFIG } from "./config";
import { RNG } from "./rng";
import {
  ZONE_CODE,
  COMMODITIES,
  type Building,
  type Business,
  type BusinessKind,
  type Citizen,
  type Commodity,
  type MarketState,
  type SimState,
  type ZoneType,
} from "./types";

const RESOURCE_KINDS: BusinessKind[] = ["mine", "sawmill", "farm", "oil_rig"];

// Low-rise on purpose: a town of houses and shops, not a bar chart of towers.
// These are the "back wall" heights of the open dollhouses the renderer draws.
function buildingHeight(zone: ZoneType, level: number, rng: RNG): number {
  if (zone === "park") return 0.3;
  if (zone === "industrial") return rng.range(0.9, 1.6);
  if (zone === "commercial") {
    if (level === 3) return rng.range(1.9, 2.6);
    if (level === 2) return rng.range(1.5, 2.0);
    return rng.range(1.1, 1.5);
  }
  // residential — houses
  if (level === 3) return rng.range(1.3, 1.7);
  if (level === 2) return rng.range(1.0, 1.3);
  return rng.range(0.7, 1.0);
}

function emptyMarket(): MarketState {
  const m = {} as MarketState;
  for (const c of COMMODITIES) {
    m[c] = { price: CONFIG.market.basePrice[c]!, supply: 0, demand: 0 };
  }
  return m;
}

/** Build the starting city deterministically. */
export function generateWorld(rng: RNG): SimState {
  const { width, height } = CONFIG.grid;
  const zones = new Uint8Array(width * height);
  const buildings: Building[] = [];
  const businesses: Business[] = [];
  const citizens: Citizen[] = [];

  const roadEvery = 6;
  let buildingId = 0;
  let businessId = 0;

  // 1) Zone the grid.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const onRoad = x % roadEvery === 0 || y % roadEvery === 0;
      if (onRoad) {
        zones[idx] = ZONE_CODE.road;
        continue;
      }
      // region by x: industrial left, commercial center band, residential elsewhere
      const fx = x / width;
      let zone: ZoneType;
      if (fx < 0.28) zone = "industrial";
      else if (fx > 0.42 && fx < 0.58) zone = "commercial";
      else zone = "residential";
      // scatter parks in residential
      if (zone === "residential" && rng.chance(0.07)) zone = "park";
      zones[idx] = ZONE_CODE[zone];
    }
  }

  const codeToZone: ZoneType[] = [
    "empty",
    "residential",
    "commercial",
    "industrial",
    "park",
    "road",
  ];

  // 2) Place buildings on a subset of zoned lots.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const zone = codeToZone[zones[idx]!]!;
      if (zone === "road" || zone === "empty") continue;
      if (zone === "park") {
        // sparse park props
        if (!rng.chance(0.5)) continue;
      } else if (!rng.chance(0.62)) {
        // leave gaps so houses read as separate plots with greenery between
        continue;
      }
      const level = (zone === "park" ? 1 : rng.pick([1, 1, 1, 2, 2, 3])) as
        | 1
        | 2
        | 3;
      const b: Building = {
        id: buildingId++,
        x,
        y,
        zone,
        level,
        height: buildingHeight(zone, level, rng),
        capacityResidents:
          zone === "residential" ? level * 4 + rng.int(0, 3) : 0,
        capacityJobs: 0,
        residents: [],
      };

      if (zone === "industrial") {
        // mostly resource extractors, a few factories
        const kind: BusinessKind = rng.chance(0.3)
          ? "factory"
          : rng.pick(RESOURCE_KINDS);
        b.kind = kind;
        b.capacityJobs = (kind === "factory" ? 6 : 4) + level;
        const biz: Business = {
          id: businessId++,
          buildingId: b.id,
          kind,
          cash: CONFIG.business.startingCash,
          inventory: blankInventory(),
          employeeIds: [],
          maxEmployees: b.capacityJobs,
          wageOffer: rng.range(CONFIG.wages.min, CONFIG.wages.max),
          pnl: { revenue: 0, cogs: 0, wages: 0, profit: 0 },
          producedThisStep: 0,
        };
        b.businessId = biz.id;
        businesses.push(biz);
      } else if (zone === "commercial") {
        b.kind = "shop";
        b.capacityJobs = 2 + level * 2;
        const biz: Business = {
          id: businessId++,
          buildingId: b.id,
          kind: "shop",
          cash: CONFIG.business.startingCash,
          inventory: blankInventory(),
          employeeIds: [],
          maxEmployees: b.capacityJobs,
          wageOffer: rng.range(CONFIG.wages.min, CONFIG.wages.max),
          pnl: { revenue: 0, cogs: 0, wages: 0, profit: 0 },
          producedThisStep: 0,
        };
        b.businessId = biz.id;
        businesses.push(biz);
      }

      buildings.push(b);
    }
  }

  // Ensure at least one factory exists (so goods get produced).
  if (!businesses.some((b) => b.kind === "factory")) {
    const ind = buildings.find(
      (b) => b.zone === "industrial" && b.businessId !== undefined,
    );
    if (ind) {
      const biz = businesses.find((b) => b.id === ind.businessId)!;
      biz.kind = "factory";
      ind.kind = "factory";
    }
  }

  const state: SimState = {
    width,
    height,
    clock: {
      totalMinutes: CONFIG.time.wakeHour * 60,
      day: 0,
      dayOfWeek: 0,
      hour: CONFIG.time.wakeHour,
      minute: 0,
      isDay: true,
    },
    tick: 0,
    zones,
    buildings,
    citizens,
    businesses,
    vehicles: [],
    market: emptyMarket(),
    taxRates: { ...CONFIG.economy.taxRates },
    budget: { ...CONFIG.economy.budget },
    treasury: CONFIG.economy.startingTreasury,
    metrics: {
      population: 0,
      treasury: CONFIG.economy.startingTreasury,
      happiness: CONFIG.happiness.base,
      gdp: 0,
      employed: 0,
      unemployed: 0,
      employmentRate: 0,
    },
    gdpAccumulator: 0,
    pollution: 0,
    log: [],
  };

  // 3) Spawn initial citizens with homes + jobs.
  for (let i = 0; i < CONFIG.population.initial; i++) {
    spawnCitizen(state, rng);
  }

  recomputePollution(state);
  return state;
}

export function blankInventory(): Record<Commodity, number> {
  return { ore: 0, lumber: 0, crops: 0, oil: 0, goods: 0 };
}

export function buildingById(
  state: SimState,
  id: number,
): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function businessById(
  state: SimState,
  id: number,
): Business | undefined {
  return state.businesses.find((b) => b.id === id);
}

export function citizenById(state: SimState, id: number): Citizen | undefined {
  return state.citizens.find((c) => c.id === id);
}

/** A residential building with free capacity, or undefined. */
export function findFreeHome(state: SimState): Building | undefined {
  return state.buildings.find(
    (b) => b.zone === "residential" && b.residents.length < b.capacityResidents,
  );
}

export function housingFree(state: SimState): number {
  let n = 0;
  for (const b of state.buildings)
    if (b.zone === "residential") n += b.capacityResidents - b.residents.length;
  return n;
}

export function jobsFree(state: SimState): number {
  let n = 0;
  for (const b of state.businesses) n += b.maxEmployees - b.employeeIds.length;
  return n;
}

/** Find a business with a free slot and employ the citizen. Returns true on success. */
export function assignJob(state: SimState, citizen: Citizen): boolean {
  const biz = state.businesses.find(
    (b) => b.employeeIds.length < b.maxEmployees,
  );
  if (!biz) return false;
  biz.employeeIds.push(citizen.id);
  citizen.workId = biz.id;
  citizen.wagePerHour = biz.wageOffer;
  citizen.daysUnemployed = 0;
  return true;
}

export function leaveJob(state: SimState, citizen: Citizen): void {
  if (citizen.workId == null) return;
  const biz = businessById(state, citizen.workId);
  if (biz) biz.employeeIds = biz.employeeIds.filter((id) => id !== citizen.id);
  citizen.workId = null;
}

let nextCitizenId = 0;

/** Create one citizen, give them a home and (if possible) a job. Returns the citizen or null if no housing. */
export function spawnCitizen(state: SimState, rng: RNG): Citizen | null {
  const home = findFreeHome(state);
  if (!home) return null;
  const c: Citizen = {
    id: nextCitizenId++,
    homeId: home.id,
    workId: null,
    wallet: rng.range(200, 1200),
    wagePerHour: 0,
    hoursWorkedThisWeek: 0,
    energy: rng.range(60, 100),
    hunger: rng.range(0, 40),
    fun: rng.range(40, 90),
    state: "sleeping",
    x: home.x + 0.5,
    y: home.y + 0.5,
    path: [],
    happiness: CONFIG.happiness.base,
    daysUnemployed: 0,
  };
  home.residents.push(c.id);
  state.citizens.push(c);
  assignJob(state, c);
  return c;
}

export function removeCitizen(state: SimState, citizen: Citizen): void {
  leaveJob(state, citizen);
  const home = buildingById(state, citizen.homeId);
  if (home) home.residents = home.residents.filter((id) => id !== citizen.id);
  state.citizens = state.citizens.filter((c) => c.id !== citizen.id);
}

/** Pollution as a 0..100 share of developed land that is industrial, eased by parks.
 *  (A normalized ratio, so it doesn't scale absurdly with city size.) */
export function recomputePollution(state: SimState): void {
  let ind = 0;
  let res = 0;
  let com = 0;
  let park = 0;
  for (const b of state.buildings) {
    if (b.zone === "industrial") ind += b.kind === "factory" ? 1.5 : 1;
    else if (b.zone === "residential") res++;
    else if (b.zone === "commercial") com++;
    else if (b.zone === "park") park++;
  }
  const developed = ind + res + com + park;
  const share = developed > 0 ? (ind / developed) * 100 : 0;
  state.pollution = Math.max(0, Math.min(100, share - park * 0.8));
}
