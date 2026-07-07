import * as THREE from "three";
import type { Terrain } from "../terrain";
import { Biome } from "../terrain";

// Spec 088 — SMOOTH ROAD RIBBONS. The roads are stored + driven as per-cell grid data (for traffic,
// the bus and the rally), but rendering one axis-aligned square per cell makes every non-straight road
// a sawtooth staircase. This builds a smooth ribbon mesh along each road's CENTRE-LINE instead:
// Chaikin-smooth the polyline, then extrude a constant width perpendicular to it, draped on the
// terrain, with a dashed centre line. Laid just above the cell roads so it reads as the road surface
// and hides the jagged cell edges underneath. Pure geometry from the inputs — no clock, no random.

export interface RoadWay {
  /** The road centre-line cells (a polyline). */
  path: { x: number; y: number }[];
  kind: "avenue" | "street";
  /** Carriageway width in cells. */
  width: number;
}

export interface RoadRibbonOptions {
  terrain: Terrain;
  wx: (x: number) => number;
  wz: (y: number) => number;
  roadY: (x: number, y: number) => number; // smoothed road height
}

/** How high the ribbon surface sits above the terrain. Exported so avatars/citizens stand ON the road
 *  surface (not the bare terrain) when they're on a road cell — else they sink under the raised ribbon. */
export const ROAD_RIBBON_LIFT = 0.18;

function roadSurfaceCellOk(
  opts: RoadRibbonOptions,
  x: number,
  y: number,
): boolean {
  const gx = Math.round(x),
    gy = Math.round(y);
  if (!opts.terrain.inBounds(gx, gy)) return false;
  const i = opts.terrain.idx(gx, gy);
  return (
    opts.terrain.biome[i] !== Biome.Ocean && opts.terrain.buildable[i] !== 0
  );
}

function roadCrossSectionOk(
  pts: { x: number; y: number }[],
  i: number,
  half: number,
  opts: RoadRibbonOptions,
): boolean {
  const p = pts[i]!;
  const prev = pts[Math.max(0, i - 1)]!,
    next = pts[Math.min(pts.length - 1, i + 1)]!;
  const tx = next.x - prev.x,
    ty = next.y - prev.y;
  const len = Math.hypot(tx, ty) || 1;
  const px = -ty / len,
    py = tx / len;
  for (let k = -half; k <= half + 1e-6; k += 0.5)
    if (!roadSurfaceCellOk(opts, p.x + px * k, p.y + py * k)) return false;
  return true;
}

/** Build the smooth draped ribbons (+ dashed centre lines) for every road way. Returns the group and
 *  the SET of grid cells the ribbon actually covers — so avatars stand on the ribbon surface only
 *  where it really is (never floating on a road cell the ribbon happens not to reach). */
