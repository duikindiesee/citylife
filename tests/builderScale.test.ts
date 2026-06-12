import { describe, it, expect } from 'vitest'
import { compileBlueprint, HOUSE_VOXEL_BUDGET } from '../src/colony/houseBuilder'
import { validateBlueprint, parseBlueprint } from '../src/colony/blueprintScript'
import { addRoom } from '../src/colony/builder/blueprintEdit'
import { defaultBlueprint } from '../src/colony/neighborhood'

// Spec 084 S4 — the builder pipeline adapts to estate-sized plots and the voxel budget grows
// teeth: validateBlueprint caps what a bot may ASK for, compileBlueprint enforces what may BUILD.

const FULL_GRAND =
  'house{w:23 d:16 wallH:3 door:s} room{kind:living x:0 y:0 w:14 d:10 win:1} room{kind:bedroom x:14 y:0 w:9 d:5 win:1} room{kind:bedroom x:14 y:5 w:9 d:5 win:1} room{kind:garage x:0 y:10 w:6 d:6 win:0} room{kind:patio x:6 y:10 w:11 d:6 win:0} room{kind:pool x:17 y:10 w:6 d:6 win:0}'

describe('spec 084 S4 — caps + the enforced voxel budget', () => {
  it('the GRAND worst case (23x16 zone, 3 storeys, full-zone rooms) compiles UNDER the budget', () => {
    expect(validateBlueprint(FULL_GRAND).ok).toBe(true)
    const compiled = compileBlueprint(FULL_GRAND, { w: 23, d: 16, seed: 7 })
    expect(compiled.blocks.length).toBeGreaterThan(10000) // it really is a big house
    expect(compiled.blocks.length).toBeLessThanOrEqual(HOUSE_VOXEL_BUDGET)
  })

  it('a zone whose floor slab alone busts the budget refuses to compile', () => {
    const small = 'house{w:6 d:5 wallH:1 door:s} room{kind:living x:0 y:0 w:6 d:5 win:1}'
    expect(() => compileBlueprint(small, { w: 50, d: 50, seed: 1 })).toThrow(/voxel budget/)
  })

  it('validateBlueprint rejects beyond the caps: w/d 24, wallH 3, 16 rooms', () => {
    expect(validateBlueprint('house{w:25 d:5 wallH:1 door:s} room{kind:living x:0 y:0 w:25 d:5 win:1}').ok).toBe(false)
    expect(validateBlueprint('house{w:6 d:5 wallH:4 door:s} room{kind:living x:0 y:0 w:6 d:5 win:1}').ok).toBe(false)
    const seventeen = Array.from({ length: 17 }, () => 'room{kind:living x:0 y:0 w:2 d:2 win:1}').join(' ')
    expect(validateBlueprint(`house{w:6 d:5 wallH:1 door:n} ${seventeen}`).ok).toBe(false)
    // at the caps exactly is fine
    expect(validateBlueprint('house{w:24 d:24 wallH:3 door:s} room{kind:living x:0 y:0 w:24 d:24 win:1}').ok).toBe(true)
  })

  it('addRoom spawns 3x3 on estate footprints and stays 2x2 on cottages', () => {
    const cottage = parseBlueprint('house{w:6 d:5 wallH:1 door:s} room{kind:living x:0 y:0 w:6 d:5 win:1}')
    const estate = parseBlueprint('house{w:14 d:10 wallH:1 door:s} room{kind:living x:0 y:0 w:14 d:10 win:1}')
    const c = addRoom(cottage, 'bedroom').rooms.at(-1)!
    const e = addRoom(estate, 'bedroom').rooms.at(-1)!
    expect([c.w, c.d]).toEqual([2, 2])
    expect([e.w, e.d]).toEqual([3, 3])
  })

  it('defaultBlueprint authors finer footprints for estate zones, classic ones otherwise — all valid', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const dir of ['n', 's'] as const) {
        const classic = parseBlueprint(defaultBlueprint(seed, dir))
        const large = parseBlueprint(defaultBlueprint(seed, dir, 19))
        expect(classic.w).toBeLessThanOrEqual(7)
        expect(large.w).toBeGreaterThanOrEqual(9)
        expect(validateBlueprint(defaultBlueprint(seed, dir, 19)).ok, `seed ${seed} ${dir}`).toBe(true)
      }
    }
  })

  it('large-zone defaults compile + carry a carved door at estate scale', () => {
    for (const seed of [3, 11, 42]) {
      const script = defaultBlueprint(seed, 'n', 19)
      const compiled = compileBlueprint(script, { w: 19, d: 14, seed })
      expect(compiled.blocks.some((b) => b.kind === 'door')).toBe(true)
      expect(compiled.blocks.length).toBeLessThanOrEqual(HOUSE_VOXEL_BUDGET)
    }
  })
})
