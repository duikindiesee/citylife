import type { RoadWay } from "../render/roadRibbon";

export interface MiniMapPoint { x: number; y: number }
export interface MiniMapBusPoint extends MiniMapPoint { id: number }
export interface MiniMapBusCluster extends MiniMapPoint { ids: number[] }
export interface BusNetworkMiniMapModel {
  roads: { points: string; source: RoadWay["source"] }[];
  stops: MiniMapPoint[];
  depot: MiniMapPoint | null;
  buses: MiniMapBusPoint[];
  busClusters: MiniMapBusCluster[];
  bounds: { minX: number; minY: number; spanX: number; spanY: number };
}

interface Input {
  ways: RoadWay[];
  routeStops: { x: number; y: number }[];
  depot: { x: number; y: number } | null;
  buses: { id: number; x: number; y: number }[];
  width: number;
  height: number;
  padding: number;
}

export function buildBusNetworkMiniMapModel(input: Input): BusNetworkMiniMapModel {
  const all = [
    ...input.ways.flatMap((way) => way.path),
    ...input.routeStops,
    ...input.buses,
    ...(input.depot ? [input.depot] : []),
  ];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const rawMinX = xs.length ? Math.min(...xs) : 0;
  const rawMaxX = xs.length ? Math.max(...xs) : 1;
  const rawMinY = ys.length ? Math.min(...ys) : 0;
  const rawMaxY = ys.length ? Math.max(...ys) : 1;
  const spanX = Math.max(1, rawMaxX - rawMinX);
  const spanY = Math.max(1, rawMaxY - rawMinY);
  const drawableW = Math.max(1, input.width - input.padding * 2);
  const drawableH = Math.max(1, input.height - input.padding * 2);
  const scale = Math.min(drawableW / spanX, drawableH / spanY);
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const ox = input.padding + (drawableW - usedW) / 2;
  const oy = input.padding + (drawableH - usedH) / 2;
  const project = (p: { x: number; y: number }): MiniMapPoint => ({
    x: ox + (p.x - rawMinX) * scale,
    y: oy + (p.y - rawMinY) * scale,
  });
  const buses = input.buses.map((b) => ({ id: b.id, ...project(b) }));
  const busClusters: MiniMapBusCluster[] = [];
  for (const bus of buses) {
    const cluster = busClusters.find((c) => Math.hypot(c.x - bus.x, c.y - bus.y) < 8);
    if (!cluster) busClusters.push({ x: bus.x, y: bus.y, ids: [bus.id] });
    else {
      const n = cluster.ids.length;
      cluster.x = (cluster.x * n + bus.x) / (n + 1);
      cluster.y = (cluster.y * n + bus.y) / (n + 1);
      cluster.ids.push(bus.id);
    }
  }
  return {
    roads: input.ways.map((way) => ({
      source: way.source,
      points: way.path.map((p) => {
        const q = project(p);
        return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
      }).join(" "),
    })),
    stops: input.routeStops.map(project),
    depot: input.depot ? project(input.depot) : null,
    buses,
    busClusters,
    bounds: { minX: rawMinX, minY: rawMinY, spanX, spanY },
  };
}
