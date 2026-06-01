// Construction + economy + power + zoning, on a GRID.
// Roads run on block boundaries (so they never run parallel-adjacent and they cross at clean
// intersections). The colony develops a block (builds its road frame), fills its lots with
// homes / workplaces / solar farms based on need, crews build them, colonists arrive and work,
// industry adds pollution, and a daily economy scaled by employment funds continued growth.
import { RNG } from '../engine/rng'
import { COLONY } from './config'
import type { ColonyState } from './sim'
import { gridOrigin } from './grid'
import { roadPath } from './traffic'

export type BuildKind = 'habitat' | 'commercial' | 'industrial' | 'solar' | 'mine' | 'workshop' | 'water' | 'greenhouse' | 'depot' | 'clinic' | 'theatre' | 'survey' | 'exchange' | 'foundry' | 'mast' | 'battery' | 'scrubber' | 'academy'

export interface Parcel {
  id: number
  x: number
  y: number
}
export interface Artifact {
  id: number
  kind: BuildKind
  color: number
  height: number
  residents: number
  jobs: number
  powerLoad: number
  powerGen: number
  buildTimeMin: number
  cost: number
  materialsCost: number // spec 001: materials consumed to construct
  crew: number // spec 001: free colonists reserved for the build duration
  materialsGen: number // spec 002: materials/day produced when fully staffed (mines); 0 otherwise
  componentsCost?: number // spec 005: components consumed to construct (services); defaults to 0
  reelsCost?: number // spec 018: reels (luxury good) consumed to construct (battery sheds); defaults to 0
}
export interface ConstructionJob {
  id: number
  x: number
  y: number
  artifact: Artifact
  progress: number
  path: number[] // road-cell indices (caravan -> site) the crew truck drives
}
export interface ColonyBuilding {
  id: number
  x: number
  y: number
  artifact: Artifact
  tier?: number // spec 006 — habitats evolve 1..3 (more capacity + desirability); undefined = tier 1
  dryMin?: number // spec 006 — sim-minutes a habitat has gone without water (drives devolution)
}
export interface RoadCell {
  x: number
  y: number
}

const HAB_COLORS = [0xe6cda2, 0xd8b48a, 0xc9b08f, 0xb88a6a]
const COMMERCIAL_COLOR = 0x5fb6d8
const INDUSTRIAL_COLOR = 0xcf8b54
const SOLAR_COLOR = 0x18406a
const MINE_COLOR = 0x6b5a4a // rocky brown extraction site
const WORKSHOP_COLOR = 0x8a7f3a // ochre workshop / fabricator
const WATER_COLOR = 0x3aa6c8 // cyan water / life-support hub
const GREENHOUSE_COLOR = 0x4f9d52 // green skyfarm greenhouse
const DEPOT_COLOR = 0xc88a3a // amber ration depot
const CLINIC_COLOR = 0xe3ebf0 // clinical white first-aid clinic
const THEATRE_COLOR = 0x9a4fd0 // magenta holo-theatre
const SURVEY_COLOR = 0x4a78b8 // civic blue survey office
const EXCHANGE_COLOR = 0xc9a227 // gold skybridge exchange (trade)
const FOUNDRY_COLOR = 0x6a5acd // indigo reel foundry (luxury good)
const MAST_COLOR = 0x6fd0ff // signal-blue broadcast mast (the Courier)
const BATTERY_COLOR = 0x4fd07a // green battery shed (grid buffer)
const SCRUBBER_COLOR = 0x9acd32 // yellow-green air scrubber garden
const ACADEMY_COLOR = 0x3ab0a0 // teal skillhouse academy
const key = (x: number, y: number) => x + ',' + y
const B = COLONY.build.block

function caravan(state: ColonyState) {
  return state.structures.find((s) => s.kind === 'caravan')!
}
const mod = (v: number, m: number) => ((v % m) + m) % m

/** True if (x,y) lies on a grid road line (block boundary). */
function isRoadLine(state: ColonyState, x: number, y: number): boolean {
  const g = gridOrigin(state)
  return mod(x - g.x, B) === 0 || mod(y - g.y, B) === 0
}

export function initBuild(state: ColonyState): void {
  state.treasury = COLONY.build.treasuryStart
  state.materials = COLONY.build.materialsStart // spec 001 — dropship build-supply stockpile
  state.components = 0 // spec 003 — refined goods, produced by workshops
  state.food = 0 // spec 007 — grown by greenhouses; colonists subsist on dropship rations until then
  state.reels = 0 // spec 013 — luxury good, refined by foundries from components
  state.skilled = 0 // spec 020 — skilled workers, trained by academies
  state.parcels = []
  state.jobs = []
  state.buildings = []
  state.roads = []
  state.roadSet = new Set()
  state.occupied = new Set()
  state.developedBlocks = new Set()
  state.buildIds = 1
  state.lastGrowMin = state.clock.totalMinutes
  state.lastIncomeDay = state.clock.day
  state.buildingLoad = 0
  state.powerGen = 0
  state.totalJobs = 0
  state.pollution = 0
  // Reserve each base structure's cell AND a one-cell halo around it. The rocket (radius 1.1) and the
  // solar panel (2.6 wide) meshes are wider than a single cell, so a home placed in an adjacent cell
  // would visually intrude on them — reserving the halo keeps the dropship a clear landing plaza and
  // prevents the "rocket inside a house" overlap.
  for (const s of state.structures) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        state.occupied.add(key(s.x + dx, s.y + dy))
      }
    }
  }
  developBlock(state, 0, 0) // the landing block
}

// ── grid / block helpers ──

function blockKey(bx: number, by: number) {
  return bx + ':' + by
}

/** Build the road frame of block (bx,by). Returns the number of new road cells laid. */
function developBlock(state: ColonyState, bx: number, by: number): number {
  const g = gridOrigin(state)
  const t = state.terrain
  const x0 = g.x + bx * B
  const y0 = g.y + by * B
  const x1 = x0 + B
  const y1 = y0 + B
  let added = 0
  const lay = (x: number, y: number) => {
    if (!t.inBounds(x, y)) return
    if (t.isWater(x, y)) return // roads stop at water (bridges later); steep land drapes fine
    // Belt-and-suspenders: never lay a road on top of a base structure cell, even if `nearbyInterior`
    // got displaced. Keeps the rocket / solar / battery clear of the road frame.
    for (const s of state.structures) if (s.x === x && s.y === y) return
    const k = key(x, y)
    if (state.roadSet.has(k)) return
    state.roadSet.add(k)
    state.roads.push({ x, y })
    added++
  }
  for (let x = x0; x <= x1; x++) {
    lay(x, y0)
    lay(x, y1)
  }
  for (let y = y0; y <= y1; y++) {
    lay(x0, y)
    lay(x1, y)
  }
  state.developedBlocks.add(blockKey(bx, by))
  return added
}

