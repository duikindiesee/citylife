// Procedural alien-planet terrain: elevation, moisture, rivers, coast/sea, biomes,
// slope/buildability, and a landing-site picker. Framework-agnostic + seeded.
import { RNG } from '../engine/rng'
import { Noise } from './noise'
import { COLONY } from './config'

export enum Biome {
  Ocean = 0,
  Shallows = 1,
  Beach = 2,
  Plains = 3,
  Forest = 4,
  Highland = 5,
  Mountain = 6,
  Peak = 7,
  River = 8,
}

// Alien palette (teal seas, violet flora, ochre rock, pale crystal peaks).
export const BIOME_COLOR: Record<Biome, number> = {
  [Biome.Ocean]: 0x17566f,
  [Biome.Shallows]: 0x2c8aa4,
  [Biome.Beach]: 0xcdbf9e,
  [Biome.Plains]: 0x6f9d6a,
  [Biome.Forest]: 0x4f7d5a,
  [Biome.Highland]: 0xa9925f,
  [Biome.Mountain]: 0x7d7488,
  [Biome.Peak]: 0xe6e2ee,
  [Biome.River]: 0x39b6d8,
}

export type Buildable = 0 | 1 | 2 // 0 blocked, 1 grade, 2 flat

export class Terrain {
  readonly size: number
  readonly elev: Float32Array
  readonly moisture: Float32Array
  readonly biome: Uint8Array
  readonly water: Uint8Array
  readonly buildable: Uint8Array
  readonly distToWater: Int32Array
  landing: { x: number; y: number }

  constructor(rng: RNG) {
    const n = (this.size = COLONY.world.size)
    const cfg = COLONY.world
    const noise = new Noise(rng)
    const moistNoise = new Noise(rng)

    this.elev = new Float32Array(n * n)
    this.moisture = new Float32Array(n * n)
    this.biome = new Uint8Array(n * n)
    this.water = new Uint8Array(n * n)
    this.buildable = new Uint8Array(n * n)
    this.distToWater = new Int32Array(n * n)

    this.generateElevation(noise, moistNoise)
    this.carveRivers(rng)
    this.computeDistToWater()
    this.classify()
    this.computeBuildable()
    this.landing = this.pickLanding()
  }

  idx(x: number, y: number): number {
    return y * this.size + x
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size
  }

  /** True for sea, shallows, and rivers. Roads stop at water (a bridge spans it later); steep land
   *  is not water, so roads may cross it and drape over the slope. */
  isWater(x: number, y: number): boolean {
    const i = this.idx(x, y)
    return this.water[i] === 1 || this.elev[i]! < COLONY.world.seaLevel
  }

