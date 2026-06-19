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
  const junctionMat = new THREE.MeshStandardMaterial({ color: 0x5f656f, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide }) // junction apron — mid grey, blends street + avenue
  const surf: number[] = []
  const surfA: number[] = []
  const dash: number[] = []
  const edge: number[] = []
  // Cache each way's smoothed + densified centre-line (used for the ribbon AND intersection detection).
  // Densify to ~1.5-cell stations AFTER smoothing: a string-pulled centre-line can be a few points across
  // ~120 cells, so chaikin leaves segments up to ~30 cells long, and the ribbon's one flat quad per
  // segment dives underground mid-span on a slope (the dash-only gaps). Short stations drape the terrain.
  const paths = ways.map((w) => (w.path.length >= 2 ? densify(chaikin(w.path, 2), 1.5) : null))
  // INTERSECTIONS. Each ribbon is independent, so where two roads cross, both roads' white edges and
  // centre dashes run straight THROUGH the crossing and it reads as a messy plaid (the operator's
  // "messed up" junctions). A cell where 2+ distinct ways' centre-lines pass is a junction; the painted
  // markings must BREAK around it. We dilate those cells and suppress edge/dash quads inside the zone —
  // the asphalt SURFACE still fills the junction (open tarmac), only the lines stop short, as on real roads.
  const cellWays = new Map<string, Set<number>>()
  paths.forEach((cp, wi) => {
    if (!cp) return
    // record each centre-line cell DILATED by 1, so two ways that pass within ~2 cells of each other
    // (a crossing, a T-junction, or a connector ending just off another road) register as a shared cell.
    for (const p of cp) { const cx = Math.round(p.x), cy = Math.round(p.y); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = `${cx + dx},${cy + dy}`; let s = cellWays.get(k); if (!s) { s = new Set(); cellWays.set(k, s) } s.add(wi) } }
  })
  const junction = new Set<string>()
  const JR = 3 // how far back from a crossing the painted lines stop
  for (const [k, s] of cellWays) if (s.size >= 2) { const [x, y] = k.split(',').map(Number); for (let dx = -JR; dx <= JR; dx++) for (let dy = -JR; dy <= JR; dy++) junction.add(`${x + dx},${y + dy}`) }
  const nearJunction = (x: number, y: number) => junction.has(`${Math.round(x)},${Math.round(y)}`)
  // FLATTEN each junction to one shared height. The ribbons of the meeting roads overlap in the junction,
  // but each takes its height from its own centre-line, so they sat at slightly different heights and the
  // junction was a lumpy patchwork of lips + seams (one ramp riding over another). Flood-fill the junction
  // cells into connected clusters and give each cluster a single consensus height (the max road height in
  // it, so no arm pokes above); any surface vertex in the cluster snaps to that height, so the overlapping
  // surfaces become COPLANAR — a clean flat junction slab the road arms ramp onto.
  const clusterId = new Map<string, number>()
  const clusterCells: string[][] = []
  {
    const visited = new Set<string>()
    for (const start of junction) {
      if (visited.has(start)) continue
      const id = clusterCells.length
      const comp: string[] = []
      const q = [start]; visited.add(start)
      for (let head = 0; head < q.length; head++) {
        const cell = q[head]!; comp.push(cell); clusterId.set(cell, id)
        const [x, y] = cell.split(',').map(Number) as [number, number]
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nk = `${x + dx},${y + dy}`; if (junction.has(nk) && !visited.has(nk)) { visited.add(nk); q.push(nk) } }
      }
      clusterCells.push(comp)
    }
  }
  const clusterH = clusterCells.map((comp) => { let H = 0; for (const cell of comp) { const [x, y] = cell.split(',').map(Number) as [number, number]; const h = Math.max(0, opts.roadY(x, y)); if (h > H) H = h } return H + ROAD_RIBBON_LIFT })
  const clusterIdAt = (x: number, y: number): number => clusterId.get(`${Math.round(x)},${Math.round(y)}`) ?? -1
  const junctionY = (x: number, y: number): number => { const id = clusterIdAt(x, y); return id >= 0 ? clusterH[id]! : -1 }
  for (let wi = 0; wi < ways.length; wi++) {
    const pts = paths[wi]
    if (!pts) continue
    const way = ways[wi]!
    ribbon(pts, way.width / 2, opts, way.kind === 'avenue' ? surfA : surf, cells, junctionY)
    dashes(pts, opts, dash, nearJunction)
    edgeLines(pts, way.width / 2, opts, edge, nearJunction)
  }
  // JUNCTION SLABS. Even flattened, the meeting ribbons overlap with different triangulation, leaving
  // faint faceted seams. Lay ONE flat polygon over each junction cluster — the convex hull of the meeting
  // roads' edge points, fanned at the cluster height, a hair above the ribbons — so the junction reads as
  // a single clean flat apron. Markings are already suppressed here, so the slab is plain asphalt.
  const slab: number[] = []
  const clusterPts: { x: number; y: number }[][] = clusterCells.map(() => [])
  for (let wi = 0; wi < ways.length; wi++) {
    const pts = paths[wi]
    if (!pts) continue
    const half = ways[wi]!.width / 2
    for (let i = 0; i < pts.length; i++) {
      const id = clusterIdAt(pts[i]!.x, pts[i]!.y)
      if (id < 0) continue
      const p = pts[i]!, prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!
      const tx = next.x - prev.x, ty = next.y - prev.y, L = Math.hypot(tx, ty) || 1, px = -ty / L, py = tx / L
      clusterPts[id]!.push({ x: p.x + px * half, y: p.y + py * half }, { x: p.x - px * half, y: p.y - py * half })
    }
  }
  for (let id = 0; id < clusterCells.length; id++) {
    const pp = clusterPts[id]!
    if (pp.length < 3) continue
    // Only slab COMPACT clusters — true crossings / T / Y points. An elongated cluster is two roads
    // running together (a merge), not a crossing; its convex hull would be a giant plaza, so skip it and
    // let the coplanar-flattened ribbons handle it.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const cell of clusterCells[id]!) { const [x, y] = cell.split(',').map(Number) as [number, number]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    if (maxX - minX > 16 || maxY - minY > 16) continue
    const hull = convexHull(pp)
    if (hull.length < 3) continue
    const H = clusterH[id]! + 0.02 // just above the ribbons so it cleanly covers their seams
    let cx = 0, cy = 0
    for (const q of hull) { cx += q.x; cy += q.y }
    cx /= hull.length; cy /= hull.length
    for (let k = 0; k < hull.length; k++) {
      const a = hull[k]!, b = hull[(k + 1) % hull.length]!
      slab.push(opts.wx(cx), H, opts.wz(cy), opts.wx(a.x), H, opts.wz(a.y), opts.wx(b.x), H, opts.wz(b.y))
    }
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
  add(slab, junctionMat) // junction aprons over the ribbons
  add(edge, edgeMat)
  add(dash, dashMat)
  return { group, cells }
}

