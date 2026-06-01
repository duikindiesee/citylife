// Browser runtime for the colony: fixed-timestep sim loop + planet renderer + camera presets.
import { COLONY } from './config'
import { ColonySim } from './sim'
import { PlanetRenderer, type CameraPreset, type ViewMode } from './render/PlanetRenderer'
import { Biome } from './terrain'
import { autoGrow, freeLabour } from './build'
import { registerSettler as kookerRegister, generateName as randomSettlerName, type KookerCard } from './kooker'
import { addSettler, saveColony, restoreColony, clearColony } from './settlers'
import { bankDeposits, CURRENCY } from './ledger'
import { MockBackend, type CityLifeBackend, type Decision } from './backend'
import type { Household } from './newcomers'
import { BotService, defaultBotAdapter, type Bot } from './bots'
import { makeCityPlan, type CityPlan, type Plot } from './cityPlan'
import { createRadio, tuneTo, toggleOn as radioToggleOn, toggleMuted as radioToggleMuted, spinHouseAd, type RadioState } from './radio'

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
  colony: { treasury: number; materials: number; freeLabour: number; buildings: number; building: number; load: number; jobs: number; employed: number; pollution: number }
  settlers: { count: number; recent: { id: number; name: string }[] }
  bank: { currency: string; deposits: number; accounts: number; recent: { id: number; memo: string }[] }
  border: { households: Household[]; bots: Bot[]; botSource: string; plots: Plot[] }
  radio: RadioState
  tv: boolean
  zonesVisible: boolean
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
  // The forkable backend boundary — mock for dev, the real portable citylife-backend later.
  private backend: CityLifeBackend = new MockBackend((Date.now() & 0x7fffffff) >>> 0)
  // Newcomer bots: REAL Hermes replies via kooker inference when VITE_CITYLIFE_PAT is set, else mock.
  private botService = new BotService(defaultBotAdapter())
  // The surveyed city plan the Border Patrol bot uses to allocate plots.
  private cityPlan!: CityPlan
  // Low Power Radio — CityLife's heartbeat. YouTube embed handles licensing; in-game ads queue up.
  private radio: RadioState = createRadio()
  // TV mode hides the operator UI so you can put the city on any screen and just watch.
  private tv = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tv') === '1'
  // City-plan zoning overlay (tints + plot flags) visible by default; toggled from the HUD.
  private zonesVisible = true
  private adInterval: ReturnType<typeof setInterval> | null = null

  constructor(seed: number = COLONY.render.seed) {
    this.sim = new ColonySim(seed)
    restoreColony(this.sim.state) // re-place settlers + restore the Kookerverse ledger
    this.cityPlan = makeCityPlan(this.sim.state.terrain)
    this.sim.state.cityPlan = this.cityPlan // expose to the renderer for the zone tint + plot markers
    this.botService.setCityPlan(this.cityPlan)
  }

  /** Roll a fresh playful settler name for the immigration dialog. */
  rollName(): string {
    return randomSettlerName(this.sim.rng)
  }

  /** Register a settler with the real kooker user service, place them, inject their holdings. */
  async registerSettler(name: string): Promise<{ card: KookerCard; holdings: number; settlement: number }> {
    const card = await kookerRegister(name)
    const res = addSettler(this.sim.state, this.sim.rng, card)
    saveColony(this.sim.state)
    this.emit()
    return { card, holdings: res?.holdings ?? 0, settlement: res?.settlement ?? 0 }
  }

  /** Border Control: generate the next candidate family at the border (status: triage). */
  async addNewcomer(): Promise<Household> {
    const h = await this.backend.addNewcomer()
    this.emit()
    return h
  }
  /** Operator decision on a border candidate (approve / hold / decline). Approve boots a bot. */
  async decideNewcomer(id: string, decision: Decision): Promise<void> {
    const h = await this.backend.decide(id, decision)
    this.emit() // reflect approved/held/rejected immediately
    if (h && decision === 'approve' && h.status === 'approved') {
      await this.botService.create(h) // boot a bot, inject its life history, get its first reply
      this.emit()
    }
  }

  /** Border patrol asks an approved household's bot another question (the reply is the bot's own). */
  async askBot(botId: string, question: string): Promise<void> {
    await this.botService.ask(botId, question)
    this.emit()
  }

  /** Reset the Kookerverse: clear saved settlers + ledger so the game starts fresh (caller reloads). */
  reset(): void {
    clearColony()
  }

  // ── Low Power Radio ──────────────────────────────────────────────────────────
  /** Turn the radio on or off. First on picks the first configured channel. */
  toggleRadio(): void {
    this.radio = radioToggleOn(this.radio)
    if (this.radio.on) this.startAdLoop()
    else this.stopAdLoop()
    this.emit()
  }
  /** Tune to a channel by id. */
  tuneRadio(channelId: string): void {
    this.radio = tuneTo(this.radio, channelId)
    this.startAdLoop()
    this.emit()
  }
  toggleRadioMuted(): void {
    this.radio = radioToggleMuted(this.radio)
    this.emit()
  }
  /** Drop into TV mode — hides operator UI, kicks off the cinematic fly-around, keeps the radio on. */
  setTv(on: boolean): void {
    this.tv = on
    if (typeof document !== 'undefined') document.body.classList.toggle('tv-mode', on)
    this.renderer?.setCinematic(on)
    this.emit()
  }
  toggleTv(): void {
    this.setTv(!this.tv)
  }
  /** Toggle the city-plan zoning overlay (zone tints + plot flags). */
  toggleZones(): void {
    this.zonesVisible = !this.zonesVisible
    this.renderer?.setZonesVisible(this.zonesVisible)
    this.emit()
  }
  /** Capture the current view as a PNG data URL (HUD snapshot button); null before the renderer starts. */
  snapshot(): string | null {
    return this.renderer?.capturePNG() ?? null
  }
  private startAdLoop() {
    if (this.adInterval) return
    // One sponsor / house ad every 90 seconds — the demo of the ad-revenue surface.
    this.adInterval = setInterval(() => {
      this.radio = spinHouseAd(this.radio, Date.now())
      this.emit()
    }, 90_000)
    // First ad immediately so the panel is never empty.
    this.radio = spinHouseAd(this.radio, Date.now())
  }
  private stopAdLoop() {
    if (this.adInterval) clearInterval(this.adInterval)
    this.adInterval = null
  }

  start(container: HTMLElement) {
    if (this.running) return
    this.renderer = new PlanetRenderer(container, this.sim)
    this.renderer.setZonesVisible(this.zonesVisible)
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
        materials: Math.round(s.materials),
        freeLabour: freeLabour(s),
        buildings: s.buildings.length,
        building: s.jobs.length,
        load: Math.round(s.power.loadW * 10) / 10,
        jobs: s.totalJobs,
        employed: s.colonists > 0 ? Math.round((Math.min(s.colonists, s.totalJobs) / s.colonists) * 100) : 0,
        pollution: Math.round(s.pollution),
      },
      settlers: { count: s.settlers.length, recent: s.settlers.slice(-6).reverse().map((x) => ({ id: x.kookerId, name: x.name })) },
      bank: {
        currency: CURRENCY,
        deposits: Math.round(bankDeposits(s.ledger)),
        accounts: s.settlers.length,
        recent: s.ledger.txns.slice(0, 6).map((tx) => ({ id: tx.id, memo: tx.memo })),
      },
      border: { households: this.backend.households(), bots: this.botService.bots, botSource: this.botService.source, plots: this.cityPlan.plots },
      radio: this.radio,
      tv: this.tv,
      zonesVisible: this.zonesVisible,
      name: s.name,
      biome: BIOME_LABEL[s.terrain.biome[li]!] ?? 'Unknown',
      view: this.view,
      preset: this.preset,
    }
  }
}
