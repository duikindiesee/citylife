// Spec 077 — the house COMPILER (P1). Turns a blueprint script into a fine micro-occupancy grid and
// then a back-compatible Block[] the existing instanced renderer can draw unchanged (the greedy mesher
// is the next slice, P2). Walls read as MASONRY by alternating two brick tints per course, and a wall
// can carry one to three storeys.
//
// DETERMINISM is mandatory: compileBlueprint is a pure function of (script, w, d, seed) with NO
// wall-clock and NO randomness anywhere. The seed is mixed with a strong integer hash so two citizens
// with nearby seeds never collide — but the mix is a fixed function, so identical inputs always yield
// byte-identical blocks.
import { parseBlueprint, type ParsedBlueprint, type Room } from './blueprintScript'
import type { Block, BlockKind, DoorDir } from './voxelHouse'

/** Sub-blocks per plot cell along each axis. 6 => 6x6 micro-cells per plot cell in plan, fine enough
 *  that a single brick is small and a wall is several courses tall. Tunable (the spec allows up to 8). */
export const HOUSE_VOXEL_N = 6

/** A soft compile-cost budget the compiled house stays under (occupancy memory + mesh-gen time). With
 *  P2 greedy meshing a house draws as ONE merged geometry regardless of block count, so this is no longer
 *  a draw-call cap — it just bounds how large a single house may get. A big 3-storey brick home on a large
 *  plot lands near 7000 micro-blocks, so the cap sits comfortably above that. */
export const HOUSE_VOXEL_BUDGET = 12000

export interface CompileOpts {
  /** houseZone width in plot cells (tiles along the street). */
  w: number
  /** houseZone depth in plot cells (tiles away from the street). */
  d: number
  /** citizen houseSeed — mixed with a strong hash so homes never collide yet stay deterministic. */
  seed: number
}

export interface CompiledHouse {
  /** Micro-grid extents (in sub-blocks). */
  gw: number
  gd: number
  gh: number
  /** Sub-blocks per plot cell (== HOUSE_VOXEL_N). */
  n: number
  /** Storeys the walls carry (1..3). */
  storeys: number
  /** The compiled, renderable blocks at micro resolution. */
  blocks: Block[]
}

// ── Deterministic hashing ──────────────────────────────────────────────────────
// A strong 32-bit integer hash (a fixed permutation of the classic finalisers). Pure: no randomness,
// no wall-clock — every bit of the output depends only on the input, so seeds never collide but the
// same seed always hashes the same.
function hash32(x: number): number {
  let h = x >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/** Mix the seed with two field tags into one deterministic 32-bit value. */
function mix(seed: number, a: number, b: number): number {
  return hash32((hash32(seed) ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 131, 0x85ebca77)) >>> 0)
}

// ── Compact occupancy grid ──────────────────────────────────────────────────────
// air = 0; every other kind gets a small integer code. The grid is a flat Uint8Array indexed
// (z*gd + y)*gw + x, so the whole house is one contiguous, cache-friendly buffer.
const KIND_CODE: Record<BlockKind, number> = {
  floor: 1, wall: 2, window: 3, roof: 4, door: 5, bed: 6, table: 7,
  soil: 8, crop: 9, cropAlt: 10, grass: 11, fence: 12, hedge: 13, stone: 14, path: 15, trunk: 16, leaf: 17, well: 18,
  brick: 19, brickAlt: 20, step: 21, beam: 22, glassRail: 23, water: 24, tile: 25, trim: 26, chimney: 27,
}
const CODE_KIND: BlockKind[] = (() => {
  const arr: BlockKind[] = ['floor'] // index 0 unused as a sentinel but filled to keep lookups total
  arr[0] = 'floor'
  for (const k of Object.keys(KIND_CODE) as BlockKind[]) arr[KIND_CODE[k]] = k
  return arr
})()

