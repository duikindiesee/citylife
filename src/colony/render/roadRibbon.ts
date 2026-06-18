import * as THREE from 'three'
import type { Terrain } from '../terrain'

// Spec 088 — SMOOTH ROAD RIBBONS. The roads are stored + driven as per-cell grid data (for traffic,
// the bus and the rally), but rendering one axis-aligned square per cell makes every non-straight road
// a sawtooth staircase. This builds a smooth ribbon mesh along each road's CENTRE-LINE instead:
// Chaikin-smooth the polyline, then extrude a constant width perpendicular to it, draped on the
// terrain, with a dashed centre line. Laid just above the cell roads so it reads as the road surface
// and hides the jagged cell edges underneath. Pure geometry from the inputs — no clock, no random.

export interface RoadWay {
  /** The road centre-line cells (a polyline). */
  path: { x: number; y: number }[]
  kind: 'avenue' | 'street'
  /** Carriageway width in cells. */
  width: number
}

export interface RoadRibbonOptions {
  terrain: Terrain
  wx: (x: number) => number
  wz: (y: number) => number
  roadY: (x: number, y: number) => number // smoothed road height
}

/** How high the ribbon surface sits above the terrain. Exported so avatars/citizens stand ON the road
 *  surface (not the bare terrain) when they're on a road cell — else they sink under the raised ribbon. */
export const ROAD_RIBBON_LIFT = 0.18

/** Build the smooth draped ribbons (+ dashed centre lines) for every road way. Returns the group and
 *  the SET of grid cells the ribbon actually covers — so avatars stand on the ribbon surface only
 *  where it really is (never floating on a road cell the ribbon happens not to reach). */
export function buildRoadRibbons(ways: RoadWay[], opts: RoadRibbonOptions): { group: THREE.Group; cells: Set<string> } {
  const group = new THREE.Group()
  group.name = 'RoadRibbons'
  const cells = new Set<string>()
  // ALL road materials are DoubleSide. The ribbon/edge/dash triangle winding depends on the road's
  // travel direction, so a road running one way has its surface normals point UP and a road running the
  // other way points them DOWN — single-sided faces on the latter were back-face-culled from the
  // overhead camera, leaving only bare dashes floating on the dirt (the operator's "still buggy" roads).
  // DoubleSide draws both faces, so every road shows its full grey surface, white edges and centre line
  // regardless of which way it runs. (Draped flat on the ground, the underside is never seen anyway.)
  const streetMat = new THREE.MeshStandardMaterial({ color: 0x595f6a, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide }) // mid asphalt grey — reads as road, not a black hole
  const avenueMat = new THREE.MeshStandardMaterial({ color: 0x646b78, roughness: 0.9, metalness: 0.03, side: THREE.DoubleSide })
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf2cf52, roughness: 0.5, emissive: 0xf2cf52, emissiveIntensity: 0.5, side: THREE.DoubleSide }) // bright lane line, glows a little day + night
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.6, emissive: 0xb9c0cc, emissiveIntensity: 0.28, side: THREE.DoubleSide }) // painted white road edges
  const surf: number[] = []
  const surfA: number[] = []
  const dash: number[] = []
  const edge: number[] = []
  for (const way of ways) {
    if (way.path.length < 2) continue
    // Densify to ~1.5-cell stations AFTER smoothing. A string-pulled centre-line can be just a few points
    // spanning ~120 cells, so chaikin leaves segments up to ~30 cells long. The ribbon draws one FLAT
    // quad per segment, so a long quad on a slope dives underground in the middle and the terrain buries
    // the surface there — leaving only the (densely-sampled) dashes visible (the operator's dash-only
    // gaps). Short stations make the surface drape the terrain step by step so it never spans below ground.
    const pts = densify(chaikin(way.path, 2), 1.5)
    ribbon(pts, way.width / 2, opts, way.kind === 'avenue' ? surfA : surf, cells)
    dashes(pts, opts, dash)
    edgeLines(pts, way.width / 2, opts, edge)
  }
  const add = (arr: number[], mat: THREE.Material) => {
    if (arr.length === 0) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
  }
  add(surf, streetMat)
  add(surfA, avenueMat)
  add(edge, edgeMat)
  add(dash, dashMat)
  return { group, cells }
}

/** Corner-cutting smoothing: each iteration replaces every segment with its 1/4 and 3/4 points, so
 *  staircases round off into smooth curves. Endpoints are kept. */
function chaikin(path: { x: number; y: number }[], iterations: number): { x: number; y: number }[] {
  let pts = path.map((p) => ({ x: p.x, y: p.y }))
  for (let it = 0; it < iterations; it++) {
    const out: { x: number; y: number }[] = [pts[0]!]
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    out.push(pts[pts.length - 1]!)
    pts = out
  }
  return pts
}

/** Insert points along a polyline so no segment is longer than `step`. Keeps the surface stations close
 *  enough together that each flat quad hugs the terrain (so a long string-pulled segment can't span
 *  underground). Endpoints + original vertices are preserved. */
function densify(pts: { x: number; y: number }[], step: number): { x: number; y: number }[] {
  if (pts.length < 2) return pts
  const out: { x: number; y: number }[] = [pts[0]!]
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(d / step))
    for (let s = 1; s <= n; s++) out.push({ x: a.x + (b.x - a.x) * (s / n), y: a.y + (b.y - a.y) * (s / n) })
  }
  return out
}

