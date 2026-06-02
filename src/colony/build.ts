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

export type BuildKind = 'habitat' | 'commercial' | 'industrial' | 'solar' | 'mine' | 'workshop' | 'water' | 'greenhouse' | 'depot' | 'clinic' | 'theatre' | 'survey' | 'exchange' | 'foundry' | 'mast' | 'battery' | 'scrubber' | 'academy' | 'transit' | 'maintshed' | 'storehouse' | 'bellhouse' | 'levy' | 'feverwatch' | 'market' | 'ward' | 'payoffice' | 'feast' | 'skimmer' | 'weavery' | 'liaison' | 'stormwatch' | 'hall' | 'import' | 'shrine' | 'comptroller' | 'roster' | 'school' | 'census' | 'folio' | 'turbine' | 'cistern' | 'toolcrib' | 'seedloft' | 'surveycamp'

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
  fibreGen?: number // spec 031: skyflax fibre/day produced when fully staffed (Skimmer Docks); defaults to 0
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
  wear?: number // spec 022 — 0..1 mechanical wear on a working building; repaired by a Maintenance Shed
  vein?: number // spec 052 — a mine's remaining ore reserve in days of life; set full on construction, ticks down as it digs; undefined = full
  incident?: { timer: number } // spec 024 — an active emergency; the building is paused while timer (sim-min) runs
  hazardAccum?: number // spec 024 — accumulated hazard toward the next incident (deterministic, sustained-condition)
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
const TRANSIT_COLOR = 0x4aa0e0 // sky-blue skybridge transit depot
const MAINTSHED_COLOR = 0x8d9aa6 // steel-grey maintenance shed (repair crews)
const STOREHOUSE_COLOR = 0xb0a06a // khaki crate-stacked storehouse platform
const BELLHOUSE_COLOR = 0xd2452f // emergency-red bellhouse (response crews)
const LEVY_COLOR = 0x4caf8a // jade civic levy office (the ledger desk)
const FEVERWATCH_COLOR = 0xe85d9c // pink-magenta fever watch post (public health)
const MARKET_COLOR = 0xe39a3c // marigold housewares market (goods to homes)
const WARD_COLOR = 0x4060c0 // deep-blue ward post (wardens keep order)
const PAYOFFICE_COLOR = 0x7c6fce // violet pay office (payroll counter)
const FEAST_COLOR = 0xf0b840 // festival-gold feast deck (lanterns + cook-tables)
const SKIMMER_COLOR = 0x7fae8a // sage-green flax skimmer dock (rim cloudweed)
const WEAVERY_COLOR = 0xd8c8a0 // linen-cream weavery (looms + bolts)
const LIAISON_COLOR = 0x2f9bd8 // kookerverse-blue liaison office (the channel to the wider world)
const STORMWATCH_COLOR = 0x9aa7b0 // storm-grey stormwatch shelter (rim lookout + refuge)
const HALL_COLOR = 0xd8b65a // founders' gold — the Founders' Hall (civic archive + seat of the notable founders)
const IMPORT_COLOR = 0xc05a9a // import-magenta — the Skybridge Import Office (the buying side of trade)
const SHRINE_COLOR = 0xb6a8e0 // soft violet — the Mooring Shrine (faith + solace for the homes)
const COMPTROLLER_COLOR = 0x3f7d5a // ledger-green — the Comptroller's Office (the colony's debt desk)
const ROSTER_COLOR = 0xc89b5a // roster-bronze — the Roster Office (civic labour administration)
const SCHOOL_COLOR = 0xd98f5a // warm ochre — the Little Schoolroom (the colony's first letters)
const CENSUS_COLOR = 0x4a90c2 // census-blue — the Census Hall (the colony's one gauge of prosperity)
const FOLIO_COLOR = 0xb8862b // gilt-gold — the Folio House (binds the signature finished export)
const TURBINE_COLOR = 0x8fb8d0 // pale steel-blue — the Wind-Shear Turbine Mast (power that scales with the colony)
const CISTERN_COLOR = 0x3f7fb0 // deep cistern-blue — the Mist Condenser Cistern (water made real)
const TOOLCRIB_COLOR = 0xb8823c // worked-bronze — the Tool Crib (components become working tool-kits)
const SEEDLOFT_COLOR = 0x7fae57 // seed-green — the Seed Loft (saved harvest becomes seed-stock)
const SURVEYCAMP_COLOR = 0xc8a25a // surveyor-ochre — the Survey Camp (claims new ground for the colony)
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
  state.fibre = 0 // spec 031 — skyflax fibre, gathered by Skimmer Docks
  state.linen = 0 // spec 031 — linen bolts, woven by Weaveries
  state.folios = 0 // spec 044 — skybound folios, bound by Folio Houses
  state.water = 0 // spec 046 — no stored water until a cistern stands
  state.tools = 0 // spec 047 — no tool-kits until a Tool Crib stands
  state.seed = 0 // spec 048 — no seed-stock until a Seed Loft stands
  state.children = 0 // spec 050 — no dependents until a household births one
  state.claims = 0 // spec 051 — the colony starts at its base footprint
  state.claimProgress = 0 // spec 051 — no survey underway
  state.standing = COLONY.build.standingStart // spec 032 — neutral Kookerverse Standing
  state.request = null // spec 032 — no open Civic Request
  state.requestCooldown = 0 // spec 032
  state.spireStage = 0 // spec 033 — the Horizon Spire is unbuilt
  state.spireProgress = 0
  state.spireBuilding = false
  state.frontTimer = COLONY.build.frontFirstDelayDays * 24 * 60 // spec 034 — the calm before the first Cloudsea Front
  state.importOrder = null // spec 036 — no standing import order until the council sets one
  state.rosterMode = 'balanced' // spec 038 — even labour split until the council sets a priority mode
  state.departurePressure = 0 // spec 041 — no one is leaving a fresh colony
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
      const radius = effectiveBuildRadius(state) // spec 051 — Outer Claims push this past the base maxBlockRadius
      if (Math.abs(nb.bx) > radius || Math.abs(nb.by) > radius) continue
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
function designTransit(state: ColonyState): Artifact {
  // Spec 021 — Skybridge Transit Depot; raises the colony's commute capacity to keep workers flowing.
  return { id: state.buildIds++, kind: 'transit', color: TRANSIT_COLOR, height: 0.8, residents: 0, jobs: COLONY.build.transitWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.transitCost, materialsCost: COLONY.build.matTransit, crew: COLONY.build.crewTransit, materialsGen: 0, componentsCost: COLONY.build.compTransit }
}
function designMaintShed(state: ColonyState): Artifact {
  // Spec 022 — Maintenance Shed; staffed fitters repair the wear on every working building in range.
  return { id: state.buildIds++, kind: 'maintshed', color: MAINTSHED_COLOR, height: 0.7, residents: 0, jobs: COLONY.build.maintShedWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.maintShedCost, materialsCost: COLONY.build.matMaintShed, crew: COLONY.build.crewMaintShed, materialsGen: 0, componentsCost: COLONY.build.compMaintShed }
}
function designStorehouse(state: ColonyState): Artifact {
  // Spec 023 — Storehouse Platform; raises the colony's storage cap for every resource.
  return { id: state.buildIds++, kind: 'storehouse', color: STOREHOUSE_COLOR, height: 0.6, residents: 0, jobs: COLONY.build.storehouseWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.storehouseCost, materialsCost: COLONY.build.matStorehouse, crew: COLONY.build.crewStorehouse, materialsGen: 0, componentsCost: COLONY.build.compStorehouse }
}
function designBellhouse(state: ColonyState): Artifact {
  // Spec 024 — Emergency Bellhouse; staffed response crews answer sudden incidents on stricken buildings.
  return { id: state.buildIds++, kind: 'bellhouse', color: BELLHOUSE_COLOR, height: 1.1, residents: 0, jobs: COLONY.build.bellhouseWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.bellhouseCost, materialsCost: COLONY.build.matBellhouse, crew: COLONY.build.crewBellhouse, materialsGen: 0, componentsCost: COLONY.build.compBellhouse, reelsCost: COLONY.build.reelBellhouse }
}
function designLevy(state: ColonyState): Artifact {
  // Spec 025 — Levy Office; a staffed civic desk that lets the council set the household levy rate.
  return { id: state.buildIds++, kind: 'levy', color: LEVY_COLOR, height: 1.2, residents: 0, jobs: COLONY.build.levyWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.levyOfficeCost, materialsCost: COLONY.build.matLevy, crew: COLONY.build.crewLevy, materialsGen: 0, componentsCost: COLONY.build.compLevy, reelsCost: COLONY.build.reelLevy }
}
function designFeverWatch(state: ColonyState): Artifact {
  // Spec 026 — Fever Watch Post; staffed medics + aides quarantine and contain an outbreak before it spreads.
  return { id: state.buildIds++, kind: 'feverwatch', color: FEVERWATCH_COLOR, height: 1.0, residents: 0, jobs: COLONY.build.feverWatchWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.feverWatchCost, materialsCost: COLONY.build.matFeverWatch, crew: COLONY.build.crewFeverWatch, materialsGen: 0, componentsCost: COLONY.build.compFeverWatch }
}
function designMarket(state: ColonyState): Artifact {
  // Spec 027 — Housewares Market; staffed porters carry manufactured wares (components + reels) out to homes.
  return { id: state.buildIds++, kind: 'market', color: MARKET_COLOR, height: 0.9, residents: 0, jobs: COLONY.build.marketWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.marketCost, materialsCost: COLONY.build.matMarket, crew: COLONY.build.crewMarket, materialsGen: 0, componentsCost: COLONY.build.compMarket }
}
function designWard(state: ColonyState): Artifact {
  // Spec 028 — Ward Post; staffed wardens patrol nearby housing and drive unrest back down.
  return { id: state.buildIds++, kind: 'ward', color: WARD_COLOR, height: 1.0, residents: 0, jobs: COLONY.build.wardWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.wardCost, materialsCost: COLONY.build.matWard, crew: COLONY.build.crewWard, materialsGen: 0, componentsCost: COLONY.build.compWard }
}
function designPayOffice(state: ColonyState): Artifact {
  // Spec 029 — Pay Office; a staffed payroll counter that lets the council set the colony-wide wage rate.
  return { id: state.buildIds++, kind: 'payoffice', color: PAYOFFICE_COLOR, height: 1.2, residents: 0, jobs: COLONY.build.payOfficeWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.payOfficeCost, materialsCost: COLONY.build.matPayOffice, crew: COLONY.build.crewPayOffice, materialsGen: 0, componentsCost: COLONY.build.compPayOffice, reelsCost: COLONY.build.reelPayOffice }
}
function designFeast(state: ColonyState): Artifact {
  // Spec 030 — Feast Deck; a staffed venue where the council funds a Civic Feast to lift morale.
  return { id: state.buildIds++, kind: 'feast', color: FEAST_COLOR, height: 0.7, residents: 0, jobs: COLONY.build.feastWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.feastDeckCost, materialsCost: COLONY.build.matFeast, crew: COLONY.build.crewFeast, materialsGen: 0, componentsCost: COLONY.build.compFeast, reelsCost: COLONY.build.reelFeast }
}
function designSkimmer(state: ColonyState): Artifact {
  // Spec 031 — Flax Skimmer Dock; gathers skyflax fibre from the rim cloudweed while staffed (the 2nd extractor).
  return { id: state.buildIds++, kind: 'skimmer', color: SKIMMER_COLOR, height: 0.6, residents: 0, jobs: COLONY.build.skimmerWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.mineBuildHours * 60, cost: COLONY.build.skimmerCost, materialsCost: COLONY.build.matSkimmer, crew: COLONY.build.crewSkimmer, materialsGen: 0, fibreGen: COLONY.build.fibreGenPerDay }
}
function designWeavery(state: ColonyState): Artifact {
  // Spec 031 — Weavery; weaves skyflax fibre into linen bolts (2:1) while staffed (the 2nd refinery).
  return { id: state.buildIds++, kind: 'weavery', color: WEAVERY_COLOR, height: 1.0, residents: 0, jobs: COLONY.build.weaveryWorkers, powerLoad: 0.5, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.weaveryCost, materialsCost: COLONY.build.matWeavery, crew: COLONY.build.crewWeavery, materialsGen: 0, componentsCost: COLONY.build.compWeavery }
}
function designLiaison(state: ColonyState): Artifact {
  // Spec 032 — Kookerverse Liaison Office; a staffed channel to the wider world that fields its Civic Requests.
  return { id: state.buildIds++, kind: 'liaison', color: LIAISON_COLOR, height: 1.4, residents: 0, jobs: COLONY.build.liaisonWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.liaisonCost, materialsCost: COLONY.build.matLiaison, crew: COLONY.build.crewLiaison, materialsGen: 0, componentsCost: COLONY.build.compLiaison, reelsCost: COLONY.build.reelLiaison }
}
function designStormwatch(state: ColonyState): Artifact {
  // Spec 034 — Stormwatch Shelter; a staffed rim lookout + refuge that braces the colony against Cloudsea Fronts.
  return { id: state.buildIds++, kind: 'stormwatch', color: STORMWATCH_COLOR, height: 1.1, residents: 0, jobs: COLONY.build.stormwatchWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.stormwatchCost, materialsCost: COLONY.build.matStormwatch, crew: COLONY.build.crewStormwatch, materialsGen: 0, componentsCost: COLONY.build.compStormwatch }
}
function designHall(state: ColonyState): Artifact {
  // Spec 035 — Founders' Hall; a staffed civic archive that seats the Living Roster of the colony's notable founders.
  return { id: state.buildIds++, kind: 'hall', color: HALL_COLOR, height: 1.6, residents: 0, jobs: COLONY.build.hallWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.hallCost, materialsCost: COLONY.build.matHall, crew: COLONY.build.crewHall, materialsGen: 0, componentsCost: COLONY.build.compHall }
}
function designImportOffice(state: ColonyState): Artifact {
  // Spec 036 — Skybridge Import Office; the buying side of trade — spends treasury to land a council-chosen good at a premium.
  return { id: state.buildIds++, kind: 'import', color: IMPORT_COLOR, height: 1.3, residents: 0, jobs: COLONY.build.importOfficeWorkers, powerLoad: 0.4, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.importOfficeCost, materialsCost: COLONY.build.matImportOffice, crew: COLONY.build.crewImportOffice, materialsGen: 0, componentsCost: COLONY.build.compImportOffice }
}
function designShrine(state: ColonyState): Artifact {
  // Spec 037 — Mooring Shrine; a small staffed civic shrine that carries Solace to nearby homes (fed by a trickle of linen).
  return { id: state.buildIds++, kind: 'shrine', color: SHRINE_COLOR, height: 1.2, residents: 0, jobs: COLONY.build.shrineWorkers, powerLoad: 0.2, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.shrineCost, materialsCost: COLONY.build.matShrine, crew: COLONY.build.crewShrine, materialsGen: 0, componentsCost: COLONY.build.compShrine }
}
function designComptroller(state: ColonyState): Artifact {
  // Spec 039 — Comptroller's Office; the colony's debt desk — lets the treasury run a managed deficit to a ceiling.
  return { id: state.buildIds++, kind: 'comptroller', color: COMPTROLLER_COLOR, height: 1.4, residents: 0, jobs: COLONY.build.comptrollerWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.comptrollerCost, materialsCost: COLONY.build.matComptroller, crew: COLONY.build.crewComptroller, materialsGen: 0, componentsCost: COLONY.build.compComptroller }
}
function designRoster(state: ColonyState): Artifact {
  // Spec 038 — Roster Office; civic labour administration that unlocks labour priority by sector under a shortage.
  return { id: state.buildIds++, kind: 'roster', color: ROSTER_COLOR, height: 1.3, residents: 0, jobs: COLONY.build.rosterWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.rosterCost, materialsCost: COLONY.build.matRoster, crew: COLONY.build.crewRoster, materialsGen: 0, componentsCost: COLONY.build.compRoster }
}
function designSchool(state: ColonyState): Artifact {
  // Spec 042 — Little Schoolroom; a small staffed home-service building that schools nearby homes (no goods, just teachers).
  return { id: state.buildIds++, kind: 'school', color: SCHOOL_COLOR, height: 1.1, residents: 0, jobs: COLONY.build.schoolWorkers, powerLoad: 0.2, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.schoolCost, materialsCost: COLONY.build.matSchool, crew: COLONY.build.crewSchool, materialsGen: 0 }
}
function designCensus(state: ColonyState): Artifact {
  // Spec 040 — Census Hall; a staffed civic hall that reads the whole colony into one Prosperity rank.
  return { id: state.buildIds++, kind: 'census', color: CENSUS_COLOR, height: 1.5, residents: 0, jobs: COLONY.build.censusWorkers, powerLoad: 0.3, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.censusCost, materialsCost: COLONY.build.matCensus, crew: COLONY.build.crewCensus, materialsGen: 0, componentsCost: COLONY.build.compCensus }
}
function designFolio(state: ColonyState): Artifact {
  // Spec 044 — Folio House; binds 1 reel + 1 linen into 1 skybound folio, the colony's signature finished export.
  return { id: state.buildIds++, kind: 'folio', color: FOLIO_COLOR, height: 1.2, residents: 0, jobs: COLONY.build.folioWorkers, powerLoad: 0.6, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.folioCost, materialsCost: COLONY.build.matFolio, crew: COLONY.build.crewFolio, materialsGen: 0, componentsCost: COLONY.build.compFolio }
}
function designTurbine(state: ColonyState): Artifact {
  // Spec 045 — Wind-Shear Turbine Mast; a staffed high-output generator (its power is computed live by turbinePower).
  return { id: state.buildIds++, kind: 'turbine', color: TURBINE_COLOR, height: 1.8, residents: 0, jobs: COLONY.build.turbineWorkers, powerLoad: 0, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.turbineCost, materialsCost: COLONY.build.matTurbine, crew: COLONY.build.crewTurbine, materialsGen: 0, componentsCost: COLONY.build.compTurbine }
}
function designCistern(state: ColonyState): Artifact {
  // Spec 046 — Mist Condenser Cistern; a staffed condenser that fills the colony's water tank (heavy grid draw).
  return { id: state.buildIds++, kind: 'cistern', color: CISTERN_COLOR, height: 0.9, residents: 0, jobs: COLONY.build.cisternWorkers, powerLoad: COLONY.build.cisternPowerLoad, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.cisternCost, materialsCost: COLONY.build.matCistern, crew: COLONY.build.crewCistern, materialsGen: 0, componentsCost: COLONY.build.compCistern }
}
function designToolCrib(state: ColonyState): Artifact {
  // Spec 047 — Tool Crib; a staffed bench that turns components into tool-kits for the whole extraction-and-production base.
  return { id: state.buildIds++, kind: 'toolcrib', color: TOOLCRIB_COLOR, height: 0.7, residents: 0, jobs: COLONY.build.toolCribWorkers, powerLoad: COLONY.build.toolCribPowerLoad, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.toolCribCost, materialsCost: COLONY.build.matToolCrib, crew: COLONY.build.crewToolCrib, materialsGen: 0, componentsCost: COLONY.build.compToolCrib }
}
function designSeedLoft(state: ColonyState): Artifact {
  // Spec 048 — Seed Loft; a staffed loft that dries saved harvest (food + water) into seed-stock for the skyfarms.
  return { id: state.buildIds++, kind: 'seedloft', color: SEEDLOFT_COLOR, height: 0.7, residents: 0, jobs: COLONY.build.seedLoftWorkers, powerLoad: COLONY.build.seedLoftPowerLoad, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.seedLoftCost, materialsCost: COLONY.build.matSeedLoft, crew: COLONY.build.crewSeedLoft, materialsGen: 0, componentsCost: COLONY.build.compSeedLoft }
}
function designSurveyCamp(state: ColonyState): Artifact {
  // Spec 051 — Survey Camp; a staffed boundary worksite whose Outer Claims push the colony's build footprint outward.
  return { id: state.buildIds++, kind: 'surveycamp', color: SURVEYCAMP_COLOR, height: 0.6, residents: 0, jobs: COLONY.build.surveyCampWorkers, powerLoad: COLONY.build.surveyCampPowerLoad, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: COLONY.build.surveyCampCost, materialsCost: COLONY.build.matSurveyCamp, crew: COLONY.build.crewSurveyCamp, materialsGen: 0, componentsCost: COLONY.build.compSurveyCamp }
}

