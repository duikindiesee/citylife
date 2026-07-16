// Versioned, deterministic persistence contract for the authoritative world layout.
//
// This document contains only durable spatial facts. Runtime presence, credentials, private bot
// state, placement previews and renderer/UI state have no fields in this schema; the strict parser
// rejects them instead of silently carrying them into a save.
import type { Biome, Buildable } from "../terrain";
import type { PlacementOrientation } from "../placement/placeableCatalog";
import type {
  GridBounds,
  GridCell,
  NavigationMode,
  SpatialFrameKind,
  SpatialGrid,
  SpatialLayer,
  SpatialTransform,
  Vec3,
  VerticalRange,
} from "../worldSurvey";

export const WORLD_LAYOUT_SCHEMA_VERSION = "citylife.world-layout/v1" as const;
export const WORLD_LAYOUT_V0_SCHEMA_VERSION =
  "citylife.world-layout/v0" as const;
/** Exact wire discriminator emitted by the already-pushed 5eeb814 codec. */
export const WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION = 1 as const;
export const WORLD_LAYOUT_HASH_ALGORITHM = "sha256" as const;
export const LEGACY_WORLD_LAYOUT_PROVENANCE = "legacy-seed-v3" as const;
export const WORLD_LAYOUT_GENERATOR = Object.freeze({
  id: "citylife-v3" as const,
  version: "3",
  placeableCatalogVersion: "1",
});

const EMPTY_HASH = "0".repeat(64);
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type WorldLayoutPlacementSource =
  | "seed"
  | "builder"
  | "simulation"
  | "import";

export type WorldLayoutRoadKind =
  | "avenue"
  | "street"
  | "path"
  | "gravel"
  | "culdesac";

export type WorldLayoutProvenance = typeof LEGACY_WORLD_LAYOUT_PROVENANCE;

export interface WorldLayoutGenerator {
  readonly id: typeof WORLD_LAYOUT_GENERATOR.id;
  readonly version: string;
  readonly placeableCatalogVersion: string;
}

export interface WorldLayoutAnchor {
  readonly id: string;
  readonly cell: GridCell;
}

export interface WorldLayoutFrame {
  readonly id: string;
  readonly address: string;
  readonly kind: SpatialFrameKind;
  readonly layer: SpatialLayer;
  readonly parentId?: string;
  readonly transform: SpatialTransform;
  readonly grid?: SpatialGrid;
}

export interface WorldLayoutPlacement {
  readonly id: string;
  readonly definitionId: string;
  readonly frameId: string;
  readonly layer: SpatialLayer;
  readonly source: WorldLayoutPlacementSource;
  readonly cells: readonly GridCell[];
  readonly bounds: GridBounds;
  readonly vertical: VerticalRange;
  readonly anchors: readonly WorldLayoutAnchor[];
  readonly orientation?: PlacementOrientation;
}

/** One logical persisted road. Cells are a set and therefore canonicalized north-to-south. */
export interface WorldLayoutRoad {
  readonly id: string;
  readonly frameId: string;
  readonly layer: SpatialLayer;
  readonly kind: WorldLayoutRoadKind;
  readonly cells: readonly GridCell[];
  readonly vertical: VerticalRange;
  readonly provenance?: WorldLayoutProvenance;
}

/** A rendered or navigable way. Cell order is meaningful and is deliberately preserved. */
export interface WorldLayoutWay {
  readonly id: string;
  readonly frameId: string;
  readonly layer: SpatialLayer;
  readonly kind: "avenue" | "street";
  readonly width: number;
  readonly cells: readonly GridCell[];
  /** Optional logical-road membership. Every listed id must resolve in `roads`. */
  readonly roadIds?: readonly string[];
  readonly provenance?: WorldLayoutProvenance;
}

/** Sparse exact override; omitted terrain properties continue to derive from the world seed. */
export interface WorldLayoutTerrainEdit {
  readonly id: string;
  readonly frameId: string;
  readonly cell: GridCell;
  readonly elevation?: number;
  readonly biome?: Biome;
  readonly buildability?: Buildable;
  readonly provenance?: WorldLayoutProvenance;
}

export type WorldLayoutZoneKind =
  | "residential"
  | "commercial"
  | "industrial"
  | "civic"
  | "protected"
  | "mixed-use"
  | "transport";

export interface WorldLayoutZone {
  readonly id: string;
  readonly frameId: string;
  readonly kind: WorldLayoutZoneKind;
  readonly cells: readonly GridCell[];
  readonly vertical: VerticalRange;
  /** Opaque authorization principal only; display/account data is forbidden. */
  readonly ownerRef?: string;
}

export interface WorldLayoutReservation {
  readonly id: string;
  readonly frameId: string;
  readonly purpose: string;
  readonly cells: readonly GridCell[];
  readonly vertical: VerticalRange;
  /** Opaque authorization principal only; display/account data is forbidden. */
  readonly ownerRef?: string;
}

export type WorldLayoutNetworkKind = "transport" | "utility";
export type WorldLayoutNetworkMode =
  | NavigationMode
  | "power"
  | "water"
  | "data";

export interface WorldLayoutNetworkNode {
  readonly id: string;
  readonly frameId: string;
  readonly position: Vec3;
  /** Optional references to stable layout records, never live entities. */
  readonly spatialIds?: readonly string[];
}

export interface WorldLayoutNetworkEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly modes: readonly WorldLayoutNetworkMode[];
  readonly bidirectional: boolean;
  /** Optional references to stable layout records, never vehicles or occupants. */
  readonly spatialIds?: readonly string[];
}

export interface WorldLayoutNetwork {
  readonly id: string;
  readonly kind: WorldLayoutNetworkKind;
  readonly modes: readonly WorldLayoutNetworkMode[];
  readonly nodes: readonly WorldLayoutNetworkNode[];
  readonly edges: readonly WorldLayoutNetworkEdge[];
}

export interface WorldLayoutPortal {
  readonly id: string;
  readonly address: string;
  readonly fromFrameId: string;
  readonly toFrameId: string;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly modes: readonly NavigationMode[];
}

export interface WorldLayoutRevision {
  /** Immutable repository-local revision sequence. */
  readonly number: number;
  /** SHA-256 of the direct parent revision, or null for the first revision. */
  readonly parentHash: string | null;
  /** SHA-256 over the canonical document projection excluding only this field. */
  readonly contentHash: string;
}

export interface WorldLayoutDocumentV1 {
  readonly schemaVersion: typeof WORLD_LAYOUT_SCHEMA_VERSION;
  /** Immutable repository identity written on the wire. */
  readonly layoutId: string;
  /**
   * Non-enumerable compatibility alias for runtime/store call sites. It is always exactly layoutId
   * and is never serialized or hashed.
   */
  readonly worldId: string;
  readonly seed: number;
  readonly generator: WorldLayoutGenerator;
  readonly revision: WorldLayoutRevision;
  readonly frames: readonly WorldLayoutFrame[];
  readonly zones: readonly WorldLayoutZone[];
  readonly reservations: readonly WorldLayoutReservation[];
  readonly placements: readonly WorldLayoutPlacement[];
  readonly roads: readonly WorldLayoutRoad[];
  readonly ways: readonly WorldLayoutWay[];
  readonly terrainEdits: readonly WorldLayoutTerrainEdit[];
  readonly networks: readonly WorldLayoutNetwork[];
  readonly portals: readonly WorldLayoutPortal[];
}

export type WorldLayoutDocument = WorldLayoutDocumentV1;

export type WorldLayoutTerrainEditInput = Omit<WorldLayoutTerrainEdit, "id"> & {
  readonly id?: string;
};

export type WorldLayoutDocumentInput = Omit<
  WorldLayoutDocumentV1,
  | "schemaVersion"
  | "revision"
  | "layoutId"
  | "worldId"
  | "generator"
  | "zones"
  | "reservations"
  | "terrainEdits"
  | "networks"
