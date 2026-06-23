// First-person view — what one citizen sees right now, as a typed JSON blob the Hermes pod can
// reason over, or the governor loop can feed into the choice of whether to spend tokens on a real
// PNG snapshot.
//
// Spec 074. Pure-engine; no rendering, no fetch, deterministic given the same state + roster.
// The PNG counterpart (vision) is rendered separately by PlanetRenderer.firstPersonPNG().
import type { ColonyState } from "../sim";
import { Biome } from "../terrain";
import { COLONY } from "../config";
import type { CitizenRoster } from "./citizenRoster";

/** What the bot gets every turn — cheap, deterministic, vision-free. */
export interface FirstPersonView {
  citizen: {
    id: string;
    displayName: string;
    plotName: string;
    homeXY: { x: number; y: number };
    /** Live avatar position: this is where first-person sight/senses are sampled from. */
    positionXY: { x: number; y: number };
    /** Current facing in radians, so narration/rendering can reason about direction. */
    heading: number;
  };
  /** The nearest useful thing the player can interact with from this live position. */
  interactionPrompt:
    | {
        kind: "citizen" | "civic" | "building" | "road";
        label: string;
        targetName: string;
        targetXY: { x: number; y: number };
        distance: number;
      }
    | null;
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

function clampCell(n: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.round(n)));
}

function roundDistance(n: number): number {
  return Number(n.toFixed(1));
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
  const { x: px, y: py } = me.pos;
  const tx = clampCell(px, t.size);
  const ty = clampCell(py, t.size);
  const i = t.idx(tx, ty);
  const biome = t.biome[i];
  const elev = t.elev[i] ?? 0;
  const distToWater = t.distToWater[i] ?? 0;
  const isWater = t.isWater(tx, ty);

  // Nearest road.
  let nearestRoad: { x: number; y: number; distance: number } | null = null;
  for (const r of state.roads) {
    const d = dist(r.x, r.y, px, py);
    if (!nearestRoad || d < nearestRoad.distance)
      nearestRoad = { x: r.x, y: r.y, distance: d };
  }

  // Neighbours — other citizens, nearest first, up to 4.
  const allOthers = roster
    .list()
    .filter((c) => c.id !== me.id)
    .map((c) => {
      const live = roster.byId(c.id);
      const ox = live?.pos.x ?? c.homeXY.x;
      const oy = live?.pos.y ?? c.homeXY.y;
      return {
        displayName: c.displayName,
        plotName: c.plotName,
        x: ox,
        y: oy,
        distance: dist(ox, oy, px, py),
      };
    })
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
      x: b.x,
      y: b.y,
      distance: dist(b.x, b.y, px, py),
    }))
    .sort((a, b) => a.distance - b.distance);
  const nearestBuildings = seenBuildings
    .filter((b) => !CIVIC.has(b.kind))
    .slice(0, 3);
  const nearestCivic = seenBuildings
    .filter((b) => CIVIC.has(b.kind))
    .slice(0, 3);

  const nearestNeighbour = allOthers[0] ?? null;
  const promptMax = COLONY.firstPerson.interactionPromptMaxDistance;
  const nearbyNeighbour =
    nearestNeighbour && nearestNeighbour.distance <= promptMax.citizen
      ? nearestNeighbour
      : null;
  const nearbyCivic =
    nearestCivic[0] && nearestCivic[0].distance <= promptMax.civic
      ? nearestCivic[0]
      : null;
  const nearbyBuilding =
    nearestBuildings[0] && nearestBuildings[0].distance <= promptMax.building
      ? nearestBuildings[0]
      : null;
  const nearbyRoad =
    nearestRoad && nearestRoad.distance <= promptMax.road ? nearestRoad : null;

  const interactionPrompt = nearbyNeighbour
    ? {
        kind: "citizen" as const,
        label: `Talk to ${nearbyNeighbour.displayName}`,
        targetName: nearbyNeighbour.displayName,
        targetXY: { x: nearbyNeighbour.x, y: nearbyNeighbour.y },
        distance: roundDistance(nearbyNeighbour.distance),
      }
    : nearbyCivic
      ? {
          kind: "civic" as const,
          label: `Visit ${nearbyCivic.kind}`,
          targetName: nearbyCivic.kind,
          targetXY: { x: nearbyCivic.x, y: nearbyCivic.y },
          distance: roundDistance(nearbyCivic.distance),
        }
      : nearbyBuilding
        ? {
            kind: "building" as const,
            label: `Inspect ${nearbyBuilding.kind}`,
            targetName: nearbyBuilding.kind,
            targetXY: { x: nearbyBuilding.x, y: nearbyBuilding.y },
            distance: roundDistance(nearbyBuilding.distance),
          }
        : nearbyRoad
          ? {
              kind: "road" as const,
              label: "Follow road",
              targetName: "road",
              targetXY: { x: nearbyRoad.x, y: nearbyRoad.y },
              distance: roundDistance(nearbyRoad.distance),
            }
          : null;

  return {
    citizen: {
      id: me.id,
      displayName: me.displayName,
      plotName: me.plotName,
      homeXY: { x: me.homeXY.x, y: me.homeXY.y },
      positionXY: { x: px, y: py },
      heading: me.heading,
    },
    interactionPrompt,
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
