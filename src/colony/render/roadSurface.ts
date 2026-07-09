// Spec 127 — the shared road-surface height function, extracted from R3FRoadNetwork so the
// ribbon renderer, the bus (spec 122) and the race course all ride the SAME surface without
// importing the road-tile component.
//
// Bilinear interpolation for fractional grid coordinates to prevent NaN spiky geometries.
// The max over a small bilinear footprint — instead of the raw cell-center terrain height,
// which floats/sinks riders on slopes.
export function getSmoothRoadY(terrain: any, x: number, y: number): number {
  const size = terrain.size;
  const cl = (v: number) => Math.max(0, Math.min(size - 1, v));

  const bil = (fx: number, fy: number): number => {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = terrain.worldY(cl(x0), cl(y0));
    const b = terrain.worldY(cl(x0 + 1), cl(y0));
    const c = terrain.worldY(cl(x0), cl(y0 + 1));
    const d = terrain.worldY(cl(x0 + 1), cl(y0 + 1));
    return (
      a * (1 - tx) * (1 - ty) +
      b * tx * (1 - ty) +
      c * (1 - tx) * ty +
      d * tx * ty
    );
  };

  let mx = -9999;
  // Narrower search footprint (from -0.6 to 0.6) matching the 4m wide road width.
  // We use max height so the road never clips into the hillside (no diagonal tearing).
  // Integer loop indices: the old `dx += 0.2` float loop accumulated to 0.6000000000000001
  // and silently sampled an asymmetric -0.6..+0.4 footprint (spec 118 verify finding).
  for (let ix = -3; ix <= 3; ix++) {
    for (let iy = -3; iy <= 3; iy++) {
      const h = bil(x + ix * 0.2, y + iy * 0.2);
      if (h > mx) mx = h;
    }
  }
  return mx;
}
