import type { RoadWay } from "../render/roadRibbon";
import type {
  GridBounds,
  GridCell,
  SpatialFrame,
  SpatialLayer,
  SpatialPortal,
  VerticalRange,
} from "../worldSurvey";
import {
  createWorldLayoutDocument,
  parseWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutAnchor,
  type WorldLayoutDocument,
  type WorldLayoutPlacementSource,
  type WorldLayoutRoadKind,
  type WorldLayoutTerrainEdit,
} from "./worldLayoutDocument";

/**
 * The durable placement projection consumed by the layout codec. Account data, occupants,
 * blueprints, transient previews and renderer objects deliberately have no representation here.
 */
export interface RuntimeZonedPlacement {
  readonly id: string;
  readonly definitionId: string;
  readonly frameId: string;
  readonly layer: SpatialLayer;
  readonly source: WorldLayoutPlacementSource;
  readonly cells: readonly GridCell[];
  readonly bounds: GridBounds;
  readonly vertical: VerticalRange;
  readonly anchors: readonly WorldLayoutAnchor[];
  readonly orientation?: "n" | "s" | "e" | "w";
}

export interface RuntimeRoadCell extends GridCell {
  readonly kind: WorldLayoutRoadKind;
}

export interface WorldLayoutRuntimeSource {
  readonly worldId: string;
  readonly seed: number;
  readonly revision: {
    readonly number: number;
    readonly parentHash: string | null;
  };
  readonly surfaceFrameId: string;
  readonly frames: readonly SpatialFrame[];
  readonly portals: readonly SpatialPortal[];
  readonly terrainEdits: readonly WorldLayoutTerrainEdit[];
  readonly zonedPlacements: readonly RuntimeZonedPlacement[];
  readonly roads: readonly RuntimeRoadCell[];
  readonly roadWays: readonly RoadWay[];
  /** Logical road occupancy is two-dimensional; this is its declared surface clearance. */
  readonly roadVertical: VerticalRange;
}

export interface HydratedWorldLayout {
  readonly worldId: string;
  readonly seed: number;
  readonly layoutRevision: string;
  readonly revision: WorldLayoutDocument["revision"];
  readonly frames: readonly SpatialFrame[];
  readonly portals: readonly SpatialPortal[];
  readonly terrainEdits: readonly WorldLayoutTerrainEdit[];
  readonly zonedPlacements: readonly RuntimeZonedPlacement[];
  readonly roads: readonly RuntimeRoadCell[];
  readonly roadWays: readonly RoadWay[];
}

export class WorldLayoutAdapterError extends Error {
  constructor(
    readonly code:
      | "INVALID_RUNTIME_STATE"
      | "CONFLICTING_ROAD_CELL"
      | "ROAD_WAY_DISCONNECTED",
    message: string,
  ) {
    super(message);
    this.name = "WorldLayoutAdapterError";
  }
}

function copyCell(cell: GridCell): GridCell {
  return { x: cell.x, y: cell.y };
}

function copyVertical(vertical: VerticalRange): VerticalRange {
  return {
    min: vertical.min,
    max: vertical.max,
    clearanceBelow: vertical.clearanceBelow,
    clearanceAbove: vertical.clearanceAbove,
  };
}

