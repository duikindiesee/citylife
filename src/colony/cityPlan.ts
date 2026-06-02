// The City Plan — the surveyed colony map the BORDER PATROL BOT (city brain) reasons over.
// It scans the existing terrain and picks a handful of NAMED RESIDENTIAL PLOTS by vibe:
// Beach Cove, Hillside Vista, Riverside Mile, the open Plains, the Forest Edge. Each plot
// carries a coordinate, an evocative description, and a status (free / assigned). The plan
// also names the colony's zone arcs (residential / commercial / industrial / civic) for the
// patrol bot's system prompt; later the renderer will paint them as zoning marks on the map.
import type { Terrain } from './terrain'
import { Biome } from './terrain'

export type Zone = 'residential' | 'commercial' | 'industrial' | 'civic'
export type Vibe = 'beach' | 'hillside' | 'riverside' | 'plains' | 'forest-edge'

/** Brand colours for the zone tint on the ground (matches the patrol-bot system prompt's geography). */
export const ZONE_COLOR: Record<Zone, number> = {
  civic: 0xe6c84d, // amber centre — school, clinic, fire post
  residential: 0x57d1c4, // teal arc — north & west, family homes
  commercial: 0x7fbfff, // soft blue — east, near the harbour
  industrial: 0xcf8b54, // ochre — south, downwind
}

/** Vibe → flag colour for plot markers. Stays distinct from zone tints so plots pop against zones. */
export const VIBE_COLOR: Record<Vibe, number> = {
  beach: 0xf0d9a6,
  hillside: 0xc77d3a,
  riverside: 0x39b6d8,
  plains: 0x8fd16f,
  'forest-edge': 0x9b6ad6,
}

/** Compute the surveyed zone for any land cell within the city's reach. Returns null off-plan.
 *  Civic anchors the centre near the caravan; the outer arcs split by compass direction:
 *  east → commercial (harbour), south → industrial (downwind), north + west → residential. */
export function cellZone(landing: { x: number; y: number }, x: number, y: number): Zone | null {
  const dx = x - landing.x, dy = y - landing.y
  const d = Math.hypot(dx, dy)
  if (d > 38) return null
  if (d < 4) return 'civic'
  // Atan2 in cell coords: +y = south. East is small angle, south = +PI/2, west = ±PI, north = -PI/2.
  const a = Math.atan2(dy, dx)
  if (a > -Math.PI / 4 && a < Math.PI / 4) return 'commercial' // east
  if (a >= Math.PI / 4 && a <= 3 * Math.PI / 4) return 'industrial' // south
  return 'residential' // north arc (-3π/4..-π/4) AND west arc (>3π/4 or <-3π/4)
}

export interface Plot {
  id: string
  name: string
  vibe: Vibe
  zone: Zone
  x: number
  y: number
  w?: number // footprint width in cells (fitted to flat, rock-free, buildable ground)
  h?: number // footprint depth in cells
  description: string
  assignedTo?: string // householdId
}

/** A cell is good to lay a foundation on if it is on-land, buildable (flat enough), not water, and not bare rock. */
function padCellOk(t: Terrain, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= t.size || y >= t.size) return false
  const i = t.idx(x, y)
  if (t.buildable[i] === 0) return false
  if (t.isWater(x, y)) return false
  const b = t.biome[i]
  return b !== Biome.Mountain && b !== Biome.Ocean && b !== Biome.Shallows // keep off bare rock + water
}

/** Fit a sized footprint around a plot centre: grow a centred rectangle while every new cell is flat, dry and rock-free.
 *  Caps at 5x4 cells so plots stay plausible house lots. Returns odd, centred dims (min 1x1). */
export function plotFootprint(t: Terrain, cx: number, cy: number): { w: number; h: number } {
  let hx = 0, hy = 0
  const rowsOk = (nhx: number, nhy: number): boolean => {
    for (let yy = cy - nhy; yy <= cy + nhy; yy++) for (let xx = cx - nhx; xx <= cx + nhx; xx++) if (!padCellOk(t, xx, yy)) return false
    return true
  }
  // grow alternately in x and y so the lot stays squarish, up to half-extents 2 (x) and 1 (y) => 5x3
  for (let step = 0; step < 4; step++) {
    if (hx < 2 && rowsOk(hx + 1, hy)) hx++
    else if (hy < 1 && rowsOk(hx, hy + 1)) hy++
    else break
  }
  return { w: hx * 2 + 1, h: hy * 2 + 1 }
}

