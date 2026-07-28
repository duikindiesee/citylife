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
import type { JunctionArm, JunctionZone } from "./roadJunctions";
import { convexHull, pointInConvexPoly, pointInPoly, nearPoly } from "./geom2d";
import { EDGE_LINE_HALF_WIDTH, edgeLineOffset } from "./roadRibbon";
import { Biome } from "../terrain";

export { convexHull, pointInConvexPoly, pointInPoly, nearPoly };

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

// WATER-only guard, matching roadRibbon.cellOkOn (spec 133): junction tarmac may pave rough
// land — the grading reshapes it (spec 130) — but never water. Spec 140 amendment (reverted):
// beach is NOT excluded here, mirroring the ribbon. The road-off-beaches ban is a ROUTING rule;
// a cap that grazes the shore renders continuously rather than shattering (see roadRibbon.cellOkOn).
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

/** How far BEHIND the zone centre an arm's carriageway rectangle reaches: far enough to
 *  cross the widest OTHER arm, so the outer elbow of a bend (and the back corner of a tee)
 *  is paved instead of being bitten out. For a cross this adds nothing — the opposite arm
 *  already covers it. Never larger than one crossing carriageway half-width, so it cannot
 *  push tarmac past a kerb line. */
function armBack(arms: JunctionArm[], self: JunctionArm): number {
  let back = 0;
  for (const o of arms) if (o !== self) back = Math.max(back, o.half);
  return back || self.half;
}

/** Distance from the zone centre to where the ray `d` leaves arm `a`'s carriageway
 *  rectangle (along in [-back, mouthD], |across| <= half). Every rectangle contains the
 *  centre in its interior, so this is always > 0 and the union is STAR-SHAPED about the
 *  centre — which is what makes the radial reconstruction below exact. */
function armRayExit(
  a: JunctionArm,
  back: number,
  dx: number,
  dy: number,
): number {
  const du = dx * a.ux + dy * a.uy;
  const dn = dx * -a.uy + dy * a.ux;
  let t = Infinity;
  if (du > 1e-12) t = Math.min(t, a.mouthD / du);
  else if (du < -1e-12) t = Math.min(t, back / -du);
  if (Math.abs(dn) > 1e-12) t = Math.min(t, a.half / Math.abs(dn));
  return t;
}

/** Proper segment intersection point (endpoints included), or null. */
function segPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): { x: number; y: number } | null {
  const rx = b.x - a.x,
    ry = b.y - a.y,
    sx = d.x - c.x,
    sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + rx * t, y: a.y + ry * t };
}

/** Drop coincident vertices and vertices that sit on the straight line between their
 *  neighbours. Tolerances are geometric noise only (1e-6 cells = 4 microns) — unlike
 *  sanitizeCapPoly's 0.35-cell weld, this can never move the outline. */
function simplifyRing(
  pts: { x: number; y: number }[],
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  while (
    out.length > 1 &&
    Math.hypot(
      out[0]!.x - out[out.length - 1]!.x,
      out[0]!.y - out[out.length - 1]!.y,
    ) < 1e-6
  )
    out.pop();
  let dropped = true;
  while (dropped && out.length > 3) {
    dropped = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length]!,
        b = out[i]!,
        c = out[(i + 1) % out.length]!;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const base = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      if (Math.abs(area) / base < 1e-6) {
        out.splice(i, 1);
        dropped = true;
        break;
      }
    }
  }
  return out;
}

/** Build the cap outline for a zone as the EXACT union of the arm carriageways
 *  (operator directive, 2026-07-11: "find the sides of the road ends, and exactly draw
 *  it mathematically" — the convex hull over-covered, worst on merged zones).
 *
 *  ROAD.JUNCTION.CAP.1 (measured, seeds 4242/7/99/1234): the previous angular WALK over
 *  the arms only approximated that union. Whenever the true kerb-corner intersection was
 *  rejected — a near-duplicate arm pair, a corner past MOUTH_MAX, or the whole outline
 *  falling back to sanitizeCapPoly's CONVEX HULL — the boundary became a straight CHORD
 *  between two mouth corners, which cuts across the reflex kerb notch on the OUTSIDE.
 *  That chord is asphalt in the verge: 24 of 52 junctions overshot the carriageway edge,
 *  worst 2.006 cells (8.0 m) at seed 4242 zone 10. The chord also carried the cap's white
 *  kerb paint off the arm's edge line, which is the notch/jog the operator walked into.
 *
 *  So build the union DIRECTLY instead of walking towards it. Each arm is a rectangle
 *  (along in [-back, mouthD], |across| <= half); every rectangle contains the centre, so
 *  their union is star-shaped about it and is fully described by the radial function
 *  r(theta) = max over arms of the ray exit distance. The union boundary can only turn at
 *  a rectangle CORNER or at a rectangle-edge CROSSING, so evaluating r() at exactly those
 *  critical bearings and joining consecutive samples reproduces the union EXACTLY — every
 *  edge lies on a kerb line or a mouth cut, never on an invented chord. The result is
 *  generally NON-convex (the plus-shape's kerb corners are reflex). Mutates zone.poly. */
