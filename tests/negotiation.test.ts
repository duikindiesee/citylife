import { describe, it, expect } from 'vitest'
import { dreamBrief, priceBrief, negotiate, briefToBlueprint, type Brief } from '../src/colony/builder/negotiation'
import { parseBlueprint, validateBlueprint } from '../src/colony/blueprintScript'
import { isPublicSafe } from '../src/colony/newcomers'

// Spec 083 P1 — the negotiation engine: dream/quote/rounds as pure deterministic functions. The
// dream derives from the citizen's seed, the quote is a pure function of the brief, the capped
// convergence (trim the dream, concede the margin, meet in the middle or walk) replays identically
// for the same seeds, and every agreed brief compiles to a blueprint the spec 077 pipeline accepts.

const ZONE = { w: 9, d: 6 } // the BIG homestead house-zone the street actually uses

function seeds(n: number): number[] {
  // a spread of realistic houseSeed values (the parcel seeder XORs large primes — emulate that)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((((i + 1) * 73856093) ^ ((i * 7 + 3) * 19349663)) >>> 0)
  return out
}

describe('builder negotiation — the pure deterministic engine (spec 083 P1)', () => {
  it('is deterministic — the same seeds and budget replay the identical session', () => {
    for (const s of seeds(8)) {
      const dream = dreamBrief(s, ZONE, 's')
      expect(dreamBrief(s, ZONE, 's')).toEqual(dream)
      expect(briefToBlueprint(dream, s)).toBe(briefToBlueprint(dream, s))
      const budget = 150 + (s % 400)
      const a = negotiate({ clientSeed: s, builderSeed: (s ^ 0xbeef) >>> 0, dream, budget })
      const b = negotiate({ clientSeed: s, builderSeed: (s ^ 0xbeef) >>> 0, dream, budget })
      expect(a).toEqual(b)
    }
  })

  it('priceBrief is pure and monotonic in bedrooms and floor area', () => {
    const base: Brief = { w: 5, d: 4, storeys: 1, bedrooms: 1, outdoor: 'none', doorDir: 's' }
    expect(priceBrief(base)).toBe(80 + 6 * 20 + 30) // the spec formula, spot-checked
    let prev = priceBrief(base)
    for (const bedrooms of [2, 3, 4]) {
      const p = priceBrief({ ...base, bedrooms })
      expect(p).toBeGreaterThan(prev)
      prev = p
    }
    expect(priceBrief({ ...base, w: 6 })).toBeGreaterThan(priceBrief(base))
    expect(priceBrief({ ...base, d: 5 })).toBeGreaterThan(priceBrief(base))
    expect(priceBrief({ ...base, storeys: 2 })).toBe(priceBrief(base) + 50)
    expect(priceBrief({ ...base, outdoor: 'pool' })).toBeGreaterThan(priceBrief({ ...base, outdoor: 'patio' }))
    expect(priceBrief({ ...base, outdoor: 'patio' })).toBeGreaterThan(priceBrief(base))
  })

  it('a generous budget agrees in the opening round at the first quote', () => {
    for (const s of seeds(10)) {
      const dream = dreamBrief(s, ZONE, 'n')
      const session = negotiate({ clientSeed: s, builderSeed: s + 7, dream, budget: 10000 })
      expect(session.state).toBe('agreed')
      expect(session.rounds.length).toBe(2) // one quote, one acceptance
      expect(session.rounds[0]!.who).toBe('viw')
      expect(session.rounds[1]!.who).toBe('client')
      expect(session.agreedPrice).toBe(session.rounds[0]!.price)
      expect(session.agreedBrief).toEqual(dream) // nothing was trimmed off the dream
      // the opening quote carries the seeded 1.15-1.35 margin over the pure price
      const margin = session.rounds[0]!.price / priceBrief(dream)
      expect(margin).toBeGreaterThanOrEqual(1.14)
      expect(margin).toBeLessThanOrEqual(1.36)
    }
  })

  it('a stingy budget trims to an agreement or walks within the round caps', () => {
    for (const s of seeds(30)) {
      const dream = dreamBrief(s, ZONE, 's')
      const session = negotiate({ clientSeed: s, builderSeed: ~s >>> 0, dream, budget: 80 + (s % 200) })
      expect(session.rounds.filter((r) => r.who === 'viw').length).toBeLessThanOrEqual(3)
      expect(session.rounds.filter((r) => r.who === 'client').length).toBeLessThanOrEqual(3)
      session.rounds.forEach((r, i) => expect(r.who).toBe(i % 2 === 0 ? 'viw' : 'client'))
      expect(['agreed', 'walked']).toContain(session.state)
      if (session.state === 'agreed') {
        // trimming only ever makes the dream cheaper, never grander
        expect(priceBrief(session.agreedBrief!)).toBeLessThanOrEqual(priceBrief(dream))
        expect(session.agreedBrief!.bedrooms).toBeGreaterThanOrEqual(1)
      } else {
        expect(session.agreedBrief).toBeUndefined()
        expect(session.agreedPrice).toBeUndefined()
      }
    }
  })

  it('an impossible budget walks away with all six rounds spoken', () => {
    const dream = dreamBrief(424242, ZONE, 's')
    const session = negotiate({ clientSeed: 1, builderSeed: 2, dream, budget: 10 })
    expect(session.state).toBe('walked')
    expect(session.rounds.length).toBe(6)
    expect(session.agreedPrice).toBeUndefined()
  })

  it('the meet-in-the-middle close fires when the final gap is inside ten percent', () => {
    let middles = 0
    for (const s of seeds(40)) {
      const dream = dreamBrief(s, ZONE, 's')
      const fair = priceBrief(dream)
      for (const stretch of [0.85, 0.9, 0.95, 1.0]) {
        const budget = Math.round(fair * stretch)
        const session = negotiate({ clientSeed: s, builderSeed: s + 99, dream, budget })
        // an agreed price ABOVE the budget can only come from the midpoint close
        if (session.state === 'agreed' && session.agreedPrice! > budget) {
          middles++
          const lastQuote = [...session.rounds].reverse().find((r) => r.who === 'viw')!
          expect(session.agreedPrice!).toBeLessThanOrEqual(lastQuote.price)
          expect(session.agreedPrice!).toBeGreaterThanOrEqual(budget)
        }
      }
    }
    expect(middles).toBeGreaterThan(0)
  })

  it('briefToBlueprint validates, holds the bedroom count and lands the door for 60 dreamed briefs', () => {
    for (const s of seeds(60)) {
      for (const dir of ['n', 's'] as const) {
        const brief = dreamBrief(s, ZONE, dir)
        expect(brief.w).toBeLessThanOrEqual(ZONE.w)
        expect(brief.d).toBeLessThanOrEqual(ZONE.d)
        expect(brief.bedrooms).toBeGreaterThanOrEqual(1)
        expect(brief.bedrooms).toBeLessThanOrEqual(3)
        const script = briefToBlueprint(brief, s)
        const v = validateBlueprint(script)
        expect(v.ok, `seed ${s} door ${dir}: ${v.errors.join('; ')}`).toBe(true)
        const p = parseBlueprint(script)
        expect(p.doorDir).toBe(brief.doorDir)
        expect(p.wallH).toBe(brief.storeys)
        expect(p.rooms.filter((r) => r.kind === 'bedroom').length).toBe(brief.bedrooms)
        const outdoor = p.rooms.filter((r) => r.kind === 'patio' || r.kind === 'pool')
        if (brief.outdoor === 'none') expect(outdoor.length).toBe(0)
        else {
          expect(outdoor.length).toBe(1)
          expect(outdoor[0]!.kind).toBe(brief.outdoor)
        }
      }
    }
  })

  it('every agreed brief a negotiation can produce also compiles to a valid blueprint', () => {
    let agreed = 0
    for (const s of seeds(50)) {
      const dream = dreamBrief(s, ZONE, 's')
      for (const budget of [120, 250, 400, 10000]) {
        const session = negotiate({ clientSeed: s, builderSeed: (s * 31 + 7) >>> 0, dream, budget })
        if (session.state !== 'agreed') continue
        agreed++
        const script = briefToBlueprint(session.agreedBrief!, s)
        expect(validateBlueprint(script).ok).toBe(true)
        expect(parseBlueprint(script).rooms.filter((r) => r.kind === 'bedroom').length).toBe(session.agreedBrief!.bedrooms)
      }
    }
    expect(agreed).toBeGreaterThan(50) // the budget spread really exercises trimmed briefs
  })

  it('every round line is public-safe, PG-short and quotes city coin, never the brand word', () => {
    for (const s of seeds(40)) {
      const dream = dreamBrief(s, ZONE, 'n')
      for (const budget of [50, 300, 10000]) {
        const session = negotiate({ clientSeed: s, builderSeed: (s ^ 0x5eed) >>> 0, dream, budget })
        for (const r of session.rounds) {
          expect(isPublicSafe(r.text), r.text).toBe(true)
          expect(r.text.length).toBeLessThan(200)
          expect(r.text.toLowerCase()).not.toContain('kooker')
          expect(Number.isInteger(r.price)).toBe(true)
        }
      }
    }
  })
})