export interface CityPlan {
  plots: Plot[]
}

const NAMES: Record<Vibe, string[]> = {
  beach: ['Beach Cove', 'Shellsand Strand', 'Crystal Strand'],
  hillside: ['Hillside Vista', 'Ochre Heights', 'Ridge Walk'],
  riverside: ['Riverside Mile', 'Brook Bend', 'Creek Hollow'],
  plains: ['Open Plains', 'Meadow Acre', 'Fungal Plain'],
  'forest-edge': ['Forest Edge', 'Violet Grove', 'Quietwood'],
}

const DESCRIPTIONS: Record<Vibe, string> = {
  beach: 'a sandy plot on the crystal shore — sea breeze, gulls, salt in the air',
  hillside: 'an elevated lot with a view over the whole colony',
  riverside: 'a green plot next to a freshwater channel',
  plains: 'flat, easy to build on, plenty of room for a yard',
  'forest-edge': 'tucked against the violet forest, shaded and quiet',
}

/** Score one cell for one vibe; 0 means it doesn't fit. */
function vibeScore(t: Terrain, x: number, y: number, vibe: Vibe, distFromLanding: number): number {
  const i = t.idx(x, y)
  if (t.buildable[i] === 0) return 0
  const biome = t.biome[i]!
  const elev = t.elev[i]!
  const dWater = t.distToWater[i]!
  // close-ish to the landing so the city stays connected, but far enough to spread out
  if (distFromLanding < 6 || distFromLanding > 60) return 0
  switch (vibe) {
    case 'beach':
      return biome === Biome.Beach && dWater <= 2 ? 50 - distFromLanding * 0.3 : 0
    case 'hillside':
      return biome === Biome.Highland || biome === Biome.Mountain ? elev * 60 - distFromLanding * 0.2 : 0
    case 'riverside':
      // adjacent to a river/water cell but on land
      return dWater === 1 && biome !== Biome.Ocean && biome !== Biome.Shallows && biome !== Biome.Beach
        ? 40 - distFromLanding * 0.2
        : 0
    case 'plains':
      return biome === Biome.Plains ? 30 - distFromLanding * 0.15 : 0
    case 'forest-edge':
      return biome === Biome.Forest ? 30 - distFromLanding * 0.15 : 0
  }
}

/** Derive the city plan from the terrain. Deterministic — same terrain → same plots. */
export function makeCityPlan(terrain: Terrain): CityPlan {
  const VIBES: Vibe[] = ['beach', 'hillside', 'riverside', 'plains', 'forest-edge']
  const buckets: Record<Vibe, { x: number; y: number; score: number }[]> = {
    beach: [], hillside: [], riverside: [], plains: [], 'forest-edge': [],
  }
  const cx = terrain.landing.x, cy = terrain.landing.y
  const W = terrain.size
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      for (const v of VIBES) {
        const s = vibeScore(terrain, x, y, v, dist)
        if (s > 0) buckets[v].push({ x, y, score: s })
      }
    }
  }
  const plots: Plot[] = []
  let id = 1
  for (const vibe of VIBES) {
    const sorted = buckets[vibe].sort((a, b) => b.score - a.score)
    // Pick the top 2 candidates per vibe, spaced apart so they're distinct plots.
    const picked: { x: number; y: number }[] = []
    for (const c of sorted) {
      if (picked.length >= 2) break
      const tooClose = picked.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 6)
      if (tooClose) continue
      picked.push({ x: c.x, y: c.y })
      const fp = plotFootprint(terrain, c.x, c.y)
      plots.push({
        id: `plot_${id++}`,
        name: NAMES[vibe][picked.length - 1] ?? NAMES[vibe][0]!,
        vibe,
        zone: 'residential',
        x: c.x,
        y: c.y,
        w: fp.w,
        h: fp.h,
        description: DESCRIPTIONS[vibe],
      })
    }
  }
  return { plots }
}