class Grid {
  readonly cells: Uint8Array
  constructor(readonly gw: number, readonly gd: number, readonly gh: number) {
    this.cells = new Uint8Array(gw * gd * gh)
  }
  private idx(x: number, y: number, z: number): number {
    return (z * this.gd + y) * this.gw + x
  }
  inB(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.gw && y < this.gd && z < this.gh
  }
  /** Place a kind, never overwriting an already-solid cell unless `force`. */
  set(x: number, y: number, z: number, kind: BlockKind, force = false): void {
    if (!this.inB(x, y, z)) return
    const i = this.idx(x, y, z)
    if (!force && this.cells[i] !== 0) return
    this.cells[i] = KIND_CODE[kind]
  }
  get(x: number, y: number, z: number): number {
    if (!this.inB(x, y, z)) return 0
    return this.cells[this.idx(x, y, z)]!
  }
  toBlocks(): Block[] {
    const out: Block[] = []
    for (let z = 0; z < this.gh; z++) {
      for (let y = 0; y < this.gd; y++) {
        for (let x = 0; x < this.gw; x++) {
          const c = this.cells[this.idx(x, y, z)]!
          if (c !== 0) out.push({ x, y, z, kind: CODE_KIND[c]! })
        }
      }
    }
    return out
  }
}

// ── Scaling: blueprint units -> plot cells ──────────────────────────────────────
/** Scale a blueprint coordinate from its own w/d grid onto the houseZone w/d tile count. Deterministic
 *  integer mapping (floor of a rational), so the scaled rooms tile the plot with no gaps or wall-clock. */
function scaleSpan(v: number, from: number, to: number): number {
  if (from <= 0) return 0
  return Math.round((v * to) / from)
}

interface ScaledRoom extends Room {
  // scaled to plot-cell coordinates
  px: number
  py: number
  pw: number
  pd: number
}

function scaleRooms(p: ParsedBlueprint, w: number, d: number): ScaledRoom[] {
  return p.rooms.map((r) => {
    const px = scaleSpan(r.x, p.w, w)
    const py = scaleSpan(r.y, p.d, d)
    let pw = scaleSpan(r.x + r.w, p.w, w) - px
    let pd = scaleSpan(r.y + r.d, p.d, d) - py
    pw = Math.max(1, Math.min(pw, w - px))
    pd = Math.max(1, Math.min(pd, d - py))
    return { ...r, px, py, pw, pd }
  })
}

// ── Brick coursing ──────────────────────────────────────────────────────────────
/** Pick the brick tint for a wall sub-block. Alternating by COURSE (the micro z row) gives a masonry
 *  banding; a per-position bond offset breaks the seams so it does not look like flat stripes. Pure: a
 *  fixed function of position and seed, no randomness. */
function brickAt(gx: number, gz: number, seed: number): BlockKind {
  const bond = gz & 1 // running-bond: every other course shifts half a brick
  const t = (gz + ((gx + bond) >> 1) + (mix(seed, gx, gz) & 1)) & 1
  return t === 0 ? 'brick' : 'brickAlt'
}

// ── The compiler ──────────────────────────────────────────────────────────────
/** Compile a blueprint script to a renderable micro-block house, deterministically from (w, d, seed).
 *  Builds: a floor slab, brick outer walls (1..3 storeys), inner room dividers, a street-facing door,
 *  framed windows, a roof, plus per-room flourishes (pool water + tile rim, patio tile + glassRail). */
