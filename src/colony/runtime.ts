// Browser runtime for the colony: fixed-timestep sim loop + planet renderer + camera presets.
import { COLONY } from './config'
import { ColonySim } from './sim'
import { PlanetRenderer, type CameraPreset, type ViewMode, type AvatarView } from './render/PlanetRenderer'
import { Biome } from './terrain'
import { autoGrow, freeLabour, housingCapacity, wateredFraction, provisionedFraction, housingTierCounts, healthFraction, cultureFraction, colonyLiveability, surveyAvailable, tradeExportRate, cultureFuelFactor, courierAvailable, colonyHeadlines, inBrownout, pollutedFraction, commute, maintenanceStatus, storageStatus, incidentStatus, levyStatus, feverStatus, housewaresFraction, unrestStatus, wageStatus, feastStatus, callFeast, liaisonStatus, fulfillRequest, spireStatus, fundSpireStage, frontStatus, foundersStatus, importStatus, solaceStatus, arrearsStatus, rosterStatus, departureStatus, educationStatus, prosperityStatus, turbinePower, waterStatus, toolStatus, seedStatus, confidenceStatus, birthStatus, footprintStatus, veinStatus, calendarStatus, seasonStatus, ledgerStatus, rimfishStatus, driedFishStatus, duskcapStatus, bathhouseStatus, libraryStatus, wasteStatus, securityStatus, dietVarietyStatus, labourStatus, planterStatus, stallStatus, galleryStatus, porterStatus, avatarStatus, fireStatus, reclaimStatus, festivalStatus, type ImportGood } from './build'
import { registerSettler as kookerRegister, generateName as randomSettlerName, type KookerCard } from './kooker'
import { addSettler, saveColony, restoreColony, clearColony } from './settlers'
import { bankDeposits, CURRENCY } from './ledger'
import { MockBackend, type CityLifeBackend, type Decision } from './backend'
import type { Household, HouseholdOverrides } from './newcomers'
import { spawnCitizenSubUser, splitName } from './bot/citizenSpawn'
import { BotService, defaultBotAdapter, resolveBotAdapter, type Bot } from './bots'
import { makeCityPlan, type CityPlan, type Plot } from './cityPlan'
import { CitizenRoster, type CitizenPublic } from './bot/citizenRoster'
import { firstPersonView, type FirstPersonView } from './bot/firstPersonView'
import { solCount, resolveFoundingMs } from './sol'
import { makeNeighborhood, defaultBlueprint, type Neighborhood, type Lot } from './neighborhood'
import { createRadio, tuneTo, toggleOn as radioToggleOn, toggleMuted as radioToggleMuted, spinHouseAd, type RadioState } from './radio'
import { buildShareCard, headlineFor, shareStats, siteLabel, DEFAULT_TAGLINE, CARD_ID, type CardFormat } from './social/shareCard'

