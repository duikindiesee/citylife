import type { ColonySim } from "../sim";
import { getSmoothRoadY } from "./roadSurface";
import { ROAD_RIBBON_LIFT } from "./roadRibbon";
import { leveledWorldYAt } from "./terrainLeveling";

/** Shared rendered tyre-contact height for the car and its seated camera. */
export function ownedVehicleSurfaceY(
  sim: ColonySim,
  terrainLevel: ReadonlyMap<number, number> | null | undefined,
  x: number,
  y: number,
): number {
  const road = sim.state.roadSet.has(`${Math.round(x)},${Math.round(y)}`);
  return road
    ? Math.max(0, getSmoothRoadY(sim.state.terrain, x, y)) + ROAD_RIBBON_LIFT
    : Math.max(0, leveledWorldYAt(sim.state.terrain, terrainLevel, x, y)) + 0.02;
}
