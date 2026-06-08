// A minecraft-style VOXEL house — a little cottage built from 1x1x1 blocks on a lot. Deterministic
// from a seed so each citizen's home is distinct: a floor slab, perimeter walls with a doorway facing
// the street and a window or two, a roof, and a bed + table inside. Pure geometry + a block KIND; the
// renderer colours each kind. We do not model walkable interiors yet (the operator said not that far
// ahead) — but the walls, bed and the inside things are all here as real blocks.
import { RNG } from '../engine/rng'

export type BlockKind = 'floor' | 'wall' | 'window' | 'roof' | 'door' | 'bed' | 'table'
export type DoorDir = 'n' | 's' | 'e' | 'w'

export interface Block {
  x: number // 0..w-1, east
  y: number // 0..d-1, south
  z: number // 0 floor, up
  kind: BlockKind
}

export interface VoxelHouse {
  w: number
  d: number
  wallH: number
  doorDir: DoorDir
  blocks: Block[]
}

/** The centre cell of the door edge for a given facing. */
function doorCell(w: number, d: number, dir: DoorDir): { x: number; y: number } {
  switch (dir) {
    case 'n': return { x: Math.floor(w / 2), y: 0 }
    case 's': return { x: Math.floor(w / 2), y: d - 1 }
    case 'e': return { x: w - 1, y: Math.floor(d / 2) }
    case 'w': return { x: 0, y: Math.floor(d / 2) }
  }
}

/** Build the block list for a house, deterministically from the seed, with the door facing doorDir. */
export function buildVoxelHouse(seed: number, doorDir: DoorDir = 's'): VoxelHouse {
  const rng = new RNG(((seed >>> 0) ^ 0x9e3779b9) >>> 0)
  const w = rng.pick([3, 4, 4])
  const d = rng.pick([3, 4, 4])
  const wallH = rng.pick([2, 2, 3])
  const blocks: Block[] = []
  const door = doorCell(w, d, doorDir)

  // floor slab
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) blocks.push({ x, y, z: 0, kind: 'floor' })

  // perimeter walls; the door cell is an opening (a single recessed door block at z=1, open above)
  for (let z = 1; z <= wallH; z++) {
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || x === w - 1 || y === 0 || y === d - 1
        if (!edge) continue
        if (x === door.x && y === door.y) {
          if (z === 1) blocks.push({ x, y, z, kind: 'door' }) // doorway: a door block at the base, open above
          continue
        }
        const corner = (x === 0 || x === w - 1) && (y === 0 || y === d - 1)
        const win = z === 1 && !corner && rng.chance(0.22)
        blocks.push({ x, y, z, kind: win ? 'window' : 'wall' })
      }
    }
  }

  // roof slab one level above the walls
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) blocks.push({ x, y, z: wallH + 1, kind: 'roof' })

  // inside things: a bed in a back corner (away from the door) and a table near the middle
  const bedX = door.x <= 1 ? w - 2 : 1
  const bedY = door.y <= 1 ? d - 2 : 1
  blocks.push({ x: clamp(bedX, 1, w - 2), y: clamp(bedY, 1, d - 2), z: 1, kind: 'bed' })
  blocks.push({ x: clamp(Math.floor(w / 2), 1, w - 2), y: clamp(Math.floor(d / 2), 1, d - 2), z: 1, kind: 'table' })

  return { w, d, wallH, doorDir, blocks }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Colours per block kind (renderer reads these). */
export const BLOCK_COLOR: Record<BlockKind, number> = {
  floor: 0x6b5a44,
  wall: 0xd9c2a0,
  window: 0x8fd0e6,
  roof: 0xb24a3a,
  door: 0x5a3a22,
  bed: 0x4d8fe0,
  table: 0x8a6a3a,
}
