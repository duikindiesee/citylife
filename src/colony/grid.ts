// The block-grid origin. Roads run on block boundaries every COLONY.build.block cells; the grid is
// offset by half a block so the landing site (caravan + base) sits in the MIDDLE of block (0,0),
// clear of the road lines. Shared by build, traffic, and the renderer so they all agree on where
// roads and intersections fall (and so no road runs under the base).
import { COLONY } from "./config";
import type { ColonyState } from "./sim";

const HALF = COLONY.build.block >> 1;

export function gridOrigin(state: ColonyState): { x: number; y: number } {
  const c = state.structures.find((s) => s.kind === "caravan")!;
  return { x: c.x - HALF, y: c.y - HALF };
}