export function compileBlueprint(script: string, opts: CompileOpts): CompiledHouse {
  const p = parseBlueprint(script)
  const w = Math.max(1, Math.floor(opts.w))
  const d = Math.max(1, Math.floor(opts.d))
  const seed = opts.seed >>> 0
  const n = HOUSE_VOXEL_N

  // Storeys: wallH carries 1..3 floors. Clamp so a runaway wallH can never blow the budget.
  const storeys = Math.max(1, Math.min(3, p.wallH))
  const wallSub = storeys * n // wall height in sub-blocks
  const floorSub = 1 // a one-sub-block floor slab
  const roofSub = 1
  const chimneySub = n // headroom above the roof for a chimney / peak
  const gw = w * n
  const gd = d * n
  const gh = floorSub + wallSub + roofSub + chimneySub
  const g = new Grid(gw, gd, gh)

  const rooms = scaleRooms(p, w, d)

  // The street-facing door cell on the relevant edge (in plot cells), centred deterministically.
  const door = doorCellPlot(w, d, p.doorDir, seed)
  const doorGx = door.x * n + Math.floor(n / 2) // micro column at the door centre

  // 1. FLOOR slab — covers the whole footprint at z 0.
  for (let gy = 0; gy < gd; gy++) for (let gx = 0; gx < gw; gx++) g.set(gx, gy, 0, 'floor')

  // 2. OUTER WALLS — brick masonry around the footprint, except where rooms are roofless (patio/pool).
  //    The door edge gets an opening; windows are punched into long wall runs.
  buildOuterWalls(g, w, d, n, storeys, p.doorDir, door, rooms, seed)

  // 3. INNER DIVIDERS — brick walls along room boundaries that fall inside the footprint.
  buildDividers(g, rooms, w, d, n, storeys, seed)

  // 4. ROOF slab one micro-level above the walls, over enclosed rooms only (patio/pool stay open).
  buildRoof(g, rooms, w, d, n, floorSub + wallSub, seed)

  // 5. ROOM FLOURISHES — pool water + tile rim, patio tile + glassRail, plus a chimney for a living room.
  buildRoomDetails(g, rooms, n, floorSub, wallSub, seed)

  // 6. DOOR LAST — carve the opening and seat a panelled door, overriding any wall/rail in the column so
  //    the entrance is always clear even when a patio rail or a room divider lands on the door edge.
  placeDoor(g, doorGx, door, p.doorDir, n, floorSub)

  return { gw, gd, gh, n, storeys, blocks: g.toBlocks() }
}

// The plot-cell door cell for a facing; the column is centred (deterministically) on the door edge.
function doorCellPlot(w: number, d: number, dir: DoorDir, _seed: number): { x: number; y: number } {
  switch (dir) {
    case 'n': return { x: Math.floor(w / 2), y: 0 }
    case 's': return { x: Math.floor(w / 2), y: d - 1 }
    case 'e': return { x: w - 1, y: Math.floor(d / 2) }
    case 'w': return { x: 0, y: Math.floor(d / 2) }
  }
}

/** Carve the door opening through the outer wall on the door edge and seat a panelled door at the base.
 *  The opening is a few sub-blocks wide and a bit over one course tall, so the wall is open above it. */
function placeDoor(g: Grid, doorGx: number, door: { x: number; y: number }, dir: DoorDir, n: number, floorSub: number): void {
  const half = Math.max(1, Math.floor(n / 3)) // door is ~a third of a cell wide
  const doorH = Math.min(2 * n - 1, n + Math.floor(n / 2)) // a door taller than one course
  if (dir === 'n' || dir === 's') {
    const cy = dir === 'n' ? 0 : door.y * n + n - 1
    for (let dx = -half; dx <= half; dx++) {
      const gx = doorGx + dx
      for (let z = floorSub; z < floorSub + doorH; z++) clear(g, gx, cy, z)
      g.set(gx, cy, floorSub, 'door', true)
    }
  } else {
    const cx = dir === 'w' ? 0 : door.x * n + n - 1
    const cyc = door.y * n + Math.floor(n / 2)
    for (let dy = -half; dy <= half; dy++) {
      const gy = cyc + dy
      for (let z = floorSub; z < floorSub + doorH; z++) clear(g, cx, gy, z)
      g.set(cx, gy, floorSub, 'door', true)
    }
  }
}

function clear(g: Grid, x: number, y: number, z: number): void {
  if (g.inB(x, y, z)) g.cells[(z * g.gd + y) * g.gw + x] = 0
}

/** True if a plot cell (cx,cy) lies inside a roofless room (patio or pool) — these get no walls/roof. */
function rooflessAt(rooms: ScaledRoom[], cx: number, cy: number): boolean {
  return rooms.some((r) => (r.kind === 'patio' || r.kind === 'pool') && cx >= r.px && cx < r.px + r.pw && cy >= r.py && cy < r.py + r.pd)
}