function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`;
}

function roadId(frameId: string, kind: WorldLayoutRoadKind): string {
  return `road:${frameId}:${kind}`;
}

/** A short deterministic identifier for runtime ways, which do not yet carry their own stable id. */
function wayFingerprint(way: RoadWay): string {
  const value = `${way.kind}|${way.width}|${way.path
    .map((cell) => `${cell.x},${cell.y}`)
    .join(";")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Capture the runtime's durable spatial intent. Derived roadSet/roadKind indexes, way source tags,
 * frame metadata and portal metadata are intentionally ignored.
 */
export function captureWorldLayoutDocument(
  source: WorldLayoutRuntimeSource,
): WorldLayoutDocument {
  const roadsByKind = new Map<WorldLayoutRoadKind, Map<string, GridCell>>();
  for (const road of source.roads) {
    const cells = roadsByKind.get(road.kind) ?? new Map<string, GridCell>();
    cells.set(cellKey(road), copyCell(road));
    roadsByKind.set(road.kind, cells);
  }

  const roadKindsByCell = new Map<string, Set<WorldLayoutRoadKind>>();
  for (const [kind, cells] of roadsByKind)
    for (const key of cells.keys()) {
      const kinds = roadKindsByCell.get(key) ?? new Set<WorldLayoutRoadKind>();
      kinds.add(kind);
      roadKindsByCell.set(key, kinds);
    }
  for (const [key, kinds] of roadKindsByCell)
    if (kinds.size > 1)
      throw new WorldLayoutAdapterError(
        "CONFLICTING_ROAD_CELL",
        `runtime road cell ${key} has conflicting kinds: ${[...kinds].join(", ")}`,
      );

  for (const [wayIndex, way] of source.roadWays.entries())
    for (const cell of way.path)
      if (!roadKindsByCell.has(cellKey(cell)))
        throw new WorldLayoutAdapterError(
          "ROAD_WAY_DISCONNECTED",
          `runtime way ${wayIndex} references non-road cell ${cellKey(cell)}`,
        );

  const wayIds = new Map<string, number>();
  return createWorldLayoutDocument({
    worldId: source.worldId,
    seed: source.seed,
    revision: source.revision,
    frames: source.frames.map((frame) => ({
      id: frame.id,
      address: frame.address,
      kind: frame.kind,
      layer: frame.layer,
      ...(frame.parentId ? { parentId: frame.parentId } : {}),
      transform: {
        position: { ...frame.transform.position },
        rotation: { ...frame.transform.rotation },
        scale: { ...frame.transform.scale },
      },
      ...(frame.grid
        ? {
            grid: {
              width: frame.grid.width,
              height: frame.grid.height,
              cellSize: frame.grid.cellSize,
              origin: { ...frame.grid.origin },
            },
          }
        : {}),
    })),
    placements: source.zonedPlacements.map((placement) => ({
      id: placement.id,
      definitionId: placement.definitionId,
      frameId: placement.frameId,
      layer: placement.layer,
      source: placement.source,
      cells: placement.cells.map(copyCell),
      bounds: { ...placement.bounds },
      vertical: copyVertical(placement.vertical),
      anchors: placement.anchors.map((anchor) => ({
        id: anchor.id,
        cell: copyCell(anchor.cell),
      })),
      ...(placement.orientation
        ? { orientation: placement.orientation }
        : {}),
    })),
    roads: [...roadsByKind.entries()].map(([kind, cells]) => ({
      id: roadId(source.surfaceFrameId, kind),
      frameId: source.surfaceFrameId,
      layer: "surface" as const,
      kind,
      cells: [...cells.values()],
      vertical: copyVertical(source.roadVertical),
    })),
    ways: source.roadWays.map((way) => {
      const fingerprint = wayFingerprint(way);
      const occurrence = wayIds.get(fingerprint) ?? 0;
      wayIds.set(fingerprint, occurrence + 1);
      const referencedKinds = new Set<WorldLayoutRoadKind>();
      for (const cell of way.path)
        for (const kind of roadKindsByCell.get(cellKey(cell)) ?? [])
          referencedKinds.add(kind);
      return {
        id: `way:${source.surfaceFrameId}:${fingerprint}:${occurrence}`,
        frameId: source.surfaceFrameId,
        layer: "surface" as const,
        kind: way.kind,
        width: way.width,
        cells: way.path.map(copyCell),
        ...(referencedKinds.size > 0
          ? {
              roadIds: [...referencedKinds].map((kind) =>
                roadId(source.surfaceFrameId, kind),
              ),
            }
          : {}),
      };
    }),
    terrainEdits: source.terrainEdits.map((edit) => ({
      frameId: edit.frameId,
      cell: copyCell(edit.cell),
      ...(edit.elevation !== undefined ? { elevation: edit.elevation } : {}),
      ...(edit.biome !== undefined ? { biome: edit.biome } : {}),
      ...(edit.buildability !== undefined
        ? { buildability: edit.buildability }
        : {}),
    })),
    portals: source.portals.map((portal) => ({
      id: portal.id,
      address: portal.address,
      fromFrameId: portal.fromFrameId,
      toFrameId: portal.toFrameId,
      from: { ...portal.from },
      to: { ...portal.to },
      modes: [...portal.modes],
    })),
  });
}

/**
 * Validate and materialize every runtime slice before the optional single commit call. A codec or
 * adapter failure therefore cannot expose a partially hydrated world.
 */
export function applyWorldLayoutDocument(
  input: WorldLayoutDocument,
  commit?: (candidate: HydratedWorldLayout) => void,
): HydratedWorldLayout {
  const document = parseWorldLayoutDocument(JSON.stringify(input));
  const roads = new Map<string, RuntimeRoadCell>();
  for (const road of document.roads)
    for (const cell of road.cells) {
      const key = `${road.frameId}:${cellKey(cell)}`;
      const prior = roads.get(key);
      if (prior && prior.kind !== road.kind)
        throw new WorldLayoutAdapterError(
          "CONFLICTING_ROAD_CELL",
          `layout road cell ${key} has conflicting kinds: ${prior.kind}, ${road.kind}`,
        );
      roads.set(key, { ...copyCell(cell), kind: road.kind });
    }
  const logicalRoadCells = new Set(roads.keys());
  for (const way of document.ways)
    for (const cell of way.cells)
      if (!logicalRoadCells.has(`${way.frameId}:${cellKey(cell)}`))
        throw new WorldLayoutAdapterError(
          "ROAD_WAY_DISCONNECTED",
          `layout way ${way.id} references non-road cell ${cellKey(cell)}`,
        );

  const candidate: HydratedWorldLayout = {
    worldId: document.worldId,
    seed: document.seed,
    layoutRevision: worldLayoutRevisionId(document.revision),
    revision: { ...document.revision },
    frames: document.frames.map((frame) => ({
      ...frame,
      transform: {
        position: { ...frame.transform.position },
        rotation: { ...frame.transform.rotation },
        scale: { ...frame.transform.scale },
      },
      ...(frame.grid
        ? { grid: { ...frame.grid, origin: { ...frame.grid.origin } } }
        : {}),
    })),
    portals: document.portals.map((portal) => ({
      ...portal,
      from: { ...portal.from },
      to: { ...portal.to },
      modes: [...portal.modes],
      metadata: {},
    })),
    terrainEdits: document.terrainEdits.map((edit) => ({
      ...edit,
      cell: copyCell(edit.cell),
    })),
    zonedPlacements: document.placements.map((placement) => ({
      ...placement,
      cells: placement.cells.map(copyCell),
      bounds: { ...placement.bounds },
      vertical: copyVertical(placement.vertical),
      anchors: placement.anchors.map((anchor) => ({
        ...anchor,
        cell: copyCell(anchor.cell),
      })),
    })),
    roads: [...roads.values()],
    roadWays: document.ways.map((way) => ({
      path: way.cells.map(copyCell),
      kind: way.kind,
      width: way.width,
    })),
  };

  commit?.(candidate);
  return candidate;
}

/** Convert renderer offsets into exact authored elevations before persistence. */
export function terrainEditsFromLandscapeOffsets(
  offsets: ReadonlyMap<string, number>,
  frameId: string,
  baseElevationAt: (x: number, y: number) => number,
): readonly WorldLayoutTerrainEdit[] {
  return [...offsets.entries()].map(([key, offset]) => {
    const match = /^(-?\d+),(-?\d+)$/.exec(key);
    if (!match || !Number.isFinite(offset))
      throw new WorldLayoutAdapterError(
        "INVALID_RUNTIME_STATE",
        `invalid landscape edit ${key}`,
      );
    const x = Number(match[1]);
    const y = Number(match[2]);
    const base = baseElevationAt(x, y);
    if (!Number.isFinite(base))
      throw new WorldLayoutAdapterError(
        "INVALID_RUNTIME_STATE",
        `invalid base elevation for ${key}`,
      );
    return { frameId, cell: { x, y }, elevation: base + offset };
  });
}

/** Rebuild the current renderer's offset view from authoritative absolute terrain elevations. */
export function landscapeOffsetsFromTerrainEdits(
  edits: readonly WorldLayoutTerrainEdit[],
  baseElevationAt: (x: number, y: number) => number,
): ReadonlyMap<string, number> {
  const offsets = new Map<string, number>();
  for (const edit of edits) {
    if (edit.elevation === undefined) continue;
    const base = baseElevationAt(edit.cell.x, edit.cell.y);
    if (!Number.isFinite(base))
      throw new WorldLayoutAdapterError(
        "INVALID_RUNTIME_STATE",
        `invalid base elevation for ${cellKey(edit.cell)}`,
      );
    offsets.set(cellKey(edit.cell), edit.elevation - base);
  }
  return offsets;
}

export interface RuntimeParcelLike {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly doorX: number;
  readonly doorY: number;
  readonly zone?: "residential" | "commercial";
  readonly kind?: "kiosk" | "store" | "showroom";
  readonly gate?: GridCell;
}

function footprintCells(bounds: GridBounds): GridCell[] {
  const cells: GridCell[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++)
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) cells.push({ x, y });
  return cells;
}