export function capPolygon(zone: JunctionZone): { x: number; y: number }[] {
  const { cx, cy } = zone;
  const arms = zone.arms;
  if (arms.length < 2) {
    zone.poly = [];
    return zone.poly;
  }
  const backs = arms.map((a) => armBack(arms, a));
  const rects = arms.map((a, i) => {
    const nx = -a.uy,
      ny = a.ux;
    const at = (along: number, across: number) => ({
      x: cx + a.ux * along + nx * across,
      y: cy + a.uy * along + ny * across,
    });
    return [
      at(-backs[i]!, -a.half),
      at(a.mouthD, -a.half),
      at(a.mouthD, a.half),
      at(-backs[i]!, a.half),
    ];
  });
  // Critical bearings: every rectangle corner, and every crossing of two rectangles'
  // edges. Extra bearings are harmless (they land mid-edge and simplifyRing drops them);
  // a MISSING one would round a corner off, so be generous.
  const bearings: number[] = [];
  const addBearing = (p: { x: number; y: number }) => {
    const dx = p.x - cx,
      dy = p.y - cy;
    if (dx * dx + dy * dy < 1e-18) return;
    bearings.push(Math.atan2(dy, dx));
  };
  for (const r of rects) for (const p of r) addBearing(p);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      for (let e = 0; e < 4; e++)
        for (let f = 0; f < 4; f++) {
          const p = segPoint(
            rects[i]![e]!,
            rects[i]![(e + 1) % 4]!,
            rects[j]![f]!,
            rects[j]![(f + 1) % 4]!,
          );
          if (p) addBearing(p);
        }
  bearings.sort((a, b) => a - b);
  const poly: { x: number; y: number }[] = [];
  let prev = -Infinity;
  for (const th of bearings) {
    if (th - prev < 1e-12) continue;
    prev = th;
    const dx = Math.cos(th),
      dy = Math.sin(th);
    let r = 0;
    for (let i = 0; i < arms.length; i++)
      r = Math.max(r, armRayExit(arms[i]!, backs[i]!, dx, dy));
    if (!Number.isFinite(r) || r <= 0) continue;
    poly.push({ x: cx + dx * r, y: cy + dy * r });
  }
  zone.poly = simplifyRing(poly);
  return zone.poly;
}

/** Do segments a-b and c-d properly cross (interiors intersect)? */
function segsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const rx = b.x - a.x,
    ry = b.y - a.y,
    sx = d.x - c.x,
    sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

/** Spec 137 cap-quality fix (operator: "intersections not perfect", "corners maybe
 *  inverted 90 degrees"). The exact carriageway-union walk is right for clean crossings,
 *  but a SHALLOW/degenerate junction — two near-parallel arms, an oblique cross where the
 *  mouth clamps at MOUTH_MAX — makes the kerb-corner intersections blow up into a
 *  self-crossing, near-duplicate-point polygon. `pointInPoly` then returns garbage (patchy
 *  paint suppression -> ragged edge lines), `capKerbLines` traces the self-crossing outline
 *  (the ragged white teeth), and `drapeCap`'s centre-fan inverts triangles (the messy cap).
 *  So: drop consecutive near-duplicate points, and if the outline still self-intersects,
 *  fall back to the CONVEX HULL of its points — always a clean simple CCW polygon. Only the
 *  broken degenerate cases take the hull; a valid plus-shape cross keeps its exact concave
 *  outline (its reflex kerb corners never self-cross), so the general-case geometry the
 *  spec-137 exact-union delivers is untouched.
 *
 *  ROAD.JUNCTION.CAP.1: capPolygon NO LONGER routes through this. The radial union it now
 *  builds is simple by construction, so the hull fallback could only ever fire wrongly —
 *  and when it did fire (measured: 24/52 junctions across 4 seeds) it replaced the reflex
 *  kerb notches with hull chords, i.e. the wedges of asphalt in the verge. Kept exported
 *  as the repair for any externally supplied outline; not part of the cap build path. */