/** An undeveloped block adjacent to a developed one, nearest the landing, with buildable land. */
function nextBlock(state: ColonyState): { bx: number; by: number } | null {
  let best: { bx: number; by: number } | null = null
  let bestD = Infinity
  const g = gridOrigin(state)
  const t = state.terrain
  const hasLand = (bx: number, by: number) => {
    const x = g.x + bx * B + (B >> 1)
    const y = g.y + by * B + (B >> 1)
    return t.inBounds(x, y) && t.buildable[t.idx(x, y)] !== 0
  }
  for (const dk of state.developedBlocks) {
    const [bxs, bys] = dk.split(':')
    const bx = Number(bxs)
    const by = Number(bys)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nb = { bx: bx + dx, by: by + dy }
      if (Math.abs(nb.bx) > COLONY.build.maxBlockRadius || Math.abs(nb.by) > COLONY.build.maxBlockRadius) continue
      if (state.developedBlocks.has(blockKey(nb.bx, nb.by))) continue
      if (!hasLand(nb.bx, nb.by)) continue
      const d = nb.bx * nb.bx + nb.by * nb.by
      if (d < bestD) {
        bestD = d
        best = nb
      }
    }
  }
  return best
}

/** A buildable, road-served, unoccupied lot inside a developed block (or null). */
function availableLot(state: ColonyState, rng: RNG): { x: number; y: number } | null {
  const g = gridOrigin(state)
  const t = state.terrain
  const blocks = [...state.developedBlocks]
  for (let tries = 0; tries < blocks.length + 4; tries++) {
    const dk = blocks[rng.int(0, blocks.length - 1)]!
    const [bxs, bys] = dk.split(':')
    const bx = Number(bxs)
    const by = Number(bys)
    const ox = rng.int(1, B - 1)
    const oy = rng.int(1, B - 1)
    for (let i = 0; i < (B - 1) * (B - 1); i++) {
      const lx = 1 + ((ox - 1 + (i % (B - 1))) % (B - 1))
      const ly = 1 + ((oy - 1 + Math.floor(i / (B - 1))) % (B - 1))
      const x = g.x + bx * B + lx
      const y = g.y + by * B + ly
      if (!t.inBounds(x, y)) continue
      if (t.buildable[t.idx(x, y)] === 0) continue
      const k = key(x, y)
      if (state.occupied.has(k) || state.roadSet.has(k)) continue
      return { x, y }
    }
  }
  return null
}

// ── architect ──

