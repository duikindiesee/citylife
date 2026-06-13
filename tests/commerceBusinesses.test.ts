import { describe, it, expect } from 'vitest'
import { ColonyRuntime } from '../src/colony/runtime'
import { assignBusinesses, BUSINESSES, type BusinessId } from '../src/colony/commerce/businesses'

describe('commerce businesses (themed app storefronts)', () => {
  it('assigns the marquee apps to the biggest plots first, the bar to the largest', () => {
    // 1 showroom + 3 stores covers the 4 marquee apps, so the kiosks are left generic.
    const parcels = [
      { id: 'shop_0', kind: 'showroom' as const },
      { id: 'shop_1', kind: 'store' as const },
      { id: 'shop_2', kind: 'store' as const },
      { id: 'shop_3', kind: 'store' as const },
      { id: 'shop_4', kind: 'kiosk' as const },
      { id: 'shop_5', kind: 'kiosk' as const },
    ]
    const a = assignBusinesses(parcels)
    // the bar (a marquee) takes the showroom (largest)
    expect(a['shop_0']).toBe('nearest_bar')
    // the stores take the remaining marquee apps; kiosks fall back to the generic kiosk
    const marquee: BusinessId[] = ['chef_market', 'sportifine_club', 'sprout_nursery']
    expect(marquee).toContain(a['shop_1'])
    expect(marquee).toContain(a['shop_2'])
    expect(marquee).toContain(a['shop_3'])
    expect(a['shop_4']).toBe('corner_kiosk')
    expect(a['shop_5']).toBe('corner_kiosk')
    // every plot gets exactly one known business
    for (const p of parcels) expect(BUSINESSES[a[p.id] as BusinessId]).toBeTruthy()
  })

  it('is deterministic', () => {
    const kinds = ['showroom', 'store', 'kiosk'] as const
    const parcels = Array.from({ length: 8 }, (_, i) => ({ id: `shop_${i}`, kind: kinds[i % 3]! }))
    expect(assignBusinesses(parcels)).toEqual(assignBusinesses(parcels))
  })

  it('exactly one business carries seating (the bar)', () => {
    const seated = Object.values(BUSINESSES).filter((b) => b.seating)
    expect(seated.map((b) => b.id)).toEqual(['nearest_bar'])
  })

  it('the live district tags every shop plot with a business', () => {
    const rt = new ColonyRuntime(4242)
    const shops = rt.commercialDistrict?.parcels ?? []
    expect(shops.length).toBeGreaterThan(0)
    for (const p of shops) expect(p.business && BUSINESSES[p.business]).toBeTruthy()
    // the marquee apps actually appear in the live assignment
    const present = new Set(shops.map((p) => p.business))
    expect(present.has('nearest_bar')).toBe(true)
  }, 20000)

  it('business names are public-safe (no kooker/token/secret brand-words)', () => {
    for (const b of Object.values(BUSINESSES)) expect(/kooker|token|secret/i.test(b.name)).toBe(false)
  })
})
