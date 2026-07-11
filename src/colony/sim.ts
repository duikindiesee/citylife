// Colony simulation (Phase A): clock + day/night, and the off-grid solar→battery loop.
import { RNG } from "../engine/rng";
import { COLONY } from "./config";
import { Biome, Terrain } from "./terrain";
import { initBuild, stepBuild, turbinePower, solarSeasonFactor } from "./build";
import type {
  ColonyBuilding,
  ConstructionJob,
  Parcel,
  RoadCell,
  RoadKind,
} from "./build";
import { updateTraffic } from "./traffic";
import type { Car } from "./traffic";
import type { Settler } from "./settlers";
import {
  createTarentaalFlock,
  stepTarentaalFlock,
  type TarentaalBird,
} from "./tarentaal";
import { createVisualArtifacts, type VisualArtifact } from "./artifacts";
import { createLedger, type Ledger } from "./ledger";
import type { CityPlan } from "./cityPlan";
import type { Neighborhood } from "./neighborhood";
import type { CommercialDistrict } from "./commerce/district";
import type { RaceState } from "./racing/race";
import type { RoadWay } from "./render/roadRibbon";
import type { CarSpec } from "./car/carSpec";

export type StructureKind =
  | "caravan"
  | "solar"
  | "battery"
  | "rocket"
  | "lighthouse"
  | "rally";
export interface SeedStructure {
  kind: StructureKind;
  x: number;
  y: number;
}

export interface LighthousePlacementOptions {
  anchor?: { x: number; y: number };
  landmarkAnchor?: { x: number; y: number };
  landmarkRadius?: number;
  used?: readonly { x: number; y: number }[];
  maxRadius?: number;
}

/** Founders' Lighthouse: a deterministic shore marker for the founders' bay.
 *  It first tries the Rockery Beach headland, then falls back to dry buildable shore. */
