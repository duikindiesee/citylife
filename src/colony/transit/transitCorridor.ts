import type { Cell } from "./busRoute.js";
import { busLoopPath, lanePose } from "./path.js";
import { COLONY } from "../config.js";
import { roadCellOk } from "../pathfind.js";
import type { Terrain } from "../terrain.js";

const key = (x: number, y: number) => `${x},${y}`;

export interface PlacementConstraintSource {
  readonly bounds?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly cells?: readonly { readonly x: number; readonly y: number }[];
  readonly definitionId?: string;
}

export function extractPlacementsConstraints(
  placements: readonly PlacementConstraintSource[],
): {
  placementBoxes: { x: number; y: number; w: number; d: number }[];
  ownedCells: Set<string>;
  residentialSetbacks: Set<string>;
} {
  const placementBoxes: Array<{ x: number; y: number; w: number; d: number }> = [];
  const ownedCells = new Set<string>();
  const residentialSetbacks = new Set<string>();

  for (const p of placements) {
    if (p.bounds) {
      placementBoxes.push({
        x: p.bounds.x + p.bounds.w / 2,
        y: p.bounds.y + p.bounds.h / 2,
        w: p.bounds.w,
        d: p.bounds.h,
      });
    }
    if (p.cells) {
      for (const c of p.cells) {
        ownedCells.add(key(c.x, c.y));
        if (p.definitionId?.startsWith("zoned-plot:residential")) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              residentialSetbacks.add(key(c.x + dx, c.y + dy));
            }
          }
        }
      }
    }
  }

  return { placementBoxes, ownedCells, residentialSetbacks };
}

export interface TransitCorridorPathfinderOptions {
  terrain: { size?: number; inBounds(x: number, y: number): boolean; roadCellOk?(x: number, y: number): boolean } | Terrain;
  roadKind: ReadonlyMap<string, unknown>;
  roadWays?: readonly {
    path?: readonly { x: number; y: number }[];
    cells?: readonly { x: number; y: number }[];
  }[];
  placementBoxes: readonly { x: number; y: number; w: number; d: number }[];
  ownedCells: ReadonlySet<string>;
  residentialSetbacks: ReadonlySet<string>;
}

export function createTransitCorridorPathfinder(
  options: TransitCorridorPathfinderOptions,
): (from: Cell, to: Cell) => Cell[] | null {
  const { terrain, roadKind, roadWays = [], placementBoxes, ownedCells, residentialSetbacks } = options;
  const size = ("size" in terrain && typeof terrain.size === "number") ? terrain.size : 608;

  const wayCells = new Set<string>();
  for (const w of roadWays) {
    const pts = (w as any).path ?? (w as any).cells ?? [];
    for (const p of pts) wayCells.add(key(p.x, p.y));
  }

  const checkRoadCell = (x: number, y: number): boolean => {
    if ("roadCellOk" in terrain && typeof terrain.roadCellOk === "function") {
      return terrain.roadCellOk(x, y);
    }
    if ("idx" in terrain && typeof (terrain as any).idx === "function" && "buildable" in terrain) {
      return roadCellOk(terrain as Terrain, x, y);
    }
    return false;
  };

  const distToAllBoxes = (x: number, y: number): number => {
    let minD = Infinity;
    for (const b of placementBoxes) {
      const halfW = b.w / 2;
      const halfD = b.d / 2;
      const dx = Math.max(0, Math.abs(x - b.x) - halfW);
      const dy = Math.max(0, Math.abs(y - b.y) - halfD);
      const d = Math.hypot(dx, dy);
      if (d < minD) minD = d;
    }
    return minD;
  };

  const distToIllegalTerrain = (x: number, y: number): number => {
    let minD = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size || !checkRoadCell(nx, ny)) {
          const d = Math.hypot(dx, dy);
          if (d < minD) minD = d;
        }
      }
    }
    return minD;
  };

  return (from: Cell, to: Cell): Cell[] | null => {
    const startK = key(from.x, from.y);
    const goalK = key(to.x, to.y);

    const dist = new Map<string, number>();
    const prev = new Map<string, Cell>();
    dist.set(startK, 0);

    const pq: { cell: Cell; d: number }[] = [{ cell: from, d: 0 }];

    while (pq.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < pq.length; i++) {
        if (pq[i]!.d < pq[bestIdx]!.d) bestIdx = i;
      }
      const { cell: cur, d: curD } = pq.splice(bestIdx, 1)[0]!;
      const curK = key(cur.x, cur.y);

      if (cur.x === to.x && cur.y === to.y) break;
      if (curD > (dist.get(curK) ?? Infinity)) continue;

      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nk = key(nx, ny);

        if (!checkRoadCell(nx, ny)) continue;
        if (ownedCells.has(nk)) continue;
        if (!roadKind.has(nk) && residentialSetbacks.has(nk)) continue;

        const isRoad = roadKind.has(nk);
        const isWay = wayCells.has(nk);

        const boxDist = distToAllBoxes(nx, ny);
        if (boxDist < 2.5) continue;

        const terrDist = distToIllegalTerrain(nx, ny);
        if (terrDist < 2.0) continue;

        let stepCost = isWay ? 1.0 : 2.0;
        stepCost += (5.0 - Math.min(5.0, boxDist)) * 2;
        stepCost += (5.0 - Math.min(5.0, terrDist)) * 2;

        const newD = curD + stepCost;
        if (newD < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, newD);
          prev.set(nk, cur);
          pq.push({ cell: { x: nx, y: ny }, d: newD });
        }
      }
    }

    if (!prev.has(goalK)) return null;
    const path: Cell[] = [];
    let curr: Cell | undefined = to;
    while (curr) {
      path.push(curr);
      if (curr.x === from.x && curr.y === from.y) break;
      curr = prev.get(key(curr.x, curr.y));
    }
    path.reverse();
    return path;
  };
}

