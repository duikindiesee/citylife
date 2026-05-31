import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { COLONY } from '../src/colony/config'

describe('Base placement (rocket / solar / battery / caravan)', () => {
  const seeds = [1, 7, 42, 99, 123, 314, 777, 2026]

  for (const seed of seeds) {
    describe(`seed ${seed}`, () => {
      const sim = new ColonySim(seed)
      const s = sim.state
      const caravan = s.structures.find((x) => x.kind === 'caravan')!
      const B = COLONY.build.block
      const HALF = B >> 1
      const onRoadFrame = (px: number, py: number) =>
        (((px - (caravan.x - HALF)) % B + B) % B === 0) || (((py - (caravan.y - HALF)) % B + B) % B === 0)

      it('every structure sits on land (no water under the base)', () => {
        for (const st of s.structures) {
          expect(s.terrain.isWater(st.x, st.y)).toBe(false)
        }
      })
      it('rocket / solar / battery sit INSIDE block (0,0) — never on the road frame', () => {
        for (const st of s.structures) {
          if (st.kind === 'caravan') continue
          expect(onRoadFrame(st.x, st.y)).toBe(false)
        }
      })
      it('no two structures share a cell', () => {
        const seen = new Set<string>()
        for (const st of s.structures) {
          const k = `${st.x},${st.y}`
          expect(seen.has(k)).toBe(false)
          seen.add(k)
        }
      })
      it('no road cell is laid on top of a structure', () => {
        for (const st of s.structures) {
          expect(s.roadSet.has(`${st.x},${st.y}`)).toBe(false)
        }
      })
    })
  }
})