> & {
  readonly revision: Omit<WorldLayoutRevision, "contentHash">;
  readonly layoutId?: string;
  /** Compatibility input alias. When layoutId is also present they must match exactly. */
  readonly worldId: string;
  readonly generator?: WorldLayoutGenerator;
  readonly zones?: readonly WorldLayoutZone[];
  readonly reservations?: readonly WorldLayoutReservation[];
  readonly terrainEdits: readonly WorldLayoutTerrainEditInput[];
  readonly networks?: readonly WorldLayoutNetwork[];
};

export type WorldLayoutDocumentLayoutIdInput = Omit<
  WorldLayoutDocumentInput,
  "worldId" | "layoutId"
> & {
  readonly layoutId: string;
  readonly worldId?: never;
};

export type WorldLayoutDocumentErrorCode =
  | "INVALID_JSON"
  | "INVALID_DOCUMENT"
  | "UNKNOWN_VERSION"
  | "CONTENT_HASH_MISMATCH"
  | "REFERENTIAL_INTEGRITY"
  | "MIGRATION_FAILED";

export class WorldLayoutDocumentError extends Error {
  constructor(
    readonly code: WorldLayoutDocumentErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "WorldLayoutDocumentError";
  }
}

type JsonObject = Record<string, unknown>;

const SPATIAL_LAYERS = new Set<SpatialLayer>([
  "surface",
  "elevated",
  "interior",
  "subsurface",
  "air",
  "orbital",
  "deep-space",
]);
const FRAME_KINDS = new Set<SpatialFrameKind>([
  "universe",
  "world",
  "region",
  "building",
  "room",
]);
const NAVIGATION_MODES = new Set<NavigationMode>([
  "walk",
  "road",
  "bus",
  "rail",
  "tunnel",
  "portal",
  "air",
  "space",
]);
const ORIENTATIONS = new Set<PlacementOrientation>(["n", "s", "e", "w"]);
const PLACEMENT_SOURCES = new Set<WorldLayoutPlacementSource>([
  "seed",
  "builder",
  "simulation",
  "import",
]);
const ROAD_KINDS = new Set<WorldLayoutRoadKind>([
  "avenue",
  "street",
  "path",
  "gravel",
  "culdesac",
]);
const PROVENANCE_VALUES = new Set<WorldLayoutProvenance>([
  LEGACY_WORLD_LAYOUT_PROVENANCE,
]);
const ZONE_KINDS = new Set<WorldLayoutZoneKind>([
  "residential",
  "commercial",
  "industrial",
  "civic",
  "protected",
  "mixed-use",
  "transport",
]);
const NETWORK_KINDS = new Set<WorldLayoutNetworkKind>(["transport", "utility"]);
const NETWORK_MODES = new Set<WorldLayoutNetworkMode>([
  ...NAVIGATION_MODES,
  "power",
  "water",
  "data",
]);

function fail(
  path: string,
  message: string,
  code: WorldLayoutDocumentErrorCode = "INVALID_DOCUMENT",
): never {
  throw new WorldLayoutDocumentError(code, path, message);
}

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) fail(`${path}.${key}`, "unknown field");
  for (const key of required)
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "field is required");
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail(path, "must be a non-empty string");
  if (value.trim() !== value)
    fail(path, "must not have surrounding whitespace");
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        fail(path, "must not contain an unpaired Unicode surrogate");
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(path, "must not contain an unpaired Unicode surrogate");
    }
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "must be a finite number");
  if (Object.is(value, -0)) fail(path, "must not be negative zero");
  return value;
}

function integer(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (!Number.isSafeInteger(parsed)) fail(path, "must be a safe integer");
  return parsed;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = integer(value, path);
  if (parsed < 0) fail(path, "must not be negative");
  return parsed;
}

function uint32(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed > 0xffff_ffff) fail(path, "must be an unsigned 32-bit integer");
  return parsed;
}

function enumeration<T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
  path: string,
): T {
  if (typeof value !== "string" || !values.has(value as T))
    fail(path, `unsupported value ${JSON.stringify(value)}`);
  return value as T;
}

function vec3(value: unknown, path: string): Vec3 {
  const raw = object(value, path);
  exactKeys(raw, path, ["x", "y", "z"]);
  return {
    x: finite(raw.x, `${path}.x`),
    y: finite(raw.y, `${path}.y`),
    z: finite(raw.z, `${path}.z`),
  };
}

function gridCell(value: unknown, path: string): GridCell {
  const raw = object(value, path);
  exactKeys(raw, path, ["x", "y"]);
  return {
    x: integer(raw.x, `${path}.x`),
    y: integer(raw.y, `${path}.y`),
  };
}

function gridBounds(value: unknown, path: string): GridBounds {
  const raw = object(value, path);
  exactKeys(raw, path, ["x", "y", "w", "h"]);
  const bounds = {
    x: integer(raw.x, `${path}.x`),
    y: integer(raw.y, `${path}.y`),
    w: integer(raw.w, `${path}.w`),
    h: integer(raw.h, `${path}.h`),
  };
  if (bounds.w <= 0 || bounds.h <= 0)
    fail(path, "width and height must be positive");
  return bounds;
}

function verticalRange(value: unknown, path: string): VerticalRange {
  const raw = object(value, path);
  exactKeys(raw, path, ["min", "max", "clearanceBelow", "clearanceAbove"]);
  const vertical = {
    min: finite(raw.min, `${path}.min`),
    max: finite(raw.max, `${path}.max`),
    clearanceBelow: finite(raw.clearanceBelow, `${path}.clearanceBelow`),
    clearanceAbove: finite(raw.clearanceAbove, `${path}.clearanceAbove`),
  };
  if (vertical.max < vertical.min) fail(path, "max must be at least min");
  if (vertical.clearanceBelow < 0 || vertical.clearanceAbove < 0)
    fail(path, "clearances must not be negative");
  if (
    !Number.isFinite(vertical.min - vertical.clearanceBelow) ||
    !Number.isFinite(vertical.max + vertical.clearanceAbove)
  )
    fail(path, "effective vertical envelope must remain finite");
  return vertical;
}

function transform(value: unknown, path: string): SpatialTransform {
  const raw = object(value, path);
  exactKeys(raw, path, ["position", "rotation", "scale"]);
  const parsed = {
    position: vec3(raw.position, `${path}.position`),
    rotation: vec3(raw.rotation, `${path}.rotation`),
    scale: vec3(raw.scale, `${path}.scale`),
  };
  if (parsed.scale.x === 0 || parsed.scale.y === 0 || parsed.scale.z === 0)
    fail(`${path}.scale`, "components must be non-zero");
  return parsed;
}

function grid(value: unknown, path: string): SpatialGrid {
  const raw = object(value, path);
  exactKeys(raw, path, ["width", "height", "cellSize", "origin"]);
  const parsed = {
    width: integer(raw.width, `${path}.width`),
    height: integer(raw.height, `${path}.height`),
    cellSize: finite(raw.cellSize, `${path}.cellSize`),
    origin: vec3(raw.origin, `${path}.origin`),
  };
  if (parsed.width <= 0 || parsed.height <= 0 || parsed.cellSize <= 0)
    fail(path, "grid dimensions and cell size must be positive");
  return parsed;
}

const cellKey = (cell: GridCell): string => `${cell.x},${cell.y}`;
const sortCells = (a: GridCell, b: GridCell): number => a.y - b.y || a.x - b.x;
/** Code-unit ordering is identical across browser/Node locales and ICU versions. */
const compareString = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

