import { describe, it, expect } from 'vitest'
import { generateHousehold, isPublicSafe } from '../src/colony/newcomers'

describe('Newcomer household generator', () => {
  it('is deterministic by seed', () => {
    expect(generateHousehold(123)).toEqual(generateHousehold(123))
  })

  it('produces a SINGLE adult citizen — 1 newcomer = 1 bot', () => {
    for (let s = 0; s < 50; s++) {
      const h = generateHousehold(s)
      expect(h.members.length).toBe(1)
      expect(h.members[0]!.role).toBe('adult')
    }
  })

  it('every generated identity is public-safe (no internal / secret-looking strings)', () => {
    for (let s = 0; s < 100; s++) {
      const h = generateHousehold(s)
      expect(h.publicSafe).toBe(true)
      expect(isPublicSafe(h.displayName)).toBe(true)
      expect(isPublicSafe(h.botHandle)).toBe(true)
      for (const m of h.members) expect(isPublicSafe(m.name)).toBe(true)
    }
  })

  it('rejects denylisted / internal-looking strings', () => {
    for (const bad of ['kooker-web', 'Hermes profile', 'admin', 'api-token', 'my-secret', 'svc.cluster.local', 'foo.co.za', 'localhost:8081', 'Bearer xyz', 'duikland']) {
      expect(isPublicSafe(bad)).toBe(false)
    }
    expect(isPublicSafe('The Quillfeather Household')).toBe(true)
  })

  it('different seeds yield varied households', () => {
    const names = new Set(Array.from({ length: 30 }, (_, s) => generateHousehold(s).displayName))
    expect(names.size).toBeGreaterThan(5)
  })

  it('holdings sit in the Earth-savings range (for the wallet deposit)', () => {
    for (let s = 0; s < 30; s++) {
      const h = generateHousehold(s)
      expect(h.holdings).toBeGreaterThanOrEqual(8000)
      expect(h.holdings).toBeLessThanOrEqual(60000)
    }
  })

  it('members summary agrees with the family composition', () => {
    const h = generateHousehold(7)
    const adults = h.members.filter((m) => m.role === 'adult').length
    expect(h.membersSummary.startsWith(`${adults} adult`)).toBe(true)
  })

  it('applies player-chosen name, age and profession to the citizen', () => {
    const h = generateHousehold(3, { name: 'Dax Brackenhollow', age: 41, profession: 'Botanist' })
    expect(h.members[0]!.name).toBe('Dax Brackenhollow')
    expect(h.members[0]!.age).toBe(41)
    expect(h.members[0]!.occupation).toBe('Botanist')
    expect(h.displayName).toBe('The Brackenhollow Household') // surname follows the chosen name
    expect(h.lead.jobHistory).toContain('botanist') // job history follows the chosen profession
  })

  it('clamps a chosen age into the adult range', () => {
    expect(generateHousehold(1, { age: 8 }).members[0]!.age).toBe(18)
    expect(generateHousehold(1, { age: 250 }).members[0]!.age).toBe(99)
  })

  it('ignores an unsafe chosen name and falls back to generated', () => {
    const h = generateHousehold(5, { name: 'kooker admin token' }) // hits the denylist
    expect(h.members[0]!.name).not.toBe('kooker admin token')
    expect(h.publicSafe).toBe(true)
  })

  it('omitted overrides keep the generated values (back-compat)', () => {
    expect(generateHousehold(9)).toEqual(generateHousehold(9, {}))
  })
})
