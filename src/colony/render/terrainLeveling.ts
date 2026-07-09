export interface TerrainLevelingTerrain {
  worldY(x: number, y: number): number;
}

export interface TerrainLevelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoastalCommercialDryBlendOptions {
  next: Map<number, number>;
  n: number;
  terrain: TerrainLevelingTerrain;
  rects: readonly TerrainLevelRect[];
  roadRibbonCells?: { has(key: string): boolean } | null;
  dry: number;
  apron?: number;
}

/**
 * Render-only commercial pad treatment for coastal districts.
 *
 * PR #164 already dries commercial shop/mall seat cells so buildings sit on surfaceY instead of the
 * raw coastal height. This helper keeps that dry pass and adds only the visual blend: where a dry pad
 * meets steep water/shoreline, lift a deterministic apron of adjacent low cells so the chunked terrain
 * forms a slope instead of a one-cell black cliff face. Sim terrain, water, and pathfinding remain raw.
 */
export function applyCoastalCommercialDryBlend({
  next,
  n,
  terrain,
  rects,
  roadRibbonCells = null,
  dry,
  apron = 10,
}: CoastalCommercialDryBlendOptions): void {
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < n && y < n) next.set(y * n + x, v);
  };
  const road = (x: number, y: number) =>
    roadRibbonCells?.has(`${x},${y}`) ?? false;

  for (const r of rects) {
    // Keep #164's dry behavior: footprint / immediate seat cells clear the sea disc.
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++)
        if (
          x >= 0 &&
          y >= 0 &&
          x < n &&
          y < n &&
          terrain.worldY(x, y) < dry &&
          !road(x, y)
        )
          put(x, y, dry);

    // Blend only below-dry coastal cells around the dry rectangle. Inland cells already above DRY are
    // left natural, preserving homesteads/inland pads and avoiding raised green berms on ordinary land.
    for (let y = r.y - apron; y < r.y + r.h + apron; y++)
      for (let x = r.x - apron; x < r.x + r.w + apron; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n || road(x, y)) continue;
        const dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1));
        const dist = Math.max(dx, dy);
        if (dist === 0 || dist >= apron) continue;
        const nat = terrain.worldY(x, y);
        // Only cells below the commercial dry floor get the apron. High/inland ground remains natural;
        // low coastal frontage widens into a slope instead of ending in a hard sea-floor cut.
        if (nat >= dry) continue;
        const s = dist / (apron + 1);
        const sm = s * s * (3 - 2 * s);
        const blended = dry + (nat - dry) * sm;
        const i = y * n + x;
        const prior = next.get(i);
        if (prior === undefined || blended > prior) next.set(i, blended);
      }
  }
}