  private generateElevation(noise: Noise, moistNoise: Noise): void {
    const n = this.size
    const cfg = COLONY.world.noise
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cfg.elevFreq
        const fy = (y / n) * cfg.elevFreq
        let e = 0.5 + 0.5 * noise.fbm(fx, fy, cfg.elevOctaves)
        const m = (x / n) * cfg.mountainFreq
        const mo = (y / n) * cfg.mountainFreq
        const mountains = noise.ridged(m, mo, 5)
        e = e * 0.78 + mountains * 0.42 * e // mountains concentrate on already-high land

        // Island mask: sink the edges into ocean so we get coastlines + sea around the region.
        const dx = (x / n - 0.5) * 2
        const dy = (y / n - 0.5) * 2
        const d = Math.sqrt(dx * dx + dy * dy)
        const mask = 1 - smoothstep(0.55, 1.02, d)
        e = e * mask

        this.elev[this.idx(x, y)] = clamp01(e)
        this.moisture[this.idx(x, y)] = clamp01(0.5 + 0.5 * moistNoise.fbm((x / n) * cfg.moistFreq, (y / n) * cfg.moistFreq, cfg.moistOctaves))
      }
    }
  }

  private lowestNeighbor(x: number, y: number): { x: number; y: number; e: number } {
    let best = { x, y, e: this.elev[this.idx(x, y)]! }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (!this.inBounds(nx, ny)) continue
      const e = this.elev[this.idx(nx, ny)]!
      if (e < best.e) best = { x: nx, y: ny, e }
    }
    return best
  }

  private carveRivers(rng: RNG): void {
    const n = this.size
    const sea = COLONY.world.seaLevel
    for (let r = 0; r < COLONY.world.rivers; r++) {
      // Source: a high, moist, central-ish cell.
      let sx = 0
      let sy = 0
      let bestScore = -1
      for (let tries = 0; tries < 60; tries++) {
        const x = rng.int(n * 0.2, n * 0.8)
        const y = rng.int(n * 0.2, n * 0.8)
        const e = this.elev[this.idx(x, y)]!
        const m = this.moisture[this.idx(x, y)]!
        const score = e + m * 0.5
        if (e > sea + 0.18 && score > bestScore) {
          bestScore = score
          sx = x
          sy = y
        }
      }
      if (bestScore < 0) continue
      let x = sx
      let y = sy
      for (let step = 0; step < n; step++) {
        const i = this.idx(x, y)
        this.water[i] = 1
        // carve, but keep just above sea so it reads as a channel (not ocean)
        this.elev[i] = Math.max(sea + 0.006, this.elev[i]! - 0.03)
        if (this.elev[i]! <= sea + 0.02) break // reached the coast
        const lo = this.lowestNeighbor(x, y)
        if (lo.x === x && lo.y === y) break // local minimum → small pool, stop
        x = lo.x
        y = lo.y
      }
    }
  }

  private computeDistToWater(): void {
    const n = this.size
    const sea = COLONY.world.seaLevel
    this.distToWater.fill(-1)
    const queue: number[] = []
    for (let i = 0; i < n * n; i++) {
      if (this.water[i] || this.elev[i]! < sea) {
        this.distToWater[i] = 0
        queue.push(i)
      }
    }
    let head = 0
    while (head < queue.length) {
      const i = queue[head++]!
      const x = i % n
      const y = (i / n) | 0
      const d = this.distToWater[i]!
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (!this.inBounds(nx, ny)) continue
        const ni = this.idx(nx, ny)
        if (this.distToWater[ni] === -1) {
          this.distToWater[ni] = d + 1
          queue.push(ni)
        }
      }
    }
  }

  private classify(): void {
    const n = this.size
    const sea = COLONY.world.seaLevel
    for (let i = 0; i < n * n; i++) {
      const e = this.elev[i]!
      let b: Biome
      if (e < sea - 0.06) b = Biome.Ocean
      else if (e < sea) b = Biome.Shallows
      else if (this.water[i]) b = Biome.River
      else {
        const t = (e - sea) / (1 - sea)
        const m = this.moisture[i]!
        if (t < 0.035) b = Biome.Beach
        else if (t < 0.34) b = m > 0.52 ? Biome.Forest : Biome.Plains
        else if (t < 0.6) b = Biome.Highland
        else if (t < 0.82) b = Biome.Mountain
        else b = Biome.Peak
      }
      this.biome[i] = b
    }
  }

  /** World-space height (units). Sea plane is at y=0; ocean cells are below it. */
  worldY(x: number, y: number): number {
    const e = this.elev[this.idx(x, y)]!
    return (e - COLONY.world.seaLevel) * COLONY.world.heightScale
  }

  private slopeAt(x: number, y: number): number {
    const h = this.worldY(x, y)
    let s = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (!this.inBounds(nx, ny)) continue
      s = Math.max(s, Math.abs(this.worldY(nx, ny) - h))
    }
    return s
  }

  private computeBuildable(): void {
    const n = this.size
    const sea = COLONY.world.seaLevel
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = this.idx(x, y)
        if (this.water[i] || this.elev[i]! < sea) {
          this.buildable[i] = 0
          continue
        }
        const slope = this.slopeAt(x, y)
        this.buildable[i] = slope < 0.6 ? 2 : slope < 1.7 ? 1 : 0
      }
    }
  }

  private pickLanding(): { x: number; y: number } {
    const n = this.size
    let best = { x: (n / 2) | 0, y: (n / 2) | 0 }
    let bestScore = -Infinity
    for (let y = 4; y < n - 4; y++) {
      for (let x = 4; x < n - 4; x++) {
        const i = this.idx(x, y)
        if (this.buildable[i] !== 2) continue
        const dW = this.distToWater[i]!
        if (dW <= 0 || dW > COLONY.world.coastSearch) continue // want coastal, but on land
        const cx = (x / n - 0.5) * 2
        const cy = (y / n - 0.5) * 2
        const central = 1 - Math.sqrt(cx * cx + cy * cy)
        const lowland = 1 - (this.elev[i]! - COLONY.world.seaLevel)
        const score = central * 1.4 + lowland * 1.2 + (COLONY.world.coastSearch - dW) * 0.25
        if (score > bestScore) {
          bestScore = score
          best = { x, y }
        }
      }
    }
    return best
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