// Spec 078 — Joe the Crab, the founding resident. Fixed id + birth stamp + house so he is deterministic,
// always present from sol zero, and survives reloads with no new save format. His house is an authored 077
// blueprint (a sea-facing patio cottage — his "city desk" by the water), reserved on the shore-most plot.
const JOE_ID = 'citizen_joe'
const JOE_BORN_MS = 0
const JOE_BLUEPRINT =
  'house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}'

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
  clock: { day: number; hour: number; minute: number; isDay: boolean; sol: number }
  power: { solarW: number; loadW: number; batteryWh: number; batteryCapWh: number; pct: number; brownout: boolean; windW: number }
  colonists: number
  colony: { treasury: number; materials: number; components: number; food: number; reels: number; fibre: number; linen: number; folios: number; skilled: number; freeLabour: number; capacity: number; watered: number; provisioned: number; health: number; culture: number; cultureFuelled: boolean; liveability: number; smog: number; commute: { demand: number; capacity: number; congested: boolean }; maintenance: { worst: number; needing: number; sheds: number }; storage: { fill: number; full: boolean; tightest: string }; incidents: { active: number; capacity: number }; levy: { active: boolean; rate: 'low' | 'normal' | 'high' }; wage: { active: boolean; rate: 'low' | 'standard' | 'generous'; payroll: number }; feast: { active: boolean; daysLeft: number; canCall: boolean }; liaison: { active: boolean; standing: number; request: { good: string; amount: number; daysLeft: number } | null; canFulfil: boolean }; spire: { stage: number; total: number; progress: number; building: boolean; complete: boolean }; front: { timerDays: number; incoming: boolean; braced: boolean; watching: boolean; established: boolean }; founders: { active: boolean; seated: number; notable: { name: string; role: string } | null }; imports: { active: boolean; order: ImportGood | null; perDay: number; dailySpend: number }; solace: { coverage: number; shrines: number }; education: { coverage: number; schools: number }; prosperity: { active: boolean; score: number; rank: number; rankName: string; recognised: boolean }; water: { stored: number; cap: number; cisterns: number; dry: boolean }; tools: { stored: number; cap: number; cribs: number; short: boolean }; seed: { stored: number; cap: number; lofts: number; short: boolean }; arrears: { office: boolean; debt: number; ceiling: number; strain: boolean; unmanaged: boolean }; roster: { active: boolean; mode: 'essentials' | 'balanced' | 'industry' }; departures: { pressure: number; atRisk: boolean; cause: string }; confidence: { confidence: number; factor: number; slowed: boolean; halted: boolean }; births: { children: number; homes: number; growing: boolean }; footprint: { radius: number; claims: number; maxClaims: number; progress: number; camp: boolean; atEdge: boolean }; veins: { mines: number; poorest: number }; calendar: { year: number; month: number; monthsToFounders: number; office: boolean }; season: { name: string; modifier: number; solarModifier: number; active: boolean }; ledger: { ageYears: number; onset: number; turning: boolean; lastPassings: number; hall: boolean }; rimfish: { stock: number; docks: number; varied: boolean }; driedFish: { stock: number; cap: number; racks: number }; duskcap: { stock: number; cellars: number }; bathhouse: { hygiene: number; baths: number; drawBonus: number; climbBonus: number }; library: { libraries: number; lending: boolean; foliosPerDay: number }; waste: { level: number; posts: number; harmful: boolean; fevered: boolean }; security: { active: boolean; lossPerDay: number; nooks: number; guarded: boolean }; labour: { active: boolean; unemployment: number; covered: number; penalty: number; dragging: boolean }; planters: { squares: number; blooming: number }; stalls: { stalls: number; open: boolean; coinPerDay: number }; gallery: { galleries: number; open: boolean; coinPerDay: number }; porter: { sheds: number; working: boolean; porters: number }; avatar: { foundries: number; staffed: boolean; capacity: number }; fire: { posts: number; active: number; risk: number; watered: boolean }; reclaim: { plants: number; perDay: number; active: boolean }; festival: { board: boolean; cheerDays: number; bonus: number; active: boolean }; diet: { counters: number; covered: number; served: number; standing: number; share: number; varied: boolean; bonus: number }; fever: { level: number; contained: boolean }; housewares: number; order: { unrest: number; warded: boolean }; surveyed: boolean; trade: number; tiers: [number, number, number]; buildings: number; building: number; load: number; jobs: number; employed: number; pollution: number }
  settlers: { count: number; recent: { id: number; name: string }[] }
  bank: { currency: string; deposits: number; accounts: number; recent: { id: number; memo: string }[] }
  border: { households: Household[]; bots: Bot[]; botSource: string; plots: Plot[] }
  citizens: { count: number; awake: number; list: CitizenPublic[] }
  firstPerson: { active: boolean; citizenId: string | null; citizenName: string | null; operatorCitizenId: string | null; view: FirstPersonView | null; narration: string | null; narrating: boolean }
  neighborhood: { lots: { id: string; built: boolean; owner: string | null; ownerId: string | null; reserved: boolean }[]; free: number; built: number; houseCost: number; canAfford: boolean; buildHint: string }
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
  // Spec 075 — the buildable neighbourhood: a street of lots where citizens raise voxel homes.
  private neighborhood!: Neighborhood
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
  // Sol = real days since founding (operator directive: every real day is a sol). Fixed on first boot and
  // accumulated in wall-clock time, decoupled from the fast sim economy clock — so a 24/7 colony ages honestly.
  private foundingMs: number = resolveFoundingMs(typeof localStorage === 'undefined' ? undefined : localStorage, Date.now())
  // P1 — the logged-in operator's name, so we can mark which avatar is theirs + gate the step-into.
  private operatorName: string | null = null
  // P1 — the citizen currently being viewed in first person (null = orbit camera).
  private fpCitizenId: string | null = null
  // First-person locomotion — which movement keys are held while you walk your bot around.
  private fpKeys = new Set<string>()
  private fpNarration: string | null = null
  private fpNarrating = false

  constructor(seed: number = COLONY.render.seed) {
    this.sim = new ColonySim(seed)
    restoreColony(this.sim.state) // re-place settlers + restore the Kookerverse ledger
    this.cityPlan = makeCityPlan(this.sim.state.terrain)
    this.sim.state.cityPlan = this.cityPlan // expose to the renderer for the zone tint + plot markers
    this.botService.setCityPlan(this.cityPlan)
    // Spec 076 — lay out the homestead neighbourhood. The carriageway + verge are RESERVED in the
    // roadSet (so the colony never builds on them — build.ts skips roadSet cells), but kept OUT of the
    // state.roads array: that array is drawn as black colony asphalt, and a residential lane should read
    // as warm packed earth, not a black gash. The renderer draws the carriageway + verge itself.
    this.neighborhood = makeNeighborhood(this.sim.state.terrain)
    for (const c of this.neighborhood.carriage) this.sim.state.roadSet.add(`${c.x},${c.y}`)
    for (const c of this.neighborhood.verge) this.sim.state.roadSet.add(`${c.x},${c.y}`)
    this.seedJoe() // spec 078 — Joe the Crab takes up residence on the shore-most homestead
    // Resolve the real reply source asynchronously (in-cluster: nginx-proxied Hermes; else mock).
    void this.initBotAdapter()
  }

  /** Swap in the runtime-resolved bot adapter (Hermes via the nginx proxy in-cluster) once known. */
  private async initBotAdapter(): Promise<void> {
    try {
      const adapter = await resolveBotAdapter()
      this.botService.setAdapter(adapter)
      this.emit() // refresh botSource in the UI
    } catch {
      /* keep the sync default (mock) on any failure */
    }
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
  async addNewcomer(overrides?: HouseholdOverrides): Promise<Household> {
    const h = await this.backend.addNewcomer(overrides)
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
        if (plot) {
          const citizen = this.citizens.register(h, plot, Date.now())
          // Spec 076 — give the newcomer a real HOMESTEAD parcel (not just the flavour plot name), so
          // their avatar walks to a homestead that is actually theirs. If the colony can afford it
          // (materials + a free hand), raise the house right away; otherwise the Build button stands
          // ready on their plot in the Homesteads panel.
          if (citizen) {
            const freeLot = this.neighborhood.lots.find((l) => !l.ownerCitizenId && !l.reservedFor)
            if (freeLot) {
              this.assignLot(citizen.id, freeLot.id)
              this.buildHouse(freeLot.id) // best-effort; gated on materials + labour
            }
          }
          // Spec 076 — mint the real kooker sub-user + Hermes pod for this citizen, owned by the player
          // (parentUserId). Best-effort: never blocks the game if the backend is unreachable.
          const lead = h.members[0]
          if (lead) {
            const { firstName, lastName } = splitName(lead.name)
            void spawnCitizenSubUser({ firstName, lastName, age: lead.age, profession: lead.occupation }).then((r) => {
              if (!r.ok) console.warn('[citylife] citizen sub-user spawn deferred:', r.error)
            })
          }
        }
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

  /** P2 — turn a player's magic prompt into a PG-safe colonist personality (safety enforced on the
   *  prompt and the generated text). Returns a discriminated result so the UI shows the reason on reject. */
  generatePersonality(magicPrompt: string): Promise<{ ok: true; personality: string } | { ok: false; reason: string }> {
    return this.botService.generatePersonality(magicPrompt)
  }

  /** P1 — record the logged-in operator name (from auth). Marks their avatar + gates the step-into. */
  setOperatorName(name: string | null): void {
    this.operatorName = name && name.trim() ? name.trim() : null
    this.emit()
  }

  /** P1 — the citizen the operator owns (their login name matches the citizen display name), or null. */
  private operatorCitizenId(): string | null {
    if (!this.operatorName) return null
    const me = this.operatorName.toLowerCase()
    const hit = this.citizens.list().find((c) => c.displayName.toLowerCase() === me)
    return hit?.id ?? null
  }

  /** P1 — the bot/governor points a citizen's avatar at a destination cell (it walks there). */
  setAvatarTarget(citizenId: string, cell: { x: number; y: number }): boolean {
    const ok = this.citizens.setTarget(citizenId, cell)
    if (ok) this.emit()
    return ok
  }

  /** P1 — step the operator INTO a citizen for a live first-person view through the bot's eyes. */
  enterFirstPerson(citizenId: string): boolean {
    if (!this.citizens.byId(citizenId)) return false
    this.fpCitizenId = citizenId
    this.renderer?.enterFirstPerson(citizenId)
    this.emit()
    return true
  }
  /** P1 — leave first-person, restoring the orbit camera. */
  exitFirstPerson(): void {
    this.fpCitizenId = null
    this.fpKeys.clear()
    this.fpNarration = null
    this.fpNarrating = false
    this.renderer?.exitFirstPerson()
    this.emit()
  }

  /** First-person locomotion — hold W/S (or up/down) to walk, A/D (or left/right) to turn. The HUD
   *  keydown/keyup feed this; movement is applied per-frame in the loop so it is smooth. */
  setFpKey(key: string, down: boolean): void {
    const map: Record<string, string> = {
      w: 'fwd', arrowup: 'fwd', s: 'back', arrowdown: 'back',
      a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
    }
    const m = map[key.toLowerCase()]
    if (!m) return
    if (down) this.fpKeys.add(m)
    else this.fpKeys.delete(m)
  }

  /** A cell is walkable if it is on the island (in-bounds, not water). */
  private onLand(x: number, y: number): boolean {
    const t = this.sim.state.terrain
    const ix = Math.round(x), iy = Math.round(y)
    if (ix < 0 || iy < 0 || ix >= t.size || iy >= t.size) return false
    return !t.isWater(ix, iy)
  }

  /** Drive the avatar you have stepped into, from the held keys. Turns the heading and steps the
   *  position forward/back on land; freezes its auto-walk target so it stays where you put it. */
  private driveFirstPerson(dt: number): void {
    const c = this.fpCitizenId ? this.citizens.byId(this.fpCitizenId) : null
    if (!c) return
    const k = this.fpKeys
    const turn = 2.4 * dt
    if (k.has('left')) c.heading -= turn
    if (k.has('right')) c.heading += turn
    let mv = 0
    if (k.has('fwd')) mv += 1
    if (k.has('back')) mv -= 1
    if (mv !== 0) {
      const sp = 3.4 * dt * mv
      const nx = c.pos.x + Math.cos(c.heading) * sp
      const ny = c.pos.y + Math.sin(c.heading) * sp
      if (this.onLand(nx, ny)) { c.pos.x = nx; c.pos.y = ny }
    }
    c.target = { x: c.pos.x, y: c.pos.y } // hold the auto-walk while you drive
  }

  /** Keep the citizens alive in watch mode — when an idle one (not the one you are driving) has reached
   *  its target, it occasionally picks a new spot nearby to stroll to, so the streets are never frozen. */
  private wanderIdleCitizens(dt: number): void {
    const roads = this.sim.state.roads
    if (roads.length === 0) return
    for (const pub of this.citizens.list()) {
      if (pub.id === this.fpCitizenId) continue
      const c = this.citizens.byId(pub.id)
      if (!c) continue
      if (Math.hypot(c.target.x - c.pos.x, c.target.y - c.pos.y) > 0.5) continue // still walking
      if (Math.random() < dt * 0.45) {
        const near = roads.filter((r) => Math.hypot(r.x - c.pos.x, r.y - c.pos.y) < 16)
        const pool = near.length ? near : roads
        const dest = pool[(Math.random() * pool.length) | 0]!
        c.target = { x: dest.x + (Math.random() - 0.5), y: dest.y + (Math.random() - 0.5) }
      }
    }
  }

  // ── Spec 075 — the buildable neighbourhood ──────────────────────────────────
  /** The neighbourhood lots (for the renderer + the HUD). */
  lots(): Lot[] {
    return this.neighborhood.lots
  }

  /** Spec 078 — Joe the Crab, the founder. Reserve the shore-most homestead as permanently his, raise his
   *  fixed 077 house on it, and seed his crab citizen so he is always present and roams the streets. Pure +
   *  deterministic from the terrain and idempotent (the roster guards on the fixed id), so reloads reproduce
   *  the identical Joe without any new save format. The newcomer search skips reservedFor lots so Joe's plot
   *  is never handed to an arriving family. */
  private seedJoe(): void {
    const lots = this.neighborhood.lots
    if (lots.length === 0) return
    const t = this.sim.state.terrain
    const distToWater = (cx: number, cy: number): number => {
      for (let r = 1; r <= 16; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
            const x = cx + dx, y = cy + dy
            if (x < 0 || y < 0 || x >= t.size || y >= t.size) continue
            if (t.isWater(x, y)) return r
          }
        }
      }
      return 999
    }
    // Joe lives by the water: the homestead nearest the sea (ties broken by id for determinism).
    let plot = lots[0]!
    let best = Infinity
    for (const l of lots) {
      const d = distToWater(Math.round(l.x), Math.round(l.y))
      if (d < best || (d === best && l.id < plot.id)) { best = d; plot = l }
    }
    plot.reservedFor = JOE_ID
    plot.ownerCitizenId = JOE_ID
    plot.built = true
    plot.blueprint = JOE_BLUEPRINT
    const home = {
      x: Math.round(plot.houseZone.x + (plot.houseZone.w - 1) / 2),
      y: Math.round(plot.houseZone.y + (plot.houseZone.d - 1) / 2),
    }
    const joe = this.citizens.seedFounder({
      id: JOE_ID, householdId: 'household_joe', displayName: 'Joe the Crab',
      plotId: plot.id, plotName: 'Driftwood Cove', home, kind: 'crab', nowMs: JOE_BORN_MS, spd: 0.6,
    })
    if (joe) this.citizens.setTarget(JOE_ID, { x: plot.doorX, y: plot.doorY }) // start him strolling from his door
  }

  /** Assign a free lot to a citizen as their home, and send their avatar walking to the door. */
  assignLot(citizenId: string, lotId: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    const c = this.citizens.byId(citizenId)
    if (!lot || !c || lot.ownerCitizenId) return false
    for (const l of this.neighborhood.lots) if (l.ownerCitizenId === citizenId) { l.ownerCitizenId = undefined; l.built = false }
    lot.ownerCitizenId = citizenId
    // Home = the house-zone centre (set back from the street), so stepping into the citizen parks at
    // their actual home; the avatar walks to the door cell facing the street.
    c.homeXY = { x: Math.round(lot.houseZone.x + (lot.houseZone.w - 1) / 2), y: Math.round(lot.houseZone.y + (lot.houseZone.d - 1) / 2) }
    this.citizens.setTarget(citizenId, { x: lot.doorX, y: lot.doorY })
    this.emit()
    return true
  }

  /** Build a voxel home on a lot — gated on MATERIALS + a free hand (the Caesar III rule). */
  buildHouse(lotId: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    if (!lot || lot.built) return false
    const s = this.sim.state
    const cost = COLONY.build.matNeighborHouse
    if (s.materials < cost || freeLabour(s) < 1) return false
    s.materials -= cost
    lot.built = true
    // Spec 077 P2 — seed a deterministic house BLUEPRINT (door facing the street) so the home raises as the
    // fancy greedy-meshed brick house, not the legacy minecraft cottage. The builder route (P3) and the
    // bot/human-authored script storage (P4) will overwrite this with the citizen's own design.
    if (!lot.blueprint) {
      const doorDir = lot.doorY < lot.y ? 'n' : 's'
      lot.blueprint = defaultBlueprint(lot.houseSeed, doorDir)
    }
    this.emit()
    return true
  }

  /** Demolish a lot's house (frees the lot, keeps the citizen). Returns the freed owner id, if any.
   *  Founder plots (spec 078) are protected — they cannot be demolished. */
  demolishLot(lotId: string): string | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    if (!lot || lot.reservedFor) return null
    const owner = lot.ownerCitizenId ?? null
    lot.built = false
    lot.ownerCitizenId = undefined
    this.emit()
    return owner
  }

  /** Demolish the lot AND destroy the citizen who lived there, agent and all — like a legend. */
  demolishLotAndCitizen(lotId: string): boolean {
    const owner = this.demolishLot(lotId)
    if (owner) this.removeCitizen(owner)
    return true
  }

  /** Destroy a citizen: free any lot they held, exit first-person if you were inside them, tear down
   *  their Hermes pod (best-effort, server-side), and drop them from the roster. */
  removeCitizen(citizenId: string): boolean {
    const c = this.citizens.byId(citizenId)
    if (!c) return false
    for (const l of this.neighborhood.lots) if (l.ownerCitizenId === citizenId) { l.ownerCitizenId = undefined; l.built = false }
    if (this.fpCitizenId === citizenId) this.exitFirstPerson()
    if (c.hasPod) void this.teardownPod(citizenId)
    this.citizens.remove(citizenId)
    this.emit()
    return true
  }

  /** Best-effort Hermes pod teardown. The real DELETE /bots/{label} is server-side (DMZ unreachable
   *  from the browser); here we POST the citylife backend destroy intent. Never throws. */
  private async teardownPod(citizenId: string): Promise<void> {
    try {
      await fetch(`/kooker/api/v1/citylife/citizens/${encodeURIComponent(citizenId)}/destroy`, { method: 'POST' })
    } catch {
      /* expected offline / internal-only */
    }
  }

  /** P1 — move the active first-person citizen by (dx, dy) cells and fire a narration. */
  walkStep(dx: number, dy: number): void {
    const id = this.fpCitizenId
    if (!id) return
    const c = this.citizens.byId(id)
    if (!c) return
    const S = this.sim.state.terrain.size
    const nx = Math.max(0, Math.min(S - 1, Math.round(c.pos.x + dx)))
    const ny = Math.max(0, Math.min(S - 1, Math.round(c.pos.y + dy)))
    this.citizens.setTarget(id, { x: nx, y: ny })
    this.emit()
    // Narrate once the avatar arrives (poll until close enough, then fire once).
    void this.narrateOnArrival(id, { x: nx, y: ny })
  }

  /** Ask the bot to narrate what the first-person citizen currently sees. */
  async narrate(): Promise<void> {
    const id = this.fpCitizenId
    if (!id || this.fpNarrating) return
    const view = firstPersonView(this.sim.state, id, this.citizens)
    if (!view) return
    const c = this.citizens.byId(id)
    if (!c) return
    this.fpNarrating = true
    this.fpNarration = null
    this.emit()
    try {
      const line = await this.botService.narrateView(c.displayName, c.plotName, view)
      this.fpNarration = line
    } catch {
      this.fpNarration = null
    }
    this.fpNarrating = false
    this.emit()
  }

  /** Poll until the avatar reaches the target cell, then trigger a narration. */
  private async narrateOnArrival(citizenId: string, target: { x: number; y: number }): Promise<void> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 300))
      const c = this.citizens.byId(citizenId)
      if (!c) return
      const dx = c.pos.x - target.x, dy = c.pos.y - target.y
      if (Math.hypot(dx, dy) < 1.5) { await this.narrate(); return }
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
        sol: info?.sol ?? ui.clock.sol,
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
    // P1 — feed the renderer the live citizen avatars each frame, marking the operator's own.
    this.renderer.setAvatarSource((): AvatarView[] => {
      const mine = this.operatorCitizenId()
      return this.citizens.avatars().map((a) => ({ ...a, isOperator: a.id === mine }))
    })
    if (this.fpCitizenId) this.renderer.enterFirstPerson(this.fpCitizenId)
    this.renderer.setNeighborhood(this.neighborhood) // spec 075 — lot pads + voxel homes
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
    if (this.fpCitizenId) this.driveFirstPerson(dtReal) // walk your bot with WASD when stepped in
    this.citizens.stepAvatars(dtReal) // P1 — walk the avatars in real time toward their targets
    this.wanderIdleCitizens(dtReal) // keep the citizens strolling so watch mode is never frozen
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
      clock: { day: s.clock.day, hour: s.clock.hour, minute: s.clock.minute, isDay: s.clock.isDay, sol: solCount(this.foundingMs, Date.now()) },
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
      firstPerson: (() => {
        const opId = this.operatorCitizenId()
        const c = this.fpCitizenId ? this.citizens.byId(this.fpCitizenId) : null
        const view = this.fpCitizenId ? firstPersonView(this.sim.state, this.fpCitizenId, this.citizens) : null
        return { active: this.fpCitizenId !== null, citizenId: this.fpCitizenId, citizenName: c?.displayName ?? null, operatorCitizenId: opId, view, narration: this.fpNarration, narrating: this.fpNarrating }
      })(),
      neighborhood: (() => {
        const lots = this.neighborhood.lots.map((l) => ({
          id: l.id,
          built: l.built,
          owner: l.ownerCitizenId ? (this.citizens.byId(l.ownerCitizenId)?.displayName ?? null) : null,
          ownerId: l.ownerCitizenId ?? null,
          reserved: !!l.reservedFor, // spec 078 — founder plots show a nameplate and hide demolish/evict
        }))
        // Build affordability so the Build button can tell the truth instead of silently failing.
        const cost = COLONY.build.matNeighborHouse
        const hands = Math.floor(freeLabour(s))
        const canAfford = s.materials >= cost && hands >= 1
        const buildHint = canAfford
          ? `Raise the voxel house — costs ${cost} materials and 1 free pair of hands`
          : `Can't build yet: need ${cost} materials (have ${s.materials})${hands < 1 ? ' and a free pair of hands (everyone is working)' : ''}`
        return { lots, free: lots.filter((l) => !l.ownerId).length, built: lots.filter((l) => l.built).length, houseCost: cost, canAfford, buildHint }
      })(),
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
