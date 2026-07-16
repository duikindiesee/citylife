// Authoritative spatial survey registry for the living world.
//
// This module does not render anything. It gives the renderer, builder, runtime and tests one
// deterministic description of where terrain, plots, buildings, roads and transit live. The root
// coordinate space is deliberately unbounded: today's 608-cell island is a child region, so future
// islands, interiors, tunnels and orbital/deep-space frames can be added without moving existing
// ground or changing any of its stable addresses.
import type { CityPlan } from "./cityPlan";
import type { CommercialDistrict } from "./commerce/district";
import type { Neighborhood } from "./neighborhood";
import { CELL_SIZE } from "./scale";
import { Biome, type Buildable, type Terrain } from "./terrain";
import type { BusRoute } from "./transit/busRoute";

export const SURVEY_SCHEMA_VERSION = 1 as const;

export type SpatialLayer =
  | "surface"
  | "elevated"
  | "interior"
  | "subsurface"
  | "air"
  | "orbital"
  | "deep-space";

export type SpatialFrameKind =
  "universe" | "world" | "region" | "building" | "room";

export type SpatialRecordKind =
  | "structure"
  | "building"
  | "residential-plot"
  | "commercial-plot"
  | "garage"
  | "mall"
  | "road"
  | "intersection"
  | "bus-route"
  | "bus-stop"
  | "bus-depot"
  | "portal";

export type NavigationMode =
  "walk" | "road" | "bus" | "rail" | "tunnel" | "portal" | "air" | "space";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GridCell {
  x: number;
  y: number;
}

export interface GridBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frame-local vertical occupancy, in world metres. Clearances participate in collision checks. */
export interface VerticalRange {
  min: number;
  max: number;
  clearanceBelow: number;
  clearanceAbove: number;
}

export interface SpatialTransform {
  position: Vec3;
  /** Euler angles in radians. */
  rotation: Vec3;
  scale: Vec3;
}

export interface SpatialGrid {
  width: number;
  height: number;
  cellSize: number;
  /** World-space X/Z of grid cell (0,0), before the frame transform. */
  origin: Vec3;
}

export interface SpatialFrame {
  id: string;
  address: string;
  kind: SpatialFrameKind;
  layer: SpatialLayer;
  parentId?: string;
  transform: SpatialTransform;
  grid?: SpatialGrid;
  metadata?: Readonly<Record<string, unknown>>;
}

export type SpatialGeometry =
  | { type: "point"; cell?: GridCell; position: Vec3; vertical: VerticalRange }
  | {
      type: "footprint";
      bounds: GridBounds;
      elevation: number;
      yaw: number;
      vertical: VerticalRange;
    }
  | { type: "volume"; bounds: GridBounds; yaw: number; vertical: VerticalRange }
  | {
      type: "polyline";
      cells: readonly GridCell[];
      closed: boolean;
      vertical: VerticalRange;
    }
  | { type: "cell"; cell: GridCell; vertical: VerticalRange };

export interface SpatialRecord {
  id: string;
  address: string;
  frameId: string;
  layer: SpatialLayer;
  kind: SpatialRecordKind;
  geometry: SpatialGeometry;
  metadata: Readonly<Record<string, unknown>>;
}

export type SurfaceClass = "land" | "shore" | "sea" | "river";
export type WaterClass = "none" | "ocean" | "shallows" | "river";

export interface TerrainCellRecord {
  id: string;
  address: string;
  frameId: string;
  layer: "surface";
  kind: "terrain-cell";
  cell: GridCell;
  world: Vec3;
  biome: Biome;
  biomeName: string;
  surface: SurfaceClass;
  water: WaterClass;
  buildability: Buildable;
  elevation: number;
  /** Maximum absolute height delta to a cardinal neighbour, in world metres. */
  relief: number;
  distanceToWater: number;
}

export interface NavigationNode {
  id: string;
  address: string;
  frameId: string;
  layer: SpatialLayer;
  kind: "road" | "intersection" | "bus-stop" | "portal";
  cell?: GridCell;
  position: Vec3;
  metadata: Readonly<Record<string, unknown>>;
}

export interface NavigationEdge {
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  modes: readonly NavigationMode[];
  cost: number;
  metadata: Readonly<Record<string, unknown>>;
}

