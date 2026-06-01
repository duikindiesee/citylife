// Colony simulation (Phase A): clock + day/night, and the off-grid solar→battery loop.
import { RNG } from '../engine/rng'
import { COLONY } from './config'
import { Terrain } from './terrain'
import { initBuild, stepBuild } from './build'
import type { ColonyBuilding, ConstructionJob, Parcel, RoadCell } from './build'
import { updateTraffic } from './traffic'
import type { Car } from './traffic'
import type { Settler } from './settlers'
import { createLedger, type Ledger } from './ledger'
import type { CityPlan } from './cityPlan'

export type StructureKind = 'caravan' | 'solar' | 'battery' | 'rocket'
export interface SeedStructure {
  kind: StructureKind
  x: number
  y: number
}

export interface ColonyClock {
  totalMinutes: number
  day: number
  hour: number
  minute: number
  isDay: boolean
  daylight: number // 0..1
}

export interface ColonyState {
  name: string
  terrain: Terrain
  clock: ColonyClock
  structures: SeedStructure[]
  power: { solarW: number; loadW: number; batteryWh: number; batteryCapWh: number }
  colonists: number
  // Phase B — construction
  treasury: number
  materials: number // spec 001 — build supplies; construction consumes these
  components: number // spec 003 — refined goods produced by workshops from materials
  food: number // spec 007 — grown by Skyfarm Greenhouses, eaten by colonists daily
  parcels: Parcel[]
  jobs: ConstructionJob[]
  buildings: ColonyBuilding[]
  roads: RoadCell[]
  roadSet: Set<string>
  occupied: Set<string>
  buildIds: number
  lastGrowMin: number
  buildingLoad: number
  powerGen: number
  lastIncomeDay: number
  totalJobs: number
  developedBlocks: Set<string>
  pollution: number
  cars: Car[]
  settlers: Settler[]
  ledger: Ledger
  cityPlan: CityPlan | null // attached by the runtime after construction so the renderer can paint zones
}

function daylightAt(hour: number, minute: number): number {
  const t = hour + minute / 60
  return Math.max(0, Math.sin(((t - 6) / 13) * Math.PI))
}

export class ColonySim {
  state: ColonyState
  rng: RNG

  constructor(seed: number = COLONY.render.seed) {
    this.rng = new RNG(seed)
    const terrain = new Terrain(this.rng)
    const { x: lx, y: ly } = terrain.landing

    // Base structures, spread inside the landing block (block 0,0 centred on the caravan; block=7
    // gives a 6×6 interior so the base is no longer cramped). Footprints reflect mesh widths so
    // wide structures (caravan 3-wide, solar 2.6-wide, rocket cylinder) don't dip into water.
    // Block boundaries become roads, so placement skips them; later structures avoid earlier ones.
    const used: { x: number; y: number }[] = [{ x: lx, y: ly }]
    const placeAvoid = (kind: StructureKind, x: number, y: number, footprint: number): SeedStructure => {
      const p = this.nearbyInterior(terrain, x, y, footprint, used, lx, ly)
      used.push(p)
      return { kind, x: p.x, y: p.y }
    }
    const structures: SeedStructure[] = [
      { kind: 'caravan', x: lx, y: ly },
      placeAvoid('rocket', lx + 3, ly + 2, 1),
      placeAvoid('solar', lx - 2, ly + 2, 1),
      placeAvoid('battery', lx + 2, ly - 2, 1),
    ]

    this.state = {
      name: COLONY.seed.name,
      terrain,
      clock: { totalMinutes: 10 * 60, day: 0, hour: 10, minute: 0, isDay: true, daylight: daylightAt(10, 0) },
      structures,
      power: {
        solarW: 0,
        loadW: COLONY.power.baseLoadW,
        batteryWh: COLONY.power.batteryStartWh,
        batteryCapWh: COLONY.power.batteryCapacityWh,
      },
      colonists: COLONY.seed.colonists,
      treasury: 0,
      materials: 0, // set by initBuild → materialsStart
      components: 0,
      food: 0, // spec 007 — set/grown by greenhouses
      parcels: [],
      jobs: [],
      buildings: [],
      roads: [],
      roadSet: new Set(),
      occupied: new Set(),
      buildIds: 1,
      lastGrowMin: 0,
      buildingLoad: 0,
      powerGen: 0,
      lastIncomeDay: 0,
      totalJobs: 0,
      developedBlocks: new Set(),
      pollution: 0,
      cars: [],
      settlers: [],
      ledger: createLedger(),
      cityPlan: null,
    }
    initBuild(this.state)
  }

