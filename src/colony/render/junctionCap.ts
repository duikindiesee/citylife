// Spec 137 — DRAPED JUNCTION CAPS. The spec-127 slab was an unrotated square box pinned
// flat at the zone's MAX ground height: measured live, every one of the 8 boot junctions
// floated (corners with 1.2-2.1 m of open air under the plate) and all 25 arm entries
// stepped UP onto it (worst 1.49 m) — the same "flat plateau with hard wedges" legacy v2
// already tried and reverted (commit e711432). This module replaces it with a cap that
// OBEYS the ribbon law (roadRibbon.ts: every vertex samples height at its OWN position
// through the shared sampler, so all road surfaces are coplanar by construction):
//   - PLAN shape: convex hull of the arm-mouth corner points PLUS the true kerb-corner
//     intersection points of adjacent arms (the fillet graft — covers the diagonal
//     overlap tips that mouth corners alone miss), so the cap rotates with the arms.
//   - HEIGHT: every vertex draped at roadY(x, y) + CAP_LIFT. It can neither float nor
//     step: the worst discontinuity anywhere on the perimeter is the 25 mm paint lip.
//   - Z-FIGHT: the 25 mm constant separation + polygonOffset kills the coplanar shimmer
//     the slab existed to hide, the same way the painted markings already do at +50/60mm.
// Pure geometry — node-testable; R3FRoadRibbons draws the merged output.
import type { Terrain } from "../terrain";
import type { JunctionZone } from "./roadJunctions";
import { convexHull, pointInConvexPoly } from "./geom2d";
import { Biome } from "../terrain";

export { convexHull, pointInConvexPoly };

export interface CapBuildOptions {
  terrain: Terrain;
  wx: (x: number) => number;
  wz: (y: number) => number;
  roadY: (x: number, y: number) => number;
}

/** Cap surface sits above the ribbon (0.18) and below the painted markings (0.23+). */
export const CAP_LIFT = 0.205;
/** The cap's own paint (zebras, stop bars) — top of the road paint stack. */
export const CAP_PAINT_LIFT = 0.24;

// WATER-only guard, matching roadRibbon.cellOkOn (spec 133): junction tarmac may pave
// rough land — the grading reshapes it (spec 130) — but never water.
const cellOk = (t: Terrain, x: number, y: number): boolean => {
  const gx = Math.round(x),
    gy = Math.round(y);
  if (!t.inBounds(gx, gy)) return false;
  const i = t.idx(gx, gy);
  const b = t.biome[i];
  return (
    b !== Biome.Ocean &&
    b !== Biome.Shallows &&
    b !== Biome.River &&
    !t.water[i]
  );
};

/** Build the cap outline for a zone: mouth corners + kerb-corner fillet points, hulled.
 *  Mutates zone.poly (zones are plain data owned by the caller). */
export function capPolygon(zone: JunctionZone): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const { cx, cy } = zone;
  for (const a of zone.arms) {
    const px = -a.uy,
      py = a.ux; // arm perpendicular
    const mx = cx + a.ux * a.mouthD,
      my = cy + a.uy * a.mouthD;
    pts.push({ x: mx + px * a.half, y: my + py * a.half });
    pts.push({ x: mx - px * a.half, y: my - py * a.half });
  }
  // Kerb-corner fillets: for each arm pair, the intersection of arm i's kerb line with
  // arm j's kerb line — the true pavement corner between adjacent approaches. Cover the
  // overlap tips the mouth corners miss on shallow crossings; skip near-parallel pairs
  // whose intersection runs away (chord fallback — reads as a kerb chamfer).
  for (let i = 0; i < zone.arms.length; i++) {
    for (let j = i + 1; j < zone.arms.length; j++) {
      const a = zone.arms[i]!,
        b = zone.arms[j]!;
      const denom = a.ux * b.uy - a.uy * b.ux; // cross of headings
      if (Math.abs(denom) < 0.2) continue; // near-parallel
      const cap = 2 * Math.max(a.mouthD, b.mouthD);
      // Corner K = C + perpA*sa*halfA + t*uA, with K also on B's kerb line
      // C + perpB*sb*halfB + s*uB — solve the 2x2 for t, keep |t| within reach.
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          const ax = cx + -a.uy * sa * a.half,
            ay = cy + a.ux * sa * a.half;
          const bx = cx + -b.uy * sb * b.half,
            by = cy + b.ux * sb * b.half;
          // ax + t*a.ux = bx + s*b.ux ; ay + t*a.uy = by + s*b.uy
          const dx = bx - ax,
            dy = by - ay;
          const t = (dx * b.uy - dy * b.ux) / denom;
          if (!Number.isFinite(t) || Math.abs(t) > cap) continue;
          pts.push({ x: ax + a.ux * t, y: ay + a.uy * t });
        }
      }
    }
  }
  const poly = convexHull(pts);
  zone.poly = poly;
  return poly;
}

