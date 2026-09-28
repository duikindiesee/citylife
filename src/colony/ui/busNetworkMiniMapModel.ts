import type { RoadWay } from "../render/roadRibbon";

export interface MiniMapPoint {
  x: number;
  y: number;
}
export interface MiniMapMovingPoint extends MiniMapPoint {
  /** The world position is outside the fixed road-network map bounds. */
  outOfBounds: boolean;
}
export interface MiniMapBusPoint extends MiniMapMovingPoint {
  id: number;
}
export interface MiniMapBusCluster extends MiniMapMovingPoint {
  ids: number[];
}
export type MiniMapLandmarkId = "gearbox" | "home" | "alice-shop";
export interface MiniMapLandmarkInput extends MiniMapPoint {
  id: MiniMapLandmarkId;
}
export interface MiniMapLandmark extends MiniMapMovingPoint {
  id: MiniMapLandmarkId;
  /** Collision-adjusted badge location; x/y remain the exact projected destination. */
  markerX: number;
  markerY: number;
}
export interface BusNetworkMiniMapModel {
  roads: { points: string; source: RoadWay["source"] }[];
  stops: MiniMapPoint[];
  depot: MiniMapPoint | null;
  buses: MiniMapBusPoint[];
  busClusters: MiniMapBusCluster[];
  /** Static, world-derived wayfinding targets. Account-specific home data is optional. */
  landmarks: MiniMapLandmark[];
  /** The local player's exact surface-grid fix, when the runtime has one. */
  player: MiniMapMovingPoint | null;
  bounds: { minX: number; minY: number; spanX: number; spanY: number };
}

interface Input {
  ways: RoadWay[];
  routeStops: { x: number; y: number }[];
  depot: { x: number; y: number } | null;
  buses: { id: number; x: number; y: number }[];
  player?: { x: number; y: number } | null;
  landmarks?: MiniMapLandmarkInput[];
  width: number;
  height: number;
  padding: number;
}

export function buildBusNetworkMiniMapModel(
  input: Input,
): BusNetworkMiniMapModel {
  // The map frame is derived from fixed roads plus static wayfinding targets. Including moving
  // buses or the player made the projection rescale every time a marker reached a new extreme.
  const landmarks = (input.landmarks ?? []).filter(
    (landmark) => Number.isFinite(landmark.x) && Number.isFinite(landmark.y),
  );
  const network = [
    ...input.ways.flatMap((way) => way.path),
    ...input.routeStops,
    ...(input.depot ? [input.depot] : []),
    ...landmarks,
  ];
  const xs = network.map((p) => p.x);
  const ys = network.map((p) => p.y);
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
  const projectMoving = (p: { x: number; y: number }): MiniMapMovingPoint => {
    const projected = project(p);
    const outOfBounds =
      p.x < rawMinX || p.x > rawMaxX || p.y < rawMinY || p.y > rawMaxY;
    return {
      x: Math.min(
        input.width - input.padding,
        Math.max(input.padding, projected.x),
      ),
      y: Math.min(
        input.height - input.padding,
        Math.max(input.padding, projected.y),
      ),
      outOfBounds,
    };
  };
  const buses = input.buses.map((b) => ({ id: b.id, ...projectMoving(b) }));
  const busClusters: MiniMapBusCluster[] = [];
  for (const bus of buses) {
    const cluster = busClusters.find(
      (c) => Math.hypot(c.x - bus.x, c.y - bus.y) < 8,
    );
    if (!cluster) {
      busClusters.push({
        x: bus.x,
        y: bus.y,
        outOfBounds: bus.outOfBounds,
        ids: [bus.id],
      });
    } else {
      const n = cluster.ids.length;
      cluster.x = (cluster.x * n + bus.x) / (n + 1);
      cluster.y = (cluster.y * n + bus.y) / (n + 1);
      cluster.outOfBounds ||= bus.outOfBounds;
      cluster.ids.push(bus.id);
    }
  }
  const projectedLandmarks = landmarks.map((landmark) => ({
    id: landmark.id,
    ...projectMoving(landmark),
  }));
  const occupied = [
    ...busClusters.map(({ x, y }) => ({ x, y })),
    ...input.routeStops.map(project),
    ...(input.depot ? [project(input.depot)] : []),
    ...(input.player ? [projectMoving(input.player)] : []),
  ];
  const badgeOffsets = [
    [0, 0],
    [0, -12],
    [12, 0],
    [-12, 0],
    [0, 12],
    [9, -9],
    [-9, -9],
    [9, 9],
    [-9, 9],
    [0, -18],
    [18, 0],
    [-18, 0],
    [0, 18],
  ] as const;
  const separatedLandmarks: MiniMapLandmark[] = [];
  for (const landmark of projectedLandmarks) {
    const otherLandmarks = separatedLandmarks.map(({ markerX, markerY }) => ({
      x: markerX,
      y: markerY,
    }));
    const candidates = badgeOffsets
      .map(([dx, dy]) => ({ x: landmark.x + dx, y: landmark.y + dy }))
      .filter(
        (candidate) =>
          candidate.x >= input.padding &&
          candidate.x <= input.width - input.padding &&
          candidate.y >= input.padding &&
          candidate.y <= input.height - input.padding,
      );
    const candidate =
      candidates.find((point) =>
        [...occupied, ...otherLandmarks].every(
          (other) => Math.hypot(point.x - other.x, point.y - other.y) >= 11,
        ),
      ) ?? candidates[0] ?? { x: landmark.x, y: landmark.y };
    separatedLandmarks.push({ ...landmark, markerX: candidate.x, markerY: candidate.y });
  }
  return {
    roads: input.ways.map((way) => ({
      source: way.source,
      points: way.path
        .map((p) => {
          const q = project(p);
          return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
        })
        .join(" "),
    })),
    stops: input.routeStops.map(project),
    depot: input.depot ? project(input.depot) : null,
    buses,
    busClusters,
    landmarks: separatedLandmarks,
    player: input.player ? projectMoving(input.player) : null,
    bounds: { minX: rawMinX, minY: rawMinY, spanX, spanY },
  };
}