/** 2D convex hull (Andrew's monotone chain), returned counter-clockwise. */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const ps = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  if (ps.length < 3) return ps
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const p of ps) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p) }
  const upper: { x: number; y: number }[] = []
  for (let i = ps.length - 1; i >= 0; i--) { const p = ps[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p) }
  lower.pop(); upper.pop()
  return lower.concat(upper)
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
function ribbon(pts: { x: number; y: number }[], half: number, opts: RoadRibbonOptions, out: number[], cells: Set<string>, junctionY: (x: number, y: number) => number): void {
  const edge = (i: number, sign: number): number[] => {
    const p = pts[i]!
    const prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!
    const tx = next.x - prev.x, ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const px = -ty / len, py = tx / len // unit perpendicular
    // record every grid cell across the cross-section so surfaceY knows where the ribbon really is
    for (let k = -half; k <= half + 1e-6; k += 0.5) cells.add(`${Math.round(p.x + px * k)},${Math.round(p.y + py * k)}`)
    const gx = p.x + px * half * sign, gy = p.y + py * half * sign
    // In a junction, snap to the cluster's shared height so the overlapping surfaces are coplanar; else
    // the continuous (un-rounded) terrain-following height so straights ramp smoothly instead of stepping.
    const jh = junctionY(p.x, p.y)
    const h = jh >= 0 ? jh : Math.max(0, opts.roadY(p.x, p.y)) + ROAD_RIBBON_LIFT
    return [opts.wx(gx), h, opts.wz(gy)]
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
function edgeLines(pts: { x: number; y: number }[], half: number, opts: RoadRibbonOptions, out: number[], skip: (x: number, y: number) => boolean): void {
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
    const y = Math.max(0, opts.roadY(p.x, p.y)) + ROAD_RIBBON_LIFT + 0.05
    const inX = p.x + px * (c - w), inY = p.y + py * (c - w)
    const ouX = p.x + px * (c + w), ouY = p.y + py * (c + w)
    return [[opts.wx(inX), y, opts.wz(inY)], [opts.wx(ouX), y, opts.wz(ouY)]]
  }
  for (const sign of [-1, 1]) {
    const c = sign * off
    for (let i = 0; i < pts.length - 1; i++) {
      if (skip(pts[i]!.x, pts[i]!.y) || skip(pts[i + 1]!.x, pts[i + 1]!.y)) continue // break the edge line at junctions
      const [aIn, aOut] = at(i, c), [bIn, bOut] = at(i + 1, c)
      tri(aIn, aOut, bIn); tri(bIn, aOut, bOut)
    }
  }
}

/** Clean uniform centre-line dashes. Parameterise the smoothed polyline by ARC LENGTH and lay one tidy
 *  quad per dash at a fixed period, so the dashes are evenly spaced and the same size everywhere (the
 *  old version stamped overlapping quads every 0.4 along each raw segment, which merged into uneven
 *  blobs of different sizes — the messy centre line the operator saw up close). */
function dashes(pts: { x: number; y: number }[], opts: RoadRibbonOptions, out: number[], skip: (x: number, y: number) => boolean): void {
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
  const yOf = (x: number, y: number) => Math.max(0, opts.roadY(x, y)) + ROAD_RIBBON_LIFT + 0.06
  for (let t = (total % PERIOD) / 2 + 0.3; t + LEN <= total; t += PERIOD) {
    const s0 = sample(t), s1 = sample(t + LEN)
    if (skip(s0.x, s0.y)) continue // break the centre line at junctions
    const p0x = -s0.ty * w, p0y = s0.tx * w, p1x = -s1.ty * w, p1y = s1.tx * w
    const y0 = yOf(s0.x, s0.y), y1 = yOf(s1.x, s1.y)
    const aL = [opts.wx(s0.x + p0x), y0, opts.wz(s0.y + p0y)]
    const aR = [opts.wx(s0.x - p0x), y0, opts.wz(s0.y - p0y)]
    const bL = [opts.wx(s1.x + p1x), y1, opts.wz(s1.y + p1y)]
    const bR = [opts.wx(s1.x - p1x), y1, opts.wz(s1.y - p1y)]
    tri(aL, aR, bL); tri(bL, aR, bR)
  }
}
