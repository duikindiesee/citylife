import type { RoadCell } from "./build";
import { leastCostPath, type Cell } from "./pathfind";
import type { SeedStructure } from "./sim";
import type { Terrain } from "./terrain";

export const IRONWORK_PILLAR_ASSET_URL =
  "/assets/citylife/props/ironwork-pillar.glb";

export interface IronworkHikeState {
  terrain: Terrain;
  structures: readonly SeedStructure[];
  roads: readonly RoadCell[];
  occupied?: ReadonlySet<string>;
}

export function ironworkPillarCell(
  structures: readonly SeedStructure[],
): Cell | null {
  const pillar = structures.find((structure) => structure.kind === "ironworkPillar");
  return pillar ? { x: Math.round(pillar.x), y: Math.round(pillar.y) } : null;
}

function routeFromCandidates(
  state: IronworkHikeState,
  candidates: readonly Cell[],
  pillar: Cell,
  avoidReserved: boolean,
): Cell[] | null {
  const { terrain, occupied } = state;
  const roadKeys = new Set(state.roads.map((road) => `${road.x},${road.y}`));
  for (const start of candidates) {
    const path = leastCostPath(terrain, start, pillar, {
      diagonal: true,
      forbidBeach: true,
      margin: 190,
      slopeWeight: 2.8,
      blocked: avoidReserved
        ? (x, y) => {
            if (Math.max(Math.abs(x - pillar.x), Math.abs(y - pillar.y)) <= 2)
              return false;
            if (roadKeys.has(`${x},${y}`)) return false;
            return occupied?.has(`${x},${y}`) ?? false;
          }
        : undefined,
    });
    if (path && path.length >= 2) return path;
  }
  return null;
}

/** A deterministic contour-following footpath from the nearest viable colony road to the Pillar.
 *  Road cells are only the trailhead: no new drivable road is laid on the highland. The first pass
 *  avoids reserved lots and structures; the terrain-only fallback keeps older saves reachable when
 *  their built layout encloses every clean trailhead. */
export function buildIronworkHikePath(state: IronworkHikeState): Cell[] {
  const pillar = ironworkPillarCell(state.structures);
  if (!pillar) return [];
  const starts = (state.roads.length > 0
    ? state.roads.map((road) => ({ x: road.x, y: road.y }))
    : [state.terrain.landing]
  )
    .sort(
      (a, b) =>
        Math.hypot(a.x - pillar.x, a.y - pillar.y) -
          Math.hypot(b.x - pillar.x, b.y - pillar.y) ||
        a.y - b.y ||
        a.x - b.x,
    )
    .slice(0, 32);

  return (
    routeFromCandidates(state, starts, pillar, true) ??
    routeFromCandidates(state, starts, pillar, false) ??
    []
  );
}