function designHabitat(state: ColonyState, rng: RNG): Artifact {
  return { id: state.buildIds++, kind: 'habitat', color: HAB_COLORS[rng.int(0, HAB_COLORS.length - 1)]!, height: rng.range(0.8, 1.6), residents: COLONY.build.residentsPerHabitat, jobs: 0, powerLoad: COLONY.build.powerLoadPerHabitat, powerGen: 0, buildTimeMin: COLONY.build.buildTimeHours * 60, cost: COLONY.build.habitatCost, materialsCost: COLONY.build.matHabitat, crew: COLONY.build.crewHabitat, materialsGen: 0 }
}
function designWorkplace(state: ColonyState, rng: RNG): Artifact {
  const ind = rng.chance(0.45)
  return { id: state.buildIds++, kind: ind ? 'industrial' : 'commercial', color: ind ? INDUSTRIAL_COLOR : COMMERCIAL_COLOR, height: ind ? rng.range(0.9, 1.5) : rng.range(1.0, 1.8), residents: 0, jobs: ind ? COLONY.build.jobsPerIndustrial : COLONY.build.jobsPerCommercial, powerLoad: ind ? COLONY.build.industrialLoad : COLONY.build.commercialLoad, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: ind ? COLONY.build.industrialCost : COLONY.build.commercialCost, materialsCost: ind ? COLONY.build.matIndustrial : COLONY.build.matCommercial, crew: COLONY.build.crewWork, materialsGen: 0 }
}
function designSolarFarm(state: ColonyState): Artifact {
  return { id: state.buildIds++, kind: 'solar', color: SOLAR_COLOR, height: 0.35, residents: 0, jobs: 0, powerLoad: 0, powerGen: COLONY.build.solarFarmOutput, buildTimeMin: COLONY.build.solarFarmBuildHours * 60, cost: COLONY.build.solarFarmCost, materialsCost: COLONY.build.matSolar, crew: COLONY.build.crewSolar, materialsGen: 0 }
}
function designMine(state: ColonyState): Artifact {
  // Spec 002 — extraction: produces materials while staffed; cheapest build so a low-supply colony
  // can still raise the mine that restores its own supply.
  return { id: state.buildIds++, kind: 'mine', color: MINE_COLOR, height: 0.7, residents: 0, jobs: COLONY.build.mineWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.mineBuildHours * 60, cost: COLONY.build.mineCost, materialsCost: COLONY.build.matMine, crew: COLONY.build.crewMine, materialsGen: COLONY.build.mineOutputPerDay }
}
function designWorkshop(state: ColonyState): Artifact {
  // Spec 003 — refines materials into components while staffed (rates read from config per workshop).
  return { id: state.buildIds++, kind: 'workshop', color: WORKSHOP_COLOR, height: 1.0, residents: 0, jobs: COLONY.build.workshopWorkers, powerLoad: 0.6, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.workshopCost, materialsCost: COLONY.build.matWorkshop, crew: COLONY.build.crewWorkshop, materialsGen: 0 }
}
function designWaterHub(state: ColonyState): Artifact {
  // Spec 005 — first service: waters habitats in range; costs components to build (the first sink).
  return { id: state.buildIds++, kind: 'water', color: WATER_COLOR, height: 0.8, residents: 0, jobs: COLONY.build.waterHubWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.waterHubCost, materialsCost: COLONY.build.matWaterHub, crew: COLONY.build.crewWaterHub, materialsGen: 0, componentsCost: COLONY.build.compWaterHub }
}
function designGreenhouse(state: ColonyState): Artifact {
  // Spec 007 — food production; output boosted when within a Water Hub radius (irrigated trays).
  return { id: state.buildIds++, kind: 'greenhouse', color: GREENHOUSE_COLOR, height: 0.6, residents: 0, jobs: COLONY.build.greenhouseWorkers, powerLoad: 0.5, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.greenhouseCost, materialsCost: COLONY.build.matGreenhouse, crew: COLONY.build.crewGreenhouse, materialsGen: 0, componentsCost: COLONY.build.compGreenhouse }
}
function designDepot(state: ColonyState): Artifact {
  // Spec 008 — distribution: carries food from the stockpile to provision nearby homes.
  return { id: state.buildIds++, kind: 'depot', color: DEPOT_COLOR, height: 0.8, residents: 0, jobs: COLONY.build.depotWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.depotCost, materialsCost: COLONY.build.matDepot, crew: COLONY.build.crewDepot, materialsGen: 0, componentsCost: COLONY.build.compDepot }
}
function designClinic(state: ColonyState): Artifact {
  // Spec 009 — health service; keeps nearby homes healthy so their workers stay productive.
  return { id: state.buildIds++, kind: 'clinic', color: CLINIC_COLOR, height: 0.7, residents: 0, jobs: COLONY.build.clinicWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.clinicCost, materialsCost: COLONY.build.matClinic, crew: COLONY.build.crewClinic, materialsGen: 0, componentsCost: COLONY.build.compClinic }
}
function designTheatre(state: ColonyState): Artifact {
  // Spec 010 — culture service; covers nearby homes and makes the colony more desirable to settlers.
  return { id: state.buildIds++, kind: 'theatre', color: THEATRE_COLOR, height: 1.1, residents: 0, jobs: COLONY.build.theatreWorkers, powerLoad: 0.6, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.theatreCost, materialsCost: COLONY.build.matTheatre, crew: COLONY.build.crewTheatre, materialsGen: 0, componentsCost: COLONY.build.compTheatre }
}
function designSurvey(state: ColonyState): Artifact {
  // Spec 011 — civic survey office; once built + staffed, unlocks the liveability overlay.
  return { id: state.buildIds++, kind: 'survey', color: SURVEY_COLOR, height: 1.2, residents: 0, jobs: COLONY.build.surveyWorkers, powerLoad: 0.5, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.surveyCost, materialsCost: COLONY.build.matSurvey, crew: COLONY.build.crewSurvey, materialsGen: 0, componentsCost: COLONY.build.compSurvey }
}
function designExchange(state: ColonyState): Artifact {
  // Spec 012 — trade post; once built + staffed, exports the colony's surplus goods for treasury.
  return { id: state.buildIds++, kind: 'exchange', color: EXCHANGE_COLOR, height: 1.0, residents: 0, jobs: COLONY.build.exchangeWorkers, powerLoad: 0.5, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.exchangeCost, materialsCost: COLONY.build.matExchange, crew: COLONY.build.crewExchange, materialsGen: 0, componentsCost: COLONY.build.compExchange }
}
function designFoundry(state: ColonyState): Artifact {
  // Spec 013 — refines components into reels (a luxury good) while staffed.
  return { id: state.buildIds++, kind: 'foundry', color: FOUNDRY_COLOR, height: 1.1, residents: 0, jobs: COLONY.build.foundryWorkers, powerLoad: 0.7, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.foundryCost, materialsCost: COLONY.build.matFoundry, crew: COLONY.build.crewFoundry, materialsGen: 0, componentsCost: COLONY.build.compFoundry }
}
function designMast(state: ColonyState): Artifact {
  // Spec 016 — Broadcast Mast; once built + staffed, the Kookerverse Courier reads the colony's own news.
  return { id: state.buildIds++, kind: 'mast', color: MAST_COLOR, height: 1.6, residents: 0, jobs: COLONY.build.mastWorkers, powerLoad: 0.5, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.mastCost, materialsCost: COLONY.build.matMast, crew: COLONY.build.crewMast, materialsGen: 0, componentsCost: COLONY.build.compMast }
}
function designBattery(state: ColonyState): Artifact {
  // Spec 018 — Battery Shed; passive grid buffer that fattens the colony's battery. Built from reels + components.
  return { id: state.buildIds++, kind: 'battery', color: BATTERY_COLOR, height: 0.5, residents: 0, jobs: 0, powerLoad: 0, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.batteryCost, materialsCost: COLONY.build.matBattery, crew: COLONY.build.crewBattery, materialsGen: 0, componentsCost: COLONY.build.compBattery, reelsCost: COLONY.build.reelBattery }
}
function designScrubber(state: ColonyState): Artifact {
  // Spec 019 — Air Scrubber Garden; a green filter that clears smog from the homes within its radius.
  return { id: state.buildIds++, kind: 'scrubber', color: SCRUBBER_COLOR, height: 0.45, residents: 0, jobs: COLONY.build.scrubberWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.scrubberCost, materialsCost: COLONY.build.matScrubber, crew: COLONY.build.crewScrubber, materialsGen: 0, componentsCost: COLONY.build.compScrubber }
}
function designAcademy(state: ColonyState): Artifact {
  // Spec 020 — Skillhouse Academy; while staffed, trains the colony's people into skilled workers.
  return { id: state.buildIds++, kind: 'academy', color: ACADEMY_COLOR, height: 1.0, residents: 0, jobs: COLONY.build.academyWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.academyCost, materialsCost: COLONY.build.matAcademy, crew: COLONY.build.crewAcademy, materialsGen: 0, componentsCost: COLONY.build.compAcademy }
}

/** Count buildings + queued jobs of a given kind (so we don't over-queue). */
function countKind(state: ColonyState, kind: BuildKind): number {
  let n = 0
  for (const b of state.buildings) if (b.artifact.kind === kind) n++
  for (const j of state.jobs) if (j.artifact.kind === kind) n++
  return n
}

/** Spec 005 — fraction of habitats within range of a Water Hub (1 when there are no habitats yet). */
export function wateredFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (habs.length === 0) return 1
  const hubs = state.buildings.filter((b) => b.artifact.kind === 'water')
  if (hubs.length === 0) return 0
  let served = 0
  for (const h of habs) if (hubs.some((w) => Math.hypot(w.x - h.x, w.y - h.y) <= COLONY.build.waterHubRadius)) served++
  return served / habs.length
}