function parcelTier(w: number, h: number): string {
  const key = [w, h].sort((a, b) => a - b).join("x");
  return (
    {
      "9x11": "compact",
      "11x14": "big",
      "23x29": "estate",
      "27x33": "grand",
    }[key] ?? "custom"
  );
}

function orientationFromGate(
  gate: GridCell | undefined,
  bounds: GridBounds,
): "n" | "s" | "e" | "w" | undefined {
  if (!gate) return undefined;
  if (gate.y === bounds.y) return "n";
  if (gate.y === bounds.y + bounds.h - 1) return "s";
  if (gate.x === bounds.x) return "w";
  if (gate.x === bounds.x + bounds.w - 1) return "e";
  return undefined;
}

/**
 * Project a residential/runtime parcel or commercial shop into its exact public spatial shape.
 * Structural typing lets the real Parcel/ShopParcel objects pass while owner and blueprint fields
 * remain impossible to copy accidentally.
 */
export function zonedPlacementFromParcel(
  parcel: RuntimeParcelLike,
  frameId: string,
  vertical: VerticalRange,
  source: WorldLayoutPlacementSource = parcel.id.startsWith("dynamic-")
    ? "builder"
    : "seed",
): RuntimeZonedPlacement {
  const isShop = parcel.kind !== undefined;
  const bounds = isShop
    ? { x: parcel.x, y: parcel.y, w: parcel.w, h: parcel.h }
    : {
        x: parcel.x - Math.floor((parcel.w - 1) / 2),
        y: parcel.y - Math.floor((parcel.h - 1) / 2),
        w: parcel.w,
        h: parcel.h,
      };
  const cells = footprintCells(bounds);
  const occupied = new Set(cells.map(cellKey));
  const anchors: WorldLayoutAnchor[] = [];
  if (parcel.gate && occupied.has(cellKey(parcel.gate)))
    anchors.push({ id: "gate", cell: copyCell(parcel.gate) });
  const door = { x: parcel.doorX, y: parcel.doorY };
  if (occupied.has(cellKey(door)))
    anchors.push({ id: "entrance", cell: door });
  const orientation = orientationFromGate(parcel.gate, bounds);
  return {
    id: `placement:${parcel.id}`,
    definitionId: isShop
      ? `commercial-plot:${parcel.kind}`
      : `zoned-plot:${parcel.zone ?? "residential"}:${parcelTier(parcel.w, parcel.h)}`,
    frameId,
    layer: "surface",
    source,
    cells,
    bounds,
    vertical: copyVertical(vertical),
    anchors,
    ...(orientation ? { orientation } : {}),
  };
}
