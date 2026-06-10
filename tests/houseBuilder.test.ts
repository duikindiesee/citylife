import { describe, it, expect } from 'vitest'
import { compileBlueprint, HOUSE_VOXEL_N, HOUSE_VOXEL_BUDGET } from '../src/colony/houseBuilder'
import { BLOCK_COLOR } from '../src/colony/voxelHouse'

// The canonical spec-077 example: a living + bedroom + patio home, door facing the street to the south.
const EXAMPLE =
  'house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}'

// A "typical" homestead house-zone from neighborhood.ts: BIG parcel => ~9 wide x 6 deep, seed from a lot.
const TYPICAL_OPTS = { w: 9, d: 6, seed: 0x1234abcd }

describe('house builder — the blueprint compiler (spec 077 P1)', () => {
  it('exposes the HOUSE_VOXEL_N tunable defaulting to 6', () => {
    expect(HOUSE_VOXEL_N).toBe(6)
  })

  it('compiles a blueprint into renderable blocks with the existing {x,y,z,kind} shape', () => {
    const h = compileBlueprint(EXAMPLE, TYPICAL_OPTS)
    expect(h.blocks.length).toBeGreaterThan(0)
    for (const b of h.blocks) {
      expect(Number.isInteger(b.x)).toBe(true)
      expect(Number.isInteger(b.y)).toBe(true)
      expect(Number.isInteger(b.z)).toBe(true)
      expect(typeof b.kind).toBe('string')
      // every block sits inside the micro grid
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x).toBeLessThan(h.gw)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeLessThan(h.gd)
      expect(b.z).toBeGreaterThanOrEqual(0)
      expect(b.z).toBeLessThan(h.gh)
    }
  })

  it('builds the expected architecture — floor, brick walls, a roof, a door and windows', () => {
    const h = compileBlueprint(EXAMPLE, TYPICAL_OPTS)
    const kinds = new Set(h.blocks.map((b) => b.kind))
    expect(kinds.has('floor')).toBe(true)
    expect(kinds.has('roof')).toBe(true)
    expect(kinds.has('door')).toBe(true)
    expect(kinds.has('window')).toBe(true)
    // walls read as masonry: both brick tints appear so the bond is visible
    expect(kinds.has('brick')).toBe(true)
    expect(kinds.has('brickAlt')).toBe(true)
  })

  it('scales rooms to the house-zone tile count (different w/d => different footprint)', () => {
    const small = compileBlueprint(EXAMPLE, { w: 6, d: 5, seed: 1 })
    const big = compileBlueprint(EXAMPLE, { w: 11, d: 7, seed: 1 })
    expect(small.gw).toBe(6 * HOUSE_VOXEL_N)
    expect(big.gw).toBe(11 * HOUSE_VOXEL_N)
    expect(big.blocks.length).toBeGreaterThan(small.blocks.length)
  })

  it('carries multi-storey — wallH 1..3 raises the wall band by one full storey each', () => {
    const one = compileBlueprint('house{w:5 d:5 wallH:1 door:s} room{kind:living x:0 y:0 w:5 d:5 win:1}', { w: 7, d: 6, seed: 9 })
    const three = compileBlueprint('house{w:5 d:5 wallH:3 door:s} room{kind:living x:0 y:0 w:5 d:5 win:1}', { w: 7, d: 6, seed: 9 })
    expect(one.storeys).toBe(1)
    expect(three.storeys).toBe(3)
    expect(three.gh).toBeGreaterThan(one.gh)
    // a taller house has more wall blocks
    const wallsOne = one.blocks.filter((b) => b.kind === 'brick' || b.kind === 'brickAlt').length
    const wallsThree = three.blocks.filter((b) => b.kind === 'brick' || b.kind === 'brickAlt').length
    expect(wallsThree).toBeGreaterThan(wallsOne)
  })

  it('caps wallH at 3 storeys so a runaway wallH cannot blow the grid', () => {
    const huge = compileBlueprint('house{w:5 d:5 wallH:99 door:s} room{kind:living x:0 y:0 w:5 d:5 win:1}', { w: 7, d: 6, seed: 2 })
    expect(huge.storeys).toBe(3)
  })

  it('stays under the voxel budget for a typical house', () => {
    const h = compileBlueprint(EXAMPLE, TYPICAL_OPTS)
    expect(h.blocks.length).toBeLessThan(HOUSE_VOXEL_BUDGET)
  })

  it('stays under the voxel budget for the worst real case (a 3-storey home on a BIG plot)', () => {
    // The in-game default blueprint picks wallH 3 for some seeds; on the BIG house-zone (9 wide x 6 deep)
    // this is the largest house the colony actually raises, so it must also fit under the budget.
    const script = 'house{w:6 d:5 wallH:3 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}'
    const h = compileBlueprint(script, { w: 9, d: 6, seed: 12345 })
    expect(h.blocks.length).toBeLessThan(HOUSE_VOXEL_BUDGET)
  })

  it('every emitted block kind has a colour in BLOCK_COLOR', () => {
    const h = compileBlueprint(EXAMPLE, TYPICAL_OPTS)
    for (const b of h.blocks) expect(typeof BLOCK_COLOR[b.kind]).toBe('number')
  })

  it('is DETERMINISTIC — identical inputs yield byte-identical blocks across two calls', () => {
    const a = compileBlueprint(EXAMPLE, TYPICAL_OPTS)
    const b = compileBlueprint(EXAMPLE, TYPICAL_OPTS)
    expect(a.blocks.length).toBe(b.blocks.length)
    expect(a.blocks).toEqual(b.blocks)
    // a stable serialisation is identical too (catches any ordering nondeterminism)
    const ser = (blocks: typeof a.blocks) => blocks.map((x) => `${x.x},${x.y},${x.z},${x.kind}`).join('|')
    expect(ser(a.blocks)).toBe(ser(b.blocks))
  })

  it('different seeds never collide — the seed actually varies the house', () => {
    const a = compileBlueprint(EXAMPLE, { w: 9, d: 6, seed: 1 })
    const b = compileBlueprint(EXAMPLE, { w: 9, d: 6, seed: 2 })
    const ser = (blocks: typeof a.blocks) => blocks.map((x) => `${x.x},${x.y},${x.z},${x.kind}`).join('|')
    expect(ser(a.blocks)).not.toBe(ser(b.blocks))
  })

  it('CARVE semantics — a pool dropped onto a bedroom takes the cells: no full-height brick, no roof above', () => {
    // bedroom fills the plot; a pool overlaps its back-right corner, touching the house edge.
    const script =
      'house{w:6 d:6 wallH:2 door:n} room{kind:bedroom x:0 y:0 w:6 d:6 win:1} room{kind:pool x:4 y:4 w:2 d:2 win:0}'
    const h = compileBlueprint(script, { w: 6, d: 6, seed: 7 })
    const n = HOUSE_VOXEL_N
    const gardenH = Math.max(2, Math.floor(n / 3))
    // pool plot-cells 4..5 x 4..5 -> micro columns 24..35 in both axes
    const inPool = (b: { x: number; y: number }) => b.x >= 4 * n && b.x < 6 * n && b.y >= 4 * n && b.y < 6 * n
    const poolBlocks = h.blocks.filter(inPool)
    expect(poolBlocks.some((b) => b.kind === 'water')).toBe(true)
    // nothing in the pool's columns rises above the low garden wall — no shaft, no roof overhang
    const tallest = Math.max(...poolBlocks.map((b) => b.z))
    expect(tallest).toBeLessThanOrEqual(1 + gardenH)
    expect(poolBlocks.some((b) => b.kind === 'roof')).toBe(false)
  })

  it('emits roofless rooms — a pool fills with water and a patio gets a tile floor and glass rail', () => {
    const script =
      'house{w:6 d:6 wallH:2 door:s} room{kind:living x:0 y:0 w:6 d:3 win:1} room{kind:pool x:0 y:3 w:3 d:3 win:0} room{kind:patio x:3 y:3 w:3 d:3 win:0}'
    const h = compileBlueprint(script, { w: 9, d: 7, seed: 5 })
    const kinds = new Set(h.blocks.map((b) => b.kind))
    expect(kinds.has('water')).toBe(true)
    expect(kinds.has('tile')).toBe(true)
    expect(kinds.has('glassRail')).toBe(true)
  })
})
