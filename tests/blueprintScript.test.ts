import { describe, it, expect } from 'vitest'
import { parseBlueprint, blueprintToScript, validateBlueprint, ROOM_KINDS, type ParsedBlueprint } from '../src/colony/blueprintScript'

// The canonical example from spec 077 section 3.1.
const EXAMPLE =
  'house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}'

describe('blueprint DSL — parse, serialise, validate', () => {
  it('parses the canonical spec example', () => {
    const p = parseBlueprint(EXAMPLE)
    expect(p.w).toBe(6)
    expect(p.d).toBe(5)
    expect(p.wallH).toBe(2)
    expect(p.doorDir).toBe('s')
    expect(p.rooms).toHaveLength(3)
    expect(p.rooms[0]).toEqual({ kind: 'living', x: 0, y: 0, w: 4, d: 3, win: true })
    expect(p.rooms[2]).toEqual({ kind: 'patio', x: 0, y: 3, w: 6, d: 2, win: false })
  })

  it('round-trips losslessly (script -> parsed -> script and back)', () => {
    expect(blueprintToScript(parseBlueprint(EXAMPLE))).toBe(EXAMPLE)
    const p = parseBlueprint(EXAMPLE)
    expect(parseBlueprint(blueprintToScript(p))).toEqual(p)
  })

  it('serialises every room kind round-trip', () => {
    for (const kind of ROOM_KINDS) {
      const script = `house{w:5 d:5 wallH:2 door:n} room{kind:${kind} x:0 y:0 w:5 d:5 win:0}`
      expect(blueprintToScript(parseBlueprint(script))).toBe(script)
    }
  })

  it('throws on malformed input', () => {
    expect(() => parseBlueprint('nonsense')).toThrow(/missing house header/)
    expect(() => parseBlueprint('house{w:6 d:5 wallH:2 door:z}')).toThrow(/door must be one of/)
    expect(() => parseBlueprint('house{w:6 d:5 door:s}')).toThrow(/missing wallH/)
    expect(() => parseBlueprint('house{w:six d:5 wallH:2 door:s}')).toThrow(/must be an integer/)
    expect(() => parseBlueprint('house{w:6 d:5 wallH:2 door:s} room{kind:dungeon x:0 y:0 w:2 d:2 win:0}')).toThrow(/room kind must be one of/)
  })

  it('validate accepts a good blueprint and estimates materials', () => {
    const r = validateBlueprint(EXAMPLE)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.estMaterials).toBeGreaterThan(0)
  })

  it('validate catches a room that escapes the house bounds (un-enclosed)', () => {
    // bedroom runs to x=5 on a 4-wide house -> escapes
    const bad = 'house{w:4 d:4 wallH:2 door:s} room{kind:living x:0 y:0 w:5 d:4 win:0}'
    const r = validateBlueprint(bad)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /escapes the house bounds/.test(e))).toBe(true)
  })

  it('validate catches an unreachable door (no room on the door edge)', () => {
    // door faces south but the only room hugs the north edge
    const bad = 'house{w:5 d:6 wallH:2 door:s} room{kind:living x:0 y:0 w:5 d:2 win:0}'
    const r = validateBlueprint(bad)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /door not reachable/.test(e))).toBe(true)
  })

  it('validate rejects a roomless house and non-positive dimensions', () => {
    expect(validateBlueprint('house{w:6 d:5 wallH:2 door:s}').ok).toBe(false)
    expect(validateBlueprint('house{w:0 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:0 d:0 win:0}').ok).toBe(false)
  })

  it('is deterministic — same script yields the identical validation', () => {
    expect(validateBlueprint(EXAMPLE)).toEqual(validateBlueprint(EXAMPLE))
    const a: ParsedBlueprint = parseBlueprint(EXAMPLE)
    const b: ParsedBlueprint = parseBlueprint(EXAMPLE)
    expect(a).toEqual(b)
  })
})