/** Spec 007 — is (x,y) within range of a Water Hub? (greenhouses get an irrigation boost). */
function nearWater(state: ColonyState, x: number, y: number): boolean {
  return state.buildings.some((b) => b.artifact.kind === 'water' && Math.hypot(b.x - x, b.y - y) <= COLONY.build.waterHubRadius)
}

/** Spec 008 — fraction of habitats a Ration Depot can actually feed: homes in a depot's reach, capped by
 *  depot coverage, and gated on the stockpile (a depot can't hand out food the colony hasn't grown). */
export function provisionedFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length) return 1
  if (state.food <= 0) return 0
  const depots = state.buildings.filter((b) => b.artifact.kind === 'depot')
  if (!depots.length) return 0
  let inRange = 0
  for (const h of habs) if (depots.some((d) => Math.hypot(d.x - h.x, d.y - h.y) <= COLONY.build.rationDepotRadius)) inRange++
  const capacity = depots.length * COLONY.build.rationDepotHomes
  return Math.min(inRange, capacity) / habs.length
}

/** Spec 009 — fraction of habitats kept healthy by a First Aid Clinic in range (no homes → fully healthy). */
export function healthFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length) return 1
  const clinics = state.buildings.filter((b) => b.artifact.kind === 'clinic')
  if (!clinics.length) return 0
  let served = 0
  for (const h of habs) if (clinics.some((c) => Math.hypot(c.x - h.x, c.y - h.y) <= COLONY.build.clinicRadius)) served++
  return served / habs.length
}

/** Spec 009 — sick workers in uncovered homes work slower: production scales 0.6 (none) → 1.0 (full health). */
function healthFactor(state: ColonyState): number {
  return 0.6 + 0.4 * healthFraction(state)
}

/** Spec 010 — fraction of habitats reached by a Holo-Theatre (culture coverage); no homes → fully cultured. */
export function cultureFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length) return 1
  const theatres = state.buildings.filter((b) => b.artifact.kind === 'theatre')
  if (!theatres.length) return 0
  let served = 0
  for (const h of habs) if (theatres.some((t) => Math.hypot(t.x - h.x, t.y - h.y) <= COLONY.build.theatreRadius)) served++
  return served / habs.length
}

/** Spec 014 — theatres need reels to run their shows; with none in stock the culture bonus is dampened. */
export function cultureFuelFactor(state: ColonyState): number {
  if (countKind(state, 'theatre') === 0) return 1
  return state.reels > 0 ? 1 : COLONY.build.cultureStarvedFactor
}

/** Spec 011 — is a building of `kind` within `radius` of this home? (per-home service coverage). */
function nearBuildingKind(state: ColonyState, home: ColonyBuilding, kind: BuildKind, radius: number): boolean {
  return state.buildings.some((b) => b.artifact.kind === kind && Math.hypot(b.x - home.x, b.y - home.y) <= radius)
}

/** Spec 019 — a home breathes smog when a mine or foundry is within range and no scrubber garden clears it. */
export function polluted(state: ColonyState, home: ColonyBuilding): boolean {
  const nearIndustry = state.buildings.some((b) => (b.artifact.kind === 'mine' || b.artifact.kind === 'foundry') && Math.hypot(b.x - home.x, b.y - home.y) <= COLONY.build.smogRadius)
  if (!nearIndustry) return false
  return !state.buildings.some((b) => b.artifact.kind === 'scrubber' && Math.hypot(b.x - home.x, b.y - home.y) <= COLONY.build.scrubberRadius)
}

/** Spec 019 — fraction of habitats currently breathing smog (for the HUD). */
export function pollutedFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length) return 0
  let n = 0
  for (const h of habs) if (polluted(state, h)) n++
  return n / habs.length
}

/** Spec 011/019 — a single home's liveability 0..1: how well it's served + its tier, minus a smog penalty. */
export function homeLiveability(state: ColonyState, home: ColonyBuilding): number {
  if (home.artifact.kind !== 'habitat') return 0
  const watered = nearBuildingKind(state, home, 'water', COLONY.build.waterHubRadius) ? 1 : 0
  const provisioned = state.food > 0 && nearBuildingKind(state, home, 'depot', COLONY.build.rationDepotRadius) ? 1 : 0
  const healthy = nearBuildingKind(state, home, 'clinic', COLONY.build.clinicRadius) ? 1 : 0
  const cultured = nearBuildingKind(state, home, 'theatre', COLONY.build.theatreRadius) ? 1 : 0
  const services = (watered + provisioned + healthy + cultured) / 4
  const tierTerm = (Math.max(1, Math.min(3, home.tier ?? 1)) - 1) / 2
  const score = 0.7 * services + 0.3 * tierTerm
  return polluted(state, home) ? Math.max(0, score - COLONY.build.pollutionPenalty) : score // spec 019 — smog drags it down
}

/** Spec 011 — mean liveability across all homes (0 if none), for the HUD readout. */
export function colonyLiveability(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length) return 0
  let sum = 0
  for (const h of habs) sum += homeLiveability(state, h)
  return sum / habs.length
}

/** Spec 011 — the liveability overlay is available only once a Survey Office is built AND the colony is peopled. */
export function surveyAvailable(state: ColonyState): boolean {
  return countKind(state, 'survey') > 0 && state.colonists > 0
}

/** Spec 016 — the Kookerverse Courier broadcasts only from a built + staffed Broadcast Mast. */
export function courierAvailable(state: ColonyState): boolean {
  return countKind(state, 'mast') > 0 && state.colonists > 0
}

/** Spec 016 — the colony's own news, read deterministically from live state + the citizens who built it. */
export function colonyHeadlines(state: ColonyState): string[] {
  const h: string[] = []
  const tiers = housingTierCounts(state)
  if (tiers[2] > 0) h.push('A district reaches Tier 3 — a home that wants for nothing.')
  if (countKind(state, 'theatre') > 0 && state.reels <= 0) h.push('The reels run dry; the Holo-Theatres dim until the foundry catches up.')
  else if (state.reels > 0) h.push("The foundry's reels gleam — luxury bound for the Skybridge.")
  h.push(`Population ${Math.round(state.colonists)}, and the border stays busy.`)
  h.push(`${state.buildings.length} structures stand on the island tonight.`)
  if (state.treasury > 0) h.push(`The Exchange is paying: the treasury holds $${Math.round(state.treasury).toLocaleString()}.`)
  // the council's voices — each citizen and what they raised
  if (countKind(state, 'water') > 0) h.push("Mara Venn's Water Hubs keep the far homes flowing.")
  if (countKind(state, 'depot') > 0) h.push("Ration depots carry food to every door — Mara Venn's doing.")
  if (countKind(state, 'clinic') > 0) h.push('The clinics keep the work crews on their feet.')
  if (countKind(state, 'exchange') > 0) h.push("Bram Teel's Skybridge Exchange ships the colony's surplus to the dark.")
  if (countKind(state, 'foundry') > 0) h.push("Niko Vance's foundry weaves components into luxury reels.")
  if (countKind(state, 'survey') > 0) h.push('The Civic Pulse is read — the colony can see where it thrives.')
  return h
}