export function sanitizeCapPoly(
  raw: { x: number; y: number }[],
): { x: number; y: number }[] {
  if (raw.length < 3) return raw;
  // 1. dedup consecutive (and wrap-around) near-duplicate vertices
  const dedup: { x: number; y: number }[] = [];
  for (const p of raw) {
    const last = dedup[dedup.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.35) continue;
    dedup.push(p);
  }
  while (
    dedup.length > 1 &&
    Math.hypot(
      dedup[0]!.x - dedup[dedup.length - 1]!.x,
      dedup[0]!.y - dedup[dedup.length - 1]!.y,
    ) < 0.35
  )
    dedup.pop();
  if (dedup.length < 3) return convexHull(raw);
  // 2. any non-adjacent edge pair crossing => self-intersecting => hull fallback
  const n = dedup.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent across the wrap seam
      if (
        segsCross(
          dedup[i]!,
          dedup[(i + 1) % n]!,
          dedup[j]!,
          dedup[(j + 1) % n]!,
        )
      )
        return convexHull(dedup);
    }
  }
  return dedup;
}

/** Attach cap polygons to every zone (idempotent). The React layer calls this once so
 *  paint suppression, coverage, foliage and the mesh share one footprint. */
export function attachCapPolys(zones: JunctionZone[]): JunctionZone[] {
  for (const z of zones) if (z.poly.length === 0) capPolygon(z);
  return zones;
}

/** Fan-triangulate the (possibly non-convex, star-shaped) polygon from the zone CENTRE
 *  and bisect until every edge <= maxEdge cells, so the drape follows the terrain at
 *  the ribbons' own station resolution. The exact-union outline is star-shaped around
 *  the crossing point by construction, so the centre fan is always valid. */
export function tessellate(
  poly: { x: number; y: number }[],
  centre: { x: number; y: number },
  maxEdge = 1.5,
): Array<
  [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
> {
  const c = centre;
  let tris: Array<
    [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ]
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
  for (const [a, b, c] of tessellate(poly, { x: zone.cx, y: zone.cy })) {
    out.push(
      opts.wx(a.x),
      y(a.x, a.y),
      opts.wz(a.y),
      opts.wx(b.x),
      y(b.x, b.y),
      opts.wz(b.y),
      opts.wx(c.x),
      y(c.x, c.y),
      opts.wz(c.y),
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
  out.push(...w[0]!, ...w[1]!, ...w[2]!, ...w[0]!, ...w[2]!, ...w[3]!);
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
          [
            sx + a.ux * (depth / 2) + px * sw,
            sy + a.uy * (depth / 2) + py * sw,
          ],
          [
            sx + a.ux * (depth / 2) - px * sw,
            sy + a.uy * (depth / 2) - py * sw,
          ],
          [
            sx - a.ux * (depth / 2) - px * sw,
            sy - a.uy * (depth / 2) - py * sw,
          ],
          [
            sx - a.ux * (depth / 2) + px * sw,
            sy - a.uy * (depth / 2) + py * sw,
          ],
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
        [
          bx + Lx * halfLen + a.ux * halfDepth,
          by + Ly * halfLen + a.uy * halfDepth,
        ],
        [
          bx - Lx * halfLen + a.ux * halfDepth,
          by - Ly * halfLen + a.uy * halfDepth,
        ],
        [
          bx - Lx * halfLen - a.ux * halfDepth,
          by - Ly * halfLen - a.uy * halfDepth,
        ],
        [
          bx + Lx * halfLen - a.ux * halfDepth,
          by + Ly * halfLen - a.uy * halfDepth,
        ],
      ],
      yOf,
      opts.wx,
      opts.wz,
    );
  }
}

