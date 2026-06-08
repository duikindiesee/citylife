import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { makeNeighborhood, LOT } from '../src/colony/neighborhood'
import { Biome } from '../src/colony/terrain'

function terrain(seed: number) {
  return new ColonySim(seed).state.terrain
}

describe('the Neighbourhood — buildable lots on a street', () => {
  it('lays a street with lots flanking it', () => {
    const n = makeNeighborhood(terrain(42))
    expect(n.street.length).toBeGreaterThan(4)
    expect(n.lots.length).toBeGreaterThanOrEqual(2)
  })

  it('every lot sits on buildable, dry, non-rock ground', () => {
    const t = terrain(42)
    const n = makeNeighborhood(t)
    for (const lot of n.lots) {
      const hx = (lot.w - 1) / 2, hy = (lot.h - 1) / 2
      for (let yy = Math.ceil(lot.y - hy); yy <= Math.floor(lot.y + hy); yy++) {
        for (let xx = Math.ceil(lot.x - hx); xx <= Math.floor(lot.x + hx); xx++) {
          const i = t.idx(xx, yy)
          expect(t.buildable[i]).not.toBe(0)
          expect(t.isWater(xx, yy)).toBe(false)
          expect([Biome.Mountain, Biome.Peak, Biome.Ocean, Biome.Shallows]).not.toContain(t.biome[i])
        }
      }
    }
  })

  it('lots are sized LOT x LOT and start unbuilt + unowned', () => {
    const n = makeNeighborhood(terrain(7))
    for (const lot of n.lots) {
      expect(lot.w).toBe(LOT)
      expect(lot.h).toBe(LOT)
      expect(lot.built).toBe(false)
      expect(lot.ownerCitizenId).toBeUndefined()
    }
  })

  it('each lot door cell is one step off the lot toward the street row', () => {
    const n = makeNeighborhood(terrain(7))
    const streetY = n.street[0]!.y
    for (const lot of n.lots) {
      expect(Math.abs(lot.doorY - streetY)).toBeLessThanOrEqual(1) // door faces the street
      expect(lot.doorX).toBe(lot.x)
    }
  })

  it('is deterministic by terrain', () => {
    expect(makeNeighborhood(terrain(99))).toEqual(makeNeighborhood(terrain(99)))
  })
})
