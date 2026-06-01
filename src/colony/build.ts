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

export type BuildKind = 'habitat' | 'commercial' | 'industrial' | 'solar'

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
}
export interface RoadCell {
  x: number
  y: number
}

const HAB_COLORS = [0xe6cda2, 0xd8b48a, 0xc9b08f, 0xb88a6a]
const COMMERCIAL_COLOR = 0x5fb6d8
const INDUSTRIAL_COLOR = 0xcf8b54
const SOLAR_COLOR = 0x18406a
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
  return { id: state.buildIds++, kind: 'habitat', color: HAB_COLORS[rng.int(0, HAB_COLORS.length - 1)]!, height: rng.range(0.8, 1.6), residents: COLONY.build.residentsPerHabitat, jobs: 0, powerLoad: COLONY.build.powerLoadPerHabitat, powerGen: 0, buildTimeMin: COLONY.build.buildTimeHours * 60, cost: COLONY.build.habitatCost, materialsCost: COLONY.build.matHabitat, crew: COLONY.build.crewHabitat }
}
function designWorkplace(state: ColonyState, rng: RNG): Artifact {
  const ind = rng.chance(0.45)
  return { id: state.buildIds++, kind: ind ? 'industrial' : 'commercial', color: ind ? INDUSTRIAL_COLOR : COMMERCIAL_COLOR, height: ind ? rng.range(0.9, 1.5) : rng.range(1.0, 1.8), residents: 0, jobs: ind ? COLONY.build.jobsPerIndustrial : COLONY.build.jobsPerCommercial, powerLoad: ind ? COLONY.build.industrialLoad : COLONY.build.commercialLoad, powerGen: 0, buildTimeMin: COLONY.build.workplaceBuildHours * 60, cost: ind ? COLONY.build.industrialCost : COLONY.build.commercialCost, materialsCost: ind ? COLONY.build.matIndustrial : COLONY.build.matCommercial, crew: COLONY.build.crewWork }
}
function designSolarFarm(state: ColonyState): Artifact {
  return { id: state.buildIds++, kind: 'solar', color: SOLAR_COLOR, height: 0.35, residents: 0, jobs: 0, powerLoad: 0, powerGen: COLONY.build.solarFarmOutput, buildTimeMin: COLONY.build.solarFarmBuildHours * 60, cost: COLONY.build.solarFarmCost, materialsCost: COLONY.build.matSolar, crew: COLONY.build.crewSolar }
}

function peakSupply(state: ColonyState): number {
  return COLONY.power.solarPeakW + state.powerGen
}
function chooseArtifact(state: ColonyState, rng: RNG): Artifact {
  const queuedGen = state.jobs.reduce((g, j) => g + j.artifact.powerGen, 0)
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
  if (free < COLONY.build.crewSolar || state.materials < COLONY.build.matSolar) return false

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
  if (free < artifact.crew) return false // not enough hands to raise it

  const c = caravan(state)
  state.parcels.push({ id: state.buildIds++, x: lot.x, y: lot.y })
  state.occupied.add(key(lot.x, lot.y))
  state.treasury -= artifact.cost
  state.materials -= artifact.materialsCost // consumed up front; crew reserved via the job until done
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
export function stepBuild(state: ColonyState, rng: RNG, dtMin: number): void {
  for (let i = state.jobs.length - 1; i >= 0; i--) {
    const j = state.jobs[i]!
    j.progress += dtMin / j.artifact.buildTimeMin
    if (j.progress >= 1) {
      state.buildings.push({ id: j.id, x: j.x, y: j.y, artifact: j.artifact })
      const a = j.artifact
      if (a.kind === 'solar') state.powerGen += a.powerGen
      else {
        state.colonists += a.residents
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