/** Attach cap polygons to every zone (idempotent). The React layer calls this once so
 *  paint suppression, coverage, foliage and the mesh share one footprint. */
export function attachCapPolys(zones: JunctionZone[]): JunctionZone[] {
  for (const z of zones) if (z.poly.length === 0) capPolygon(z);
  return zones;
}

const centroidOf = (poly: { x: number; y: number }[]) => {
  let x = 0,
    y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
};

/** Fan-triangulate the convex polygon and bisect until every edge <= maxEdge cells, so
 *  the drape follows the terrain at the ribbons' own station resolution. */
export function tessellate(
  poly: { x: number; y: number }[],
  maxEdge = 1.5,
): Array<[{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]> {
  const c = centroidOf(poly);
  let tris: Array<
    [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
  > = [];
  for (let i = 0; i < poly.length; i++)
    tris.push([c, poly[i]!, poly[(i + 1) % poly.length]!]);
  const edge2 = maxEdge * maxEdge;
  let guard = 0;
  while (guard++ < 8) {
    const next: typeof tris = [];
    let split = false;
    for (const t of tris) {
      let li = 0,
        ld = -1;
      for (let e = 0; e < 3; e++) {
        const a = t[e]!,
          b = t[(e + 1) % 3]!;
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (d > ld) {
          ld = d;
          li = e;
        }
      }
      if (ld <= edge2) {
        next.push(t);
        continue;
      }
      split = true;
      const a = t[li]!,
        b = t[(li + 1) % 3]!,
        o = t[(li + 2) % 3]!;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      next.push([a, m, o], [m, b, o]);
    }
    tris = next;
    if (!split) break;
  }
  return tris;
}

/** Emit one zone's draped cap triangles into `out` (world xyz floats). */
export function drapeCap(
  zone: JunctionZone,
  opts: CapBuildOptions,
  out: number[],
): void {
  const poly = zone.poly.length ? zone.poly : capPolygon(zone);
  if (poly.length < 3) return;
  if (!cellOk(opts.terrain, zone.cx, zone.cy)) return; // stale-way fail-soft
  const y = (x: number, gy: number) =>
    Math.max(0, opts.roadY(x, gy)) + CAP_LIFT;
  for (const [a, b, c] of tessellate(poly)) {
    out.push(
      opts.wx(a.x), y(a.x, a.y), opts.wz(a.y),
      opts.wx(b.x), y(b.x, b.y), opts.wz(b.y),
      opts.wx(c.x), y(c.x, c.y), opts.wz(c.y),
    );
  }
}

const quad = (
  out: number[],
  corners: Array<[number, number]>,
  yOf: (x: number, y: number) => number,
  wx: (x: number) => number,
  wz: (y: number) => number,
) => {
  const w = corners.map(([gx, gy]) => [wx(gx), yOf(gx, gy), wz(gy)] as const);
  out.push(
    ...w[0]!, ...w[1]!, ...w[2]!,
    ...w[0]!, ...w[2]!, ...w[3]!,
  );
};

/** Zebra crossings anchored to the arm MOUTHS (never the old blocky suppression edge):
 *  a band of stripes parallel to travel, just outside the cap, correctly rotated on
 *  diagonal arms. Emits into the merged junction-paint array. */
export function capCrosswalks(
  zone: JunctionZone,
  opts: CapBuildOptions,
  out: number[],
): void {
  if (zone.kind === "bend") return;
  const yOf = (x: number, y: number) =>
    Math.max(0, opts.roadY(x, y)) + CAP_PAINT_LIFT;
  const K = 5,
    depth = 1.3,
    sw = 0.16;
  for (const a of zone.arms) {
    const px = -a.uy,
      py = a.ux;
    const bx = zone.cx + a.ux * (a.mouthD + 0.2 + depth / 2);
    const by = zone.cy + a.uy * (a.mouthD + 0.2 + depth / 2);
    const span = a.half * 0.82;
    let ok = true;
    for (let k = 0; k < K && ok; k++) {
      const ca = (k / (K - 1) - 0.5) * 2 * span;
      if (!cellOk(opts.terrain, bx + px * ca, by + py * ca)) ok = false;
    }
    if (!ok) continue;
    for (let k = 0; k < K; k++) {
      const ca = (k / (K - 1) - 0.5) * 2 * span;
      const sx = bx + px * ca,
        sy = by + py * ca;
      quad(
        out,
        [
          [sx + a.ux * (depth / 2) + px * sw, sy + a.uy * (depth / 2) + py * sw],
          [sx + a.ux * (depth / 2) - px * sw, sy + a.uy * (depth / 2) - py * sw],
          [sx - a.ux * (depth / 2) - px * sw, sy - a.uy * (depth / 2) - py * sw],
          [sx - a.ux * (depth / 2) + px * sw, sy - a.uy * (depth / 2) + py * sw],
        ],
        yOf,
        opts.wx,
        opts.wz,
      );
    }
  }
}

/** Stop bars: a lane-wide painted bar across the APPROACH half of each arm (left of
 *  travel, SA drive), perpendicular to the arm's real heading — never compass-snapped.
 *  Crosses bar every arm; tees bar the terminating arm(s) only. */
export function capStopBars(
  zone: JunctionZone,
  opts: CapBuildOptions,
  out: number[],
): void {
  if (zone.kind === "bend") return;
  const yOf = (x: number, y: number) =>
    Math.max(0, opts.roadY(x, y)) + CAP_PAINT_LIFT;
  const arms =
    zone.kind === "cross" ? zone.arms : zone.arms.filter((a) => a.terminating);
  for (const a of arms) {
    // left of travel INTO the junction (t = -u): L = (-uy, ux)... for t=(-ux,-uy):
    // left(t) = (t.y, -t.x) = (-a.uy, a.ux)
    const Lx = -a.uy,
      Ly = a.ux;
    const off = a.mouthD + 0.2 + 1.3 + 0.4; // beyond the zebra band
    const bx = zone.cx + a.ux * off + Lx * (a.half / 2);
    const by = zone.cy + a.uy * off + Ly * (a.half / 2);
    if (!cellOk(opts.terrain, bx, by)) continue;
    const halfLen = a.half / 2; // bar spans the approach half only
    const halfDepth = 0.0625; // 0.5 m
    quad(
      out,
      [
        [bx + Lx * halfLen + a.ux * halfDepth, by + Ly * halfLen + a.uy * halfDepth],
        [bx - Lx * halfLen + a.ux * halfDepth, by - Ly * halfLen + a.uy * halfDepth],
        [bx - Lx * halfLen - a.ux * halfDepth, by - Ly * halfLen - a.uy * halfDepth],
        [bx + Lx * halfLen - a.ux * halfDepth, by + Ly * halfLen - a.uy * halfDepth],
      ],
      yOf,
      opts.wx,
      opts.wz,
    );
  }
}

/** Kerb-line paint: a thin white strip along the cap perimeter between crosswalk mouths,
 *  closing the junction visually from first person and masking the hull chamfer chords. */
export function capKerbLines(
  zone: JunctionZone,
  opts: CapBuildOptions,
  out: number[],
): void {
  const poly = zone.poly;
  if (poly.length < 3) return;
  const yOf = (x: number, y: number) =>
    Math.max(0, opts.roadY(x, y)) + CAP_PAINT_LIFT - 0.005;
  const w = 0.09;
  const nearMouth = (x: number, y: number) => {
    for (const a of zone.arms) {
      const mx = zone.cx + a.ux * a.mouthD,
        my = zone.cy + a.uy * a.mouthD;
      const rx = x - mx,
        ry = y - my;
      const across = Math.abs(rx * -a.uy + ry * a.ux);
      const along = Math.abs(rx * a.ux + ry * a.uy);
      if (across < a.half && along < 1.2) return true; // arm opening — leave unpainted
    }
    return false;
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    if (nearMouth(mx, my)) continue;
    if (!cellOk(opts.terrain, mx, my)) continue;
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    const nx = -ey / len,
      ny = ex / len; // inward normal (CCW hull)
    quad(
      out,
      [
        [a.x + nx * w, a.y + ny * w],
        [b.x + nx * w, b.y + ny * w],
        [b.x - nx * w * 0.2, b.y - ny * w * 0.2],
        [a.x - nx * w * 0.2, a.y - ny * w * 0.2],
      ],
      yOf,
      opts.wx,
      opts.wz,
    );
  }
}

/** Cells the cap covers, mapped to the surface height the terrain must grade to —
 *  unioned into ribbonCoverage so the hull's corner aprons never hang over ungraded
 *  ground (the old slab floated with 1.2-2.1 m of air under its corners). */
export function capCoverageCells(
  zones: JunctionZone[],
  terrain: Terrain,
  roadY: (x: number, y: number) => number,
): Map<string, number> {
  const cover = new Map<string, number>();
  for (const z of zones) {
    const poly = z.poly.length ? z.poly : capPolygon(z);
    if (poly.length < 3) continue;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        if (!pointInConvexPoly(x, y, poly, 0.5)) continue;
        if (!cellOk(terrain, x, y)) continue;
        const h = Math.max(0, roadY(x, y));
        const k = `${x},${y}`;
        const cur = cover.get(k);
        if (cur === undefined || h > cur) cover.set(k, h);
      }
    }
  }
  return cover;
}

/** Foliage exclusion rects (grid coords, origin-anchored like commercial parcels). */
export function capClearRects(
  zones: JunctionZone[],
): { x: number; y: number; w: number; h: number }[] {
  return zones.map((z) => {
    const r = z.rBound + 1;
    return {
      x: Math.floor(z.cx - r),
      y: Math.floor(z.cy - r),
      w: Math.ceil(2 * r),
      h: Math.ceil(2 * r),
    };
  });
}

export interface JunctionCapsBuild {
  /** Merged cap tarmac triangles (world xyz). */
  surf: number[];
  /** Merged junction paint (zebras + stop bars + kerb lines). */
  paint: number[];
}

/** Build everything mesh-shaped for all zones. */
export function buildJunctionCaps(
  zones: JunctionZone[],
  opts: CapBuildOptions,
): JunctionCapsBuild {
  attachCapPolys(zones);
  const surf: number[] = [];
  const paint: number[] = [];
  for (const z of zones) {
    drapeCap(z, opts, surf);
    capCrosswalks(z, opts, paint);
    capStopBars(z, opts, paint);
    capKerbLines(z, opts, paint);
  }
  return { surf, paint };
}
