import type { Terrain } from "./terrain";
import { ribbonCoverage, type RoadWay } from "./render/roadRibbon";

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Conservative rendered-ribbon footprint using the mesh's smoothing/width sampling, optionally
 * dilated for a verge. At water edges it may reserve a cell from a cross-section the mesh omits. */
export function conservativeRoadRibbonBlockedCells(
  ways: RoadWay[],
  terrain: Terrain,
  clearanceCells = 0,
): Set<string> {
  const out = new Set<string>();
  for (const key of ribbonCoverage(ways, terrain, () => 0).keys()) {
    const comma = key.indexOf(",");
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    for (let dy = -clearanceCells; dy <= clearanceCells; dy++)
      for (let dx = -clearanceCells; dx <= clearanceCells; dx++)
        out.add(`${x + dx},${y + dy}`);
  }
  return out;
}

export type TerrainPlacementFailure =
  | "out-of-bounds"
  | "non-finite"
  | "water"
  | "non-buildable";

export interface TerrainInvalidCell {
  key: string;
  reason: TerrainPlacementFailure;
}

/** Exact half-open footprint terrain gate shared by every plot/pad survey. */
export function plotTerrainInvalidCells(
  rect: PlotRect,
  terrain: Terrain,
): TerrainInvalidCell[] {
  const invalid: TerrainInvalidCell[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const key = `${x},${y}`;
      if (!terrain.inBounds(x, y)) {
        invalid.push({ key, reason: "out-of-bounds" });
        continue;
      }
      if (!Number.isFinite(terrain.worldY(x, y))) {
        invalid.push({ key, reason: "non-finite" });
        continue;
      }
      if (terrain.isWater(x, y)) {
        invalid.push({ key, reason: "water" });
        continue;
      }
      if (terrain.buildable[terrain.idx(x, y)] === 0)
        invalid.push({ key, reason: "non-buildable" });
    }
  return invalid;
}

export function plotClearsBuildableTerrain(
  rect: PlotRect,
  terrain: Terrain,
): boolean {
  return plotTerrainInvalidCells(rect, terrain).length === 0;
}

/** Shared placement invariant for every rectangular plot/pad survey. */
export function plotRoadOverlapCells(
  rect: PlotRect,
  roadCells: ReadonlySet<string>,
): string[] {
  const overlaps: string[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const key = `${x},${y}`;
      if (roadCells.has(key)) overlaps.push(key);
    }
  return overlaps;
}

export function plotClearsRoadFootprint(
  rect: PlotRect,
  roadCells: ReadonlySet<string>,
): boolean {
  return plotRoadOverlapCells(rect, roadCells).length === 0;
}
