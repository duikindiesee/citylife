import { Biome, type Terrain } from "../terrain";
import type { GridBounds, GridCell, VerticalRange } from "../worldSurvey";
import {
  ROAD_PLACEABLES,
  type PlaceableDefinition,
  type PlacementOrientation,
  type PlacementZone,
  type ZonedPlotSize,
  zonedPlotDefinition,
} from "./placeableCatalog";

export type PlacementFailureCode =
  | "STALE_LAYOUT_REVISION"
  | "NON_FINITE_COORDINATE"
  | "OUT_OF_BOUNDS"
  | "NON_FINITE_ELEVATION"
  | "WATER_FORBIDDEN"
  | "WATER_REQUIRED"
  | "SHORE_FORBIDDEN"
  | "SHORE_REQUIRED"
  | "NON_BUILDABLE"
  | "ELEVATION_BELOW_MINIMUM"
  | "ELEVATION_ABOVE_MAXIMUM"
  | "RELIEF_EXCEEDS_LIMIT"
  | "TERRAIN_CLASS_FORBIDDEN"
  | "RENDERED_ROAD_OVERLAP"
  | "OCCUPIED_VOLUME"
  | "RESERVED_VOLUME"
  | "ROAD_CONNECTION_REQUIRED"
  | "ZONE_MISMATCH"
  | "OWNER_REQUIRED"
  | "EMPTY_FOOTPRINT";

export interface PlacementFailure {
  readonly code: PlacementFailureCode;
  readonly cell?: GridCell;
  readonly detail?: string;
}

export interface PlacementAnchor {
  readonly id: "gate" | "road" | "centre";
  readonly cell: GridCell;
}

export interface PlacementContext {
  readonly terrain: Terrain;
  readonly layoutRevision: string;
  readonly logicalRoadCells: ReadonlySet<string>;
  readonly renderedRoadCells: ReadonlySet<string>;
  readonly occupiedCells: ReadonlySet<string>;
  readonly reservedCells: ReadonlySet<string>;
}

export interface PlacementSurveyRequest {
  readonly definition: PlaceableDefinition;
  readonly context: PlacementContext;
  readonly cells: readonly GridCell[];
  readonly orientation?: PlacementOrientation;
  readonly anchors?: readonly PlacementAnchor[];
  readonly zone?: PlacementZone;
  readonly ownerId?: string;
  readonly ownerRequired?: boolean;
  readonly expectedLayoutRevision?: string;
}

export interface PlacementSurveyResult {
  readonly ok: boolean;
  readonly definitionId: string;
  readonly definitionKind: PlaceableDefinition["kind"];
  readonly layoutRevision: string;
  readonly orientation?: PlacementOrientation;
  readonly cells: readonly GridCell[];
  readonly bounds: GridBounds;
  readonly vertical: VerticalRange;
  readonly anchors: readonly PlacementAnchor[];
  readonly failures: readonly PlacementFailure[];
}

export type PlacementCommitResult =
  | {
      readonly ok: true;
      readonly survey: PlacementSurveyResult;
      readonly placedId: string;
    }
  | {
      readonly ok: false;
      readonly survey: PlacementSurveyResult;
      readonly reason: "invalid" | "stale-revision" | "runtime-rejected";
    };

export interface ZonedPlotLayout {
  readonly orientation: PlacementOrientation;
  readonly hasRoad: boolean;
  readonly cells: readonly GridCell[];
  readonly gateCell: GridCell;
  readonly roadCell: GridCell;
}

const key = (cell: GridCell): string => `${cell.x},${cell.y}`;

const sortedCells = (cells: readonly GridCell[]): GridCell[] =>
  [...new Map(cells.map((cell) => [key(cell), { ...cell }])).values()].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );

function boundsOf(cells: readonly GridCell[]): GridBounds {
  if (cells.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

function cardinalRelief(terrain: Terrain, cell: GridCell): number {
  const elevation = terrain.worldY(cell.x, cell.y);
  let relief = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = cell.x + dx;
    const y = cell.y + dy;
    if (terrain.inBounds(x, y))
      relief = Math.max(relief, Math.abs(terrain.worldY(x, y) - elevation));
  }
  return relief;
}

function failureSort(a: PlacementFailure, b: PlacementFailure): number {
  const ay = a.cell?.y ?? Number.NEGATIVE_INFINITY;
  const by = b.cell?.y ?? Number.NEGATIVE_INFINITY;
  const ax = a.cell?.x ?? Number.NEGATIVE_INFINITY;
  const bx = b.cell?.x ?? Number.NEGATIVE_INFINITY;
  return ay - by || ax - bx || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

export function placementFailureMessage(code: PlacementFailureCode): string {
  switch (code) {
    case "STALE_LAYOUT_REVISION":
      return "The world changed after this preview; survey again.";
    case "ROAD_CONNECTION_REQUIRED":
      return "A road connection is required.";
    case "WATER_FORBIDDEN":
      return "This placeable cannot occupy water.";
    case "SHORE_FORBIDDEN":
      return "This placeable cannot occupy the shore.";
    case "RENDERED_ROAD_OVERLAP":
      return "The exact rendered road footprint overlaps this placement.";
    case "OCCUPIED_VOLUME":
      return "An occupied spatial volume overlaps this placement.";
    case "RESERVED_VOLUME":
      return "A reserved spatial volume overlaps this placement.";
    case "NON_BUILDABLE":
      return "The surveyed ground is not buildable.";
    case "RELIEF_EXCEEDS_LIMIT":
      return "The surveyed relief exceeds the placeable limit.";
    default:
      return (
        code
          .toLowerCase()
          .replaceAll("_", " ")
          .replace(/^./, (letter) => letter.toUpperCase()) + "."
      );
  }
}

export function surveyPlacement(
  request: PlacementSurveyRequest,
): PlacementSurveyResult {
  const cells = sortedCells(request.cells);
  const failures: PlacementFailure[] = [];
  const { context, definition } = request;
  const policy = definition.terrain;

  if (
    request.expectedLayoutRevision !== undefined &&
    request.expectedLayoutRevision !== context.layoutRevision
  )
    failures.push({
      code: "STALE_LAYOUT_REVISION",
      detail: `${request.expectedLayoutRevision} -> ${context.layoutRevision}`,
    });
  if (cells.length === 0) failures.push({ code: "EMPTY_FOOTPRINT" });

  const elevations: number[] = [];
  for (const cell of cells) {
    if (!Number.isFinite(cell.x) || !Number.isFinite(cell.y)) {
      failures.push({ code: "NON_FINITE_COORDINATE", cell });
      continue;
    }
    if (!context.terrain.inBounds(cell.x, cell.y)) {
      failures.push({ code: "OUT_OF_BOUNDS", cell });
      continue;
    }
    const elevation = context.terrain.worldY(cell.x, cell.y);
    if (!Number.isFinite(elevation)) {
      failures.push({ code: "NON_FINITE_ELEVATION", cell });
      continue;
    }
    elevations.push(elevation);
    const index = context.terrain.idx(cell.x, cell.y);
    const isWater = context.terrain.isWater(cell.x, cell.y);
    const isShore = context.terrain.biome[index] === Biome.Beach;
    if (policy.water === "forbid" && isWater)
      failures.push({ code: "WATER_FORBIDDEN", cell });
    if (policy.water === "require" && !isWater)
      failures.push({ code: "WATER_REQUIRED", cell });
    if (policy.shore === "forbid" && isShore)
      failures.push({ code: "SHORE_FORBIDDEN", cell });
    if (policy.shore === "require" && !isShore)
      failures.push({ code: "SHORE_REQUIRED", cell });
    if (context.terrain.buildable[index]! < policy.minBuildability)
      failures.push({ code: "NON_BUILDABLE", cell });
    if (policy.forbiddenBiomes?.includes(context.terrain.biome[index] as Biome))
      failures.push({ code: "TERRAIN_CLASS_FORBIDDEN", cell });
    if (policy.minElevation !== undefined && elevation < policy.minElevation)
      failures.push({ code: "ELEVATION_BELOW_MINIMUM", cell });
    if (policy.maxElevation !== undefined && elevation > policy.maxElevation)
      failures.push({ code: "ELEVATION_ABOVE_MAXIMUM", cell });
    if (
      policy.maxRelief !== undefined &&
      cardinalRelief(context.terrain, cell) > policy.maxRelief
    )
      failures.push({ code: "RELIEF_EXCEEDS_LIMIT", cell });
    if (definition.kind !== "road" && context.renderedRoadCells.has(key(cell)))
      failures.push({ code: "RENDERED_ROAD_OVERLAP", cell });
    if (context.occupiedCells.has(key(cell)))
      failures.push({ code: "OCCUPIED_VOLUME", cell });
    if (context.reservedCells.has(key(cell)))
      failures.push({ code: "RESERVED_VOLUME", cell });
  }

  if (
    definition.requiresRoadConnection &&
    !(request.anchors ?? []).some(
      (anchor) =>
        anchor.id === "road" && context.logicalRoadCells.has(key(anchor.cell)),
    )
  )
    failures.push({
      code: "ROAD_CONNECTION_REQUIRED",
      cell: request.anchors?.find((anchor) => anchor.id === "road")?.cell,
    });
  if (
    definition.allowedZones &&
    (!request.zone || !definition.allowedZones.includes(request.zone))
  )
    failures.push({ code: "ZONE_MISMATCH" });
  if (request.ownerRequired && !request.ownerId)
    failures.push({ code: "OWNER_REQUIRED" });

  const minElevation = elevations.length === 0 ? 0 : Math.min(...elevations);
  const maxElevation = elevations.length === 0 ? 0 : Math.max(...elevations);
  const result: PlacementSurveyResult = {
    ok: failures.length === 0,
    definitionId: definition.id,
    definitionKind: definition.kind,
    layoutRevision: context.layoutRevision,
    ...(request.orientation ? { orientation: request.orientation } : {}),
    cells,
    bounds: boundsOf(cells),
    vertical: {
      min: minElevation + definition.vertical.minOffset,
      max: maxElevation + definition.vertical.maxOffset,
      clearanceBelow: definition.vertical.clearanceBelow,
      clearanceAbove: definition.vertical.clearanceAbove,
    },
    anchors: [...(request.anchors ?? [])],
    failures: failures.sort(failureSort),
  };
  return result;
}

export function zonedPlotCells(
  x: number,
  y: number,
  width: number,
  depth: number,
  orientation: PlacementOrientation,
): ZonedPlotLayout {
  const half = (width - 1) / 2;
  const translate = (u: number, d: number): GridCell => {
    switch (orientation) {
      case "n":
        return { x: x + u, y: y + d };
      case "s":
        return { x: x + u, y: y - d };
      case "w":
        return { x: x + d, y: y + u };
      case "e":
        return { x: x - d, y: y + u };
    }
  };
  const cells: GridCell[] = [];
  for (let d = 0; d < depth; d++)
    for (let u = -half; u <= half; u++) cells.push(translate(u, d));
  return {
    orientation,
    hasRoad: false,
    cells,
    gateCell: translate(0, 0),
    roadCell: translate(0, -1),
  };
}

export function resolveZonedPlotLayout(
  x: number,
  y: number,
  width: number,
  depth: number,
  roadCells: ReadonlySet<string>,
  forcedOrientation?: PlacementOrientation,
): ZonedPlotLayout {
  if (forcedOrientation) {
    const layout = zonedPlotCells(x, y, width, depth, forcedOrientation);
    return { ...layout, hasRoad: roadCells.has(key(layout.roadCell)) };
  }
  const candidates = (["n", "s", "w", "e"] as const)
    .map((orientation) => zonedPlotCells(x, y, width, depth, orientation))
    .map((layout) => ({
      layout,
      roadCells: layout.cells
        .filter((cell) => {
          if (layout.orientation === "n") return cell.y === y;
          if (layout.orientation === "s") return cell.y === y;
          if (layout.orientation === "w") return cell.x === x;
          return cell.x === x;
        })
        .map((gate) => {
          if (layout.orientation === "n") return { x: gate.x, y: gate.y - 1 };
          if (layout.orientation === "s") return { x: gate.x, y: gate.y + 1 };
          if (layout.orientation === "w") return { x: gate.x - 1, y: gate.y };
          return { x: gate.x + 1, y: gate.y };
        })
        .filter((cell) => roadCells.has(key(cell))),
    }))
    .filter((candidate) => candidate.roadCells.length > 0)
    .sort((a, b) => {
      const distance = (cell: GridCell): number =>
        Math.abs(cell.x - x) + Math.abs(cell.y - y);
      return (
        Math.min(...a.roadCells.map(distance)) -
        Math.min(...b.roadCells.map(distance))
      );
    });
  const chosen = candidates[0];
  if (!chosen) return zonedPlotCells(x, y, width, depth, "s");
  const roadCell = chosen.roadCells.sort(
    (a, b) =>
      Math.abs(a.x - x) +
        Math.abs(a.y - y) -
        (Math.abs(b.x - x) + Math.abs(b.y - y)) ||
      a.y - b.y ||
      a.x - b.x,
  )[0]!;
  return { ...chosen.layout, hasRoad: true, roadCell };
}

export function surveyZonedPlot(input: {
  context: PlacementContext;
  x: number;
  y: number;
  orientation?: PlacementOrientation;
  sizeName: ZonedPlotSize;
  zone: PlacementZone;
  expectedLayoutRevision?: string;
}): PlacementSurveyResult {
  const definition = zonedPlotDefinition(input.zone, input.sizeName);
  if (definition.footprint.type !== "front-centred-rectangle")
    throw new Error("zoned plot definition must be rectangular");
  const layout = resolveZonedPlotLayout(
    input.x,
    input.y,
    definition.footprint.width,
    definition.footprint.depth,
    input.context.logicalRoadCells,
    input.orientation,
  );
  return surveyPlacement({
    definition,
    context: input.context,
    cells: layout.cells,
    orientation: layout.orientation,
    anchors: [
      { id: "gate", cell: layout.gateCell },
      { id: "road", cell: layout.roadCell },
      { id: "centre", cell: { x: input.x, y: input.y } },
    ],
    zone: input.zone,
    ...(input.expectedLayoutRevision
      ? { expectedLayoutRevision: input.expectedLayoutRevision }
      : {}),
  });
}

export function surveyRoadStroke(input: {
  context: PlacementContext;
  cells: readonly GridCell[];
  roadType: keyof typeof ROAD_PLACEABLES;
  expectedLayoutRevision?: string;
}): PlacementSurveyResult {
  return surveyPlacement({
    definition: ROAD_PLACEABLES[input.roadType],
    context: input.context,
    cells: input.cells,
    ...(input.expectedLayoutRevision
      ? { expectedLayoutRevision: input.expectedLayoutRevision }
      : {}),
  });
}