export function buildRoadRibbons(
  ways: RoadWay[],
  opts: RoadRibbonOptions,
): { group: THREE.Group; cells: Set<string> } {
  const group = new THREE.Group();
  group.name = "RoadRibbons";
  const cells = new Set<string>();
  // ALL road materials are DoubleSide. The ribbon/edge/dash triangle winding depends on the road's
  // travel direction, so a road running one way has its surface normals point UP and a road running the
  // other way points them DOWN — single-sided faces on the latter were back-face-culled from the
  // overhead camera, leaving only bare dashes floating on the dirt (the operator's "still buggy" roads).
  // DoubleSide draws both faces, so every road shows its full grey surface, white edges and centre line
  // regardless of which way it runs. (Draped flat on the ground, the underside is never seen anyway.)
  const streetMat = new THREE.MeshStandardMaterial({
    color: 0x595f6a,
    roughness: 0.92,
    metalness: 0.02,
    side: THREE.DoubleSide,
  }); // mid asphalt grey — reads as road, not a black hole
  const avenueMat = new THREE.MeshStandardMaterial({
    color: 0x646b78,
    roughness: 0.9,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const dashMat = new THREE.MeshStandardMaterial({
    color: 0xf2cf52,
    roughness: 0.5,
    emissive: 0xf2cf52,
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  }); // bright lane line, glows a little day + night
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0xe8ecf2,
    roughness: 0.6,
    emissive: 0xb9c0cc,
    emissiveIntensity: 0.28,
    side: THREE.DoubleSide,
  }); // painted white road edges
  const surf: number[] = [];
  const surfA: number[] = [];
  const dash: number[] = [];
  const edge: number[] = [];
  // Cache each way's smoothed + densified centre-line (used for the ribbon AND intersection detection).
  // Densify to ~1.5-cell stations AFTER smoothing: a string-pulled centre-line can be a few points across
  // ~120 cells, so chaikin leaves segments up to ~30 cells long, and the ribbon's one flat quad per
  // segment dives underground mid-span on a slope (the dash-only gaps). Short stations drape the terrain.
  const paths = ways.map((w) =>
    w.path.length >= 2 ? densify(chaikin(w.path, 2), 1.5) : null,
  );
  // INTERSECTIONS. Each ribbon is independent, so where two roads cross, both roads' white edges and
  // centre dashes run straight THROUGH the crossing and it reads as a messy plaid (the operator's
  // "messed up" junctions). A cell where 2+ distinct ways' centre-lines pass is a junction; the painted
  // markings must BREAK around it. We dilate those cells and suppress edge/dash quads inside the zone —
  // the asphalt SURFACE still fills the junction (open tarmac), only the lines stop short, as on real roads.
  const cellWays = new Map<string, Set<number>>();
  paths.forEach((cp, wi) => {
    if (!cp) return;
    // record each centre-line cell DILATED by 1, so two ways that pass within ~2 cells of each other
    // (a crossing, a T-junction, or a connector ending just off another road) register as a shared cell.
    for (const p of cp) {
      const cx = Math.round(p.x),
        cy = Math.round(p.y);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const k = `${cx + dx},${cy + dy}`;
          let s = cellWays.get(k);
          if (!s) {
            s = new Set();
            cellWays.set(k, s);
          }
          s.add(wi);
        }
    }
  });
  const junction = new Set<string>();
  const JR = 1; // how far back from a crossing the painted lines stop
  for (const [k, s] of cellWays)
    if (s.size >= 2) {
      const [x, y] = k.split(",").map(Number);
      for (let dx = -JR; dx <= JR; dx++)
        for (let dy = -JR; dy <= JR; dy++) junction.add(`${x + dx},${y + dy}`);
    }
  const nearJunction = (x: number, y: number) =>
    junction.has(`${Math.round(x)},${Math.round(y)}`);
  const skipPaint = (x: number, y: number) =>
    nearJunction(x, y) || !roadSurfaceCellOk(opts, x, y);
  // Junctions need no flatten or slab. Every ribbon vertex takes its height from its OWN position
  // (smoothRoadY, in ribbon() below), so where two roads overlap at a crossing both surfaces evaluate the
  // same height at the same point — they are COPLANAR by construction, following the terrain. So a junction
  // is just open coplanar asphalt; we only break the painted markings (above) so the lines don't criss-cross.
  for (let wi = 0; wi < ways.length; wi++) {
    const pts = paths[wi];
    if (!pts) continue;
    const way = ways[wi]!;
    ribbon(
      pts,
      way.width / 2,
      opts,
      way.kind === "avenue" ? surfA : surf,
      cells,
    );
    dashes(pts, opts, dash, skipPaint);
    edgeLines(pts, way.width / 2, opts, edge, skipPaint);
    crosswalks(pts, way.width / 2, opts, edge, nearJunction, skipPaint);
  }
  const add = (arr: number[], mat: THREE.Material) => {
    if (arr.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  add(surf, streetMat);
  add(surfA, avenueMat);
  add(edge, edgeMat);
  add(dash, dashMat);
  return { group, cells };
}

/** Corner-cutting smoothing: each iteration replaces every segment with its 1/4 and 3/4 points, so
 *  staircases round off into smooth curves. Endpoints are kept. */
function chaikin(
  path: { x: number; y: number }[],
  iterations: number,
): { x: number; y: number }[] {
  let pts = path.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iterations; it++) {
    const out: { x: number; y: number }[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!,
        b = pts[i + 1]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

/** Insert points along a polyline so no segment is longer than `step`. Keeps the surface stations close
 *  enough together that each flat quad hugs the terrain (so a long string-pulled segment can't span
 *  underground). Endpoints + original vertices are preserved. */
function densify(
  pts: { x: number; y: number }[],
  step: number,
): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const out: { x: number; y: number }[] = [pts[0]!];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!,
      b = pts[i + 1]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let s = 1; s <= n; s++)
      out.push({
        x: a.x + (b.x - a.x) * (s / n),
        y: a.y + (b.y - a.y) * (s / n),
      });
  }
  return out;
}

/** Extrude a triangle strip of half-width `half` perpendicular to the smoothed polyline, draped on the
 *  terrain at each cross-section. */
