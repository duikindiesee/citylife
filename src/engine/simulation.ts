// The tick orchestrator. Owns SimState + RNG. Pure and timer-free:
// something else (the Runtime) decides *when* to call step().
import { CONFIG } from "./config";
import { RNG } from "./rng";
import { generateWorld, housingFree, jobsFree } from "./world";
import { updateCitizens } from "./agents";
import { produce, settleDaily, settleWeekly, computeMetrics } from "./economy";
import { spawnVehicles, updateVehicles } from "./logistics";
import {
  COMMODITIES,
  type CitySnapshot,
  type Commodity,
  type MetricsDigest,
  type SimState,
} from "./types";

export interface HistoryPoint {
  day: number;
  population: number;
  treasury: number;
  happiness: number;
  gdp: number;
}

function advanceClock(s: SimState, dtMin: number): { dayRolled: boolean } {
  s.clock.totalMinutes += dtMin;
  const prevDay = s.clock.day;
  const totalDays = Math.floor(s.clock.totalMinutes / (24 * 60));
  const minOfDay = s.clock.totalMinutes - totalDays * 24 * 60;
  s.clock.day = totalDays;
  s.clock.dayOfWeek = ((totalDays % 7) + 7) % 7;
  s.clock.hour = Math.floor(minOfDay / 60);
  s.clock.minute = Math.floor(minOfDay % 60);
  s.clock.isDay =
    s.clock.hour >= CONFIG.time.dayStartHour &&
    s.clock.hour < CONFIG.time.dayEndHour;
  return { dayRolled: s.clock.day !== prevDay };
}

export class Simulation {
  state: SimState;
  rng: RNG;
  history: HistoryPoint[] = [];

  constructor(seed: number = CONFIG.render.seed) {
    this.rng = new RNG(seed);
    this.state = generateWorld(this.rng);
    spawnVehicles(this.state, this.rng);
    computeMetrics(this.state);
    this.pushHistory();
  }

  /** Advance the simulation by one fixed step (CONFIG.time.simMinPerStep sim-minutes). */
  step(): void {
    const s = this.state;
    const dt = CONFIG.time.simMinPerStep;

    const { dayRolled } = advanceClock(s, dt);
    updateCitizens(s, this.rng, dt);
    updateVehicles(s, this.rng, dt);
    produce(s, dt);
    computeMetrics(s);

    if (dayRolled) {
      settleDaily(s, this.rng);
      if (s.clock.dayOfWeek === 4) settleWeekly(s); // Friday payday
      computeMetrics(s);
      this.pushHistory();
    }

    s.tick++;
  }

  private pushHistory(): void {
    const m = this.state.metrics;
    this.history.push({
      day: this.state.clock.day,
      population: m.population,
      treasury: Math.round(m.treasury),
      happiness: Math.round(m.happiness),
      gdp: Math.round(m.gdp),
    });
    if (this.history.length > 365) this.history.shift();
  }

  /** Full snapshot for UI/tests. The renderer reads this.state directly instead. */
  getSnapshot(): CitySnapshot {
    const s = this.state;
    const empByBuilding = new Map<number, number>();
    for (const biz of s.businesses)
      empByBuilding.set(biz.buildingId, biz.employeeIds.length);

    const market = {} as Record<
      Commodity,
      { price: number; supply: number; demand: number }
    >;
    for (const c of COMMODITIES) {
      market[c] = {
        price: s.market[c].price,
        supply: s.market[c].supply,
        demand: s.market[c].demand,
      };
    }

    return {
      tick: s.tick,
      clock: { ...s.clock },
      metrics: { ...s.metrics },
      taxRates: { ...s.taxRates },
      budget: { ...s.budget },
      market,
      buildings: s.buildings.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        zone: b.zone,
        kind: b.kind,
        level: b.level,
        height: b.height,
        residents: b.residents.length,
        jobs: b.capacityJobs,
        jobsFilled: empByBuilding.get(b.id) ?? 0,
      })),
      citizens: s.citizens.map((c) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        state: c.state,
        happiness: c.happiness,
      })),
      vehicles: s.vehicles.map((v) => ({
        id: v.id,
        kind: v.kind,
        x: v.x,
        y: v.y,
        heading: v.heading,
        cargo: v.cargo,
        color: v.color,
      })),
      recentLog: s.log.slice(0, 8),
    };
  }

  /** Tiny curated digest for the AI governor. Never the full grid. */
  getDigest(): MetricsDigest {
    const s = this.state;
    const m = s.metrics;
    const problems: string[] = [];
    if (s.treasury < 0)
      problems.push(`treasury in deficit (${Math.round(s.treasury)})`);
    else if (s.treasury < 8000)
      problems.push(`treasury low (${Math.round(s.treasury)})`);
    if (m.employmentRate < 0.6)
      problems.push(
        `high unemployment (${Math.round((1 - m.employmentRate) * 100)}%)`,
      );
    if (m.happiness < 50)
      problems.push(`low happiness (${Math.round(m.happiness)})`);
    if (s.pollution > 30)
      problems.push(`pollution high (${Math.round(s.pollution)})`);
    if (
      housingFree(s) < 4 &&
      m.happiness >= CONFIG.population.joinHappinessThreshold
    )
      problems.push("housing shortage capping growth");
    if (jobsFree(s) > m.unemployed + 6)
      problems.push("many unfilled jobs (need residents)");
    if (problems.length === 0) problems.push("city is stable");

    const prices = {} as Record<Commodity, number>;
    for (const c of COMMODITIES)
      prices[c] = Math.round(s.market[c].price * 10) / 10;

    return {
      day: s.clock.day,
      population: m.population,
      treasury: Math.round(s.treasury),
      happiness: Math.round(m.happiness),
      gdp: Math.round(m.gdp),
      employmentRate: Math.round(m.employmentRate * 100) / 100,
      unemployed: m.unemployed,
      taxRates: { ...s.taxRates },
      budget: { ...s.budget },
      prices,
      topProblems: problems,
    };
  }
}
