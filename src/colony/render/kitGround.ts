import { leveledWorldYAt, type LeveledTerrain } from "./terrainLeveling";

/** Resolve rendered ground height from fractional grid coordinates, in metres. */
export type GroundAt = (gx: number, gy: number) => number;

/** Backwards-compatible ground for flat render fixtures. */
export const FLAT_GROUND: GroundAt = () => 0;

/** Build a sampler that follows the same leveled surface as the terrain renderer. */
export function groundAtFromLeveling(
  terrain: LeveledTerrain,
  terrainLevel: ReadonlyMap<number, number> | null | undefined,
): GroundAt {
  return (gx, gy) => leveledWorldYAt(terrain, terrainLevel, gx, gy);
}
