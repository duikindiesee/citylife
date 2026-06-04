// Browser runtime for the colony: fixed-timestep sim loop + planet renderer + camera presets.
import { COLONY } from './config'
import { ColonySim } from './sim'
import { PlanetRenderer, type CameraPreset, type ViewMode } from './render/PlanetRenderer'
import { Biome } from './terrain'
import { autoGrow, freeLabour, housingCapacity, wateredFraction, provisionedFraction, housingTierCounts, healthFraction, cultureFraction, colonyLiveability, surveyAvailable, tradeExportRate, cultureFuelFactor, courierAvailable, colonyHeadlines, inBrownout, pollutedFraction, commute, maintenanceStatus, storageStatus, incidentStatus, levyStatus, feverStatus, housewaresFraction, unrestStatus, wageStatus, feastStatus, callFeast, liaisonStatus, fulfillRequest, spireStatus, fundSpireStage, frontStatus, foundersStatus, importStatus, solaceStatus, arrearsStatus, rosterStatus, departureStatus, educationStatus, prosperityStatus, turbinePower, waterStatus, toolStatus, seedStatus, confidenceStatus, birthStatus, footprintStatus, veinStatus, calendarStatus, seasonStatus, ledgerStatus, rimfishStatus, driedFishStatus, duskcapStatus, bathhouseStatus, libraryStatus, wasteStatus, securityStatus, dietVarietyStatus, labourStatus, planterStatus, stallStatus, galleryStatus, porterStatus, avatarStatus, fireStatus, reclaimStatus, festivalStatus, type ImportGood } from './build'
import { registerSettler as kookerRegister, generateName as randomSettlerName, type KookerCard } from './kooker'
import { addSettler, saveColony, restoreColony, clearColony } from './settlers'
import { bankDeposits, CURRENCY } from './ledger'
import { MockBackend, type CityLifeBackend, type Decision } from './backend'
import type { Household } from './newcomers'
import { BotService, defaultBotAdapter, type Bot } from './bots'
import { makeCityPlan, type CityPlan, type Plot } from './cityPlan'
import { CitizenRoster, type CitizenPublic } from './bot/citizenRoster'
import { firstPersonView, type FirstPersonView } from './bot/firstPersonView'
import { createRadio, tuneTo, toggleOn as radioToggleOn, toggleMuted as radioToggleMuted, spinHouseAd, type RadioState } from './radio'
import { buildShareCard, headlineFor, shareStats, siteLabel, DEFAULT_TAGLINE, CARD_ID, type CardFormat } from './social/shareCard'

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
  power: { solarW: number; loadW: number; batteryWh: number; batteryCapWh: number; pct: number; brownout: boolean; windW: number }
  colonists: number
  colony: { treasury: number; materials: number; components: number; food: number; reels: number; fibre: number; linen: number; folios: number; skilled: number; freeLabour: number; capacity: number; watered: number; provisioned: number; health: number; culture: number; cultureFuelled: boolean; liveability: number; smog: number; commute: { demand: number; capacity: number; congested: boolean }; maintenance: { worst: number; needing: number; sheds: number }; storage: { fill: number; full: boolean; tightest: string }; incidents: { active: number; capacity: number }; levy: { active: boolean; rate: 'low' | 'normal' | 'high' }; wage: { active: boolean; rate: 'low' | 'standard' | 'generous'; payroll: number }; feast: { active: boolean; daysLeft: number; canCall: boolean }; liaison: { active: boolean; standing: number; request: { good: string; amount: number; daysLeft: number } | null; canFulfil: boolean }; spire: { stage: number; total: number; progress: number; building: boolean; complete: boolean }; front: { timerDays: number; incoming: boolean; braced: boolean; watching: boolean; established: boolean }; founders: { active: boolean; seated: number; notable: { name: string; role: string } | null }; imports: { active: boolean; order: ImportGood | null; perDay: number; dailySpend: number }; solace: { coverage: number; shrines: number }; education: { coverage: number; schools: number }; prosperity: { active: boolean; score: number; rank: number; rankName: string; recognised: boolean }; water: { stored: number; cap: number; cisterns: number; dry: boolean }; tools: { stored: number; cap: number; cribs: number; short: boolean }; seed: { stored: number; cap: number; lofts: number; short: boolean }; arrears: { office: boolean; debt: number; ceiling: number; strain: boolean; unmanaged: boolean }; roster: { active: boolean; mode: 'essentials' | 'balanced' | 'industry' }; departures: { pressure: number; atRisk: boolean; cause: string }; confidence: { confidence: number; factor: number; slowed: boolean; halted: boolean }; births: { children: number; homes: number; growing: boolean }; footprint: { radius: number; claims: number; maxClaims: number; progress: number; camp: boolean; atEdge: boolean }; veins: { mines: number; poorest: number }; calendar: { year: number; month: number; monthsToFounders: number; office: boolean }; season: { name: string; modifier: number; solarModifier: number; active: boolean }; ledger: { ageYears: number; onset: number; turning: boolean; lastPassings: number; hall: boolean }; rimfish: { stock: number; docks: number; varied: boolean }; driedFish: { stock: number; cap: number; racks: number }; duskcap: { stock: number; cellars: number }; bathhouse: { hygiene: number; baths: number; drawBonus: number; climbBonus: number }; library: { libraries: number; lending: boolean; foliosPerDay: number }; waste: { level: number; posts: number; harmful: boolean; fevered: boolean }; security: { active: boolean; lossPerDay: number; nooks: number; guarded: boolean }; labour: { active: boolean; unemployment: number; covered: number; penalty: number; dragging: boolean }; planters: { squares: number; blooming: number }; stalls: { stalls: number; open: boolean; coinPerDay: number }; gallery: { galleries: number; open: boolean; coinPerDay: number }; porter: { sheds: number; working: boolean; porters: number }; avatar: { foundries: number; staffed: boolean; capacity: number }; fire: { posts: number; active: number; risk: number; watered: boolean }; reclaim: { plants: number; perDay: number; active: boolean }; festival: { board: boolean; cheerDays: number; bonus: number; active: boolean }; diet: { counters: number; covered: number; served: number; standing: number; share: number; varied: boolean; bonus: number }; fever: { level: number; contained: boolean }; housewares: number; order: { unrest: number; warded: boolean }; surveyed: boolean; trade: number; tiers: [number, number, number]; buildings: number; building: number; load: number; jobs: number; employed: number; pollution: number }
  settlers: { count: number; recent: { id: number; name: string }[] }
  bank: { currency: string; deposits: number; accounts: number; recent: { id: number; memo: string }[] }
  border: { households: Household[]; bots: Bot[]; botSource: string; plots: Plot[] }
  citizens: { count: number; awake: number; list: CitizenPublic[] }
  radio: RadioState
  courier: { on: boolean; headline: string } // spec 016 — the colony's own news, when a Broadcast Mast is up
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
  // Spec 074 — registry of named citizens (each is the lead of an approved household, allocated to a plot,
  // and the eventual owner of their own Hermes pod). Public-safe slice of this is exposed through uiState.
  private citizens = new CitizenRoster()
  // The surveyed city plan the Border Patrol bot uses to allocate plots.
  private cityPlan!: CityPlan
  // Low Power Radio — CityLife's heartbeat. YouTube embed handles licensing; in-game ads queue up.
  private radio: RadioState = createRadio()
  // TV mode hides the operator UI so you can put the city on any screen and just watch.
  private tv = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tv') === '1'
  // City-plan zoning overlay (zone tints + plot flags) — OFF by default. The static colour plan never
  // helped planning and is superseded by the Caesar III economy (specs 001–010) that now drives how the
  // city actually evolves. Kept as an opt-in HUD toggle while it's redesigned or retired
  // (see docs/research/2026-06-01-zoning-redesign.md).
  private zonesVisible = false
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
      const bot = await this.botService.create(h) // boot a bot, inject its life history, get its first reply
      // Spec 074 — if the patrol bot allocated a plot, register this household's lead as a named citizen.
      // The Hermes pod + kooker user mint happen out-of-process (separate PRs against kooker-bot-spawner /
      // kooker-user, joekookerbot merges) — here we just hold the engine-side record.
      if (bot && bot.plotId) {
        const plot = this.cityPlan.plots.find((p) => p.id === bot.plotId)
        if (plot) this.citizens.register(h, plot, Date.now())
      }
      this.emit()
    }
  }

  /** Spec 074 — engine-side first-person view of one citizen (cheap, deterministic JSON). The
   *  governor loop reads this every tick + may pair it with a costly PNG snapshot (vision). */
  firstPersonView(citizenId: string): FirstPersonView | null {
    return firstPersonView(this.sim.state, citizenId, this.citizens)
  }

  /** Spec 074 — the citizen's VISION as a PNG data URL: what they actually see standing at their
   *  home, looking down their street. Resolves the home cell + the nearest road from the roster +
   *  first-person view, then has the renderer drop to eye height and capture one frame. Returns null
   *  before the renderer starts, for an unknown citizen, or if they have no road in sight yet. */
  firstPersonPNG(citizenId: string): string | null {
    if (!this.renderer) return null
    const c = this.citizens.byId(citizenId)
    if (!c) return null
    const view = firstPersonView(this.sim.state, citizenId, this.citizens)
    const look = view?.nearestRoad ?? { x: this.sim.state.terrain.landing.x, y: this.sim.state.terrain.landing.y }
    return this.renderer.firstPersonPNG(c.homeXY, { x: look.x, y: look.y })
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
  /** Spec 025 — set the household levy rate (the council's fiscal lever; only bites with a staffed Levy Office). */
  setLevy(rate: 'low' | 'normal' | 'high'): void {
    this.sim.state.levyRate = rate
    this.emit()
  }
  /** Spec 029 — set the colony-wide wage rate (the council's pay lever; only bites with a staffed Pay Office). */
  setWage(rate: 'low' | 'standard' | 'generous'): void {
    this.sim.state.wageRate = rate
    this.emit()
  }
  /** Spec 030 — fund a Civic Feast (spends treasury + supplies; needs a staffed Feast Deck). Returns whether it ran. */
  callFeast(): boolean {
    const ok = callFeast(this.sim.state)
    if (ok) this.emit()
    return ok
  }
  /** Spec 032 — fulfil the open Kookerverse Civic Request (spends the goods, raises standing). Returns whether it ran. */
  fulfillRequest(): boolean {
    const ok = fulfillRequest(this.sim.state)
    if (ok) this.emit()
    return ok
  }
  /** Spec 033 — fund the next stage of the Horizon Spire (spends its bundle, reserves a crew). Returns whether it began. */
  fundSpire(): boolean {
    const ok = fundSpireStage(this.sim.state)
    if (ok) this.emit()
    return ok
  }
  /** Spec 036 — set (or clear) the standing import order (only buys with a built, staffed Import Office). */
  setImportOrder(good: ImportGood | null): void {
    this.sim.state.importOrder = good
    this.emit()
  }
  /** Spec 038 — set the labour-priority mode (only bites under a shortage with a staffed Roster Office). */
  setRosterMode(mode: 'essentials' | 'balanced' | 'industry'): void {
    this.sim.state.rosterMode = mode
    this.emit()
  }
  /** Capture the current view as a PNG data URL (HUD snapshot button); null before the renderer starts. */
  snapshot(): string | null {
    return this.renderer?.capturePNG() ?? null
  }
  /** Compose a shareable "poster" of the colony over the current view, mounted as a fixed overlay.
   *  Returns false if the renderer has not started (no hero to capture). Driven by the morning routine. */
  shareCard(info?: { headline?: string; tagline?: string; sol?: number; specTitle?: string; format?: CardFormat }): boolean {
    const hero = this.snapshot()
    if (!hero || typeof document === 'undefined') return false
    const ui = this.getUiState()
    document.getElementById(CARD_ID)?.remove()
    document.body.appendChild(
      buildShareCard({
        hero,
        sol: info?.sol ?? ui.clock.day,
        headline: info?.headline ?? headlineFor(info?.specTitle),
        tagline: info?.tagline ?? DEFAULT_TAGLINE,
        stats: shareStats(ui),
        site: siteLabel(ui),
        format: info?.format ?? 'wide',
      }),
    )
    // Hide everything else (live canvas + HUD) so the poster is clean — the hero is already frozen into the card.
    for (const ch of Array.from(document.body.children)) {
      if (!(ch instanceof HTMLElement) || ch.id === CARD_ID) continue
      ch.dataset.kvPrevDisplay = ch.style.display || '∅'
      ch.style.display = 'none'
    }
    return true
  }
  /** Remove the share-card overlay and restore the normal game view. */
  clearShareCard(): void {
    if (typeof document === 'undefined') return
    document.getElementById(CARD_ID)?.remove()
    for (const ch of Array.from(document.body.children)) {
      if (!(ch instanceof HTMLElement) || !ch.dataset.kvPrevDisplay) continue
      ch.style.display = ch.dataset.kvPrevDisplay === '∅' ? '' : ch.dataset.kvPrevDisplay
      delete ch.dataset.kvPrevDisplay
    }
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
      power: { solarW: p.solarW, loadW: p.loadW, batteryWh: p.batteryWh, batteryCapWh: p.batteryCapWh, pct: p.batteryWh / p.batteryCapWh, brownout: inBrownout(s), windW: Math.round(turbinePower(s) * 10) / 10 },
      colonists: Math.round(s.colonists),
      colony: {
        treasury: Math.round(s.treasury),
        materials: Math.round(s.materials),
        components: Math.round(s.components),
        food: Math.round(s.food),
        reels: Math.round(s.reels),
        fibre: Math.round(s.fibre ?? 0),
        linen: Math.round(s.linen ?? 0),
        folios: Math.round(s.folios ?? 0),
        skilled: Math.floor(Math.min(s.colonists, s.skilled)),
        freeLabour: Math.floor(freeLabour(s)),
        capacity: housingCapacity(s),
        watered: Math.round(wateredFraction(s) * 100),
        provisioned: Math.round(provisionedFraction(s) * 100),
        health: Math.round(healthFraction(s) * 100),
        culture: Math.round(cultureFraction(s) * 100),
        cultureFuelled: cultureFuelFactor(s) >= 1,
        liveability: Math.round(colonyLiveability(s) * 100),
        smog: Math.round(pollutedFraction(s) * 100),
        commute: (() => { const c = commute(s); return { demand: Math.round(c.demand), capacity: c.capacity, congested: c.congested } })(),
        maintenance: (() => { const m = maintenanceStatus(s); return { worst: Math.round(m.worstWear * 100), needing: m.needing, sheds: m.sheds } })(),
        storage: (() => { const st = storageStatus(s); return { fill: Math.round(st.fill * 100), full: st.full, tightest: st.tightest } })(),
        incidents: incidentStatus(s),
        levy: levyStatus(s),
        wage: wageStatus(s),
        feast: feastStatus(s),
        liaison: liaisonStatus(s),
        spire: spireStatus(s),
        front: frontStatus(s),
        founders: foundersStatus(s),
        imports: importStatus(s),
        solace: (() => { const sl = solaceStatus(s); return { coverage: Math.round(sl.coverage * 100), shrines: sl.shrines } })(),
        education: (() => { const ed = educationStatus(s); return { coverage: Math.round(ed.coverage * 100), schools: ed.schools } })(),
        prosperity: prosperityStatus(s),
        water: waterStatus(s),
        tools: toolStatus(s),
        seed: seedStatus(s),
        arrears: arrearsStatus(s),
        roster: rosterStatus(s),
        departures: (() => { const d = departureStatus(s); return { pressure: Math.round(d.pressure * 100), atRisk: d.atRisk, cause: d.cause } })(),
        confidence: confidenceStatus(s),
        births: birthStatus(s),
        footprint: footprintStatus(s),
        veins: veinStatus(s),
        calendar: calendarStatus(s),
        season: seasonStatus(s),
        ledger: ledgerStatus(s),
        rimfish: rimfishStatus(s),
        driedFish: driedFishStatus(s),
        duskcap: duskcapStatus(s),
        bathhouse: bathhouseStatus(s),
        library: libraryStatus(s),
        waste: wasteStatus(s),
        security: securityStatus(s),
        labour: labourStatus(s),
        planters: planterStatus(s),
        stalls: stallStatus(s),
        gallery: galleryStatus(s),
        porter: porterStatus(s),
        avatar: avatarStatus(s),
        fire: fireStatus(s),
        reclaim: reclaimStatus(s),
        festival: festivalStatus(s),
        diet: dietVarietyStatus(s),
        fever: (() => { const f = feverStatus(s); return { level: Math.round(f.outbreak * 100), contained: f.contained } })(),
        housewares: Math.round(housewaresFraction(s) * 100),
        order: (() => { const o = unrestStatus(s); return { unrest: Math.round(o.unrest * 100), warded: o.warded } })(),
        surveyed: surveyAvailable(s),
        trade: Math.round(tradeExportRate(s)),
        tiers: housingTierCounts(s),
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
      citizens: { count: this.citizens.size(), awake: this.citizens.awakeCount(), list: this.citizens.list() },
      radio: this.radio,
      courier: (() => {
        // Spec 016 — the Kookerverse Courier: rotate through the colony's currently-true headlines.
        const on = courierAvailable(s)
        const lines = on ? colonyHeadlines(s) : []
        return { on, headline: lines.length ? lines[Math.floor(s.clock.totalMinutes / 15) % lines.length]! : '' }
      })(),
      tv: this.tv,
      zonesVisible: this.zonesVisible,
      name: s.name,
      biome: BIOME_LABEL[s.terrain.biome[li]!] ?? 'Unknown',
      view: this.view,
      preset: this.preset,
    }
  }
}
