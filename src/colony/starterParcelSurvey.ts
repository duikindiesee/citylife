import type { Parcel } from "./neighborhood";
import type { Cell } from "./pathfind";
import { ownedDriveFootprintClear } from "./car/ownedDriving";
import { COLONY } from "./config";

export interface StarterParcelGeometry {
  plotId: string;
  worldId: string;
  layoutRevision: string;
  neighbourhoodKey: string;
  parcel: { x: number; y: number; width: number; depth: number };
  houseZone: { x: number; y: number; width: number; depth: number };
  driveway: Cell[];
  roadCells: Cell[];
  spawn: Cell;
}

export interface StarterParcelSurvey {
  candidates: StarterParcelGeometry[];
  rejected: { plotId: string; reason: string }[];
}

const key = (c: Cell) => `${c.x},${c.y}`;
const adjacent = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/** Static body clearance along a straight driveway, using the production collider.
 * Passing does not yet prove road turning, slope or rendered-surface alignment.
 */
export function surveyStarterDrivewayClearance(
  geometry: StarterParcelGeometry,
  lot: Parcel,
  roads: readonly Cell[],
  groundClear: (cell: Cell) => boolean,
): { clear: boolean; heading: number; reason: string | null } {
  const end = geometry.driveway.findIndex(c => key(c) === key(geometry.spawn));
  const path = geometry.driveway.slice(0, end + 1).reverse();
  if (path.length < 2) return { clear: false, heading: 0, reason: "missing-spawn-route" };
  const heading = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
  if (path.some((c, i) => i > 0 && (!adjacent(c, path[i-1]) ||
      Math.atan2(c.y - path[i-1].y, c.x - path[i-1].x) !== heading)))
    return { clear: false, heading, reason: "requires-turn-survey" };
  const permitted = new Set([...roads, ...geometry.driveway].map(key));
  const fence = new Set(lot.fence.map(key));
  const h = geometry.houseZone;
  const canOccupy = (x: number, y: number) => {
    const cell = { x: Math.round(x), y: Math.round(y) };
    return permitted.has(key(cell)) && !fence.has(key(cell)) && groundClear(cell) &&
      !(cell.x >= h.x && cell.x < h.x + h.width && cell.y >= h.y && cell.y < h.y + h.depth);
  };
  const distance = Math.hypot(path[0].x - path.at(-1)!.x, path[0].y - path.at(-1)!.y);
  const samples = Math.ceil(distance * COLONY.ownedDriving.cellMetres /
    COLONY.ownedDriving.drivewayClearanceSampleMetres);
  for (let i = 0; i <= samples; i++) {
    const fraction = i / samples;
    if (!ownedDriveFootprintClear({
      x: path[0].x + (path.at(-1)!.x - path[0].x) * fraction,
      y: path[0].y + (path.at(-1)!.y - path[0].y) * fraction, heading,
    }, canOccupy)) return { clear: false, heading, reason: "vehicle-footprint-blocked" };
  }
  return { clear: true, heading, reason: null };
}

/** Operator-side survey candidates, never an ownership or availability authority.
 * Use an untouched canonical world, not a player's edited/local layout. This converts
 * the pedestrian path into a road-connected approach stopping BEFORE the house.
 * Publication still requires vehicle clearance, a canonical child frame and NPC exclusion.
 */
export function surveyStarterParcels(input: {
  worldId: string;
  layoutRevision: string;
  parcels: readonly Parcel[];
  roads: readonly Cell[];
  groundClear: (cell: Cell) => boolean;
}): StarterParcelSurvey {
  if (!input.worldId || !/^[a-f0-9]{64}$/.test(input.layoutRevision))
    throw new Error("A canonical world and SHA256 layout revision are required");
  const roadSet = new Set(input.roads.map(key));
  const result: StarterParcelSurvey = { candidates: [], rejected: [] };
  const ids = new Set<string>();
  for (const lot of input.parcels) {
    if (ids.has(lot.id)) throw new Error(`Duplicate parcel ${lot.id}`);
    ids.add(lot.id);
    const reject = (reason: string) => result.rejected.push({ plotId: lot.id, reason });
    if (!lot.neighborhoodKey) { reject("missing-neighbourhood-key"); continue; }
    if (lot.ownerCitizenId || lot.reservedFor || lot.built || lot.zone === "commercial") {
      reject("occupied-or-reserved"); continue;
    }
    if (!lot.fence.length) { reject("missing-boundary"); continue; }
    const boundary = [...lot.fence, lot.gate];
    const x = Math.min(...boundary.map(c => c.x));
    const y = Math.min(...boundary.map(c => c.y));
    const maxX = Math.max(...boundary.map(c => c.x));
    const maxY = Math.max(...boundary.map(c => c.y));
    const house = lot.houseZone;
    if (maxX - x + 1 !== lot.w || maxY - y + 1 !== lot.h ||
        house.x < x || house.y < y || house.x + house.w > maxX + 1 ||
        house.y + house.d > maxY + 1) {
      reject("invalid-boundary"); continue;
    }
    const inHouse = (c: Cell) => c.x >= house.x && c.x < house.x + house.w &&
      c.y >= house.y && c.y < house.y + house.d;
    const houseStart = lot.driveway.findIndex(inHouse);
    if (houseStart < 0) { reject("path-misses-house"); continue; }
    const approach = lot.driveway.slice(0, houseStart).map(c => ({...c}));
    if (!approach.length) { reject("missing-approach"); continue; }
    if (!roadSet.has(key(approach[0]))) {
      // Existing pedestrian paths start on the verge, one cell off the road.
      // Only an actual adjacent road cell may extend that path; never bridge a gap.
      const joins = input.roads.filter(c => adjacent(c, approach[0]))
        .sort((a, b) => a.x - b.x || a.y - b.y);
      if (!joins.length) { reject("disconnected-road"); continue; }
      approach.unshift({...joins[0]});
    }
    if (new Set(approach.map(key)).size !== approach.length ||
        approach.some((c, i) => !Number.isInteger(c.x) || !Number.isInteger(c.y) ||
          !input.groundClear(c) || inHouse(c) || (i > 0 && !adjacent(c, approach[i - 1])))) {
      reject("invalid-approach"); continue;
    }
    // Keep a complete path cell between the spawn centre and the house doorway.
    // This is a centre-line candidate, not proof of a vehicle's swept clearance.
    const spawn = approach.slice(1, -1).reverse().find(c => !roadSet.has(key(c)) &&
      c.x >= x && c.x <= maxX && c.y >= y && c.y <= maxY);
    if (!spawn) { reject("no-off-road-spawn"); continue; }
    result.candidates.push({
      plotId: lot.id, worldId: input.worldId, layoutRevision: input.layoutRevision,
      neighbourhoodKey: lot.neighborhoodKey,
      parcel: { x, y, width: maxX - x + 1, depth: maxY - y + 1 },
      houseZone: { x: house.x, y: house.y, width: house.w, depth: house.d },
      driveway: approach, roadCells: approach.filter(c => roadSet.has(key(c))), spawn: {...spawn},
    });
  }
  return result;
}
