// Shared data model for the simulation engine. Pure types — no runtime imports.

export type ZoneType =
  | "empty"
  | "residential"
  | "commercial"
  | "industrial"
  | "park"
  | "road";

export const ZONE_CODE: Record<ZoneType, number> = {
  empty: 0,
  residential: 1,
  commercial: 2,
  industrial: 3,
  park: 4,
  road: 5,
};

export type Commodity = "ore" | "lumber" | "crops" | "oil" | "goods";
export const COMMODITIES: Commodity[] = [
  "ore",
  "lumber",
  "crops",
  "oil",
  "goods",
];

export type BusinessKind =
  | "mine"
  | "sawmill"
  | "farm"
  | "oil_rig"
  | "factory"
  | "shop";

export type CitizenState =
  | "sleeping"
  | "commuting_to_work"
  | "working"
  | "shopping"
  | "commuting_home"
  | "leisure"
  | "job_hunting";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Clock {
  totalMinutes: number;
  day: number;
  dayOfWeek: number; // 0=Mon ... 4=Fri ... 6=Sun
  hour: number;
  minute: number;
  isDay: boolean;
}

export interface Building {
  id: number;
  x: number;
  y: number;
  zone: ZoneType;
  kind?: BusinessKind;
  level: 1 | 2 | 3;
  height: number;
  capacityResidents: number;
  capacityJobs: number;
  residents: number[];
  businessId?: number;
}

export interface Citizen {
  id: number;
  homeId: number;
  workId: number | null;
  wallet: number;
  wagePerHour: number;
  hoursWorkedThisWeek: number;
  energy: number;
  hunger: number;
  fun: number;
  state: CitizenState;
  x: number;
  y: number;
  path: Vec2[];
  happiness: number;
  daysUnemployed: number;
}

export interface Business {
  id: number;
  buildingId: number;
  kind: BusinessKind;
  cash: number;
  inventory: Record<Commodity, number>;
  employeeIds: number[];
  maxEmployees: number;
  wageOffer: number;
  pnl: { revenue: number; cogs: number; wages: number; profit: number };
  producedThisStep: number;
}

export type VehicleKind = "car" | "truck";
export type VehiclePhase = "commute" | "to_pickup" | "to_factory" | "to_market";

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  heading: number; // radians, for facing
  wp: Vec2[]; // remaining waypoints (road-tile centres + final door)
  targetBuildingId: number;
  phase: VehiclePhase;
  cargo: number; // 0..1, trucks only (drives the cargo block)
  speed: number;
  color: number;
  waitTimer: number;
}

export interface MarketCommodity {
  price: number;
  supply: number;
  demand: number;
}
export type MarketState = Record<Commodity, MarketCommodity>;

export interface TaxRates {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface BudgetAllocation {
  transport: number;
  safety: number;
  health: number;
  environment: number;
}

export interface Metrics {
  population: number;
  treasury: number;
  happiness: number;
  gdp: number;
  employed: number;
  unemployed: number;
  employmentRate: number;
}

export interface SimState {
  width: number;
  height: number;
  clock: Clock;
  tick: number;
  zones: Uint8Array;
  buildings: Building[];
  citizens: Citizen[];
  businesses: Business[];
  vehicles: Vehicle[];
  market: MarketState;
  taxRates: TaxRates;
  budget: BudgetAllocation;
  treasury: number;
  metrics: Metrics;
  gdpAccumulator: number;
  pollution: number;
  log: string[];
}

// ── Snapshots handed to the renderer / UI ──

export interface BuildingSnapshot {
  id: number;
  x: number;
  y: number;
  zone: ZoneType;
  kind?: BusinessKind;
  level: number;
  height: number;
  residents: number;
  jobs: number;
  jobsFilled: number;
}

export interface CitizenSnapshot {
  id: number;
  x: number;
  y: number;
  state: CitizenState;
  happiness: number;
}

export interface VehicleSnapshot {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  heading: number;
  cargo: number;
  color: number;
}

export interface CitySnapshot {
  tick: number;
  clock: Clock;
  metrics: Metrics;
  taxRates: TaxRates;
  budget: BudgetAllocation;
  market: Record<Commodity, { price: number; supply: number; demand: number }>;
  buildings: BuildingSnapshot[];
  citizens: CitizenSnapshot[];
  vehicles: VehicleSnapshot[];
  recentLog: string[];
}

// ── Digest handed to the AI governor (tiny, curated) ──

export interface MetricsDigest {
  day: number;
  population: number;
  treasury: number;
  happiness: number;
  gdp: number;
  employmentRate: number;
  unemployed: number;
  taxRates: TaxRates;
  budget: BudgetAllocation;
  prices: Record<Commodity, number>;
  topProblems: string[];
}

// ── AI / Game actions ──

export type GameActionName =
  | "setTaxRate"
  | "setBudget"
  | "passOrdinance"
  | "zoneRect"
  | "placeBuilding"
  | "noop";

export interface GameAction {
  action: GameActionName;
  args: unknown[];
  why?: string;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}