export function computeTransitCorridorPavingCells(
  loop: Cell[],
  terrain: { size: number; inBounds(x: number, y: number): boolean; roadCellOk?(x: number, y: number): boolean } | Terrain,
  residentialSetbacks?: ReadonlySet<string>,
  ownedCells?: ReadonlySet<string>,
  cellMetres = 4.0,
): Cell[] {
  const p = busLoopPath(loop);
  const cfg = COLONY.transit;
  const minOffset = Math.min(0, cfg.busLaneOffsetCells - 1.8);
  const maxOffset = Math.max(0, cfg.busLaneOffsetCells);

  const checkRoadCell = (x: number, y: number): boolean => {
    if ("roadCellOk" in terrain && typeof terrain.roadCellOk === "function") {
      return terrain.roadCellOk(x, y);
    }
    if ("idx" in terrain && typeof (terrain as any).idx === "function" && "buildable" in terrain) {
      return roadCellOk(terrain as Terrain, x, y);
    }
    return false;
  };

  const hL = 6.0;
  const hLActual = hL / cellMetres;

  const result = new Map<string, Cell>();

  for (let s = 0; s < p.total; s += 0.25) {
    const pMin = lanePose(p, s, minOffset);
    const pMax = lanePose(p, s, maxOffset);
    const midPose = {
      x: (pMin.x + pMax.x) / 2,
      y: (pMin.y + pMax.y) / 2,
      heading: pMin.heading,
    };
    const latDist = Math.hypot(pMax.x - pMin.x, pMax.y - pMin.y);
    const sweptHWMetres = (latDist * cellMetres) / 2 + 1.25;
    const hWActual = sweptHWMetres / cellMetres;

    const cos = Math.cos(midPose.heading);
    const sin = Math.sin(midPose.heading);
    const absC = Math.abs(cos);
    const absS = Math.abs(sin);

    const radX = hLActual * absC + hWActual * absS;
    const radY = hLActual * absS + hWActual * absC;

    const minX = Math.floor(midPose.x - radX);
    const maxX = Math.ceil(midPose.x + radX);
    const minY = Math.floor(midPose.y - radY);
    const maxY = Math.ceil(midPose.y + radY);

    const maxProj1 = hLActual + 0.5 * (absC + absS);
    const maxProj2 = hWActual + 0.5 * (absS + absC);

    for (let rx = minX; rx <= maxX; rx++) {
      for (let ry = minY; ry <= maxY; ry++) {
        const dx = rx - midPose.x;
        const dy = ry - midPose.y;
        if (Math.abs(dx) > radX + 0.5) continue;
        if (Math.abs(dy) > radY + 0.5) continue;
        if (Math.abs(dx * cos + dy * sin) > maxProj1) continue;
        if (Math.abs(-dx * sin + dy * cos) > maxProj2) continue;

        const k = key(rx, ry);
        if (result.has(k)) continue;

        if (!checkRoadCell(rx, ry)) continue;
        if (residentialSetbacks?.has(k)) continue;
        if (ownedCells?.has(k)) continue;

        result.set(k, { x: rx, y: ry });
      }
    }
  }

  return [...result.values()];
}