export interface SpatialPortal {
  id: string;
  address: string;
  fromFrameId: string;
  toFrameId: string;
  from: Vec3;
  to: Vec3;
  modes: readonly NavigationMode[];
  metadata: Readonly<Record<string, unknown>>;
}

export interface SurveyRoadCell extends GridCell {
  kind?: "avenue" | "street" | "path";
}

export interface SurveyRoadWay {
  path: readonly GridCell[];
  kind: "avenue" | "street";
  width: number;
  source?: string;
}

export interface SurveyStructure {
  kind: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  height?: number;
}

export interface SurveyBuilding {
  id: string | number;
  x: number;
  y: number;
  artifact?: { kind?: string };
  kind?: string;
  w?: number;
  h?: number;
  height?: number;
}

export interface WorldSurveySource {
  terrain: Terrain;
  /** Stable save/seed identity. It must not contain credentials or personal data. */
  worldId?: string;
  structures?: readonly SurveyStructure[];
  buildings?: readonly SurveyBuilding[];
  cityPlan?: CityPlan | null;
  neighborhood?: Neighborhood | null;
  neighborhoods?: readonly Neighborhood[];
  commercialDistrict?: CommercialDistrict | null;
  roads?: readonly SurveyRoadCell[];
  roadKind?: ReadonlyMap<string, "avenue" | "street" | "path">;
  roadWays?: readonly SurveyRoadWay[];
  busRoute?: BusRoute | null;
  busDepotPad?: GridBounds | null;
}

const ZERO_TRANSFORM: SpatialTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