export function findFoundersLighthouseSite(
  terrain: Terrain,
  options: LighthousePlacementOptions = {},
): { x: number; y: number } | null {
  const anchor = options.anchor ?? terrain.landing;
  const landmarkAnchor = options.landmarkAnchor ?? {
    x: Math.round(anchor.x - terrain.size * 0.36),
    y: Math.round(anchor.y - terrain.size * 0.09),
  };
  const landmarkRadius =
    options.landmarkRadius ?? Math.max(42, COLONY.world.coastSearch * 4);
  const used = options.used ?? [];
  const usedSet = new Set(used.map((p) => `${p.x},${p.y}`));
  const maxRadius =
    options.maxRadius ??
    Math.max(96, Math.min(180, Math.round(terrain.size * 0.25)));
  const coastLimit = COLONY.world.coastSearch;
  const usedClear = (x: number, y: number): boolean => {
    for (const u of used)
      if (Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) <= 6) return false;
    return !usedSet.has(`${x},${y}`);
  };
  const footprintClear = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (!terrain.inBounds(nx, ny)) return false;
        if (terrain.isWater(nx, ny)) return false;
        if (terrain.buildable[terrain.idx(nx, ny)] === 0) return false;
      }
    }
    return true;
  };
  const waterExposure = (x: number, y: number): number => {
    let n = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx,
          ny = y + dy;
        if (terrain.inBounds(nx, ny) && terrain.isWater(nx, ny)) n++;
      }
    }
    return n;
  };
  const pickBest = (
    center: { x: number; y: number },
    radius: number,
  ): { x: number; y: number } | null => {
    let best: { x: number; y: number; score: number } | null = null;
    for (
      let y = Math.max(1, center.y - radius);
      y <= Math.min(terrain.size - 2, center.y + radius);
      y++
    ) {
      for (
        let x = Math.max(1, center.x - radius);
        x <= Math.min(terrain.size - 2, center.x + radius);
        x++
      ) {
        const dCenter = Math.hypot(x - center.x, y - center.y);
        if (dCenter > radius) continue;
        if (!usedClear(x, y)) continue;
        if (!footprintClear(x, y)) continue;
        const i = terrain.idx(x, y);
        const dWater = terrain.distToWater[i]!;
        if (dWater <= 0 || dWater > coastLimit) continue;
        const biome = terrain.biome[i] as Biome;
        const shore = Math.max(0, coastLimit - Math.abs(dWater - 2));
        const beach = biome === Biome.Beach ? 28 : 0;
        const flat = terrain.buildable[i] === 2 ? 9 : 3;
        const dAnchor = Math.hypot(x - anchor.x, y - anchor.y);
        const dLandmark = Math.hypot(
          x - landmarkAnchor.x,
          y - landmarkAnchor.y,
        );
        const score =
          beach +
          shore * 3 +
          flat +
          waterExposure(x, y) * 0.6 -
          dLandmark * 1.05 -
          dAnchor * 0.02;
        if (
          !best ||
          score > best.score ||
          (score === best.score && (y < best.y || (y === best.y && x < best.x)))
        ) {
          best = { x, y, score };
        }
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  };
  return (
    pickBest(landmarkAnchor, landmarkRadius) ?? pickBest(anchor, maxRadius)
  );
}

export interface RallyPlacementOptions {
  anchor?: { x: number; y: number };
  used?: readonly { x: number; y: number }[];
  maxRadius?: number;
}

/** Spec 097 — the Rally Overlook: a deterministic HILLTOP with a commanding view of the colony,
 *  used as the race rendezvous point (a bus-stop on a hill). High ground that is road/walk-TRAVERSABLE
 *  (Highland — never Mountain or Peak, which pathfind cellOk rejects, so no spur road or guided walk
 *  could ever reach it), footprint-clear so a spur road can reach it, and kept within reach of the
 *  landing so it overlooks the city. Biased toward a knoll on the SHOULDER of rough ground (a saturating
 *  ruggedness term) — the neighborhood only raises homesteads on flat buildable land, so a rough-adjacent
 *  overlook keeps a clean, non-homestead approach for the R3.5 spur road instead of being walled in by
 *  houses. No Math.random — seed-deterministic. */
export function findRallyOverlookSite(
  terrain: Terrain,
  options: RallyPlacementOptions = {},
): { x: number; y: number } | null {
  const anchor = options.anchor ?? terrain.landing;
  const used = options.used ?? [];
  const usedSet = new Set(used.map((p) => `${p.x},${p.y}`));
  const maxRadius =
    options.maxRadius ??
    Math.max(60, Math.min(150, Math.round(terrain.size * 0.22)));
  const usedClear = (x: number, y: number): boolean => {
    for (const u of used)
      if (Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) <= 6) return false;
    return !usedSet.has(`${x},${y}`);
  };
  const footprintClear = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (!terrain.inBounds(nx, ny)) return false;
        if (terrain.isWater(nx, ny)) return false;
        // buildable === 0 is too steep to grade/reach — a connector road could never get there.
        if (terrain.buildable[terrain.idx(nx, ny)] === 0) return false;
        // Mountain / Peak are NOT traversable (pathfind cellOk rejects them), so neither a spur road
        // nor the guided walk could ever reach a rally placed on them — keep the whole footprint on
        // reachable high ground.
        const fb = terrain.biome[terrain.idx(nx, ny)];
        if (fb === Biome.Mountain || fb === Biome.Peak) return false;
      }
    }
    return true;
  };
  // Spec 097 R3.5 — flood-fill the land reachable from the landing over TRAVERSABLE cells (the same
  // rule pathfind cellOk uses: not Mountain / Peak / water / unbuildable). A rally on an isolated
  // Highland patch ringed by Mountain is useless — no spur road or guided walk could ever climb to it —
  // so only cells in this connected component qualify.
  const N2 = terrain.size;
  const trav = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= N2 || y >= N2) return false;
    const i = terrain.idx(x, y);
    if (terrain.buildable[i] === 0) return false;
    if (terrain.isWater(x, y)) return false;
    const b = terrain.biome[i];
    return (
      b !== Biome.Mountain &&
      b !== Biome.Peak &&
      b !== Biome.Ocean &&
      b !== Biome.Shallows
    );
  };
  const reachable = new Uint8Array(N2 * N2);
  let reachCount = 0;
  if (trav(anchor.x, anchor.y)) {
    const queue = [terrain.idx(anchor.x, anchor.y)];
    reachable[queue[0]!] = 1;
    reachCount = 1;
    for (let head = 0; head < queue.length; head++) {
      const ci = queue[head]!;
      const cx = ci % N2,
        cy = (ci / N2) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx,
          ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N2 || ny >= N2) continue;
        const ni = terrain.idx(nx, ny);
        if (reachable[ni] || !trav(nx, ny)) continue;
        reachable[ni] = 1;
        reachCount++;
        queue.push(ni);
      }
    }
  }
  const haveReachable = reachCount > 0;
  let best: { x: number; y: number; score: number } | null = null;
  const y0 = Math.max(1, anchor.y - maxRadius),
    y1 = Math.min(terrain.size - 2, anchor.y + maxRadius);
  const x0 = Math.max(1, anchor.x - maxRadius),
    x1 = Math.min(terrain.size - 2, anchor.x + maxRadius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - anchor.x, y - anchor.y);
      if (d > maxRadius) continue;
      if (!usedClear(x, y)) continue;
      if (!footprintClear(x, y)) continue;
      const i = terrain.idx(x, y);
      // must be connected to the colony road network, or the spur road / walk can never reach it
      if (haveReachable && !reachable[i]) continue;
      const biome = terrain.biome[i] as Biome;
      const elev = terrain.worldY(x, y);
      // want a commanding overlook on the highest REACHABLE ground — Highland (Mountain and Peak are
      // excluded by footprintClear because roads and the guided walk cannot traverse them).
      const biomeBonus =
        biome === Biome.Highland ? 18 : biome === Biome.Forest ? 6 : 0;
      // prominence: how much this cell stands above its surroundings (a true lookout, not a slope).
      let around = 0,
        n = 0;
      for (const [dx, dy] of [
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ] as const) {
        const nx = x + dx,
          ny = y + dy;
        if (terrain.inBounds(nx, ny)) {
          around += terrain.worldY(nx, ny);
          n++;
        }
      }
      const prominence = n ? elev - around / n : 0;
      // RUGGEDNESS — how much rough terrain (Mountain / Peak / too-steep-to-build) sits within a short
      // radius. The neighborhood only raises homesteads on flat buildable land, so a buildable knoll on
      // the SHOULDER of rough ground keeps a non-homestead side: the spur road (and the guided walk) get
      // a clean approach down to the colony instead of being walled in by houses. A flat overlook deep in
      // the buildable interior (ruggedness 0) gets ringed by homesteads and the spur fails soft. Biasing
      // toward rough-adjacent overlooks makes the rally both a truer lookout AND reliably road-connected.
      let rough = 0,
        ruggedTotal = 0;
      for (let ry = -6; ry <= 6; ry++) {
        for (let rx = -6; rx <= 6; rx++) {
          const nx = x + rx,
            ny = y + ry;
          if (!terrain.inBounds(nx, ny)) continue;
          ruggedTotal++;
          const ni = terrain.idx(nx, ny);
          const nb = terrain.biome[ni];
          if (
            nb === Biome.Mountain ||
            nb === Biome.Peak ||
            terrain.buildable[ni] < 2
          )
            rough++;
        }
      }
      const ruggedness = ruggedTotal ? rough / ruggedTotal : 0;
      // SATURATING bias (cap 0.15): a spot only needs SOME rough edge to qualify — beyond that there is
      // no extra reward, so the overlook is never dragged off high ground onto a low but maximally-rough
      // spot. Tuned over a 120-seed sweep: cap 0.15 weight 80 lifts the spur-connection rate while
      // keeping the average overlook elevation (a higher weight or cap collapsed elevation / regressed
      // seeds). Elevation stays the dominant term; ruggedness breaks the tie toward a mountain-shoulder.
      const score =
        elev * 1.2 +
        biomeBonus +
        prominence * 2.0 +
        Math.min(ruggedness, 0.15) * 80 -
        d * 0.06;
      if (
        !best ||
        score > best.score ||
        (score === best.score && (y < best.y || (y === best.y && x < best.x)))
      ) {
        best = { x, y, score };
      }
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export interface ColonyClock {
  totalMinutes: number;
  day: number;
  hour: number;
  minute: number;
  isDay: boolean;
  daylight: number; // 0..1
}

