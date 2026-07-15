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