/** Spec 011 — tint a liveability score 0..1 from amber (starved) to cyan (thriving). Plain RGB lerp, no THREE. */
export function liveabilityTint(score: number): number {
  const s = Math.max(0, Math.min(1, score))
  const ar = 0xe6, ag = 0x8a, ab = 0x3a // amber — starved
  const cr = 0x3a, cg = 0xd1, cb = 0xc8 // cyan — thriving
  const r = Math.round(ar + (cr - ar) * s)
  const g = Math.round(ag + (cg - ag) * s)
  const b = Math.round(ab + (cb - ab) * s)
  return (r << 16) | (g << 8) | b
}

function peakSupply(state: ColonyState): number {
  return COLONY.power.solarPeakW + state.powerGen
}

/** Spec 017 — the colony browns out when it is structurally under-powered (load over peak supply) AND the
 *  battery has drained below the threshold. Only heavy industry sheds load; services keep priority. */
export function inBrownout(state: ColonyState): boolean {
  const pct = state.power.batteryCapWh > 0 ? state.power.batteryWh / state.power.batteryCapWh : 0
  return state.power.loadW > peakSupply(state) && pct < COLONY.build.brownoutBatteryThreshold
}

/** Spec 017 — industry production multiplier: full power → 1, brownout → the reduced factor. */
function powerFactor(state: ColonyState): number {
  return inBrownout(state) ? COLONY.build.brownoutProductionFactor : 1
}
function chooseArtifact(state: ColonyState, rng: RNG): Artifact {
  // Spec 002 — supplies first: when the materials stockpile runs low, raise a mine to replenish it.
  if (state.materials < COLONY.build.materialsLowThreshold) return designMine(state)
  // Spec 003 — refine surplus into components: with a mine feeding us and supplies plentiful, raise
  // workshops up to ~2 per mine to turn materials into components.
  if (countKind(state, 'mine') > 0 && state.materials > COLONY.build.materialsSurplus && countKind(state, 'workshop') < countKind(state, 'mine') * 2) return designWorkshop(state)
  // Spec 005 — service the homes: thirsty habitats + components on hand → raise a Water Hub (~1 per 4 homes).
  if (countKind(state, 'habitat') > 0 && wateredFraction(state) < 0.9 && state.components >= COLONY.build.compWaterHub && countKind(state, 'water') < Math.ceil(countKind(state, 'habitat') / 4)) return designWaterHub(state)
  // Spec 007 — feed the colony: a hungry stockpile + components on hand → raise a Skyfarm Greenhouse (~1 per 12 colonists).
  if (state.colonists > 4 && state.food < state.colonists * COLONY.build.foodPerColonistPerDay && state.components >= COLONY.build.compGreenhouse && countKind(state, 'greenhouse') < Math.ceil(state.colonists / 12)) return designGreenhouse(state)
  // Spec 008 — get the food to the homes: built homes + food on hand + components → raise a Ration Depot.
  if (countKind(state, 'habitat') > 0 && state.food > 0 && provisionedFraction(state) < 0.9 && state.components >= COLONY.build.compDepot && countKind(state, 'depot') < Math.ceil(countKind(state, 'habitat') / COLONY.build.rationDepotHomes)) return designDepot(state)
  // Spec 009 — keep the workers well: homes exist + low health coverage + components → raise a First Aid Clinic.
  if (countKind(state, 'habitat') > 0 && healthFraction(state) < 0.9 && state.components >= COLONY.build.compClinic && countKind(state, 'clinic') < Math.ceil(countKind(state, 'habitat') / 6)) return designClinic(state)
  // Spec 010 — culture for a thriving colony: homes exist + low culture coverage + components → raise a Holo-Theatre.
  if (countKind(state, 'habitat') > 0 && cultureFraction(state) < 0.9 && state.components >= COLONY.build.compTheatre && countKind(state, 'theatre') < Math.ceil(countKind(state, 'habitat') / 8)) return designTheatre(state)
  // Spec 019 — clear the air: smoggy homes + components on hand → plant an Air Scrubber Garden.
  if (pollutedFraction(state) > 0.1 && state.components >= COLONY.build.compScrubber && countKind(state, 'scrubber') < Math.ceil(countKind(state, 'habitat') / 6)) return designScrubber(state)
  // Spec 011 — once the colony is established, raise a Civic Pulse Survey Office to unlock the liveability map.
  if (state.colonists > 8 && countKind(state, 'survey') < 1 && state.components >= COLONY.build.compSurvey) return designSurvey(state)
  // Spec 012 — when components pile up past the trade reserve, raise a Skybridge Exchange to sell the surplus.
  if (state.colonists > 8 && countKind(state, 'exchange') < 1 && state.components > COLONY.build.tradeComponentReserve && state.components >= COLONY.build.compExchange) return designExchange(state)
  // Spec 013 — with components plentiful and an Exchange to sell through, raise a Reel Foundry to refine luxury reels.
  if (state.colonists > 10 && countKind(state, 'foundry') < 1 && state.components > 40 && state.components >= COLONY.build.compFoundry) return designFoundry(state)
  // Spec 020 — train the advanced trades: workshops/foundries up but skilled workers short → raise a Skillhouse Academy.
  if (countKind(state, 'workshop') + countKind(state, 'foundry') > 0 && state.skilled < (countKind(state, 'workshop') + countKind(state, 'foundry')) * COLONY.build.skilledPerAdvanced && state.components >= COLONY.build.compAcademy && countKind(state, 'academy') < 2) return designAcademy(state)
  // Spec 016 — once the colony is a real town, raise a Broadcast Mast so the Kookerverse Courier can speak.
  if (state.colonists > 12 && countKind(state, 'mast') < 1 && state.components >= COLONY.build.compMast) return designMast(state)
  const queuedGen = state.jobs.reduce((g, j) => g + j.artifact.powerGen, 0)
  // Spec 018 — buffer the grid first when brownout-prone and reels are spare: a Battery Shed (capped vs solar so solar still leads).
  if (inBrownout(state) && state.reels >= COLONY.build.reelBattery && state.components >= COLONY.build.compBattery && countKind(state, 'battery') < countKind(state, 'solar') + 1) return designBattery(state)
  if (state.power.loadW > (peakSupply(state) + queuedGen) * COLONY.build.powerHeadroom) return designSolarFarm(state)
  const pendingJobs = state.jobs.reduce((g, j) => g + j.artifact.jobs, 0)
  if (state.colonists - (state.totalJobs + pendingJobs) > COLONY.build.jobDeficitThreshold) return designWorkplace(state, rng)
  return designHabitat(state, rng)
}