function ribbon(
  pts: { x: number; y: number }[],
  half: number,
  opts: RoadRibbonOptions,
  out: number[],
  cells: Set<string>,
): void {
  const edge = (i: number, sign: number): number[] => {
    const p = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!,
      next = pts[Math.min(pts.length - 1, i + 1)]!;
    const tx = next.x - prev.x,
      ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    const px = -ty / len,
      py = tx / len; // unit perpendicular
    // record every grid cell across the cross-section so surfaceY knows where the ribbon really is.
    // Spec 115 guard: only record cells that the ribbon is actually allowed to render on.
    for (let k = -half; k <= half + 1e-6; k += 0.5) {
      const gx = p.x + px * k,
        gy = p.y + py * k;
      if (roadSurfaceCellOk(opts, gx, gy))
        cells.add(`${Math.round(gx)},${Math.round(gy)}`);
    }
    const gx = p.x + px * half * sign,
      gy = p.y + py * half * sign;
    // Height from this VERTEX's own position (continuous, terrain-following). Two ribbons overlapping at a
    // junction therefore sit at the same height there — coplanar, no lips/seams — and the cross-section
    // gently follows the terrain's cross-slope instead of forcing a level plank that floats on a hillside.
    const h = Math.max(0, opts.roadY(gx, gy)) + ROAD_RIBBON_LIFT;
    return [opts.wx(gx), h, opts.wz(gy)];
  };
  const segmentOk = (i: number): boolean => {
    for (const f of [0, 0.5, 1] as const) {
      const sample = {
        x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * f,
        y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * f,
      };
      if (!roadCrossSectionOk([sample], 0, half, opts)) return false;
    }
    return true;
  };
  const tri = (a: number[], b: number[], c: number[]) =>
    out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
  for (let i = 0; i < pts.length - 1; i++) {
    if (!segmentOk(i)) continue;
    const aL = edge(i, -1),
      aR = edge(i, 1),
      bL = edge(i + 1, -1),
      bR = edge(i + 1, 1);
    tri(aL, aR, bL);
    tri(bL, aR, bR);
  }
}

/** Continuous painted EDGE LINES just inside both kerbs of the ribbon, so the carriageway reads
 *  unmistakably as a marked road (white edges + yellow centre dashes) instead of a bare grey band. */
function edgeLines(
  pts: { x: number; y: number }[],
  half: number,
  opts: RoadRibbonOptions,
  out: number[],
  skip: (x: number, y: number) => boolean,
): void {
  const tri = (a: number[], b: number[], c: number[]) =>
    out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
  const off = Math.max(0.3, half - 0.3); // sit just inside the carriageway edge
  const w = 0.09; // painted line half-width
  // world points at a station for a signed centre offset `c`, spanning c-w .. c+w across the road
  const at = (i: number, c: number): [number[], number[]] => {
    const p = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!,
      next = pts[Math.min(pts.length - 1, i + 1)]!;
    const tx = next.x - prev.x,
      ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    const px = -ty / len,
      py = tx / len;
    const lx = p.x + px * c,
      ly = p.y + py * c; // the edge line's own position across the road
    const y = Math.max(0, opts.roadY(lx, ly)) + ROAD_RIBBON_LIFT + 0.05; // sit on the per-position surface
    const inX = p.x + px * (c - w),
      inY = p.y + py * (c - w);
    const ouX = p.x + px * (c + w),
      ouY = p.y + py * (c + w);
    return [
      [opts.wx(inX), y, opts.wz(inY)],
      [opts.wx(ouX), y, opts.wz(ouY)],
    ];
  };
  for (const sign of [-1, 1]) {
    const c = sign * off;
    for (let i = 0; i < pts.length - 1; i++) {
      if (skip(pts[i]!.x, pts[i]!.y) || skip(pts[i + 1]!.x, pts[i + 1]!.y))
        continue; // break the edge line at junctions
      const [aIn, aOut] = at(i, c),
        [bIn, bOut] = at(i + 1, c);
      tri(aIn, aOut, bIn);
      tri(bIn, aOut, bOut);
    }
  }
}

/** Clean uniform centre-line dashes. Parameterise the smoothed polyline by ARC LENGTH and lay one tidy
 *  quad per dash at a fixed period, so the dashes are evenly spaced and the same size everywhere (the
 *  old version stamped overlapping quads every 0.4 along each raw segment, which merged into uneven
 *  blobs of different sizes — the messy centre line the operator saw up close). */
