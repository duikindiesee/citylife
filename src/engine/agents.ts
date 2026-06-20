// Citizen behaviour: a daily state machine driven by the clock + needs.
// Deterministic and cheap — no LLM per citizen (that's what lets it run 24/7).
import { CONFIG } from "./config";
import { RNG } from "./rng";
import { assignJob, buildingById, businessById } from "./world";
import { purchaseFromShop } from "./economy";
import type { Building, Citizen, SimState } from "./types";

const WALK_LOTS_PER_HOUR = 12;

function decayNeeds(c: Citizen, dtHours: number): void {
  if (c.state === "sleeping") {
    c.energy = Math.min(
      100,
      c.energy + CONFIG.needs.energyRecoverAsleep * dtHours,
    );
  } else {
    c.energy = Math.max(0, c.energy - CONFIG.needs.energyDecayAwake * dtHours);
  }
  c.hunger = Math.min(100, c.hunger + CONFIG.needs.hungerGain * dtHours);
  c.fun = Math.max(0, c.fun - CONFIG.needs.funDecay * dtHours);
}

/** Manhattan move (x then y) so motion follows the street grid. Returns true when arrived. */
function moveToward(c: Citizen, tx: number, ty: number, lots: number): boolean {
  let remaining = lots;
  const dx = tx - c.x;
  if (Math.abs(dx) > 1e-3 && remaining > 0) {
    const step = Math.sign(dx) * Math.min(Math.abs(dx), remaining);
    c.x += step;
    remaining -= Math.abs(step);
  }
  const dy = ty - c.y;
  if (Math.abs(dy) > 1e-3 && remaining > 0) {
    const step = Math.sign(dy) * Math.min(Math.abs(dy), remaining);
    c.y += step;
    remaining -= Math.abs(step);
  }
  return Math.abs(tx - c.x) < 0.05 && Math.abs(ty - c.y) < 0.05;
}

function workBuildingOf(state: SimState, c: Citizen): Building | undefined {
  if (c.workId == null) return undefined;
  const biz = businessById(state, c.workId);
  if (!biz) return undefined;
  return buildingById(state, biz.buildingId);
}

/** Advance every citizen one sim-step. */
export function updateCitizens(state: SimState, rng: RNG, dtMin: number): void {
  const dtHours = dtMin / 60;
  const lots = WALK_LOTS_PER_HOUR * dtHours;
  const shops = state.buildings.filter((b) => b.kind === "shop");
  const { hour, dayOfWeek } = state.clock;
  const weekday = dayOfWeek < 5;
  const night = hour >= CONFIG.time.sleepHour || hour < CONFIG.time.wakeHour;
  const workTime =
    weekday &&
    hour >= CONFIG.time.workStartHour &&
    hour < CONFIG.time.workEndHour;

  for (const c of state.citizens) {
    decayNeeds(c, dtHours);

    const home = buildingById(state, c.homeId);

    // Decide today's intent.
    let target: Building | undefined;
    let arriveState: Citizen["state"];

    if (night) {
      target = home;
      arriveState = "sleeping";
    } else if (c.workId != null && workTime) {
      target = workBuildingOf(state, c) ?? home;
      arriveState = "working";
    } else if (c.workId == null) {
      // Job hunting: try to land a job, then behave accordingly.
      assignJob(state, c);
      if (c.workId != null && workTime) {
        target = workBuildingOf(state, c) ?? home;
        arriveState = "working";
      } else {
        target = home;
        arriveState = "job_hunting";
      }
    } else if (
      (c.hunger > 55 || c.fun < 35) &&
      c.wallet > 25 &&
      shops.length > 0
    ) {
      target = shops[c.id % shops.length];
      arriveState = "shopping";
    } else {
      target = home;
      arriveState = "leisure";
    }

    if (!target) {
      c.state = "leisure";
      continue;
    }

    const tx = target.x + 0.5;
    const ty = target.y + 0.5;
    const inTransitState: Citizen["state"] =
      arriveState === "working" ? "commuting_to_work" : "commuting_home";
    const arrived = moveToward(c, tx, ty, lots);
    c.state = arrived ? arriveState : inTransitState;

    if (!arrived) continue;

    // Arrival effects.
    if (arriveState === "working") {
      c.hoursWorkedThisWeek = Math.min(
        CONFIG.wages.hoursPerWorkday * 5,
        c.hoursWorkedThisWeek + dtHours,
      );
    } else if (arriveState === "shopping") {
      const shopBiz =
        target.businessId != null
          ? businessById(state, target.businessId)
          : undefined;
      if (shopBiz) {
        const amount = Math.min(
          c.wallet * 0.3,
          rng.range(
            CONFIG.spending.dailyConsumptionMin,
            CONFIG.spending.dailyConsumptionMax,
          ),
        );
        if (amount > 1) {
          purchaseFromShop(state, shopBiz, amount);
          c.wallet -= amount;
          c.hunger = Math.max(0, c.hunger - 45);
          c.fun = Math.min(100, c.fun + 28);
        }
      }
      c.state = "leisure";
    }
  }
}