function buildOuterWalls(
  g: Grid, w: number, d: number, n: number, storeys: number, dir: DoorDir,
  door: { x: number; y: number }, rooms: ScaledRoom[], seed: number,
): void {
  const floorSub = 1
  const wallSub = storeys * n
  for (let cy = 0; cy < d; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const onEdge = cx === 0 || cx === w - 1 || cy === 0 || cy === d - 1
      if (!onEdge) continue
      if (rooflessAt(rooms, cx, cy)) continue // patios/pools have an open edge (low rail added later)
      // The micro rows/cols of this cell that lie on the outer face.
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const gx = cx * n + sx, gy = cy * n + sy
          const faceX = (cx === 0 && sx === 0) || (cx === w - 1 && sx === n - 1)
          const faceY = (cy === 0 && sy === 0) || (cy === d - 1 && sy === n - 1)
          if (!faceX && !faceY) continue
          for (let z = floorSub; z < floorSub + wallSub; z++) {
            // Window band: one course-high opening near eye level on each storey, away from corners.
            if (isWindow(gx, gy, z, w, d, n, floorSub, storeys, dir, door, seed)) {
              g.set(gx, gy, z, 'window')
              continue
            }
            g.set(gx, gy, z, brickAt(gx, z, seed))
          }
        }
      }
    }
  }
}

/** Window predicate: a small framed opening, deterministic, set into long wall runs at each storey's
 *  mid-height, never on a corner column and never on the door column. The run axis is chosen from the
 *  edge the sub-block sits on (top/bottom walls run along x, left/right walls run along y). */
function isWindow(
  gx: number, gy: number, z: number, w: number, d: number, n: number,
  floorSub: number, storeys: number, dir: DoorDir, door: { x: number; y: number }, seed: number,
): boolean {
  const within = z - floorSub
  const storey = Math.floor(within / n)
  if (storey >= storeys) return false
  const inStorey = within - storey * n
  if (inStorey !== Math.floor(n / 2)) return false // one course high, at the storey's mid-height
  const gwM = w * n, gdM = d * n
  // Which wall is this sub-block on? Pick the run axis accordingly.
  const onTopBottom = gy === 0 || gy === gdM - 1
  const onLeftRight = gx === 0 || gx === gwM - 1
  const along = onTopBottom ? gx : onLeftRight ? gy : -1
  if (along < 0) return false
  const runLen = onTopBottom ? gwM : gdM
  // skip the two end sub-blocks of the run so windows never sit on a corner
  if (along <= 1 || along >= runLen - 2) return false
  // skip the door column on the door wall so a window never lands over the door
  const doorGx = door.x * n + Math.floor(n / 2)
  if (onTopBottom && (dir === 'n' || dir === 's') && Math.abs(gx - doorGx) <= 1) return false
  // a regular window rhythm along the run, phase-shifted per storey by the seed
  const period = n + 1 // 7 with N=6 — windows spaced a bit over a cell apart
  const phase = mix(seed, storey, 0) % period
  return (along + phase) % period === Math.floor(period / 2)
}

function buildDividers(g: Grid, rooms: ScaledRoom[], w: number, d: number, n: number, storeys: number, seed: number): void {
  const floorSub = 1
  const wallSub = storeys * n
  for (const r of rooms) {
    if (r.kind === 'patio') continue // open-plan patio, no internal walls
    // Build the room's own perimeter walls (interior dividers); skip cells already on the outer ring,
    // skip a doorway gap so rooms connect, and leave garages without interior walls (a wide opening).
    if (r.kind === 'garage') continue
    const x0 = r.px * n, x1 = (r.px + r.pw) * n - 1
    const y0 = r.py * n, y1 = (r.py + r.pd) * n - 1
    // a deterministic interior doorway centre on the wall facing the house interior
    const gapAlong = (mix(seed, r.px, r.py) % Math.max(1, (x1 - x0))) + x0
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const onRoomEdge = gx === x0 || gx === x1 || gy === y0 || gy === y1
        if (!onRoomEdge) continue
        // leave a gap (an interior doorway) on the top wall so rooms are connected
        if (gy === y0 && Math.abs(gx - gapAlong) <= 1) continue
        for (let z = floorSub; z < floorSub + wallSub; z++) g.set(gx, gy, z, brickAt(gx, z, seed))
      }
    }
  }
}