function dashes(
  pts: { x: number; y: number }[],
  opts: RoadRibbonOptions,
  out: number[],
  skip: (x: number, y: number) => boolean,
): void {
  const tri = (a: number[], b: number[], c: number[]) =>
    out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
  // cumulative arc length at each vertex
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++)
    cum.push(
      cum[i]! +
        Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y),
    );
  const total = cum[cum.length - 1]!;
  if (total < 1) return;
  // position + unit tangent at arc length t
  const sample = (
    t: number,
  ): { x: number; y: number; tx: number; ty: number } => {
    t = Math.max(0, Math.min(total, t));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1]! < t) i++;
    const a = pts[i]!,
      b = pts[i + 1]!;
    const segLen = cum[i + 1]! - cum[i]! || 1;
    const f = (t - cum[i]!) / segLen;
    let tx = b.x - a.x,
      ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      tx: tx / l,
      ty: ty / l,
    };
  };
  const PERIOD = 2.4; // dash centre-to-centre spacing
  const LEN = 1.2; // painted dash length
  const w = 0.16; // dash half-width across the road
  const yOf = (x: number, y: number) =>
    Math.max(0, opts.roadY(x, y)) + ROAD_RIBBON_LIFT + 0.06;
  for (let t = (total % PERIOD) / 2 + 0.3; t + LEN <= total; t += PERIOD) {
    const s0 = sample(t),
      s1 = sample(t + LEN);
    if (skip(s0.x, s0.y) || skip(s1.x, s1.y)) continue; // break the centre line at junctions/unsafe terrain
    const p0x = -s0.ty * w,
      p0y = s0.tx * w,
      p1x = -s1.ty * w,
      p1y = s1.tx * w;
    const y0 = yOf(s0.x, s0.y),
      y1 = yOf(s1.x, s1.y);
    const aL = [opts.wx(s0.x + p0x), y0, opts.wz(s0.y + p0y)];
    const aR = [opts.wx(s0.x - p0x), y0, opts.wz(s0.y - p0y)];
    const bL = [opts.wx(s1.x + p1x), y1, opts.wz(s1.y + p1y)];
    const bR = [opts.wx(s1.x - p1x), y1, opts.wz(s1.y - p1y)];
    tri(aL, aR, bL);
    tri(bL, aR, bR);
  }
}

/** Spec 092 — ZEBRA CROSSINGS at each junction arm. The open-tarmac junction read as a plain grey blob;
 *  a band of white stripes where each road meets the junction defines it as a real intersection. We walk
 *  the centre-line by arc length, find where it crosses the junction boundary (in <-> out), and lay a
 *  band of stripes (parallel to traffic, spaced across the carriageway) on the approach just outside the
 *  junction. Emitted into the white edge array. */
function crosswalks(
  pts: { x: number; y: number }[],
  half: number,
  opts: RoadRibbonOptions,
  out: number[],
  near: (x: number, y: number) => boolean,
  skip: (x: number, y: number) => boolean,
): void {
  const tri = (a: number[], b: number[], c: number[]) =>
    out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++)
    cum.push(
      cum[i]! +
        Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y),
    );
  const total = cum[cum.length - 1]!;
  if (total < 2) return;
  const sample = (t: number) => {
    t = Math.max(0, Math.min(total, t));
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1]! < t) i++;
    const a = pts[i]!,
      b = pts[i + 1]!;
    const f = (t - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
    const tx = b.x - a.x,
      ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      tx: tx / l,
      ty: ty / l,
    };
  };
  // boundary arc lengths: where the centre-line crosses into/out of a junction zone
  const STEP = 0.5;
  const bands: number[] = [];
  let prev = near(pts[0]!.x, pts[0]!.y);
  for (let t = STEP; t <= total; t += STEP) {
    const s = sample(t);
    const inj = near(s.x, s.y);
    if (inj !== prev) bands.push(inj ? t - STEP : t); // approach point just OUTSIDE the junction
    prev = inj;
  }
  const yOf = (x: number, y: number) =>
    Math.max(0, opts.roadY(x, y)) + ROAD_RIBBON_LIFT + 0.055;
  const K = 5; // stripes across the carriageway
  const depth = 1.3; // band depth along the road
  const sw = 0.16; // stripe half-width across the road
  const span = half * 0.82; // half the across-extent the stripes cover
  for (const bt of bands) {
    const s = sample(bt);
    if (skip(s.x, s.y)) continue;
    const tx = s.tx,
      ty = s.ty;
    const nx = -ty,
      ny = tx; // unit normal across the road
    for (let k = 0; k < K; k++) {
      const ca = (k / (K - 1) - 0.5) * 2 * span; // centre offset across the road
      const cx = s.x + nx * ca,
        cy = s.y + ny * ca;
      const corners: [number, number][] = [
        [cx + tx * (depth / 2) + nx * sw, cy + ty * (depth / 2) + ny * sw],
        [cx + tx * (depth / 2) - nx * sw, cy + ty * (depth / 2) - ny * sw],
        [cx - tx * (depth / 2) - nx * sw, cy - ty * (depth / 2) - ny * sw],
        [cx - tx * (depth / 2) + nx * sw, cy - ty * (depth / 2) + ny * sw],
      ];
      if (corners.some(([gx, gy]) => skip(gx, gy))) continue;
      const w3 = corners.map(([gx, gy]) => [
        opts.wx(gx),
        yOf(gx, gy),
        opts.wz(gy),
      ]);
      tri(w3[0]!, w3[1]!, w3[2]!);
      tri(w3[0]!, w3[2]!, w3[3]!);
    }
  }
}