const BIOME_NAME: Record<Biome, string> = {
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

const cleanId = (value: string | number): string =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unnamed";

const cellKey = (c: GridCell): string => `${c.x},${c.y}`;
const cellId = (frameId: string, c: GridCell): string =>
  `${frameId}:cell:${c.x}:${c.y}`;
const roadNodeId = (frameId: string, c: GridCell): string =>
  `${frameId}:nav:road:${c.x}:${c.y}`;

/** The exact transform already used by the R3F world. Do not add a half-cell offset. */
export function gridToWorld(
  size: number,
  x: number,
  y: number,
  elevation = 0,
): Vec3 {
  return {
    x: (x - size / 2) * CELL_SIZE,
    y: elevation,
    z: (y - size / 2) * CELL_SIZE,
  };
}

export function worldToGrid(
  size: number,
  position: Pick<Vec3, "x" | "z">,
): GridCell {
  return {
    x: position.x / CELL_SIZE + size / 2,
    y: position.z / CELL_SIZE + size / 2,
  };
}

export class WorldSurveyRegistry {
  readonly schemaVersion = SURVEY_SCHEMA_VERSION;
  readonly frames = new Map<string, SpatialFrame>();
  readonly records = new Map<string, SpatialRecord>();
  readonly nodes = new Map<string, NavigationNode>();
  readonly edges = new Map<string, NavigationEdge>();
  readonly portals = new Map<string, SpatialPortal>();

  constructor(
    readonly terrain: Terrain,
    readonly universeFrameId: string,
    readonly worldFrameId: string,
    readonly surfaceFrameId: string,
    readonly subsurfaceFrameId: string,
    readonly airFrameId: string,
    readonly orbitalFrameId: string,
    readonly deepSpaceFrameId: string,
  ) {}

  addFrame(frame: SpatialFrame): SpatialFrame {
    if (this.frames.has(frame.id))
      throw new Error(`duplicate spatial frame: ${frame.id}`);
    if (frame.parentId && !this.frames.has(frame.parentId))
      throw new Error(`unknown parent frame: ${frame.parentId}`);
    this.frames.set(frame.id, frame);
    return frame;
  }

  /** Register an interior, room, tunnel, island or off-world frame without moving its parent. */
  addChildFrame(input: {
    id: string;
    parentId: string;
    kind: Exclude<SpatialFrameKind, "universe">;
    layer: SpatialLayer;
    transform?: SpatialTransform;
    grid?: SpatialGrid;
    metadata?: Readonly<Record<string, unknown>>;
  }): SpatialFrame {
    const parent = this.frames.get(input.parentId);
    if (!parent) throw new Error(`unknown parent frame: ${input.parentId}`);
    const localId = cleanId(input.id);
    // Frame ids are globally stable while their final segment stays human-readable. Two buildings
    // may both have a "reception" room without colliding because ancestry is part of the id.
    const id = `${parent.id}:${input.kind}:${localId}`;
    return this.addFrame({
      id,
      address: `${parent.address}/${input.kind}/${localId}`,
      kind: input.kind,
      layer: input.layer,
      parentId: parent.id,
      transform: input.transform ?? ZERO_TRANSFORM,
      grid: input.grid,
      metadata: input.metadata,
    });
  }

  addRecord(record: SpatialRecord): SpatialRecord {
    if (!this.frames.has(record.frameId))
      throw new Error(`unknown record frame: ${record.frameId}`);
    if (this.records.has(record.id))
      throw new Error(`duplicate spatial record: ${record.id}`);
    this.records.set(record.id, record);
    return record;
  }

  addNode(node: NavigationNode): NavigationNode {
    if (!this.frames.has(node.frameId))
      throw new Error(`unknown node frame: ${node.frameId}`);
    if (this.nodes.has(node.id))
      throw new Error(`duplicate navigation node: ${node.id}`);
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(edge: NavigationEdge): NavigationEdge {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to))
      throw new Error(`navigation edge references an unknown node: ${edge.id}`);
    if (this.edges.has(edge.id))
      throw new Error(`duplicate navigation edge: ${edge.id}`);
    this.edges.set(edge.id, edge);
    return edge;
  }

  addPortal(portal: SpatialPortal): SpatialPortal {
    const fromFrame = this.frames.get(portal.fromFrameId);
    const toFrame = this.frames.get(portal.toFrameId);
    if (!fromFrame || !toFrame)
      throw new Error(`portal references an unknown frame: ${portal.id}`);
    if (this.portals.has(portal.id))
      throw new Error(`duplicate portal: ${portal.id}`);
    this.portals.set(portal.id, portal);
    this.addRecord({
      id: portal.id,
      address: portal.address,
      frameId: portal.fromFrameId,
      layer: fromFrame.layer,
      kind: "portal",
      geometry: {
        type: "point",
        position: portal.from,
        vertical: verticalRange(portal.from.y, portal.from.y),
      },
      metadata: {
        toFrameId: portal.toFrameId,
        to: portal.to,
        modes: portal.modes,
        ...portal.metadata,
      },
    });

    const fromId = `${portal.id}:from`;
    const toId = `${portal.id}:to`;
    this.addNode({
      id: fromId,
      address: `${portal.address}/from`,
      frameId: portal.fromFrameId,
      layer: fromFrame.layer,
      kind: "portal",
      position: portal.from,
      metadata: { portalId: portal.id },
    });
    this.addNode({
      id: toId,
      address: `${portal.address}/to`,
      frameId: portal.toFrameId,
      layer: toFrame.layer,
      kind: "portal",
      position: portal.to,
      metadata: { portalId: portal.id },
    });
    this.addEdge({
      id: `${portal.id}:edge`,
      from: fromId,
      to: toId,
      bidirectional: true,
      modes: portal.modes,
      cost: 1,
      metadata: { portalId: portal.id },
    });
    return portal;
  }

  terrainCell(x: number, y: number): TerrainCellRecord | undefined {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !this.terrain.inBounds(x, y)
    )
      return undefined;
    const i = this.terrain.idx(x, y);
    const biome = this.terrain.biome[i] as Biome;
    const elevation = this.terrain.worldY(x, y);
    return {
      id: cellId(this.surfaceFrameId, { x, y }),
      address: `${this.frames.get(this.surfaceFrameId)!.address}/cell/${x}/${y}`,
      frameId: this.surfaceFrameId,
      layer: "surface",
      kind: "terrain-cell",
      cell: { x, y },
      world: gridToWorld(this.terrain.size, x, y, elevation),
      biome,
      biomeName: BIOME_NAME[biome],
      surface: surfaceClass(this.terrain, x, y, biome),
      water: waterClass(this.terrain, x, y, biome),
      buildability: this.terrain.buildable[i] as Buildable,
      elevation,
      relief: reliefAt(this.terrain, x, y),
      distanceToWater: this.terrain.distToWater[i]!,
    };
  }

  /** Iterate exact cell metadata without duplicating the terrain arrays in memory. */
  *terrainCells(
    bounds: GridBounds = {
      x: 0,
      y: 0,
      w: this.terrain.size,
      h: this.terrain.size,
    },
  ): Generator<TerrainCellRecord> {
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(this.terrain.size, Math.ceil(bounds.x + bounds.w));
    const y1 = Math.min(this.terrain.size, Math.ceil(bounds.y + bounds.h));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) yield this.terrainCell(x, y)!;
  }

  /** Deterministic graph traversal used by tests, route planning and cross-frame navigation. */
  findPath(
    from: string,
    to: string,
    modes?: ReadonlySet<NavigationMode>,
  ): string[] | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    const adjacency = new Map<string, string[]>();
    const add = (a: string, b: string): void => {
      const list = adjacency.get(a) ?? [];
      list.push(b);
      adjacency.set(a, list);
    };
    for (const edge of [...this.edges.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (modes && !edge.modes.some((mode) => modes.has(mode))) continue;
      add(edge.from, edge.to);
      if (edge.bidirectional) add(edge.to, edge.from);
    }
    const previous = new Map<string, string | null>([[from, null]]);
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!;
      if (current === to) break;
      for (const next of (adjacency.get(current) ?? []).sort()) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        queue.push(next);
      }
    }
    if (!previous.has(to)) return null;
    const path: string[] = [];
    for (let at: string | null = to; at; at = previous.get(at) ?? null)
      path.push(at);
    return path.reverse();
  }
}

