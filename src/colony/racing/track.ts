import type { RoadKind } from "../build";
import type { CommercialDistrict } from "../commerce/district";
import type { SeedStructure } from "../sim";
import type { Terrain } from "../terrain";

export interface RacePoint {
  x: number;
  y: number;
}

export interface RaceTrack {
  checkpoints: RacePoint[];
  path: RacePoint[];
  length: number;
  loop: boolean;
  seed: number;
  roadsVersion: number;
  roadKinds: Record<string, RoadKind>;
}

export interface RaceTrackOptions {
  commercialCenter?: RacePoint | null;
  lighthouse?: SeedStructure | null;
  seed: number;
  excludeCells?: ReadonlySet<string>;
}

export interface NearestTrackPoint {
  x: number;
  y: number;
  distance: number;
  segmentIndex: number;
  pathIndex: number;
  progress: number;
}

export interface RaceRoadState {
  terrain: Pick<Terrain, "size" | "inBounds" | "isWater">;
  roadKind: ReadonlyMap<string, RoadKind>;
  roadsVersion: number;
}

export const MIN_RACE_TRACK_LENGTH = 60;
export const COMMERCIAL_START_MAX_DIST = 18;
const MIN_CHECKPOINTS = 4;
const MAX_CHECKPOINTS = 7;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface RoadNode {
  id: number;
  x: number;
  y: number;
  kind: RoadKind;
}

interface RoadGraph {
  W: number;
  nodes: Map<number, RoadNode>;
  edges: Map<number, number[]>;
}

export function commercialFrontageExclusion(
  district: CommercialDistrict | null | undefined,
): Set<string> {
  const out = new Set<string>();
  const bar = district?.parcels.find((p) => p.business === "nearest_bar");
  if (!bar) return out;
  for (let y = bar.y; y < bar.y + bar.h; y++) {
    for (let x = bar.x; x < bar.x + bar.w; x++) out.add(key(x, y));
  }
  const frontRow = bar.side === -1 ? bar.y + bar.h - 1 : bar.y;
  const towardStreet = -bar.side;
  const frontageY = frontRow + towardStreet;
  for (let x = bar.x; x < bar.x + bar.w; x++) out.add(key(x, frontageY));
  return out;
}

export function makeRaceTrack(
  state: RaceRoadState,
  opts: RaceTrackOptions,
): RaceTrack | null {
  const graph = buildGraph(state, opts.excludeCells ?? new Set());
  if (graph.nodes.size < 2) return null;
  const start = findStart(graph, opts.commercialCenter ?? null);
  if (start === null) return null;

  const fromStart = bfsAll(graph, start);
  const reachable = [...fromStart.dist.keys()].filter((id) => id !== start);
  if (reachable.length === 0) return null;
  const scored = reachable
    .map((id) => {
      const n = graph.nodes.get(id)!;
      return {
        id,
        dist: fromStart.dist.get(id) ?? 0,
        score:
          (fromStart.dist.get(id) ?? 0) * 1000 +
          roadScore(n.kind) * 37 +
          hash01(id, opts.seed) * 11,
      };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);

  const farA = scored[0]!.id;
  const farANode = graph.nodes.get(farA)!;
  const farB = scored.find((c) => {
    const n = graph.nodes.get(c.id)!;
    return Math.hypot(n.x - farANode.x, n.y - farANode.y) >= 18;
  })?.id;

  let ids: number[] | null = null;
  let loop = false;
  if (farB !== undefined) {
    const aPath = pathFromPrev(fromStart.prev, start, farA);
    const bPath = pathFromPrev(fromStart.prev, start, farB);
    const across = bfsPath(graph, farA, farB);
    if (
      aPath.length > 1 &&
      bPath.length > 1 &&
      across.length > 1 &&
      !across.slice(1, -1).includes(start)
    ) {
      ids = dedupeIds([
        ...aPath,
        ...across.slice(1),
        ...bPath.slice(0, -1).reverse().slice(1),
        start,
      ]);
      loop = true;
    }
  }

  if (!ids || ids.length < 4) {
    const spine = pathFromPrev(fromStart.prev, start, farA);
    if (spine.length < 2) return null;
    ids = dedupeIds([...spine, ...spine.slice(0, -1).reverse()]);
    loop = false;
  }

  const points = ids.map((id) => {
    const n = graph.nodes.get(id)!;
    return { x: n.x, y: n.y };
  });
  const length = pathLength(points);
  const checkpoints = sampleCheckpoints(ids, graph, loop);
  if (checkpoints.length < MIN_CHECKPOINTS) return null;

  const roadKinds: Record<string, RoadKind> = {};
  for (const id of ids) {
    const n = graph.nodes.get(id)!;
    roadKinds[key(n.x, n.y)] = n.kind;
  }

  return {
    checkpoints,
    path: points,
    length,
    loop,
    seed: opts.seed,
    roadsVersion: state.roadsVersion,
    roadKinds,
  };
}

export function nearestTrackPoint(
  track: RaceTrack,
  x: number,
  y: number,
): NearestTrackPoint {
  if (track.path.length === 0)
    return {
      x,
      y,
      distance: Infinity,
      segmentIndex: -1,
      pathIndex: -1,
      progress: 0,
    };
  if (track.path.length === 1) {
    const p = track.path[0]!;
    return {
      x: p.x,
      y: p.y,
      distance: Math.hypot(x - p.x, y - p.y),
      segmentIndex: 0,
      pathIndex: 0,
      progress: 0,
    };
  }
  let best: NearestTrackPoint | null = null;
  let travelled = 0;
  for (let i = 0; i < track.path.length - 1; i++) {
    const a = track.path[i]!;
    const b = track.path[i + 1]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const segLen = Math.hypot(vx, vy);
    const t =
      segLen > 0
        ? clamp01(((x - a.x) * vx + (y - a.y) * vy) / (segLen * segLen))
        : 0;
    const px = a.x + vx * t;
    const py = a.y + vy * t;
    const d = Math.hypot(x - px, y - py);
    if (!best || d < best.distance) {
      best = {
        x: px,
        y: py,
        distance: d,
        segmentIndex: i,
        pathIndex: t > 0.5 ? i + 1 : i,
        progress: travelled + segLen * t,
      };
    }
    travelled += segLen;
  }
  return (
    best ?? {
      x,
      y,
      distance: Infinity,
      segmentIndex: -1,
      pathIndex: -1,
      progress: 0,
    }
  );
}

export function trackProgress(track: RaceTrack, x: number, y: number): number {
  if (track.length <= 0) return 0;
  return Math.max(
    0,
    Math.min(track.length, nearestTrackPoint(track, x, y).progress),
  );
}

function buildGraph(
  state: RaceRoadState,
  exclude: ReadonlySet<string>,
): RoadGraph {
  const W = state.terrain.size;
  const nodes = new Map<number, RoadNode>();
  for (const [k, kind] of state.roadKind.entries()) {
    if (exclude.has(k)) continue;
    const [x, y] = parseKey(k);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!state.terrain.inBounds(x, y) || state.terrain.isWater(x, y)) continue;
    nodes.set(y * W + x, { id: y * W + x, x, y, kind });
  }
  const edges = new Map<number, number[]>();
  for (const n of nodes.values()) {
    const ns: number[] = [];
    for (const [dx, dy] of DIRS) {
      const id = (n.y + dy) * W + (n.x + dx);
      if (nodes.has(id)) ns.push(id);
    }
    edges.set(n.id, ns);
  }
  return { W, nodes, edges };
}