/** Spec 045 — steady power the built, staffed Turbine Masts add to the grid (harvests wind day + night; understaffing cuts it). */
export function turbinePower(state: ColonyState): number {
  const n = state.buildings.filter((b) => b.artifact.kind === 'turbine').length
  if (n === 0) return 0
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  return n * COLONY.build.turbineOutputW * staffing * toolSupplyFactor(state) // spec 047 — a turbine blade does not re-seat without tools
}

/** Count buildings + queued jobs of a given kind (so we don't over-queue). */
function countKind(state: ColonyState, kind: BuildKind): number {
  let n = 0
  for (const b of state.buildings) if (b.artifact.kind === kind) n++
  for (const j of state.jobs) if (j.artifact.kind === kind) n++
  return n
}

/** Spec 005 — fraction of habitats within range of a Water Hub (1 when there are no habitats yet). */
/** Spec 046 — total water-tank capacity (the cisterns' combined tanks; 0 with none). */
export function waterTankCap(state: ColonyState): number {
  return state.buildings.filter((b) => b.artifact.kind === 'cistern').length * COLONY.build.cisternTankCap
}

/** Spec 046 — water-coverage supply factor: 1 with no cistern (water is free coverage as today); once cisterns stand it
 *  scales with the tank — full → 1, dry → the floor — so a dry tank weakens the Water Hubs' reach. */
export function waterSupplyFactor(state: ColonyState): number {
  if (countKind(state, 'cistern') === 0) return 1 // inert — water is the free infinite coverage it has always been
  const t = Math.min(1, (state.water ?? 0) / COLONY.build.waterComfortBuffer)
  return COLONY.build.waterSupplyFloor + (1 - COLONY.build.waterSupplyFloor) * t
}

/** Spec 046 — Water readout for the HUD: the tank, its capacity, the cistern count, and whether it is running dry. */
export function waterStatus(state: ColonyState): { stored: number; cap: number; cisterns: number; dry: boolean } {
  const cisterns = countKind(state, 'cistern')
  return { stored: Math.round(state.water ?? 0), cap: waterTankCap(state), cisterns, dry: cisterns > 0 && (state.water ?? 0) < COLONY.build.waterComfortBuffer }
}

/** Spec 046 — condense + draw water each step: staffed cisterns fill the tank (cut by brownout); homes draw it down. */
function waterStep(state: ColonyState, dtMin: number): void {
  if (countKind(state, 'cistern') === 0) return // no cistern → water stays the free coverage it is today (inert)
  const frac = dtMin / (24 * 60)
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  const cisterns = state.buildings.filter((b) => b.artifact.kind === 'cistern').length
  const fill = cisterns * COLONY.build.cisternFillPerDay * staffing * powerFactor(state) * frac // a brownout slows the heavy condensers
  const homes = state.buildings.filter((b) => b.artifact.kind === 'habitat').length
  const draw = homes * COLONY.build.waterDrawPerHomePerDay * frac
  state.water = Math.max(0, Math.min(waterTankCap(state), (state.water ?? 0) + fill - draw))
  // Spec 046 — a dry tank breeds sickness + disorder, scaled by how much water coverage is lost (none while the tank is full).
  if (homes > 0 && (state.water ?? 0) < COLONY.build.waterComfortBuffer) {
    const lost = 1 - waterSupplyFactor(state)
    state.outbreak = Math.min(1, (state.outbreak ?? 0) + COLONY.build.dryTankFeverPerDay * lost * frac)
    state.unrest = Math.min(COLONY.build.unrestMax, (state.unrest ?? 0) + COLONY.build.dryTankUnrestPerDay * lost * frac)
  }
}

/** Spec 047 — the workplaces that need tool-kits to work at full speed (mine, workshop, skyfarm, maintenance shed, turbine). */
const TOOLED_KINDS: BuildKind[] = ['mine', 'workshop', 'greenhouse', 'maintshed', 'turbine']

/** Spec 047 — flat capacity of the colony's tool-kit rack (the same whatever the crib count; only matters once a crib stands). */
export function toolStockCap(_state: ColonyState): number {
  return COLONY.build.toolStockCap
}

/** Spec 047 — how many built tooled workplaces are running (skips ones mid-incident); the tool-kit demand scales with this. */
function tooledWorkplaceCount(state: ColonyState): number {
  let n = 0
  for (const b of state.buildings) if (TOOLED_KINDS.includes(b.artifact.kind) && !b.incident) n++
  return n
}

/** Spec 047 — tool-supply factor: 1 with no Tool Crib (bare-handed work is the free full-speed work it has always been); once a
 *  crib stands it scales with the rack — full → 1, dry → the floor — so a drained rack weakens every tooled workplace together. */
export function toolSupplyFactor(state: ColonyState): number {
  if (countKind(state, 'toolcrib') === 0) return 1 // inert — no tool economy until the colony industrialises its tools
  const t = Math.min(1, (state.tools ?? 0) / COLONY.build.toolComfortBuffer)
  return COLONY.build.toolFloor + (1 - COLONY.build.toolFloor) * t
}

/** Spec 047 — Tools readout for the HUD: the rack, its capacity, the crib count, and whether the kits are running short. */
export function toolStatus(state: ColonyState): { stored: number; cap: number; cribs: number; short: boolean } {
  const cribs = countKind(state, 'toolcrib')
  return { stored: Math.round(state.tools ?? 0), cap: toolStockCap(state), cribs, short: cribs > 0 && (state.tools ?? 0) < COLONY.build.toolComfortBuffer }
}

/** Spec 047 — make tools each step: staffed cribs draw components → tool-kits (cut by brownout); tooled workplaces draw them down. */
function toolStep(state: ColonyState, dtMin: number): void {
  if (countKind(state, 'toolcrib') === 0) return // no crib → no tool economy (every tooled output stays at factor 1; inert)
  const frac = dtMin / (24 * 60)
  const cribs = state.buildings.filter((b) => b.artifact.kind === 'toolcrib').length
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  const cap = toolStockCap(state)
  let tools = state.tools ?? 0
  // Production: each staffed, powered crib draws up to N components → 4 kits each, never overfilling the rack.
  const headroom = Math.max(0, cap - tools)
  const wantComp = cribs * COLONY.build.toolCribComponentsPerDay * staffing * powerFactor(state) * frac // a brownout slows the bench
  const drawComp = Math.min(state.components, wantComp, headroom / COLONY.build.toolKitsPerComponent)
  if (drawComp > 0) {
    state.components -= drawComp
    tools += drawComp * COLONY.build.toolKitsPerComponent
  }
  // Demand: every working tooled workplace wears through kits as it runs (clamped to the stock on hand).
  const draw = tooledWorkplaceCount(state) * COLONY.build.toolUsePerWorkplacePerDay * staffing * frac
  tools -= draw
  state.tools = Math.max(0, Math.min(cap, tools))
}

/** Spec 048 — flat capacity of the colony's seed bin (the same whatever the loft count; only matters once a loft stands). */
export function seedStockCap(_state: ColonyState): number {
  return COLONY.build.seedStockCap
}

/** Spec 048 — seed-supply factor: 1 with no Seed Loft (food grows free as today); once a loft stands it scales with the bin —
 *  full → 1, dry → the floor — so a drained seed bin drops every skyfarm's yield together. */
export function seedSupplyFactor(state: ColonyState): number {
  if (countKind(state, 'seedloft') === 0) return 1 // inert — no seed economy until the colony keeps its own seed
  const t = Math.min(1, (state.seed ?? 0) / COLONY.build.seedComfortBuffer)
  return COLONY.build.seedFloor + (1 - COLONY.build.seedFloor) * t
}

/** Spec 048 — Seed readout for the HUD: the bin, its capacity, the loft count, and whether the seed is running short. */
export function seedStatus(state: ColonyState): { stored: number; cap: number; lofts: number; short: boolean } {
  const lofts = countKind(state, 'seedloft')
  return { stored: Math.round(state.seed ?? 0), cap: seedStockCap(state), lofts, short: lofts > 0 && (state.seed ?? 0) < COLONY.build.seedComfortBuffer }
}

/** Spec 048 — dry seed each step: staffed lofts save food (+ water when cisterns stand) into the bin; skyfarms draw it down. */
function seedStep(state: ColonyState, dtMin: number): void {
  if (countKind(state, 'seedloft') === 0) return // no loft → food grows as it always has (inert; the seed factor stays 1)
  const frac = dtMin / (24 * 60)
  const lofts = state.buildings.filter((b) => b.artifact.kind === 'seedloft').length
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  const cap = seedStockCap(state)
  let seed = state.seed ?? 0
  // Production: each staffed, powered loft dries up to N batches/day of (2 food + 1 water) → 3 seed, never overfilling the bin.
  const headroom = Math.max(0, cap - seed)
  const wantBatches = lofts * COLONY.build.seedLoftBatchesPerDay * staffing * powerFactor(state) * frac // a brownout slows the racks
  const cisterns = countKind(state, 'cistern') > 0 // soft water coupling: only draw the tank once stored water is real (046)
  const byFood = state.food / COLONY.build.seedLoftFoodPerBatch
  const byWater = cisterns ? (state.water ?? 0) / COLONY.build.seedLoftWaterPerBatch : Infinity
  const byHeadroom = headroom / COLONY.build.seedPerBatch
  const batches = Math.max(0, Math.min(wantBatches, byFood, byWater, byHeadroom))
  if (batches > 0) {
    state.food = Math.max(0, state.food - batches * COLONY.build.seedLoftFoodPerBatch)
    if (cisterns) state.water = Math.max(0, (state.water ?? 0) - batches * COLONY.build.seedLoftWaterPerBatch)
    seed += batches * COLONY.build.seedPerBatch
  }
  // Demand: every working skyfarm draws seed as it grows (clamped to the bin on hand).
  const farms = state.buildings.filter((b) => b.artifact.kind === 'greenhouse' && !b.incident).length
  const draw = farms * COLONY.build.seedUsePerFarmPerDay * staffing * frac
  seed -= draw
  state.seed = Math.max(0, Math.min(cap, seed))
}

export function wateredFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (habs.length === 0) return 1
  const hubs = state.buildings.filter((b) => b.artifact.kind === 'water')
  if (hubs.length === 0) return 0
  let served = 0
  for (const h of habs) if (hubs.some((w) => Math.hypot(w.x - h.x, w.y - h.y) <= COLONY.build.waterHubRadius)) served++
  return (served / habs.length) * waterSupplyFactor(state) // spec 046 — once cisterns stand, a dry tank weakens the Hubs' reach
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

/** Spec 037 — fraction of homes consoled by a staffed Mooring Shrine, dimmed when the shrine runs out of linen (0 with none). */
export function solaceCoverage(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length || countKind(state, 'shrine') === 0) return 0
  if ((state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) <= 0) return 0 // unstaffed → nobody keeps the shrine, no Solace
  const shrines = state.buildings.filter((b) => b.artifact.kind === 'shrine')
  let served = 0
  for (const h of habs) if (shrines.some((s) => Math.hypot(s.x - h.x, s.y - h.y) <= COLONY.build.shrineRadius)) served++
  const fuel = (state.linen ?? 0) > 0 ? 1 : COLONY.build.solaceStarvedFactor // spec 037 — no linen for flags + wraps → the Solace dims
  return (served / habs.length) * fuel
}

/** Spec 037 — Solace readout for the HUD: the consoled fraction (0..1) and how many shrines stand. */
export function solaceStatus(state: ColonyState): { coverage: number; shrines: number } {
  return { coverage: solaceCoverage(state), shrines: countKind(state, 'shrine') }
}

/** Spec 042 — fraction of homes schooled by a staffed Little Schoolroom (0 with none, or while unstaffed). */
export function educationFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length || countKind(state, 'school') === 0) return 0
  if ((state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) <= 0) return 0 // unstaffed → the room sits dark, teaches no one
  const schools = state.buildings.filter((b) => b.artifact.kind === 'school')
  let served = 0
  for (const h of habs) if (schools.some((s) => Math.hypot(s.x - h.x, s.y - h.y) <= COLONY.build.schoolRadius)) served++
  return served / habs.length
}

