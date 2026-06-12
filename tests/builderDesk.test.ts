import { describe, it, expect } from 'vitest'
import { dreamBrief, negotiate, priceBrief, briefToBlueprint, seededBudget, VIW_SEED } from '../src/colony/builder/negotiation'
import { validateBlueprint, parseBlueprint } from '../src/colony/blueprintScript'

// Spec 083 P2 — the Builder Desk is a thin deterministic shell over the P1 engine. These pin the
// desk's contract: the dream is stable per seed, the budget lever flips the outcome predictably,
// and an agreed deal always loads as a valid, editable blueprint. The panel render itself is
// verified live on :5188.

describe('spec 083 P2 — the Builder Desk contract', () => {
  it('the dream is deterministic per seed and fits the estate zone', () => {
    for (const seed of [1, 7, 42, 4242]) {
      const a = dreamBrief(seed, { w: 19, d: 14 }, 's')
      const b = dreamBrief(seed, { w: 19, d: 14 }, 's')
      expect(a).toEqual(b)
      expect(a.w).toBeLessThanOrEqual(19)
      expect(a.d).toBeLessThanOrEqual(14)
      expect(a.bedrooms).toBeGreaterThanOrEqual(1)
    }
  })

  it('a generous budget agrees, a starved budget walks — same seeds, the lever decides', () => {
    const seed = 42
    const dream = dreamBrief(seed, { w: 19, d: 14 }, 's')
    const generous = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget: priceBrief(dream) * 3 })
    const starved = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget: 10 })
    expect(generous.state).toBe('agreed')
    expect(starved.state).toBe('walked')
    // re-running the generous deal is byte-identical (the desk re-runs on every budget change)
    expect(negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget: priceBrief(dream) * 3 })).toEqual(generous)
  })

  it('every agreed deal across many seeds loads as a valid, editable blueprint', () => {
    let agreed = 0
    for (let seed = 1; seed <= 60; seed++) {
      const dream = dreamBrief(seed, { w: 19, d: 14 }, 's')
      const session = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget: priceBrief(dream) * 2 })
      if (session.state !== 'agreed') continue
      agreed++
      const script = briefToBlueprint(session.agreedBrief!, seed)
      expect(validateBlueprint(script).ok, `seed ${seed}`).toBe(true)
      const parsed = parseBlueprint(script) // the desk hands this straight to setDesign
      expect(parsed.rooms.length).toBeGreaterThan(0)
    }
    expect(agreed).toBeGreaterThan(40) // a 2x budget agrees on the vast majority
  })

  it('the desk default budget (seeded purse) lands a real, reproducible negotiation', () => {
    const seed = 7
    const dream = dreamBrief(seed, { w: 19, d: 14 }, 's')
    const budget = seededBudget(seed, dream)
    const session = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget })
    expect(session.rounds.length).toBeGreaterThan(0)
    expect(['agreed', 'walked']).toContain(session.state)
  })
})

// Spec 083 P4a — the in-engine commission (runtime.commissionLot) is the SAME deterministic core:
// the citizen's seeded dream + seeded purse vs Viw's seeded margin. The runtime wiring (build +
// Kookerbook events both ways) is verified live on :5188; these pin the deterministic contract the
// commission stands on.
describe('spec 083 P4a — the seeded commission contract', () => {
  it('seededBudget is deterministic and sits in the 1.20-1.50 fair-price band', () => {
    for (const seed of [1, 7, 42, 99]) {
      const dream = dreamBrief(seed, { w: 19, d: 14 }, 's')
      const fair = priceBrief(dream)
      const a = seededBudget(seed, dream)
      const b = seededBudget(seed, dream)
      expect(a).toBe(b)
      expect(a).toBeGreaterThanOrEqual(Math.round(fair * 1.2))
      expect(a).toBeLessThanOrEqual(Math.round(fair * 1.5))
    }
  })

  it('the seeded purse strikes a deal for the vast majority — the city gets built', () => {
    let agreed = 0
    for (let seed = 1; seed <= 60; seed++) {
      const dream = dreamBrief(seed, { w: 19, d: 14 }, 's')
      const session = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget: seededBudget(seed, dream) })
      if (session.state === 'agreed') {
        agreed++
        expect(validateBlueprint(briefToBlueprint(session.agreedBrief!, seed)).ok, `seed ${seed}`).toBe(true)
      }
    }
    expect(agreed).toBeGreaterThanOrEqual(48) // the seeded allowance is generous on purpose
  })

  it('a citizen commission replays identically (the HUD button is deterministic)', () => {
    const seed = 4242
    const dream = dreamBrief(seed, { w: 19, d: 14 }, 's')
    const one = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget: seededBudget(seed, dream) })
    const two = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget: seededBudget(seed, dream) })
    expect(one).toEqual(two)
  })
})