/** Extrude a triangle strip of half-width `half` perpendicular to the smoothed polyline, draped on the
 *  terrain at each cross-section. */
function ribbon(pts: { x: number; y: number }[], half: number, opts: RoadRibbonOptions, out: number[], cells: Set<string>): void {
  const edge = (i: number, sign: number): number[] => {
    const p = pts[i]!
    const prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!
    const tx = next.x - prev.x, ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const px = -ty / len, py = tx / len // unit perpendicular
    // record every grid cell across the cross-section so surfaceY knows where the ribbon really is
    for (let k = -half; k <= half + 1e-6; k += 0.5) cells.add(`${Math.round(p.x + px * k)},${Math.round(p.y + py * k)}`)
    const gx = p.x + px * half * sign, gy = p.y + py * half * sign
    return [opts.wx(gx), Math.max(0, opts.roadY(Math.round(p.x), Math.round(p.y))) + ROAD_RIBBON_LIFT, opts.wz(gy)]
  }
  const tri = (a: number[], b: number[], c: number[]) => out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  for (let i = 0; i < pts.length - 1; i++) {
    const aL = edge(i, -1), aR = edge(i, 1), bL = edge(i + 1, -1), bR = edge(i + 1, 1)
    tri(aL, aR, bL)
    tri(bL, aR, bR)
  }
}

/** Continuous painted EDGE LINES just inside both kerbs of the ribbon, so the carriageway reads
 *  unmistakably as a marked road (white edges + yellow centre dashes) instead of a bare grey band. */
function edgeLines(pts: { x: number; y: number }[], half: number, opts: RoadRibbonOptions, out: number[]): void {
  const tri = (a: number[], b: number[], c: number[]) => out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  const off = Math.max(0.3, half - 0.3) // sit just inside the carriageway edge
  const w = 0.09 // painted line half-width
  // world points at a station for a signed centre offset `c`, spanning c-w .. c+w across the road
  const at = (i: number, c: number): [number[], number[]] => {
    const p = pts[i]!
    const prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!
    const tx = next.x - prev.x, ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const px = -ty / len, py = tx / len
    const y = Math.max(0, opts.roadY(Math.round(p.x), Math.round(p.y))) + ROAD_RIBBON_LIFT + 0.05
    const inX = p.x + px * (c - w), inY = p.y + py * (c - w)
    const ouX = p.x + px * (c + w), ouY = p.y + py * (c + w)
    return [[opts.wx(inX), y, opts.wz(inY)], [opts.wx(ouX), y, opts.wz(ouY)]]
  }
  for (const sign of [-1, 1]) {
    const c = sign * off
    for (let i = 0; i < pts.length - 1; i++) {
      const [aIn, aOut] = at(i, c), [bIn, bOut] = at(i + 1, c)
      tri(aIn, aOut, bIn); tri(bIn, aOut, bOut)
    }
  }
}

/** Clean uniform centre-line dashes. Parameterise the smoothed polyline by ARC LENGTH and lay one tidy
 *  quad per dash at a fixed period, so the dashes are evenly spaced and the same size everywhere (the
 *  old version stamped overlapping quads every 0.4 along each raw segment, which merged into uneven
 *  blobs of different sizes — the messy centre line the operator saw up close). */
function dashes(pts: { x: number; y: number }[], opts: RoadRibbonOptions, out: number[]): void {
  const tri = (a: number[], b: number[], c: number[]) => out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  // cumulative arc length at each vertex
  const cum = [0]
  for (let i = 0; i < pts.length - 1; i++) cum.push(cum[i]! + Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y))
  const total = cum[cum.length - 1]!
  if (total < 1) return
  // position + unit tangent at arc length t
  const sample = (t: number): { x: number; y: number; tx: number; ty: number } => {
    t = Math.max(0, Math.min(total, t))
    let i = 0
    while (i < cum.length - 2 && cum[i + 1]! < t) i++
    const a = pts[i]!, b = pts[i + 1]!
    const segLen = (cum[i + 1]! - cum[i]!) || 1
    const f = (t - cum[i]!) / segLen
    let tx = b.x - a.x, ty = b.y - a.y
    const l = Math.hypot(tx, ty) || 1
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: tx / l, ty: ty / l }
  }
  const PERIOD = 2.4 // dash centre-to-centre spacing
  const LEN = 1.2 // painted dash length
  const w = 0.16 // dash half-width across the road
  const yOf = (x: number, y: number) => Math.max(0, opts.roadY(Math.round(x), Math.round(y))) + ROAD_RIBBON_LIFT + 0.06
  for (let t = (total % PERIOD) / 2 + 0.3; t + LEN <= total; t += PERIOD) {
    const s0 = sample(t), s1 = sample(t + LEN)
    const p0x = -s0.ty * w, p0y = s0.tx * w, p1x = -s1.ty * w, p1y = s1.tx * w
    const y0 = yOf(s0.x, s0.y), y1 = yOf(s1.x, s1.y)
    const aL = [opts.wx(s0.x + p0x), y0, opts.wz(s0.y + p0y)]
    const aR = [opts.wx(s0.x - p0x), y0, opts.wz(s0.y - p0y)]
    const bL = [opts.wx(s1.x + p1x), y1, opts.wz(s1.y + p1y)]
    const bR = [opts.wx(s1.x - p1x), y1, opts.wz(s1.y - p1y)]
    tri(aL, aR, bL); tri(bL, aR, bR)
  }
}