export interface ColonyState {
  name: string;
  terrain: Terrain;
  clock: ColonyClock;
  structures: SeedStructure[];
  power: {
    solarW: number;
    loadW: number;
    batteryWh: number;
    batteryCapWh: number;
  };
  colonists: number;
  // Phase B — construction
  treasury: number;
  materials: number; // spec 001 — build supplies; construction consumes these
  components: number; // spec 003 — refined goods produced by workshops from materials
  food: number; // spec 007 — grown by Skyfarm Greenhouses, eaten by colonists daily
  reels: number; // spec 013 — luxury good refined from components by Reel Foundries, exported for treasury
  skilled: number; // spec 020 — skilled workers trained by Skillhouse Academies; the advanced trades need them
  fibre: number; // spec 031 — skyflax fibre, the second raw resource, gathered from the rims by Skimmer Docks
  linen: number; // spec 031 — linen bolts, woven from fibre by Weaveries; the top tier + clinics need it
  folios: number; // spec 044 — skybound folios, the colony's signature finished export, bound from reels + linen by Folio Houses
  water: number; // spec 046 — stored water units (Mist Condenser Cisterns fill the tank; Water Hubs draw it); 0 until a cistern stands
  tools: number; // spec 047 — stored tool-kits (Tool Cribs make them; tooled workplaces draw them); 0 until a crib stands
  seed: number; // spec 048 — stored seed-stock (Seed Lofts dry it from food + water; skyfarms draw it); 0 until a loft stands
  children: number; // spec 050 — dependents being raised in mid-tier homes; cost food, give no labour, then mature into colonists; 0 until a birth
  claims: number; // spec 051 — completed Outer Claims; each adds one deck-ring to the effective build radius; 0 until a Survey Camp claims ground
  claimProgress: number; // spec 051 — work toward the next Outer Claim, 0..1 (a staffed Survey Camp advances it)
  lastFoundersYear: number; // spec 053 — the last colony-year whose turn has been accounted for (Founders' Day fires once per year)
  lastLedgerYear: number; // spec 055 — the last colony-year the Long Ledger has settled (natural turnover fires once per year)
  renewalThisYear: number; // spec 055 — colonists gained (arrivals + births) since the last year-turn, accumulating
  renewalLastYear: number; // spec 055 — the previous year's renewal; caps how many may pass this year
  lastPassings: number; // spec 055 — how many passed at the most recent year-turn (for the HUD)
  rimfish: number; // spec 056 — a second food netted from the cloudsea rim; spares skygrain when on hand; 0 until a Net Dock stands
  waste: number; // spec 058 — household waste burden [0,1]; occupied homes fill it slowly, Sanitation Posts clear it; harmless below 0.25
  dietSkyfarm?: number; // spec 060 — trailing-window tally of skyfarm meals served (decays); the ratio vs rimfish gives the recent diet mix
  dietRimfish?: number; // spec 060 — trailing-window tally of rimfish meals served (decays)
  dietShort?: number; // spec 060 — trailing-window tally of meals demanded but not served (empty larder); disqualifies the Varied Diet bonus
  dietStanding?: number; // spec 060 — 0..1 Varied Diet standing; 1 while a counter is operating on two foods, fades over varietyHoldDays when not
  driedFish: number; // spec 061 — dried rimfish, a shelf-stable food banked from surplus fresh rimfish by Drying Racks; eaten after fresh fish; 0 until a rack stands
  duskcap?: number; // spec 068 — duskcap, a hardy third food grown by Fungus Cellars on the dark decks; eaten as a third protein course; 0 until a Cellar stands
  hygiene?: number; // spec 069 — the colony's hygiene (0..1) from its Steam Bathhouses; slows how fast fever takes hold; 0 until a Bathhouse stands
  registryPenalty?: number; // spec 062 — Prosperity-Rank steps subtracted for chronic unemployment while a staffed Labour Registry stands (0/1/2); sticky until cleared
  unempHighDays?: number; // spec 062 — consecutive days unemployment has sat above the high line (drives the -1)
  unempSevereDays?: number; // spec 062 — consecutive days unemployment has sat above the severe line (drives the -2)
  unempClearDays?: number; // spec 062 — consecutive days unemployment has sat below the clear line (lifts the penalty)
  fireCooldown?: number; // spec 065 — sim-minutes until a district may light its next spontaneous fire (rate-limit; 0 until a Fire-Watch stands)
  lastFestivalYear?: number; // spec 067 — the last colony-year the Highsun Lantern Supper fired (fires once per year)
  festivalCheer?: number; // spec 067 — sim-minutes left on the Lantern Cheer buff (0 = none)
  festivalCheerBonus?: number; // spec 067 — the confidence points the active cheer grants (5 full supper / 2 modest)
  parcels: Parcel[];
  jobs: ConstructionJob[];
  buildings: ColonyBuilding[];
  roads: RoadCell[];
  roadSet: Set<string>;
  /** Spec 084 S3 — cell key -> road kind, THE membership source for "is this a drivable road cell".
   *  roadSet also holds reserved-but-undrivable cells (the neighborhood verge), which is exactly the
   *  trap that gave the traffic graph dead-end neighbours. Maintained by lay/mergeAvenue/purge. */
  roadKind: Map<string, RoadKind>;
  /** Spec 084 S1 — bumped on EVERY road mutation (lay or purge). The renderer and traffic key their
   *  rebuilds on this, not roads.length: an equal-length mutation (purge N + lay N) is invisible to
   *  a length check and left both with a stale picture of the network. */
  roadsVersion: number;
  occupied: Set<string>;
  buildIds: number;
  lastGrowMin: number;
  housingTimer: number; // spec 006 — accumulates sim-minutes; fires the upgrade/devolve pass on an interval
  levyRate: "low" | "normal" | "high"; // spec 025 — household levy the council sets; inert until a Levy Office stands
  outbreak: number; // spec 026 — 0..1 share of the population unwell; spreads in bad conditions, contained by a Fever Watch
  unrest: number; // spec 028 — 0..1 social disorder; rises from idle + squeezed populations, calmed by a Ward Post
  wageRate: "low" | "standard" | "generous"; // spec 029 — the council-set wage; inert until a Pay Office stands
  feastTimer: number; // spec 030 — sim-minutes left on an active Civic Feast (0 = none); lifts morale while it runs
  standing: number; // spec 032 — 0..1 Kookerverse Standing; rises on fulfilled Civic Requests, falls on missed ones
  request: {
    good: "components" | "linen" | "reels" | "food";
    amount: number;
    deadline: number;
  } | null; // spec 032 — the open Civic Request
  requestCooldown: number; // spec 032 — sim-minutes until the next Civic Request may arrive
  spireStage: number; // spec 033 — completed stages of the Horizon Spire (0..4)
  spireProgress: number; // spec 033 — 0..1 progress on the stage currently under construction
  spireBuilding: boolean; // spec 033 — true while a Spire stage is being raised (its crew is reserved)
  frontTimer: number; // spec 034 — sim-minutes until the next Cloudsea Front strikes (counts down once established)
  importOrder: "materials" | "components" | "food" | "linen" | "reels" | null; // spec 036 — standing import order the council sets; inert until an Import Office stands
  rosterMode: "essentials" | "balanced" | "industry"; // spec 038 — labour-priority mode the council sets; only bites with a staffed Roster Office under a shortage ('balanced' = today's even split)
  departurePressure: number; // spec 041 — 0..1 colony-wide emigration pressure; rises only under sustained failure, drains when homes are served
  buildingLoad: number;
  powerGen: number;
  lastIncomeDay: number;
  totalJobs: number;
  developedBlocks: Set<string>;
  pollution: number;
  cars: Car[];
  settlers: Settler[];
  tarentaal: TarentaalBird[];
  artifacts: VisualArtifact[];
  ledger: Ledger;
  cityPlan: CityPlan | null; // attached by the runtime after construction so the renderer can paint zones
  /** Attached by the runtime after construction — the homestead neighbourhood the R3F renderer
   *  reads for lot pads, zone overlays and voxel homes. The legacy renderer received this via
   *  setNeighborhood(); the R3F port reads it straight off the state. */
  neighborhood?: Neighborhood | null;
  /** Attached by the runtime after construction — the shop district the R3F renderer reads for
   *  commercial pads and terrain leveling. Legacy path was setCommercialDistrict(). */
  commercialDistrict?: CommercialDistrict | null;
  /** Spec 149 — the surveyed bus depot pad, attached by the runtime after siting, so terrain
   *  leveling grades ONE flat apron the slab, the buses and the walker's ground all agree on. */
  busDepotPad?: { x: number; y: number; w: number; h: number } | null;
  /** Attached by the runtime while a Road Rally runs (null otherwise) — the R3F renderer reads
   *  it for the race course + the player's racing car. Legacy path was setRaceState(). */
  raceState?: RaceState | null;
  /** Attached by the runtime after construction — the road centre-line polylines the R3F
   *  renderer extrudes into the smooth ribbon road surfaces (spec 127). Legacy path was
   *  setRoadWays(). Hand-drawn builder roads append here via useRoadNetwork.plotRoad. */
  roadWays?: RoadWay[];
  /** Attached by the renderer bridge when the signed-in operator has a car — the parked
   *  car's spec + home cell (spec 131). Legacy path was setOperatorCar(). */
  operatorCar?: { spec: CarSpec; cell: { x: number; y: number } } | null;
  /** Render toggle for the zoning overlays (spec 131) — set through setZonesVisible(). */
  zonesVisible?: boolean;
  /** Citizens present at the hilltop Rally Point (spec 131) — public-safe filtered at the
   *  renderer bridge; R3FRallyNameplates draws their name cards + floor circles. */
  rallyPresence?: { id: string; displayName: string }[];
  /** The TV-mode cinematic fly-around behind the login screen (spec 131) — set through
   *  setCinematic(); R3FCameraDirector orbits the landing while true. */
  cinematic?: boolean;
}

