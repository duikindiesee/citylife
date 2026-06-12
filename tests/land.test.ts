import { describe, it, expect } from 'vitest'
import { plotPriceKook, kookToZar, starterDeposit, type LandConfig } from '../src/colony/land'
import { createLedger, post, balance } from '../src/colony/ledger'
import { COLONY } from '../src/colony/config'

// Spec 085 — the land economy's money math (pure) + the double-entry conservation the runtime
// stands on. The runtime wiring (purchase gate, deposit-on-arrival, commission debit) is verified
// live on :5188; these pin the numbers + that ₭ never appears or vanishes.

const cfg: LandConfig = COLONY.economy.land

describe('spec 085 — land pricing math', () => {
  it('a plot costs its area plus a waterfront premium, deterministic and rounded', () => {
    // ESTATE zone 19x14 = 266 cells; GRAND 23x16 = 368. Inland (far from water) = area*rate only.
    expect(plotPriceKook(266, 999, cfg)).toBe(Math.round(266 * cfg.plotAreaRate))
    expect(plotPriceKook(368, 999, cfg)).toBe(Math.round(368 * cfg.plotAreaRate))
    // Shore-side adds the premium; a GRAND waterfront plot is dearer than an inland ESTATE.
    expect(plotPriceKook(368, 0, cfg)).toBeGreaterThan(plotPriceKook(266, 999, cfg))
    // The premium decays to nothing far inland.
    expect(plotPriceKook(266, 0, cfg) - plotPriceKook(266, 999, cfg)).toBe(cfg.waterfrontPremium)
  })

  it('estate/grand land sits in the expected ₭ and ZAR bands', () => {
    const estate = plotPriceKook(266, 30, cfg) // a mid-distance estate
    const grand = plotPriceKook(368, 5, cfg) // a shore-ward grand
    expect(estate).toBeGreaterThanOrEqual(140)
    expect(estate).toBeLessThanOrEqual(260)
    expect(grand).toBeGreaterThanOrEqual(280)
    expect(kookToZar(estate, cfg)).toBe(estate * 25)
    expect(kookToZar(100, cfg)).toBe(2500)
  })

  it('the starter deposit is deterministic, in band, and always covers the dearest plot', () => {
    const dearest = plotPriceKook(368, 0, cfg) // GRAND right on the water — the most expensive plot
    for (const seed of [1, 7, 42, 99, 12345]) {
      const a = starterDeposit(seed, cfg)
      const b = starterDeposit(seed, cfg)
      expect(a).toBe(b)
      expect(a).toBeGreaterThanOrEqual(cfg.starterDepositMin)
      expect(a).toBeLessThanOrEqual(cfg.starterDepositMin + cfg.starterDepositSpread)
      expect(a).toBeGreaterThan(dearest) // can always buy in
    }
  })
})

describe('spec 085 — the ₭ ledger conserves through the full loop', () => {
  it('deposit -> buy land -> pay Viw: every ₭ is accounted for, nothing created or destroyed', () => {
    const led = createLedger()
    const dep = starterDeposit(42, cfg)
    // arrival
    post(led, 'arrive', [{ account: 'citizen:c', amount: dep }, { account: 'arrivals', amount: -dep }])
    // buy a 200 ₭ plot
    post(led, 'buy', [{ account: 'citizen:c', amount: -200 }, { account: 'land', amount: 200 }])
    // pay Viw 300 ₭ for the build
    post(led, 'build', [{ account: 'citizen:c', amount: -300 }, { account: 'citizen:viw', amount: 300 }])

    expect(balance(led, 'citizen:c')).toBe(dep - 500)
    expect(balance(led, 'land')).toBe(200)
    expect(balance(led, 'citizen:viw')).toBe(300)
    // the whole ledger nets to zero — ₭ only ever moves between accounts
    const total = Object.values(led.accounts).reduce((s, v) => s + v, 0)
    expect(total).toBe(0)
  })

  it('post refuses an unbalanced transaction (a ₭ leak can never commit)', () => {
    const led = createLedger()
    expect(post(led, 'bad', [{ account: 'citizen:c', amount: -100 }, { account: 'land', amount: 90 }])).toBe(false)
    expect(balance(led, 'citizen:c')).toBe(0) // nothing applied
  })
})
