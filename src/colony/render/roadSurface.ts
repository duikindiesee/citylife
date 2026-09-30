// Spec 127 — the shared road-surface height function, extracted from R3FRoadNetwork so the
// ribbon renderer, the bus (spec 122) and the race course all ride the SAME surface without
// importing the road-tile component.
//
// Continuous (bilinear) sampling via Terrain.worldYAt — the ONE clamped-bilinear ground
// sampler — for fractional grid coordinates, so the surface ramps instead of stepping and
// never goes NaN. The max over a small footprint — instead of the raw cell-center terrain
// height, which floats/sinks riders on slopes.
import type { Terrain } from "../terrain";

export function getSmoothRoadY(
  terrain: Pick<Terrain, "worldYAt">,
  x: number,
  y: number,
): number {
  let mx = -9999;
  // Narrower search footprint (from -0.6 to 0.6) matching the 4m wide road width.
  // We use max height so the road never clips into the hillside (no diagonal tearing).
  // Integer loop indices: the old `dx += 0.2` float loop accumulated to 0.6000000000000001
  // and silently sampled an asymmetric -0.6..+0.4 footprint (spec 118 verify finding).
  for (let ix = -3; ix <= 3; ix++) {
    for (let iy = -3; iy <= 3; iy++) {
      const h = terrain.worldYAt(x + ix * 0.2, y + iy * 0.2);
      if (h > mx) mx = h;
    }
  }
  return mx;
}

export interface MinimalRoadWay {
  readonly path: readonly { readonly x: number; readonly y: number }[];
  readonly width?: number;
}

/** Spec 172 / RACING — True if (x, y) is on a discrete road cell or within any road ribbon surface. */
export function isPointOnRoadSurface(
  x: number,
  y: number,
  roadSet?: ReadonlySet<string> | null,
  roadWays?: readonly MinimalRoadWay[] | null,
): boolean {
  const rx = Math.round(x);
  const ry = Math.round(y);
  if (roadSet && roadSet.has(`${rx},${ry}`)) return true;
  if (!roadWays || roadWays.length === 0) return false;
  for (let w = 0; w < roadWays.length; w++) {
    const way = roadWays[w]!;
    if (!way.path || way.path.length < 2) continue;
    const halfWidth = (way.width ?? 4) / 2 + 0.4;
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
