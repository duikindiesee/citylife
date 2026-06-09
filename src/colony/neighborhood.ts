// The Neighbourhood — large HOMESTEAD PARCELS served by a terrain-aware street (spec 076).
//
// This replaces the old cramped 4x4 lots. Each citizen gets a big bordered PARCEL zoned front-to-back
// from the street: a front yard (setback), the HOUSE, a GARDEN, then a FARM field at the rear, ringed
// by a fence with one gate. Parcels flank a SPINE street routed as a least-cost path over the terrain
// (pathfind.ts), so it stays straight on flat ground and bends around water/slope, never running over
// the sea. Everything is a pure, deterministic function of the terrain so the layout is reproducible
// and unit-testable.
import type { Terrain } from './terrain'
import { cellOk, leastCostPath, type Cell } from './pathfind'

export type FenceType = 'fence' | 'hedge' | 'wall'

/** An axis-aligned rectangle of cells: min-corner (x,y), `w` wide (along the street), `d` deep. */
export interface Zone {
  x: number
  y: number
  w: number
  d: number
}

/** A homestead parcel — the unit of household land. Keeps the public fields the engine already reads
 *  (id, x, y, w, h, doorX, doorY, built, ownerCitizenId, houseSeed) plus the new homestead structure. */
export interface Parcel {
  id: string
  /** Parcel centre cell. */
  x: number
  y: number
  /** Parcel footprint in cells (w along the street, h deep). */
  w: number
  h: number
  /** Which side of the spine the parcel sits on (-1 = toward -y, +1 = toward +y). */
  side: -1 | 1
  /** The house door cell, facing the street. */
  doorX: number
  doorY: number
  ownerCitizenId?: string
  built: boolean
  houseSeed: number
  fenceType: FenceType
  /** The house build-zone (the voxel house sits here, set back from the street). */
  houseZone: Zone
  /** The vegetable garden band, between house and field. */
  garden: Zone
  /** The worked farm field at the rear of the parcel. */
  farm: Zone
  /** The gate gap in the front fence where the driveway meets the parcel. */
  gate: Cell
  /** The driveway path cells from the carriageway across the verge + front yard to the door. */
  driveway: Cell[]
  /** The perimeter fence cells (the border ring minus the gate gap). */
  fence: Cell[]
}

// Back-compat alias: runtime.ts imports `type Lot`; a Parcel IS the lot now.
export type Lot = Parcel

export interface Neighborhood {
  /** The routed spine centre-line cells. */
  spine: Cell[]
  /** The 3-wide carriageway cells (walkable + drawn as the road surface). */
  carriage: Cell[]
  /** The kerb/verge ring cells (drawn as the verge, not walkable road). */
  verge: Cell[]
  /** The walkable street cells merged into the colony roads (== carriageway). */
  street: Cell[]
  /** The homestead parcels. */
  parcels: Parcel[]
  /** Back-compat alias so existing code reading `.lots` keeps working. */
  lots: Parcel[]
}

// ── Homestead dimensions ─────────────────────────────────────────────────────
// Depth budget D, from the street inward: front border (1) + setback + house + garden + farm + rear
// border (1). Width W: a 1-cell fence border each side, the house inset 1 more cell each side.
interface ParcelSize {
  W: number // frontage (along the street)
  D: number // depth (away from the street)
  setback: number // front-yard cells between the front fence and the house
  houseDepth: number
  gardenDepth: number
  farmDepth: number
}
const BIG: ParcelSize = { W: 11, D: 14, setback: 2, houseDepth: 5, gardenDepth: 3, farmDepth: 2 }
const COMPACT: ParcelSize = { W: 9, D: 11, setback: 1, houseDepth: 4, gardenDepth: 2, farmDepth: 2 }
const GAP = 3 // empty green cells between adjacent parcels along the street (beyond each fence)
const MAX_PER_SIDE = 3 // a band of up to 3 large homesteads per side of the spine
// Offset of the parcel's front fence from the spine centre: carriageway half (1) + verge (1) + 1.
const FRONT_OFFSET = 3

function key(x: number, y: number): string {
  return `${x},${y}`
}

/** Dilate a set of cells by their 4-neighbours that pass cellOk — turns the 1-cell spine into a
 *  ~3-wide carriageway that follows every bend, and the carriageway into its verge ring. */
function dilate(t: Terrain, cells: Cell[], have: Set<string>): Cell[] {
  const out: Cell[] = []
  const seen = new Set<string>()
  for (const c of cells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = c.x + dx, y = c.y + dy
      const k = key(x, y)
      if (have.has(k) || seen.has(k)) continue
      if (!cellOk(t, x, y)) continue
      seen.add(k)
      out.push({ x, y })
    }
  }
  return out
}

/** Spiral outward from (cx,cy) up to `r` for the nearest cell that passes cellOk. */
function slideToLand(t: Terrain, cx: number, cy: number, r = 4): Cell | null {
  for (let rr = 0; rr <= r; rr++) {
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue
        if (cellOk(t, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy }
      }
    }
  }
  return null
}