/** One paintable run of the cap perimeter: the segment, the arm whose kerb it lies on,
 *  and how far INSIDE the kerb the white line must be laid so that it continues that
 *  arm's ribbon edge line without a sideways step. Pure — node-testable. */
export interface CapKerbSegment {
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Index into zone.arms of the arm whose kerb line this run follows. */
  arm: number;
  /** Inset from the perimeter towards the carriageway, in cells. */
  inset: number;
}

/** The perimeter runs that carry kerb paint, with the inset that makes each run COLLINEAR
 *  with its arm's ribbon edge line.
 *
 *  ROAD.JUNCTION.CAP.1: the strip used to be laid hard against the perimeter (from 0.018
 *  cells outside it to 0.09 inside), i.e. at ~half - 0.036 from the arm axis, while
 *  roadRibbon.edgeLines paints at edgeLineOffset(half) = half - 0.3. Every arm mouth
 *  therefore had a 0.264-cell (1.06 m) sideways JOG in the white line. Inset by
 *  half - edgeLineOffset(half) instead and the two lines are one straight line. */
export function capKerbPaintSegments(zone: JunctionZone): CapKerbSegment[] {
  const poly = zone.poly;
  const segs: CapKerbSegment[] = [];
  if (poly.length < 3 || zone.arms.length === 0) return segs;
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
    // Which arm's kerb is this run on? The one whose lateral distance at the midpoint is
    // closest to its own half-width. Every perimeter edge of the exact union lies on some
    // arm's kerb line or on a mouth cut (mouth cuts are dropped above).
    let arm = -1,
      bestErr = Infinity;
    for (let k = 0; k < zone.arms.length; k++) {
      const q = zone.arms[k]!;
      const rx = mx - zone.cx,
        ry = my - zone.cy;
      const err = Math.abs(Math.abs(rx * -q.uy + ry * q.ux) - q.half);
      if (err < bestErr) {
        bestErr = err;
        arm = k;
      }
    }
    if (arm < 0 || bestErr > 1e-6) continue; // not a kerb run — never invent paint
    const half = zone.arms[arm]!.half;
    segs.push({ a, b, arm, inset: half - edgeLineOffset(half) });
  }
  return segs;
}

/** Kerb-line paint: a thin white strip along the cap perimeter between crosswalk mouths,
 *  closing the junction visually from first person and continuing each arm's painted edge
 *  line straight across its mouth. */
export function capKerbLines(
  zone: JunctionZone,
  opts: CapBuildOptions,
  out: number[],
): void {
  const yOf = (x: number, y: number) =>
    Math.max(0, opts.roadY(x, y)) + CAP_PAINT_LIFT - 0.005;
  const w = EDGE_LINE_HALF_WIDTH;
  for (const seg of capKerbPaintSegments(zone)) {
    const { a, b, inset } = seg;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    if (!cellOk(opts.terrain, mx, my)) continue;
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    const nx = -ey / len,
      ny = ex / len; // inward normal (CCW outline)
    const inner = inset + w,
      outer = inset - w;
    quad(
      out,
      [
        [a.x + nx * inner, a.y + ny * inner],
        [b.x + nx * inner, b.y + ny * inner],
        [b.x + nx * outer, b.y + ny * outer],
        [a.x + nx * outer, a.y + ny * outer],
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
        if (!nearPoly(x, y, poly, 0.5)) continue;
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

/** Build everything mesh-shaped for all zones. Adjacent zones (un-merged twins on one
 *  road) get a per-zone micro-lift (0/4/8 mm cycle) so their exact pads overlap along
 *  the shared carriageway without depth-coincidence — the seam is invisible at paint
 *  thickness, and the union of the two honest pads IS the correct tarmac shape. */
export function buildJunctionCaps(
  zones: JunctionZone[],
  opts: CapBuildOptions,
): JunctionCapsBuild {
  attachCapPolys(zones);
  const surf: number[] = [];
  const paint: number[] = [];
  zones.forEach((z, zi) => {
    const lift = (zi % 3) * 0.004;
    const zOpts: CapBuildOptions = {
      ...opts,
      roadY: (x, y) => opts.roadY(x, y) + lift,
    };
    drapeCap(z, zOpts, surf);
    capCrosswalks(z, zOpts, paint);
    capStopBars(z, zOpts, paint);
    capKerbLines(z, zOpts, paint);
  });
  return { surf, paint };
}
