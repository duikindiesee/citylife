import type { Terrain } from "../terrain";
import type { SeedStructure } from "../sim";

export type CityLifePropInstanceKind = "rallyVenueBench";

export interface CityLifePropAsset {
  id: string;
  /** Repo-relative public URL served by Vite from public/assets. */
  url: string;
  instanceKind: CityLifePropInstanceKind;
  publicSafe: true;
}

export interface CityLifePropPlacement {
  assetId: string;
  instanceKind: CityLifePropInstanceKind;
  x: number;
  y: number;
  rotationTurns: number;
  scale: number;
}

export const venuePropAssets: readonly CityLifePropAsset[] = [
  {
    id: "rally-venue-bench",
    url: "/assets/citylife/props/rally-venue-bench.glb",
    instanceKind: "rallyVenueBench",
    publicSafe: true,
  },
] as const;

/**
 * CityLife owns placement. Blender only authors canonical meshes.
 * The first proof prop sits just off the rally marker, derived from the rally city cell.
 */
export function rallyVenuePropPlacements(
  structures: readonly SeedStructure[],
  terrain?: Terrain,
): CityLifePropPlacement[] {
  const rally = structures.find((s) => s.kind === "rally");
  if (!rally) return [];
  const candidates = [
    { dx: 2, dy: 1, rotationTurns: 0.125 },
    { dx: -2, dy: 1, rotationTurns: 0.875 },
    { dx: 1, dy: -2, rotationTurns: 0.0 },
    { dx: -1, dy: -2, rotationTurns: 0.5 },
  ];
  for (const c of candidates) {
    const x = Math.round(rally.x + c.dx);
    const y = Math.round(rally.y + c.dy);
    if (terrain && (!terrain.inBounds(x, y) || terrain.isWater(x, y))) continue;
    return [
      {
        assetId: "rally-venue-bench",
        instanceKind: "rallyVenueBench",
        x,
        y,
        rotationTurns: c.rotationTurns,
        scale: 1,
      },
    ];
  }
  return [];
}
