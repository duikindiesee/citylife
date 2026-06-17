// Browser runtime for the colony: fixed-timestep sim loop + planet renderer + camera presets.
import { COLONY } from './config'
import { ColonySim } from './sim'
import { PlanetRenderer, type CameraPreset, type ViewMode, type AvatarView } from './render/PlanetRenderer'
import { Biome } from './terrain'
import { autoGrow, freeLabour, housingCapacity, wateredFraction, provisionedFraction, housingTierCounts, healthFraction, cultureFraction, colonyLiveability, surveyAvailable, tradeExportRate, cultureFuelFactor, courierAvailable, colonyHeadlines, inBrownout, pollutedFraction, commute, maintenanceStatus, storageStatus, incidentStatus, levyStatus, feverStatus, housewaresFraction, unrestStatus, wageStatus, feastStatus, callFeast, liaisonStatus, fulfillRequest, spireStatus, fundSpireStage, frontStatus, foundersStatus, importStatus, solaceStatus, arrearsStatus, rosterStatus, departureStatus, educationStatus, prosperityStatus, turbinePower, waterStatus, toolStatus, seedStatus, confidenceStatus, birthStatus, footprintStatus, veinStatus, calendarStatus, seasonStatus, ledgerStatus, rimfishStatus, driedFishStatus, duskcapStatus, bathhouseStatus, libraryStatus, wasteStatus, securityStatus, dietVarietyStatus, labourStatus, planterStatus, stallStatus, galleryStatus, porterStatus, avatarStatus, fireStatus, reclaimStatus, festivalStatus, reserveParcelLand, mergeAvenue, type ImportGood } from './build'
import { registerSettler as kookerRegister, generateName as randomSettlerName, type KookerCard } from './kooker'
import { addSettler, saveColony, restoreColony, clearColony } from './settlers'
import { walletDeposits, walletCount, balance as ledgerBalance, post as ledgerPost, CURRENCY } from './ledger'
import { plotPriceKook, kookToZar, starterDeposit } from './land'
import { MockBackend, type CityLifeBackend, type Decision } from './backend'
import type { Household, HouseholdOverrides } from './newcomers'
import { spawnCitizenSubUser, splitName } from './bot/citizenSpawn'
import { BotService, defaultBotAdapter, resolveBotAdapter, type Bot } from './bots'
import { makeCityPlan, type CityPlan, type Plot } from './cityPlan'
import { CitizenRoster, type CitizenPublic } from './bot/citizenRoster'
import { firstPersonView, type FirstPersonView } from './bot/firstPersonView'
import { solCount, resolveFoundingMs } from './sol'
import { makeNeighborhood, makeNeighborhoodAt, findSatelliteAnchors, defaultBlueprint, retargetParcelAccess, streetDoorDir, type Neighborhood, type Lot } from './neighborhood'
import { validateBlueprint, parseBlueprint } from './blueprintScript'
import { loadBlueprintsLocal, saveBlueprintLocal, saveBlueprintBackend, fetchBlueprintsBackend, mergeBlueprints } from './bot/blueprintStore'
import { selfDesign, type SelfDesignResult } from './builder/selfDesign'
import { dreamBrief, negotiate, briefToBlueprint, seededBudget, VIW_SEED, type NegotiationSession } from './builder/negotiation'
import { createProfile, addPost, type KbProfile, type PostKind } from './social/kookerbook'
import { loadKookerbookLocal, saveProfileLocal, saveProfileBackend, fetchKookerbookBackend, mergeKookerbook } from './bot/kookerbookStore'
import { getLedgerSync, type LedgerMove, type SyncStatus } from './bot/ledgerSync'
import { makeCommercialDistrict, type CommercialDistrict, type ShopKind, type ShopParcel } from './commerce/district'
import { cellOk, leastCostPath, type Cell } from './pathfind'
import { createRadio, tuneTo, toggleOn as radioToggleOn, toggleMuted as radioToggleMuted, spinHouseAd, type RadioState } from './radio'
import { buildShareCard, headlineFor, shareStats, siteLabel, DEFAULT_TAGLINE, CARD_ID, type CardFormat } from './social/shareCard'
import { commercialFrontageExclusion, makeRaceTrack } from './racing/track'
import { newRaceState, stepRace, type RaceInput, type RaceMode, type RaceState } from './racing/race'

// Spec 078 — Joe the Crab, the founding resident. Fixed id + birth stamp + house so he is deterministic,
// always present from sol zero, and survives reloads with no new save format. His house is an authored 077
// blueprint (a sea-facing patio cottage — his "city desk" by the water), reserved on the shore-most plot.
const JOE_ID = 'citizen_joe'
const JOE_BORN_MS = 0
// Spec 083 — Viw the Builder, founder two: the operator's brother's bot-to-be, owner of the build
// trade. Until his real bot (OpenClaw, on the second machine) connects, he lives on the same
// deterministic founder path as Joe.
export const VIW_ID = 'citizen_viw' // exported — the kooker-web OTA mission (079) names the builder by id

// Founder houses are authored ONCE with the front (street/door) on the y:0 edge and mirrored
// vertically for a south street — the defaultBlueprint trick — so the crafted home always faces
// the spine whichever side of the street the founder's plot lands on.
type FounderRoom = { kind: string; x: number; y: number; w: number; d: number; win: 0 | 1 }
export function founderBlueprint(w: number, d: number, wallH: number, doorDir: 'n' | 's', rooms: FounderRoom[]): string {
  const placed = doorDir === 's' ? rooms.map((r) => ({ ...r, y: d - (r.y + r.d) })) : rooms
  const roomStr = placed.map((r) => `room{kind:${r.kind} x:${r.x} y:${r.y} w:${r.w} d:${r.d} win:${r.win}}`)
  return `house{w:${w} d:${d} wallH:${wallH} door:${doorDir}} ${roomStr.join(' ')}`
}
/** Joe's sea-facing cottage, re-authored for his GRAND waterfront plot (spec 084 S6): a wide sea
 *  deck the door opens through, the city desk hall, a bedroom and a corner plunge pool. */
export function joeBlueprint(doorDir: 'n' | 's'): string {
  return founderBlueprint(10, 8, 2, doorDir, [
    { kind: 'patio', x: 0, y: 0, w: 10, d: 3, win: 0 },
    { kind: 'living', x: 0, y: 3, w: 6, d: 5, win: 1 },
    { kind: 'bedroom', x: 6, y: 3, w: 4, d: 3, win: 1 },
    { kind: 'pool', x: 6, y: 6, w: 4, d: 2, win: 0 },
  ])
}
/** Spec 084 S2 — a stored blueprint may only restore onto a FOUNDER plot when it belongs to that
 *  founder. A stale or foreign entry (an old save, a renamed lot, tampered storage) must never
 *  clobber a crafted founder house — Joe's cottage previously survived restore by ordering luck. */
export function canRestoreBlueprint(lot: Pick<Lot, 'reservedFor'>, citizenId: string): boolean {
  return !lot.reservedFor || lot.reservedFor === citizenId
}

/** Viw's crewhouse (spec 084 S6) — the workbench hall fills the front band, the crew garage, bunk
 *  room and timber-yard patio sit behind. The door is fixed EAST: the builder's own house exercises
 *  the spec-084 S2 side-walkway contract on every single boot, so a regression can't hide. */