export function verticalRange(
  min: number,
  max: number,
  clearanceBelow = 0,
  clearanceAbove = 0,
): VerticalRange {
  if (![min, max, clearanceBelow, clearanceAbove].every(Number.isFinite))
    throw new Error("vertical range values must be finite");
  if (max < min)
    throw new Error("vertical range max must be greater than or equal to min");
  if (clearanceBelow < 0 || clearanceAbove < 0)
    throw new Error("vertical clearances must not be negative");
  return { min, max, clearanceBelow, clearanceAbove };
}

export function verticalRangesOverlap(
  a: VerticalRange,
  b: VerticalRange,
): boolean {
  const aMin = a.min - a.clearanceBelow;
  const aMax = a.max + a.clearanceAbove;
  const bMin = b.min - b.clearanceBelow;
  const bMax = b.max + b.clearanceAbove;
  return aMin < bMax && bMin < aMax;
}

function geometryBounds(geometry: SpatialGeometry): GridBounds | undefined {
  if (geometry.type === "footprint" || geometry.type === "volume")
    return geometry.bounds;
  if (geometry.type === "cell")
    return { x: geometry.cell.x, y: geometry.cell.y, w: 1, h: 1 };
  if (geometry.type === "point")
    return geometry.cell
      ? { x: geometry.cell.x, y: geometry.cell.y, w: 1, h: 1 }
      : undefined;
  if (geometry.cells.length === 0) return undefined;
  const xs = geometry.cells.map((cell) => cell.x);
  const ys = geometry.cells.map((cell) => cell.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

function boundsOverlap(a: GridBounds, b: GridBounds): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * Frame-local collision predicate. Equal X/Z in different frames is unambiguous (for example a
 * tunnel below a surface road); within one frame both horizontal occupancy and vertical clearance
 * must overlap before two records conflict.
 */
export function spatialRecordsConflict(
  a: SpatialRecord,
  b: SpatialRecord,
): boolean {
  if (a.frameId !== b.frameId) return false;
  const aBounds = geometryBounds(a.geometry);
  const bBounds = geometryBounds(b.geometry);
  return (
    !!aBounds &&
    !!bBounds &&
    boundsOverlap(aBounds, bBounds) &&
    verticalRangesOverlap(a.geometry.vertical, b.geometry.vertical)
  );
}

function surfaceClass(
  terrain: Terrain,
  x: number,
  y: number,
  biome: Biome,
): SurfaceClass {
  if (
    biome === Biome.River ||
    (terrain.water[terrain.idx(x, y)] === 1 &&
      biome !== Biome.Ocean &&
      biome !== Biome.Shallows)
  )
    return "river";
  if (biome === Biome.Ocean || biome === Biome.Shallows) return "sea";
  if (biome === Biome.Beach) return "shore";
  return "land";
}

function waterClass(
  terrain: Terrain,
  x: number,
  y: number,
  biome: Biome,
): WaterClass {
  if (biome === Biome.Ocean) return "ocean";
  if (biome === Biome.Shallows) return "shallows";
  if (biome === Biome.River || terrain.water[terrain.idx(x, y)] === 1)
    return "river";
  return "none";
}

function reliefAt(terrain: Terrain, x: number, y: number): number {
  const h = terrain.worldY(x, y);
  let relief = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (terrain.inBounds(nx, ny))
      relief = Math.max(relief, Math.abs(terrain.worldY(nx, ny) - h));
  }
  return relief;
}

function rectFromCenter(x: number, y: number, w = 1, h = 1): GridBounds {
  return { x: x - Math.floor(w / 2), y: y - Math.floor(h / 2), w, h };
}

function footprintElevation(terrain: Terrain, bounds: GridBounds): number {
  return terrain.worldYAt(
    bounds.x + (bounds.w - 1) / 2,
    bounds.y + (bounds.h - 1) / 2,
  );
}

function addPoint(
  registry: WorldSurveyRegistry,
  kind: SpatialRecordKind,
  sourceId: string | number,
  cell: GridCell,
  metadata: Readonly<Record<string, unknown>>,
): SpatialRecord {
  const id = `${registry.surfaceFrameId}:${kind}:${cleanId(sourceId)}`;
  const terrain = registry.terrainCell(cell.x, cell.y);
  const position =
    terrain?.world ?? gridToWorld(registry.terrain.size, cell.x, cell.y);
  return registry.addRecord({
    id,
    address: `${registry.frames.get(registry.surfaceFrameId)!.address}/${kind}/${cleanId(sourceId)}`,
    frameId: registry.surfaceFrameId,
    layer: "surface",
    kind,
    geometry: {
      type: "point",
      cell,
      position,
      vertical: verticalRange(position.y, position.y),
    },
    metadata,
  });
}

function addFootprint(
  registry: WorldSurveyRegistry,
  kind: SpatialRecordKind,
  sourceId: string | number,
  bounds: GridBounds,
  metadata: Readonly<Record<string, unknown>>,
  yaw = 0,
  height?: number,
): SpatialRecord {
  const id = `${registry.surfaceFrameId}:${kind}:${cleanId(sourceId)}`;
  const elevation = footprintElevation(registry.terrain, bounds);
  const exactHeight =
    height !== undefined && Number.isFinite(height) && height >= 0;
  return registry.addRecord({
    id,
    address: `${registry.frames.get(registry.surfaceFrameId)!.address}/${kind}/${cleanId(sourceId)}`,
    frameId: registry.surfaceFrameId,
    layer: "surface",
    kind,
    geometry: {
      type: "footprint",
      bounds,
      elevation,
      yaw,
      vertical: verticalRange(
        elevation,
        elevation + (exactHeight ? height : 0),
      ),
    },
    metadata: {
      exactFootprint: true,
      exactVerticalRange: exactHeight,
      ...metadata,
    },
  });
}

function hasDeclaredFootprint(value: {
  w?: number;
  h?: number;
}): value is { w: number; h: number } {
  return (
    Number.isFinite(value.w) &&
    Number.isFinite(value.h) &&
    value.w! > 0 &&
    value.h! > 0
  );
}

function cellVerticalRange(
  registry: WorldSurveyRegistry,
  cell: GridCell,
  height = 0,
): VerticalRange {
  const elevation = registry.terrainCell(cell.x, cell.y)?.elevation ?? 0;
  return verticalRange(elevation, elevation + height);
}

function cellsVerticalRange(
  registry: WorldSurveyRegistry,
  cells: readonly GridCell[],
  height = 0,
): VerticalRange {
  if (cells.length === 0) return verticalRange(0, height);
  const elevations = cells.map(
    (cell) => registry.terrainCell(cell.x, cell.y)?.elevation ?? 0,
  );
  return verticalRange(
    Math.min(...elevations),
    Math.max(...elevations) + height,
  );
}

function addRoadNetwork(
  registry: WorldSurveyRegistry,
  source: WorldSurveySource,
): void {
  const roadsByKey = new Map<string, SurveyRoadCell>();
  for (const road of source.roads ?? []) roadsByKey.set(cellKey(road), road);
  for (const [key, kind] of source.roadKind ?? []) {
    const [x, y] = key.split(",").map(Number);
    if (Number.isInteger(x) && Number.isInteger(y))
      roadsByKey.set(key, { x: x!, y: y!, kind });
  }
  const roads = [...roadsByKey.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  const roadKeys = new Set(roads.map(cellKey));
  for (const road of roads) {
    const neighbours = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dx, dy]) => ({ x: road.x + dx!, y: road.y + dy! }))
      .filter((cell) => roadKeys.has(cellKey(cell)));
    const isIntersection = neighbours.length >= 3;
    const nodeId = roadNodeId(registry.surfaceFrameId, road);
    const terrain = registry.terrainCell(road.x, road.y);
    registry.addNode({
      id: nodeId,
      address: `${registry.frames.get(registry.surfaceFrameId)!.address}/navigation/road/${road.x}/${road.y}`,
      frameId: registry.surfaceFrameId,
      layer: "surface",
      kind: isIntersection ? "intersection" : "road",
      cell: { x: road.x, y: road.y },
      position:
        terrain?.world ?? gridToWorld(registry.terrain.size, road.x, road.y),
      metadata: { roadKind: road.kind ?? "street", degree: neighbours.length },
    });
    registry.addRecord({
      id: `${registry.surfaceFrameId}:road:${road.x}:${road.y}`,
      address: `${registry.frames.get(registry.surfaceFrameId)!.address}/road/${road.x}/${road.y}`,
      frameId: registry.surfaceFrameId,
      layer: "surface",
      kind: isIntersection ? "intersection" : "road",
      geometry: {
        type: "cell",
        cell: { x: road.x, y: road.y },
        // Reserve the paved surface plus safe operating clearance. A subsurface tunnel below this
        // interval remains valid at the same grid X/Z.
        vertical: verticalRange(
          cellVerticalRange(registry, road).min,
          cellVerticalRange(registry, road, 0.5).max,
          1,
          4.5,
        ),
      },
      metadata: { roadKind: road.kind ?? "street", degree: neighbours.length },
    });
  }
  for (const road of roads) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const next = { x: road.x + dx, y: road.y + dy };
      if (!roadKeys.has(cellKey(next))) continue;
      const from = roadNodeId(registry.surfaceFrameId, road);
      const to = roadNodeId(registry.surfaceFrameId, next);
      registry.addEdge({
        id: `${registry.surfaceFrameId}:edge:road:${road.x}:${road.y}:${next.x}:${next.y}`,
        from,
        to,
        bidirectional: true,
        modes: ["walk", "road"],
        cost: CELL_SIZE,
        metadata: {},
      });
    }
  }
  for (const [index, way] of (source.roadWays ?? []).entries()) {
    registry.addRecord({
      id: `${registry.surfaceFrameId}:road-way:${index}`,
      address: `${registry.frames.get(registry.surfaceFrameId)!.address}/road-way/${index}`,
      frameId: registry.surfaceFrameId,
      layer: "surface",
      kind: "road",
      geometry: {
        type: "polyline",
        cells: way.path,
        closed: false,
        vertical: cellsVerticalRange(registry, way.path, 0.5),
      },
      metadata: {
        roadKind: way.kind,
        width: way.width,
        source: way.source ?? "world",
      },
    });
  }
}

