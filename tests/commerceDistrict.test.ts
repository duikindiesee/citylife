import { describe, it, expect } from 'vitest'
import { ColonySim } from '../src/colony/sim'
import { makeNeighborhood } from '../src/colony/neighborhood'
import { cellOk } from '../src/colony/pathfind'
import { makeCommercialDistrict, SHOP_SIZE, type Reserve, type CommercialDistrict } from '../src/colony/commerce/district'

// Terrain + the derived reserve are expensive (makeNeighborhood routes a Dijkstra spine), so cache
// per seed and reuse — the survey is the unit under test, not the neighbourhood.
type T = ReturnType<typeof terrainFor>
function terrainFor(seed: number) {
  return new ColonySim(seed).state.terrain
}
const RES_CACHE = new Map<number, { t: T; reserve: Reserve }>()
function reserveFor(seed: number): { t: T; reserve: Reserve } {
  let c = RES_CACHE.get(seed)
  if (c) return c
  const t = terrainFor(seed)
  // Mirror runtime: the reserve is a 40x30 box at the avenue carriage's inland-most cell.
  const n = makeNeighborhood(t)
  const car = n.carriage
  const dW = (cell: { x: number; y: number }) => t.distToWater[t.idx(cell.x, cell.y)] ?? 0
  let inland = car[0]!
  for (const cell of car) if (dW(cell) > dW(inland)) inland = cell
  const reserve: Reserve = { x: Math.max(0, inland.x - 20), y: Math.max(0, inland.y + 6), w: 40, h: 30 }
  c = { t, reserve }
  RES_CACHE.set(seed, c)
  return c
}

const DIST_CACHE = new Map<number, CommercialDistrict>()
function districtFor(seed: number): { t: T; reserve: Reserve; d: CommercialDistrict } {
  const { t, reserve } = reserveFor(seed)
  let d = DIST_CACHE.get(seed)
  if (!d) { d = makeCommercialDistrict(t, reserve); DIST_CACHE.set(seed, d) }
  return { t, reserve, d }
}

const SEEDS = [42, 7, 99]

function footprintCells(p: { x: number; y: number; w: number; h: number }): string[] {
  const out: string[] = []
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) out.push(`${x},${y}`)
  return out
}

describe('commercial district survey (spec 079 P0)', () => {
  it('places shop plots in the reserve for the coastal seeds', () => {
    for (const seed of SEEDS) {
      const { d } = districtFor(seed)
      expect(d.parcels.length).toBeGreaterThan(0)
    }
  }, 20000)

  it('every shop footprint is good ground (cellOk) and inside the reserve', () => {
    for (const seed of SEEDS) {
      const { t, reserve, d } = districtFor(seed)
      for (const p of d.parcels) {
        expect(SHOP_SIZE[p.kind]).toEqual({ w: p.w, d: p.h })
        for (let y = p.y; y < p.y + p.h; y++) {
          for (let x = p.x; x < p.x + p.w; x++) {
            expect(cellOk(t, x, y)).toBe(true)
            expect(x).toBeGreaterThanOrEqual(reserve.x)
            expect(x).toBeLessThan(reserve.x + reserve.w)
            expect(y).toBeGreaterThanOrEqual(reserve.y)
            expect(y).toBeLessThan(reserve.y + reserve.h)
          }
        }
      }
    }
  }, 20000)

  it('shop footprints never overlap', () => {
    for (const seed of SEEDS) {
      const { d } = districtFor(seed)
      const seen = new Set<string>()
      for (const p of d.parcels) {
        for (const c of footprintCells(p)) {
          expect(seen.has(c)).toBe(false)
          seen.add(c)
        }
      }
    }
  }, 20000)

  it('every door sits on the front row, facing the high street', () => {
    for (const seed of SEEDS) {
      const { d } = districtFor(seed)
      const streetY = d.reserve.y + Math.floor(d.reserve.h / 2)
      for (const p of d.parcels) {
        // door is on the street-facing edge of the footprint and centred on the frontage
        expect(p.doorY).toBe(p.side === -1 ? p.y + p.h - 1 : p.y)
        expect(p.doorX).toBe(p.x + Math.floor(p.w / 2))
        // the front row is on the correct side of the street
        if (p.side === -1) expect(p.doorY).toBeLessThan(streetY)
        else expect(p.doorY).toBeGreaterThan(streetY)
      }
    }
  }, 20000)

  it('is deterministic — same terrain + reserve replays an identical survey', () => {
    for (const seed of SEEDS) {
      const { t, reserve, d } = districtFor(seed)
      const again = makeCommercialDistrict(t, reserve)
      expect(again.parcels).toEqual(d.parcels)
      expect(again.street).toEqual(d.street)
    }
  }, 20000)
})
