// First-person view — what one citizen sees right now, as a typed JSON blob the Hermes pod can
// reason over, or the governor loop can feed into the choice of whether to spend tokens on a real
// PNG snapshot.
//
// Spec 074. Pure-engine; no rendering, no fetch, deterministic given the same state + roster.
// The PNG counterpart (vision) is rendered separately by PlanetRenderer.firstPersonPNG().
import type { ColonyState } from "../sim";
import { Biome } from "../terrain";
import type { CitizenRoster } from "./citizenRoster";

/** What the bot gets every turn — cheap, deterministic, vision-free. */
export interface FirstPersonView {
  citizen: {
    id: string;
    displayName: string;
    plotName: string;
    homeXY: { x: number; y: number };
  };
  /** The patch of land the citizen's house sits on. */
  ground: {
    biome: string;
    elevation: number;
    isWater: boolean;
    distToWater: number;
  };
  /** Nearest road cell (a citizen who lives on a road, walks). */
  nearestRoad: { x: number; y: number; distance: number } | null;
  /** Other citizens close enough to wave to. Up to 4, nearest first. */
  neighbours: { displayName: string; plotName: string; distance: number }[];
  /** Nearest non-civic buildings (industry, food, housing) the citizen can see / walk to. Up to 3. */
  nearestBuildings: { kind: string; distance: number }[];
  /** Nearest civic anchors (clinic, school, theatre, market, shrine). Up to 3. */
  nearestCivic: { kind: string; distance: number }[];
  /** Time of day + day count from the sim clock. */
  clock: { day: number; hour: number; minute: number; isDay: boolean };
  /** The colony's mood the citizen senses just by living here. All floats 0..1 where applicable. */
  mood: {
    /** -1..1 net liveability around their cell. */
    liveability: number;
    /** Hygiene of the colony (0..1; 0 until a bathhouse stands). */
    hygiene: number;
    /** Fever level (0..1; high = visible illness). */
    fever: number;
    /** Unrest level (0..1; high = visible disorder). */
    unrest: number;
    /** Whether the lights are dim tonight (brownout). */
    brownout: boolean;
    /** Whether the colony is hungry now (0 food, eating happened). */
    hungry: boolean;
  };
}

const BIOME_NAME: Record<number, string> = {
  [Biome.Ocean]: "ocean",
  [Biome.Shallows]: "shallows",
  [Biome.Beach]: "beach",
  [Biome.Plains]: "plains",
  [Biome.Forest]: "forest",
  [Biome.Highland]: "highland",
  [Biome.Mountain]: "mountain",
  [Biome.Peak]: "peak",
  [Biome.River]: "river",
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx,
    dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Pure-engine "what's around the citizen" snapshot. Returns null if the citizen is unknown. */
export function firstPersonView(
  state: ColonyState,
  citizenId: string,
  roster: CitizenRoster,
): FirstPersonView | null {
  const me = roster.byId(citizenId);
  if (!me) return null;
  const t = state.terrain;
  const { x: hx, y: hy } = me.homeXY;
  const i = t.idx(hx, hy);
  const biome = t.biome[i];
  const elev = t.elev[i] ?? 0;
  const distToWater = t.distToWater[i] ?? 0;
  const isWater = t.isWater(hx, hy);

  // Nearest road.
  let nearestRoad: { x: number; y: number; distance: number } | null = null;
  for (const r of state.roads) {
    const d = dist(r.x, r.y, hx, hy);
    if (!nearestRoad || d < nearestRoad.distance)
      nearestRoad = { x: r.x, y: r.y, distance: d };
  }

  // Neighbours — other citizens, nearest first, up to 4.
  const allOthers = roster
    .list()
    .filter((c) => c.id !== me.id)
    .map((c) => ({
      displayName: c.displayName,
      plotName: c.plotName,
      distance: dist(c.homeXY.x, c.homeXY.y, hx, hy),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 4);

  // Buildings: split into civic vs other. Civic kinds the citizen "senses" because they anchor life.
  // BuildKind union from build.ts — we name only kinds that actually shipped (anything else falls into "other").
  const CIVIC = new Set<string>([
    "clinic",
    "theatre",
    "market",
    "shrine",
    "survey",
    "feast",
    "hall",
    "ward",
    "firewatch",
    "sanitation",
    "watchnook",
    "school",
    "bathhouse",
    "library",
    "gallery",
    "census",
    "levy",
    "payoffice",
    "roster",
    "comptroller",
    "liaison",
    "import",
    "stormwatch",
    "mast",
    "planter",
    "festboard",
    "hallofnames",
    "calendar",
  ]);
  const seenBuildings = state.buildings
    .map((b) => ({
      kind: String(b.artifact?.kind ?? "unknown"),
      distance: dist(b.x, b.y, hx, hy),
    }))
    .sort((a, b) => a.distance - b.distance);
  const nearestBuildings = seenBuildings
    .filter((b) => !CIVIC.has(b.kind))
    .slice(0, 3);
  const nearestCivic = seenBuildings
    .filter((b) => CIVIC.has(b.kind))
    .slice(0, 3);

  return {
    citizen: {
      id: me.id,
      displayName: me.displayName,
      plotName: me.plotName,
      homeXY: { x: hx, y: hy },
    },
    ground: {
      biome: BIOME_NAME[biome ?? -1] ?? "unknown",
      elevation: Number(elev.toFixed(3)),
      isWater,
      distToWater,
    },
    nearestRoad,
    neighbours: allOthers,
    nearestBuildings,
    nearestCivic,
    clock: {
      day: state.clock.day,
      hour: state.clock.hour,
      minute: state.clock.minute,
      isDay: state.clock.hour >= 6 && state.clock.hour < 20, // matches COLONY.time dayStartHour/dayEndHour
    },
    mood: {
      liveability: 0, // a colony-wide signal is computed by build.colonyLiveability — runtime injects it
      hygiene: state.hygiene ?? 0,
      fever: state.outbreak ?? 0,
      unrest: state.unrest ?? 0,
      brownout: false, // injected by runtime which calls inBrownout(state)
      hungry: (state.food ?? 0) <= 0,
    },
  };
}
