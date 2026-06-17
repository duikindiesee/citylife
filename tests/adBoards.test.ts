import { describe, it, expect, vi } from 'vitest'
import { ColonyRuntime } from '../src/colony/runtime'
import { cellOk } from '../src/colony/pathfind'
import { surveyBillboards } from '../src/colony/commerce/billboards'
import { posterModel, PSA_POSTER, paintPoster } from '../src/colony/commerce/adCanvas'
import { BUSINESSES } from '../src/colony/commerce/businesses'
import { isPublicSafe } from '../src/colony/newcomers'

// Drive the REAL runtime boot so the billboard survey runs against the production district + terrain
// (no reconstruction drift). Booting is expensive, so cache per seed. 4242 is the live dev seed.
const RT_CACHE = new Map<number, ColonyRuntime>()
function rtFor(seed: number): ColonyRuntime {
  let rt = RT_CACHE.get(seed)
  if (!rt) { rt = new ColonyRuntime(seed); RT_CACHE.set(seed, rt) }
  return rt
}
const SEEDS = [4242, 42, 7]

/** The same blocked set the renderer uses: every road cell + every shop footprint. */
function blockedFor(rt: ColonyRuntime): Set<string> {
  const b = new Set<string>(rt.sim.state.roadSet)
  for (const p of rt.commercialDistrict?.parcels ?? []) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) b.add(`${x},${y}`)
  }
  return b
}

describe('081 ad boards — billboard survey', () => {
  it('places boards on good ground, clear of roads and shop footprints, on every seed', () => {
    for (const seed of SEEDS) {
      const rt = rtFor(seed)
      const d = rt.commercialDistrict
      if (!d) continue
      const t = rt.sim.state.terrain
      const blocked = blockedFor(rt)
      const sites = surveyBillboards(d, t, blocked)
      expect(sites.length).toBeLessThanOrEqual(3)
      const shopIds = new Set(d.parcels.map((p) => p.id))
      for (const s of sites) {
        expect(cellOk(t, s.x, s.y)).toBe(true) // good ground (dry, buildable, not rock)
        expect(blocked.has(`${s.x},${s.y}`)).toBe(false) // never on a road or a shopfront
        expect(t.isWater(s.x, s.y)).toBe(false)
        expect([1, -1]).toContain(s.faceX)
        if (s.shopId !== null) expect(shopIds.has(s.shopId)).toBe(true) // advertises a real shop
      }
      // no two boards sit within the min spacing (so none ever stands behind another)
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          const md = Math.abs(sites[i]!.x - sites[j]!.x) + Math.abs(sites[i]!.y - sites[j]!.y)
          expect(md).toBeGreaterThanOrEqual(6)
        }
      }
    }
  })

  it('places at least one board for the live dev seed', () => {
    const rt = rtFor(4242)
    const sites = surveyBillboards(rt.commercialDistrict!, rt.sim.state.terrain, blockedFor(rt))
    expect(sites.length).toBeGreaterThan(0)
  })

  it('is deterministic — a second boot of the same seed yields identical sites', () => {
    const a = rtFor(4242)
    const fresh = new ColonyRuntime(4242)
    const sa = surveyBillboards(a.commercialDistrict!, a.sim.state.terrain, blockedFor(a))
    const sb = surveyBillboards(fresh.commercialDistrict!, fresh.sim.state.terrain, blockedFor(fresh))
    expect(sb).toEqual(sa)
  })

  it('rotation shifts which shop each board shows, keeping placement fixed', () => {
    const rt = rtFor(4242)
    const d = rt.commercialDistrict!
    const t = rt.sim.state.terrain
    const blocked = blockedFor(rt)
    const s0 = surveyBillboards(d, t, blocked, 0)
    const s1 = surveyBillboards(d, t, blocked, 1)
    expect(s1.map((s) => `${s.x},${s.y},${s.faceX}`)).toEqual(s0.map((s) => `${s.x},${s.y},${s.faceX}`))
    if (d.parcels.length > 1 && s0.length > 0) expect(s1[0]!.shopId).not.toBe(s0[0]!.shopId)
  })
})

describe('081 ad boards — poster model', () => {
  it('builds a public-safe poster for a business and the PSA card for none', () => {
    expect(posterModel(undefined)).toEqual(PSA_POSTER)
    const m = posterModel('nearest_bar')
    expect(m.title).toBe(BUSINESSES.nearest_bar.name)
    expect(m.accent).toBe(BUSINESSES.nearest_bar.palette)
    expect(isPublicSafe(m.title)).toBe(true)
    expect(isPublicSafe(m.tagline)).toBe(true)
    expect(isPublicSafe(m.badge)).toBe(true)
  })

  it('marks open lots FOR SALE', () => {
    const m = posterModel('trading_post')
    expect(m.forSale).toBe(true)
    expect(m.badge).toBe('FOR SALE')
  })

  it('is deterministic', () => {
    expect(posterModel('chef_market')).toEqual(posterModel('chef_market'))
  })
})

describe('081 ad boards — purity guard', () => {
  it('the survey + poster paths touch no wall-clock or RNG (runtime guard)', () => {
    const dateSpy = vi.spyOn(Date, 'now')
    const randSpy = vi.spyOn(Math, 'random')
    try {
      const rt = rtFor(4242)
      surveyBillboards(rt.commercialDistrict!, rt.sim.state.terrain, blockedFor(rt), 2)
      // a minimal 2D-context stub covering exactly what paintPoster touches
      const ctx = {
        fillStyle: '', font: '', textBaseline: '', textAlign: '',
        fillRect() {}, fillText() {}, measureText() { return { width: 10 } as TextMetrics },
      } as unknown as CanvasRenderingContext2D
      paintPoster(ctx, posterModel('nearest_bar'), 256, 160)
      paintPoster(ctx, posterModel(undefined), 256, 160)
      expect(dateSpy).not.toHaveBeenCalled()
      expect(randSpy).not.toHaveBeenCalled()
    } finally {
      dateSpy.mockRestore()
      randSpy.mockRestore()
    }
  })
})
