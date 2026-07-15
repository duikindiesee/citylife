// Traffic: cars commute between homes and workplaces on the road grid, keeping to the LEFT
// lane, and stop at intersections on a first-come / one-at-a-time basis (a 4-way-stop box
// reservation). A wait failsafe guarantees no permanent deadlock.
import { RNG } from "../engine/rng";
import { COLONY } from "./config";
import type { ColonyState } from "./sim";
import { gridOrigin } from "./grid";

export interface Car {
  id: number;
  x: number; // centre-line position (lot coords); the renderer offsets it to the left lane
  y: number;
  heading: number;
  color: number;
  path: number[]; // remaining road-cell indices
  homeId: number;
  workId: number;
  goingTo: "work" | "home";
  held: number; // intersection cell currently reserved, or -1
  waitTimer: number;
}

interface TrafficData {
  graph: Map<number, number[]>;
  intersections: Set<number>;
  occ: Map<number, number>; // intersection cell -> car id occupying it
  /** Spec 084 S1 — the roadsVersion this graph was built from. A length check missed equal-length
   *  mutations (purge N + lay N), leaving cars driving a network that no longer existed. */
  roadsVersion: number;
  carId: number;
}

const CAR_COLORS = [
  0xe05a4d, 0x4d7fe0, 0xe6c84d, 0xece6e0, 0x55b86a, 0x9b5ad6, 0x46c6c6,
];
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const cache = new WeakMap<ColonyState, TrafficData>();
const mod = (v: number, m: number) => ((v % m) + m) % m;

function getTraffic(state: ColonyState): TrafficData {
  const cached = cache.get(state);
  if (cached && cached.roadsVersion === state.roadsVersion) return cached;

  const W = state.terrain.size;
  const g = gridOrigin(state);
  const B = COLONY.build.block;
  // Spec 084 S3 — adjacency comes from roadKind (actual DRIVABLE cells), never raw roadSet:
  // roadSet also reserves undrivable cells (the neighborhood verge), and using it gave the graph
  // neighbour ids with no node — cars routed into the verge and dead-ended.
  const rk = state.roadKind;
  // Spec 149 — the bus-depot spur is a real road but belongs to the buses; ambient cars must not
  // drive it (a car meeting a maneuvering bus on the dead-end spur is the "bumping into cars" the
  // operator flagged). Excluding its cells as nodes AND neighbours keeps cars on the loop.
  const noCar = state.busDepotSpurCells;
  const drivable = (x: number, y: number): boolean =>
    rk.has(x + "," + y) && !(noCar != null && noCar.has(x + "," + y));
  const graph = new Map<number, number[]>();
  const intersections = new Set<number>();
  for (const r of state.roads) {
    if (noCar != null && noCar.has(r.x + "," + r.y)) continue; // spur cells are not car nodes
    const id = r.y * W + r.x;
    const ns: number[] = [];
    for (const [dx, dy] of DIRS) {
      if (drivable(r.x + dx, r.y + dy)) ns.push((r.y + dy) * W + (r.x + dx));
    }
    graph.set(id, ns);
    if (mod(r.x - g.x, B) === 0 && mod(r.y - g.y, B) === 0)
      intersections.add(id);
  }
  // graph changed -> drop stale reservations and held refs
  for (const car of state.cars) car.held = -1;
  const td: TrafficData = {
    graph,
    intersections,
    occ: new Map(),
    roadsVersion: state.roadsVersion,
    carId: cached?.carId ?? 1,
  };
  cache.set(state, td);
  return td;
}

/** Nearest DRIVABLE car road cell index to a building lot (spiral), or -1. roadKind membership,
 *  not roadSet — a verge cell would be a graph orphan (spec 084 S3). Spec 149 also excludes the
 *  bus-owned depot spur, because those cells are deliberately absent from the car graph. Radius 8
 *  reaches across the wider estate setbacks. */
function nearestRoadCell(state: ColonyState, bx: number, by: number): number {
  const W = state.terrain.size;
  const noCar = state.busDepotSpurCells;
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = bx + dx;
        const y = by + dy;
        const key = x + "," + y;
        if (state.roadKind.has(key) && !(noCar != null && noCar.has(key)))
          return y * W + x;
      }
    }
  }
  return -1;
}

function bfs(
  graph: Map<number, number[]>,
  start: number,
  goal: number,
): number[] {
  if (start === goal || start < 0 || goal < 0) return [];
  const prev = new Map<number, number>();
  const seen = new Set<number>([start]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur === goal) break;
    for (const n of graph.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(goal)) return [];
  const path: number[] = [];
  let node: number | undefined = goal;
  while (node !== undefined && node !== start) {
    path.unshift(node);
    node = prev.get(node);
  }
  return path;
}