function addBusNetwork(
  registry: WorldSurveyRegistry,
  source: WorldSurveySource,
): void {
  const route = source.busRoute;
  if (!route) return;
  const routeId = `${registry.surfaceFrameId}:bus-route:main`;
  registry.addRecord({
    id: routeId,
    address: `${registry.frames.get(registry.surfaceFrameId)!.address}/bus-route/main`,
    frameId: registry.surfaceFrameId,
    layer: "surface",
    kind: "bus-route",
    geometry: {
      type: "polyline",
      cells: route.loop,
      closed: true,
      vertical: cellsVerticalRange(registry, route.loop, 3.5),
    },
    metadata: { stopCount: route.stops.length },
  });
  for (const [index, stop] of route.stops.entries()) {
    const id = `${registry.surfaceFrameId}:bus-stop:${index}`;
    const address = `${registry.frames.get(registry.surfaceFrameId)!.address}/bus-stop/${index}`;
    const position =
      registry.terrainCell(stop.x, stop.y)?.world ??
      gridToWorld(registry.terrain.size, stop.x, stop.y);
    registry.addRecord({
      id,
      address,
      frameId: registry.surfaceFrameId,
      layer: "surface",
      kind: "bus-stop",
      geometry: {
        type: "point",
        cell: stop,
        position,
        vertical: verticalRange(position.y, position.y + 3),
      },
      metadata: { routeId, sequence: index },
    });
    const stopNodeId = `${id}:nav`;
    registry.addNode({
      id: stopNodeId,
      address: `${address}/navigation`,
      frameId: registry.surfaceFrameId,
      layer: "surface",
      kind: "bus-stop",
      cell: stop,
      position,
      metadata: { routeId, sequence: index },
    });
    const roadId = roadNodeId(registry.surfaceFrameId, stop);
    if (registry.nodes.has(roadId))
      registry.addEdge({
        id: `${id}:boarding`,
        from: stopNodeId,
        to: roadId,
        bidirectional: true,
        modes: ["walk", "bus"],
        cost: 0,
        metadata: { routeId },
      });
  }
  const stops = route.stops.map(
    (_, i) => `${registry.surfaceFrameId}:bus-stop:${i}:nav`,
  );
  if (stops.length === 0) return;
  for (let i = 0; i < stops.length; i++) {
    registry.addEdge({
      id: `${routeId}:segment:${i}`,
      from: stops[i]!,
      to: stops[(i + 1) % stops.length]!,
      bidirectional: false,
      modes: ["bus"],
      cost: 1,
      metadata: { routeId, sequence: i },
    });
  }
}