interface Corridor {
  spine: Cell[]
  carriage: Cell[]
  verge: Cell[]
  carriageSet: Set<string>
  blocked: Set<string> // carriage + verge — parcels may not touch these
  colY: Map<number, number> // x -> the spine y at that column nearest the baseline
}

/** Route the spine between two anchors at the baseline y and build its carriageway + verge. */
function buildCorridor(t: Terrain, lx: number, baselineY: number, span: number): Corridor | null {
  const start = slideToLand(t, lx - Math.floor(span / 2), baselineY)
  const end = slideToLand(t, lx + Math.ceil(span / 2), baselineY)
  if (!start || !end) return null
  const spine = leastCostPath(t, start, end, { slopeWeight: 0.6 })
  if (!spine || spine.length < span * 0.6) return null
  const spineSet = new Set(spine.map((c) => key(c.x, c.y)))
  const carriage = [...spine, ...dilate(t, spine, spineSet)]
  const carriageSet = new Set(carriage.map((c) => key(c.x, c.y)))
  const verge = dilate(t, carriage, carriageSet)
  const blocked = new Set([...carriageSet, ...verge.map((c) => key(c.x, c.y))])
  // For each spine column, the spine y nearest the baseline (parcels attach against this).
  const colY = new Map<number, number>()
  for (const c of spine) {
    const prev = colY.get(c.x)
    if (prev === undefined || Math.abs(c.y - baselineY) < Math.abs(prev - baselineY)) colY.set(c.x, c.y)
  }
  return { spine, carriage, verge, carriageSet, blocked, colY }
}

/** Build one parcel anchored at spine column (sx, syStreet) on `side`, or null if any cell is bad
 *  ground, hits the road corridor, or collides with an already-claimed cell. On success, every cell
 *  it occupies (plus a GAP halo) is added to `claimed` so neighbours keep their distance. */
function tryParcel(
  t: Terrain,
  sx: number,
  syStreet: number,
  side: -1 | 1,
  sz: ParcelSize,
  corridor: Corridor,
  claimed: Set<string>,
  id: number,
): Parcel | null {
  const uHalf = (sz.W - 1) / 2
  const houseSeed = (sx * 73856093) ^ (syStreet * 19349663)
  const jitter = ((houseSeed >>> 4) % 3) - 1 // -1, 0, +1 lateral nudge so fronts align but vary
  // Absolute coords from a lateral offset u and a depth d (0 = front fence row).
  const ax = (u: number) => sx + u
  const ay = (d: number) => syStreet + side * (FRONT_OFFSET + d)

  // 1. Validate the whole footprint: every cell good ground, off the road, unclaimed.
  for (let d = 0; d < sz.D; d++) {
    for (let u = -uHalf; u <= uHalf; u++) {
      const x = ax(u), y = ay(d)
      const k = key(x, y)
      if (!cellOk(t, x, y)) return null
      if (corridor.blocked.has(k)) return null
      if (claimed.has(k)) return null
    }
  }

  // 2. Depth bands from the street inward.
  const houseD0 = 1 + sz.setback
  const gardenD0 = houseD0 + sz.houseDepth
  const farmD0 = gardenD0 + sz.gardenDepth
  // A normalized rect covering depths [dA, dB] x lateral [uA, uB].
  const rect = (dA: number, dB: number, uA: number, uB: number): Zone => {
    const ys = [ay(dA), ay(dB)]
    return { x: ax(uA), y: Math.min(ys[0]!, ys[1]!), w: uB - uA + 1, d: Math.abs(dB - dA) + 1 }
  }
  const houseUHalf = uHalf - 1 // inset 1 cell from the side fence (1 border + 1 inset = 2)
  const houseZone = rect(houseD0, houseD0 + sz.houseDepth - 1, -houseUHalf, houseUHalf)
  const garden = rect(gardenD0, gardenD0 + sz.gardenDepth - 1, -(uHalf - 1), uHalf - 1)
  const farm = rect(farmD0, farmD0 + sz.farmDepth - 1, -(uHalf - 1), uHalf - 1)

  // 3. Door (house front, on the street side), gate (front fence at the door column), driveway.
  let doorU = jitter
  if (Math.abs(doorU) > houseUHalf) doorU = 0
  const doorX = ax(doorU)
  const doorY = ay(houseD0)
  const gate = { x: doorX, y: ay(0) }
  // Frontage rule: a carriageway cell must sit directly street-ward of the gate column.
  if (!corridor.carriageSet.has(key(doorX, syStreet + side * 1)) && !corridor.carriageSet.has(key(doorX, syStreet))) {
    return null
  }
  // The driveway runs from the verge (offset 2) across the front yard all the way to the door cell
  // (offset FRONT_OFFSET + houseD0), so it actually reaches the door — no one-cell gap.
  const driveway: Cell[] = []
  for (let o = 2; o <= FRONT_OFFSET + houseD0; o++) {
    const x = doorX, y = syStreet + side * o
    if (!cellOk(t, x, y)) return null // keep the drive on good ground
    driveway.push({ x, y })
  }

  // 4. Fence ring (perimeter), minus the gate gap.
  const fence: Cell[] = []
  for (let u = -uHalf; u <= uHalf; u++) {
    for (const d of [0, sz.D - 1]) {
      const x = ax(u), y = ay(d)
      if (x === gate.x && y === gate.y) continue // leave the gate open
      fence.push({ x, y })
    }
  }
  for (let d = 1; d < sz.D - 1; d++) {
    fence.push({ x: ax(-uHalf), y: ay(d) })
    fence.push({ x: ax(uHalf), y: ay(d) })
  }

  // 5. Claim the footprint plus a GAP halo so neighbours never crowd it.
  for (let d = -GAP; d < sz.D + GAP; d++) {
    for (let u = -uHalf - GAP; u <= uHalf + GAP; u++) {
      claimed.add(key(ax(u), ay(d)))
    }
  }

  const cx = sx, cy = ay((sz.D - 1) / 2)
  return {
    id: `lot_${id}`,
    x: cx,
    y: Math.round(cy),
    w: sz.W,
    h: sz.D,
    side,
    doorX,
    doorY,
    built: false,
    houseSeed,
    fenceType: (['fence', 'hedge', 'wall'] as const)[(houseSeed >>> 8) % 3]!,
    houseZone,
    garden,
    farm,
    gate,
    driveway,
    fence,
  }
}

