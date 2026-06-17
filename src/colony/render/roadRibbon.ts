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
  const streetMat = new THREE.MeshStandardMaterial({ color: 0x595f6a, roughness: 0.92, metalness: 0.02 }) // mid asphalt grey — reads as road, not a black hole
  const avenueMat = new THREE.MeshStandardMaterial({ color: 0x646b78, roughness: 0.9, metalness: 0.03 })
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf2cf52, roughness: 0.5, emissive: 0xf2cf52, emissiveIntensity: 0.5, side: THREE.DoubleSide }) // bright lane line, glows a little day + night. DoubleSide: the dash quads wind opposite the surface (normals point down), so without it they were back-face-culled from above and the centre line never showed.
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.6, emissive: 0xb9c0cc, emissiveIntensity: 0.28 }) // painted white road edges
  const surf: number[] = []
  const surfA: number[] = []
  const dash: number[] = []
  const edge: number[] = []
  for (const way of ways) {
    if (way.path.length < 2) continue
    const pts = chaikin(way.path, 2)
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

/** Short dashes along the centre-line (every ~2 cells), a thin raised quad each. */
function dashes(pts: { x: number; y: number }[], opts: RoadRibbonOptions, out: number[]): void {
  const tri = (a: number[], b: number[], c: number[]) => out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  // accumulate arc length; lay a dash for ~1 cell every ~2.4 cells
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!
    let tx = b.x - a.x, ty = b.y - a.y
    const seg = Math.hypot(tx, ty)
    if (seg < 1e-4) continue
    tx /= seg; ty /= seg
    const px = -ty * 0.22, py = tx * 0.22 // dash half-thickness across the road
    for (let s = 0; s < seg; s += 0.4) {
      acc += 0.4
      if (acc % 2.6 > 1.4) continue // gap between dashes (dash ~1.4 long, gap ~1.2)
      const cx = a.x + tx * s, cy = a.y + ty * s
      const y = Math.max(0, opts.roadY(Math.round(cx), Math.round(cy))) + ROAD_RIBBON_LIFT + 0.06
      const aL = [opts.wx(cx + px), y, opts.wz(cy + py)]
      const aR = [opts.wx(cx - px), y, opts.wz(cy - py)]
      const bx = cx + tx * 0.55, by = cy + ty * 0.55
      const bL = [opts.wx(bx + px), y, opts.wz(by + py)]
      const bR = [opts.wx(bx - px), y, opts.wz(by - py)]
      tri(aL, aR, bL); tri(bL, aR, bR)
    }
  }
}
