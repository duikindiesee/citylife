import type { Terrain } from "./terrain";
import type { RoadWay } from "./render/roadRibbon";

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * ROAD.PLACEMENT.DECOUPLE.1 — how far apart, along a way, the footprint is stamped. Half a cell, so a
 * diagonal run cannot slip a gap between two stamps.
 */
const FOOTPRINT_STEP_CELLS = 0.5;

/**
 * The road footprint that PLACEMENT reserves: the routed centre-line, widened by the carriageway.
 *
 * THIS IS DERIVED FROM `way.path`, THE ROUTED LINE, AND DELIBERATELY NOT FROM THE RENDERED RIBBON.
 *
 * It used to call `ribbonCoverage()`, i.e. the smoothed mesh the renderer draws. That made every
 * placement decision in the game a function of a RENDERING detail, and the consequences were neither
 * theoretical nor small. Measured on the boot seed, changing only the ribbon's corner-smoothing
 * (PR 436's `MAX_CORNER_CUT_CELLS` clamp) moved the bus depot from (181, 299) to (491, 237) — 310
 * cells across the map, and rotated 12x7 to 7x12 — because these cells feed `depotBlocked` and then
 * `findDepotSite` (runtime.ts). A bus was then posed off-road beside the relocated depot, and the
 * failure surfaced as a TRANSIT test, three layers from the change that caused it.
 *
 * The routed path is the authority the drivable cells are rasterised from (`layRoad`), so a footprint
 * derived from it is stable under any change to how the road is DRAWN — which is the property
 * placement needs. Smoothing may now be re-tuned freely without relocating the depot.
 *
 * Still conservative: `way.width` is the full carriageway, and each stamp is a square (not a disc)
 * around every half-cell sample, so the reservation is never narrower than the asphalt and a corner
 * reserves slightly more than it strictly needs. That is the safe direction — under-reserving is what
 * puts a plot on the road.
 */
export function routedRoadFootprintCells(
  ways: readonly RoadWay[],
  terrain: Terrain,
  clearanceCells = 0,
): Set<string> {
  const out = new Set<string>();
  for (const way of ways) {
    const half = way.width / 2 + clearanceCells;
    const reach = Math.ceil(half);
    const stamp = (px: number, py: number) => {
      const cx = Math.round(px);
      const cy = Math.round(py);
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (!terrain.inBounds(x, y)) continue;
          // The cell centre must be within `half` of this sample, so the reservation follows the
          // carriageway rather than the bounding box of the scan.
          if (Math.hypot(x - px, y - py) > half + 0.5) continue;
          out.add(`${x},${y}`);
        }
    };
    const path = way.path;
    if (path.length === 1) {
      stamp(path[0]!.x, path[0]!.y);
      continue;
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / FOOTPRINT_STEP_CELLS));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
  }
  return out;
}

/**
 * Conservative road footprint for placement, dilated for a verge.
 *
 * Name kept for its callers; the implementation no longer reads the rendered ribbon (see
 * `routedRoadFootprintCells` for why that coupling had to go).
 */
export function conservativeRoadRibbonBlockedCells(
  ways: RoadWay[],
  terrain: Terrain,
  clearanceCells = 0,
): Set<string> {
  return routedRoadFootprintCells(ways, terrain, clearanceCells);
}

export type TerrainPlacementFailure =
  "out-of-bounds" | "non-finite" | "water" | "non-buildable";

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