function buildingById(state: ColonyState, id: number) {
  return state.buildings.find((b) => b.id === id);
}

function routeTo(
  state: ColonyState,
  td: TrafficData,
  car: Car,
  dest: { x: number; y: number },
): void {
  const W = state.terrain.size;
  const from = nearestRoadCell(state, Math.round(car.x), Math.round(car.y));
  const to = nearestRoadCell(state, dest.x, dest.y);
  car.path = bfs(td.graph, from, to);
}

/** BFS road path (world cell indices) between two lots — used by the construction crew truck. */
export function roadPath(
  state: ColonyState,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number[] {
  const td = getTraffic(state);
  const from = nearestRoadCell(state, Math.round(ax), Math.round(ay));
  const to = nearestRoadCell(state, Math.round(bx), Math.round(by));
  return bfs(td.graph, from, to);
}

function spawnCars(state: ColonyState, rng: RNG, td: TrafficData): void {
  const homes = state.buildings.filter((b) => b.artifact.kind === "habitat");
  const works = state.buildings.filter(
    (b) => b.artifact.kind === "commercial" || b.artifact.kind === "industrial",
  );
  if (homes.length === 0 || works.length === 0) return;
  const W = state.terrain.size;
  const cap = Math.min(COLONY.traffic.maxCars, Math.floor(state.colonists / 6));
  let guard = 0;
  while (state.cars.length < cap && guard++ < 40) {
    const home = homes[rng.int(0, homes.length - 1)]!;
    const work = works[rng.int(0, works.length - 1)]!;
    const hr = nearestRoadCell(state, home.x, home.y);
    const wr = nearestRoadCell(state, work.x, work.y);
    if (hr < 0 || wr < 0) continue;
    const path = bfs(td.graph, hr, wr);
    state.cars.push({
      id: td.carId++,
      x: (hr % W) + 0.5,
      y: ((hr / W) | 0) + 0.5,
      heading: 0,
      color: CAR_COLORS[td.carId % CAR_COLORS.length]!,
      path,
      homeId: home.id,
      workId: work.id,
      goingTo: "work",
      held: -1,
      waitTimer: 0,
    });
  }
}

function arrive(state: ColonyState, td: TrafficData, car: Car): void {
  if (car.held !== -1) {
    td.occ.delete(car.held);
    car.held = -1;
  }
  car.goingTo = car.goingTo === "work" ? "home" : "work";
  const destB = buildingById(
    state,
    car.goingTo === "work" ? car.workId : car.homeId,
  );
  if (destB) routeTo(state, td, car, destB);
}

export function updateTraffic(
  state: ColonyState,
  rng: RNG,
  dtMin: number,
): void {
  const td = getTraffic(state);
  if (state.roads.length === 0) return;
  spawnCars(state, rng, td);

  const W = state.terrain.size;
  const dtH = dtMin / 60;

  for (const car of state.cars) {
    if (car.path.length === 0) {
      arrive(state, td, car);
      continue;
    }
    const next = car.path[0]!;
    const nx = (next % W) + 0.5;
    const ny = ((next / W) | 0) + 0.5;
    // Spec 084 S3 — speed follows the kind of the cell being entered: faster on the paved avenue.
    const kind =
      state.roadKind.get((next % W) + "," + ((next / W) | 0)) ?? "street";
    const step =
      (COLONY.traffic.speedByKind[kind] ?? COLONY.traffic.carSpeed) * dtH;

    // intersection gate: first-come, one car in the box at a time
    if (td.intersections.has(next) && car.held !== next) {
      const occBy = td.occ.get(next);
      if (occBy !== undefined && occBy !== car.id) {
        car.waitTimer++;
        if (car.waitTimer < COLONY.traffic.maxWaitSteps) continue; // stop and wait our turn
        // failsafe: been stuck too long, proceed to avoid a jam
      } else {
        td.occ.set(next, car.id);
        car.held = next;
        car.waitTimer = 0;
      }
    }

    car.waitTimer = 0; // reached the movement step -> not blocked
    const dx = nx - car.x;
    const dy = ny - car.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-4) car.heading = Math.atan2(dy, dx);
    if (dist <= step) {
      car.x = nx;
      car.y = ny;
      car.path.shift();
      if (car.held !== -1 && next !== car.held) {
        // we've moved a cell past the intersection we were holding -> release it
        td.occ.delete(car.held);
        car.held = -1;
      }
      if (car.path.length === 0) arrive(state, td, car);
    } else {
      car.x += (dx / dist) * step;
      car.y += (dy / dist) * step;
    }
  }
}
