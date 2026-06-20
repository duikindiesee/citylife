// Logistics: a road-tile graph, BFS pathfinding, and a pool of vehicles.
// Cars commute building→building; trucks run a freight cycle (resource→factory→market)
// carrying visible cargo. Soft traffic-light phases make vehicles pause at junctions.
import { CONFIG } from "./config";
import { RNG } from "./rng";
import { buildingById } from "./world";
import type { SimState, Vec2, Vehicle } from "./types";

interface RoadGraph {
  width: number;
  neighbors: Map<number, number[]>;
  isJunction: Set<number>;
  buildingRoad: Map<number, number>;
  residential: number[];
  commercial: number[];
  industrial: number[];
  factories: number[];
  resources: number[];
}

const graphCache = new WeakMap<SimState, RoadGraph>();

function isRoad(state: SimState, x: number, y: number): boolean {
  if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
  return state.zones[y * state.width + x] === 5;
}

function findNearestRoad(state: SimState, bx: number, by: number): number {
  for (let r = 1; r <= CONFIG.logistics.maxRoadSearch; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = bx + dx;
        const y = by + dy;
        if (isRoad(state, x, y)) return y * state.width + x;
      }
    }
  }
  return -1;
}

export function getRoadGraph(state: SimState): RoadGraph {
  const cached = graphCache.get(state);
  if (cached) return cached;

  const w = state.width;
  const h = state.height;
  const neighbors = new Map<number, number[]>();
  const isJunction = new Set<number>();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isRoad(state, x, y)) continue;
      const idx = y * w + x;
      const ns: number[] = [];
      if (isRoad(state, x + 1, y)) ns.push(idx + 1);
      if (isRoad(state, x - 1, y)) ns.push(idx - 1);
      if (isRoad(state, x, y + 1)) ns.push(idx + w);
      if (isRoad(state, x, y - 1)) ns.push(idx - w);
      neighbors.set(idx, ns);
      if (ns.length >= 3) isJunction.add(idx);
    }
  }

  const buildingRoad = new Map<number, number>();
  const residential: number[] = [];
  const commercial: number[] = [];
  const industrial: number[] = [];
  const factories: number[] = [];
  const resources: number[] = [];
  for (const b of state.buildings) {
    buildingRoad.set(b.id, findNearestRoad(state, b.x, b.y));
    if (b.zone === "residential") residential.push(b.id);
    else if (b.zone === "commercial") commercial.push(b.id);
    else if (b.zone === "industrial") {
      industrial.push(b.id);
      if (b.kind === "factory") factories.push(b.id);
      else if (b.kind) resources.push(b.id);
    }
  }

  const g: RoadGraph = {
    width: w,
    neighbors,
    isJunction,
    buildingRoad,
    residential,
    commercial,
    industrial,
    factories,
    resources,
  };
  graphCache.set(state, g);
  return g;
}

function bfsPath(g: RoadGraph, start: number, goal: number): number[] {
  if (start === goal) return [goal];
  const prev = new Map<number, number>();
  const seen = new Set<number>([start]);
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur === goal) break;
    for (const n of g.neighbors.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(goal)) return [];
  const path: number[] = [];
  let node: number | undefined = goal;
  while (node !== undefined) {
    path.unshift(node);
    node = prev.get(node);
  }
  return path;
}

function tileCenter(g: RoadGraph, idx: number): Vec2 {
  return { x: (idx % g.width) + 0.5, y: Math.floor(idx / g.width) + 0.5 };
}

function assignRoute(
  state: SimState,
  g: RoadGraph,
  v: Vehicle,
  originId: number,
  targetId: number,
): void {
  v.targetBuildingId = targetId;
  const oRoad = g.buildingRoad.get(originId) ?? -1;
  const tRoad = g.buildingRoad.get(targetId) ?? -1;
  let wp: Vec2[] = [];
  if (oRoad >= 0 && tRoad >= 0) {
    wp = bfsPath(g, oRoad, tRoad).map((idx) => tileCenter(g, idx));
  }
  const tb = buildingById(state, targetId);
  if (tb) wp.push({ x: tb.x + 0.5, y: tb.y + 0.5 });
  v.wp = wp.length > 0 ? wp : tb ? [{ x: tb.x + 0.5, y: tb.y + 0.5 }] : [];
}

function pick(arr: number[], rng: RNG): number | undefined {
  return arr.length ? arr[rng.int(0, arr.length - 1)] : undefined;
}

const CAR_COLORS = [
  0xe05a4d, 0x4d7fe0, 0xe6c84d, 0xece6e0, 0x55b86a, 0x9b5ad6, 0x46c6c6,
];