/** Plan + pay for one build. Develops a new block (road frame) when the current ones are full. */
/** Colonists currently tied up on active build crews (one crew per in-progress construction job). */
function reservedCrew(state: ColonyState): number {
  let n = 0
  for (const j of state.jobs) n += j.artifact.crew
  return n
}

/** Spec 001 — free colonists available to crew a new build: not employed, not already building. */
export function freeLabour(state: ColonyState): number {
  const employed = Math.min(state.colonists, state.totalJobs)
  return Math.max(0, state.colonists - employed - reservedCrew(state))
}

export function autoGrow(state: ColonyState, rng: RNG): boolean {
  if (state.buildings.length + state.jobs.length >= COLONY.build.maxBuildings) return false

  // Spec 001 — labour + materials gate. A build needs free hands and supplies; bail early (before
  // developing a block) if we can't even afford the cheapest build. No more timer pop-ups.
  const free = freeLabour(state)
  if (free < COLONY.build.crewMine || state.materials < COLONY.build.matMine) return false

  let lot = availableLot(state, rng)
  if (!lot) {
    const nb = nextBlock(state)
    if (!nb) return false
    const roadCells = developBlock(state, nb.bx, nb.by)
    state.treasury -= roadCells * COLONY.build.roadCostPerCell
    lot = availableLot(state, rng)
    if (!lot) return false
  }

  const artifact = chooseArtifact(state, rng)
  if (state.treasury < artifact.cost + 600) return false
  if (state.materials < artifact.materialsCost) return false // not enough supplies
  if (state.components < (artifact.componentsCost ?? 0)) return false // spec 005 — not enough refined goods
  if (state.reels < (artifact.reelsCost ?? 0)) return false // spec 018 — not enough reels (battery sheds)
  if (free < artifact.crew) return false // not enough hands to raise it

  const c = caravan(state)
  state.parcels.push({ id: state.buildIds++, x: lot.x, y: lot.y })
  state.occupied.add(key(lot.x, lot.y))
  state.treasury -= artifact.cost
  state.materials -= artifact.materialsCost // consumed up front; crew reserved via the job until done
  state.components -= artifact.componentsCost ?? 0 // spec 005 — services consume refined goods to build
  state.reels -= artifact.reelsCost ?? 0 // spec 018 — battery sheds consume reels to build
  state.jobs.push({ id: state.buildIds++, x: lot.x, y: lot.y, artifact, progress: 0, path: roadPath(state, c.x, c.y, lot.x, lot.y) })
  return true
}

/** Claim a free grid lot (developing a new block if needed) for a settler's home. */
export function claimLot(state: ColonyState, rng: RNG): { x: number; y: number } | null {
  let lot = availableLot(state, rng)
  if (!lot) {
    const nb = nextBlock(state)
    if (nb) {
      const roadCells = developBlock(state, nb.bx, nb.by)
      state.treasury -= roadCells * COLONY.build.roadCostPerCell
      lot = availableLot(state, rng)
    }
  }
  if (!lot) return null
  state.occupied.add(lot.x + ',' + lot.y)
  return lot
}

/** Per-step: advance construction, settle the daily economy, and grow on an interval. */
/** Spec 002 — staffed mines extract materials into the stockpile; output scales with global staffing. */
function produceMaterials(state: ColonyState, dtMin: number): void {
  let gen = 0
  for (const b of state.buildings) if (b.artifact.kind === 'mine') gen += b.artifact.materialsGen
  if (gen <= 0) return
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  state.materials += gen * staffing * healthFactor(state) * powerFactor(state) * (dtMin / (24 * 60)) // spec 009/017 — sick or brownout-hit mines dig less
}

/** Spec 020 — how well the advanced trades are staffed by skilled workers: full at the cap, 0.6 floor when untrained. */
function skillFactor(state: ColonyState): number {
  const advancedNeed = (countKind(state, 'workshop') + countKind(state, 'foundry')) * COLONY.build.skilledPerAdvanced
  if (advancedNeed <= 0) return 1
  return 0.6 + 0.4 * Math.min(1, Math.min(state.colonists, state.skilled) / advancedNeed)
}

/** Spec 020 — staffed Skillhouse Academies train colonists into skilled workers, capped at the population. */
function academyStep(state: ColonyState, dtMin: number): void {
  const academies = countKind(state, 'academy')
  if (academies === 0) return
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  if (staffing <= 0) return
  state.skilled = Math.min(state.colonists, state.skilled + academies * COLONY.build.academyTrainPerDay * staffing * (dtMin / (24 * 60)))
}

/** Spec 003 — staffed workshops consume materials and produce components (2:1); halt when materials run out. */
function produceComponents(state: ColonyState, dtMin: number): void {
  const eff = (state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0) * healthFactor(state) * powerFactor(state) * skillFactor(state) // spec 009/017/020 — sick, brownout or unskilled workshops refine less
  if (eff <= 0) return
  const day = 24 * 60
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'workshop') continue
    const need = COLONY.build.workshopMaterialsIn * eff * (dtMin / day)
    if (need <= 0) continue
    const consume = Math.min(state.materials, need)
    if (consume <= 0) continue
    state.materials -= consume
    state.components += COLONY.build.workshopComponentsOut * eff * (dtMin / day) * (consume / need)
  }
}

/** Spec 013 — staffed reel foundries consume components and produce reels (2:1); halt when components run out. */
function produceReels(state: ColonyState, dtMin: number): void {
  const eff = (state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0) * healthFactor(state) * powerFactor(state) * skillFactor(state) // spec 009/017/020 — sick, brownout or unskilled foundries weave less
  if (eff <= 0) return
  const day = 24 * 60
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'foundry') continue
    const need = COLONY.build.foundryComponentsIn * eff * (dtMin / day)
    if (need <= 0) continue
    const consume = Math.min(state.components, need)
    if (consume <= 0) continue
    state.components -= consume
    state.reels += COLONY.build.foundryReelsOut * eff * (dtMin / day) * (consume / need)
  }
}

