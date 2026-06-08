// The Neighbourhood — a prebuilt little street of decent-sized LOTS where citizens build homes.
//
// Unlike the old scattered vibe-plots, this is a proper neighbourhood: a straight street laid on the
// flattest dry ground near the colony core, with square lots flanking it on both sides, each facing
// the street with a door cell. A citizen is assigned a lot, then a voxel house is built on it
// (voxelHouse.ts), and the whole thing can be demolished. Deterministic from the terrain.
import type { Terrain } from './terrain'
import { Biome } from './terrain'

export interface Lot {
  id: string
  /** Lot centre cell. */
  x: number
  y: number
  /** Lot footprint in cells (square). */
  w: number
  h: number
  /** The street-facing cell of the lot — the house door opens toward here. */
  doorX: number
  doorY: number
  /** Citizen who owns this lot (their home), if any. */
  ownerCitizenId?: string
  /** True once a house has been built on the lot. */
  built: boolean
  /** Deterministic seed so each lot grows a distinct house. */
  houseSeed: number
}

export interface Neighborhood {
  /** The street cells (added to the colony roads so the avatars walk them). */
  street: { x: number; y: number }[]
  lots: Lot[]
}

export const LOT = 4 // cells per side — a 4x4 lot fits a voxel cottage with a yard verge

/** A cell is good to lay a lot or street on: in-bounds, buildable, dry, not bare rock. */
function cellOk(t: Terrain, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= t.size || y >= t.size) return false
  const i = t.idx(x, y)
  if (t.buildable[i] === 0) return false
  if (t.isWater(x, y)) return false
  const b = t.biome[i]
  return b !== Biome.Mountain && b !== Biome.Peak && b !== Biome.Ocean && b !== Biome.Shallows
}

/** Every cell in a centred square footprint is good ground. */
function footprintOk(t: Terrain, cx: number, cy: number, w: number, h: number): boolean {
  const hx = (w - 1) / 2, hy = (h - 1) / 2
  for (let yy = Math.ceil(cy - hy); yy <= Math.floor(cy + hy); yy++) {
    for (let xx = Math.ceil(cx - hx); xx <= Math.floor(cx + hx); xx++) {
      if (!cellOk(t, xx, yy)) return false
    }
  }
  return true
}

/** Try to lay a neighbourhood with its street row at y=ys spanning x=[xs, xs+streetLen). Returns null if
 *  the street or every lot slot fails the ground test. */
function tryLayout(t: Terrain, xs: number, ys: number, streetLen: number, slots: number): Neighborhood | null {
  // street cells must all be good ground
  const street: { x: number; y: number }[] = []
  for (let x = xs; x < xs + streetLen; x++) {
    if (!cellOk(t, x, ys)) return null
    street.push({ x, y: ys })
  }
  const lots: Lot[] = []
  const lotCentreOffset = 1 + (LOT - 1) / 2 // one verge cell from the street, then half the lot
  let id = 1
  for (let i = 0; i < slots; i++) {
    const cx = xs + 1 + i * (LOT + 1) + (LOT - 1) / 2
    if (cx + (LOT - 1) / 2 >= xs + streetLen) break
    for (const side of [-1, 1] as const) {
      const cy = ys + side * lotCentreOffset
      if (!footprintOk(t, cx, cy, LOT, LOT)) continue
      // door cell = the lot cell nearest the street (the verge-side row centre)
      const doorY = ys + side * 1
      lots.push({ id: `lot_${id++}`, x: Math.round(cx), y: Math.round(cy), w: LOT, h: LOT, doorX: Math.round(cx), doorY, built: false, houseSeed: (Math.round(cx) * 73856093) ^ (Math.round(cy) * 19349663) })
    }
  }
  if (lots.length < 2) return null
  return { street, lots }
}

/** Lay out the neighbourhood on the flattest dry ground a short walk from the colony core. */
export function makeNeighborhood(t: Terrain): Neighborhood {
  const lx = t.landing.x, ly = t.landing.y
  const streetLen = 18
  const slots = 4
  // Search outward from a ring around the core (near, but clear of the landing plaza) for the first
  // anchor where the whole street + lots sit on good ground. Deterministic scan order.
  for (let r = 7; r <= 34; r++) {
    for (const dy of [-r, r, 0, -Math.floor(r / 2), Math.floor(r / 2)]) {
      const ys = ly + dy
      const xs = lx - Math.floor(streetLen / 2)
      const n = tryLayout(t, xs, ys, streetLen, slots)
      if (n) return n
    }
  }
  // Fallback: a minimal layout right by the landing (best-effort; may have few lots).
  return tryLayout(t, lx - 6, ly + 5, 12, 3) ?? { street: [], lots: [] }
}
