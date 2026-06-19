import * as THREE from 'three'
import type { Terrain } from '../terrain'
import type { BusRoute } from '../transit/busRoute'

// Spec 088 — the render-loop BUS. A friendly little coach that drives the fixed busRoute loop between
// the hoods, plus a stop marker at each hood. Render-only + cosmetic: it advances on wall-clock dt
// (like the ambient cars), never touches the deterministic sim, and is rebuilt with the route.

export interface BusLayer {
  group: THREE.Group
  update(timeMs: number): void
  dispose(): void
}

export interface BusLayerOptions {
  terrain: Terrain
  route: BusRoute
  wx: (x: number) => number
  wz: (y: number) => number
  roadY: (x: number, y: number) => number // smoothed road height
}

const SPEED = 4 // loop cells per second — an unhurried town coach, easy to follow by eye
const STOP_DWELL = 1.4 // seconds paused at each stop
const STOP_RADIUS = 1.2 // how close (cells) to a stop counts as "at the stop"

export function buildBusLayer(opts: BusLayerOptions): BusLayer | null {
  const raw = opts.route.loop
  if (raw.length < 2) return null
  // De-zigzag the bus path. route.loop is a 4-connected BFS over road CELLS, so on diagonals it
  // staircases and driving it cell-by-cell made the coach jitter side to side (the operator's zigzag).
  // Corner-cut (chaikin) the closed loop into a smooth curve the bus glides along. Render-only — the
  // pure, node-tested route is untouched. The smoothed loop has 2^iters× as many points, so scale the
  // index speed to keep the real ground speed about the same.
  const SMOOTH_ITERS = 2
  const loop = smoothClosed(raw, SMOOTH_ITERS)
  const speedMul = 1 << SMOOTH_ITERS
  const group = new THREE.Group()
  group.name = 'Bus'
  const bus = buildBus()
  group.add(bus)
  for (const s of opts.route.stops) group.add(buildStop(opts, s))

  let dist = 0 // float index into the smoothed loop
  let last = -1
  let dwell = 0
  let lastStop = '' // the stop we last paused at, cleared once we drive clear of it
  const place = (gx: number, gy: number, headingGrid: number) => {
    const y = Math.max(0, opts.roadY(gx, gy)) + 0.18 // continuous height (no cell rounding) so the coach rides smoothly, sitting on the road surface
    bus.position.set(opts.wx(gx), y, opts.wz(gy))
    bus.rotation.y = -headingGrid // body is long in X; match the rally car's -heading convention
  }

  return {
    group,
    update(timeMs: number) {
      if (last < 0) last = timeMs
      const dt = Math.min(0.1, (timeMs - last) / 1000)
      last = timeMs
      if (dwell > 0) dwell = Math.max(0, dwell - dt)
      else dist = (dist + dt * SPEED * speedMul) % loop.length
      const fi = Math.floor(dist) % loop.length
      const fa = loop[fi]!, fb = loop[(fi + 1) % loop.length]!
      const frac = dist - Math.floor(dist)
      const gx = fa.x + (fb.x - fa.x) * frac, gy = fa.y + (fb.y - fa.y) * frac
      place(gx, gy, Math.atan2(fb.y - fa.y, fb.x - fa.x))
      // dwell briefly on arriving near a stop; re-arm once we have driven clear so each lap pauses again
      let near = ''
      for (const s of opts.route.stops) if (Math.hypot(gx - s.x, gy - s.y) < STOP_RADIUS) { near = `${s.x},${s.y}`; break }
      if (near && near !== lastStop && dwell <= 0) { dwell = STOP_DWELL; lastStop = near }
      if (!near) lastStop = ''
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        const mt = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose())
        else if (mt) mt.dispose()
      })
      group.parent?.remove(group)
    },
  }
}

/** Chaikin corner-cutting on a CLOSED loop: each iteration replaces every vertex with its 1/4 and 3/4
 *  points (wrapping around), rounding the BFS cell staircase into a smooth circuit. */
function smoothClosed(loop: { x: number; y: number }[], iters: number): { x: number; y: number }[] {
  let pts = loop.map((p) => ({ x: p.x, y: p.y }))
  for (let it = 0; it < iters; it++) {
    const n = pts.length
    const out: { x: number; y: number }[] = []
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % n]!
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    pts = out
  }
  return pts
}

function buildBus(): THREE.Group {
  const g = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: 0.5, metalness: 0.1, emissive: 0x4a2f06, emissiveIntensity: 0.3 })
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fe6ff, roughness: 0.25, metalness: 0.2, emissive: 0x123740, emissiveIntensity: 0.35 })
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141620, roughness: 0.75 })
  // body — long in X (the travel axis)
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.84), bodyMat)
  body.position.y = 0.62
  // window band
  const windows = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.26, 0.88), glassMat)
  windows.position.y = 0.8
  // roof + a little destination sign
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.1, 0.86), bodyMat) // body-colour roof so the bus is spottable from the overhead district view
  roof.position.y = 0.99
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.05), glassMat)
  sign.position.set(1.18, 0.86, 0)
  g.add(body, windows, roof, sign)
  for (const x of [-0.78, 0.78]) for (const z of [-0.42, 0.42]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 12), wheelMat)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(x, 0.2, z)
    g.add(wheel)
  }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } })
  return g
}

function buildStop(opts: BusLayerOptions, s: { x: number; y: number }): THREE.Group {
  const g = new THREE.Group()
  const baseY = Math.max(0, opts.roadY(s.x, s.y))
  g.position.set(opts.wx(s.x), baseY, opts.wz(s.y))
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.7 })
  const signMat = new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xffb02e, emissiveIntensity: 0.55, roughness: 0.4 })
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8), poleMat)
  pole.position.set(0, 0.75, 1.3)
  pole.castShadow = true
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.06), signMat)
  sign.position.set(0, 1.5, 1.3)
  g.add(pole, sign)
  return g
}