/** Spec 004/006 — total housing: the founders' dropship + each habitat's capacity at its CURRENT tier. */
export function housingCapacity(state: ColonyState): number {
  let cap = COLONY.seed.colonists
  for (const b of state.buildings) if (b.artifact.kind === 'habitat') cap += b.artifact.residents + housingTierBonus(b.tier)
  return cap
}

/** Spec 006 — extra capacity a habitat's tier grants on top of its base residents. */
function housingTierBonus(tier: number | undefined): number {
  const t = Math.max(1, Math.min(3, tier ?? 1))
  return COLONY.build.housingTierBonus[t - 1]!
}

/** Spec 006 — how many habitats sit at each tier (1..3), for the HUD tier-mix readout. */
export function housingTierCounts(state: ColonyState): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0]
  for (const b of state.buildings) if (b.artifact.kind === 'habitat') c[Math.max(1, Math.min(3, b.tier ?? 1)) - 1]++
  return c
}

/** Spec 006 — mean habitat tier; nicer homes draw settlers faster. */
function habitatMeanTier(state: ColonyState): number {
  let n = 0
  let sum = 0
  for (const b of state.buildings) if (b.artifact.kind === 'habitat') { n++; sum += Math.max(1, Math.min(3, b.tier ?? 1)) }
  return n > 0 ? sum / n : 1
}

/** Spec 015 — a home is fully served when every service is in reach: water (005), food delivery (008),
 *  health (009) and culture (010). The top housing tier (T3) requires it. */
function fullyServed(state: ColonyState, home: ColonyBuilding): boolean {
  return (
    !polluted(state, home) && // spec 019 — a smoggy home can't reach the top tier
    nearWater(state, home.x, home.y) &&
    state.food > 0 &&
    nearBuildingKind(state, home, 'depot', COLONY.build.rationDepotRadius) &&
    nearBuildingKind(state, home, 'clinic', COLONY.build.clinicRadius) &&
    nearBuildingKind(state, home, 'theatre', COLONY.build.theatreRadius)
  )
}

/** Spec 006/015 — homes evolve on an interval. T1→T2 needs water + spare components; T2→T3 needs the FULL
 *  service stack (water + food + health + culture) + components. A home devolves if it loses what its
 *  current tier requires, after a grace period. */
function housingStep(state: ColonyState, dtMin: number): void {
  state.housingTimer += dtMin
  if (state.housingTimer < COLONY.build.housingUpgradeIntervalHours * 60) return
  const elapsed = state.housingTimer
  state.housingTimer = 0
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'habitat') continue
    if (b.tier === undefined) b.tier = 1
    const watered = nearWater(state, b.x, b.y)
    const served = fullyServed(state, b) // spec 015 — the whole stack, required for the top tier
    // Climb: T1→T2 on water, T2→T3 on the full service stack — each step spends spare components.
    const canClimb = b.tier < 3 && (b.tier === 1 ? watered : served) && state.components >= COLONY.build.housingUpgradeCost
    // Hold: a home keeps its tier only while it still meets that tier's requirement (T1 always holds).
    const holds = b.tier <= 1 ? true : b.tier === 2 ? watered : served
    if (canClimb) {
      b.tier++
      state.components -= COLONY.build.housingUpgradeCost
      b.dryMin = 0
    } else if (!holds) {
      b.dryMin = (b.dryMin ?? 0) + elapsed
      if (b.dryMin >= COLONY.build.housingDevolveGraceHours * 60 && b.tier > 1) {
        b.tier--
        b.dryMin = 0
      }
    } else {
      b.dryMin = 0
    }
  }
}

/** Spec 004 — settlers immigrate to fill vacant housing while the colony is liveable; if power is
 *  fully dead they drift away, down to the founding crew. */
function immigration(state: ColonyState, dtMin: number): void {
  const perDay = dtMin / (24 * 60)
  const powerDead = state.power.batteryWh <= 0 && state.power.solarW <= 0
  if (powerDead) {
    state.colonists = Math.max(COLONY.seed.colonists, state.colonists - COLONY.build.emigrationPerDay * perDay)
    return
  }
  const cap = housingCapacity(state)
  // Spec 005/007/008 — homes grow only when watered AND fed by DELIVERY. Distribution matters: food in
  // the stockpile reaches homes only as far as a Ration Depot can carry it (0.5 hand-carry credit until one
  // is built; 0.4 dropship-ration floor when truly hungry).
  const reach = countKind(state, 'depot') > 0 ? provisionedFraction(state) : state.food > 0 ? 0.5 : 0
  const fedFactor = 0.4 + 0.6 * reach
  // Spec 006 — nicer homes (higher mean tier) draw settlers faster.
  const tierFactor = 1 + (habitatMeanTier(state) - 1) * 0.2 // tier 1 → 1.0, tier 3 → 1.4
  // Spec 010 — culture draws settlers: a cultured colony is more desirable.
  // Spec 010/014 — culture draws settlers; a theatre with no reels (spec 014) runs dark, halving its pull.
  const cultureFactor = 1 + COLONY.build.cultureDesirabilityBonus * cultureFraction(state) * cultureFuelFactor(state)
  const desirability = Math.max(0.25, wateredFraction(state)) * fedFactor * tierFactor * cultureFactor
  if (state.colonists < cap) state.colonists = Math.min(cap, state.colonists + COLONY.build.immigrationPerDay * desirability * perDay)
}

