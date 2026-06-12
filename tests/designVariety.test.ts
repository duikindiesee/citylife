import { describe, it, expect } from 'vitest'
import { defaultBlueprint } from '../src/colony/neighborhood'
import { validateBlueprint } from '../src/colony/blueprintScript'
import { compileBlueprint } from '../src/colony/houseBuilder'

// Spec 077 P5 — NO TWO HOUSES ALIKE. The per-citizen design generator must produce a VALID design
// for every seed and visibly different designs across seeds: different compiled block sets, several
// distinct archetypes/footprints/storey counts across a street-sized sample.

const ZONE = { w: 9, d: 6 } // the BIG homestead house-zone the street actually uses

function seeds(n: number): number[] {
  // a spread of realistic houseSeed values (the parcel seeder XORs large primes — emulate that)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((((i + 1) * 73856093) ^ ((i * 7 + 3) * 19349663)) >>> 0)
  return out
}

describe('design variety — every citizen designs their own home (spec 077 P5)', () => {
  it('every generated design is VALID for both street-facing door directions', () => {
    for (const s of seeds(40)) {
      for (const dir of ['n', 's'] as const) {
        const bp = defaultBlueprint(s, dir)
        const v = validateBlueprint(bp)
        expect(v.ok, `seed ${s} door ${dir}: ${v.errors.join('; ')}`).toBe(true)
      }
    }
  })

  it('24 seeds compile to 24 DISTINCT houses (no two block sets identical)', () => {
    const sigs = new Set<string>()
    for (const s of seeds(24)) {
      const h = compileBlueprint(defaultBlueprint(s, 's'), { w: ZONE.w, d: ZONE.d, seed: s })
      const sig = h.blocks.map((b) => `${b.x},${b.y},${b.z},${b.kind}`).join('|')
      expect(sigs.has(sig), `seed ${s} duplicates an earlier house`).toBe(false)
      sigs.add(sig)
    }
    expect(sigs.size).toBe(24)
  })

  it('the street sample is visibly DIVERSE — multiple footprints, storey counts and room mixes', () => {
    const footprints = new Set<string>()
    const storeys = new Set<number>()
    const mixes = new Set<string>()
    for (const s of seeds(24)) {
      const bp = defaultBlueprint(s, 's')
      const fw = /house\{w:(\d+) d:(\d+)/.exec(bp)!
      footprints.add(`${fw[1]}x${fw[2]}`)
      storeys.add(Number(/wallH:(\d+)/.exec(bp)![1]))
      const kinds = [...bp.matchAll(/kind:(\w+)/g)].map((m) => m[1]).sort().join(',')
      mixes.add(kinds)
    }
    expect(footprints.size, `footprints seen: ${[...footprints].join(' ')}`).toBeGreaterThanOrEqual(3)
    expect(storeys.size).toBe(2) // both 1- and 2-storey homes appear
    expect(mixes.size, `room mixes seen: ${mixes.size}`).toBeGreaterThanOrEqual(4) // several archetypes appear
  })

  it('is deterministic — the same seed + door always yields the identical script', () => {
    for (const s of seeds(6)) {
      expect(defaultBlueprint(s, 's')).toBe(defaultBlueprint(s, 's'))
      expect(defaultBlueprint(s, 'n')).toBe(defaultBlueprint(s, 'n'))
    }
  })

  it('south-door designs keep the yard at the back — no pool or patio touches the street edge', () => {
    for (const s of seeds(40)) {
      const bp = defaultBlueprint(s, 's')
      const d = Number(/house\{w:\d+ d:(\d+)/.exec(bp)![1])
      for (const m of bp.matchAll(/room\{kind:(pool|patio) x:\d+ y:(\d+) w:\d+ d:(\d+)/g)) {
        const yEnd = Number(m[2]) + Number(m[3])
        expect(yEnd, `seed ${s}: ${m[1]} reaches the street edge`).toBeLessThan(d)
      }
    }
  })
})