function daylightAt(hour: number, minute: number): number {
  const t = hour + minute / 60;
  return Math.max(0, Math.sin(((t - 6) / 13) * Math.PI));
}

export class ColonySim {
  state: ColonyState;
  rng: RNG;

  constructor(seed: number = COLONY.render.seed) {
    this.rng = new RNG(seed);
    const terrain = new Terrain(this.rng);
    const { x: lx, y: ly } = terrain.landing;

    // Base structures, spread inside the landing block (block 0,0 centred on the caravan; block=7
    // gives a 6×6 interior so the base is no longer cramped). Footprints reflect mesh widths so
    // wide structures (caravan 3-wide, solar 2.6-wide, rocket cylinder) don't dip into water.
    // Block boundaries become roads, so placement skips them; later structures avoid earlier ones.
    const used: { x: number; y: number }[] = [{ x: lx, y: ly }];
    const placeAvoid = (
      kind: StructureKind,
      x: number,
      y: number,
      footprint: number,
    ): SeedStructure => {
      const p = this.nearbyInterior(terrain, x, y, footprint, used, lx, ly);
      used.push(p);
      return { kind, x: p.x, y: p.y };
    };
    const structures: SeedStructure[] = [
      { kind: "caravan", x: lx, y: ly },
      placeAvoid("rocket", lx + 3, ly + 2, 1),
      placeAvoid("solar", lx - 2, ly + 2, 1),
      placeAvoid("battery", lx + 2, ly - 2, 1),
    ];
    const lighthouse = findFoundersLighthouseSite(terrain, { used });
    if (lighthouse) {
      structures.push({ kind: "lighthouse", x: lighthouse.x, y: lighthouse.y });
      used.push(lighthouse);
    }
    // Spec 097 — the hilltop Rally Overlook (race rendezvous), placed after the lighthouse so it
    // avoids it via `used`. A spur road reaches it later (runtime), like the commercial connector.
    const rally = findRallyOverlookSite(terrain, { used });
    if (rally) {
      structures.push({ kind: "rally", x: rally.x, y: rally.y });
      used.push(rally);
    }

    this.state = {
      name: COLONY.seed.name,
      terrain,
      clock: {
        totalMinutes: 10 * 60,
        day: 0,
        hour: 10,
        minute: 0,
        isDay: true,
        daylight: daylightAt(10, 0),
      },
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
      reels: 0, // spec 013 — refined by foundries
      skilled: 0, // spec 020 — trained by academies
      fibre: 0, // spec 031 — gathered by Flax Skimmer Docks
      linen: 0, // spec 031 — woven by Weaveries
      folios: 0, // spec 044 — bound by Folio Houses from reels + linen
      water: 0, // spec 046 — no stored water until a Mist Condenser Cistern stands
      tools: 0, // spec 047 — no tool-kits until a Tool Crib stands
      seed: 0, // spec 048 — no seed-stock until a Seed Loft stands
      children: 0, // spec 050 — no dependents until a household births one
      claims: 0, // spec 051 — the colony starts at its base footprint
      claimProgress: 0, // spec 051 — no survey underway
      lastFoundersYear: 0, // spec 053 — the founding year (year 0) needs no anniversary
      lastLedgerYear: 0, // spec 055 — the Long Ledger starts settled at the founding year
      renewalThisYear: 0, // spec 055
      renewalLastYear: 0, // spec 055
      lastPassings: 0, // spec 055 — no one has passed yet
      rimfish: 0, // spec 056 — no rimfish until a Cloudsea Net Dock stands
      waste: 0, // spec 058 — the colony starts clean
      driedFish: 0, // spec 061 — no dried rimfish until a Drying Rack stands
      parcels: [],
      jobs: [],
      buildings: [],
      roads: [],
      roadSet: new Set(),
      roadKind: new Map(),
      roadsVersion: 1,
      occupied: new Set(),
      buildIds: 1,
      lastGrowMin: 0,
      housingTimer: 0,
      levyRate: "normal", // spec 025 — steady by default; the rate only bites once a Levy Office is built + staffed
      outbreak: 0, // spec 026 — the colony starts healthy; an outbreak only grows from sustained bad conditions
      unrest: 0, // spec 028 — the colony starts orderly; unrest only grows from idleness under a squeeze
      wageRate: "standard", // spec 029 — fair pay by default; the lever only bites once a Pay Office is built + staffed
      feastTimer: 0, // spec 030 — no feast running at founding
      standing: 0.5, // spec 032 — the colony starts neutral with the Kookerverse
      request: null, // spec 032 — no open request until a Liaison Office stands
      requestCooldown: 0, // spec 032 — ready to receive the first request once a Liaison Office is staffed
      spireStage: 0, // spec 033 — no Horizon Spire raised at founding
      spireProgress: 0,
      spireBuilding: false,
      frontTimer: 0, // spec 034 — set to the first-front delay in initBuild
      importOrder: null, // spec 036 — no standing import order until the council sets one
      rosterMode: "balanced", // spec 038 — even labour split by default; the lever only bites with a staffed Roster Office
      departurePressure: 0, // spec 041 — no one is leaving a healthy colony
      buildingLoad: 0,
      powerGen: 0,
      lastIncomeDay: 0,
      totalJobs: 0,
      developedBlocks: new Set(),
      pollution: 0,
      cars: [],
      settlers: [],
      tarentaal: createTarentaalFlock(terrain, this.rng),
      artifacts: createVisualArtifacts(terrain),
      ledger: createLedger(),
      cityPlan: null,
    };
    initBuild(this.state);
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
    const B = COLONY.build.block;
    const HALF = B >> 1;
    const onRoadFrame = (px: number, py: number): boolean => {
      const mx = (((px - (cx - HALF)) % B) + B) % B;
      const my = (((py - (cy - HALF)) % B) + B) % B;
      return mx === 0 || my === 0;
    };
    const footprintClear = (px: number, py: number): boolean => {
      for (let dy = -footprint; dy <= footprint; dy++) {
        for (let dx = -footprint; dx <= footprint; dx++) {
          const nx = px + dx,
            ny = py + dy;
          if (!terrain.inBounds(nx, ny)) return false;
          if (terrain.isWater(nx, ny)) return false;
          // Keep the WHOLE mesh footprint off the road frame, not just the centre
          // cell: wide structures (rocket cylinder r~1.1, solar panel) otherwise
          // sit one cell off-frame but visually spill onto the adjacent road.
          if (onRoadFrame(nx, ny)) return false;
        }
      }
      return true;
    };
    const usedSet = new Set(used.map((p) => `${p.x},${p.y}`));
    const isUsed = (px: number, py: number): boolean =>
      usedSet.has(`${px},${py}`);

    // Pass 1 (best): footprint clear, interior of block, not used.
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx,
            ny = y + dy;
          if (onRoadFrame(nx, ny)) continue;
          if (isUsed(nx, ny)) continue;
          if (footprintClear(nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    // Pass 2 (fallback): any non-water buildable cell that's not used and not on a road frame.
    for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx,
            ny = y + dy;
          if (onRoadFrame(nx, ny)) continue;
          if (isUsed(nx, ny)) continue;
          if (!terrain.inBounds(nx, ny)) continue;
          if (terrain.isWater(nx, ny)) continue;
          if (terrain.buildable[terrain.idx(nx, ny)] === 0) continue;
          return { x: nx, y: ny };
        }
      }
    }
    return { x, y };
  }

  step(): void {
    const s = this.state;
    const dt = COLONY.time.simMinPerStep;
    const c = s.clock;
    c.totalMinutes += dt;
    const totalDays = Math.floor(c.totalMinutes / (24 * 60));
    const minOfDay = c.totalMinutes - totalDays * 24 * 60;
    c.day = totalDays;
    c.hour = Math.floor(minOfDay / 60);
    c.minute = Math.floor(minOfDay % 60);
    c.isDay =
      c.hour >= COLONY.time.dayStartHour && c.hour < COLONY.time.dayEndHour;
    c.daylight = daylightAt(c.hour, c.minute);

    const dtHours = dt / 60;
    const p = s.power;
    p.solarW =
      (COLONY.power.solarPeakW + s.powerGen) *
        c.daylight *
        solarSeasonFactor(s) +
      turbinePower(s); // spec 045/057 — turbines harvest wind day + night (no daylight, no season); solar follows the year once a calendar is kept (inert otherwise)
    p.loadW = COLONY.power.baseLoadW + s.colonists * 0.15 + s.buildingLoad;
    p.batteryWh = Math.max(
      0,
      Math.min(p.batteryCapWh, p.batteryWh + (p.solarW - p.loadW) * dtHours),
    );

    stepBuild(s, this.rng, dt);
    updateTraffic(s, this.rng, dt);
    stepTarentaalFlock(s.tarentaal, s.terrain, c.totalMinutes, dt);
  }
}