/** Build the deterministic current-world registry. No renderer or browser state is consulted. */
export function createWorldSurvey(
  source: WorldSurveySource,
): WorldSurveyRegistry {
  const worldName = cleanId(source.worldId ?? "colony-primary");
  const universeId = "universe:citylife";
  const worldId = `${universeId}:world:${worldName}`;
  const surfaceId = `${worldId}:region:surface`;
  const subsurfaceId = `${worldId}:region:subsurface`;
  const airId = `${worldId}:region:air`;
  const orbitalId = `${worldId}:region:orbital`;
  const deepSpaceId = `${worldId}:region:deep-space`;
  const registry = new WorldSurveyRegistry(
    source.terrain,
    universeId,
    worldId,
    surfaceId,
    subsurfaceId,
    airId,
    orbitalId,
    deepSpaceId,
  );
  registry.addFrame({
    id: universeId,
    address: "spatial://citylife",
    kind: "universe",
    layer: "deep-space",
    transform: ZERO_TRANSFORM,
    metadata: { extensible: true },
  });
  registry.addFrame({
    id: worldId,
    address: `spatial://citylife/world/${worldName}`,
    kind: "world",
    layer: "orbital",
    parentId: universeId,
    transform: ZERO_TRANSFORM,
    metadata: { worldId: worldName },
  });
  registry.addFrame({
    id: surfaceId,
    address: `spatial://citylife/world/${worldName}/region/surface`,
    kind: "region",
    layer: "surface",
    parentId: worldId,
    transform: ZERO_TRANSFORM,
    grid: {
      width: source.terrain.size,
      height: source.terrain.size,
      cellSize: CELL_SIZE,
      origin: gridToWorld(source.terrain.size, 0, 0),
    },
    metadata: {
      terrainCellCount: source.terrain.size * source.terrain.size,
      landing: source.terrain.landing,
    },
  });
  registry.addFrame({
    id: subsurfaceId,
    address: `spatial://citylife/world/${worldName}/region/subsurface`,
    kind: "region",
    layer: "subsurface",
    parentId: worldId,
    transform: ZERO_TRANSFORM,
    grid: {
      width: source.terrain.size,
      height: source.terrain.size,
      cellSize: CELL_SIZE,
      origin: gridToWorld(source.terrain.size, 0, 0),
    },
  });
  registry.addFrame({
    id: airId,
    address: `spatial://citylife/world/${worldName}/region/air`,
    kind: "region",
    layer: "air",
    parentId: worldId,
    transform: ZERO_TRANSFORM,
  });
  registry.addFrame({
    id: orbitalId,
    address: `spatial://citylife/world/${worldName}/region/orbital`,
    kind: "region",
    layer: "orbital",
    parentId: worldId,
    transform: ZERO_TRANSFORM,
  });
  registry.addFrame({
    id: deepSpaceId,
    address: `spatial://citylife/world/${worldName}/region/deep-space`,
    kind: "region",
    layer: "deep-space",
    parentId: worldId,
    transform: ZERO_TRANSFORM,
    metadata: { extensible: true },
  });

  for (const [index, structure] of (source.structures ?? []).entries()) {
    const metadata = { structureKind: structure.kind, sourceIndex: index };
    if (hasDeclaredFootprint(structure))
      addFootprint(
        registry,
        "structure",
        `${structure.kind}-${index}`,
        rectFromCenter(structure.x, structure.y, structure.w, structure.h),
        metadata,
        0,
        structure.height,
      );
    else
      addPoint(
        registry,
        "structure",
        `${structure.kind}-${index}`,
        { x: structure.x, y: structure.y },
        {
          ...metadata,
          exactFootprint: false,
          sourceGap: "seed structure dimensions are not declared",
        },
      );
  }
  for (const building of source.buildings ?? []) {
    const metadata = {
      buildingKind: building.kind ?? building.artifact?.kind ?? "unknown",
      sourceId: building.id,
    };
    if (hasDeclaredFootprint(building))
      addFootprint(
        registry,
        "building",
        building.id,
        rectFromCenter(building.x, building.y, building.w, building.h),
        metadata,
        0,
        building.height,
      );
    else
      addPoint(
        registry,
        "building",
        building.id,
        { x: building.x, y: building.y },
        {
          ...metadata,
          exactFootprint: false,
          sourceGap: "colony building dimensions are not declared",
        },
      );
  }
  for (const plot of source.cityPlan?.plots ?? []) {
    addFootprint(
      registry,
      "residential-plot",
      `city-plan-${plot.id}`,
      rectFromCenter(plot.x, plot.y, plot.w, plot.h),
      {
        plotId: plot.id,
        name: plot.name,
        vibe: plot.vibe,
        zone: plot.zone,
        assignedTo: plot.assignedTo,
        source: "city-plan",
      },
    );
  }
  const neighborhoods = [
    ...(source.neighborhoods ?? []),
    ...(source.neighborhood ? [source.neighborhood] : []),
  ];
  for (const [hoodIndex, hood] of neighborhoods.entries()) {
    for (const parcel of hood.parcels) {
      addFootprint(
        registry,
        "residential-plot",
        `hood-${hoodIndex}-${parcel.id}`,
        rectFromCenter(parcel.x, parcel.y, parcel.w, parcel.h),
        {
          plotId: parcel.id,
          neighborhoodKey: parcel.neighborhoodKey,
          built: parcel.built,
          ownerCitizenId: parcel.ownerCitizenId,
          source: "neighborhood",
        },
      );
    }
  }
  const commercial = source.commercialDistrict;
  if (commercial) {
    for (const parcel of commercial.parcels) {
      addFootprint(
        registry,
        "commercial-plot",
        parcel.id,
        { x: parcel.x, y: parcel.y, w: parcel.w, h: parcel.h },
        {
          plotId: parcel.id,
          shopKind: parcel.kind,
          business: parcel.business,
          built: parcel.built,
          ownerCitizenId: parcel.ownerCitizenId,
        },
      );
    }
    addFootprint(registry, "mall", "commercial-mall", commercial.mallPad, {
      source: "commercial-district",
    });
    if (commercial.garagePad)
      addFootprint(
        registry,
        "garage",
        "gearbox-auto-hub",
        commercial.garagePad,
        {
          publicName: commercial.garagePad.publicName,
          roadTarget: commercial.garagePad.roadTarget,
          islandCell: commercial.garagePad.islandCell,
        },
        commercial.garagePad.facingAngle,
      );
  }
  if (source.busDepotPad)
    addFootprint(registry, "bus-depot", "main", source.busDepotPad, {});
  addRoadNetwork(registry, source);
  addBusNetwork(registry, source);
  return registry;
}
