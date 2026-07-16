import type {
  GridBounds,
  GridCell,
  SpatialRecord,
  TerrainCellRecord,
  Vec3,
  WorldSurveyRegistry,
} from "../worldSurvey";

export type SurveyTerrainLayer = "surface" | "buildability" | "elevation";

export interface SurveyMapProjection {
  readonly frameId: string;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly padding: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface SurveyMapOverlayModel {
  readonly roadCells: readonly SpatialRecord[];
  readonly roadPaths: readonly SpatialRecord[];
  readonly intersections: readonly SpatialRecord[];
  readonly footprints: readonly SpatialRecord[];
  readonly routes: readonly SpatialRecord[];
  readonly stops: readonly SpatialRecord[];
}

export interface WorldSurveyMapModel {
  readonly projection: SurveyMapProjection;
  /** One exact RGBA pixel per survey-grid cell. North is always at the top. */
  readonly terrainRgba: Uint8ClampedArray;
  readonly terrainLayer: SurveyTerrainLayer;
  readonly elevationRange: { readonly min: number; readonly max: number };
  readonly overlays: SurveyMapOverlayModel;
}

export interface SurveyRecordInspector {
  readonly selectionType: "record";
  readonly id: string;
  readonly address: string;
  readonly frameId: string;
  readonly layer: string;
  readonly recordKind: SpatialRecord["kind"];
  readonly cell: GridCell;
  readonly bounds?: GridBounds;
  readonly world: Vec3;
  readonly footprint?: {
    readonly width: number;
    readonly depth: number;
    readonly yaw: number;
  };
  readonly elevation: number;
  readonly vertical: SpatialRecord["geometry"]["vertical"];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface SurveyCellInspector {
  readonly selectionType: "cell";
  readonly id: string;
  readonly address: string;
  readonly frameId: string;
  readonly layer: "surface";
  readonly recordKind: "terrain-cell";
  readonly cell: GridCell;
  readonly world: Vec3;
  readonly elevation: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type SurveySelectionInspector =
  | SurveyRecordInspector
  | SurveyCellInspector;

export interface SurveyMapSelection {
  readonly cell: GridCell;
  readonly terrain: TerrainCellRecord;
  readonly records: readonly SpatialRecord[];
  readonly selectedRecord?: SpatialRecord;
  readonly inspector: SurveySelectionInspector;
}

export const SURVEY_TERRAIN_COLORS = {
  sea: 0x164863,
  shallows: 0x2b8da8,
  shore: 0xd4c596,
  river: 0x42b9d3,
  land: 0x5f8f61,
  blocked: 0x8f3944,
  grade: 0xd39b3b,
  flat: 0x50a76b,
} as const;

function finiteSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be greater than zero`);
  return value;
}

/**
 * Create a fixed north-up projection of the complete declared frame grid.
 *
 * The projection intentionally ignores content bounds. Adding an island, road, building or route
 * inside this frame cannot pan, zoom or otherwise move an existing grid address on the map.
 */
export function createSurveyMapProjection(input: {
  frameId: string;
  gridWidth: number;
  gridHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}): SurveyMapProjection {
  const gridWidth = finiteSize(input.gridWidth, "gridWidth");
  const gridHeight = finiteSize(input.gridHeight, "gridHeight");
  const viewportWidth = finiteSize(input.viewportWidth, "viewportWidth");
  const viewportHeight = finiteSize(input.viewportHeight, "viewportHeight");
  const padding = Math.max(0, input.padding ?? 12);
  const drawableWidth = viewportWidth - padding * 2;
  const drawableHeight = viewportHeight - padding * 2;
  if (drawableWidth <= 0 || drawableHeight <= 0)
    throw new Error("padding leaves no drawable survey-map area");
  const scale = Math.min(
    drawableWidth / gridWidth,
    drawableHeight / gridHeight,
  );
  const mapWidth = gridWidth * scale;
  const mapHeight = gridHeight * scale;
  return {
    frameId: input.frameId,
    gridWidth,
    gridHeight,
    viewportWidth,
    viewportHeight,
    padding,
    scale,
    offsetX: (viewportWidth - mapWidth) / 2,
    offsetY: (viewportHeight - mapHeight) / 2,
  };
}

/** Project the north-west corner of an exact grid coordinate. */
export function surveyGridToPixel(
  projection: SurveyMapProjection,
  cell: GridCell,
): { x: number; y: number } {
  return {
    x: projection.offsetX + cell.x * projection.scale,
    y: projection.offsetY + cell.y * projection.scale,
  };
}

/** Exact inverse used by pointer selection and reproducible camera/navigation links. */
export function surveyPixelToGrid(
  projection: SurveyMapProjection,
  pixel: { x: number; y: number },
): GridCell | null {
  const localX = (pixel.x - projection.offsetX) / projection.scale;
  const localY = (pixel.y - projection.offsetY) / projection.scale;
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= projection.gridWidth ||
    localY >= projection.gridHeight
  )
    return null;
  return { x: Math.floor(localX), y: Math.floor(localY) };
}

function writeColor(
  target: Uint8ClampedArray,
  index: number,
  color: number,
): void {
  target[index] = (color >> 16) & 0xff;
  target[index + 1] = (color >> 8) & 0xff;
  target[index + 2] = color & 0xff;
  target[index + 3] = 0xff;
}

function surfaceColor(cell: TerrainCellRecord): number {
  if (cell.water === "shallows") return SURVEY_TERRAIN_COLORS.shallows;
  if (cell.surface === "sea") return SURVEY_TERRAIN_COLORS.sea;
  if (cell.surface === "shore") return SURVEY_TERRAIN_COLORS.shore;
  if (cell.surface === "river") return SURVEY_TERRAIN_COLORS.river;
  return SURVEY_TERRAIN_COLORS.land;
}

function buildabilityColor(cell: TerrainCellRecord): number {
  if (cell.buildability === 2) return SURVEY_TERRAIN_COLORS.flat;
  if (cell.buildability === 1) return SURVEY_TERRAIN_COLORS.grade;
  return SURVEY_TERRAIN_COLORS.blocked;
}

function elevationColor(elevation: number, min: number, max: number): number {
  const t =
    max === min
      ? 0.5
      : Math.max(0, Math.min(1, (elevation - min) / (max - min)));
  // Deep navy -> green land -> pale peak, kept deliberately legible over road overlays.
  const stops = [
    { at: 0, rgb: [21, 64, 91] },
    { at: 0.45, rgb: [76, 128, 102] },
    { at: 1, rgb: [232, 226, 213] },
  ] as const;
  const upper = stops.findIndex((stop) => stop.at >= t);
  const b = stops[upper < 0 ? stops.length - 1 : upper]!;
  const a = stops[Math.max(0, (upper < 0 ? stops.length - 1 : upper) - 1)]!;
  const span = b.at - a.at;
  const u = span === 0 ? 0 : (t - a.at) / span;
  const channel = (i: number): number =>
    Math.round(a.rgb[i]! + (b.rgb[i]! - a.rgb[i]!) * u);
  return (channel(0) << 16) | (channel(1) << 8) | channel(2);
}

function sorted(records: Iterable<SpatialRecord>): SpatialRecord[] {
  return [...records].sort((a, b) => a.id.localeCompare(b.id));
}

function buildOverlays(
  registry: WorldSurveyRegistry,
  frameId: string,
): SurveyMapOverlayModel {
  const records = sorted(registry.records.values()).filter(
    (record) => record.frameId === frameId,
  );
  return {
    roadCells: records.filter(
      (record) => record.kind === "road" && record.geometry.type === "cell",
    ),
    roadPaths: records.filter(
      (record) => record.kind === "road" && record.geometry.type === "polyline",
    ),
    intersections: records.filter((record) => record.kind === "intersection"),
    footprints: records.filter(
      (record) =>
        record.geometry.type === "footprint" ||
        record.geometry.type === "volume",
    ),
    routes: records.filter((record) => record.kind === "bus-route"),
    stops: records.filter((record) => record.kind === "bus-stop"),
  };
}

export function buildWorldSurveyMapModel(
  registry: WorldSurveyRegistry,
  input: {
    viewportWidth: number;
    viewportHeight: number;
    terrainLayer?: SurveyTerrainLayer;
    frameId?: string;
    padding?: number;
  },
): WorldSurveyMapModel {
  const frameId = input.frameId ?? registry.surfaceFrameId;
  const frame = registry.frames.get(frameId);
  if (!frame?.grid) throw new Error(`survey-map frame has no grid: ${frameId}`);
  const projection = createSurveyMapProjection({
    frameId,
    gridWidth: frame.grid.width,
    gridHeight: frame.grid.height,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    padding: input.padding,
  });
  const terrainLayer = input.terrainLayer ?? "surface";
  const cellCount = frame.grid.width * frame.grid.height;
  const terrainRgba = new Uint8ClampedArray(cellCount * 4);
  const elevations =
    terrainLayer === "elevation" ? new Float32Array(cellCount) : null;
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < frame.grid.height; y++) {
    for (let x = 0; x < frame.grid.width; x++) {
      const cell = registry.terrainCell(x, y);
      if (!cell) throw new Error(`missing terrain metadata at ${x},${y}`);
      const index = y * frame.grid.width + x;
      minElevation = Math.min(minElevation, cell.elevation);
      maxElevation = Math.max(maxElevation, cell.elevation);
      if (elevations) elevations[index] = cell.elevation;
      else
        writeColor(
          terrainRgba,
          index * 4,
          terrainLayer === "surface"
            ? surfaceColor(cell)
            : buildabilityColor(cell),
        );
    }
  }
  if (elevations)
    for (let i = 0; i < elevations.length; i++)
      writeColor(
        terrainRgba,
        i * 4,
        elevationColor(elevations[i]!, minElevation, maxElevation),
      );
  return {
    projection,
    terrainRgba,
    terrainLayer,
    elevationRange: { min: minElevation, max: maxElevation },
    overlays: buildOverlays(registry, frameId),
  };
}

function geometryBounds(record: SpatialRecord): GridBounds | undefined {
  const geometry = record.geometry;
  if (geometry.type === "footprint" || geometry.type === "volume")
    return geometry.bounds;
  if (geometry.type === "cell")
    return { x: geometry.cell.x, y: geometry.cell.y, w: 1, h: 1 };
  if (geometry.type === "point" && geometry.cell)
    return { x: geometry.cell.x, y: geometry.cell.y, w: 1, h: 1 };
  if (geometry.type !== "polyline" || geometry.cells.length === 0)
    return undefined;
  const xs = geometry.cells.map((cell) => cell.x);
  const ys = geometry.cells.map((cell) => cell.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

function recordContainsCell(record: SpatialRecord, cell: GridCell): boolean {
  const geometry = record.geometry;
  if (geometry.type === "polyline")
    return geometry.cells.some(
      (candidate) => candidate.x === cell.x && candidate.y === cell.y,
    );
  const bounds = geometryBounds(record);
  return (
    !!bounds &&
    cell.x >= bounds.x &&
    cell.x < bounds.x + bounds.w &&
    cell.y >= bounds.y &&
    cell.y < bounds.y + bounds.h
  );
}

export function recordsAtSurveyCell(
  registry: WorldSurveyRegistry,
  frameId: string,
  cell: GridCell,
): SpatialRecord[] {
  return sorted(registry.records.values()).filter(
    (record) => record.frameId === frameId && recordContainsCell(record, cell),
  );
}

function recordAnchor(
  registry: WorldSurveyRegistry,
  record: SpatialRecord,
  fallback: GridCell,
): {
  cell: GridCell;
  bounds?: GridBounds;
  world: Vec3;
  elevation: number;
  footprint?: SurveyRecordInspector["footprint"];
} {
  const geometry = record.geometry;
  if (geometry.type === "point") {
    return {
      cell: geometry.cell ?? fallback,
      world: geometry.position,
      elevation: geometry.position.y,
    };
  }
  const bounds = geometryBounds(record);
  const cell = bounds
    ? { x: bounds.x + (bounds.w - 1) / 2, y: bounds.y + (bounds.h - 1) / 2 }
    : fallback;
  const elevation =
    geometry.type === "footprint" ? geometry.elevation : geometry.vertical.min;
  const world = registry.terrainCell(Math.round(cell.x), Math.round(cell.y))
    ?.world ?? {
    x: cell.x,
    y: elevation,
    z: cell.y,
  };
  return {
    cell,
    bounds,
    world: { ...world, y: elevation },
    elevation,
    footprint:
      bounds && (geometry.type === "footprint" || geometry.type === "volume")
        ? { width: bounds.w, depth: bounds.h, yaw: geometry.yaw }
        : undefined,
  };
}

export function inspectSurveySelection(
  registry: WorldSurveyRegistry,
  cell: GridCell,
  selectedRecordId?: string,
  frameId = registry.surfaceFrameId,
): SurveyMapSelection | null {
  const terrain = registry.terrainCell(cell.x, cell.y);
  if (!terrain) return null;
  const records = recordsAtSurveyCell(registry, frameId, cell);
  const selectedRecord = selectedRecordId
    ? records.find((record) => record.id === selectedRecordId)
    : undefined;
  if (!selectedRecord) {
    return {
      cell,
      terrain,
      records,
      inspector: {
        selectionType: "cell",
        id: terrain.id,
        address: terrain.address,
        frameId: terrain.frameId,
        layer: terrain.layer,
        recordKind: terrain.kind,
        cell: terrain.cell,
        world: terrain.world,
        elevation: terrain.elevation,
        metadata: {
          biome: terrain.biomeName,
          surface: terrain.surface,
          water: terrain.water,
          buildability: terrain.buildability,
          relief: terrain.relief,
          distanceToWater: terrain.distanceToWater,
        },
      },
    };
  }
  const anchor = recordAnchor(registry, selectedRecord, cell);
  return {
    cell,
    terrain,
    records,
    selectedRecord,
    inspector: {
      selectionType: "record",
      id: selectedRecord.id,
      address: selectedRecord.address,
      frameId: selectedRecord.frameId,
      layer: selectedRecord.layer,
      recordKind: selectedRecord.kind,
      cell: anchor.cell,
      bounds: anchor.bounds,
      world: anchor.world,
      footprint: anchor.footprint,
      elevation: anchor.elevation,
      vertical: selectedRecord.geometry.vertical,
      metadata: selectedRecord.metadata,
    },
  };
}
