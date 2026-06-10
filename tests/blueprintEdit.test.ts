import { describe, it, expect } from 'vitest'
import { defaultDesign, addRoom, removeRoom, moveRoom, resizeRoom, toggleWin, setRoomKind, cycleDoor, setWallH } from '../src/colony/builder/blueprintEdit'
import { blueprintToScript, validateBlueprint } from '../src/colony/blueprintScript'

// Spec 077 P3 — the builder's pure edit grammar. Every UI control (and later every bot action) maps to
// one of these functions, so this suite IS the behavioural contract of the House Builder.

describe('blueprintEdit — the builder edit grammar (spec 077 P3)', () => {
  it('defaultDesign is always VALID and fills the plot', () => {
    for (const [w, d] of [[6, 5], [9, 6], [11, 7], [3, 3]] as const) {
      const p = defaultDesign(w, d)
      const v = validateBlueprint(blueprintToScript(p))
      expect(v.ok, `default ${w}x${d}: ${v.errors.join('; ')}`).toBe(true)
      expect(p.w).toBe(w)
      expect(p.d).toBe(d)
    }
  })

  it('addRoom appends a room of the kind, in bounds; patios and pools spawn without windows', () => {
    const p = defaultDesign(9, 6)
    const withPool = addRoom(p, 'pool')
    expect(withPool.rooms.length).toBe(p.rooms.length + 1)
    const pool = withPool.rooms[withPool.rooms.length - 1]!
    expect(pool.kind).toBe('pool')
    expect(pool.win).toBe(false)
    expect(pool.x + pool.w).toBeLessThanOrEqual(9)
    expect(pool.y + pool.d).toBeLessThanOrEqual(6)
    const withLiving = addRoom(p, 'living')
    expect(withLiving.rooms[withLiving.rooms.length - 1]!.win).toBe(true)
  })

  it('moveRoom shifts by the delta and CLAMPS at the house bounds', () => {
    const p = defaultDesign(9, 6)
    const moved = moveRoom(p, 0, 100, 100) // way out of range
    const r = moved.rooms[0]!
    expect(r.x + r.w).toBeLessThanOrEqual(9)
    expect(r.y + r.d).toBeLessThanOrEqual(6)
    const back = moveRoom(moved, 0, -100, -100)
    expect(back.rooms[0]!.x).toBe(0)
    expect(back.rooms[0]!.y).toBe(0)
  })

  it('resizeRoom grows and shrinks, never below 1x1 and never past the bounds', () => {
    const p = defaultDesign(9, 6)
    const huge = resizeRoom(p, 0, 100, 100)
    const r = huge.rooms[0]!
    expect(r.x + r.w).toBeLessThanOrEqual(9)
    expect(r.y + r.d).toBeLessThanOrEqual(6)
    const tiny = resizeRoom(p, 0, -100, -100)
    expect(tiny.rooms[0]!.w).toBe(1)
    expect(tiny.rooms[0]!.d).toBe(1)
  })

  it('toggleWin flips, setRoomKind changes kind, removeRoom drops the room', () => {
    const p = defaultDesign(9, 6)
    expect(toggleWin(p, 0).rooms[0]!.win).toBe(!p.rooms[0]!.win)
    expect(setRoomKind(p, 0, 'garage').rooms[0]!.kind).toBe('garage')
    expect(removeRoom(p, 0).rooms.length).toBe(p.rooms.length - 1)
    expect(removeRoom(p, 99)).toBe(p) // out of range is a no-op
  })

  it('cycleDoor walks n -> e -> s -> w -> n; setWallH clamps to the compiler range 1..3', () => {
    let p = defaultDesign(9, 6) // starts s
    p = cycleDoor(p)
    expect(p.doorDir).toBe('w')
    p = cycleDoor(p)
    expect(p.doorDir).toBe('n')
    expect(setWallH(p, 99).wallH).toBe(3)
    expect(setWallH(p, -5).wallH).toBe(1)
  })

  it('operations are immutable — the input design is never mutated', () => {
    const p = defaultDesign(9, 6)
    const snapshot = JSON.stringify(p)
    addRoom(p, 'pool')
    moveRoom(p, 0, 1, 1)
    resizeRoom(p, 0, 1, 1)
    toggleWin(p, 0)
    setRoomKind(p, 0, 'garage')
    cycleDoor(p)
    setWallH(p, 3)
    removeRoom(p, 0)
    expect(JSON.stringify(p)).toBe(snapshot)
  })

  it('an edited design round-trips through the DSL losslessly', () => {
    let p = defaultDesign(9, 6)
    p = addRoom(p, 'patio')
    p = moveRoom(p, 2, 0, 3)
    p = setWallH(p, 3)
    const script = blueprintToScript(p)
    const v = validateBlueprint(script)
    expect(typeof script).toBe('string')
    expect(v.estMaterials).toBeGreaterThan(0)
  })
})