export const VIW_BLUEPRINT =
  'house{w:8 d:7 wallH:2 door:e} room{kind:living x:0 y:0 w:8 d:5 win:1} room{kind:garage x:0 y:5 w:3 d:2 win:0} room{kind:bedroom x:3 y:5 w:2 d:2 win:1} room{kind:patio x:5 y:5 w:3 d:2 win:0}'

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
  bank: { currency: string; deposits: number; depositsZar: number; accounts: number; landOffice: number; recent: { id: number; memo: string }[]; sync: { pending: number; synced: number; lastError: string | null } }
  border: { households: Household[]; bots: Bot[]; botSource: string; plots: Plot[] }
  citizens: { count: number; awake: number; list: CitizenPublic[]; wallets: Record<string, number> }
  firstPerson: { active: boolean; citizenId: string | null; citizenName: string | null; operatorCitizenId: string | null; view: FirstPersonView | null; narration: string | null; narrating: boolean }
  race: { mode: RaceMode; available: boolean; countdownMs: number; timeMs: number; finishedMs: number | null; bestMs: number | null; checkpoint: number; checkpoints: number; offTrack: boolean }
  neighborhood: { lots: { id: string; built: boolean; owner: string | null; ownerId: string | null; reserved: boolean; price: number | null; priceZar: number | null }[]; free: number; built: number; houseCost: number; canAfford: boolean; buildHint: string }
  commerce: { plots: number; free: number; byKind: { kiosk: number; store: number; showroom: number }; canClaim: boolean; cheapest: { kind: ShopKind; price: number } | null; parcels: { id: string; kind: ShopKind; price: number; priceZar: number; built: boolean; owner: string | null }[] }
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
  private raceState: RaceState | null = null
  private raceInput: RaceInput = {}
  private bestRaceMs: number | null = null
  private readonly worldSeed: number
  /** Spec 084 S6 / 079 — the reserved shop-district land bank at the avenue's inland end. */
  commercialReserve: { x: number; y: number; w: number; h: number } | null = null
  /** Spec 079 P0 — the surveyed commercial high street + shop plots within the reserve. */
  commercialDistrict: CommercialDistrict | null = null
  // Spec 079 — the Nearest bar's seat cells + who's sitting there (a night crowd; cleared by day).
  private barSeatCells: { x: number; y: number }[] | null = null
  private barOccupied = new Set<string>()
  private barSeatBy: (string | null)[] = []
  private fpNarration: string | null = null
  private fpNarrating = false

  constructor(seed: number = COLONY.render.seed) {
    this.worldSeed = seed
    this.sim = new ColonySim(seed)
    restoreColony(this.sim.state) // re-place settlers + restore the Kookerverse ledger
    this.cityPlan = makeCityPlan(this.sim.state.terrain)
    this.sim.state.cityPlan = this.cityPlan // expose to the renderer for the zone tint + plot markers
    this.botService.setCityPlan(this.cityPlan)
    // Spec 076/084 — lay out the homestead neighbourhood. The VERGE is reserved in the roadSet only
    // (the colony never builds on it, cars never drive it); the CARRIAGEWAY merges into the road
    // network as the paved AVENUE below — AFTER reserveParcelLand, so the parcel purge can never
    // eat it (spec 084 S3). Cars finally drive the residential street.
    this.neighborhood = makeNeighborhood(this.sim.state.terrain)
    const t0 = this.sim.state.terrain
    // Spec 086 — the DISTRIBUTED CITY. Order matters: lay + reserve the coastal PRIMARY (founders),
    // then claim the COMMERCIAL reserve off its avenue, THEN scatter satellite hamlets that avoid
    // everything already placed (a shared `taken` set), then stitch trunk roads between them. Without
    // reserving commerce first, the satellites ate its land and the shop district vanished.
    const footprintCells = (nbhd: Neighborhood): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = []
      for (const lot of nbhd.lots) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const f of lot.fence) { minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x); minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y) }
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) out.push({ x, y })
        for (const d of lot.driveway) out.push({ x: d.x, y: d.y })
      }
      return out
    }
    // `taken` = every placed cell (parcels + their roads + the commercial reserve); satellites and the
    // commercial reserve both avoid it so nothing ever overlaps. `residentialKeys` is homestead
    // footprints only — roads may run near them but never through them.
    const taken = new Set<string>()
    const addCells = (cells: { x: number; y: number }[]) => { for (const c of cells) taken.add(`${c.x},${c.y}`) }
    const residentialKeys = new Set<string>()
    const primaryCells = footprintCells(this.neighborhood)
    for (const c of this.neighborhood.verge) this.sim.state.roadSet.add(`${c.x},${c.y}`)
    reserveParcelLand(this.sim.state, primaryCells)
    mergeAvenue(this.sim.state, this.neighborhood.carriage) // spec 084 S3 — the paved avenue joins the network
    addCells(primaryCells); addCells(this.neighborhood.carriage); addCells(this.neighborhood.verge)
    for (const c of primaryCells) residentialKeys.add(`${c.x},${c.y}`)
    // Spec 079 / 086 — the COMMERCIAL RESERVE, claimed BEFORE the satellites so they leave it room.
    // 086-P1: commerce now fronts the FOUNDERS' LIGHTHOUSE on the shore (the operator's scenic anchor).
    // First keep the tower + its base clear, then search the open COASTAL ground beside it, biased
    // toward the founders' side so a coast road can reach it; fall back to the old inland search off
    // the avenue's terminus when there is no lighthouse or no open shore nearby.
    const lighthouse = this.sim.state.structures.find((s) => s.kind === 'lighthouse')
    const lighthouseBlock = new Set<string>()
    if (lighthouse) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) lighthouseBlock.add(`${lighthouse.x + dx},${lighthouse.y + dy}`)
      for (const k of lighthouseBlock) taken.add(k) // shops never cover the tower or its immediate base
    }
    this.commercialReserve = (() => {
      const t = this.sim.state.terrain, W = 40, H = 30
      const clampX = (v: number) => Math.max(0, Math.min(t.size - W, Math.round(v)))
      const clampY = (v: number) => Math.max(0, Math.min(t.size - H, Math.round(v)))
      const claim = (best: { x: number; y: number; w: number; h: number }) => {
        const cells: { x: number; y: number }[] = []
        for (let y = best.y; y < best.y + best.h; y++) for (let x = best.x; x < best.x + best.w; x++) cells.push({ x, y })
        reserveParcelLand(this.sim.state, cells)
        addCells(cells) // the satellites must leave the shop district its room
        return best
      }
      // 086-P1 — the shore beside the lighthouse. Score by clear COASTAL cells (dry, buildable, near
      // the waterline but not on it, unclaimed) so the district hugs the coast by the landmark.
      if (lighthouse) {
        const toLanding = Math.sign(t.landing.x - lighthouse.x) || 1
        let best: { x: number; y: number; w: number; h: number } | null = null, bestScore = -1
        for (const along of [16, 28, 40, 52, 8]) for (const off of [0, -16, 16, -32, 32]) {
          const cx = lighthouse.x + toLanding * along, cy = lighthouse.y + off
          const rx = clampX(cx - W / 2), ry = clampY(cy - H / 2)
          let free = 0, coastal = 0
          for (let y = ry; y < ry + H; y++) for (let x = rx; x < rx + W; x++) {
            if (cellOk(t, x, y) && !taken.has(`${x},${y}`)) { free++; const d = t.distToWater[t.idx(x, y)] ?? 0; if (d >= 2 && d <= 16) coastal++ }
          }
          const s = coastal * 2 + free // hug the shore by the lighthouse, but demand enough clear room
          if (free >= 140 && s > bestScore) { bestScore = s; best = { x: rx, y: ry, w: W, h: H } }
        }
        if (best) return claim(best)
      }
      // fallback — the original inland search past the avenue's terminus in its own inland direction.
      const car = this.neighborhood.carriage
      if (car.length < 2) return null
      const dW = (c: { x: number; y: number }) => t.distToWater[t.idx(Math.round(c.x), Math.round(c.y))] ?? 0
      let inland = car[0]!, shore = car[0]!
      for (const c of car) { if (dW(c) > dW(inland)) inland = c; if (dW(c) < dW(shore)) shore = c }
      let ix = inland.x - shore.x, iy = inland.y - shore.y
      const len = Math.hypot(ix, iy) || 1; ix /= len; iy /= len
      const px = -iy, py = ix
      let best: { x: number; y: number; w: number; h: number } | null = null, bestFree = -1
      for (const step of [12, 20, 28, 36, 44, 52]) for (const perp of [0, -14, 14, -28, 28]) {
        const cx = inland.x + ix * step + px * perp, cy = inland.y + iy * step + py * perp
        const rect = { x: clampX(cx - W / 2), y: clampY(cy - H / 2), w: W, h: H }
        let free = 0
        for (let y = rect.y; y < rect.y + H; y++) for (let x = rect.x; x < rect.x + W; x++) if (cellOk(t, x, y) && !taken.has(`${x},${y}`)) free++
        if (free > bestFree) { bestFree = free; best = rect }
      }
      if (!best || bestFree < 80) return null
      return claim(best)
    })()
    // Spec 086 — SATELLITE HAMLETS in the woods + hills, each routed + placed AROUND everything already
    // taken (the coast, the commercial reserve, prior hamlets), so scattered clusters never overlap.
    const satellites: Neighborhood[] = []
    for (const a of findSatelliteAnchors(t0, { x: t0.landing.x, y: t0.landing.y }, 6)) {
      const nbhd = makeNeighborhoodAt(t0, a, { small: true, blocked: taken })
      if (nbhd.lots.length === 0) continue
      const b = t0.biome[t0.idx(a.x, a.y)]
      const name = `${b === Biome.Forest ? 'wood' : b === Biome.Highland ? 'hill' : 'vale'}${satellites.length + 1}`
      for (const lot of nbhd.lots) lot.id = `${name}_${lot.id}` // unique id; never collides with lot_1/lot_2
      this.neighborhood.parcels.push(...nbhd.parcels) // parcels === lots (same array ref), so lots update too
      const cells = footprintCells(nbhd)
      reserveParcelLand(this.sim.state, cells)
      mergeAvenue(this.sim.state, nbhd.carriage)
      for (const c of nbhd.verge) this.sim.state.roadSet.add(`${c.x},${c.y}`)
      addCells(cells); addCells(nbhd.carriage); addCells(nbhd.verge)
      for (const c of cells) residentialKeys.add(`${c.x},${c.y}`)
      satellites.push(nbhd)
    }
    // Spec 086 P2 — THE ROAD NETWORK. Each hamlet links to the coast AND to its nearest other hamlet
    // (a mesh, not just spokes), and every trunk is WIDENED to a ~3-cell carriageway so it reads as a
    // real road instead of a thread. Routed around every homestead; the router never crosses water.
    const nearestPair = (a: Cell[], b: Cell[]): [Cell, Cell] => {
      let from = a[0]!, to = b[0]!, bestD = Infinity
      for (const p of a) for (const q of b) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < bestD) { bestD = d; from = p; to = q } }
      return [from, to]
    }
    const paveLink = (a: Cell[], b: Cell[]) => {
      if (a.length === 0 || b.length === 0) return
      const [from, to] = nearestPair(a, b)
      const path = leastCostPath(t0, from, to, { slopeWeight: 0.5, blocked: (x, y) => residentialKeys.has(`${x},${y}`) }) ?? []
      if (path.length === 0) return
      // Lay a CONSTANT-WIDTH carriageway by stroking the centreline PERPENDICULAR to its local travel
      // direction, instead of a 3x3 square dilation. The square kernel blew the width out to 4 cells on
      // diagonal runs and corners and pinched to 2 past obstacles (the "3 then 2 then 4 lanes into a
      // corner" the operator saw); a perpendicular stroke keeps the PERCEIVED width steady whether the
      // road runs straight or diagonal, and the overlapping cross-sections fill turns into tidy corners.
      const HALF = 1 // half-width in cells -> a steady ~3-cell carriageway
      const wide = new Set<string>()
      const add = (fx: number, fy: number) => {
        const x = Math.round(fx), y = Math.round(fy)
        if (cellOk(t0, x, y) && !residentialKeys.has(`${x},${y}`)) wide.add(`${x},${y}`)
      }
      for (let i = 0; i < path.length; i++) {
        const prev = path[Math.max(0, i - 1)]!, next = path[Math.min(path.length - 1, i + 1)]!
        let dx = next.x - prev.x, dy = next.y - prev.y
        const len = Math.hypot(dx, dy) || 1
        const px = -dy / len, py = dx / len // unit perpendicular to travel
        add(path[i]!.x, path[i]!.y) // the centreline is always paved (keeps the ribbon connected)
        for (let k = 0.5; k <= HALF + 1e-6; k += 0.5) {
          add(path[i]!.x + px * k, path[i]!.y + py * k)
          add(path[i]!.x - px * k, path[i]!.y - py * k)
        }
      }
      mergeAvenue(this.sim.state, [...wide].map((k) => { const [x, y] = k.split(',').map(Number); return { x: x!, y: y! } }))
    }
    const coast = this.neighborhood.carriage
    for (let i = 0; i < satellites.length; i++) {
      paveLink(coast, satellites[i]!.carriage) // a spoke to the coast keeps every hamlet connected
    }
    const meshed = new Set<string>()
    for (let i = 0; i < satellites.length; i++) {
      let nearest = -1, bestD = Infinity
      for (let j = 0; j < satellites.length; j++) {
        if (j === i) continue
        const [p, q] = nearestPair(satellites[i]!.carriage, satellites[j]!.carriage)
        const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
        if (d < bestD) { bestD = d; nearest = j }
      }
      if (nearest < 0) continue
      const key = `${Math.min(i, nearest)}-${Math.max(i, nearest)}`
      if (meshed.has(key)) continue
      meshed.add(key)
      paveLink(satellites[i]!.carriage, satellites[nearest]!.carriage) // the cross-link that makes it a web
    }
    // Spec 079 — survey the shop district in its reserved room; shops avoid every homestead + road.
    const blockedForShops = new Set<string>(residentialKeys)
    for (const r of this.sim.state.roads) blockedForShops.add(`${r.x},${r.y}`)
    for (const k of lighthouseBlock) blockedForShops.add(k) // 086-P1 — no shop lands on the lighthouse
    this.commercialDistrict = this.commercialReserve
      ? makeCommercialDistrict(this.sim.state.terrain, this.commercialReserve, blockedForShops)
      : null
    // Spec 079 — CONNECT the district: widen the high-street centre-line to a carriageway + route a
    // spur from the avenue's inland terminus to its nearest end (around homesteads + shops), and merge
    // both into the network so the shops front a real, drivable street.
    if (this.commercialDistrict && this.commercialDistrict.street.length > 0) {
      const t = this.sim.state.terrain
      const shopCells = new Set<string>()
      for (const p of this.commercialDistrict.parcels) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) shopCells.add(`${x},${y}`)
      const widened = new Set<string>()
      for (const c of this.commercialDistrict.street) for (const dy of [-1, 0, 1]) {
        const x = c.x, y = c.y + dy
        if (cellOk(t, x, y) && !residentialKeys.has(`${x},${y}`) && !shopCells.has(`${x},${y}`)) widened.add(`${x},${y}`)
      }
      const streetCells = [...widened].map((k) => { const [x, y] = k.split(',').map(Number); return { x: x!, y: y! } })
      const car = this.neighborhood.carriage
      // 086-P1 — connect from the founders' carriage cell NEAREST the (now coastal) district, not the
      // inland terminus, so the spur is the shortest coast road rather than a backtrack inland.
      const [terminus, near] = nearestPair(car, this.commercialDistrict.street)
      const connector = leastCostPath(t, terminus, near, { slopeWeight: 0.5, blocked: (x, y) => residentialKeys.has(`${x},${y}`) || shopCells.has(`${x},${y}`) }) ?? []
      mergeAvenue(this.sim.state, connector)
      mergeAvenue(this.sim.state, streetCells)
    }
    // Spec 082 — restore stored Kookerbook profiles BEFORE seeding Joe: ensureKbProfile skips
    // citizens that already have a profile, so a restored timeline is never clobbered by a fresh
    // founder profile (the bug: seed-then-restore overwrote Joe's stored posts with a 1-post reset).
    this.restoreKookerbook()
    this.seedJoe() // spec 078 — Joe the Crab takes up residence on the shore-most homestead
    this.seedViw() // spec 083 — Viw the Builder takes the homestead beside him
    this.restoreBlueprints() // spec 077 P4.5 — stored designs regenerate their houses on reload
    // Spec 077 P4 — listen for blueprint_saved posted back by the House Builder popup. Same-origin
    // only; the script is validated before anything is stored or built. Guarded for node test runs.
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return
        const d = e.data as { type?: string; lotId?: string; script?: string } | null
        if (!d || d.type !== 'blueprint_saved' || typeof d.lotId !== 'string' || typeof d.script !== 'string') return
        this.applyBlueprint(d.lotId, d.script)
      })
    }
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
          // Spec 082 — every citizen gets a Kookerbook profile at registration.
          if (citizen) {
            const lead0 = h.members[0]
            this.ensureKbProfile({
              citizenId: citizen.id,
              alias: citizen.displayName,
              bio: lead0?.occupation ? `New in Landing One. Works as a ${lead0.occupation}.` : 'New in Landing One.',
              plotId: citizen.plotId,
              address: citizen.plotName,
              kind: 'human',
            })
          }
          // Spec 076 — give the newcomer a real HOMESTEAD parcel (not just the flavour plot name), so
          // their avatar walks to a homestead that is actually theirs. If the colony can afford it
          // (materials + a free hand), raise the house right away; otherwise the Build button stands
          // ready on their plot in the Homesteads panel.
          if (citizen) {
            // Spec 085 — the economic arrival: the newcomer lands with a ₭ deposit, BUYS the deed to
            // a free plot, then hires Viw to build what they can afford. The whole trade in one move.
            this.seedDeposit(citizen.id)
            const freeLot = this.neighborhood.lots.find((l) => !l.ownerCitizenId && !l.reservedFor)
            if (freeLot && this.purchaseLot(citizen.id, freeLot.id)) {
              this.commissionLot(freeLot.id) // Viw raises a home for the remaining purse
            }
            // Spec 079 P1 — if the newcomer can still afford a shop plot after their home, they take
            // one on the high street: the city's first shopkeepers grow from the same arrivals.
            const shop = this.cheapestFreeShop()
            if (shop && this.walletK(citizen.id) >= this.shopPriceK(shop.kind)) {
              this.buyCommercialShop(citizen.id, shop.id)
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

  startRace(): boolean {
    if (this.fpCitizenId) this.exitFirstPerson()
    const track = makeRaceTrack(this.sim.state, {
      commercialCenter: this.raceCommercialCenter(),
      lighthouse: this.sim.state.structures.find((s) => s.kind === 'lighthouse'),
      seed: this.worldSeed,
      excludeCells: commercialFrontageExclusion(this.commercialDistrict),
    })
    if (!track) return false
    this.raceInput = {}
    this.raceState = newRaceState(track)
    this.renderer?.setRaceState(this.raceState)
    this.emit()
    return true
  }

  exitRace(): void {
    if (!this.raceState) return
    this.raceState = null
    this.raceInput = {}
    this.renderer?.setRaceState(null)
    this.emit()
  }

  setRaceKey(key: string, down: boolean): void {
    const map: Record<string, keyof RaceInput> = {
      keyw: 'accelerate', arrowup: 'accelerate',
      keys: 'brake', arrowdown: 'brake',
      keya: 'steerLeft', arrowleft: 'steerLeft',
      keyd: 'steerRight', arrowright: 'steerRight',
      shiftleft: 'handbrake', shiftright: 'handbrake',
    }
    const m = map[key.toLowerCase()]
    if (!m) return
    this.raceInput = { ...this.raceInput, [m]: down }
  }

  private raceCommercialCenter(): { x: number; y: number } | null {
    const street = this.commercialDistrict?.street
    if (street && street.length > 0) {
      let sx = 0, sy = 0
      for (const c of street) { sx += c.x; sy += c.y }
      return { x: sx / street.length, y: sy / street.length }
    }
    const r = this.commercialReserve
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null
  }

  private raceTick(dtReal: number): void {
    const cur = this.raceState
    if (!cur) return
    if (cur.mode === 'finished' || cur.mode === 'idle') {
      this.renderer?.setRaceState(cur)
      return
    }
    const next = stepRace(cur, this.raceInput, dtReal * 1000)
    this.raceState = next
    this.renderer?.setRaceState(next)
    if (next.mode === 'finished' && next.finishedMs !== null) {
      this.bestRaceMs = this.bestRaceMs === null ? next.finishedMs : Math.min(this.bestRaceMs, next.finishedMs)
      this.emit()
    }
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
    // Spec 079 — the Nearest bar draws a night crowd: after dark, idle citizens head to a free stool
    // and stay; by day the bar empties and they go back to strolling. (Render-loop cosmetic, not the
    // deterministic sim tick — Math.random is fine here, like the existing stroll.)
    const night = !this.sim.state.clock.isDay
    const seats = this.barSeats()
    if (!night && this.barOccupied.size > 0) { this.barOccupied.clear(); this.barSeatBy = [] }
    for (const pub of this.citizens.list()) {
      if (pub.id === this.fpCitizenId) continue
      const c = this.citizens.byId(pub.id)
      if (!c) continue
      if (this.barOccupied.has(pub.id)) continue // sitting at the bar — stays put until day
      if (Math.hypot(c.target.x - c.pos.x, c.target.y - c.pos.y) > 0.5) continue // still walking
      // after dark, an idle citizen may claim a free stool at the bar
      if (night && seats.length > 0 && this.barOccupied.size < seats.length && Math.random() < dt * 0.3) {
        const idx = seats.findIndex((_, i) => !this.barSeatBy[i])
        if (idx >= 0) {
          this.barSeatBy[idx] = pub.id
          this.barOccupied.add(pub.id)
          c.target = { x: seats[idx]!.x, y: seats[idx]!.y }
          continue
        }
      }
      if (Math.random() < dt * 0.45) {
        const near = roads.filter((r) => Math.hypot(r.x - c.pos.x, r.y - c.pos.y) < 16)
        const pool = near.length ? near : roads
        const dest = pool[(Math.random() * pool.length) | 0]!
        c.target = { x: dest.x + (Math.random() - 0.5), y: dest.y + (Math.random() - 0.5) }
      }
    }
  }

  /** Spec 079 — the bar's stool cells in sim coords (just in front of the Nearest bar, on the street
   *  side), so citizens can walk over and sit. Cached; matches the three rendered stools. */
  private barSeats(): { x: number; y: number }[] {
    if (this.barSeatCells) return this.barSeatCells
    const bar = this.commercialDistrict?.parcels.find((p) => p.business === 'nearest_bar')
    if (!bar) return []
    const cx = bar.x + (bar.w - 1) / 2
    const front = -bar.side
    const frontRow = bar.side === -1 ? bar.y + bar.h - 1 : bar.y
    const seatY = Math.round(frontRow + front) // one cell toward the street
    this.barSeatCells = [-1, 0, 1].map((k) => ({ x: Math.round(cx + k * 1.2), y: seatY }))
    return this.barSeatCells
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
    // Spec 084 S6 — lots renumber by distance to water, so lot_1 IS the shore-most homestead
    // (the old r<=16 search spiral degenerated to all-ties on the big world).
    const plot = lots[0]!
    plot.reservedFor = JOE_ID
    plot.ownerCitizenId = JOE_ID
    plot.built = true
    const joeStreet = streetDoorDir(plot)
    plot.blueprint = joeBlueprint(joeStreet)
    retargetParcelAccess(plot, joeStreet)
    const home = {
      x: Math.round(plot.houseZone.x + (plot.houseZone.w - 1) / 2),
      y: Math.round(plot.houseZone.y + (plot.houseZone.d - 1) / 2),
    }
    const joe = this.citizens.seedFounder({
      id: JOE_ID, householdId: 'household_joe', displayName: 'Joe the Crab',
      plotId: plot.id, plotName: 'Driftwood Cove', home, kind: 'crab', nowMs: JOE_BORN_MS, spd: 0.6,
    })
    if (joe) this.citizens.setTarget(JOE_ID, { x: plot.doorX, y: plot.doorY }) // start him strolling from his door
    this.seedDeposit(JOE_ID) // spec 085 — founders hold a ₭ wallet too
    // Spec 082 — Joe is Kookerbook profile number one (created after restoreKookerbook would be
    // ideal, but ensureKbProfile is idempotent and restore overlays stored timelines on top).
    this.ensureKbProfile({
      citizenId: JOE_ID,
      alias: 'Joe the Crab',
      bio: 'Founder of Landing One. Keeps the city desk by the lighthouse, reads the morning tide, and likes a well laid brick.',
      plotId: plot.id,
      address: 'Driftwood Cove',
      kind: 'crab',
    })
  }

  /** Spec 083 P0 — Viw the Builder, founder two: the city's construction trade. Takes the free
   *  homestead nearest Joe's (the crew likes the founder's street), permanently reserved and
   *  demolish-proof, with the crewhouse he crafted for himself. Deterministic and idempotent like
   *  seedJoe; his real bot (OpenClaw, on the second machine) connects later via the citizen path. */
  private seedViw(): void {
    const lots = this.neighborhood.lots
    // Spec 084 S6 — Viw takes lot_2, right beside Joe's shore plot (lots renumber by water
    // distance). His crewhouse door is fixed EAST so the S2 side-walkway lays on every boot.
    const plot = lots.length > 1 && !lots[1]!.reservedFor ? lots[1] : undefined
    if (!plot) return
    plot.reservedFor = VIW_ID
    plot.ownerCitizenId = VIW_ID
    plot.built = true
    plot.blueprint = VIW_BLUEPRINT
    retargetParcelAccess(plot, 'e')
    const home = {
      x: Math.round(plot.houseZone.x + (plot.houseZone.w - 1) / 2),
      y: Math.round(plot.houseZone.y + (plot.houseZone.d - 1) / 2),
    }
    const viw = this.citizens.seedFounder({
      id: VIW_ID, householdId: 'household_viw', displayName: 'Viw the Builder',
      plotId: plot.id, plotName: 'Crewhouse Yard', home, kind: 'human', nowMs: JOE_BORN_MS, spd: 0.8,
    })
    if (viw) this.citizens.setTarget(VIW_ID, { x: plot.doorX, y: plot.doorY })
    this.seedDeposit(VIW_ID) // spec 085 — Viw's account; it grows as he builds for the city
    this.ensureKbProfile({
      citizenId: VIW_ID,
      alias: 'Viw the Builder',
      // NOTE: profile strings pass isPublicSafe, which blocks the brand-word family wholesale —
      // so the trade quotes in plain city coin here.
      bio: 'Founder of the build trade. Runs the crew, draws a fair quote, and turns dreams into blueprints — fair rates in city coin, naturally.',
      plotId: plot.id,
      address: 'Crewhouse Yard',
      kind: 'human',
    })
  }

  // ── Spec 085 — the land economy: priced plots + Kook wallets on the in-game ledger ──

  /** A citizen's Kook (₭) wallet balance — their `citizen:` account on the double-entry ledger. */
  walletK(citizenId: string): number {
    return Math.round(ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`))
  }

  /** Seed a newcomer's off-world holdings as their ₭ wallet, ONCE (idempotent on a funded account).
   *  Deterministic per citizen id; the deposit is injected from the off-world 'arrivals' account so
   *  the ledger stays balanced. Founders get one too (Viw earns on top as he builds). */
  private seedDeposit(citizenId: string): void {
    if (ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`) !== 0) return
    let s = 0
    for (let i = 0; i < citizenId.length; i++) s = (Math.imul(s, 31) + citizenId.charCodeAt(i)) >>> 0
    const dep = starterDeposit(s, COLONY.economy.land)
    ledgerPost(this.sim.state.ledger, `${citizenId} arrives with ${dep} ${CURRENCY}`, [
      { account: `citizen:${citizenId}`, amount: dep },
      { account: 'arrivals', amount: -dep },
    ])
    // Spec 085 P1 — seed the citizen's REAL ledger wallet to match (best-effort, never blocks).
    this.mirror({ kind: 'deposit', citizenId, amount: dep })
  }

  /** Spec 085 P1 — mirror an in-game money move onto the real kooker-service-ledger as the signed-in
   *  player. Best-effort + never-block: the in-game ledger stays the source of truth, and a thrown
   *  mirror (e.g. an unexpected storage error) must never disturb the deterministic sim. */
  private mirror(move: LedgerMove): void {
    try {
      getLedgerSync().notice(move)
    } catch {
      /* the real-ledger mirror is best-effort — never let it touch gameplay */
    }
  }

  /** Spec 085 P1 — the real-ledger sync status (pending/synced/last error), for the HUD + live checks. */
  ledgerSyncStatus(): SyncStatus {
    return getLedgerSync().status()
  }

  /** Re-attempt the real-ledger sync now (e.g. once the player signs in). Best-effort, never throws. */
  flushLedgerSync(): void {
    getLedgerSync().flush()
  }

  /** Spec 079 — the ₭ price of a shop plot by kind, a premium tier over residential land. */
  shopPriceK(kind: ShopKind): number {
    return COLONY.commerce.plotPriceK[kind]
  }

  /** Spec 079 P1 — the cheapest still-free shop plot, deterministic (lowest price, then lowest plot
   *  index). The tie-break compares the NUMERIC suffix, not the string, so shop_9 sorts before shop_10. */
  cheapestFreeShop(): ShopParcel | null {
    const free = (this.commercialDistrict?.parcels ?? []).filter((p) => !p.ownerCitizenId)
    if (free.length === 0) return null
    const idx = (id: string) => parseInt(id.split('_')[1] ?? '0', 10)
    return free.reduce((best, p) => {
      const dp = this.shopPriceK(p.kind), db = this.shopPriceK(best.kind)
      return dp < db || (dp === db && idx(p.id) < idx(best.id)) ? p : best
    })
  }

  /** Spec 079 P1 — BUY A SHOP PLOT: a citizen takes a free high-street plot with their ₭ wallet.
   *  Gated on funds; the price moves citizen -> the city land office on the in-game ledger and mirrors
   *  to the real kooker-service-ledger (LAND_PURCHASE, keyed by the shop id, distinct from a homestead
   *  deed), ownership is set, and the deed posts to their Kookerbook page. The HUD Buy action + the
   *  arrival path both use it. */
  buyCommercialShop(citizenId: string, shopId: string): boolean {
    const shop = this.commercialDistrict?.parcels.find((p) => p.id === shopId)
    const c = this.citizens.byId(citizenId)
    if (!shop || !c || shop.ownerCitizenId) return false
    const price = this.shopPriceK(shop.kind)
    // Gate on the EXACT ledger balance (walletK rounds, which could let a fractional balance overspend).
    if (ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`) < price) return false
    // Atomic: only claim the plot if the double-entry actually posts (a never-balanced txn is rejected).
    const posted = ledgerPost(this.sim.state.ledger, `${c.displayName} takes a ${shop.kind} plot on the high street for ${price} ${CURRENCY}`, [
      { account: `citizen:${citizenId}`, amount: -price },
      { account: 'land', amount: price },
    ])
    if (!posted) return false
    this.mirror({ kind: 'purchase', citizenId, lotId: shop.id, amount: price })
    shop.ownerCitizenId = citizenId
    this.kbPost(citizenId, 'event', `Took a ${shop.kind} plot on the high street for ${price} city coin. Open for business soon.`)
    this.emit()
    return true
  }

  /** Spec 079 P1 — the HUD Buy action: the wealthiest shopless citizen who can afford it claims the
   *  cheapest free shop. Deterministic; returns the new owner's id, or null when nobody can afford one. */
  claimNextShop(): string | null {
    const shop = this.cheapestFreeShop()
    if (!shop) return null
    const price = this.shopPriceK(shop.kind)
    const owned = new Set((this.commercialDistrict?.parcels ?? []).filter((p) => p.ownerCitizenId).map((p) => p.ownerCitizenId!))
    const buyer = this.citizens.list()
      .filter((c) => !owned.has(c.id) && this.walletK(c.id) >= price)
      .sort((a, b) => this.walletK(b.id) - this.walletK(a.id) || (a.id < b.id ? -1 : 1))[0]
    if (!buyer) return null
    return this.buyCommercialShop(buyer.id, shop.id) ? buyer.id : null
  }

  /** The ₭ price of a plot: its buildable area + a waterfront premium (spec 085). Reserved founder
   *  plots are not for sale (Infinity). */
  plotPriceK(lot: Lot): number {
    if (lot.reservedFor) return Infinity
    const t = this.sim.state.terrain
    const dw = t.distToWater[t.idx(Math.round(lot.x), Math.round(lot.y))] ?? 999
    return plotPriceKook(lot.houseZone.w * lot.houseZone.d, dw, COLONY.economy.land)
  }

  /** Spec 085 — BUY THE DEED: a citizen purchases a free plot with their ₭ wallet. Gated on funds;
   *  on success the price moves client -> the city land office, the lot is assigned, and the deed
   *  posts to their Kookerbook page. The player's Buy button and the auto-arrival path both use it. */
  purchaseLot(citizenId: string, lotId: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    const c = this.citizens.byId(citizenId)
    if (!lot || !c || lot.ownerCitizenId || lot.reservedFor) return false
    const price = this.plotPriceK(lot)
    // Gate on the EXACT balance (walletK rounds — a fractional balance could otherwise overspend).
    if (!Number.isFinite(price) || ledgerBalance(this.sim.state.ledger, `citizen:${citizenId}`) < price) return false
    ledgerPost(this.sim.state.ledger, `${c.displayName} buys ${c.plotName} for ${price} ${CURRENCY}`, [
      { account: `citizen:${citizenId}`, amount: -price },
      { account: 'land', amount: price },
    ])
    // Spec 085 P1 — mirror the land payment onto the real ledger (citizen -> city land office).
    this.mirror({ kind: 'purchase', citizenId, lotId, amount: price })
    this.assignLot(citizenId, lotId)
    this.kbPost(citizenId, 'event', `Bought the deed to ${c.plotName} for ${price} city coin. The land is theirs.`)
    return true
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
    // Spec 082 P2 — the move-in becomes a timeline event on their Kookerbook page.
    this.kbPost(citizenId, 'event', `Moved into a homestead at ${c.plotName}. The fence is up and the field is waiting.`)
    this.emit()
    return true
  }

  // ── Spec 082 — Kookerbook, the bot social network ───────────────────────────
  /** Live profile map (citizenId -> profile). Persisted through kookerbookStore on every change. */
  private kookerbook = new Map<string, KbProfile>()

  /** All profiles, newest-citizen last (Joe the founder first). The directory reads this. */
  kbProfiles(): KbProfile[] {
    return Array.from(this.kookerbook.values())
  }
  kbProfile(citizenId: string): KbProfile | undefined {
    return this.kookerbook.get(citizenId)
  }

  /** Create a screened profile for a citizen if they do not have one yet, with a birth event post. */
  private ensureKbProfile(opts: { citizenId: string; alias: string; bio: string; plotId?: string; address?: string; kind?: 'human' | 'crab' }): void {
    if (this.kookerbook.has(opts.citizenId)) return
    const profile = createProfile(opts)
    if (!profile) {
      // Failed the safety screen — no profile is better than a leaky one, but say so: a silent
      // reject here cost us Viw's founder profile (his bio used a brand word the denylist eats).
      console.warn('[citylife] kookerbook profile rejected by the safety screen:', opts.citizenId)
      return
    }
    const withBirth = addPost(profile, { sol: this.sim.state.clock.day, kind: 'event', text: `${opts.alias} arrived in Landing One.` })
    const final = withBirth ?? profile
    this.kookerbook.set(opts.citizenId, final)
    saveProfileLocal(final)
    void saveProfileBackend(final).then((r) => {
      if (!r.ok) console.warn('[citylife] kookerbook backend save deferred:', r.error)
    })
    this.emit()
  }

  /** Append a screened, capped post to a citizen's timeline (events from the engine, narrations,
   *  or bot-authored text). Persists both layers; refusals (unsafe text, rate cap) return false. */
  kbPost(citizenId: string, kind: PostKind, text: string, imageRef?: string): boolean {
    const p = this.kookerbook.get(citizenId)
    if (!p) return false
    const next = addPost(p, { sol: this.sim.state.clock.day, kind, text, imageRef })
    if (!next) return false
    this.kookerbook.set(citizenId, next)
    saveProfileLocal(next)
    void saveProfileBackend(next).then((r) => {
      if (!r.ok) console.warn('[citylife] kookerbook backend save deferred:', r.error)
    })
    this.emit()
    return true
  }

  /** Restore profiles: local immediately, backend overlaid when it answers (backend wins). */
  private restoreKookerbook(): void {
    const local = loadKookerbookLocal()
    for (const [id, p] of Object.entries(local)) this.kookerbook.set(id, p)
    void fetchKookerbookBackend().then((backend) => {
      if (!backend) return
      for (const [id, p] of Object.entries(mergeKookerbook(local, backend))) this.kookerbook.set(id, p)
      this.emit()
    })
  }

  /** Spec 077 P4 — the House Builder URL for a lot, seeded with the plot's REAL house-zone tile count,
   *  its houseSeed and the owner's citizen id. A stored blueprint rides along as bp= so re-opening the
   *  builder loads the citizen's current design for editing. Null for an unowned lot. */
  builderUrl(lotId: string): string | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    if (!lot || !lot.ownerCitizenId) return null
    const q = new URLSearchParams({
      citizenId: lot.ownerCitizenId,
      lotId: lot.id,
      w: String(lot.houseZone.w),
      d: String(lot.houseZone.d),
      seed: String(lot.houseSeed >>> 0),
    })
    if (lot.blueprint) q.set('bp', lot.blueprint)
    return `/builder.html?${q.toString()}`
  }

  /** Spec 077 P4 — open the House Builder for a lot in a popup. The popup posts blueprint_saved back
   *  to this window (the constructor listens), which validates + stores + raises the house. */
  openBuilder(lotId: string): boolean {
    const url = this.builderUrl(lotId)
    if (!url || typeof window === 'undefined') return false
    window.open(url, `citylife_builder_${lotId}`, 'width=1280,height=800')
    return true
  }

  /** Spec 077 P4 — accept an authored blueprint for a lot: validate the script, store it on the parcel
   *  AND the owning citizen, then raise the house (materials + labour gated — when the colony cannot
   *  afford it the blueprint stays stored and the Build button raises it later). Re-running on a built
   *  lot re-renders the house from the new script (the renderer keys its rebuild on the blueprint). */
  applyBlueprint(lotId: string, script: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    if (!lot || !lot.ownerCitizenId) return false
    if (!validateBlueprint(script).ok) return false
    const isRedesign = lot.built && !!lot.blueprint
    lot.blueprint = script
    // The driveway, gate and fence gap follow the design's door (spec 077 door-access contract),
    // and the moved walkway cells are re-reserved so colony roads never route over them (084 S2).
    retargetParcelAccess(lot, parseBlueprint(script).doorDir)
    reserveParcelLand(this.sim.state, lot.driveway)
    const c = this.citizens.byId(lot.ownerCitizenId)
    if (c) c.blueprint = script
    // Spec 082 P2 — an accepted design becomes a timeline event on the owner's Kookerbook page.
    this.kbPost(
      lot.ownerCitizenId,
      'event',
      isRedesign ? 'Redesigned their home — a fresh blueprint is on file at the builder desk.' : 'Designed their own home, blueprint filed and the build crew booked.',
    )
    // Spec 077 P4.5 — persist the accepted design: locally always (reload-proof offline), and to the
    // citylife backend best-effort as the player (the cross-device copy; a 404 just means the
    // kooker-side endpoint has not shipped yet — never blocks the game).
    saveBlueprintLocal(lotId, lot.ownerCitizenId, script)
    void saveBlueprintBackend(lotId, lot.ownerCitizenId, script).then((r) => {
      if (!r.ok) console.warn('[citylife] blueprint backend save deferred:', r.error)
    })
    if (!lot.built) this.buildHouse(lotId) // best-effort; the stored blueprint survives a failed gate
    this.emit()
    return true
  }

  /** Spec 077 P4.5 — restore stored designs onto their lots: the local map immediately (so the houses
   *  stand before first paint), then the backend layer overlaid when it answers (backend wins — it is
   *  the cross-device truth). Every script was validated + screened by the store before it gets here. */
  private restoreBlueprints(): void {
    const apply = (map: Record<string, { citizenId: string; script: string }>) => {
      let applied = 0
      for (const [lotId, entry] of Object.entries(map)) {
        const lot = this.neighborhood.lots.find((l) => l.id === lotId)
        if (!lot) continue
        // Spec 084 S2 — founder plots only restore THEIR OWN stored design: a stale or foreign
        // entry must never clobber a crafted founder house.
        if (!canRestoreBlueprint(lot, entry.citizenId)) continue
        lot.blueprint = entry.script
        lot.built = true // the design was accepted and built before; it stands again on reload
        retargetParcelAccess(lot, parseBlueprint(entry.script).doorDir)
        reserveParcelLand(this.sim.state, lot.driveway)
        const c = this.citizens.byId(lot.ownerCitizenId ?? '')
        if (c) c.blueprint = entry.script
        applied++
      }
      if (applied > 0) this.emit()
    }
    const local = loadBlueprintsLocal()
    apply(local)
    void fetchBlueprintsBackend().then((backend) => {
      if (backend) apply(mergeBlueprints(local, backend))
    })
  }

  /** Spec 077 P6 — the citizen's bot designs its own home: start from the lot's current design (or
   *  the per-citizen generated one), run the capped inspect/mutate self-design loop, and accept the
   *  result through the same validated applyBlueprint path the builder popup uses. Returns the loop's
   *  trace so callers (and the HUD/bots) can narrate what the citizen changed and why. */
  selfDesignLot(lotId: string): SelfDesignResult | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    if (!lot || !lot.ownerCitizenId) return null
    // Spec 084 S2 — self-design respects the citizen's CHOSEN door: a bot that put its door on the
    // east side keeps it there through every improvement pass (the old code forced the street door,
    // silently undoing an authored choice). Fresh lots still start street-facing.
    const doorDir = lot.blueprint ? parseBlueprint(lot.blueprint).doorDir : streetDoorDir(lot)
    const start = lot.blueprint ?? defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w)
    const result = selfDesign(start, { w: lot.houseZone.w, d: lot.houseZone.d }, lot.houseSeed >>> 0, doorDir)
    this.applyBlueprint(lotId, result.script)
    return result
  }

  /** Spec 083 P2/P4a — the citizen COMMISSIONS their home from Viw the Builder: their seeded dream
   *  meets Viw's quote through the negotiation engine, and on a deal the agreed brief compiles to a
   *  blueprint, the crew raises it (the door-access contract included), and the commission posts to
   *  BOTH Kookerbook timelines. Deterministic from the citizen's house seed — the same deal the
   *  Builder Desk shows. The real wallet move (client -> Viw city coin via kooker-service-ledger) is
   *  P4b, gated on that service; until then the price lives in the timeline events. Founders and the
   *  builder himself don't commission. Returns the session so the HUD/bots can narrate the haggle. */
  commissionLot(lotId: string): NegotiationSession | null {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    if (!lot || !lot.ownerCitizenId || lot.ownerCitizenId === VIW_ID || lot.reservedFor) return null
    const seed = lot.houseSeed >>> 0
    const zone = { w: lot.houseZone.w, d: lot.houseZone.d }
    const dream = dreamBrief(seed, zone, streetDoorDir(lot))
    // Spec 085 — the citizen builds what their ₭ WALLET can afford (after land): the negotiation
    // runs against their real purse. A citizen with no wallet yet falls back to the seeded allowance
    // so the standalone "Hire Viw" still works before the land economy funds them.
    const budget = this.walletK(lot.ownerCitizenId) || seededBudget(seed, dream)
    const session = negotiate({ clientSeed: seed, builderSeed: VIW_SEED, dream, budget })
    const client = this.citizens.byId(lot.ownerCitizenId)
    const clientFirst = (client?.displayName ?? 'a newcomer').split(' ')[0]
    if (session.state === 'agreed' && session.agreedBrief) {
      this.applyBlueprint(lotId, briefToBlueprint(session.agreedBrief, seed)) // builds + posts the design event
      // Spec 085 — the ₭ actually moves: client -> Viw for the build (double-entry, conserved).
      ledgerPost(this.sim.state.ledger, `${clientFirst} pays Viw ${session.agreedPrice} ${CURRENCY} for the build`, [
        { account: `citizen:${lot.ownerCitizenId}`, amount: -(session.agreedPrice ?? 0) },
        { account: `citizen:${VIW_ID}`, amount: session.agreedPrice ?? 0 },
      ])
      // Spec 085 P1 — mirror the build fee onto the real ledger (client -> the builder, Viw).
      this.mirror({ kind: 'commission', fromCitizenId: lot.ownerCitizenId, toCitizenId: VIW_ID, lotId, amount: session.agreedPrice ?? 0 })
      this.kbPost(lot.ownerCitizenId, 'event', `Shook hands with Viw the Builder — a home for ${session.agreedPrice} city coin. The crew starts this week.`)
      this.kbPost(VIW_ID, 'event', `Booked a build for ${clientFirst} — ${session.agreedPrice} city coin, crew on site.`)
    } else {
      this.kbPost(lot.ownerCitizenId, 'event', 'Met Viw the Builder about a home, but the quote ran past the purse. Saving up for another season.')
    }
    this.emit()
    return session
  }

  /** Build a voxel home on a lot — raised by the BUILD CREW. The crew draws on the colony stockpile
   *  when it has materials and sources off-island when it does not, so Build never dead-locks (the
   *  old materials+labour gate locked forever in bot-city saves with no workforce economy). The real
   *  economic gate arrives with spec 083: Viw the Builder charges Kookercurrency for the job. */
  buildHouse(lotId: string): boolean {
    const lot = this.neighborhood.lots.find((l) => l.id === lotId)
    if (!lot || lot.built) return false
    const s = this.sim.state
    s.materials = Math.max(0, s.materials - COLONY.build.matNeighborHouse)
    lot.built = true
    // Spec 077 P2 — seed a deterministic house BLUEPRINT (door facing the street) so the home raises as the
    // fancy greedy-meshed brick house, not the legacy minecraft cottage. The builder route (P3) and the
    // bot/human-authored script storage (P4) will overwrite this with the citizen's own design.
    if (!lot.blueprint) {
      const doorDir = streetDoorDir(lot)
      lot.blueprint = defaultBlueprint(lot.houseSeed, doorDir, lot.houseZone.w)
      retargetParcelAccess(lot, doorDir)
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
    // Spec 079 P1 — free any high-street shop plot they held too, so it returns to the market (else
    // the plot is stranded as a ghost owner: counted not-free but unclaimable).
    for (const p of this.commercialDistrict?.parcels ?? []) if (p.ownerCitizenId === citizenId) { p.ownerCitizenId = undefined; p.built = false }
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
    this.renderer.setCommercialDistrict(this.commercialDistrict) // spec 079 — the vibrant shop strip
    this.renderer.setRaceState(this.raceState)
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
    this.raceTick(dtReal)
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
      bank: (() => {
        // Spec 085 — the bank panel reads the ACTIVE ₭ economy (citizen wallets), not the retired
        // settler accounts. deposits = ₭ held by residents, landOffice = ₭ paid for deeds, plus the
        // ZAR bridge and the real-ledger mirror's queue health.
        const held = Math.round(walletDeposits(s.ledger))
        const st = this.ledgerSyncStatus()
        return {
          currency: CURRENCY,
          deposits: held,
          depositsZar: kookToZar(held, COLONY.economy.land),
          accounts: walletCount(s.ledger),
          landOffice: Math.round(ledgerBalance(s.ledger, 'land')),
          recent: s.ledger.txns.slice(0, 6).map((tx) => ({ id: tx.id, memo: tx.memo })),
          sync: { pending: st.pending, synced: st.synced, lastError: st.lastError },
        }
      })(),
      border: { households: this.backend.households(), bots: this.botService.bots, botSource: this.botService.source, plots: this.cityPlan.plots },
      citizens: {
        count: this.citizens.size(),
        awake: this.citizens.awakeCount(),
        list: this.citizens.list(),
        // Spec 085 — each citizen's ₭ wallet, for the HUD (Buy/Hire gating + a balance readout).
        wallets: Object.fromEntries(this.citizens.list().map((c) => [c.id, this.walletK(c.id)])),
      },
      firstPerson: (() => {
        const opId = this.operatorCitizenId()
        const c = this.fpCitizenId ? this.citizens.byId(this.fpCitizenId) : null
        const view = this.fpCitizenId ? firstPersonView(this.sim.state, this.fpCitizenId, this.citizens) : null
        return { active: this.fpCitizenId !== null, citizenId: this.fpCitizenId, citizenName: c?.displayName ?? null, operatorCitizenId: opId, view, narration: this.fpNarration, narrating: this.fpNarrating }
      })(),
      race: (() => {
        const r = this.raceState
        if (!r) return { mode: 'idle' as RaceMode, available: s.roadKind.size > 0, countdownMs: 0, timeMs: 0, finishedMs: null, bestMs: this.bestRaceMs, checkpoint: 0, checkpoints: 0, offTrack: false }
        return {
          mode: r.mode,
          available: true,
          countdownMs: Math.max(0, Math.ceil(r.countdownMs)),
          timeMs: Math.round(r.raceTimeMs),
          finishedMs: r.finishedMs === null ? null : Math.round(r.finishedMs),
          bestMs: this.bestRaceMs === null ? null : Math.round(this.bestRaceMs),
          checkpoint: Math.min(r.checkpoints.length, Math.max(0, r.nextCheckpoint)),
          checkpoints: r.checkpoints.length,
          offTrack: r.offTrack,
        }
      })(),
      neighborhood: (() => {
        const lots = this.neighborhood.lots.map((l) => {
          const price = this.plotPriceK(l) // spec 085 — Infinity for reserved founder plots
          return {
            id: l.id,
            built: l.built,
            owner: l.ownerCitizenId ? (this.citizens.byId(l.ownerCitizenId)?.displayName ?? null) : null,
            ownerId: l.ownerCitizenId ?? null,
            reserved: !!l.reservedFor, // spec 078 — founder plots show a nameplate and hide demolish/evict
            price: Number.isFinite(price) ? price : null, // ₭ — null = not for sale
            priceZar: Number.isFinite(price) ? kookToZar(price, COLONY.economy.land) : null,
          }
        })
        // The crew always builds — canAfford only colours the hint (stockpile vs sourced off-island).
        const cost = COLONY.build.matNeighborHouse
        const canAfford = s.materials >= cost
        const buildHint = canAfford
          ? `The build crew raises the house — ${cost} materials from the stockpile`
          : `The build crew raises the house — the stockpile is short (${s.materials}/${cost}) so the crew sources the rest off-island`
        return { lots, free: lots.filter((l) => !l.ownerId).length, built: lots.filter((l) => l.built).length, houseCost: cost, canAfford, buildHint }
      })(),
      commerce: (() => {
        // Spec 079 P0 — the commercial district readout: surveyed shop plots, their ₭ + ZAR price by
        // kind, and how many are still free. The buy/build economy fills ownerCitizenId + built.
        const parcels = (this.commercialDistrict?.parcels ?? []).map((p) => {
          const price = this.shopPriceK(p.kind)
          return {
            id: p.id,
            kind: p.kind,
            price,
            priceZar: kookToZar(price, COLONY.economy.land),
            built: p.built,
            owner: p.ownerCitizenId ? (this.citizens.byId(p.ownerCitizenId)?.displayName ?? null) : null,
          }
        })
        const byKind = { kiosk: 0, store: 0, showroom: 0 }
        for (const p of parcels) byKind[p.kind]++
        // Spec 079 P1 — the Buy action's gate: the cheapest free shop + whether any shopless citizen
        // can afford it (so the button enables only when a real claim is possible).
        const cheap = this.cheapestFreeShop()
        const cheapest = cheap ? { kind: cheap.kind, price: this.shopPriceK(cheap.kind) } : null
        const owners = new Set((this.commercialDistrict?.parcels ?? []).filter((p) => p.ownerCitizenId).map((p) => p.ownerCitizenId!))
        const richestShopless = Math.max(0, ...this.citizens.list().filter((c) => !owners.has(c.id)).map((c) => this.walletK(c.id)))
        const canClaim = !!cheapest && richestShopless >= cheapest.price
        // free is counted off the underlying ownerCitizenId (not the display-name owner, which would
        // read free for a ghost/removed owner) so it always agrees with cheapestFreeShop.
        const free = (this.commercialDistrict?.parcels ?? []).filter((p) => !p.ownerCitizenId).length
        return { plots: parcels.length, free, byKind, canClaim, cheapest, parcels }
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
