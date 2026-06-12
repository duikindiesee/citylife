import { describe, it, expect, beforeEach } from 'vitest'
import { loadBlueprintsLocal, saveBlueprintLocal, clearBlueprintsLocal, mergeBlueprints } from '../src/colony/bot/blueprintStore'

// Spec 077 P4.5 — blueprint persistence. A stored DSL script must round-trip localStorage exactly
// (the script IS the house — the compiler is deterministic), and the store must refuse anything
// unsafe or invalid so a corrupt entry can never reach the compiler or the backend.

const VALID =
  'house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}'

// node has no localStorage — a tiny in-memory shim with the same surface
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v)
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemStorage()
})

describe('blueprintStore — persistence + safety (spec 077 P4.5)', () => {
  it('round-trips a valid design exactly — the script that comes back is the script that went in', () => {
    expect(saveBlueprintLocal('lot_4', 'citizen_joe', VALID)).toBe(true)
    const map = loadBlueprintsLocal()
    expect(map['lot_4']).toEqual({ citizenId: 'citizen_joe', script: VALID })
  })

  it('stores designs for multiple lots independently and clear wipes them all', () => {
    saveBlueprintLocal('lot_1', 'citizen_a', VALID)
    saveBlueprintLocal('lot_2', 'citizen_b', VALID)
    expect(Object.keys(loadBlueprintsLocal()).sort()).toEqual(['lot_1', 'lot_2'])
    clearBlueprintsLocal()
    expect(loadBlueprintsLocal()).toEqual({})
  })

  it('REFUSES an invalid script on save — garbage never lands in storage', () => {
    expect(saveBlueprintLocal('lot_1', 'citizen_a', 'garbage{not a blueprint}')).toBe(false)
    expect(loadBlueprintsLocal()).toEqual({})
  })

  it('REFUSES an unsafe script on save (public-safety denylist)', () => {
    // a script that smuggles a denied token would fail isPublicSafe even if it parsed
    expect(saveBlueprintLocal('lot_1', 'citizen_a', VALID + ' secret token')).toBe(false)
  })

  it('drops corrupt entries on LOAD too — storage tampering cannot reach the compiler', () => {
    ;(globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(
      'citylife.blueprints.v2', // the WORLD v2 store key (084 S6)
      JSON.stringify({ lot_9: { citizenId: 'x', script: 'broken{' }, lot_4: { citizenId: 'citizen_joe', script: VALID } }),
    )
    const map = loadBlueprintsLocal()
    expect(map['lot_9']).toBeUndefined()
    expect(map['lot_4']?.script).toBe(VALID)
  })

  it('mergeBlueprints — backend wins over local, local fills the gaps, null backend is a no-op', () => {
    const local = { lot_1: { citizenId: 'a', script: VALID }, lot_2: { citizenId: 'b', script: VALID } }
    const backendScript = VALID.replace('wallH:2', 'wallH:3')
    const backend = { lot_2: { citizenId: 'b', script: backendScript } }
    const merged = mergeBlueprints(local, backend)
    expect(merged['lot_1']!.script).toBe(VALID)
    expect(merged['lot_2']!.script).toBe(backendScript)
    expect(mergeBlueprints(local, null)).toEqual(local)
  })
})
