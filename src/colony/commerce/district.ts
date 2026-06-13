// Spec 079 P0 — the commercial high street. A pure, deterministic survey of shop plots along a
// market street through the reserved commercial land bank (the 40x30 reserve at the avenue's inland
// end, runtime.commercialReserve). Mirrors the residential neighbourhood survey's discipline: every
// cell is gated through cellOk (in-bounds, buildable, dry, not rock — the shared land contract), the
// footprint is collision-checked against a claimed set so shops never overlap, and the whole thing is
// a pure function of (terrain, reserve) — no Date.now, no Math.random — so it replays identically and
// is node-testable headless. The vibrant render + the buy/build economy layer on top of this.
import { cellOk, type Cell } from '../pathfind'
import type { Terrain } from '../terrain'
import { assignBusinesses, type BusinessId } from './businesses'

export type ShopKind = 'kiosk' | 'store' | 'showroom'

/** A surveyed shop plot fronting the high street. Keeps the public fields the engine + renderer read
 *  (id, x, y, w, h, side, doorX, doorY, ownerCitizenId, built); the buy/build slice fills ownership. */
export interface ShopParcel {
  id: string
  kind: ShopKind
  /** Footprint min-corner cell. */
  x: number
  y: number
  /** Footprint size in cells (w along the street, h deep). */
  w: number
  h: number
  /** Which side of the high street the shop fronts (-1 = toward -y, +1 = toward +y). */
  side: -1 | 1
  /** The shop door cell, on the street-facing front row, centred on the frontage. */
  doorX: number
  doorY: number
  ownerCitizenId?: string
  built: boolean
  /** The real kooker app this plot fronts (its identity/destiny; assigned deterministically). */
  business?: BusinessId
}

export interface CommercialDistrict {
  /** The surveyed high-street cells (a dry midline through the reserve). */
  street: Cell[]
  /** The shop plots flanking the street, in deterministic placement order. */
  parcels: ShopParcel[]
  /** The land bank this district was surveyed within. */
  reserve: Reserve
}

export interface Reserve {
  x: number
  y: number
  w: number
  h: number
}

/** Footprint of each shop kind: w along the street frontage, d deep away from it (079 spec sizes). */
export const SHOP_SIZE: Record<ShopKind, { w: number; d: number }> = {
  kiosk: { w: 4, d: 4 },
  store: { w: 6, d: 5 },
  showroom: { w: 8, d: 6 },
}

// A fixed rhythm of shop sizes down the street — bigger anchors interleaved with kiosks, so the strip
// reads as a varied market rather than a row of identical boxes. Offset per side so the two rows differ.
const KIND_CYCLE: ShopKind[] = ['showroom', 'store', 'kiosk', 'store', 'kiosk', 'showroom', 'store', 'kiosk']
const FRONT_GAP = 1 // empty cells between adjacent shop frontages along the street
const SETBACK = 1 // cells of pavement between the street and a shop's front row

/** Survey the commercial district: a high street down the middle of the reserve, with shop plots
 *  fronting it on both sides. Pure + deterministic in (terrain, reserve, blocked). `blocked` is the
 *  set of cells already taken by the residential parcels + roads ('x,y' keys) — shops never land on
 *  homestead land or the avenue, the same collision discipline the homestead survey uses. */
export function makeCommercialDistrict(t: Terrain, reserve: Reserve, blocked: ReadonlySet<string> = new Set()): CommercialDistrict {
  const streetY = reserve.y + Math.floor(reserve.h / 2)
  const street: Cell[] = []
  for (let x = reserve.x; x < reserve.x + reserve.w; x++) {
    if (cellOk(t, x, streetY) && !blocked.has(`${x},${streetY}`)) street.push({ x, y: streetY })
  }

  const claimed = new Set<string>()
  const parcels: ShopParcel[] = []
  let id = 0

  // Two rows flank the street: the -y side, then the +y side (fixed order = deterministic).
  for (const side of [-1, 1] as const) {
    let cursorX = reserve.x
    let k = side === -1 ? 0 : 3 // stagger the kind rhythm so the facing rows are not mirror-identical
    while (cursorX + 1 < reserve.x + reserve.w) {
      const kind = KIND_CYCLE[k % KIND_CYCLE.length]!
      const { w, d } = SHOP_SIZE[kind]
      // The front row faces the street; the footprint extends away from it.
      const frontY = side === -1 ? streetY - SETBACK - 1 : streetY + SETBACK + 1
      const y0 = side === -1 ? frontY - (d - 1) : frontY
      const y1 = y0 + d - 1
      const x0 = cursorX
      const x1 = cursorX + w - 1

      if (fits(t, reserve, claimed, blocked, x0, y0, x1, y1)) {
        const doorX = x0 + Math.floor(w / 2)
        claim(claimed, x0, y0, x1, y1)
        parcels.push({ id: `shop_${id++}`, kind, x: x0, y: y0, w, h: d, side, doorX, doorY: frontY, built: false })
        cursorX = x1 + 1 + FRONT_GAP
        k++
      } else {
        cursorX++ // this kind does not fit here (terrain/edge); slide along and retry — cursor only grows
      }
    }
  }

  // Each plot fronts a real kooker app — assign its business identity (deterministic).
  const biz = assignBusinesses(parcels)
  for (const p of parcels) p.business = biz[p.id]

  return { street, parcels, reserve }
}

/** Every cell of [x0..x1]×[y0..y1] must be inside the reserve, good ground, not already taken by a
 *  homestead/road (blocked), and unclaimed by another shop. */
function fits(t: Terrain, reserve: Reserve, claimed: Set<string>, blocked: ReadonlySet<string>, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x0 < reserve.x || x1 >= reserve.x + reserve.w) return false
  if (y0 < reserve.y || y1 >= reserve.y + reserve.h) return false
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const key = `${x},${y}`
      if (!cellOk(t, x, y)) return false
      if (blocked.has(key)) return false
      if (claimed.has(key)) return false
    }
  }
  return true
}

function claim(claimed: Set<string>, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) claimed.add(`${x},${y}`)
}
