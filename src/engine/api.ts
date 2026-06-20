// The Game API: the single contract for mutating the city. The UI, the AI governor,
// and (later) the test harness all go through this. Every mutator returns ActionResult.
import type { Simulation } from "./simulation";
import { recomputePollution } from "./world";
import {
  ZONE_CODE,
  type ActionResult,
  type BudgetAllocation,
  type GameAction,
  type TaxRates,
  type ZoneType,
} from "./types";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

const TAX_ZONES: (keyof TaxRates)[] = [
  "residential",
  "commercial",
  "industrial",
];
const BUDGET_CATS: (keyof BudgetAllocation)[] = [
  "transport",
  "safety",
  "health",
  "environment",
];

export const ORDINANCES = [
  "anti_pollution_act",
  "free_public_transit",
  "urban_renewal",
  "noise_ordinance",
] as const;
export type OrdinanceId = (typeof ORDINANCES)[number];

export class GameAPI {
  constructor(private sim: Simulation) {}

  get state() {
    return this.sim.state;
  }

  setTaxRate(zone: keyof TaxRates, rate: number): ActionResult {
    if (!TAX_ZONES.includes(zone))
      return { ok: false, error: `unknown tax zone: ${zone}` };
    if (typeof rate !== "number" || Number.isNaN(rate))
      return { ok: false, error: "rate must be a number" };
    const r = clamp(rate, 0, 0.25);
    this.state.taxRates[zone] = r;
    return { ok: true, message: `${zone} tax → ${(r * 100).toFixed(1)}%` };
  }

  setBudget(category: keyof BudgetAllocation, amount: number): ActionResult {
    if (!BUDGET_CATS.includes(category))
      return { ok: false, error: `unknown budget category: ${category}` };
    if (typeof amount !== "number" || Number.isNaN(amount))
      return { ok: false, error: "amount must be a number" };
    this.state.budget[category] = clamp(amount, 0, 100_000);
    return {
      ok: true,
      message: `${category} budget → ${Math.round(this.state.budget[category])}`,
    };
  }

  passOrdinance(id: OrdinanceId): ActionResult {
    const s = this.state;
    switch (id) {
      case "anti_pollution_act":
        if (s.treasury < 3000)
          return {
            ok: false,
            error: "cannot afford anti_pollution_act (3000)",
          };
        s.treasury -= 3000;
        s.pollution = Math.max(0, s.pollution * 0.6);
        return {
          ok: true,
          message: "anti_pollution_act passed: pollution cut",
        };
      case "free_public_transit":
        s.budget.transport += 600;
        return {
          ok: true,
          message: "free_public_transit: transport budget raised",
        };
      case "urban_renewal": {
        if (s.treasury < 5000)
          return { ok: false, error: "cannot afford urban_renewal (5000)" };
        s.treasury -= 5000;
        let upgraded = 0;
        for (const b of s.buildings) {
          if (b.zone === "residential" && b.level < 3 && upgraded < 12) {
            b.level = (b.level + 1) as 1 | 2 | 3;
            b.capacityResidents += 4;
            b.height += 2;
            upgraded++;
          }
        }
        return {
          ok: true,
          message: `urban_renewal: upgraded ${upgraded} blocks`,
        };
      }
      case "noise_ordinance":
        s.pollution = Math.max(0, s.pollution - 4);
        return { ok: true, message: "noise_ordinance passed" };
      default:
        return { ok: false, error: `unknown ordinance: ${id}` };
    }
  }

  zoneRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    type: ZoneType,
  ): ActionResult {
    const s = this.state;
    if (!(type in ZONE_CODE))
      return { ok: false, error: `unknown zone type: ${type}` };
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(s.width - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(s.height - 1, Math.max(y1, y2));
    let n = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        s.zones[y * s.width + x] = ZONE_CODE[type];
        n++;
      }
    }
    recomputePollution(s);
    return { ok: true, message: `zoned ${n} lots as ${type}` };
  }

  placeBuilding(x: number, y: number, buildingId: string): ActionResult {
    const s = this.state;
    const cost = 4000;
    if (s.treasury < cost)
      return { ok: false, error: `cannot afford ${buildingId} (${cost})` };
    if (x < 0 || x >= s.width || y < 0 || y >= s.height)
      return { ok: false, error: "out of bounds" };
    s.treasury -= cost;
    // Service buildings improve coverage via a one-off budget bump (MVP abstraction).
    s.budget.safety += 150;
    return { ok: true, message: `placed ${buildingId} at (${x},${y})` };
  }

  /** Dispatch a structured action (used by the AI governor). */
  apply(a: GameAction): ActionResult {
    try {
      switch (a.action) {
        case "setTaxRate":
          return this.setTaxRate(
            a.args[0] as keyof TaxRates,
            Number(a.args[1]),
          );
        case "setBudget":
          return this.setBudget(
            a.args[0] as keyof BudgetAllocation,
            Number(a.args[1]),
          );
        case "passOrdinance":
          return this.passOrdinance(a.args[0] as OrdinanceId);
        case "zoneRect":
          return this.zoneRect(
            Number(a.args[0]),
            Number(a.args[1]),
            Number(a.args[2]),
            Number(a.args[3]),
            a.args[4] as ZoneType,
          );
        case "placeBuilding":
          return this.placeBuilding(
            Number(a.args[0]),
            Number(a.args[1]),
            String(a.args[2]),
          );
        case "noop":
          return { ok: true, message: "noop" };
        default:
          return {
            ok: false,
            error: `unknown action: ${(a as GameAction).action}`,
          };
      }
    } catch (e) {
      return { ok: false, error: `action threw: ${(e as Error).message}` };
    }
  }
}
