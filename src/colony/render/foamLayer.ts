import * as THREE from 'three'
import { Biome, type Terrain } from '../terrain'

// Spec 091 — SHORELINE FOAM. A glowing surf ring tracing the island's coast: for every land cell one step
// from the sea (terrain.distToWater === 1) we emit a small quad straddling each shared edge with an OCEAN
// neighbour, nudged seaward and parked on a thin film just above the living-sea swells. An additive
// white-cyan band over the dark teal water reads as breaking surf. Render-only + deterministic: the
// geometry is built ONCE from the terrain grid (no clock, no RNG); the only per-frame work is a gentle
// opacity pulse on the wall clock, matching the bus/beacon/ocean cosmetic convention. River banks are
// left un-foamed so the band reads as a clean island silhouette, not glowing waterways.

export interface FoamLayer {
  group: THREE.Group
  update(timeMs: number): void
  dispose(): void
}

export interface FoamLayerOptions {
  terrain: Terrain
  wx: (x: number) => number
  wz: (y: number) => number
}

// The living sea sits at y=-0.1 and its swells crest to ~+0.31 world-y (updateOcean in PlanetRenderer).
// Park the foam film just above that crest so the additive band always reads on the water rather than
// being depth-occluded by a passing swell; the ~0.4u lift is imperceptible at the district/orbital zoom.
const FOAM_Y = 0.42
const NB: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export function buildFoam(opts: FoamLayerOptions): FoamLayer | null {
  const t = opts.terrain
  const N = t.size
  const positions: number[] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (t.isWater(x, y)) continue
      if (t.distToWater[t.idx(x, y)] !== 1) continue // only the land ring one step from water
      for (const [dx, dy] of NB) {
        const nx = x + dx, ny = y + dy
        if (!t.inBounds(nx, ny)) continue
        if (!t.isWater(nx, ny)) continue
        if (t.biome[t.idx(nx, ny)] === Biome.River) continue // surf at the sea, not along river banks
        // The shared boundary is at the cell border (+0.5 toward the neighbour); nudge a touch further
        // seaward (+0.2) so the bright band sits on the water as surf rather than buried in the beach.
        const cx = opts.wx(x) + dx * 0.7
        const cz = opts.wz(y) + dy * 0.7
        // across-shore unit = (dx,dy); along-shore unit = (-dy,dx)
        const ax = dx, az = dy, lx = -dy, lz = dx
        const hw = 0.5 // half-extent across the shoreline (seaward depth of the band)
        const hl = 0.58 // half-extent along the shoreline (a touch over a cell so adjacent edges meet)
        const p1x = cx - ax * hw - lx * hl, p1z = cz - az * hw - lz * hl
        const p2x = cx + ax * hw - lx * hl, p2z = cz + az * hw - lz * hl
        const p3x = cx + ax * hw + lx * hl, p3z = cz + az * hw + lz * hl
        const p4x = cx - ax * hw + lx * hl, p4z = cz - az * hw + lz * hl
        positions.push(
          p1x, FOAM_Y, p1z, p2x, FOAM_Y, p2z, p3x, FOAM_Y, p3z,
          p1x, FOAM_Y, p1z, p3x, FOAM_Y, p3z, p4x, FOAM_Y, p4z,
        )
      }
    }
  }
  if (positions.length === 0) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdff6ff,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false, // additive glow — never punch a depth hole in the transparent sea
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 2 // paint over the transparent ocean (renderOrder 0) and its swells
  const group = new THREE.Group()
  group.name = 'Shore Foam'
  group.add(mesh)

  return {
    group,
    update(timeMs: number) {
      // Two desynced sines (non-integer freq ratio) give a breathing surf that never reads mechanically
      // periodic. Wall-clock only; the geometry never moves, so this is a single float write per frame.
      const tt = timeMs / 1000
      const pulse = 0.5 + 0.5 * Math.sin(tt * 0.8)
      const flicker = 0.5 + 0.5 * Math.sin(tt * 1.37 + 1.3)
      mat.opacity = 0.26 + 0.2 * pulse + 0.07 * flicker
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      group.parent?.remove(group)
    },
  }
}