/** Spec 005 — services (water hubs) consume a trickle of components to run. */
function serviceUpkeep(state: ColonyState, dtMin: number): void {
  let upkeep = 0 // components (water/depot/clinic/theatre)
  let matUpkeep = 0 // materials (spec 011 — the survey office burns sensors/supplies)
  let reelUpkeep = 0 // reels (spec 014 — theatres burn reels as show media)
  for (const b of state.buildings) {
    if (b.artifact.kind === 'water') upkeep += COLONY.build.waterHubMaintCompPerDay
    else if (b.artifact.kind === 'depot') upkeep += COLONY.build.depotMaintCompPerDay
    else if (b.artifact.kind === 'clinic') upkeep += COLONY.build.clinicMaintCompPerDay
    else if (b.artifact.kind === 'theatre') {
      upkeep += COLONY.build.theatreMaintCompPerDay
      reelUpkeep += COLONY.build.theatreReelsPerDay
    } else if (b.artifact.kind === 'survey') matUpkeep += COLONY.build.surveyMaintMatPerDay
    else if (b.artifact.kind === 'battery') upkeep += COLONY.build.batteryMaintCompPerDay
    else if (b.artifact.kind === 'scrubber') upkeep += COLONY.build.scrubberMaintCompPerDay
  }
  if (upkeep > 0) state.components = Math.max(0, state.components - upkeep * (dtMin / (24 * 60)))
  if (matUpkeep > 0) state.materials = Math.max(0, state.materials - matUpkeep * (dtMin / (24 * 60)))
  if (reelUpkeep > 0) state.reels = Math.max(0, state.reels - reelUpkeep * (dtMin / (24 * 60)))
}

/** Spec 007 — staffed greenhouses grow food (boosted near a Water Hub); colonists eat a little each day. */
function foodStep(state: ColonyState, dtMin: number): void {
  const day = 24 * 60
  const staffing = (state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0) * healthFactor(state) * powerFactor(state) // spec 009/017 — sick or brownout greenhouses grow less
  let grown = 0
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'greenhouse') continue
    const boost = nearWater(state, b.x, b.y) ? COLONY.build.greenhouseWaterBoost : 1
    grown += COLONY.build.greenhouseFoodPerDay * boost * staffing
  }
  state.food += grown * (dtMin / day)
  state.food = Math.max(0, state.food - state.colonists * COLONY.build.foodPerColonistPerDay * (dtMin / day))
}

/** Spec 012 — a staffed Skybridge Exchange exports SURPLUS goods (above a reserve) for treasury each day. */
function tradeStep(state: ColonyState, dtMin: number): void {
  const exchanges = countKind(state, 'exchange')
  if (exchanges === 0) return
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  if (staffing <= 0) return
  const frac = dtMin / (24 * 60)
  const compSell = Math.min(Math.max(0, state.components - COLONY.build.tradeComponentReserve), exchanges * COLONY.build.tradeComponentCapPerDay * staffing * frac)
  if (compSell > 0) {
    state.components -= compSell
    state.treasury += compSell * COLONY.build.tradeComponentPrice
  }
  const foodSell = Math.min(Math.max(0, state.food - COLONY.build.tradeFoodReserve), exchanges * COLONY.build.tradeFoodCapPerDay * staffing * frac)
  if (foodSell > 0) {
    state.food -= foodSell
    state.treasury += foodSell * COLONY.build.tradeFoodPrice
  }
  // Spec 013 — luxury reels are the premium export.
  const reelSell = Math.min(Math.max(0, state.reels - COLONY.build.reelReserve), exchanges * COLONY.build.reelCapPerDay * staffing * frac)
  if (reelSell > 0) {
    state.reels -= reelSell
    state.treasury += reelSell * COLONY.build.reelPrice
  }
}

/** Spec 012 — current export income rate ($/day) the Exchanges would earn at this surplus + staffing (HUD). */
export function tradeExportRate(state: ColonyState): number {
  const exchanges = countKind(state, 'exchange')
  if (exchanges === 0) return 0
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  if (staffing <= 0) return 0
  const compSell = Math.min(Math.max(0, state.components - COLONY.build.tradeComponentReserve), exchanges * COLONY.build.tradeComponentCapPerDay * staffing)
  const foodSell = Math.min(Math.max(0, state.food - COLONY.build.tradeFoodReserve), exchanges * COLONY.build.tradeFoodCapPerDay * staffing)
  const reelSell = Math.min(Math.max(0, state.reels - COLONY.build.reelReserve), exchanges * COLONY.build.reelCapPerDay * staffing)
  return compSell * COLONY.build.tradeComponentPrice + foodSell * COLONY.build.tradeFoodPrice + reelSell * COLONY.build.reelPrice
}

export function stepBuild(state: ColonyState, rng: RNG, dtMin: number): void {
  produceMaterials(state, dtMin)
  academyStep(state, dtMin)
  produceComponents(state, dtMin)
  produceReels(state, dtMin)
  serviceUpkeep(state, dtMin)
  foodStep(state, dtMin)
  housingStep(state, dtMin)
  immigration(state, dtMin)
  tradeStep(state, dtMin)
  for (let i = state.jobs.length - 1; i >= 0; i--) {
    const j = state.jobs[i]!
    j.progress += dtMin / j.artifact.buildTimeMin
    if (j.progress >= 1) {
      const nb: ColonyBuilding = { id: j.id, x: j.x, y: j.y, artifact: j.artifact }
      if (j.artifact.kind === 'habitat') { nb.tier = 1; nb.dryMin = 0 } // spec 006 — homes start at tier 1
      state.buildings.push(nb)
      const a = j.artifact
      if (a.kind === 'solar') state.powerGen += a.powerGen
      else if (a.kind === 'battery') state.power.batteryCapWh += COLONY.build.batteryShedCapWh // spec 018 — a bigger tank
      else {
        // Spec 004 — habitats add housing CAPACITY (a.residents), not instant colonists; settlers
        // immigrate to fill it. Mines/workshops have residents 0, so this only changes habitats.
        state.totalJobs += a.jobs
        state.buildingLoad += a.powerLoad
        if (a.kind === 'industrial') state.pollution += COLONY.build.pollutionPerIndustrial
      }
      state.jobs.splice(i, 1)
    }
  }

  if (state.clock.day > state.lastIncomeDay) {
    const days = state.clock.day - state.lastIncomeDay
    state.lastIncomeDay = state.clock.day
    const employed = Math.min(state.colonists, state.totalJobs)
    const rate = state.colonists > 0 ? employed / state.colonists : 0
    const pollutionPenalty = Math.min(0.3, state.pollution / COLONY.economy.pollutionPenaltyScale)
    const income = state.colonists * COLONY.economy.incomePerColonistPerDay * (0.6 + 0.4 * rate) * (1 - pollutionPenalty)
    const upkeep = state.buildings.length * COLONY.economy.buildingUpkeepPerDay + state.roads.length * COLONY.economy.roadUpkeepPerDay
    state.treasury += (income - upkeep) * days
  }

  if (state.clock.totalMinutes - state.lastGrowMin >= COLONY.build.growIntervalHours * 60) {
    state.lastGrowMin = state.clock.totalMinutes
    autoGrow(state, rng)
  }
}