function cells(
  value: unknown,
  path: string,
  options: { ordered: boolean; minimum?: number },
): GridCell[] {
  const parsed = array(value, path).map((item, index) =>
    gridCell(item, `${path}[${index}]`),
  );
  if (parsed.length < (options.minimum ?? 1))
    fail(path, `must contain at least ${options.minimum ?? 1} cell(s)`);
  if (options.ordered) return parsed;
  const seen = new Set<string>();
  for (const [index, cell] of parsed.entries()) {
    const key = cellKey(cell);
    if (seen.has(key)) fail(`${path}[${index}]`, `duplicate cell ${key}`);
    seen.add(key);
  }
  return parsed.sort(sortCells);
}

function frame(value: unknown, path: string): WorldLayoutFrame {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "address", "kind", "layer", "transform"],
    ["parentId", "grid"],
  );
  return {
    id: string(raw.id, `${path}.id`),
    address: string(raw.address, `${path}.address`),
    kind: enumeration(raw.kind, FRAME_KINDS, `${path}.kind`),
    layer: enumeration(raw.layer, SPATIAL_LAYERS, `${path}.layer`),
    ...(raw.parentId !== undefined
      ? { parentId: string(raw.parentId, `${path}.parentId`) }
      : {}),
    transform: transform(raw.transform, `${path}.transform`),
    ...(raw.grid !== undefined ? { grid: grid(raw.grid, `${path}.grid`) } : {}),
  };
}

function placement(value: unknown, path: string): WorldLayoutPlacement {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    [
      "id",
      "definitionId",
      "frameId",
      "layer",
      "source",
      "cells",
      "bounds",
      "vertical",
      "anchors",
    ],
    ["orientation"],
  );
  const parsedCells = cells(raw.cells, `${path}.cells`, { ordered: false });
  const bounds = gridBounds(raw.bounds, `${path}.bounds`);
  const minX = Math.min(...parsedCells.map((cell) => cell.x));
  const minY = Math.min(...parsedCells.map((cell) => cell.y));
  const maxX = Math.max(...parsedCells.map((cell) => cell.x));
  const maxY = Math.max(...parsedCells.map((cell) => cell.y));
  if (
    bounds.x !== minX ||
    bounds.y !== minY ||
    bounds.w !== maxX - minX + 1 ||
    bounds.h !== maxY - minY + 1
  )
    fail(`${path}.bounds`, "must be the exact tight bounds of cells");

  const anchors = array(raw.anchors, `${path}.anchors`)
    .map((item, index): WorldLayoutAnchor => {
      const anchorPath = `${path}.anchors[${index}]`;
      const anchor = object(item, anchorPath);
      exactKeys(anchor, anchorPath, ["id", "cell"]);
      return {
        id: string(anchor.id, `${anchorPath}.id`),
        cell: gridCell(anchor.cell, `${anchorPath}.cell`),
      };
    })
    .sort((a, b) => compareString(a.id, b.id));
  const anchorIds = new Set<string>();
  const occupied = new Set(parsedCells.map(cellKey));
  for (const [index, anchor] of anchors.entries()) {
    if (anchorIds.has(anchor.id))
      fail(`${path}.anchors[${index}].id`, `duplicate anchor ${anchor.id}`);
    anchorIds.add(anchor.id);
    if (!occupied.has(cellKey(anchor.cell)))
      fail(`${path}.anchors[${index}].cell`, "must belong to placement cells");
  }

  return {
    id: string(raw.id, `${path}.id`),
    definitionId: string(raw.definitionId, `${path}.definitionId`),
    frameId: string(raw.frameId, `${path}.frameId`),
    layer: enumeration(raw.layer, SPATIAL_LAYERS, `${path}.layer`),
    source: enumeration(raw.source, PLACEMENT_SOURCES, `${path}.source`),
    cells: parsedCells,
    bounds,
    vertical: verticalRange(raw.vertical, `${path}.vertical`),
    anchors,
    ...(raw.orientation !== undefined
      ? {
          orientation: enumeration(
            raw.orientation,
            ORIENTATIONS,
            `${path}.orientation`,
          ),
        }
      : {}),
  };
}

function road(value: unknown, path: string): WorldLayoutRoad {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "frameId", "layer", "kind", "cells", "vertical"],
    ["provenance"],
  );
  return {
    id: string(raw.id, `${path}.id`),
    frameId: string(raw.frameId, `${path}.frameId`),
    layer: enumeration(raw.layer, SPATIAL_LAYERS, `${path}.layer`),
    kind: enumeration(raw.kind, ROAD_KINDS, `${path}.kind`),
    cells: cells(raw.cells, `${path}.cells`, { ordered: false }),
    vertical: verticalRange(raw.vertical, `${path}.vertical`),
    ...(raw.provenance !== undefined
      ? {
          provenance: enumeration(
            raw.provenance,
            PROVENANCE_VALUES,
            `${path}.provenance`,
          ),
        }
      : {}),
  };
}

function way(value: unknown, path: string): WorldLayoutWay {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "frameId", "layer", "kind", "width", "cells"],
    ["roadIds", "provenance"],
  );
  const kind = enumeration(
    raw.kind,
    new Set<"avenue" | "street">(["avenue", "street"]),
    `${path}.kind`,
  );
  const width = finite(raw.width, `${path}.width`);
  if (width <= 0) fail(`${path}.width`, "must be positive");
  let roadIds: string[] | undefined;
  if (raw.roadIds !== undefined) {
    roadIds = array(raw.roadIds, `${path}.roadIds`)
      .map((item, index) => string(item, `${path}.roadIds[${index}]`))
      .sort();
    if (new Set(roadIds).size !== roadIds.length)
      fail(`${path}.roadIds`, "must not contain duplicates");
  }
  return {
    id: string(raw.id, `${path}.id`),
    frameId: string(raw.frameId, `${path}.frameId`),
    layer: enumeration(raw.layer, SPATIAL_LAYERS, `${path}.layer`),
    kind,
    width,
    cells: cells(raw.cells, `${path}.cells`, {
      ordered: true,
      minimum: 2,
    }),
    ...(roadIds !== undefined ? { roadIds } : {}),
    ...(raw.provenance !== undefined
      ? {
          provenance: enumeration(
            raw.provenance,
            PROVENANCE_VALUES,
            `${path}.provenance`,
          ),
        }
      : {}),
  };
}

function terrainEdit(value: unknown, path: string): WorldLayoutTerrainEdit {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "frameId", "cell"],
    ["elevation", "biome", "buildability", "provenance"],
  );
  if (
    raw.elevation === undefined &&
    raw.biome === undefined &&
    raw.buildability === undefined
  )
    fail(path, "must change elevation, biome or buildability");
  const biome =
    raw.biome === undefined ? undefined : integer(raw.biome, `${path}.biome`);
  if (biome !== undefined && (biome < 0 || biome > 8))
    fail(`${path}.biome`, "must be a known biome value (0..8)");
  const buildability =
    raw.buildability === undefined
      ? undefined
      : integer(raw.buildability, `${path}.buildability`);
  if (
    buildability !== undefined &&
    buildability !== 0 &&
    buildability !== 1 &&
    buildability !== 2
  )
    fail(`${path}.buildability`, "must be 0, 1 or 2");
  return {
    id: string(raw.id, `${path}.id`),
    frameId: string(raw.frameId, `${path}.frameId`),
    cell: gridCell(raw.cell, `${path}.cell`),
    ...(raw.elevation !== undefined
      ? { elevation: finite(raw.elevation, `${path}.elevation`) }
      : {}),
    ...(biome !== undefined ? { biome: biome as Biome } : {}),
    ...(buildability !== undefined
      ? { buildability: buildability as Buildable }
      : {}),
    ...(raw.provenance !== undefined
      ? {
          provenance: enumeration(
            raw.provenance,
            PROVENANCE_VALUES,
            `${path}.provenance`,
          ),
        }
      : {}),
  };
}