/** Lay as many parcels as fit along the spine, alternating both sides, at a fixed street pitch. */
function layParcels(t: Terrain, corridor: Corridor, sz: ParcelSize): Parcel[] {
  const pitch = sz.W + GAP
  const xs = [...corridor.colY.keys()].sort((a, b) => a - b)
  if (xs.length === 0) return []
  const claimed = new Set<string>()
  const parcels: Parcel[] = []
  let id = 1
  const perSide = { [-1]: 0, [1]: 0 } as Record<number, number>
  let lastPlacedX = -Infinity
  for (const x of xs) {
    if (x - lastPlacedX < pitch) continue
    const syStreet = corridor.colY.get(x)!
    let placed = false
    for (const side of [-1, 1] as const) {
      if (perSide[side]! >= MAX_PER_SIDE) continue
      const p = tryParcel(t, x, syStreet, side, sz, corridor, claimed, id)
      if (p) {
        parcels.push(p)
        perSide[side]!++
        id++
        placed = true
      }
    }
    if (placed) lastPlacedX = x
    if (perSide[-1]! >= MAX_PER_SIDE && perSide[1]! >= MAX_PER_SIDE) break
  }
  return parcels
}

/** Trim the spine to the span the parcels actually occupy (plus a short stub each end), then rebuild
 *  the carriageway + verge from the trimmed spine — so the lane hugs the homesteads instead of running
 *  off into the wilderness. */
function trimCorridor(t: Terrain, corridor: Corridor, parcels: Parcel[]): Corridor {
  if (parcels.length === 0) return corridor
  const xs = parcels.map((p) => p.x)
  const minX = Math.min(...xs) - 4, maxX = Math.max(...xs) + 4
  const spine = corridor.spine.filter((c) => c.x >= minX && c.x <= maxX)
  if (spine.length < 4) return corridor
  const spineSet = new Set(spine.map((c) => key(c.x, c.y)))
  const carriage = [...spine, ...dilate(t, spine, spineSet)]
  const carriageSet = new Set(carriage.map((c) => key(c.x, c.y)))
  const verge = dilate(t, carriage, carriageSet)
  return { ...corridor, spine, carriage, verge }
}

function assemble(corridor: Corridor, parcels: Parcel[]): Neighborhood {
  return { spine: corridor.spine, carriage: corridor.carriage, verge: corridor.verge, street: corridor.carriage, parcels, lots: parcels }
}

/** Lay out the homestead neighbourhood on the best dry ground a short walk from the colony core.
 *  Tries large parcels first, then compact, across several spine baselines, and keeps the layout that
 *  yields the most homesteads. Pure + deterministic from the terrain. */
export function makeNeighborhood(t: Terrain): Neighborhood {
  const lx = t.landing.x, ly = t.landing.y
  let best: { corridor: Corridor; parcels: Parcel[] } | null = null
  for (const sz of [BIG, COMPACT]) {
    const span = MAX_PER_SIDE * (sz.W + GAP) + 4
    for (const dy of [0, -7, 7, -13, 13, -19, 19, -25, 25]) {
      const corridor = buildCorridor(t, lx, ly + dy, span)
      if (!corridor) continue
      const parcels = layParcels(t, corridor, sz)
      if (!best || parcels.length > best.parcels.length) best = { corridor, parcels }
      if (parcels.length >= MAX_PER_SIDE * 2) break // a full band — good enough, stop early
    }
    if (best && best.parcels.length >= 2) return assemble(trimCorridor(t, best.corridor, best.parcels), best.parcels)
  }
  if (best) return assemble(trimCorridor(t, best.corridor, best.parcels), best.parcels)
  return { spine: [], carriage: [], verge: [], street: [], parcels: [], lots: [] }
}
