// Colony simulation (Phase A): clock + day/night, and the off-grid solar→battery loop.
import { RNG } from '../engine/rng'
import { COLONY } from './config'
import { Terrain } from './terrain'
import { initBuild, stepBuild } from './build'
import type { ColonyBuilding, ConstructionJob, Parcel, RoadCell } from './build'
import { updateTraffic } from './traffic'
import type { Car } from './traffic'

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

    // Place the seed structures on nearby buildable land.
    const structures: SeedStructure[] = [
      { kind: 'caravan', x: lx, y: ly },
      this.place(terrain, 'solar', lx + 2, ly),
      this.place(terrain, 'battery', lx - 2, ly),
      this.place(terrain, 'rocket', lx, ly + 3),
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
    }
    initBuild(this.state)
  }

  private place(terrain: Terrain, kind: StructureKind, x: number, y: number): SeedStructure {
    const p = this.nearbyFlat(terrain, x, y)
    return { kind, x: p.x, y: p.y }
  }

  /** Find the closest land cell to (x,y) (small spiral) so seed props don't land in water. */
  private nearbyFlat(terrain: Terrain, x: number, y: number): { x: number; y: number } {
    for (let r = 0; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const nx = x + dx
          const ny = y + dy
          if (terrain.inBounds(nx, ny) && terrain.buildable[terrain.idx(nx, ny)] !== 0) {
            return { x: nx, y: ny }
          }
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