function opaqueOwnerRef(value: unknown, path: string): string {
  const ref = string(value, path);
  if (!/^principal:[A-Za-z0-9._:-]+$/.test(ref))
    fail(path, "must be an opaque principal: reference");
  return ref;
}

function zone(value: unknown, path: string): WorldLayoutZone {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "frameId", "kind", "cells", "vertical"],
    ["ownerRef"],
  );
  return {
    id: string(raw.id, `${path}.id`),
    frameId: string(raw.frameId, `${path}.frameId`),
    kind: enumeration(raw.kind, ZONE_KINDS, `${path}.kind`),
    cells: cells(raw.cells, `${path}.cells`, { ordered: false }),
    vertical: verticalRange(raw.vertical, `${path}.vertical`),
    ...(raw.ownerRef !== undefined
      ? { ownerRef: opaqueOwnerRef(raw.ownerRef, `${path}.ownerRef`) }
      : {}),
  };
}

function reservation(value: unknown, path: string): WorldLayoutReservation {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "frameId", "purpose", "cells", "vertical"],
    ["ownerRef"],
  );
  return {
    id: string(raw.id, `${path}.id`),
    frameId: string(raw.frameId, `${path}.frameId`),
    purpose: string(raw.purpose, `${path}.purpose`),
    cells: cells(raw.cells, `${path}.cells`, { ordered: false }),
    vertical: verticalRange(raw.vertical, `${path}.vertical`),
    ...(raw.ownerRef !== undefined
      ? { ownerRef: opaqueOwnerRef(raw.ownerRef, `${path}.ownerRef`) }
      : {}),
  };
}

function stringSet(value: unknown, path: string): string[] {
  const result = array(value, path)
    .map((item, index) => string(item, `${path}[${index}]`))
    .sort(compareString);
  if (new Set(result).size !== result.length)
    fail(path, "must not contain duplicates");
  return result;
}

function networkModes(value: unknown, path: string): WorldLayoutNetworkMode[] {
  const result = array(value, path)
    .map((item, index) => enumeration(item, NETWORK_MODES, `${path}[${index}]`))
    .sort(compareString);
  if (result.length === 0) fail(path, "must not be empty");
  if (new Set(result).size !== result.length)
    fail(path, "must not contain duplicates");
  return result;
}

function networkNode(value: unknown, path: string): WorldLayoutNetworkNode {
  const raw = object(value, path);
  exactKeys(raw, path, ["id", "frameId", "position"], ["spatialIds"]);
  return {
    id: string(raw.id, `${path}.id`),
    frameId: string(raw.frameId, `${path}.frameId`),
    position: vec3(raw.position, `${path}.position`),
    ...(raw.spatialIds !== undefined
      ? { spatialIds: stringSet(raw.spatialIds, `${path}.spatialIds`) }
      : {}),
  };
}

function networkEdge(value: unknown, path: string): WorldLayoutNetworkEdge {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "fromNodeId", "toNodeId", "modes", "bidirectional"],
    ["spatialIds"],
  );
  if (typeof raw.bidirectional !== "boolean")
    fail(`${path}.bidirectional`, "must be a boolean");
  return {
    id: string(raw.id, `${path}.id`),
    fromNodeId: string(raw.fromNodeId, `${path}.fromNodeId`),
    toNodeId: string(raw.toNodeId, `${path}.toNodeId`),
    modes: networkModes(raw.modes, `${path}.modes`),
    bidirectional: raw.bidirectional,
    ...(raw.spatialIds !== undefined
      ? { spatialIds: stringSet(raw.spatialIds, `${path}.spatialIds`) }
      : {}),
  };
}

function network(value: unknown, path: string): WorldLayoutNetwork {
  const raw = object(value, path);
  exactKeys(raw, path, ["id", "kind", "modes", "nodes", "edges"]);
  const modes = networkModes(raw.modes, `${path}.modes`);
  const nodes = array(raw.nodes, `${path}.nodes`)
    .map((item, index) => networkNode(item, `${path}.nodes[${index}]`))
    .sort((a, b) => compareString(a.id, b.id));
  const edges = array(raw.edges, `${path}.edges`)
    .map((item, index) => networkEdge(item, `${path}.edges[${index}]`))
    .sort((a, b) => compareString(a.id, b.id));
  return {
    id: string(raw.id, `${path}.id`),
    kind: enumeration(raw.kind, NETWORK_KINDS, `${path}.kind`),
    modes,
    nodes,
    edges,
  };
}

function generator(value: unknown, path: string): WorldLayoutGenerator {
  const raw = object(value, path);
  exactKeys(raw, path, ["id", "version", "placeableCatalogVersion"]);
  if (raw.id !== WORLD_LAYOUT_GENERATOR.id)
    fail(`${path}.id`, `unsupported generator ${JSON.stringify(raw.id)}`);
  const parsed = {
    id: WORLD_LAYOUT_GENERATOR.id,
    version: string(raw.version, `${path}.version`),
    placeableCatalogVersion: string(
      raw.placeableCatalogVersion,
      `${path}.placeableCatalogVersion`,
    ),
  };
  if (
    parsed.version !== WORLD_LAYOUT_GENERATOR.version ||
    parsed.placeableCatalogVersion !==
      WORLD_LAYOUT_GENERATOR.placeableCatalogVersion
  )
    fail(path, "unsupported generator or placeable catalog version");
  return parsed;
}

function portal(value: unknown, path: string): WorldLayoutPortal {
  const raw = object(value, path);
  exactKeys(raw, path, [
    "id",
    "address",
    "fromFrameId",
    "toFrameId",
    "from",
    "to",
    "modes",
  ]);
  const modes = array(raw.modes, `${path}.modes`)
    .map((item, index) =>
      enumeration(item, NAVIGATION_MODES, `${path}.modes[${index}]`),
    )
    .sort();
  if (modes.length === 0) fail(`${path}.modes`, "must not be empty");
  if (new Set(modes).size !== modes.length)
    fail(`${path}.modes`, "must not contain duplicates");
  return {
    id: string(raw.id, `${path}.id`),
    address: string(raw.address, `${path}.address`),
    fromFrameId: string(raw.fromFrameId, `${path}.fromFrameId`),
    toFrameId: string(raw.toFrameId, `${path}.toFrameId`),
    from: vec3(raw.from, `${path}.from`),
    to: vec3(raw.to, `${path}.to`),
    modes,
  };
}

function uniqueIds(
  values: readonly { id: string }[],
  path: string,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    if (result.has(value.id))
      fail(
        `${path}[${index}].id`,
        `duplicate id ${value.id}`,
        "REFERENTIAL_INTEGRITY",
      );
    result.set(value.id, index);
  }
  return result;
}

function validateNonOverlappingVolumes(
  values: readonly {
    readonly frameId: string;
    readonly cells: readonly GridCell[];
    readonly vertical: VerticalRange;
  }[],
  path: "zones" | "reservations",
): void {
  const occupied = new Map<
    string,
    { readonly index: number; readonly vertical: VerticalRange }[]
  >();
  for (const [index, value] of values.entries())
    for (const cell of value.cells) {
      const key = `${value.frameId}:${cellKey(cell)}`;
      const prior = occupied.get(key) ?? [];
      for (const entry of prior) {
        const valueMin = value.vertical.min - value.vertical.clearanceBelow;
        const valueMax = value.vertical.max + value.vertical.clearanceAbove;
        const entryMin = entry.vertical.min - entry.vertical.clearanceBelow;
        const entryMax = entry.vertical.max + entry.vertical.clearanceAbove;
        const overlaps = valueMin < entryMax && entryMin < valueMax;
        if (overlaps)
          fail(
            `$.${path}[${index}].cells`,
            `${path.slice(0, -1)} volume conflicts with $.${path}[${entry.index}] at ${key}`,
            "REFERENTIAL_INTEGRITY",
          );
      }
      prior.push({ index, vertical: value.vertical });
      occupied.set(key, prior);
    }
}

