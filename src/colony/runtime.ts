// Browser runtime for the colony: fixed-timestep sim loop + planet renderer + camera presets.
import { COLONY } from './config'
import { ColonySim } from './sim'
import { PlanetRenderer, type CameraPreset, type ViewMode } from './render/PlanetRenderer'
import { Biome } from './terrain'
import { autoGrow } from './build'

const BIOME_LABEL: Record<number, string> = {
  [Biome.Ocean]: 'Ocean',
  [Biome.Shallows]: 'Shallows',
  [Biome.Beach]: 'Crystal shore',
  [Biome.Plains]: 'Fungal plains',
  [Biome.Forest]: 'Violet forest',
  [Biome.Highland]: 'Ochre highland',
  [Biome.Mountain]: 'Grey mountains',
  [Biome.Peak]: 'Crystal peaks',
  [Biome.River]: 'Riverside',
}

export interface ColonyUiState {
  running: boolean
  paused: boolean
  speed: number
  clock: { day: number; hour: number; minute: number; isDay: boolean }
  power: { solarW: number; loadW: number; batteryWh: number; batteryCapWh: number; pct: number }
  colonists: number
  colony: { treasury: number; buildings: number; building: number; load: number; jobs: number; employed: number; pollution: number }
  name: string
  biome: string
  view: ViewMode
  preset: CameraPreset
}

export class ColonyRuntime {
  readonly sim: ColonySim
  private renderer: PlanetRenderer | null = null
  private raf = 0
  private lastFrame = 0
  private lastUi = 0
  private accumulator = 0
  private speed = 1
  private paused = false
  private running = false
  private view: ViewMode = 'biome'
  private preset: CameraPreset = 'district'
  private listeners = new Set<() => void>()

  constructor(seed: number = COLONY.render.seed) {
    this.sim = new ColonySim(seed)
  }

  start(container: HTMLElement) {
    if (this.running) return
    this.renderer = new PlanetRenderer(container, this.sim)
    this.running = true
    this.lastFrame = performance.now()
    this.lastUi = this.lastFrame
    this.raf = requestAnimationFrame(this.loop)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.renderer?.dispose()
    this.renderer = null
  }

  private loop = (now: number) => {
    if (!this.running) return
    const dtReal = Math.min(0.25, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    if (!this.paused) {
      this.accumulator += dtReal * this.speed
      const stepDt = 1 / COLONY.time.stepsPerSec
      let steps = 0
      while (this.accumulator >= stepDt && steps < 2000) {
        this.sim.step()
        this.accumulator -= stepDt
        steps++
      }
    }
    this.renderer?.frame()
    if (now - this.lastUi > 200) {
      this.lastUi = now
      this.emit()
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  setSpeed(m: number) {
    this.speed = Math.max(0, Math.min(20, m))
    this.emit()
  }
  setPaused(p: boolean) {
    this.paused = p
    this.emit()
  }
  setView(v: ViewMode) {
    this.view = v
    this.renderer?.setView(v)
    this.emit()
  }
  setPreset(p: CameraPreset) {
    this.preset = p
    this.renderer?.applyPreset(p)
    this.emit()
  }
  resize() {
    this.renderer?.resize()
  }
  buildNow() {
    autoGrow(this.sim.state, this.sim.rng)
    this.emit()
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit() {
    for (const cb of this.listeners) cb()
  }

  getUiState(): ColonyUiState {
    const s = this.sim.state
    const li = s.terrain.idx(s.terrain.landing.x, s.terrain.landing.y)
    const p = s.power
    return {
      running: this.running,
      paused: this.paused,
      speed: this.speed,
      clock: { day: s.clock.day, hour: s.clock.hour, minute: s.clock.minute, isDay: s.clock.isDay },
      power: { solarW: p.solarW, loadW: p.loadW, batteryWh: p.batteryWh, batteryCapWh: p.batteryCapWh, pct: p.batteryWh / p.batteryCapWh },
      colonists: s.colonists,
      colony: {
        treasury: Math.round(s.treasury),
        buildings: s.buildings.length,
        building: s.jobs.length,
        load: Math.round(s.power.loadW * 10) / 10,
        jobs: s.totalJobs,
        employed: s.colonists > 0 ? Math.round((Math.min(s.colonists, s.totalJobs) / s.colonists) * 100) : 0,
        pollution: Math.round(s.pollution),
      },
      name: s.name,
      biome: BIOME_LABEL[s.terrain.biome[li]!] ?? 'Unknown',
      view: this.view,
      preset: this.preset,
    }
  }
}