function buildRoof(g: Grid, rooms: ScaledRoom[], w: number, d: number, n: number, roofZ: number, seed: number): void {
  // Enclosed footprint micro-bounds (patios/pools stay open to the sky).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let cy = 0; cy < d; cy++) {
    for (let cx = 0; cx < w; cx++) {
      if (rooflessAt(rooms, cx, cy)) continue
      minX = Math.min(minX, cx * n); maxX = Math.max(maxX, (cx + 1) * n - 1)
      minY = Math.min(minY, cy * n); maxY = Math.max(maxY, (cy + 1) * n - 1)
    }
  }
  if (!Number.isFinite(maxX)) return
  // A PEAKED (hipped) roof: each column rises toward the ridge by its distance to the nearest eave,
  // capped to a gentle pitch (~0.8 cell) so the roof crowns the walls without dominating them. A 2-thick
  // shell keeps the 45-degree slopes free of see-through gaps. This makes a home read as a house, not a box.
  const peakCap = Math.max(2, Math.round(0.8 * n))
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (rooflessAt(rooms, Math.floor(gx / n), Math.floor(gy / n))) continue
      const rise = Math.min(gx - minX, maxX - gx, gy - minY, maxY - gy, peakCap)
      const top = roofZ + rise
      g.set(gx, gy, top, 'roof')
      if (rise > 0) g.set(gx, gy, top - 1, 'roof')
    }
  }
  // A short chimney rising just above the ridge from one back corner of an enclosed room.
  const enclosed = rooms.filter((r) => r.kind === 'living' || r.kind === 'bedroom')
  if (enclosed.length > 0) {
    const idx = mix(seed, enclosed.length, 7) % enclosed.length
    const r = enclosed[idx]!
    const cgx = (r.px + r.pw - 1) * n + Math.floor(n / 2)
    const cgy = r.py * n + Math.floor(n / 2)
    const chimneyTop = roofZ + peakCap + Math.floor(n / 2)
    for (let z = roofZ; z <= chimneyTop; z++) g.set(cgx, cgy, z, 'chimney', true)
  }
}

function buildRoomDetails(g: Grid, rooms: ScaledRoom[], n: number, floorSub: number, wallSub: number, seed: number): void {
  for (const r of rooms) {
    const x0 = r.px * n, x1 = (r.px + r.pw) * n - 1
    const y0 = r.py * n, y1 = (r.py + r.pd) * n - 1
    if (r.kind === 'pool') {
      // Water fill with a tile rim one block in.
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const rim = gx === x0 || gx === x1 || gy === y0 || gy === y1
          g.set(gx, gy, floorSub - 1 >= 0 ? floorSub - 1 : 0, rim ? 'tile' : 'water', true)
          if (rim) g.set(gx, gy, floorSub, 'tile', true)
        }
      }
    } else if (r.kind === 'patio') {
      // Tile floor plus a low glassRail around the open edge.
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          g.set(gx, gy, floorSub - 1 >= 0 ? floorSub - 1 : 0, 'tile', true)
          const rim = gx === x0 || gx === x1 || gy === y0 || gy === y1
          if (rim) g.set(gx, gy, floorSub, 'glassRail', true)
        }
      }
    } else if (r.kind === 'living') {
      // a table near the middle and an exposed ceiling BEAM under the roof line for character
      const tx = Math.floor((x0 + x1) / 2), ty = Math.floor((y0 + y1) / 2)
      g.set(tx, ty, floorSub, 'table', true)
      const beamZ = floorSub + wallSub - 1 // the top course, just under the roof
      const phase = mix(seed, r.px, r.py) % 2
      for (let gx = x0 + 1; gx <= x1 - 1; gx++) if (((gx + phase) & 1) === 0) g.set(gx, ty, beamZ, 'beam', true)
    } else if (r.kind === 'bedroom') {
      // a bed in the back corner away from the door edge
      g.set(x0 + 1, y0 + 1, floorSub, 'bed', true)
    } else if (r.kind === 'garage') {
      // a wide opening on its street edge — a step threshold and a beam header above it
      const headerZ = floorSub + wallSub - 1
      for (let gx = x0; gx <= x1; gx++) {
        g.set(gx, y1, floorSub, 'step', true)
        g.set(gx, y1, headerZ, 'beam', true)
      }
    }
  }
}