function validateReferences(document: WorldLayoutDocumentV1): void {
  const frameIndexes = uniqueIds(document.frames, "$.frames");
  const frameById = new Map(document.frames.map((item) => [item.id, item]));
  const addresses = new Set<string>();
  let roots = 0;
  for (const [index, item] of document.frames.entries()) {
    if (addresses.has(item.address))
      fail(
        `$.frames[${index}].address`,
        `duplicate address ${item.address}`,
        "REFERENTIAL_INTEGRITY",
      );
    addresses.add(item.address);
    if (item.parentId === undefined) roots++;
    else if (!frameIndexes.has(item.parentId))
      fail(
        `$.frames[${index}].parentId`,
        `unknown frame ${item.parentId}`,
        "REFERENTIAL_INTEGRITY",
      );
    else if (item.parentId === item.id)
      fail(
        `$.frames[${index}].parentId`,
        "frame cannot parent itself",
        "REFERENTIAL_INTEGRITY",
      );
  }
  if (roots !== 1)
    fail(
      "$.frames",
      `frame graph must have exactly one root; found ${roots}`,
      "REFERENTIAL_INTEGRITY",
    );
  for (const [index, item] of document.frames.entries()) {
    const seen = new Set<string>();
    let cursor: WorldLayoutFrame | undefined = item;
    while (cursor) {
      if (seen.has(cursor.id))
        fail(
          `$.frames[${index}].parentId`,
          `frame cycle through ${cursor.id}`,
          "REFERENTIAL_INTEGRITY",
        );
      seen.add(cursor.id);
      cursor = cursor.parentId ? frameById.get(cursor.parentId) : undefined;
    }
  }

  const terrainKeys = new Set<string>();
  document.terrainEdits.forEach((item, index) => {
    const key = `${item.frameId}:${cellKey(item.cell)}`;
    if (terrainKeys.has(key))
      fail(
        `$.terrainEdits[${index}]`,
        `duplicate sparse terrain edit ${key}`,
        "REFERENTIAL_INTEGRITY",
      );
    terrainKeys.add(key);
  });

  const placementIds = uniqueIds(document.placements, "$.placements");
  const zoneIds = uniqueIds(document.zones, "$.zones");
  const reservationIds = uniqueIds(document.reservations, "$.reservations");
  const roadIds = uniqueIds(document.roads, "$.roads");
  const wayIds = uniqueIds(document.ways, "$.ways");
  const terrainEditIds = uniqueIds(document.terrainEdits, "$.terrainEdits");
  const networkIds = uniqueIds(document.networks, "$.networks");
  const portalIds = uniqueIds(document.portals, "$.portals");
  const globalIds = new Map<string, string>();
  for (const [path, ids] of [
    ["frames", frameIndexes],
    ["zones", zoneIds],
    ["reservations", reservationIds],
    ["placements", placementIds],
    ["roads", roadIds],
    ["ways", wayIds],
    ["terrainEdits", terrainEditIds],
    ["networks", networkIds],
    ["portals", portalIds],
  ] as const)
    for (const id of ids.keys()) {
      const previous = globalIds.get(id);
      if (previous)
        fail(
          `$.${path}`,
          `id ${id} is already used by ${previous}`,
          "REFERENTIAL_INTEGRITY",
        );
      globalIds.set(id, path);
    }

  const requireFrame = (frameId: string, path: string): void => {
    if (!frameIndexes.has(frameId))
      fail(path, `unknown frame ${frameId}`, "REFERENTIAL_INTEGRITY");
  };
  const requireCellInFrame = (
    frameId: string,
    cell: GridCell,
    path: string,
  ): void => {
    const frame = frameById.get(frameId);
    if (!frame?.grid) return;
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      cell.x >= frame.grid.width ||
      cell.y >= frame.grid.height
    )
      fail(
        path,
        `cell ${cellKey(cell)} is outside frame grid ${frameId}`,
        "REFERENTIAL_INTEGRITY",
      );
  };
  const requirePositionInFrame = (
    frameId: string,
    position: Vec3,
    path: string,
  ): void => {
    const frame = frameById.get(frameId);
    if (!frame?.grid) return;
    const minX = frame.grid.origin.x;
    const minZ = frame.grid.origin.z;
    const maxX = minX + frame.grid.width * frame.grid.cellSize;
    const maxZ = minZ + frame.grid.height * frame.grid.cellSize;
    if (
      position.x < minX ||
      position.x >= maxX ||
      position.z < minZ ||
      position.z >= maxZ
    )
      fail(
        path,
        `position (${position.x}, ${position.y}, ${position.z}) is outside frame grid ${frameId}`,
        "REFERENTIAL_INTEGRITY",
      );
  };
  document.placements.forEach((item, index) => {
    requireFrame(item.frameId, `$.placements[${index}].frameId`);
    item.cells.forEach((cell, cellIndex) =>
      requireCellInFrame(
        item.frameId,
        cell,
        `$.placements[${index}].cells[${cellIndex}]`,
      ),
    );
  });
  document.zones.forEach((item, index) => {
    requireFrame(item.frameId, `$.zones[${index}].frameId`);
    item.cells.forEach((cell, cellIndex) =>
      requireCellInFrame(
        item.frameId,
        cell,
        `$.zones[${index}].cells[${cellIndex}]`,
      ),
    );
  });
  document.reservations.forEach((item, index) => {
    requireFrame(item.frameId, `$.reservations[${index}].frameId`);
    item.cells.forEach((cell, cellIndex) =>
      requireCellInFrame(
        item.frameId,
        cell,
        `$.reservations[${index}].cells[${cellIndex}]`,
      ),
    );
  });
  validateNonOverlappingVolumes(document.zones, "zones");
  validateNonOverlappingVolumes(document.reservations, "reservations");
  document.roads.forEach((item, index) => {
    requireFrame(item.frameId, `$.roads[${index}].frameId`);
    item.cells.forEach((cell, cellIndex) =>
      requireCellInFrame(
        item.frameId,
        cell,
        `$.roads[${index}].cells[${cellIndex}]`,
      ),
    );
  });
  document.ways.forEach((item, index) => {
    requireFrame(item.frameId, `$.ways[${index}].frameId`);
    item.cells.forEach((cell, cellIndex) =>
      requireCellInFrame(
        item.frameId,
        cell,
        `$.ways[${index}].cells[${cellIndex}]`,
      ),
    );
    item.roadIds?.forEach((roadId, roadIndex) => {
      if (!roadIds.has(roadId))
        fail(
          `$.ways[${index}].roadIds[${roadIndex}]`,
          `unknown road ${roadId}`,
          "REFERENTIAL_INTEGRITY",
        );
    });
  });
  document.terrainEdits.forEach((item, index) => {
    requireFrame(item.frameId, `$.terrainEdits[${index}].frameId`);
    requireCellInFrame(
      item.frameId,
      item.cell,
      `$.terrainEdits[${index}].cell`,
    );
  });
  const stableSpatialIds = new Set(globalIds.keys());
  document.networks.forEach((item, networkIndex) => {
    const nodeIds = uniqueIds(item.nodes, `$.networks[${networkIndex}].nodes`);
    const edgeIds = uniqueIds(item.edges, `$.networks[${networkIndex}].edges`);
    const localIds = new Set<string>();
    for (const [kind, ids] of [
      ["nodes", nodeIds],
      ["edges", edgeIds],
    ] as const)
      for (const id of ids.keys()) {
        if (localIds.has(id) || stableSpatialIds.has(id))
          fail(
            `$.networks[${networkIndex}].${kind}`,
            `duplicate global spatial id ${id}`,
            "REFERENTIAL_INTEGRITY",
          );
        localIds.add(id);
      }
    for (const [nodeIndex, node] of item.nodes.entries()) {
      requireFrame(
        node.frameId,
        `$.networks[${networkIndex}].nodes[${nodeIndex}].frameId`,
      );
      requirePositionInFrame(
        node.frameId,
        node.position,
        `$.networks[${networkIndex}].nodes[${nodeIndex}].position`,
      );
      node.spatialIds?.forEach((spatialId, spatialIndex) => {
        if (!stableSpatialIds.has(spatialId))
          fail(
            `$.networks[${networkIndex}].nodes[${nodeIndex}].spatialIds[${spatialIndex}]`,
            `unknown spatial record ${spatialId}`,
            "REFERENTIAL_INTEGRITY",
          );
      });
    }
    const declaredModes = new Set(item.modes);
    for (const [edgeIndex, edge] of item.edges.entries()) {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId))
        fail(
          `$.networks[${networkIndex}].edges[${edgeIndex}]`,
          "edge endpoints must resolve within the network",
          "REFERENTIAL_INTEGRITY",
        );
      if (edge.fromNodeId === edge.toNodeId)
        fail(
          `$.networks[${networkIndex}].edges[${edgeIndex}]`,
          "edge endpoints must be distinct",
          "REFERENTIAL_INTEGRITY",
        );
      for (const mode of edge.modes)
        if (!declaredModes.has(mode))
          fail(
            `$.networks[${networkIndex}].edges[${edgeIndex}].modes`,
            `edge mode ${mode} is not declared by its network`,
            "REFERENTIAL_INTEGRITY",
          );
      edge.spatialIds?.forEach((spatialId, spatialIndex) => {
        if (!stableSpatialIds.has(spatialId))
          fail(
            `$.networks[${networkIndex}].edges[${edgeIndex}].spatialIds[${spatialIndex}]`,
            `unknown spatial record ${spatialId}`,
            "REFERENTIAL_INTEGRITY",
          );
      });
    }
    for (const id of localIds) stableSpatialIds.add(id);
  });
  document.portals.forEach((item, index) => {
    requireFrame(item.fromFrameId, `$.portals[${index}].fromFrameId`);
    requireFrame(item.toFrameId, `$.portals[${index}].toFrameId`);
    if (item.fromFrameId === item.toFrameId)
      fail(
        `$.portals[${index}]`,
        "portal endpoints must belong to distinct frames",
        "REFERENTIAL_INTEGRITY",
      );
    requirePositionInFrame(
      item.fromFrameId,
      item.from,
      `$.portals[${index}].from`,
    );
    requirePositionInFrame(item.toFrameId, item.to, `$.portals[${index}].to`);
    if (addresses.has(item.address))
      fail(
        `$.portals[${index}].address`,
        `duplicate spatial address ${item.address}`,
        "REFERENTIAL_INTEGRITY",
      );
    addresses.add(item.address);
  });
}