  /** Find a cell that fits a structure: not water, not on a future road (block boundary), with a
   *  buffer of land around it so multi-cell meshes don't stick into the sea, and not on top of
   *  another structure. Falls back gracefully if the ideal can't be found. */
  private nearbyInterior(
    terrain: Terrain,
    x: number,
    y: number,
    footprint: number,
    used: { x: number; y: number }[],
    cx: number,
    cy: number,
  ): { x: number; y: number } {
    const B = COLONY.build.block
    const HALF = B >> 1
    const onRoadFrame = (px: number, py: number): boolean => {
      const mx = ((px - (cx - HALF)) % B + B) % B
      const my = ((py - (cy - HALF)) % B + B) % B
      return mx === 0 || my === 0
    }
    const footprintClear = (px: number, py: number): boolean => {
      for (let dy = -footprint; dy <= footprint; dy++) {
        for (let dx = -footprint; dx <= footprint; dx++) {
          const nx = px + dx, ny = py + dy
          if (!terrain.inBounds(nx, ny)) return false
          if (terrain.isWater(nx, ny)) return false
          // Keep the WHOLE mesh footprint off the road frame, not just the centre
          // cell: wide structures (rocket cylinder r~1.1, solar panel) otherwise
          // sit one cell off-frame but visually spill onto the adjacent road.
          if (onRoadFrame(nx, ny)) return false
        }
      }
      return true
    }
    const usedSet = new Set(used.map((p) => `${p.x},${p.y}`))
    const isUsed = (px: number, py: number): boolean => usedSet.has(`${px},${py}`)

    // Pass 1 (best): footprint clear, interior of block, not used.
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const nx = x + dx, ny = y + dy
          if (onRoadFrame(nx, ny)) continue
          if (isUsed(nx, ny)) continue
          if (footprintClear(nx, ny)) return { x: nx, y: ny }
        }
      }
    }
    // Pass 2 (fallback): any non-water buildable cell that's not used and not on a road frame.
    for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const nx = x + dx, ny = y + dy
          if (onRoadFrame(nx, ny)) continue
          if (isUsed(nx, ny)) continue
          if (!terrain.inBounds(nx, ny)) continue
          if (terrain.isWater(nx, ny)) continue
          if (terrain.buildable[terrain.idx(nx, ny)] === 0) continue
          return { x: nx, y: ny }
        }
      }
    }
    return { x, y }
  }

  step(): void {
    const s = this.state
    const dt = COLONY.time.simMinPerStep
    const c = s.clock
    c.totalMinutes += dt
    const totalDays = Math.floor(c.totalMinutes / (24 * 60))
    const minOfDay = c.totalMinutes - totalDays * 24 * 60
    c.day = totalDays
    c.hour = Math.floor(minOfDay / 60)
    c.minute = Math.floor(minOfDay % 60)
    c.isDay = c.hour >= COLONY.time.dayStartHour && c.hour < COLONY.time.dayEndHour
    c.daylight = daylightAt(c.hour, c.minute)

    const dtHours = dt / 60
    const p = s.power
    p.solarW = (COLONY.power.solarPeakW + s.powerGen) * c.daylight
    p.loadW = COLONY.power.baseLoadW + s.colonists * 0.15 + s.buildingLoad
    p.batteryWh = Math.max(0, Math.min(p.batteryCapWh, p.batteryWh + (p.solarW - p.loadW) * dtHours))

    stepBuild(s, this.rng, dt)
    updateTraffic(s, this.rng, dt)
  }
}