/** Spec 042 — Education readout for the HUD: the schooled fraction (0..1) and how many schoolrooms stand. */
export function educationStatus(state: ColonyState): { coverage: number; schools: number } {
  return { coverage: educationFraction(state), schools: countKind(state, 'school') }
}

/** Spec 040 — the colony reads its own Prosperity only while a built, staffed Census Hall stands (else the gauge is dark). */
export function censusActive(state: ColonyState): boolean {
  if (countKind(state, 'census') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 040 — the five Prosperity ranks, lowest to highest. */
export const PROSPERITY_RANKS = ['Struggling', 'Modest', 'Steady', 'Prospering', 'Renowned'] as const

/** Spec 040 — colony-wide Prosperity score (0..1), a weighted blend of signals the colony already produces. 0 with no
 *  staffed Census Hall, so it is a pure synthesis layer that changes nothing until the Hall is read. */
export function prosperityScore(state: ColonyState): number {
  if (!censusActive(state)) return 0
  const live = colonyLiveability(state) // 0..1 — average home wellbeing (spec 011)
  const tiers = housingTierCounts(state)
  const homes = tiers[0] + tiers[1] + tiers[2]
  const tierShare = homes > 0 ? (tiers[1] + tiers[2]) / homes : 0 // share of Tier 2 + 3 homes (spec 006)
  const employment = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  const standing = state.standing ?? 0.5 // spec 032
  const debt = state.treasury < 0 ? -state.treasury : 0
  const solvency = state.treasury >= 0 ? 1 : Math.max(0, 1 - debt / COLONY.build.debtCeiling) // spec 039
  const w = COLONY.build
  const s = live * w.prospLiveabilityWeight + tierShare * w.prospTierWeight + employment * w.prospEmploymentWeight + standing * w.prospStandingWeight + solvency * w.prospSolvencyWeight
  return Math.max(0, Math.min(1, s))
}

/** Spec 040 — the Prosperity rank 0..4 (Struggling..Renowned) from the score. */
export function prosperityRank(state: ColonyState): number {
  return Math.max(0, Math.min(4, Math.floor(prosperityScore(state) / 0.2)))
}

/** Spec 040 — immigration lift from high Prosperity: nothing below the floor, a small pull at the top (1.0 with no Hall). */
function prosperityDesirabilityFactor(state: ColonyState): number {
  if (!censusActive(state)) return 1
  return 1 + COLONY.build.prosperityImmigrationBonus * Math.max(0, prosperityScore(state) - COLONY.build.prosperityBonusFloor)
}

/** Spec 040 — Prosperity readout for the HUD: whether the Hall reads, the score (0..100), the rank + its name, and the milestone. */
export function prosperityStatus(state: ColonyState): { active: boolean; score: number; rank: number; rankName: string; recognised: boolean } {
  const active = censusActive(state)
  const rank = prosperityRank(state)
  return { active, score: Math.round(prosperityScore(state) * 100), rank, rankName: PROSPERITY_RANKS[rank], recognised: active && rank >= 4 }
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
  // Spec 041 — when the colony is shedding people, the Courier names it plainly.
  { const d = departureStatus(state); if (d.atRisk) h.push(`Households are leaving the failing decks — ${d.cause} drives them to the moorings.`) }
  h.push(`${state.buildings.length} structures stand on the island tonight.`)
  if (state.treasury > 0) h.push(`The Exchange is paying: the treasury holds $${Math.round(state.treasury).toLocaleString()}.`)
  // the council's voices — each citizen and what they raised
  if (countKind(state, 'water') > 0) h.push("Mara Venn's Water Hubs keep the far homes flowing.")
  if (countKind(state, 'depot') > 0) h.push("Ration depots carry food to every door — Mara Venn's doing.")
  if (countKind(state, 'clinic') > 0) h.push('The clinics keep the work crews on their feet.')
  if (countKind(state, 'exchange') > 0) h.push("Bram Teel's Skybridge Exchange ships the colony's surplus to the dark.")
  if (countKind(state, 'foundry') > 0) h.push("Niko Vance's foundry weaves components into luxury reels.")
  if (countKind(state, 'survey') > 0) h.push('The Civic Pulse is read — the colony can see where it thrives.')
  // Spec 040 — the Census Hall reads the colony's prosperity; the top rank is a milestone the Courier proclaims.
  if (censusActive(state)) { const p = prosperityStatus(state); h.push(p.recognised ? 'Landing One is named a Recognised Sky-Colony — Prosperity at its height.' : `The Census Hall reads the colony ${p.rankName} (Prosperity ${p.score}).`) }
  // Spec 035 — once the Founders' Hall seats the Living Roster, the Courier reports the founders by name and post.
  if (foundersHallActive(state)) {
    h.push('The Founders’ Hall seats the Living Roster — the people who built Landing One take their posts.')
    const f = FOUNDERS[(Math.round(state.colonists) + state.buildings.length) % FOUNDERS.length] // a different founder each reading, deterministic
    h.push(`${f.name} keeps the post of ${f.role} — the colony remembers who carries its burdens.`)
  }
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
  return COLONY.power.solarPeakW + state.powerGen + turbinePower(state) // spec 045 — staffed Turbine Masts scale the supply
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
  // Spec 027 — get the wares to the homes: built homes + components on hand → raise a Housewares Market (the top tier needs delivered wares).
  if (countKind(state, 'habitat') > 0 && housewaresFraction(state) < 0.9 && state.components >= COLONY.build.compMarket && countKind(state, 'market') < Math.ceil(countKind(state, 'habitat') / COLONY.build.marketHomes)) return designMarket(state)
  // Spec 009 — keep the workers well: homes exist + low health coverage + components → raise a First Aid Clinic.
  if (countKind(state, 'habitat') > 0 && healthFraction(state) < 0.9 && state.components >= COLONY.build.compClinic && countKind(state, 'clinic') < Math.ceil(countKind(state, 'habitat') / 6)) return designClinic(state)
  // Spec 010 — culture for a thriving colony: homes exist + low culture coverage + components → raise a Holo-Theatre.
  if (countKind(state, 'habitat') > 0 && cultureFraction(state) < 0.9 && state.components >= COLONY.build.compTheatre && countKind(state, 'theatre') < Math.ceil(countKind(state, 'habitat') / 8)) return designTheatre(state)
  // Spec 037 — comfort the homes: an established colony with components on hand raises a Mooring Shrine to carry Solace.
  if (state.colonists > 8 && countKind(state, 'habitat') > 0 && solaceCoverage(state) < 0.9 && state.components >= COLONY.build.compShrine && countKind(state, 'shrine') < Math.ceil(countKind(state, 'habitat') / COLONY.build.shrineHomes)) return designShrine(state)
  // Spec 042 — teach the homes: an established colony with materials on hand raises a Little Schoolroom for Education.
  if (state.colonists > 8 && countKind(state, 'habitat') > 0 && educationFraction(state) < 0.9 && state.materials >= COLONY.build.matSchool && countKind(state, 'school') < Math.ceil(countKind(state, 'habitat') / COLONY.build.schoolHomes)) return designSchool(state)
  // Spec 019 — clear the air: smoggy homes + components on hand → plant an Air Scrubber Garden.
  if (pollutedFraction(state) > 0.1 && state.components >= COLONY.build.compScrubber && countKind(state, 'scrubber') < Math.ceil(countKind(state, 'habitat') / 6)) return designScrubber(state)
  // Spec 011 — once the colony is established, raise a Civic Pulse Survey Office to unlock the liveability map.
  if (state.colonists > 8 && countKind(state, 'survey') < 1 && state.components >= COLONY.build.compSurvey) return designSurvey(state)
  // Spec 012 — when components pile up past the trade reserve, raise a Skybridge Exchange to sell the surplus.
  if (state.colonists > 8 && countKind(state, 'exchange') < 1 && state.components > COLONY.build.tradeComponentReserve && state.components >= COLONY.build.compExchange) return designExchange(state)
  // Spec 013 — with components plentiful and an Exchange to sell through, raise a Reel Foundry to refine luxury reels.
  if (state.colonists > 10 && countKind(state, 'foundry') < 1 && state.components > 40 && state.components >= COLONY.build.compFoundry) return designFoundry(state)
  // Spec 031 — open the second line only once the core economy is comfortable (materials in surplus) and fibre is short.
  if (state.colonists > 12 && state.materials > COLONY.build.materialsSurplus && (state.fibre ?? 0) < COLONY.build.fibreLowThreshold && countKind(state, 'skimmer') < COLONY.build.maxSkimmer) return designSkimmer(state)
  // Spec 031 — weave the surplus: with fibre plentiful, raise a Weavery (up to one per dock) to make linen.
  if (countKind(state, 'skimmer') > 0 && (state.fibre ?? 0) > COLONY.build.fibreSurplus && countKind(state, 'weavery') < countKind(state, 'skimmer')) return designWeavery(state)
  // Spec 044 — bind the two chains: with reels + linen plentiful and an Exchange to sell through, raise a Folio House.
  if (state.colonists > 12 && countKind(state, 'folio') < 1 && countKind(state, 'exchange') > 0 && state.reels > 40 && (state.linen ?? 0) > 30 && state.components >= COLONY.build.compFolio) return designFolio(state)
  // Spec 020 — train the advanced trades: workshops/foundries up but skilled workers short → raise a Skillhouse Academy.
  if (countKind(state, 'workshop') + countKind(state, 'foundry') > 0 && state.skilled < (countKind(state, 'workshop') + countKind(state, 'foundry')) * COLONY.build.skilledPerAdvanced && state.components >= COLONY.build.compAcademy && countKind(state, 'academy') < 2) return designAcademy(state)
  // Spec 016 — once the colony is a real town, raise a Broadcast Mast so the Kookerverse Courier can speak.
  if (state.colonists > 12 && countKind(state, 'mast') < 1 && state.components >= COLONY.build.compMast) return designMast(state)
  // Spec 025 — give money a lever: an established colony with reels on hand raises a Levy Office (the rate stays normal until the council sets it).
  if (state.colonists > 10 && countKind(state, 'levy') < 1 && state.components >= COLONY.build.compLevy && state.reels >= COLONY.build.reelLevy) return designLevy(state)
  // Spec 029 — pay the hands: an established colony with reels on hand raises a Pay Office (the wage stays standard until the council sets it).
  if (state.colonists > 10 && countKind(state, 'payoffice') < 1 && state.components >= COLONY.build.compPayOffice && state.reels >= COLONY.build.reelPayOffice) return designPayOffice(state)
  // Spec 030 — a place to gather: a real town with reels on hand raises a Feast Deck so the council can fund a Civic Feast.
  if (state.colonists > 12 && countKind(state, 'feast') < 1 && state.components >= COLONY.build.compFeast && state.reels >= COLONY.build.reelFeast) return designFeast(state)
  // Spec 032 — answer the wider world: an established colony with reels on hand raises a Kookerverse Liaison Office.
  if (state.colonists > 12 && countKind(state, 'liaison') < 1 && state.components >= COLONY.build.compLiaison && state.reels >= COLONY.build.reelLiaison) return designLiaison(state)
  // Spec 034 — respect the sky: an established colony raises a Stormwatch Shelter to brace for the Cloudsea Fronts.
  if (state.colonists > COLONY.build.frontMinColonists && countKind(state, 'stormwatch') < COLONY.build.maxStormwatch && state.components >= COLONY.build.compStormwatch) return designStormwatch(state)
  // Spec 035 — honour the builders: a mature colony with components on hand raises a Founders' Hall to seat the Living Roster.
  if (state.colonists > 14 && countKind(state, 'hall') < 1 && state.components >= COLONY.build.compHall) return designHall(state)
  // Spec 040 — take the colony's measure: a mature colony with components on hand raises a Census Hall to read its Prosperity.
  if (state.colonists > 14 && countKind(state, 'census') < 1 && state.components >= COLONY.build.compCensus) return designCensus(state)
  // Spec 046 — make water real: a large, well-powered colony raises a Mist Condenser Cistern (one per ~60 homes) to fill the tanks.
  if (state.colonists > 16 && !inBrownout(state) && countKind(state, 'habitat') > 0 && countKind(state, 'cistern') < Math.max(1, Math.ceil(countKind(state, 'habitat') / 60)) && state.components >= COLONY.build.compCistern) return designCistern(state)
  // Spec 047 — once an extraction base exists (a mine + a workshop) and components sit spare, raise a Tool Crib (one per ~6 tooled workplaces) to keep the hands in tools.
  if (state.colonists > 12 && !inBrownout(state) && countKind(state, 'mine') > 0 && countKind(state, 'workshop') > 0 && state.components >= COLONY.build.compToolCrib + COLONY.build.toolCribSpareComponents && countKind(state, 'toolcrib') < Math.max(1, Math.ceil(tooledWorkplaceCount(state) / 6))) return designToolCrib(state)
  // Spec 048 — once the colony farms at scale and food sits comfortably spare, raise a Seed Loft (one per ~6 skyfarms) so the harvest stays seeded; the surplus gate keeps it from ever tipping a food-marginal colony.
  if (state.colonists > 12 && !inBrownout(state) && countKind(state, 'greenhouse') > 0 && state.food > COLONY.build.seedLoftFoodSurplus && state.components >= COLONY.build.compSeedLoft + COLONY.build.seedLoftSpareComponents && countKind(state, 'seedloft') < Math.max(1, Math.ceil(countKind(state, 'greenhouse') / 6))) return designSeedLoft(state)
  // Spec 051 — when the colony has filled its current footprint (no block left to develop) and could still claim more ground, raise a Survey Camp to push the boundary out.
  if (state.colonists > 14 && countKind(state, 'surveycamp') < 1 && (state.claims ?? 0) < COLONY.build.maxClaims && nextBlock(state) === null && state.components >= COLONY.build.compSurveyCamp && state.materials >= COLONY.build.matSurveyCamp + COLONY.build.matPerClaim) return designSurveyCamp(state)
  // Spec 036 — once trade is established (an Exchange stands) and the bank is flush, raise an Import Office to buy shortages.
  if (state.colonists > 12 && countKind(state, 'import') < 1 && countKind(state, 'exchange') > 0 && state.components >= COLONY.build.compImportOffice && state.treasury > COLONY.build.importOfficeCost) return designImportOffice(state)
  // Spec 039 — a mature colony raises a Comptroller's Office so the treasury can ride a hard stretch on managed debt.
  if (state.colonists > 14 && countKind(state, 'comptroller') < 1 && state.components >= COLONY.build.compComptroller && state.treasury > COLONY.build.comptrollerCost) return designComptroller(state)
  // Spec 038 — a mature colony raises a Roster Office so the council can prioritise scarce labour by sector.
  if (state.colonists > 14 && countKind(state, 'roster') < 1 && state.components >= COLONY.build.compRoster) return designRoster(state)
  // Spec 026 — answer an outbreak: when fever climbs past the build line and no post contains it → raise a Fever Watch Post.
  if (state.outbreak > COLONY.build.feverBuildThreshold && state.components >= COLONY.build.compFeverWatch && countKind(state, 'feverwatch') < COLONY.build.maxFeverWatch) return designFeverWatch(state)
  // Spec 028 — keep the peace: when unrest climbs past the build line and no post patrols → raise a Ward Post.
  if (state.unrest > COLONY.build.unrestBuildThreshold && state.components >= COLONY.build.compWard && countKind(state, 'ward') < COLONY.build.maxWard) return designWard(state)
  // Spec 022 — keep the machinery running: a working building worn past the build line with no shed in reach → raise a Maintenance Shed.
  if (maintenanceUncovered(state) && state.components >= COLONY.build.compMaintShed && countKind(state, 'maintshed') < Math.ceil(state.buildings.filter(isWorking).length / COLONY.build.maintShedCovers)) return designMaintShed(state)
  // Spec 023 — make room before the surplus spills: a stockpile near its cap + components on hand → raise a Storehouse Platform.
  if (storageNearCap(state) && state.components >= COLONY.build.compStorehouse && countKind(state, 'storehouse') < COLONY.build.maxStorehouses) return designStorehouse(state)
  // Spec 024 — answer the bell: a building on fire/at-risk with too little response cover → raise an Emergency Bellhouse.
  if (colonyAtRisk(state) && state.components >= COLONY.build.compBellhouse && state.reels >= COLONY.build.reelBellhouse && countKind(state, 'bellhouse') < COLONY.build.maxBellhouses) return designBellhouse(state)
  const queuedGen = state.jobs.reduce((g, j) => g + j.artifact.powerGen, 0)
  // Spec 018 — buffer the grid first when brownout-prone and reels are spare: a Battery Shed (capped vs solar so solar still leads).
  if (inBrownout(state) && state.reels >= COLONY.build.reelBattery && state.components >= COLONY.build.compBattery && countKind(state, 'battery') < countKind(state, 'solar') + 1) return designBattery(state)
  // Spec 021 — keep the workers moving: when commute demand outruns capacity, raise a Skybridge Transit Depot.
  if (Math.min(state.colonists, state.totalJobs) > COLONY.build.transitBaseCapacity + countKind(state, 'transit') * COLONY.build.transitPerDepot && state.components >= COLONY.build.compTransit && countKind(state, 'transit') < 5) return designTransit(state)
  // Spec 045 — scale generation: when power-short and established (and components on hand), raise a Turbine Mast; else fall back to a cheap solar farm.
  if (state.power.loadW > (peakSupply(state) + queuedGen) * COLONY.build.powerHeadroom && state.colonists > 12 && state.components >= COLONY.build.compTurbine && countKind(state, 'turbine') < COLONY.build.maxTurbines) return designTurbine(state)
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
  if (state.spireBuilding) n += COLONY.build.spireStageCrew // spec 033 — a Spire stage ties up its crew
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
/** Spec 038 — the colony's labour sectors; every workplace kind belongs to exactly one. */
export type Sector = 'food' | 'services' | 'industry' | 'logistics' | 'safety' | 'trade' | 'civic'
const SECTOR_OF: Record<BuildKind, Sector> = {
  greenhouse: 'food', depot: 'food', water: 'food', cistern: 'food', seedloft: 'food',
  clinic: 'services', theatre: 'services', market: 'services', shrine: 'services', survey: 'services', commercial: 'services', school: 'services',
  mine: 'industry', workshop: 'industry', foundry: 'industry', skimmer: 'industry', weavery: 'industry', industrial: 'industry', folio: 'industry', toolcrib: 'industry',
  transit: 'logistics', maintshed: 'logistics', storehouse: 'logistics', solar: 'logistics', battery: 'logistics', turbine: 'logistics', surveycamp: 'logistics',
  bellhouse: 'safety', feverwatch: 'safety', ward: 'safety', stormwatch: 'safety', scrubber: 'safety',
  exchange: 'trade', import: 'trade',
  levy: 'civic', payoffice: 'civic', liaison: 'civic', academy: 'civic', mast: 'civic', hall: 'civic', feast: 'civic', comptroller: 'civic', roster: 'civic', census: 'civic', habitat: 'civic',
}
// Spec 038 — priority orders the Roster Office fills under a shortage. 'balanced' uses the uniform split (no order).
const ESSENTIALS_ORDER: Sector[] = ['food', 'safety', 'services', 'civic', 'logistics', 'industry', 'trade']
const INDUSTRY_ORDER: Sector[] = ['industry', 'logistics', 'trade', 'civic', 'services', 'safety', 'food']

/** Spec 038 — total open jobs in one sector (sum of building jobs). */
function sectorDemand(state: ColonyState, sector: Sector): number {
  let d = 0
  for (const b of state.buildings) if (SECTOR_OF[b.artifact.kind] === sector) d += b.artifact.jobs
  return d
}

/** Spec 038 — labour priority bites only while a built, staffed Roster Office stands. */
export function rosterActive(state: ColonyState): boolean {
  if (countKind(state, 'roster') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 038 — a sector's staffing fraction (0..1). Default (no Roster Office, or Balanced mode, or no shortage) is the
 *  uniform min(1, colonists/totalJobs) the colony has always used — so existing play is unchanged. With a staffed office in
 *  a priority mode AND a labour shortage, high-priority sectors fill to full first and the rest absorb the shortfall. */
export function sectorStaffing(state: ColonyState, sector: Sector): number {
  const D = state.totalJobs
  if (D <= 0) return 0
  const uniform = Math.min(1, state.colonists / D)
  if ((state.rosterMode ?? 'balanced') === 'balanced' || !rosterActive(state)) return uniform
  if (state.colonists >= D) return 1 // no shortage: everyone is placed, priority is moot
  const order = state.rosterMode === 'essentials' ? ESSENTIALS_ORDER : INDUSTRY_ORDER
  let remaining = state.colonists
  for (const sec of order) {
    const demand = sectorDemand(state, sec)
    const assigned = Math.min(remaining, demand)
    if (sec === sector) return demand > 0 ? assigned / demand : uniform
    remaining -= assigned
  }
  return uniform
}

/** Spec 038 — Roster readout for the HUD: whether labour priority is live, and the council's mode. */
export function rosterStatus(state: ColonyState): { active: boolean; mode: 'essentials' | 'balanced' | 'industry' } {
  return { active: rosterActive(state), mode: state.rosterMode ?? 'balanced' }
}

/** Spec 002 — staffed mines extract materials into the stockpile; output scales with global staffing. */
function produceMaterials(state: ColonyState, dtMin: number): void {
  const frac = dtMin / (24 * 60)
  const staffing = sectorStaffing(state, 'industry') // spec 038 — labour priority can starve or favour Industry under a shortage
  let gen = 0
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'mine' || b.incident) continue // spec 024 — a mine mid-incident digs nothing
    gen += b.artifact.materialsGen * maintFactor(b) * veinFactor(b) // spec 022/052 — a worn mine, or one whose vein has run down, digs less
    if (b.vein !== undefined && staffing > 0) b.vein = Math.max(0, b.vein - staffing * frac) // spec 052 — a staffed, producing mine spends its vein; an idle one holds
  }
  if (gen <= 0) return
  state.materials += gen * staffing * healthFactor(state) * powerFactor(state) * transitFactor(state) * feverFactor(state) * orderFactor(state) * toolSupplyFactor(state) * frac // spec 009/017/021/026/028/047 — sick, brownout, congested, fevered, restless or tool-starved mines dig less
}

/** Spec 052 — a mine's own output multiplier as its vein runs down: full until half-dug, then fading by bands to a 25% floor.
 *  Undefined vein (a fresh fixture or seed mine) reads as full, so the materials economy is unchanged until a vein actually thins. */
export function veinFactor(b: ColonyBuilding): number {
  if (b.artifact.kind !== 'mine' || b.vein === undefined) return 1
  const f = b.vein / COLONY.build.veinLifeDays
  if (f >= 0.5) return 1
  if (f >= 0.375) return 0.8
  if (f >= 0.25) return 0.6
  if (f >= 0.125) return 0.4
  return COLONY.build.veinFloor // an old pit is a poor pit, but never a dead one
}

/** Spec 052 — Vein readout for the HUD: how many mines, and the band of the poorest (most-depleted) pit. */
export function veinStatus(state: ColonyState): { mines: number; poorest: number } {
  let mines = 0
  let poorest = 1
  for (const b of state.buildings) if (b.artifact.kind === 'mine') { mines++; const f = veinFactor(b); if (f < poorest) poorest = f }
  return { mines, poorest }
}

/** Spec 020 — how well the advanced trades are staffed by skilled workers: full at the cap, 0.6 floor when untrained. */
function skillFactor(state: ColonyState): number {
  const advancedNeed = (countKind(state, 'workshop') + countKind(state, 'foundry')) * COLONY.build.skilledPerAdvanced
  if (advancedNeed <= 0) return 1
  return 0.6 + 0.4 * Math.min(1, Math.min(state.colonists, state.skilled) / advancedNeed)
}

/** Spec 021 — commute: a congested colony (more workers than transit can carry) slows ALL its production. */
function transitFactor(state: ColonyState): number {
  const capacity = COLONY.build.transitBaseCapacity + countKind(state, 'transit') * COLONY.build.transitPerDepot
  const demand = Math.min(state.colonists, state.totalJobs)
  if (demand <= capacity) return 1
  return Math.max(COLONY.build.transitCongestedFloor, capacity / demand)
}

/** Spec 021 — commute demand (workers) vs capacity (base + Transit Depots), for the HUD. */
export function commute(state: ColonyState): { demand: number; capacity: number; congested: boolean } {
  const capacity = COLONY.build.transitBaseCapacity + countKind(state, 'transit') * COLONY.build.transitPerDepot
  const demand = Math.min(state.colonists, state.totalJobs)
  return { demand, capacity, congested: demand > capacity }
}

/** Spec 022 — only working buildings (anything that employs a crew) wear; homes and passive kit don't. */
function isWorking(b: ColonyBuilding): boolean {
  return b.artifact.jobs > 0
}

/** Spec 022 — a worn building's own output multiplier: 1 until the healthy threshold, ramping to the floor at full wear. */
function maintFactor(b: ColonyBuilding): number {
  const wear = b.wear ?? 0
  const th = COLONY.build.wearHealthyThreshold
  if (wear <= th) return 1
  const t = (wear - th) / (1 - th) // 0 at the threshold → 1 at fully worn
  return Math.max(COLONY.build.maintFloor, 1 - t * (1 - COLONY.build.maintFloor))
}

/** Spec 022 — every working building accrues wear as it runs; a staffed Maintenance Shed in range repairs it. */
function maintenanceStep(state: ColonyState, dtMin: number): void {
  const frac = dtMin / (24 * 60)
  const sheds = state.buildings.filter((b) => b.artifact.kind === 'maintshed')
  const staffed = sheds.length > 0 && (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
  for (const b of state.buildings) {
    if (!isWorking(b)) continue
    let wear = (b.wear ?? 0) + COLONY.build.wearPerDay * frac
    if (staffed && sheds.some((s) => Math.hypot(s.x - b.x, s.y - b.y) <= COLONY.build.maintRadius)) {
      wear -= COLONY.build.repairPerDay * frac * toolSupplyFactor(state) // spec 047 — fitters with no tools mend slower
    }
    b.wear = Math.max(0, Math.min(1, wear))
  }
}

/** Spec 022 — upkeep readout for the HUD: worst wear across working buildings + how many need a fitter. */
export function maintenanceStatus(state: ColonyState): { worstWear: number; needing: number; sheds: number } {
  let worstWear = 0
  let needing = 0
  for (const b of state.buildings) {
    if (!isWorking(b)) continue
    const w = b.wear ?? 0
    if (w > worstWear) worstWear = w
    if (w > COLONY.build.wearHealthyThreshold) needing++
  }
  return { worstWear, needing, sheds: countKind(state, 'maintshed') }
}

/** Spec 022 — true when some working building has worn past the build threshold and no shed covers it yet. */
function maintenanceUncovered(state: ColonyState): boolean {
  const sheds = state.buildings.filter((b) => b.artifact.kind === 'maintshed')
  return state.buildings.some(
    (b) => isWorking(b) && (b.wear ?? 0) > COLONY.build.wearBuildThreshold && !sheds.some((s) => Math.hypot(s.x - b.x, s.y - b.y) <= COLONY.build.maintRadius),
  )
}

/** Spec 023 — per-resource storage cap = the founders' hold + what each Storehouse Platform adds. */
export function storageCaps(state: ColonyState): { materials: number; components: number; food: number; reels: number; fibre: number; linen: number; folios: number } {
  const n = countKind(state, 'storehouse')
  return {
    materials: COLONY.build.storeBaseMaterials + n * COLONY.build.storePerMaterials,
    components: COLONY.build.storeBaseComponents + n * COLONY.build.storePerComponents,
    food: COLONY.build.storeBaseFood + n * COLONY.build.storePerFood,
    reels: COLONY.build.storeBaseReels + n * COLONY.build.storePerReels,
    fibre: COLONY.build.storeBaseFibre + n * COLONY.build.storePerFibre, // spec 031
    linen: COLONY.build.storeBaseLinen + n * COLONY.build.storePerLinen, // spec 031
    folios: COLONY.build.storeBaseFolios + n * COLONY.build.storePerFolios, // spec 044
  }
}

/** Spec 023 — clamp every stockpile to its cap; the overflow is lost (spilled, spoiled, written off). */
function clampStorage(state: ColonyState): void {
  const cap = storageCaps(state)
  if (state.materials > cap.materials) state.materials = cap.materials
  if (state.components > cap.components) state.components = cap.components
  if (state.food > cap.food) state.food = cap.food
  if (state.reels > cap.reels) state.reels = cap.reels
  if ((state.fibre ?? 0) > cap.fibre) state.fibre = cap.fibre // spec 031
  if ((state.linen ?? 0) > cap.linen) state.linen = cap.linen // spec 031
  if ((state.folios ?? 0) > cap.folios) state.folios = cap.folios // spec 044
}

/** Spec 023 — storage readout for the HUD: fullest stockpile (0..1), whether it's overflowing, and which. */
export function storageStatus(state: ColonyState): { fill: number; full: boolean; tightest: string } {
  const cap = storageCaps(state)
  const items: [string, number, number][] = [
    ['materials', state.materials, cap.materials],
    ['components', state.components, cap.components],
    ['food', state.food, cap.food],
    ['reels', state.reels, cap.reels],
    ['fibre', state.fibre ?? 0, cap.fibre], // spec 031
    ['linen', state.linen ?? 0, cap.linen], // spec 031
    ['folios', state.folios ?? 0, cap.folios], // spec 044
  ]
  let fill = 0
  let tightest = 'materials'
  for (const [name, v, c] of items) {
    const f = c > 0 ? v / c : 0
    if (f > fill) {
      fill = f
      tightest = name
    }
  }
  return { fill, full: fill >= 0.999, tightest }
}

/** Spec 023 — true when any stockpile has climbed past the build threshold of its cap (time for a platform). */
function storageNearCap(state: ColonyState): boolean {
  const cap = storageCaps(state)
  const th = COLONY.build.storeBuildThreshold
  return state.materials > cap.materials * th || state.components > cap.components * th || state.food > cap.food * th || state.reels > cap.reels * th
}

/** Spec 024 — a building's incident hazard (per day). Zero unless it is BOTH worn past the threshold AND the
 *  colony is stressed (brownout or congestion) — so a healthy, calm colony is incident-free. */
function buildingHazard(state: ColonyState, b: ColonyBuilding): number {
  const wear = b.wear ?? 0
  if (wear < COLONY.build.hazardWearThreshold) return 0
  if (!inBrownout(state) && !commute(state).congested) return 0
  return COLONY.build.hazardBasePerDay * ((wear - COLONY.build.hazardWearThreshold) / (1 - COLONY.build.hazardWearThreshold))
}

/** Spec 024 — concurrent incidents the colony's staffed Emergency Bellhouses can answer at once. */
function bellhouseCapacity(state: ColonyState): number {
  const bells = countKind(state, 'bellhouse')
  if (bells === 0) return 0
  const staffed = (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
  return staffed ? bells * COLONY.build.bellhouseCrews : 0
}

/** Spec 024 — which stockpile a building's incident destroys (a mine cave-in spills materials, a workshop fire components, …). */
function incidentResource(kind: BuildKind): 'materials' | 'components' | 'food' | 'reels' {
  if (kind === 'mine') return 'materials'
  if (kind === 'foundry') return 'reels'
  if (kind === 'greenhouse') return 'food'
  return 'components' // workshops and the goods-handling services
}

/** Spec 024 — incidents strike worn, stressed buildings; staffed Bellhouses resolve them, or they hit a
 *  consequence: the building is left worn-out and a chunk of one stockpile is destroyed. */
function incidentStep(state: ColonyState, dtMin: number): void {
  // 1) advance the active incidents; the first `capacity` (by build order) are attended, the rest are not.
  const active = state.buildings.filter((b) => b.incident)
  if (active.length > 0) {
    const capacity = bellhouseCapacity(state)
    active.forEach((b, i) => {
      const inc = b.incident!
      inc.timer -= dtMin
      if (inc.timer > 0) return
      if (i < capacity) {
        // a crew reached it in time — the building recovers, carrying a little wear from the scare
        b.wear = Math.min(1, (b.wear ?? 0) + COLONY.build.incidentResolveWearBump)
      } else {
        // nobody answered — severe damage and lost goods
        b.wear = 1
        const loss = COLONY.build.incidentGoodsLoss
        const res = incidentResource(b.artifact.kind)
        if (res === 'materials') state.materials = Math.max(0, state.materials - state.materials * loss)
        else if (res === 'components') state.components = Math.max(0, state.components - state.components * loss)
        else if (res === 'food') state.food = Math.max(0, state.food - state.food * loss)
        else state.reels = Math.max(0, state.reels - state.reels * loss)
      }
      b.incident = undefined
      b.hazardAccum = 0
    })
  }
  // 2) accumulate hazard on worn, stressed buildings; strike a new incident when it crosses the trigger.
  const frac = dtMin / (24 * 60)
  for (const b of state.buildings) {
    if (!isWorking(b) || b.incident) continue
    const hz = buildingHazard(state, b)
    if (hz <= 0) {
      b.hazardAccum = 0
      continue
    }
    b.hazardAccum = (b.hazardAccum ?? 0) + hz * frac
    if (b.hazardAccum >= COLONY.build.hazardTrigger) {
      b.incident = { timer: COLONY.build.incidentMin }
      b.hazardAccum = 0
    }
  }
}

/** Spec 024 — incident readout for the HUD: how many crises are active vs the colony's response capacity. */
export function incidentStatus(state: ColonyState): { active: number; capacity: number } {
  let active = 0
  for (const b of state.buildings) if (b.incident) active++
  return { active, capacity: bellhouseCapacity(state) }
}

/** Spec 024 — true when a building is on fire/collapsing or is a worn, stressed tinderbox (time for a Bellhouse). */
function colonyAtRisk(state: ColonyState): boolean {
  return state.buildings.some((b) => b.incident || (isWorking(b) && buildingHazard(state, b) > 0))
}

/** Spec 025 — the household levy bites only while a built, staffed Levy Office stands (else the colony runs flat). */
export function levyActive(state: ColonyState): boolean {
  if (countKind(state, 'levy') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 025 — daily income multiplier from the levy rate (1.0 when inert: normal, or no staffed office). */
function levyIncomeFactor(state: ColonyState): number {
  if (!levyActive(state)) return 1
  if (state.levyRate === 'low') return COLONY.build.levyIncomeLow
  if (state.levyRate === 'high') return COLONY.build.levyIncomeHigh
  return 1
}

/** Spec 025 — immigration desirability multiplier from the levy rate (1.0 when inert). */
function levyDesirabilityFactor(state: ColonyState): number {
  if (!levyActive(state)) return 1
  if (state.levyRate === 'low') return COLONY.build.levyDesireLow
  if (state.levyRate === 'high') return COLONY.build.levyDesireHigh
  return 1
}

/** Spec 025 — levy readout for the HUD: whether it's in force, and the current rate the council has set. */
export function levyStatus(state: ColonyState): { active: boolean; rate: 'low' | 'normal' | 'high' } {
  return { active: levyActive(state), rate: state.levyRate }
}

/** Spec 026 — the Fever Watch contains outbreaks only while a built, staffed post stands. */
export function feverWatchActive(state: ColonyState): boolean {
  if (countKind(state, 'feverwatch') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 026 — fever pressure: the PRODUCT of low health coverage, crowding, and an environmental stressor
 *  (smog or brownout). All three must be present — a well-served, uncrowded, clean colony has zero pressure. */
function feverPressure(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat').length
  if (habs === 0) return 0
  const lowHealth = 1 - healthFraction(state) // 0 when every home has a clinic, 1 when none do
  if (lowHealth <= 0) return 0
  const cap = housingCapacity(state)
  const occupancy = cap > 0 ? state.colonists / cap : 0
  const th = COLONY.build.feverCrowdThreshold
  const crowding = occupancy <= th ? 0 : Math.min(1, (occupancy - th) / (1 - th)) // only a packed colony feeds the fever
  if (crowding <= 0) return 0
  const env = Math.max(pollutedFraction(state), inBrownout(state) ? 1 : 0) // smog OR a brownout
  if (env <= 0) return 0
  return lowHealth * crowding * env
}

/** Spec 026 — advance the outbreak: it spreads under sustained pressure, recovers when eased, and a staffed
 *  Fever Watch Post drives it down hard (quarantine + response teams). */
function feverStep(state: ColonyState, dtMin: number): void {
  const frac = dtMin / (24 * 60)
  let o = state.outbreak ?? 0
  if (feverWatchActive(state)) {
    o -= COLONY.build.feverContainPerDay * frac // contained — the curve bends down
  } else {
    o += COLONY.build.feverSpreadPerDay * feverPressure(state) * frac // spreads while the colony stays sick
    o -= COLONY.build.feverRecoverPerDay * frac // some natural recovery
  }
  state.outbreak = Math.max(0, Math.min(COLONY.build.feverMax, o))
}

/** Spec 026 — production multiplier from the outbreak: sick crews are slow. Clinics (009) soften the severity. */
function feverFactor(state: ColonyState): number {
  const o = state.outbreak ?? 0
  if (o <= 0) return 1
  const severity = COLONY.build.feverPenalty * (1 - COLONY.build.feverClinicRelief * healthFraction(state))
  return Math.max(COLONY.build.feverFloor, 1 - o * severity)
}

/** Spec 026 — outbreak readout for the HUD: the share unwell (0..1) and whether a Fever Watch is containing it. */
export function feverStatus(state: ColonyState): { outbreak: number; contained: boolean } {
  return { outbreak: state.outbreak ?? 0, contained: feverWatchActive(state) }
}

/** Spec 028 — a Ward Post keeps order only while a built, staffed post stands. */
export function wardActive(state: ColonyState): boolean {
  if (countKind(state, 'ward') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 028 — unrest pressure: high unemployment compounded with a real squeeze — a hard levy (025) or a brownout
 *  (017). Both must be present, so a well-run, employed colony at a normal levy is never restless. */
function unrestPressure(state: ColonyState): number {
  if (state.colonists < COLONY.build.unrestMinPop) return 0
  const employed = Math.min(state.colonists, state.totalJobs)
  const jobless = state.colonists > 0 ? (state.colonists - employed) / state.colonists : 0
  const unemployment = Math.max(0, (jobless - COLONY.build.unrestJoblessThreshold) / (1 - COLONY.build.unrestJoblessThreshold))
  if (unemployment <= 0) return 0
  const hardship = Math.max(levyActive(state) && state.levyRate === 'high' ? 1 : 0, inBrownout(state) ? 1 : 0, lowWageBites(state) ? 1 : 0) // spec 029 — a low wage is a squeeze too
  if (hardship <= 0) return 0
  return Math.min(1, unemployment * hardship)
}

/** Spec 028 — advance unrest: it rises under a sustained squeeze on the idle, calms when eased, and a staffed Ward
 *  Post drives it down (wardens on patrol). */
function unrestStep(state: ColonyState, dtMin: number): void {
  const frac = dtMin / (24 * 60)
  let u = state.unrest ?? 0
  if (wardActive(state)) {
    u -= COLONY.build.wardCalmPerDay * frac // wardens hold the line
  } else {
    u += COLONY.build.unrestSpreadPerDay * unrestPressure(state) * frac // disorder spreads while idle + squeezed
    u -= COLONY.build.unrestRecoverPerDay * frac // some natural calming
    if (generousWage(state)) u -= COLONY.build.wageGenerousCalmPerDay * frac // spec 029 — generous wages buy loyalty
  }
  if (feasting(state)) u -= COLONY.build.feastUnrestReliefPerDay * frac // spec 030 — a feast lifts spirits, easing unrest even mid-squeeze
  if (liaisonActive(state) && (state.standing ?? 0.5) < COLONY.build.lowStandingThreshold) u += COLONY.build.standingUnrestPerDay * frac // spec 032 — disrepute breeds reputational unrest
  if (spireComplete(state)) u -= COLONY.build.spireUnrestReliefPerDay * frac // spec 033 — pride in the great work calms the colony
  if (foundersHallActive(state)) u -= COLONY.build.foundersUnrestRelief * frac // spec 035 — pride in who built this steadies the colony
  const solace = solaceCoverage(state)
  if (solace > 0) u -= COLONY.build.solaceCalmPerDay * solace * frac // spec 037 — consoled homes fray slower under a squeeze
  if (arrearsStrain(state)) u += COLONY.build.arrearsUnrestPerDay * frac // spec 039 — a treasury deep in the red squeezes the colony
  state.unrest = Math.max(0, Math.min(COLONY.build.unrestMax, u))
}

/** Spec 028 — production multiplier from unrest: vandalism and work slowdowns sap the colony's output. */
function orderFactor(state: ColonyState): number {
  const u = state.unrest ?? 0
  if (u <= 0) return 1
  return Math.max(COLONY.build.unrestProductionFloor, 1 - u * COLONY.build.unrestProductionPenalty)
}

/** Spec 028 — order readout for the HUD: the unrest level (0..1) and whether a Ward Post is keeping the peace. */
export function unrestStatus(state: ColonyState): { unrest: number; warded: boolean } {
  return { unrest: state.unrest ?? 0, warded: wardActive(state) }
}

/** Spec 029 — wages are paid only while a built, staffed Pay Office stands (else labour is free, as before). */
export function payOfficeActive(state: ColonyState): boolean {
  if (countKind(state, 'payoffice') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 029 — payroll multiplier from the wage rate (1.0 at standard). */
function wagePayrollFactor(state: ColonyState): number {
  if (state.wageRate === 'low') return COLONY.build.wageLowFactor
  if (state.wageRate === 'generous') return COLONY.build.wageGenerousFactor
  return 1
}

/** Spec 029 — the colony's daily payroll: employed workers × the per-worker wage × the rate (0 with no staffed office). */
export function payrollPerDay(state: ColonyState): number {
  if (!payOfficeActive(state)) return 0
  const employed = Math.min(state.colonists, state.totalJobs)
  return employed * COLONY.build.wagePerWorkerPerDay * wagePayrollFactor(state)
}

/** Spec 029 — immigration desirability multiplier from the wage rate (1.0 when inert). */
function wageDesirabilityFactor(state: ColonyState): number {
  if (!payOfficeActive(state)) return 1
  if (state.wageRate === 'low') return COLONY.build.wageDesireLow
  if (state.wageRate === 'generous') return COLONY.build.wageDesireGenerous
  return 1
}

/** Spec 029 — true when a staffed Pay Office is paying a low wage (a hardship that feeds unrest, like a hard levy). */
function lowWageBites(state: ColonyState): boolean {
  return payOfficeActive(state) && state.wageRate === 'low'
}

/** Spec 029 — true when a staffed Pay Office is paying a generous wage (loyal workers — eases unrest). */
function generousWage(state: ColonyState): boolean {
  return payOfficeActive(state) && state.wageRate === 'generous'
}

/** Spec 029 — wage readout for the HUD: whether it's in force, the rate, and the current daily payroll. */
export function wageStatus(state: ColonyState): { active: boolean; rate: 'low' | 'standard' | 'generous'; payroll: number } {
  return { active: payOfficeActive(state), rate: state.wageRate, payroll: Math.round(payrollPerDay(state)) }
}

/** Spec 030 — a Feast Deck can only host while it is built and staffed. */
export function feastDeckActive(state: ColonyState): boolean {
  if (countKind(state, 'feast') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 030 — true while a Civic Feast is running. */
export function feasting(state: ColonyState): boolean {
  return (state.feastTimer ?? 0) > 0
}

/** Spec 030 — could the council call a feast right now? (staffed deck, none running, treasury + supplies on hand). */
export function canCallFeast(state: ColonyState): boolean {
  return (
    !feasting(state) &&
    feastDeckActive(state) &&
    state.treasury >= COLONY.build.feastTreasuryCost &&
    state.food >= COLONY.build.feastFoodCost &&
    state.components >= COLONY.build.feastWaresCost
  )
}

/** Spec 030 — fund a Founding Feast: spend treasury + rations + housewares up front and start the morale window. */
export function callFeast(state: ColonyState): boolean {
  if (!canCallFeast(state)) return false
  state.treasury -= COLONY.build.feastTreasuryCost
  state.food -= COLONY.build.feastFoodCost
  state.components -= COLONY.build.feastWaresCost
  state.feastTimer = COLONY.build.feastDurationDays * 24 * 60
  return true
}

/** Spec 030 — run the feast clock: count down an active feast, or auto-throw one for a wealthy, restless colony. */
function feastStep(state: ColonyState, dtMin: number): void {
  if (feasting(state)) {
    state.feastTimer = Math.max(0, (state.feastTimer ?? 0) - dtMin)
    return
  }
  // Auto-call: a staffed deck + a treasury comfortably above the cost + restless people → the colony feasts itself.
  if (
    feastDeckActive(state) &&
    (state.unrest ?? 0) > COLONY.build.feastAutoUnrestThreshold &&
    state.treasury > COLONY.build.feastTreasuryCost * COLONY.build.feastAutoTreasuryMargin &&
    state.food >= COLONY.build.feastFoodCost &&
    state.components >= COLONY.build.feastWaresCost
  ) {
    callFeast(state)
  }
}

/** Spec 030 — feast readout for the HUD: whether one runs, days left, and whether the council could call one. */
export function feastStatus(state: ColonyState): { active: boolean; daysLeft: number; canCall: boolean } {
  return { active: feasting(state), daysLeft: Math.ceil((state.feastTimer ?? 0) / (24 * 60)), canCall: canCallFeast(state) }
}

type RequestGood = 'components' | 'linen' | 'reels' | 'food'

/** Spec 032 — the Kookerverse only deals with the colony while a built, staffed Liaison Office stands. */
export function liaisonActive(state: ColonyState): boolean {
  if (countKind(state, 'liaison') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 032 — read/spend a stockpiled good by name. */
function goodStock(state: ColonyState, good: RequestGood): number {
  if (good === 'components') return state.components
  if (good === 'linen') return state.linen ?? 0
  if (good === 'reels') return state.reels
  return state.food
}
function spendGood(state: ColonyState, good: RequestGood, amount: number): void {
  if (good === 'components') state.components = Math.max(0, state.components - amount)
  else if (good === 'linen') state.linen = Math.max(0, (state.linen ?? 0) - amount)
  else if (good === 'reels') state.reels = Math.max(0, state.reels - amount)
  else state.food = Math.max(0, state.food - amount)
}
function requestQuota(good: RequestGood): number {
  if (good === 'components') return COLONY.build.reqAmountComponents
  if (good === 'linen') return COLONY.build.reqAmountLinen
  if (good === 'reels') return COLONY.build.reqAmountReels
  return COLONY.build.reqAmountFood
}

/** Spec 032 — the Kookerverse asks for the good the colony holds most of (so it's usually within reach). */
function makeRequest(state: ColonyState): { good: RequestGood; amount: number; deadline: number } {
  const goods: RequestGood[] = ['components', 'linen', 'reels', 'food']
  let best: RequestGood = 'components'
  let bestV = goodStock(state, best)
  for (const g of goods) {
    const v = goodStock(state, g)
    if (v > bestV) {
      bestV = v
      best = g
    }
  }
  return { good: best, amount: requestQuota(best), deadline: COLONY.build.requestDeadlineDays * 24 * 60 }
}

/** Spec 032 — dispatch the requested goods through the Bank: spend them and raise Kookerverse Standing. */
export function fulfillRequest(state: ColonyState): boolean {
  if (!state.request || !liaisonActive(state)) return false
  if (goodStock(state, state.request.good) < state.request.amount) return false
  spendGood(state, state.request.good, state.request.amount)
  state.standing = Math.min(1, (state.standing ?? 0.5) + COLONY.build.standingReward * (spireComplete(state) ? COLONY.build.spireStandingMult : 1) * (foundersHallActive(state) ? COLONY.build.foundersStandingMult : 1)) // spec 033/035 — the Beacon makes the world notice; the seated founders are a face to it
  state.request = null
  state.requestCooldown = COLONY.build.requestIntervalDays * 24 * 60
  return true
}

/** Spec 032 — advance the external relationship: issue requests, auto-fulfil or miss them at the deadline, drift standing. */
function requestStep(state: ColonyState, dtMin: number): void {
  const frac = dtMin / (24 * 60)
  if (!liaisonActive(state)) {
    const s = state.standing ?? 0.5 // no channel: standing drifts back toward neutral
    if (s > 0.5) state.standing = Math.max(0.5, s - COLONY.build.standingDriftPerDay * frac)
    else if (s < 0.5) state.standing = Math.min(0.5, s + COLONY.build.standingDriftPerDay * frac)
    return
  }
  if (state.request) {
    state.request.deadline -= dtMin
    if (state.request.deadline <= 0 && !fulfillRequest(state)) {
      state.standing = Math.max(0, (state.standing ?? 0.5) - COLONY.build.standingPenalty) // missed → standing falls
      state.request = null
      state.requestCooldown = COLONY.build.requestIntervalDays * 24 * 60
    }
    return
  }
  state.requestCooldown = (state.requestCooldown ?? 0) - dtMin
  if (state.requestCooldown <= 0) state.request = makeRequest(state)
}

/** Spec 032 — immigration desirability multiplier from standing (neutral 0.5 → 1.0; recognition draws settlers). */
function standingDesirabilityFactor(state: ColonyState): number {
  const s = state.standing ?? 0.5
  return COLONY.build.standingDesireLow + (COLONY.build.standingDesireHigh - COLONY.build.standingDesireLow) * s
}

/** Spec 032 — Kookerverse readout for the HUD: the channel, the standing, any open request, and whether it's affordable. */
export function liaisonStatus(state: ColonyState): { active: boolean; standing: number; request: { good: string; amount: number; daysLeft: number } | null; canFulfil: boolean } {
  const active = liaisonActive(state)
  const req = state.request
  return {
    active,
    standing: state.standing ?? 0.5,
    request: req ? { good: req.good, amount: req.amount, daysLeft: Math.ceil(req.deadline / (24 * 60)) } : null,
    canFulfil: !!(active && req && goodStock(state, req.good) >= req.amount),
  }
}

/** Spec 033 — the Horizon Spire is complete once all its stages stand. */
export function spireComplete(state: ColonyState): boolean {
  return (state.spireStage ?? 0) >= COLONY.build.spireStageCount
}

/** Spec 033 — the resource bundle a given Spire stage (0-indexed) demands. */
function spireStageBundle(stage: number): { treasury: number; materials: number; components: number; reels: number; linen: number } {
  return {
    treasury: COLONY.build.spireStageTreasury[stage] ?? 0,
    materials: COLONY.build.spireStageMaterials[stage] ?? 0,
    components: COLONY.build.spireStageComponents[stage] ?? 0,
    reels: COLONY.build.spireStageReels[stage] ?? 0,
    linen: COLONY.build.spireStageLinen[stage] ?? 0,
  }
}

/** Spec 033 — does the colony hold enough (at the given resource margin) to fund the next stage and spare its crew? */
function spireAfford(state: ColonyState, margin: number): boolean {
  const stage = state.spireStage ?? 0
  if (stage >= COLONY.build.spireStageCount || state.spireBuilding) return false
  const b = spireStageBundle(stage)
  return (
    state.treasury >= b.treasury &&
    state.materials >= b.materials * margin &&
    state.components >= b.components * margin &&
    state.reels >= b.reels * margin &&
    (state.linen ?? 0) >= b.linen * margin &&
    freeLabour(state) >= COLONY.build.spireStageCrew
  )
}

/** Spec 033 — fund and begin the next Spire stage: spend its bundle and reserve a crew for the long build. */
export function fundSpireStage(state: ColonyState): boolean {
  if (!spireAfford(state, 1)) return false
  const b = spireStageBundle(state.spireStage ?? 0)
  state.treasury -= b.treasury
  state.materials -= b.materials
  state.components -= b.components
  state.reels -= b.reels
  state.linen = Math.max(0, (state.linen ?? 0) - b.linen)
  state.spireBuilding = true
  state.spireProgress = 0
  return true
}

/** Spec 033 — advance the Spire: raise the active stage, or auto-fund the next when the colony has a true surplus. */
function spireStep(state: ColonyState, dtMin: number): void {
  if (state.spireBuilding) {
    state.spireProgress = (state.spireProgress ?? 0) + dtMin / (COLONY.build.spireStageBuildHours * 60)
    if (state.spireProgress >= 1) {
      state.spireStage = (state.spireStage ?? 0) + 1
      state.spireBuilding = false
      state.spireProgress = 0
    }
    return
  }
  // Auto-fund: a wealthy, established colony raises the Spire on its own — gated hard so it never starves the colony.
  if (
    state.colonists >= COLONY.build.spireStartColonists &&
    state.treasury >= spireStageBundle(state.spireStage ?? 0).treasury + COLONY.build.spireTreasuryMargin &&
    spireAfford(state, COLONY.build.spireSurplusMargin)
  ) {
    fundSpireStage(state)
  }
}

/** Spec 033 — Spire readout for the HUD: which stage, progress, whether it's rising, and whether it's finished. */
export function spireStatus(state: ColonyState): { stage: number; total: number; progress: number; building: boolean; complete: boolean } {
  return { stage: state.spireStage ?? 0, total: COLONY.build.spireStageCount, progress: state.spireProgress ?? 0, building: state.spireBuilding ?? false, complete: spireComplete(state) }
}

/** Spec 034 — the Stormwatch braces the colony only while a built, staffed shelter stands. */
export function stormwatchActive(state: ColonyState): boolean {
  if (countKind(state, 'stormwatch') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 035 — the Living Roster: the colony's real system-authors, each seated as a named colonist with a public post.
 *  Order = the order they joined the founding (spec authorship). New authors are added here as they propose. */
export const FOUNDERS: ReadonlyArray<{ name: string; role: string }> = [
  { name: 'Mara Venn', role: 'Works Marshal' }, // water, batteries, maintenance, storage — the infrastructure voice
  { name: 'Bram Teel', role: 'Exchange Warden' }, // the Skybridge Exchange (trade)
  { name: 'Niko Vance', role: 'Reel Foundryman' }, // the Reel Foundry (luxury good)
  { name: 'Lys Ardent', role: 'Hearth Warden' }, // homes + culture
  { name: 'Ravi Okondo', role: 'Water Steward' }, // life-support
  { name: 'Jalen Orro', role: 'Skybridge Engineer' }, // the spans
  { name: 'Echo Marlow', role: 'Signal Keeper' }, // the Broadcast Mast / Courier
  { name: 'Tessa Quill', role: 'Transit Dispatcher' }, // the Skybridge Transit Depots (and this Hall)
  { name: 'Jory Pell', role: 'Levy Clerk' }, // the Levy Office
  { name: 'Tavi Orro', role: 'Fever Warden' }, // the Fever Watch
  { name: 'Sella Brint', role: 'Market Packer' }, // the Housewares Market
  { name: 'Niko Darr', role: 'Ward Captain' }, // the Ward Post
  { name: 'Hessa Morn', role: 'Pay Clerk' }, // the Pay Office
  { name: 'Bren Kalo', role: 'Feast Steward' }, // the Civic Feast
]

/** Spec 035 — the Living Roster is seated only while a built, staffed Founders' Hall stands (else founders are signatures). */
export function foundersHallActive(state: ColonyState): boolean {
  if (countKind(state, 'hall') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

/** Spec 035 — the seated roster: the founders as named colonists (empty until a staffed Hall seats them). */
export function foundersRoster(state: ColonyState): ReadonlyArray<{ name: string; role: string }> {
  return foundersHallActive(state) ? FOUNDERS : []
}

/** Spec 035 — Founders' Hall readout for the HUD: whether the Roster is seated and how many founders it seats. */
export function foundersStatus(state: ColonyState): { active: boolean; seated: number; notable: { name: string; role: string } | null } {
  const active = foundersHallActive(state)
  return { active, seated: active ? FOUNDERS.length : 0, notable: active ? FOUNDERS[7] : null } // Tessa Quill, who raised the Hall
}

/** Spec 034 — the warning window before a front strikes — longer once the Spire's Sky Beacon (033) stands. */
function frontWarningWindow(state: ColonyState): number {
  return COLONY.build.frontWarningMin * (spireComplete(state) ? COLONY.build.spireBeaconWarnMult : 1)
}

/** Spec 034 — a Cloudsea Front strikes an established colony on a long cycle; a staffed Stormwatch braces the blow. */
function frontStep(state: ColonyState, dtMin: number): void {
  if (state.colonists < COLONY.build.frontMinColonists) return // the founding crew is never threatened — early play is calm
  state.frontTimer = (state.frontTimer ?? 0) - dtMin
  if (state.frontTimer > 0) return
  // IMPACT — damage scales with how ready the colony is: a staffed Stormwatch brings it down to the brace factor.
  const severity = stormwatchActive(state) ? COLONY.build.frontBraceFactor : 1
  state.materials = Math.max(0, state.materials - state.materials * COLONY.build.frontGoodsLoss * severity) // stored goods spoil
  state.components = Math.max(0, state.components - state.components * COLONY.build.frontGoodsLoss * severity)
  for (const b of state.buildings) {
    if (!isWorking(b)) continue
    b.wear = Math.min(1, (b.wear ?? 0) + COLONY.build.frontWearDamage * severity) // exposed buildings batter — the Maintenance Sheds (022) then matter
  }
  state.frontTimer = COLONY.build.frontIntervalDays * 24 * 60 // the next front, cycles away
}

/** Spec 034 — cloudsea-watch readout for the HUD: when the next front strikes, whether it's incoming/braced, and the watch. */
export function frontStatus(state: ColonyState): { timerDays: number; incoming: boolean; braced: boolean; watching: boolean; established: boolean } {
  const established = state.colonists >= COLONY.build.frontMinColonists
  const t = state.frontTimer ?? 0
  const incoming = established && t <= frontWarningWindow(state)
  const watching = stormwatchActive(state)
  return { timerDays: Math.max(0, Math.ceil(t / (24 * 60))), incoming, braced: incoming && watching, watching, established }
}

/** Spec 020 — staffed Skillhouse Academies train colonists into skilled workers, capped at the population. */
function academyStep(state: ColonyState, dtMin: number): void {
  const academies = countKind(state, 'academy')
  if (academies === 0) return
  const staffing = sectorStaffing(state, 'civic') // spec 038 — the Academy is Civic-sector labour
  if (staffing <= 0) return
  state.skilled = Math.min(state.colonists, state.skilled + academies * COLONY.build.academyTrainPerDay * staffing * (1 + COLONY.build.educationAcademyBonus * educationFraction(state)) * (dtMin / (24 * 60))) // spec 042 — a schooled populace learns the advanced trades faster
}

/** Spec 003 — staffed workshops consume materials and produce components (2:1); halt when materials run out. */
function produceComponents(state: ColonyState, dtMin: number): void {
  const eff = sectorStaffing(state, 'industry') * healthFactor(state) * powerFactor(state) * skillFactor(state) * transitFactor(state) * feverFactor(state) * orderFactor(state) * toolSupplyFactor(state) // spec 009/017/020/021/026/028/038/047 — sick, brownout, unskilled, congested, fevered, restless, sector-deprioritised or tool-starved workshops refine less
  if (eff <= 0) return
  const day = 24 * 60
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'workshop' || b.incident) continue // spec 024 — a workshop on fire refines nothing
    const mf = maintFactor(b) // spec 022 — a worn workshop refines less
    const need = COLONY.build.workshopMaterialsIn * eff * mf * (dtMin / day)
    if (need <= 0) continue
    const consume = Math.min(state.materials, need)
    if (consume <= 0) continue
    state.materials -= consume
    state.components += COLONY.build.workshopComponentsOut * eff * mf * (dtMin / day) * (consume / need)
  }
}

/** Spec 013 — staffed reel foundries consume components and produce reels (2:1); halt when components run out. */
function produceReels(state: ColonyState, dtMin: number): void {
  const eff = sectorStaffing(state, 'industry') * healthFactor(state) * powerFactor(state) * skillFactor(state) * transitFactor(state) * feverFactor(state) * orderFactor(state) // spec 009/017/020/021/026/028/038 — sick, brownout, unskilled, congested, fevered, restless or sector-deprioritised foundries weave less
  if (eff <= 0) return
  const day = 24 * 60
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'foundry' || b.incident) continue // spec 024 — a foundry mid-incident weaves nothing
    const mf = maintFactor(b) // spec 022 — a worn foundry weaves less
    const need = COLONY.build.foundryComponentsIn * eff * mf * (dtMin / day)
    if (need <= 0) continue
    const consume = Math.min(state.components, need)
    if (consume <= 0) continue
    state.components -= consume
    state.reels += COLONY.build.foundryReelsOut * eff * mf * (dtMin / day) * (consume / need)
  }
}

/** Spec 031 — staffed Flax Skimmer Docks gather skyflax fibre from the rims (the colony's second extractor). */
function produceFibre(state: ColonyState, dtMin: number): void {
  let gen = 0
  for (const b of state.buildings) if (b.artifact.kind === 'skimmer' && !b.incident) gen += (b.artifact.fibreGen ?? 0) * maintFactor(b)
  if (gen <= 0) return
  const staffing = sectorStaffing(state, 'industry') // spec 038 — Industry sector
  state.fibre += gen * staffing * healthFactor(state) * powerFactor(state) * transitFactor(state) * feverFactor(state) * orderFactor(state) * (dtMin / (24 * 60))
}

/** Spec 031 — staffed Weaveries weave fibre into linen bolts (2:1); halt when fibre runs out. */
function produceLinen(state: ColonyState, dtMin: number): void {
  const eff = sectorStaffing(state, 'industry') * healthFactor(state) * powerFactor(state) * transitFactor(state) * feverFactor(state) * orderFactor(state) // spec 038 — sick, brownout, congested, fevered, restless or sector-deprioritised weaveries weave less
  if (eff <= 0) return
  const day = 24 * 60
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'weavery' || b.incident) continue
    const mf = maintFactor(b)
    const need = COLONY.build.weaveryFibreIn * eff * mf * (dtMin / day)
    if (need <= 0) continue
    const consume = Math.min(state.fibre, need)
    if (consume <= 0) continue
    state.fibre -= consume
    state.linen += COLONY.build.weaveryLinenOut * eff * mf * (dtMin / day) * (consume / need)
  }
}

/** Spec 044 — staffed Folio Houses bind reels + linen (1:1) into skybound folios, the colony's signature finished export. */
function produceFolios(state: ColonyState, dtMin: number): void {
  const eff = sectorStaffing(state, 'industry') * healthFactor(state) * powerFactor(state) * transitFactor(state) * feverFactor(state) * orderFactor(state) // sick, brownout, congested, fevered, restless or sector-deprioritised binderies bind less
  if (eff <= 0) return
  const day = 24 * 60
  const cap = storageCaps(state).folios
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'folio' || b.incident) continue
    const headroom = Math.max(0, cap - (state.folios ?? 0))
    if (headroom <= 0) break // folio storage full
    const mf = maintFactor(b)
    const want = COLONY.build.foliosPerDay * eff * mf * (dtMin / day)
    // limited by reels AND linen (1 each) and storage headroom — stalls, never fails, when an input runs dry
    const made = Math.min(want, state.reels, state.linen ?? 0, headroom)
    if (made <= 0) continue
    state.reels -= made
    state.linen = (state.linen ?? 0) - made
    state.folios = (state.folios ?? 0) + made
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

/** Spec 027 — a home receives everyday wares when a Housewares Market is in reach AND the colony holds the goods
 *  (delivery is spatial, like the Ration Depot: in range + stock on hand). */
export function housewaresSupplied(state: ColonyState, home: ColonyBuilding): boolean {
  if (state.components <= 0) return false
  return nearBuildingKind(state, home, 'market', COLONY.build.marketRadius)
}

/** Spec 027 — a home receives luxury wares when it is wares-supplied AND the colony holds reels (the top tier needs these). */
export function luxurySupplied(state: ColonyState, home: ColonyBuilding): boolean {
  return housewaresSupplied(state, home) && state.reels > 0
}

/** Spec 027 — fraction of homes a market actually reaches with wares (in range, capped by market coverage), for the HUD + desirability. */
export function housewaresFraction(state: ColonyState): number {
  const habs = state.buildings.filter((b) => b.artifact.kind === 'habitat')
  if (!habs.length) return 0
  const markets = state.buildings.filter((b) => b.artifact.kind === 'market')
  if (!markets.length || state.components <= 0) return 0
  let inRange = 0
  for (const h of habs) if (markets.some((m) => Math.hypot(m.x - h.x, m.y - h.y) <= COLONY.build.marketRadius)) inRange++
  const capacity = markets.length * COLONY.build.marketHomes
  return Math.min(inRange, capacity) / habs.length
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
    const served = fullyServed(state, b) && luxurySupplied(state, b) && (state.linen ?? 0) > 0 // spec 015/027/031 — the whole stack, luxury wares, AND linen for the top tier
    // Climb: T1→T2 on water, T2→T3 on the full service stack + luxury wares — each step spends spare components.
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

/** Spec 041 — how badly the colony is failing its people right now (0 = served, 1 = wholly failed). Reads existing
 *  signals: liveability below the floor (thirst, hunger, sickness, no culture/wares) plus Treasury-Arrears strain. */
export function colonyDistress(state: ColonyState): number {
  if (countKind(state, 'habitat') === 0) return 0 // no homes → no one to fail
  const floor = COLONY.build.departureLiveabilityFloor
  const live = colonyLiveability(state)
  let d = floor > 0 ? Math.max(0, (floor - live) / floor) : 0 // ramps from 0 at the floor to 1 at zero liveability
  if (arrearsStrain(state)) d = Math.max(d, COLONY.build.departureArrearsDistress) // missed wages bite on their own
  return Math.min(1, d)
}

/** Spec 041 — the dominant reason a colony is shedding people, for the Courier headline + HUD. */
export function departureCause(state: ColonyState): string {
  const terms: [string, number][] = [
    ['thirst', 1 - wateredFraction(state)],
    ['hunger', 1 - provisionedFraction(state)],
    ['sickness', 1 - healthFraction(state)],
    ['unrest', state.unrest ?? 0],
    ['unpaid wages', arrearsStrain(state) ? 1 : 0],
  ]
  let best = terms[0]!
  for (const t of terms) if (t[1] > best[1]) best = t
  return best[0]
}

/** Spec 041 — emigration: sustained failure makes households pack up and leave. Pressure rises only while distress
 *  persists (over days) and drains fast once homes are served, so brief shortages never punish. At the threshold a
 *  household departs — population falls toward the founding crew and a one-off standing dip marks the exodus. */
function departureStep(state: ColonyState, dtMin: number): void {
  const frac = dtMin / (24 * 60)
  let p = state.departurePressure ?? 0
  const distress = colonyDistress(state)
  if (countKind(state, 'habitat') === 0 || state.colonists <= COLONY.seed.colonists) {
    state.departurePressure = Math.max(0, p - COLONY.build.departureDrainPerDay * frac) // nothing to lose → bleed off
    return
  }
  if (distress > 0) p += COLONY.build.departureRisePerDay * distress * frac // failed homes fray, slowly
  else p -= COLONY.build.departureDrainPerDay * frac // served homes settle
  if (p >= 1) {
    // a household takes the next mooring out
    const leave = Math.min(COLONY.build.departureHouseholdSize, state.colonists - COLONY.seed.colonists)
    state.colonists = Math.max(COLONY.seed.colonists, state.colonists - leave)
    state.standing = Math.max(0, (state.standing ?? 0.5) - COLONY.build.exodusStandingHit) // the wider world notices an exodus
    p -= 1 // one threshold spent; sustained failure sheds more
  }
  state.departurePressure = Math.max(0, Math.min(1.5, p))
}

/** Spec 041 — departures readout for the HUD: the pressure (0..1), whether households are at risk of leaving, and why. */
export function departureStatus(state: ColonyState): { pressure: number; atRisk: boolean; cause: string } {
  const pressure = state.departurePressure ?? 0
  const atRisk = pressure > 0.5 && colonyDistress(state) > 0
  return { pressure, atRisk, cause: departureCause(state) }
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
  const desirability = Math.max(0.25, wateredFraction(state)) * fedFactor * tierFactor * cultureFactor * levyDesirabilityFactor(state) * (1 - (state.outbreak ?? 0) * COLONY.build.feverEmigrationWeight) * (1 + COLONY.build.waresDesirabilityBonus * housewaresFraction(state)) * (1 - (state.unrest ?? 0) * COLONY.build.unrestDesirabilityWeight) * wageDesirabilityFactor(state) * (feasting(state) ? 1 + COLONY.build.feastDesirabilityBonus : 1) * standingDesirabilityFactor(state) * (spireComplete(state) ? COLONY.build.spireImmigrationBonus : 1) * (foundersHallActive(state) ? COLONY.build.foundersDesirabilityBonus : 1) * (1 + COLONY.build.solaceDesirabilityBonus * solaceCoverage(state)) * (arrearsStrain(state) ? COLONY.build.arrearsStrainDesirabilityFactor : 1) * (1 + COLONY.build.educationDesirabilityBonus * educationFraction(state)) * prosperityDesirabilityFactor(state) // spec 025/026/027/028/029/030/032/033/035/037/039/042/040 — levy, outbreak, stocked homes, unrest, wages, a feast, Kookerverse standing, the Spire, named founders, a consoled colony, a colony deep in arrears, a schooled colony, and a high-Prosperity colony all pull on who comes and stays
  if (state.colonists < cap) state.colonists = Math.min(cap, state.colonists + COLONY.build.immigrationPerDay * desirability * confidenceImmigrationFactor(state) * perDay) // spec 049 — arrivals also follow the colony's Settler Confidence (a healthy colony sits at the plateau, so this is 1; deep distress slows it, terrible distress halts it)
}

/** Spec 049 — Settler Confidence in [0,1]: how willing free colonists are to risk coming, read from the colony's visible
 *  conditions. Survival shortfalls (hunger, thirst) weigh light — a frontier still draws people, and water/food already gate
 *  immigration through desirability — while civic failure (unrest, arrears, stingy wages) weighs heavy. Each signal is neutral
 *  (no distress) when its subsystem is absent, so a young or minimal colony stays confident and immigrates exactly as today. */
export function settlerConfidence(state: ColonyState): number {
  const homes = countKind(state, 'habitat')
  const fedReach = countKind(state, 'depot') > 0 ? provisionedFraction(state) : (state.food > 0 ? 1 : 0)
  const hunger = homes > 0 ? Math.max(0, 1 - fedReach) : 0 // young colony with no homes → no hunger distress
  const thirst = homes > 0 ? Math.max(0, 1 - wateredFraction(state)) : 0
  const disorder = Math.min(1, Math.max(0, state.unrest ?? 0)) // spec 028
  const insolvency = arrearsStrain(state) ? 1 : 0 // spec 039
  const ws = wageStatus(state) // spec 029 — neutral with no Pay Office
  const wageGap = ws.active ? (ws.rate === 'low' ? 1 : ws.rate === 'standard' ? 0.3 : 0) : 0
  const c = 1
    - COLONY.build.confHungerWeight * hunger
    - COLONY.build.confThirstWeight * thirst
    - COLONY.build.confUnrestWeight * disorder
    - COLONY.build.confArrearsWeight * insolvency
    - COLONY.build.confWageWeight * wageGap
  return Math.max(0, Math.min(1, c))
}

/** Spec 049 — map Confidence to the immigration-rate multiplier: 1 at or above the plateau (unchanged from today), ramping down
 *  to 0 at or below the stop threshold (immigration halts while beds sit empty), linear between. */
export function confidenceImmigrationFactor(state: ColonyState): number {
  const c = settlerConfidence(state)
  const plateau = COLONY.build.confPlateau
  const stop = COLONY.build.confStop
  if (c >= plateau) return 1
  if (c <= stop) return 0
  return (c - stop) / (plateau - stop)
}

/** Spec 049 — Confidence readout for the HUD: the rating as a percentage, the live arrival multiplier, and whether arrivals are
 *  merely slowed or fully halted. */
export function confidenceStatus(state: ColonyState): { confidence: number; factor: number; slowed: boolean; halted: boolean } {
  const factor = confidenceImmigrationFactor(state)
  return { confidence: settlerConfidence(state), factor, slowed: factor < 1, halted: factor <= 0 }
}

/** Spec 050 — how stable the homes are for raising children, in [0,1]: watered x fed x calm. Drives the birth rate, and below the
 *  neglect threshold drains the pool. 1 when there are no homes, so an empty colony is trivially stable (and breeds nothing). */
function birthStability(state: ColonyState): number {
  const watered = wateredFraction(state) // 1 with no homes
  const fed = countKind(state, 'depot') > 0 ? provisionedFraction(state) : ((state.food ?? 0) > 0 ? 1 : 0)
  const calm = Math.max(0, 1 - (state.unrest ?? 0) / COLONY.build.birthCalmUnrest)
  return Math.max(0, Math.min(1, watered * fed * calm))
}

/** Spec 050 — homes able to raise a child (mid-tier or better). */
function birthableHomes(state: ColonyState): number {
  let n = 0
  for (const b of state.buildings) if (b.artifact.kind === 'habitat' && (b.tier ?? 1) >= COLONY.build.birthMinTier) n++
  return n
}

/** Spec 050 — Children readout for the HUD: the dependents pool, the homes able to raise them, and whether the colony grows its own. */
export function birthStatus(state: ColonyState): { children: number; homes: number; growing: boolean } {
  const children = state.children ?? 0
  const homes = birthableHomes(state)
  return { children: Math.round(children), homes, growing: homes > 0 || children >= 0.5 }
}

/** Spec 050 — raise children in stable mid-tier homes, mature them into colonists on a housing vacancy, and drain the pool under
 *  neglect. Inert with no mid-tier home and no children, so a young or tier-1 colony is unchanged. */
function birthStep(state: ColonyState, dtMin: number): void {
  const homes = birthableHomes(state)
  let children = state.children ?? 0
  if (homes === 0 && children <= 0) return // inert — nothing breeds and nothing to raise
  const frac = dtMin / (24 * 60)
  const stability = birthStability(state)
  const cap = Math.max(0, state.colonists * COLONY.build.childrenMaxFraction) // dependents never dwarf the workforce
  if (stability >= COLONY.build.birthNeglectStability) {
    // Births — stable mid-tier homes slowly add to the pool (scaled by how good conditions are), never past the cap.
    if (homes > 0 && children < cap) children = Math.min(cap, children + homes * COLONY.build.birthRatePerHomePerDay * stability * frac)
    // Maturation — with a housing vacancy, children grow up into free colonists, filling beds like an immigrant would.
    const room = housingCapacity(state) - state.colonists
    if (room > 0 && children > 0) {
      const mature = Math.min(children, children * COLONY.build.childMatureFraction * frac, room)
      children -= mature
      state.colonists += mature
    }
  } else {
    // Neglect — poor conditions drain the pool: growth you do not sustain is growth you lose.
    children = Math.max(0, children - children * COLONY.build.childNeglectDrainPerDay * frac)
  }
  state.children = Math.max(0, children)
}

/** Spec 051 — how far out the colony may build: the base footprint plus one ring per completed Outer Claim (capped). With no
 *  claims this is exactly COLONY.build.maxBlockRadius, so the buildable area is unchanged until a Survey Camp claims ground. */
export function effectiveBuildRadius(state: ColonyState): number {
  return COLONY.build.maxBlockRadius + Math.min(state.claims ?? 0, COLONY.build.maxClaims)
}

/** Spec 051 — Footprint readout for the HUD: the effective build radius, claims made / allowed, and the current survey progress. */
export function footprintStatus(state: ColonyState): { radius: number; claims: number; maxClaims: number; progress: number; camp: boolean; atEdge: boolean } {
  const claims = Math.min(state.claims ?? 0, COLONY.build.maxClaims)
  return { radius: effectiveBuildRadius(state), claims, maxClaims: COLONY.build.maxClaims, progress: state.claimProgress ?? 0, camp: countKind(state, 'surveycamp') > 0, atEdge: claims >= COLONY.build.maxClaims }
}

/** Spec 051 — advance the current Outer Claim: a staffed, powered Survey Camp surveys the next ring over several days, then spends
 *  materials + components to lay the boundary and widen the footprint. Inert with no camp; holds at the cap and when unpaid. */
function claimStep(state: ColonyState, dtMin: number): void {
  const camps = state.buildings.filter((b) => b.artifact.kind === 'surveycamp').length
  if (camps === 0) return // inert — no camp, no claims
  if ((state.claims ?? 0) >= COLONY.build.maxClaims) { state.claimProgress = 0; return } // frontier maxed — nothing left to claim
  const staffing = state.totalJobs > 0 ? Math.min(1, state.colonists / state.totalJobs) : 0
  if (staffing <= 0) return // an unstaffed camp makes no progress (the frontier holds)
  const frac = dtMin / (24 * 60)
  let progress = (state.claimProgress ?? 0) + camps * (1 / COLONY.build.claimWorkDays) * staffing * powerFactor(state) * frac // a brownout slows the survey
  if (progress >= 1) {
    // Survey done — lay the new boundary if the colony can pay; else hold at full (the frontier does not move on credit).
    if (state.materials >= COLONY.build.matPerClaim && state.components >= COLONY.build.compPerClaim) {
      state.materials -= COLONY.build.matPerClaim
      state.components -= COLONY.build.compPerClaim
      state.claims = (state.claims ?? 0) + 1
      progress = 0
    } else {
      progress = 1
    }
  }
  state.claimProgress = progress
}

/** Spec 005 — services (water hubs) consume a trickle of components to run. */
function serviceUpkeep(state: ColonyState, dtMin: number): void {
  let upkeep = 0 // components (water/depot/clinic/theatre)
  let matUpkeep = 0 // materials (spec 011 — the survey office burns sensors/supplies)
  let reelUpkeep = 0 // reels (spec 014 — theatres burn reels as show media)
  let linenUpkeep = 0 // linen (spec 031 — clinics use it as bandage cloth, more in a fever)
  for (const b of state.buildings) {
    if (b.artifact.kind === 'water') upkeep += COLONY.build.waterHubMaintCompPerDay
    else if (b.artifact.kind === 'depot') upkeep += COLONY.build.depotMaintCompPerDay
    else if (b.artifact.kind === 'clinic') {
      upkeep += COLONY.build.clinicMaintCompPerDay
      linenUpkeep += COLONY.build.clinicLinenPerDay * (1 + (state.outbreak ?? 0) * (COLONY.build.clinicLinenFeverMult - 1)) // spec 031 — more dressings during an outbreak
    }
    else if (b.artifact.kind === 'theatre') {
      upkeep += COLONY.build.theatreMaintCompPerDay
      reelUpkeep += COLONY.build.theatreReelsPerDay
    } else if (b.artifact.kind === 'survey') matUpkeep += COLONY.build.surveyMaintMatPerDay
    else if (b.artifact.kind === 'battery') upkeep += COLONY.build.batteryMaintCompPerDay
    else if (b.artifact.kind === 'scrubber') upkeep += COLONY.build.scrubberMaintCompPerDay
    else if (b.artifact.kind === 'maintshed') upkeep += COLONY.build.maintShedMaintCompPerDay // spec 022 — spare parts
    else if (b.artifact.kind === 'storehouse') upkeep += COLONY.build.storehouseMaintCompPerDay // spec 023 — logistics
    else if (b.artifact.kind === 'bellhouse') upkeep += COLONY.build.bellhouseMaintCompPerDay // spec 024 — foam/alarm upkeep
    else if (b.artifact.kind === 'levy') upkeep += COLONY.build.levyMaintCompPerDay // spec 025 — ledger supply
    else if (b.artifact.kind === 'feverwatch') upkeep += COLONY.build.feverWatchMaintCompPerDay // spec 026 — medical supply
    else if (b.artifact.kind === 'market') {
      upkeep += COLONY.build.marketWaresCompPerDay // spec 027 — everyday wares delivered to homes (components)
      reelUpkeep += COLONY.build.marketLuxuryReelsPerDay // spec 027 — luxury wares delivered (reels)
    } else if (b.artifact.kind === 'ward') upkeep += COLONY.build.wardMaintCompPerDay // spec 028 — patrol supply
    else if (b.artifact.kind === 'payoffice') upkeep += COLONY.build.payOfficeMaintCompPerDay // spec 029 — ledger supply
    else if (b.artifact.kind === 'feast') upkeep += COLONY.build.feastDeckMaintCompPerDay // spec 030 — deck upkeep
    else if (b.artifact.kind === 'liaison') upkeep += COLONY.build.liaisonMaintCompPerDay // spec 032 — dispatch supply
    else if (b.artifact.kind === 'stormwatch') upkeep += COLONY.build.stormwatchMaintCompPerDay // spec 034 — watch supply
    else if (b.artifact.kind === 'hall') upkeep += COLONY.build.hallMaintCompPerDay // spec 035 — archive + roster upkeep
    else if (b.artifact.kind === 'census') upkeep += COLONY.build.censusMaintCompPerDay // spec 040 — survey + ledger supply
    else if (b.artifact.kind === 'import') upkeep += COLONY.build.importOfficeMaintCompPerDay // spec 036 — office + dispatch supply
    else if (b.artifact.kind === 'shrine') linenUpkeep += COLONY.build.shrineLinenPerDay // spec 037 — prayer flags + memorial wraps (linen)
    else if (b.artifact.kind === 'comptroller') upkeep += COLONY.build.comptrollerMaintCompPerDay // spec 039 — ledger + audit supply
    else if (b.artifact.kind === 'roster') upkeep += COLONY.build.rosterMaintCompPerDay // spec 038 — roster + dispatch supply
  }
  if (upkeep > 0) state.components = Math.max(0, state.components - upkeep * (dtMin / (24 * 60)))
  if (matUpkeep > 0) state.materials = Math.max(0, state.materials - matUpkeep * (dtMin / (24 * 60)))
  if (reelUpkeep > 0) state.reels = Math.max(0, state.reels - reelUpkeep * (dtMin / (24 * 60)))
  if (linenUpkeep > 0) state.linen = Math.max(0, (state.linen ?? 0) - linenUpkeep * (dtMin / (24 * 60))) // spec 031
}

/** Spec 007 — staffed greenhouses grow food (boosted near a Water Hub); colonists eat a little each day. */
function foodStep(state: ColonyState, dtMin: number): void {
  const day = 24 * 60
  const staffing = sectorStaffing(state, 'food') * healthFactor(state) * powerFactor(state) * transitFactor(state) * feverFactor(state) * orderFactor(state) * toolSupplyFactor(state) * seedSupplyFactor(state) // spec 009/017/021/026/028/038/047/048 — sick, brownout, congested, fevered, restless, sector-deprioritised, tool-starved or seed-starved greenhouses grow less
  let grown = 0
  for (const b of state.buildings) {
    if (b.artifact.kind !== 'greenhouse' || b.incident) continue // spec 024 — a blighted greenhouse grows nothing
    const boost = nearWater(state, b.x, b.y) ? COLONY.build.greenhouseWaterBoost : 1
    grown += COLONY.build.greenhouseFoodPerDay * boost * staffing * maintFactor(b) // spec 022 — a worn greenhouse grows less
  }
  state.food += grown * (dtMin / day)
  state.food = Math.max(0, state.food - (state.colonists + (state.children ?? 0) * COLONY.build.childDependentLoad) * COLONY.build.foodPerColonistPerDay * (dtMin / day)) // spec 050 — children are extra mouths (half a ration each) before they are hands
}

/** Spec 012 — a staffed Skybridge Exchange exports SURPLUS goods (above a reserve) for treasury each day. */
/** Spec 036 — the goods the Import Office can buy (materials is importable here even though the Exchange never sells it). */
export type ImportGood = 'materials' | 'components' | 'food' | 'linen' | 'reels'
export const IMPORT_GOODS: ImportGood[] = ['materials', 'components', 'food', 'linen', 'reels']

/** Spec 036 — the Import Office buys only while built and staffed (else the order sits idle, no goods land). */
export function importOfficeActive(state: ColonyState): boolean {
  if (countKind(state, 'import') === 0) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}

function importStock(state: ColonyState, good: ImportGood): number {
  if (good === 'materials') return state.materials
  if (good === 'components') return state.components
  if (good === 'food') return state.food
  if (good === 'linen') return state.linen ?? 0
  return state.reels
}
function importCap(state: ColonyState, good: ImportGood): number {
  return storageCaps(state)[good]
}
function addImportGood(state: ColonyState, good: ImportGood, amount: number): void {
  if (good === 'materials') state.materials += amount
  else if (good === 'components') state.components += amount
  else if (good === 'food') state.food += amount
  else if (good === 'linen') state.linen = (state.linen ?? 0) + amount
  else state.reels += amount
}

/** Spec 036 — spend treasury to land the order good, throttled by office capacity × staffing, storage headroom, and treasury. */
function importStep(state: ColonyState, dtMin: number): void {
  const good = state.importOrder
  if (!good || !importOfficeActive(state)) return // no order, or no staffed office → the money loop is unchanged
  const price = COLONY.build.importPrice[good]
  if (price <= 0) return
  const offices = countKind(state, 'import')
  const staffing = sectorStaffing(state, 'trade') // spec 038 — the Import Office is Trade-sector labour
  if (staffing <= 0) return
  const frac = dtMin / (24 * 60)
  const byCapacity = offices * COLONY.build.importPerDay * staffing * frac // understaffed → proportionally less
  const headroom = Math.max(0, importCap(state, good) - importStock(state, good)) // a full store stops the delivery
  const byTreasury = Math.max(0, state.treasury) / price // can't buy what the bank can't cover
  const units = Math.min(byCapacity, headroom, byTreasury)
  if (units <= 0) return
  state.treasury -= units * price
  addImportGood(state, good, units)
}

/** Spec 036 — Import Office readout for the HUD: whether it is buying, the order good, and the daily units + spend. */
export function importStatus(state: ColonyState): { active: boolean; order: ImportGood | null; perDay: number; dailySpend: number } {
  const active = importOfficeActive(state)
  const good = state.importOrder ?? null
  const offices = countKind(state, 'import')
  const staffing = sectorStaffing(state, 'trade') // spec 038 — Trade sector
  const perDay = active && good ? offices * COLONY.build.importPerDay * staffing : 0
  const dailySpend = good ? perDay * COLONY.build.importPrice[good] : 0
  return { active, order: good, perDay: Math.round(perDay), dailySpend: Math.round(dailySpend) }
}

/** Spec 039 — does a Comptroller's Office stand? (built; lets the treasury hold a deficit even if momentarily unstaffed). */
export function comptrollerExists(state: ColonyState): boolean {
  return countKind(state, 'comptroller') > 0
}
/** Spec 039 — is the debt desk staffed? (clerks keep the arrears managed; unstaffed, interest doubles). */
export function comptrollerActive(state: ColonyState): boolean {
  if (!comptrollerExists(state)) return false
  return (state.totalJobs > 0 ? state.colonists / state.totalJobs : 0) > 0
}
/** Spec 039 — the colony's outstanding debt (0 when solvent). */
export function colonyDebt(state: ColonyState): number {
  return state.treasury < 0 ? -state.treasury : 0
}
/** Spec 039 — under arrears strain once the debt passes half the ceiling: settlers slow and unrest creeps. */
export function arrearsStrain(state: ColonyState): boolean {
  return comptrollerExists(state) && colonyDebt(state) > COLONY.build.debtCeiling * COLONY.build.arrearsStrainFraction
}
/** Spec 039 — bind the treasury to its floor: 0 with no office, -debtCeiling with one (the deficit the desk allows). */
function clampTreasury(state: ColonyState): void {
  const floor = comptrollerExists(state) ? -COLONY.build.debtCeiling : 0
  if (state.treasury < floor) state.treasury = floor
}
/** Spec 039 — Arrears readout for the HUD: the office, the debt, its ceiling, and the strain / unmanaged flags. */
export function arrearsStatus(state: ColonyState): { office: boolean; debt: number; ceiling: number; strain: boolean; unmanaged: boolean } {
  const office = comptrollerExists(state)
  const debt = colonyDebt(state)
  return { office, debt: Math.round(debt), ceiling: COLONY.build.debtCeiling, strain: arrearsStrain(state), unmanaged: office && debt > 0 && !comptrollerActive(state) }
}

function tradeStep(state: ColonyState, dtMin: number): void {
  const exchanges = countKind(state, 'exchange')
  if (exchanges === 0) return
  const staffing = sectorStaffing(state, 'trade') // spec 038 — the Exchange is Trade-sector labour
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
  // Spec 044 — skybound folios are the colony's signature finished export, sold at a premium above reels.
  const folioSell = Math.min(Math.max(0, (state.folios ?? 0) - COLONY.build.folioReserve), exchanges * COLONY.build.folioCapPerDay * staffing * frac)
  if (folioSell > 0) {
    state.folios = (state.folios ?? 0) - folioSell
    state.treasury += folioSell * COLONY.build.folioPrice
  }
}

/** Spec 012 — current export income rate ($/day) the Exchanges would earn at this surplus + staffing (HUD). */
export function tradeExportRate(state: ColonyState): number {
  const exchanges = countKind(state, 'exchange')
  if (exchanges === 0) return 0
  const staffing = sectorStaffing(state, 'trade') // spec 038 — Trade sector (readout mirrors tradeStep)
  if (staffing <= 0) return 0
  const compSell = Math.min(Math.max(0, state.components - COLONY.build.tradeComponentReserve), exchanges * COLONY.build.tradeComponentCapPerDay * staffing)
  const foodSell = Math.min(Math.max(0, state.food - COLONY.build.tradeFoodReserve), exchanges * COLONY.build.tradeFoodCapPerDay * staffing)
  const reelSell = Math.min(Math.max(0, state.reels - COLONY.build.reelReserve), exchanges * COLONY.build.reelCapPerDay * staffing)
  const folioSell = Math.min(Math.max(0, (state.folios ?? 0) - COLONY.build.folioReserve), exchanges * COLONY.build.folioCapPerDay * staffing) // spec 044
  return compSell * COLONY.build.tradeComponentPrice + foodSell * COLONY.build.tradeFoodPrice + reelSell * COLONY.build.reelPrice + folioSell * COLONY.build.folioPrice
}

export function stepBuild(state: ColonyState, rng: RNG, dtMin: number): void {
  toolStep(state, dtMin) // spec 047 — make/draw tool-kits first so every tooled producer + the fitters read this step's rack
  maintenanceStep(state, dtMin) // spec 022 — accrue/repair wear first so producers read current condition
  incidentStep(state, dtMin) // spec 024 — crises strike, get answered, or hit their consequence (paused buildings won't produce below)
  feverStep(state, dtMin) // spec 026 — the outbreak spreads or is contained; producers below read the current fever
  unrestStep(state, dtMin) // spec 028 — unrest rises or is calmed; producers + income below read the current order
  feastStep(state, dtMin) // spec 030 — count down an active feast, or auto-throw one for a wealthy, restless colony
  requestStep(state, dtMin) // spec 032 — the Kookerverse issues/judges Civic Requests; standing drifts without an office
  spireStep(state, dtMin) // spec 033 — raise the Horizon Spire stage by stage when the colony can spare the surplus
  frontStep(state, dtMin) // spec 034 — count down to the next Cloudsea Front; strike (braced or not) at impact
  produceMaterials(state, dtMin)
  produceFibre(state, dtMin) // spec 031 — gather skyflax fibre (the second extractor)
  academyStep(state, dtMin)
  produceComponents(state, dtMin)
  produceReels(state, dtMin)
  produceLinen(state, dtMin) // spec 031 — weave fibre into linen (the second refinery)
  produceFolios(state, dtMin) // spec 044 — bind reels + linen into skybound folios (the top-of-chain export)
  waterStep(state, dtMin) // spec 046 — condense + draw stored water (runs before housing/immigration read wateredFraction)
  serviceUpkeep(state, dtMin)
  seedStep(state, dtMin) // spec 048 — dry food (+ water) into seed-stock, then let skyfarms draw it, before foodStep reads seedSupplyFactor
  foodStep(state, dtMin)
  housingStep(state, dtMin)
  immigration(state, dtMin)
  departureStep(state, dtMin) // spec 041 — sustained failure sheds households; runs right after immigration so the net is arrivals minus departures
  birthStep(state, dtMin) // spec 050 — stable mid-tier homes raise children that mature into colonists (reads tiers + vacancy after housing/immigration)
  claimStep(state, dtMin) // spec 051 — a staffed Survey Camp advances the next Outer Claim and widens the build footprint
  tradeStep(state, dtMin)
  importStep(state, dtMin) // spec 036 — the buying side: spend treasury to land the order good (capped by storage headroom below)
  clampStorage(state) // spec 023 — finite storage: production past a cap is lost (after all goods are produced/sold)
  for (let i = state.jobs.length - 1; i >= 0; i--) {
    const j = state.jobs[i]!
    j.progress += dtMin / j.artifact.buildTimeMin
    if (j.progress >= 1) {
      const nb: ColonyBuilding = { id: j.id, x: j.x, y: j.y, artifact: j.artifact }
      if (j.artifact.kind === 'habitat') { nb.tier = 1; nb.dryMin = 0 } // spec 006 — homes start at tier 1
      if (j.artifact.kind === 'mine') nb.vein = COLONY.build.veinLifeDays // spec 052 — a freshly sunk shaft starts on a full vein
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
      if (a.kind === 'cistern') state.water = Math.min(waterTankCap(state), (state.water ?? 0) + COLONY.build.cisternTankCap * COLONY.build.cisternStartCharge) // spec 046 — a freshly built cistern starts its tank charged (no construction-day water crash)
      if (a.kind === 'toolcrib') state.tools = Math.min(toolStockCap(state), (state.tools ?? 0) + COLONY.build.toolStockCap * COLONY.build.toolStartCharge) // spec 047 — a freshly built crib starts its rack charged (no construction-day output crash)
      if (a.kind === 'seedloft') state.seed = Math.min(seedStockCap(state), (state.seed ?? 0) + COLONY.build.seedStockCap * COLONY.build.seedStartCharge) // spec 048 — a freshly built loft starts its bin charged (no construction-day harvest crash)
      state.jobs.splice(i, 1)
    }
  }

  if (state.clock.day > state.lastIncomeDay) {
    const days = state.clock.day - state.lastIncomeDay
    state.lastIncomeDay = state.clock.day
    const employed = Math.min(state.colonists, state.totalJobs)
    const rate = state.colonists > 0 ? employed / state.colonists : 0
    const pollutionPenalty = Math.min(0.3, state.pollution / COLONY.economy.pollutionPenaltyScale)
    const income = state.colonists * COLONY.economy.incomePerColonistPerDay * (0.6 + 0.4 * rate) * (1 - pollutionPenalty) * levyIncomeFactor(state) * (1 - (state.unrest ?? 0) * COLONY.build.unrestIncomeRefusal) // spec 025/028 — the levy rate scales the take; unrest refuses a slice of it
    const upkeep = state.buildings.length * COLONY.economy.buildingUpkeepPerDay + state.roads.length * COLONY.economy.roadUpkeepPerDay
    state.treasury += (income - upkeep - payrollPerDay(state)) * days // spec 029 — the colony pays its workers a daily wage
    if (state.treasury < 0) { // spec 039 — interest accrues on the deficit each payday, doubled while the debt desk is unstaffed (unmanaged arrears)
      const rate = COLONY.build.debtInterestPerPayday * (comptrollerActive(state) ? 1 : COLONY.build.debtUnmanagedMult)
      state.treasury += state.treasury * rate * days
    }
  }
  clampTreasury(state) // spec 039 — the debt floor binds: 0 with no Comptroller's Office, -debtCeiling with one

  if (state.clock.totalMinutes - state.lastGrowMin >= COLONY.build.growIntervalHours * 60) {
    state.lastGrowMin = state.clock.totalMinutes
    autoGrow(state, rng)
  }
}
