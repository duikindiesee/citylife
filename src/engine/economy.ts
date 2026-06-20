// Economy: production, the commodity market, retail, payroll, taxes, GDP, migration.
//
// Money is conserved where it matters for gameplay (citizen wallets, business cash,
// city treasury). The inter-business *commodity market* is an abstract clearinghouse
// used to discover prices and compute GDP — it is intentionally not strictly conserved.
import { CONFIG } from "./config";
import { RNG } from "./rng";
import {
  buildingById,
  citizenById,
  housingFree,
  jobsFree,
  leaveJob,
  removeCitizen,
  spawnCitizen,
} from "./world";
import type { Business, BusinessKind, Commodity, SimState } from "./types";

function commodityOf(kind: BusinessKind): Commodity | null {
  switch (kind) {
    case "mine":
      return "ore";
    case "sawmill":
      return "lumber";
    case "farm":
      return "crops";
    case "oil_rig":
      return "oil";
    default:
      return null;
  }
}

/** Final consumer purchase at a shop. Called by the agent layer. */
export function purchaseFromShop(
  state: SimState,
  shop: Business,
  amount: number,
): void {
  const goods = state.market.goods;
  const retail = goods.price * CONFIG.business.shopMarkup;
  const units = amount / retail;
  const cogs = units * goods.price;
  shop.cash += amount - cogs;
  shop.pnl.revenue += amount;
  shop.pnl.cogs += cogs;
  state.market.goods.demand += units;
  state.gdpAccumulator += amount - cogs;
}

/** One production step. Off work-hours nobody is 'working', so this is a no-op then. */
export function produce(state: SimState, dtMin: number): void {
  const dtHours = dtMin / 60;
  const workingIds = new Set(
    state.citizens.filter((c) => c.state === "working").map((c) => c.id),
  );

  for (const biz of state.businesses) {
    const workers = biz.employeeIds.reduce(
      (n, id) => n + (workingIds.has(id) ? 1 : 0),
      0,
    );
    if (workers <= 0) continue;

    if (biz.kind === "shop") continue; // shops earn via retail, not production

    if (biz.kind === "factory") {
      const goodsQty =
        CONFIG.business.factoryGoodsPerEmployee * workers * dtHours;
      if (goodsQty <= 0) continue;
      let cogs = 0;
      for (const input of Object.keys(
        CONFIG.business.factoryInputPerGoods,
      ) as Commodity[]) {
        const need =
          goodsQty * (CONFIG.business.factoryInputPerGoods[input] ?? 0);
        cogs += need * state.market[input].price;
        state.market[input].demand += need;
      }
      const revenue = goodsQty * state.market.goods.price;
      biz.cash += revenue - cogs;
      biz.pnl.revenue += revenue;
      biz.pnl.cogs += cogs;
      state.market.goods.supply += goodsQty;
      state.gdpAccumulator += revenue - cogs;
    } else {
      const c = commodityOf(biz.kind);
      if (!c) continue;
      const qty =
        (CONFIG.business.outputPerEmployee[biz.kind] ?? 0) * workers * dtHours;
      if (qty <= 0) continue;
      const revenue = qty * state.market[c].price;
      biz.cash += revenue;
      biz.pnl.revenue += revenue;
      state.market[c].supply += qty;
      state.gdpAccumulator += revenue;
    }
  }
}

function updateMarketPrices(state: SimState): void {
  const m = CONFIG.market;
  for (const c of Object.keys(state.market) as Commodity[]) {
    const mc = state.market[c];
    const ratio = (mc.demand + 1) / (mc.supply + 1);
    const factor = Math.min(
      m.maxPriceFactor,
      Math.max(m.minPriceFactor, Math.pow(ratio, m.elasticity)),
    );
    const target = (m.basePrice[c] ?? mc.price) * factor;
    mc.price = mc.price + (target - mc.price) * m.smoothing;
    mc.supply = 0;
    mc.demand = 0;
  }
}

/** Per-citizen + city happiness, employment, population. Cheap; run every step. */
export function computeMetrics(state: SimState): void {
  const pop = state.citizens.length;
  let employed = 0;
  for (const c of state.citizens) if (c.workId != null) employed++;
  const unemployed = pop - employed;
  const employmentRate = pop > 0 ? employed / pop : 0;

  const t = state.taxRates;
  const avgTax = (t.residential + t.commercial + t.industrial) / 3;
  const parks = state.buildings.reduce(
    (n, b) => n + (b.zone === "park" ? 1 : 0),
    0,
  );
  const parkTerm =
    CONFIG.happiness.parkBonus * Math.min(1, parks / Math.max(1, pop / 20));
  const serviceCoverage = Math.min(
    1,
    (state.budget.safety + state.budget.health + state.budget.transport) /
      (pop * 8 + 1),
  );

  let cityH =
    CONFIG.happiness.base +
    CONFIG.happiness.employmentBonus * employmentRate -
    CONFIG.happiness.taxPenalty * avgTax -
    CONFIG.happiness.pollutionPenalty * state.pollution +
    CONFIG.happiness.serviceBonus * serviceCoverage +
    parkTerm;
  cityH = Math.max(0, Math.min(100, cityH));

  for (const c of state.citizens) {
    let h = cityH;
    if (c.workId == null) h -= CONFIG.happiness.unemploymentPersonalPenalty;
    if (c.wallet < 50) h -= CONFIG.happiness.brokePenalty;
    if (c.fun > 70) h += 5;
    c.happiness = Math.max(0, Math.min(100, h));
  }

  state.metrics.population = pop;
  state.metrics.employed = employed;
  state.metrics.unemployed = unemployed;
  state.metrics.employmentRate = employmentRate;
  state.metrics.happiness = cityH;
  state.metrics.treasury = state.treasury;
}