type WorldLayoutHashProjection = Omit<
  WorldLayoutDocumentV1,
  "revision" | "worldId"
> & {
  readonly revision: Omit<WorldLayoutRevision, "contentHash">;
};

function canonicalPayload(
  document: WorldLayoutDocumentV1,
): WorldLayoutHashProjection {
  return {
    schemaVersion: document.schemaVersion,
    layoutId: document.layoutId,
    seed: document.seed,
    generator: document.generator,
    revision: {
      number: document.revision.number,
      parentHash: document.revision.parentHash,
    },
    frames: document.frames,
    zones: document.zones,
    reservations: document.reservations,
    placements: document.placements,
    roads: document.roads,
    ways: document.ways,
    terrainEdits: document.terrainEdits,
    networks: document.networks,
    portals: document.portals,
  };
}

/** Small browser-safe SHA-256; avoids a Node-only dependency in the shared world module. */
function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);
  const rotateRight = (word: number, shift: number): number =>
    (word >>> shift) | (word << (32 - shift));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) schedule[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = schedule[i - 15]!;
      const y = schedule[i - 2]!;
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      schedule[i] = (schedule[i - 16]! + s0 + schedule[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const sum1 =
        rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + sum1 + choice + constants[i]! + schedule[i]!) >>> 0;
      const sum0 =
        rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError(
        "canonical JSON only accepts finite non-negative-zero numbers",
      );
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareString)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`canonical JSON cannot encode ${typeof value}`);
}

function contentHashForCanonical(document: WorldLayoutDocumentV1): string {
  return sha256(canonicalJson(canonicalPayload(document)));
}

function revision(value: unknown, path: string): WorldLayoutRevision {
  const raw = object(value, path);
  exactKeys(raw, path, ["number", "parentHash", "contentHash"]);
  const number = nonNegativeInteger(raw.number, `${path}.number`);
  const parentHash =
    raw.parentHash === null
      ? null
      : string(raw.parentHash, `${path}.parentHash`);
  if (parentHash !== null && !HASH_PATTERN.test(parentHash))
    fail(
      `${path}.parentHash`,
      "must be null or a lowercase 64-character SHA-256 digest",
    );
  const contentHash = string(raw.contentHash, `${path}.contentHash`);
  if (!HASH_PATTERN.test(contentHash))
    fail(
      `${path}.contentHash`,
      "must be a lowercase 64-character SHA-256 digest",
    );
  return { number, parentHash, contentHash };
}

