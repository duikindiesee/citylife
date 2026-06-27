export interface GridCell {
  x: number;
  y: number;
}

export interface RectFootprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectFootprintCells(rect: RectFootprint): GridCell[] {
  const out: GridCell[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) out.push({ x, y });
  return out;
}

export function footprintTouchesRoad(
  footprint: Iterable<GridCell>,
  roadSet: ReadonlySet<string>,
): boolean {
  for (const c of footprint) {
    if (roadSet.has(`${c.x},${c.y}`)) return true;
    if (roadSet.has(`${c.x + 1},${c.y}`)) return true;
    if (roadSet.has(`${c.x - 1},${c.y}`)) return true;
    if (roadSet.has(`${c.x},${c.y + 1}`)) return true;
    if (roadSet.has(`${c.x},${c.y - 1}`)) return true;
  }
  return false;
}