/** Daily settlement: price discovery, unemployment ageing, migration. */
export function settleDaily(state: SimState, rng: RNG): void {
  updateMarketPrices(state);

  for (const c of state.citizens) {
    c.daysUnemployed = c.workId == null ? c.daysUnemployed + 1 : 0;
  }

  // Immigration when the city is attractive and has housing.
  const happiness = state.metrics.happiness;
  const housing = housingFree(state);
  if (
    happiness >= CONFIG.population.joinHappinessThreshold &&
    housing > 0 &&
    state.citizens.length < CONFIG.population.max
  ) {
    const pull =
      Math.round((happiness - CONFIG.population.joinHappinessThreshold) / 5) +
      (jobsFree(state) > 0 ? 2 : 0);
    const n = Math.max(
      0,
      Math.min(CONFIG.population.immigrationPerDayMax, housing, pull),
    );
    for (let i = 0; i < n; i++) spawnCitizen(state, rng);
  }

  // Emigration: the unhappy or chronically jobless leave.
  const leavers = state.citizens.filter(
    (c) =>
      c.happiness < CONFIG.population.leaveHappinessThreshold ||
      c.daysUnemployed > 5,
  );
  const leaveN = Math.min(
    CONFIG.population.emigrationPerDayMax,
    leavers.length,
  );
  for (let i = 0; i < leaveN; i++) removeCitizen(state, leavers[i]!);
}

/** Weekly settlement (fires on Friday): payroll, taxes, maintenance, GDP. */
export function settleWeekly(state: SimState): void {
  // Payroll.
  for (const biz of state.businesses) {
    let due = 0;
    const pays: { id: number; pay: number }[] = [];
    for (const id of biz.employeeIds) {
      const c = citizenById(state, id);
      if (!c) continue;
      const pay = c.hoursWorkedThisWeek * c.wagePerHour;
      pays.push({ id, pay });
      due += pay;
    }
    const ratio = due > 0 ? Math.min(1, Math.max(0, biz.cash) / due) : 1;
    for (const p of pays) {
      const c = citizenById(state, p.id)!;
      const paid = p.pay * ratio;
      c.wallet += paid;
      c.hoursWorkedThisWeek = 0;
    }
    const paidTotal = due * ratio;
    biz.cash -= paidTotal;
    biz.pnl.wages += paidTotal;
  }

  // Taxes in.
  let income = 0;
  const baseRes = CONFIG.economy.taxRates.residential;
  income +=
    state.metrics.population *
    CONFIG.economy.residentialTaxBasePerResident *
    (state.taxRates.residential / baseRes);
  for (const biz of state.businesses) {
    const rate =
      biz.kind === "shop"
        ? state.taxRates.commercial
        : state.taxRates.industrial;
    income += Math.max(0, biz.pnl.revenue) * rate;
  }

  // Expenses out.
  let roadTiles = 0;
  for (let i = 0; i < state.zones.length; i++)
    if (state.zones[i] === 5) roadTiles++;
  const expenses =
    roadTiles * CONFIG.economy.roadMaintenancePerTile * 7 +
    state.budget.transport +
    state.budget.safety +
    state.budget.health +
    state.budget.environment;

  state.treasury += income - expenses;

  // GDP for the week, then reset accumulators.
  state.metrics.gdp = state.gdpAccumulator;
  state.gdpAccumulator = 0;

  for (const biz of state.businesses) {
    biz.pnl.profit = biz.pnl.revenue - biz.pnl.cogs - biz.pnl.wages;
    // Struggling business sheds its workforce to survive.
    if (biz.cash < -2000) {
      for (const id of [...biz.employeeIds]) {
        const c = citizenById(state, id);
        if (c) leaveJob(state, c);
      }
      biz.cash = 0;
    }
    biz.pnl.revenue = 0;
    biz.pnl.cogs = 0;
    biz.pnl.wages = 0;
  }

  state.log.unshift(
    `Week ${Math.floor(state.clock.day / 7)}: treasury ${Math.round(state.treasury)}, GDP ${Math.round(state.metrics.gdp)}, pop ${state.metrics.population}`,
  );
  if (state.log.length > 50) state.log.length = 50;
}

/** Cheap road-tile count (used by the digest). */
export function countRoadTiles(state: SimState): number {
  let n = 0;
  for (let i = 0; i < state.zones.length; i++) if (state.zones[i] === 5) n++;
  return n;
}

// Re-export for callers that want the building lookup alongside economy ops.
export { buildingById };
