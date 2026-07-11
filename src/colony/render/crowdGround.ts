// Spec 140 — the crowd stands ON the road, not under it. The road RIBBON (spec 127) renders as
// a raised carriageway at getSmoothRoadY + ROAD_RIBBON_LIFT, but the citizens, Joe the crab, the
// pedestrians and the porters' carts all grounded on leveledWorldY — the terrain UNDER the ribbon
// — so on any road cell they sank through the tarmac (the operator's "Joe going into the ground
// under the roads"). The parked operator car already does the right thing (R3FOperatorCar); this
// is that same road-aware surface, shared so every moving figure rides it.
import { getSmoothRoadY } from './roadSurface';
import { ROAD_RIBBON_LIFT } from './roadRibbon';
import { leveledWorldY } from './terrainLeveling';

interface GroundTerrain {
  size: number;
  worldY: (x: number, y: number) => number;
  worldYAt: (x: number, y: number) => number;
}

/** The surface a figure should stand on at grid cell (gx, gy): the ROAD ribbon top where the
 *  cell carries a road, else the leveled ground. gx/gy are integer cell coords (the same keys
 *  roadSet uses). Matches where the ribbon mesh actually renders, so nobody sinks or floats. */
export function crowdGroundY(
  terrain: GroundTerrain,
  terrainLevel: ReadonlyMap<number, number> | null | undefined,
  roadSet: { has(key: string): boolean } | null | undefined,
  gx: number,
  gy: number,
): number {
  if (roadSet && roadSet.has(`${gx},${gy}`)) {
    return Math.max(0, getSmoothRoadY(terrain, gx, gy)) + ROAD_RIBBON_LIFT;
  }
  return leveledWorldY(terrain, terrainLevel, gx, gy);
}
