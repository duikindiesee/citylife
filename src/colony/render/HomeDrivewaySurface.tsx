import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ColonySim } from "../sim";
import { leveledWorldYAt } from "./terrainLeveling";
import { getSmoothRoadY, isPointOnRoadSurface, type MinimalRoadWay } from "./roadSurface";
import { ROAD_RIBBON_LIFT } from "./roadRibbon";

export type DrivewayCell = { x: number; y: number };

/**
 * Checks whether grid coordinate (x, y) lies within the actual rendered half-width
 * of any road ribbon way (without the +0.8m vehicle physics tolerance).
 */
export function isPointOnRenderedRoadRibbon(
  x: number,
  y: number,
  roadWays?: readonly MinimalRoadWay[] | null,
): boolean {
  if (!roadWays || roadWays.length === 0) return false;
  for (let w = 0; w < roadWays.length; w++) {
    const way = roadWays[w]!;
    if (!way.path || way.path.length < 2) continue;
    const halfWidth = (way.width ?? 4) / 2;
    const hwSq = halfWidth * halfWidth;
    for (let i = 0; i < way.path.length - 1; i++) {
      const a = way.path[i]!;
      const b = way.path[i + 1]!;
      const minX = Math.min(a.x, b.x) - halfWidth;
      const maxX = Math.max(a.x, b.x) + halfWidth;
      const minY = Math.min(a.y, b.y) - halfWidth;
      const maxY = Math.max(a.y, b.y) + halfWidth;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;

      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      let distSq: number;
      if (len2 < 1e-6) {
        distSq = (x - a.x) ** 2 + (y - a.y) ** 2;
      } else {
        const t = Math.max(
          0,
          Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2),
        );
        const px = a.x + vx * t;
        const py = a.y + vy * t;
        distSq = (x - px) ** 2 + (y - py) ** 2;
      }
      if (distSq <= hwSq) return true;
    }
  }
  return false;
}

/**
 * Derives the apron cells connecting the driveway tip to the rendered road carriageway surface.
 * Steps along the street-facing direction until reaching the road carriageway surface,
 * up to a maximum safety bound.
 */
export function deriveDrivewayApronCells(
  cells: readonly DrivewayCell[],
  gate: { x: number; y: number } | undefined,
  side: number | undefined,
  roadSet: ReadonlySet<string> | undefined,
  isRoadSurface: (gx: number, gy: number) => boolean,
  maxSteps: number = 6,
): DrivewayCell[] {
  if (!cells || cells.length === 0 || !gate) return [];

  let minCell = cells[0]!;
  let maxCell = cells[0]!;
  for (const c of cells) {
    if (c.x + c.y < minCell.x + minCell.y) minCell = c;
    if (c.x + c.y > maxCell.x + maxCell.y) maxCell = c;
  }

  let tip = cells[0]!;
  let stepX = 0;
  let stepY = 0;

  const dMin = Math.abs(minCell.x - gate.x) + Math.abs(minCell.y - gate.y);
  const dMax = Math.abs(maxCell.x - gate.x) + Math.abs(maxCell.y - gate.y);

  const candMin =
    dMin > 0
      ? {
          tip: minCell,
          sx: Math.sign(minCell.x - gate.x),
          sy: Math.sign(minCell.y - gate.y),
          distFromGate: dMin,
        }
      : null;
  const candMax =
    dMax > 0
      ? {
          tip: maxCell,
          sx: Math.sign(maxCell.x - gate.x),
          sy: Math.sign(maxCell.y - gate.y),
          distFromGate: dMax,
        }
      : null;

  const hitsRoadSteps = (cand: { tip: DrivewayCell; sx: number; sy: number } | null): number => {
    if (!cand || (cand.sx === 0 && cand.sy === 0)) return Infinity;
    for (let s = 1; s <= maxSteps; s++) {
      const cx = cand.tip.x + cand.sx * s;
      const cy = cand.tip.y + cand.sy * s;
      if (roadSet?.has(`${cx},${cy}`) || isRoadSurface(cx, cy)) return s;
    }
    return Infinity;
  };

  const sMin = hitsRoadSteps(candMin);
  const sMax = hitsRoadSteps(candMax);

  let chosen = candMin ?? candMax;
  if (candMin && candMax) {
    if (sMin !== sMax) {
      chosen = sMin < sMax ? candMin : candMax;
    } else if (candMin.distFromGate !== candMax.distFromGate) {
      // In neighborhood.ts, the streetward verge overhang from gate (2..3 cells)
      // is always shorter than the front-yard setback from gate to door (>= 4 cells).
      chosen = candMin.distFromGate < candMax.distFromGate ? candMin : candMax;
    } else if (side !== undefined && side !== 0) {
      chosen = -Math.sign(side) < 0 ? candMin : candMax;
    }
  }

  if (chosen) {
    tip = chosen.tip;
    stepX = chosen.sx;
    stepY = chosen.sy;
  }

  if (stepX === 0 && stepY === 0) return [];

  const apron: DrivewayCell[] = [];
  const seen = new Set<string>(cells.map((c) => `${c.x},${c.y}`));

  let curX = tip.x;
  let curY = tip.y;

  for (let s = 1; s <= maxSteps; s++) {
    curX += stepX;
    curY += stepY;
    const k = `${curX},${curY}`;
    if (seen.has(k)) continue;
    seen.add(k);

    apron.push({ x: curX, y: curY });

    // If this cell is on the road network or hits the continuous road surface,
    // we have bridged the gap and reached the carriageway.
    if (roadSet?.has(k) || isRoadSurface(curX, curY)) {
      break;
    }
  }

  return apron;
}

