import type { Cell } from "./busRoute.js";
import { busLoopPath, lanePose } from "./path.js";
import { COLONY } from "../config.js";
import { roadCellOk } from "../pathfind.js";
import type { Terrain } from "../terrain.js";
import type { SpatialFrame } from "../worldSurvey.js";
import { resolvePointBetweenFrames } from "../spatial/spatialLocation.js";

const key = (x: number, y: number) => `${x},${y}`;

export interface Pt2D {
  readonly x: number;
  readonly y: number;
}

export function projectFootprintVerticesToSurface(
  localMinX: number,
  localMinY: number,
  localMaxX: number,
  localMaxY: number,
  frameId: string | undefined,
  surfaceFrameId: string | undefined,
  framesMap: ReadonlyMap<string, SpatialFrame> | undefined,
): readonly Pt2D[] | null {
  if (!frameId || !surfaceFrameId || frameId === surfaceFrameId) {
    return [
      { x: localMinX, y: localMinY },
      { x: localMaxX, y: localMinY },
      { x: localMaxX, y: localMaxY },
      { x: localMinX, y: localMaxY },
    ];
  }
  if (!framesMap) return null;
  const surfaceFrame = framesMap.get(surfaceFrameId);
  const sourceFrame = framesMap.get(frameId);
  if (!surfaceFrame || !sourceFrame || !surfaceFrame.grid) {
    return null;
  }
  const sourceGrid = sourceFrame.grid;
  const cellSize = sourceGrid?.cellSize ?? surfaceFrame.grid.cellSize;
  const sourceOrigin = sourceGrid?.origin ?? { x: 0, y: 0, z: 0 };

  const corners = [
    { x: localMinX, y: localMinY },
    { x: localMaxX, y: localMinY },
    { x: localMaxX, y: localMaxY },
    { x: localMinX, y: localMaxY },
  ];

  const result: Pt2D[] = [];
  for (const corner of corners) {
    const localPoint = {
      x: sourceOrigin.x + corner.x * cellSize,
      y: sourceOrigin.y ?? 0,
      z: sourceOrigin.z + corner.y * cellSize,
    };
    try {
      const surfacePoint = resolvePointBetweenFrames(
        localPoint,
        frameId,
        surfaceFrameId,
        framesMap,
      );
      const surfaceGrid = surfaceFrame.grid;
      result.push({
        x: (surfacePoint.x - surfaceGrid.origin.x) / surfaceGrid.cellSize,
        y: (surfacePoint.z - surfaceGrid.origin.z) / surfaceGrid.cellSize,
      });
    } catch {
      return null;
    }
  }

  return result.length === 4 ? result : null;
}