export function spawnVehicles(state: SimState, rng: RNG): void {
  const g = getRoadGraph(state);
  state.vehicles = [];
  let id = 0;

  for (let i = 0; i < CONFIG.logistics.cars; i++) {
    const originId = pick(g.residential, rng) ?? pick(g.commercial, rng);
    if (originId == null) break;
    const ob = buildingById(state, originId)!;
    const v: Vehicle = {
      id: id++,
      kind: "car",
      x: ob.x + 0.5,
      y: ob.y + 0.5,
      heading: 0,
      wp: [],
      targetBuildingId: originId,
      phase: "commute",
      cargo: 0,
      speed: CONFIG.logistics.carSpeed * rng.range(0.85, 1.15),
      color: CAR_COLORS[i % CAR_COLORS.length]!,
      waitTimer: 0,
    };
    const dest = pick(g.commercial.concat(g.industrial), rng) ?? originId;
    assignRoute(state, g, v, originId, dest);
    state.vehicles.push(v);
  }

  for (let i = 0; i < CONFIG.logistics.trucks; i++) {
    const start = pick(g.factories, rng) ?? pick(g.industrial, rng);
    if (start == null) break;
    const sb = buildingById(state, start)!;
    const v: Vehicle = {
      id: id++,
      kind: "truck",
      x: sb.x + 0.5,
      y: sb.y + 0.5,
      heading: 0,
      wp: [],
      targetBuildingId: start,
      phase: "to_pickup",
      cargo: 0,
      speed: CONFIG.logistics.truckSpeed * rng.range(0.9, 1.1),
      color: 0xb7b2a8,
      waitTimer: 0,
    };
    const res = pick(g.resources, rng) ?? pick(g.industrial, rng) ?? start;
    assignRoute(state, g, v, start, res);
    state.vehicles.push(v);
  }
}

function onArrive(state: SimState, g: RoadGraph, rng: RNG, v: Vehicle): void {
  const here = v.targetBuildingId;
  if (v.kind === "car") {
    const goResidential =
      g.commercial.includes(here) || g.industrial.includes(here);
    const pool = goResidential
      ? g.residential
      : g.commercial.concat(g.industrial);
    const dest = pick(pool, rng) ?? pick(g.residential, rng) ?? here;
    assignRoute(state, g, v, here, dest);
    return;
  }
  // truck freight cycle
  if (v.phase === "to_pickup") {
    v.cargo = 1;
    v.phase = "to_factory";
    assignRoute(
      state,
      g,
      v,
      here,
      pick(g.factories, rng) ?? pick(g.industrial, rng) ?? here,
    );
  } else if (v.phase === "to_factory") {
    v.cargo = 1;
    v.phase = "to_market";
    assignRoute(state, g, v, here, pick(g.commercial, rng) ?? here);
  } else {
    v.cargo = 0;
    v.phase = "to_pickup";
    assignRoute(
      state,
      g,
      v,
      here,
      pick(g.resources, rng) ?? pick(g.industrial, rng) ?? here,
    );
  }
}

export function updateVehicles(state: SimState, rng: RNG, dtMin: number): void {
  const g = getRoadGraph(state);
  const dtHours = dtMin / 60;
  const phase = Math.floor(state.tick / CONFIG.logistics.lightPeriodTicks) % 2; // 0: E-W green, 1: N-S green

  for (const v of state.vehicles) {
    if (v.wp.length === 0) {
      onArrive(state, g, rng, v);
      if (v.wp.length === 0) continue;
    }
    const target = v.wp[0]!;
    const dx = target.x - v.x;
    const dy = target.y - v.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-4) v.heading = Math.atan2(dy, dx);

    // Soft traffic light: pause at a junction when crossing against the green phase.
    const tileIdx = Math.floor(v.y) * state.width + Math.floor(v.x);
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const red = (phase === 0 && !horizontal) || (phase === 1 && horizontal);
    if (
      g.isJunction.has(tileIdx) &&
      red &&
      v.waitTimer < CONFIG.logistics.lightPeriodTicks
    ) {
      v.waitTimer++;
      continue;
    }
    v.waitTimer = 0;

    const step = v.speed * dtHours;
    if (dist <= step) {
      v.x = target.x;
      v.y = target.y;
      v.wp.shift();
      if (v.wp.length === 0) onArrive(state, g, rng, v);
    } else {
      v.x += (dx / dist) * step;
      v.y += (dy / dist) * step;
    }
  }
}

/** Junction tiles (for rendering traffic-light posts). */
export function junctionTiles(state: SimState): number[] {
  return [...getRoadGraph(state).isJunction];
}
