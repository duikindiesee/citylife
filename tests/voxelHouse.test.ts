import { describe, it, expect } from 'vitest'
import { buildVoxelHouse, BLOCK_COLOR, type BlockKind } from '../src/colony/voxelHouse'

describe('voxel house — a block cottage', () => {
  it('has a floor, walls, a roof, a door, a bed and a table', () => {
    const h = buildVoxelHouse(123, 's')
    const kinds = new Set(h.blocks.map((b) => b.kind))
    for (const k of ['floor', 'wall', 'roof', 'door', 'bed', 'table'] as BlockKind[]) {
      expect(kinds.has(k)).toBe(true)
    }
  })

  it('the floor covers the whole footprint at z 0', () => {
    const h = buildVoxelHouse(123, 's')
    const floor = h.blocks.filter((b) => b.kind === 'floor')
    expect(floor.length).toBe(h.w * h.d)
    expect(floor.every((b) => b.z === 0)).toBe(true)
  })

  it('the doorway is a single opening — one door block, no wall above it', () => {
    const h = buildVoxelHouse(123, 's')
    const doors = h.blocks.filter((b) => b.kind === 'door')
    expect(doors.length).toBe(1)
    const dx = doors[0]!.x, dy = doors[0]!.y
    // no wall block sits in the door column (it is an opening)
    const wallInDoor = h.blocks.some((b) => b.kind === 'wall' && b.x === dx && b.y === dy)
    expect(wallInDoor).toBe(false)
  })

  it('all blocks sit within the footprint and below the roof', () => {
    const h = buildVoxelHouse(7, 'n')
    for (const b of h.blocks) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x).toBeLessThan(h.w)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeLessThan(h.d)
      expect(b.z).toBeGreaterThanOrEqual(0)
      expect(b.z).toBeLessThanOrEqual(h.wallH + 1)
    }
  })

  it('the bed and table are interior (not on the wall ring)', () => {
    const h = buildVoxelHouse(55, 'e')
    for (const b of h.blocks.filter((x) => x.kind === 'bed' || x.kind === 'table')) {
      expect(b.x).toBeGreaterThan(0)
      expect(b.x).toBeLessThan(h.w - 1)
      expect(b.y).toBeGreaterThan(0)
      expect(b.y).toBeLessThan(h.d - 1)
    }
  })

  it('is deterministic by seed + door direction', () => {
    expect(buildVoxelHouse(42, 's')).toEqual(buildVoxelHouse(42, 's'))
  })

  it('every block kind has a colour', () => {
    const h = buildVoxelHouse(1, 's')
    for (const b of h.blocks) expect(typeof BLOCK_COLOR[b.kind]).toBe('number')
  })
})