export function convexPolygonIntersectsBox(
  poly: readonly Pt2D[],
  box: { x: number; y: number; w: number; h: number },
): boolean {
  if (poly.length < 3) return false;

  const boxVerts: readonly Pt2D[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];

  const axes: Pt2D[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];

  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i]!;
    const p2 = poly[(i + 1) % poly.length]!;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    axes.push({ x: -dy, y: dx });
  }

  for (const axis of axes) {
    let minA = Infinity,
      maxA = -Infinity;
    for (const v of poly) {
      const proj = v.x * axis.x + v.y * axis.y;
      if (proj < minA) minA = proj;
      if (proj > maxA) maxA = proj;
    }
    let minB = Infinity,
      maxB = -Infinity;
    for (const v of boxVerts) {
      const proj = v.x * axis.x + v.y * axis.y;
      if (proj < minB) minB = proj;
      if (proj > maxB) maxB = proj;
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

export interface PlacementConstraintSource {
  readonly id?: string;
  readonly frameId?: string;
  readonly bounds?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly cells?: readonly { readonly x: number; readonly y: number }[];
  readonly definitionId?: string;
  readonly x?: number;
  readonly y?: number;
}

export interface ExtractPlacementsConstraintsOptions {
  readonly frames?: readonly SpatialFrame[] | ReadonlyMap<string, SpatialFrame>;
  readonly surfaceFrameId?: string;
}

export interface PlacementsConstraintsResult {
  readonly placementBoxes: Array<{ x: number; y: number; w: number; d: number }>;
  readonly ownedCells: Set<string>;
  readonly residentialSetbacks: Set<string>;
  readonly hasUnknownFrame?: boolean;
}

export function extractPlacementsConstraints(
  placements: readonly PlacementConstraintSource[],
  options?: ExtractPlacementsConstraintsOptions,
): PlacementsConstraintsResult {
  const placementBoxes: Array<{ x: number; y: number; w: number; d: number }> = [];
  const ownedCells = new Set<string>();
  const residentialSetbacks = new Set<string>();
  let hasUnknownFrame = false;

  const surfaceFrameId = options?.surfaceFrameId;
  const framesMap =
    options?.frames instanceof Map
      ? options.frames
      : Array.isArray(options?.frames)
        ? new Map(options.frames.map((f) => [f.id, f]))
        : undefined;

  for (const p of placements) {
    const isChildFrame =
      Boolean(p.frameId) &&
      Boolean(surfaceFrameId) &&
      p.frameId !== surfaceFrameId;

    if (!isChildFrame) {
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
    } else {
      if (!framesMap || !framesMap.has(p.frameId!)) {
        hasUnknownFrame = true;
        continue;
      }

      let poly: readonly Pt2D[] | null = null;
      if (p.bounds) {
        poly = projectFootprintVerticesToSurface(
          p.bounds.x,
          p.bounds.y,
          p.bounds.x + p.bounds.w,
          p.bounds.y + p.bounds.h,
          p.frameId,
          surfaceFrameId,
          framesMap,
        );
      } else if (typeof p.x === "number" && typeof p.y === "number") {
        poly = projectFootprintVerticesToSurface(
          p.x,
          p.y,
          p.x + 1,
          p.y + 1,
          p.frameId,
          surfaceFrameId,
          framesMap,
        );
      }

      if (!poly) {
        hasUnknownFrame = true;
        continue;
      }

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const pt of poly) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }

      placementBoxes.push({
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        w: maxX - minX,
        d: maxY - minY,
      });

      if (p.cells && p.cells.length > 0) {
        for (const c of p.cells) {
          const cellPoly = projectFootprintVerticesToSurface(
            c.x,
            c.y,
            c.x + 1,
            c.y + 1,
            p.frameId,
            surfaceFrameId,
            framesMap,
          );
          if (!cellPoly) {
            hasUnknownFrame = true;
            continue;
          }
          let cMinX = Infinity,
            cMaxX = -Infinity,
            cMinY = Infinity,
            cMaxY = -Infinity;
          for (const pt of cellPoly) {
            if (pt.x < cMinX) cMinX = pt.x;
            if (pt.x > cMaxX) cMaxX = pt.x;
            if (pt.y < cMinY) cMinY = pt.y;
            if (pt.y > cMaxY) cMaxY = pt.y;
          }
          const startX = Math.floor(cMinX);
          const endX = Math.ceil(cMaxX);
          const startY = Math.floor(cMinY);
          const endY = Math.ceil(cMaxY);
          for (let iy = startY; iy < endY; iy++) {
            for (let ix = startX; ix < endX; ix++) {
              ownedCells.add(key(ix, iy));
              if (p.definitionId?.startsWith("zoned-plot:residential")) {
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    residentialSetbacks.add(key(ix + dx, iy + dy));
                  }
                }
              }
            }
          }
        }
      } else {
        const startX = Math.floor(minX);
        const endX = Math.ceil(maxX);
        const startY = Math.floor(minY);
        const endY = Math.ceil(maxY);
        for (let iy = startY; iy < endY; iy++) {
          for (let ix = startX; ix < endX; ix++) {
            ownedCells.add(key(ix, iy));
            if (p.definitionId?.startsWith("zoned-plot:residential")) {
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  residentialSetbacks.add(key(ix + dx, iy + dy));
                }
              }
            }
          }
        }
      }
    }
  }

  return { placementBoxes, ownedCells, residentialSetbacks, hasUnknownFrame };
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