function parseV1(value: unknown, verifyHash: boolean): WorldLayoutDocumentV1 {
  const raw = object(value, "$");
  exactKeys(raw, "$", [
    "schemaVersion",
    "layoutId",
    "seed",
    "generator",
    "revision",
    "frames",
    "zones",
    "reservations",
    "placements",
    "roads",
    "ways",
    "terrainEdits",
    "networks",
    "portals",
  ]);
  if (raw.schemaVersion !== WORLD_LAYOUT_SCHEMA_VERSION)
    fail(
      "$.schemaVersion",
      `unsupported world layout schema version ${JSON.stringify(raw.schemaVersion)}`,
      "UNKNOWN_VERSION",
    );
  const document: WorldLayoutDocumentV1 = {
    schemaVersion: WORLD_LAYOUT_SCHEMA_VERSION,
    layoutId: string(raw.layoutId, "$.layoutId"),
    worldId: "",
    seed: uint32(raw.seed, "$.seed"),
    generator: generator(raw.generator, "$.generator"),
    revision: revision(raw.revision, "$.revision"),
    frames: array(raw.frames, "$.frames")
      .map((item, index) => frame(item, `$.frames[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    zones: array(raw.zones, "$.zones")
      .map((item, index) => zone(item, `$.zones[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    reservations: array(raw.reservations, "$.reservations")
      .map((item, index) => reservation(item, `$.reservations[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    placements: array(raw.placements, "$.placements")
      .map((item, index) => placement(item, `$.placements[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    roads: array(raw.roads, "$.roads")
      .map((item, index) => road(item, `$.roads[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    ways: array(raw.ways, "$.ways")
      .map((item, index) => way(item, `$.ways[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    terrainEdits: array(raw.terrainEdits, "$.terrainEdits").map((item, index) =>
      terrainEdit(item, `$.terrainEdits[${index}]`),
    ),
    networks: array(raw.networks, "$.networks")
      .map((item, index) => network(item, `$.networks[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    portals: array(raw.portals, "$.portals")
      .map((item, index) => portal(item, `$.portals[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
  };
  Object.defineProperty(document, "layoutId", {
    value: document.layoutId,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(document, "worldId", {
    value: document.layoutId,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  validateReferences(document);
  if (verifyHash) {
    const expected = contentHashForCanonical(document);
    if (document.revision.contentHash !== expected)
      fail(
        "$.revision.contentHash",
        `digest mismatch; expected ${expected}`,
        "CONTENT_HASH_MISMATCH",
      );
  }
  return document;
}

type WorldLayoutTerrainEditV0 = Omit<
  WorldLayoutTerrainEdit,
  "id" | "provenance"
>;

interface WorldLayoutDocumentV0 {
  readonly schemaVersion: typeof WORLD_LAYOUT_V0_SCHEMA_VERSION;
  readonly worldId: string;
  readonly seed: number;
  readonly revision: WorldLayoutRevision;
  readonly frames: readonly WorldLayoutFrame[];
  readonly placements: readonly WorldLayoutPlacement[];
  readonly roads: readonly WorldLayoutRoad[];
  readonly ways: readonly WorldLayoutWay[];
  readonly terrainEdits: readonly WorldLayoutTerrainEditV0[];
  readonly portals: readonly WorldLayoutPortal[];
}

interface WorldLayoutLegacyNumericV1 {
  readonly schemaVersion: typeof WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION;
  readonly worldId: string;
  readonly seed: number;
  readonly revision: WorldLayoutRevision;
  readonly frames: readonly WorldLayoutFrame[];
  readonly placements: readonly WorldLayoutPlacement[];
  readonly roads: readonly WorldLayoutRoad[];
  readonly ways: readonly WorldLayoutWay[];
  readonly terrainEdits: readonly WorldLayoutTerrainEditV0[];
  readonly portals: readonly WorldLayoutPortal[];
}

function roadV0(value: unknown, path: string): WorldLayoutRoad {
  const raw = object(value, path);
  exactKeys(raw, path, ["id", "frameId", "layer", "kind", "cells", "vertical"]);
  return road(raw, path);
}

function wayV0(value: unknown, path: string): WorldLayoutWay {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["id", "frameId", "layer", "kind", "width", "cells"],
    ["roadIds"],
  );
  return way(raw, path);
}

function terrainEditV0(value: unknown, path: string): WorldLayoutTerrainEditV0 {
  const raw = object(value, path);
  exactKeys(
    raw,
    path,
    ["frameId", "cell"],
    ["elevation", "biome", "buildability"],
  );
  const parsed = terrainEdit(
    {
      ...raw,
      id: `terrain:${String(raw.frameId)}:migration-placeholder`,
    },
    path,
  );
  const { id: _id, provenance: _provenance, ...legacy } = parsed;
  return legacy;
}

function normalizeLegacyNegativeZero(value: unknown): unknown {
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(normalizeLegacyNegativeZero);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeLegacyNegativeZero(item),
      ]),
    );
  return value;
}

/**
 * Verifier for the numeric schemaVersion:1 document emitted by commit 5eeb814.
 *
 * Its digest deliberately uses the predecessor's insertion-ordered JSON.stringify projection,
 * not the current recursive RFC 8785 canonicalizer. Keeping this parser separate prevents a
 * later codec cleanup from silently changing what historical bytes are accepted.
 */
function parseLegacyNumericV1(value: unknown): WorldLayoutLegacyNumericV1 {
  const raw = object(normalizeLegacyNegativeZero(value), "$numericV1");
  exactKeys(raw, "$numericV1", [
    "schemaVersion",
    "worldId",
    "seed",
    "revision",
    "frames",
    "placements",
    "roads",
    "ways",
    "terrainEdits",
    "portals",
  ]);
  if (raw.schemaVersion !== WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION)
    fail(
      "$numericV1.schemaVersion",
      `unsupported legacy numeric schema version ${JSON.stringify(raw.schemaVersion)}`,
      "UNKNOWN_VERSION",
    );
  const parsed: WorldLayoutLegacyNumericV1 = {
    schemaVersion: WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION,
    worldId: string(raw.worldId, "$numericV1.worldId"),
    seed: nonNegativeInteger(raw.seed, "$numericV1.seed"),
    revision: revision(raw.revision, "$numericV1.revision"),
    frames: array(raw.frames, "$numericV1.frames")
      .map((item, index) => frame(item, `$numericV1.frames[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    placements: array(raw.placements, "$numericV1.placements")
      .map((item, index) => placement(item, `$numericV1.placements[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    roads: array(raw.roads, "$numericV1.roads")
      .map((item, index) => roadV0(item, `$numericV1.roads[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    ways: array(raw.ways, "$numericV1.ways")
      .map((item, index) => wayV0(item, `$numericV1.ways[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    terrainEdits: array(raw.terrainEdits, "$numericV1.terrainEdits")
      .map((item, index) =>
        terrainEditV0(item, `$numericV1.terrainEdits[${index}]`),
      )
      .sort(
        (a, b) =>
          compareString(a.frameId, b.frameId) ||
          a.cell.y - b.cell.y ||
          a.cell.x - b.cell.x,
      ),
    portals: array(raw.portals, "$numericV1.portals")
      .map((item, index) => portal(item, `$numericV1.portals[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
  };
  const payload = {
    schemaVersion: parsed.schemaVersion,
    worldId: parsed.worldId,
    seed: parsed.seed,
    revision: {
      number: parsed.revision.number,
      parentHash: parsed.revision.parentHash,
    },
    frames: parsed.frames,
    placements: parsed.placements,
    roads: parsed.roads,
    ways: parsed.ways,
    terrainEdits: parsed.terrainEdits,
    portals: parsed.portals,
  };
  const expectedHash = sha256(JSON.stringify(payload));
  if (parsed.revision.contentHash !== expectedHash)
    fail(
      "$numericV1.revision.contentHash",
      `digest mismatch; expected ${expectedHash}`,
      "CONTENT_HASH_MISMATCH",
    );
  return parsed;
}

/**
 * Verify and migrate one predecessor row. Later revisions require the caller to supply the
 * recalculated parent hash from the preceding migrated row; standalone decoding only accepts the
 * unambiguous initial revision.
 */
export function migrateLegacyNumericWorldLayoutDocument(
  serializedOrValue: string | unknown,
  migratedParentHash?: string | null,
): WorldLayoutDocument {
  const source = parseLegacyNumericV1(decoded(serializedOrValue));
  if (source.seed > 0xffffffff)
    fail(
      "$numericV1.seed",
      "legacy seed cannot be represented by the current uint32 contract",
      "MIGRATION_FAILED",
    );
  let parentHash: string | null;
  if (source.revision.number === 0) {
    if (
      source.revision.parentHash !== null ||
      (migratedParentHash !== undefined && migratedParentHash !== null)
    )
      fail(
        "$numericV1.revision",
        "initial legacy revision must have null source and migrated parents",
        "MIGRATION_FAILED",
      );
    parentHash = null;
  } else {
    if (
      source.revision.parentHash === null ||
      migratedParentHash === undefined ||
      migratedParentHash === null
    )
      fail(
        "$numericV1.revision",
        "later legacy revision requires verified repository migration context",
        "MIGRATION_FAILED",
      );
    parentHash = migratedParentHash;
  }
  return createWorldLayoutDocument({
    layoutId: source.worldId,
    seed: source.seed,
    revision: { number: source.revision.number, parentHash },
    frames: source.frames,
    placements: source.placements,
    roads: source.roads.map((item) => ({
      ...item,
      provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
    })),
    ways: source.ways.map((item) => ({
      ...item,
      provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
    })),
    terrainEdits: source.terrainEdits.map((item) => ({
      ...item,
      provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
    })),
    portals: source.portals,
  });
}

function parseV0(value: unknown): WorldLayoutDocumentV0 {
  const raw = object(value, "$v0");
  exactKeys(raw, "$v0", [
    "schemaVersion",
    "worldId",
    "seed",
    "revision",
    "frames",
    "placements",
    "roads",
    "ways",
    "terrainEdits",
    "portals",
  ]);
  if (raw.schemaVersion !== WORLD_LAYOUT_V0_SCHEMA_VERSION)
    fail(
      "$v0.schemaVersion",
      `unsupported world layout schema version ${JSON.stringify(raw.schemaVersion)}`,
      "UNKNOWN_VERSION",
    );
  const parsed: WorldLayoutDocumentV0 = {
    schemaVersion: WORLD_LAYOUT_V0_SCHEMA_VERSION,
    worldId: string(raw.worldId, "$v0.worldId"),
    seed: uint32(raw.seed, "$v0.seed"),
    revision: revision(raw.revision, "$v0.revision"),
    frames: array(raw.frames, "$v0.frames")
      .map((item, index) => frame(item, `$v0.frames[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    placements: array(raw.placements, "$v0.placements")
      .map((item, index) => placement(item, `$v0.placements[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    roads: array(raw.roads, "$v0.roads")
      .map((item, index) => roadV0(item, `$v0.roads[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    ways: array(raw.ways, "$v0.ways")
      .map((item, index) => wayV0(item, `$v0.ways[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
    terrainEdits: array(raw.terrainEdits, "$v0.terrainEdits").map(
      (item, index) => terrainEditV0(item, `$v0.terrainEdits[${index}]`),
    ),
    portals: array(raw.portals, "$v0.portals")
      .map((item, index) => portal(item, `$v0.portals[${index}]`))
      .sort((a, b) => compareString(a.id, b.id)),
  };
  const payload = {
    ...parsed,
    revision: {
      number: parsed.revision.number,
      parentHash: parsed.revision.parentHash,
    },
  };
  const expectedHash = sha256(canonicalJson(payload));
  if (parsed.revision.contentHash !== expectedHash)
    fail(
      "$v0.revision.contentHash",
      `digest mismatch; expected ${expectedHash}`,
      "CONTENT_HASH_MISMATCH",
    );
  return parsed;
}

function migrateV0ToV1(value: unknown): WorldLayoutDocument {
  const source = parseV0(value);
  if (source.revision.number !== 0 || source.revision.parentHash !== null)
    fail(
      "$v0.revision",
      "v0 migration supports only the unambiguous initial revision",
      "MIGRATION_FAILED",
    );
  return createWorldLayoutDocument({
    layoutId: source.worldId,
    seed: source.seed,
    revision: { number: 0, parentHash: null },
    frames: source.frames,
    placements: source.placements,
    roads: source.roads.map((item) => ({
      ...item,
      provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
    })),
    ways: source.ways.map((item) => ({
      ...item,
      provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
    })),
    terrainEdits: source.terrainEdits.map((item) => ({
      ...item,
      provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
    })),
    portals: source.portals,
  });
}

type Migration = (value: unknown) => WorldLayoutDocument;

/**
 * Explicit dispatcher. A future schema adds a versioned migration here; unknown versions never
 * fall through to a best-effort parse that could silently lose world data.
 */
export const WORLD_LAYOUT_MIGRATIONS: Readonly<Record<string, Migration>> =
  Object.freeze({
    [WORLD_LAYOUT_V0_SCHEMA_VERSION]: migrateV0ToV1,
    [WORLD_LAYOUT_SCHEMA_VERSION]: (value: unknown) => parseV1(value, true),
  });

function decoded(value: string | unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    fail(
      "$",
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_JSON",
    );
  }
}

export function migrateWorldLayoutDocument(
  serializedOrValue: string | unknown,
): WorldLayoutDocument {
  const value = decoded(serializedOrValue);
  const raw = object(value, "$");
  const version = raw.schemaVersion;
  if (version === WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION)
    return migrateLegacyNumericWorldLayoutDocument(raw);
  if (typeof version !== "string" || version.length === 0)
    fail("$.schemaVersion", "must be a version identifier", "UNKNOWN_VERSION");
  const migration = WORLD_LAYOUT_MIGRATIONS[version];
  if (!migration)
    fail(
      "$.schemaVersion",
      `unsupported world layout schema version ${String(version)}`,
      "UNKNOWN_VERSION",
    );
  return migration(raw);
}

export function parseWorldLayoutDocument(
  serialized: string,
): WorldLayoutDocument {
  return migrateWorldLayoutDocument(serialized);
}

export function canonicalizeWorldLayoutDocument(
  value: WorldLayoutDocument,
): WorldLayoutDocument {
  return migrateWorldLayoutDocument(value);
}

/** Compute the digest from canonical durable fields, regardless of the input's current digest. */
export function computeWorldLayoutContentHash(
  value: WorldLayoutDocument,
): string {
  const { worldId: _worldId, ...wireValue } = value;
  const canonical = parseV1(
    {
      ...wireValue,
      revision: { ...value.revision, contentHash: EMPTY_HASH },
    },
    false,
  );
  return contentHashForCanonical(canonical);
}

export function createWorldLayoutDocument(
  input: WorldLayoutDocumentInput | WorldLayoutDocumentLayoutIdInput,
): WorldLayoutDocument {
  const layoutId = input.layoutId ?? input.worldId;
  if (layoutId === undefined)
    fail("$.layoutId", "layoutId or compatibility worldId is required");
  if (
    input.layoutId !== undefined &&
    input.worldId !== undefined &&
    input.layoutId !== input.worldId
  )
    fail(
      "$.layoutId",
      "layoutId and compatibility worldId must identify the same layout",
    );
  const { layoutId: _layoutId, worldId: _worldId, ...durableInput } = input;
  const terrainEdits = input.terrainEdits.map((edit) => ({
    ...edit,
    id: edit.id ?? `terrain:${edit.frameId}:${edit.cell.x},${edit.cell.y}`,
  }));
  const canonical = parseV1(
    {
      schemaVersion: WORLD_LAYOUT_SCHEMA_VERSION,
      ...durableInput,
      layoutId,
      generator: input.generator ?? WORLD_LAYOUT_GENERATOR,
      zones: input.zones ?? [],
      reservations: input.reservations ?? [],
      terrainEdits,
      networks: input.networks ?? [],
      revision: { ...input.revision, contentHash: EMPTY_HASH },
    },
    false,
  );
  const contentHash = contentHashForCanonical(canonical);
  return parseV1(
    {
      ...canonical,
      revision: { ...canonical.revision, contentHash },
    },
    true,
  );
}

/** External immutable revision identifier used by storage/CAS boundaries. */
export function worldLayoutRevisionId(revision: WorldLayoutRevision): string {
  return `wl:v1:${revision.number}:${revision.contentHash}`;
}

/**
 * Constant-size cryptographic accumulator for pruned immutable revision evidence.
 * The checkpoint commits every removed revision in order without retaining its full snapshot.
 */
export function computeWorldLayoutHistoryEvidenceHash(
  previousEvidenceHash: string,
  sequence: number,
  layoutRevision: string,
  contentHash: string,
  parentHash: string | null,
): string {
  if (!HASH_PATTERN.test(previousEvidenceHash))
    throw new TypeError("previousEvidenceHash must be a SHA-256 digest");
  if (!Number.isSafeInteger(sequence) || sequence < 0)
    throw new TypeError("sequence must be a non-negative safe integer");
  if (typeof layoutRevision !== "string" || layoutRevision.length === 0)
    throw new TypeError("layoutRevision must be non-empty");
  if (!HASH_PATTERN.test(contentHash))
    throw new TypeError("contentHash must be a SHA-256 digest");
  if (parentHash !== null && !HASH_PATTERN.test(parentHash))
    throw new TypeError("parentHash must be null or a SHA-256 digest");
  return sha256(
    canonicalJson({
      algorithm: "citylife.world-layout-history/sha256-chain-v1",
      contentHash,
      layoutRevision,
      parentHash,
      previousEvidenceHash,
      sequence,
    }),
  );
}

/** Canonical single-line wire form suitable for storage, signing and equality checks. */
export function serializeWorldLayoutDocument(
  document: WorldLayoutDocument,
): string {
  return canonicalJson(canonicalizeWorldLayoutDocument(document));
}