function findStart(graph: RoadGraph, center: RacePoint | null): number | null {
  if (center) {
    let best: { id: number; d: number } | null = null;
    for (const n of graph.nodes.values()) {
      const d = Math.hypot(n.x - center.x, n.y - center.y);
      if (!best || d < best.d || (d === best.d && n.id < best.id))
        best = { id: n.id, d };
    }
    if (best) return best.id;
  }
  for (let y = 0; y < graph.W; y++) {
    for (let x = 0; x < graph.W; x++) {
      const id = y * graph.W + x;
      if (graph.nodes.has(id)) return id;
    }
  }
  return null;
}

function bfsAll(
  graph: RoadGraph,
  start: number,
): { prev: Map<number, number>; dist: Map<number, number> } {
  const prev = new Map<number, number>();
  const dist = new Map<number, number>([[start, 0]]);
  const q = [start];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++]!;
    const cd = dist.get(cur) ?? 0;
    for (const n of graph.edges.get(cur) ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, cd + 1);
      prev.set(n, cur);
      q.push(n);
    }
  }
  return { prev, dist };
}

function bfsPath(graph: RoadGraph, start: number, goal: number): number[] {
  if (start === goal) return [start];
  const { prev, dist } = bfsAll(graph, start);
  if (!dist.has(goal)) return [];
  return pathFromPrev(prev, start, goal);
}

function pathFromPrev(
  prev: Map<number, number>,
  start: number,
  goal: number,
): number[] {
  const out = [goal];
  let cur = goal;
  while (cur !== start) {
    const p = prev.get(cur);
    if (p === undefined) return [];
    out.push(p);
    cur = p;
  }
  out.reverse();
  return out;
}

function sampleCheckpoints(
  ids: number[],
  graph: RoadGraph,
  loop: boolean,
): RacePoint[] {
  const count = clamp(
    Math.round(ids.length / 42) + 3,
    MIN_CHECKPOINTS,
    MAX_CHECKPOINTS,
  );
  const out: RacePoint[] = [];
  const maxI = Math.max(0, ids.length - 1);
  for (let i = 0; i < count; i++) {
    const f = loop ? i / count : i / Math.max(1, count - 1);
    const idx = Math.min(maxI, Math.round(f * maxI));
    const n = graph.nodes.get(ids[idx]!)!;
    const p = { x: n.x, y: n.y };
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y || i === count - 1)
      out.push(p);
  }
  while (out.length < MIN_CHECKPOINTS && ids.length > out.length) {
    const n = graph.nodes.get(
      ids[
        Math.min(
          ids.length - 1,
          out.length * Math.floor(ids.length / MIN_CHECKPOINTS),
        )
      ]!,
    )!;
    out.push({ x: n.x, y: n.y });
  }
  return out.slice(0, MAX_CHECKPOINTS);
}

function pathLength(path: RacePoint[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++)
    len += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return len;
}

function dedupeIds(ids: number[]): number[] {
  const out: number[] = [];
  for (const id of ids) if (out[out.length - 1] !== id) out.push(id);
  return out;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function parseKey(k: string): [number, number] {
  const [xs, ys] = k.split(",");
  return [Number(xs), Number(ys)];
}

function roadScore(kind: RoadKind): number {
  return kind === "avenue" ? 3 : kind === "street" ? 2 : 1;
}

function hash01(id: number, seed: number): number {
  let h = Math.imul(id ^ seed, 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