/**
 * Paves the driveway cells and road apron connecting the home to the rendered road carriageway.
 * Samples leveled ground height with smooth road carriageway height blended near road contact,
 * ensuring continuous road-to-gate paving without vertical steps or tears.
 */
export function homeDrivewayGeometry(
  cells: readonly DrivewayCell[],
  terrainSize: number,
  roadSet: ReadonlySet<string>,
  surfaceAt: (x: number, y: number) => number,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const seen = new Set<string>();

  for (const cell of cells) {
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key) || roadSet.has(key)) continue;
    seen.add(key);

    const first = vertices.length / 3;
    for (const [dx, dy] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ]) {
      const gx = cell.x + dx;
      const gy = cell.y + dy;
      vertices.push(
        (gx - terrainSize / 2) * 4,
        surfaceAt(gx, gy) + 0.055,
        (gy - terrainSize / 2) * 4,
      );
    }
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function HomeDrivewaySurface({
  sim,
  terrainLevel,
  plotId,
  cells,
  gate,
  side,
}: {
  sim: ColonySim;
  terrainLevel: ReadonlyMap<number, number> | null | undefined;
  plotId: string;
  cells: readonly DrivewayCell[];
  gate?: { x: number; y: number };
  side?: number;
}) {
  const geometry = useMemo(() => {
    const terrain = sim.state.terrain;
    const roadWays = sim.state.roadWays;
    const roadSet = sim.state.roadSet;
    const hasRibbonWays = Boolean(roadWays && roadWays.length > 0);

    // Connect driveway tip to rendered road ribbon via directional apron
    const apron = deriveDrivewayApronCells(
      cells,
      gate,
      side,
      hasRibbonWays ? undefined : roadSet,
      (gx, gy) =>
        hasRibbonWays
          ? isPointOnRenderedRoadRibbon(gx, gy, roadWays)
          : isPointOnRoadSurface(gx, gy, roadSet, roadWays),
    );

    const combinedCells = [...cells, ...apron];
    const effectiveRoadSkipSet = hasRibbonWays ? new Set<string>() : roadSet;

    return homeDrivewayGeometry(
      combinedCells,
      terrain.size,
      effectiveRoadSkipSet,
      (gx, gy) => {
        const groundY = Math.max(
          0,
          leveledWorldYAt(terrain, terrainLevel, gx, gy),
        );
        const onRoad = isPointOnRoadSurface(gx, gy, roadSet, roadWays);
        if (onRoad) {
          const roadH = Math.max(0, getSmoothRoadY(terrain, gx, gy)) + ROAD_RIBBON_LIFT;
          return Math.max(groundY, roadH - 0.045);
        }
        return groundY;
      },
    );
  }, [sim, terrainLevel, cells, gate, side]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      name="player-home-driveway"
      userData={{ plotId }}
      geometry={geometry}
      receiveShadow
    >
      <meshStandardMaterial
        color="#65727b"
        roughness={0.9}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}
