import type { Cell, BusRoute } from "./busRoute";
import { makeBusRoute } from "./busRoute";
import {
  createTransitCorridorPathfinder,
  extractPlacementsConstraints,
} from "./transitCorridor";
import type { DepotLayout, DepotSite, DepotTerrain } from "./busDepot";
import { depotLayout, depotPadHeightRange } from "./busDepot";
import { buildPath, busLoopPath, smoothOpen } from "./path";
import {
  busStopAnchors as computeBusStopAnchors,
  type BusStopAnchor,
} from "./busStopAnchor";
import {
  makeFleet,
  makeFleetGeometry,
  type BusFleet,
  type FleetGeometry,
  type FleetPaths,
} from "./busFleet";
import { findJunctionZones } from "../render/roadJunctions";
import { attachCapPolys } from "../render/junctionCap";
import { nearPoly } from "../render/geom2d";
import type { RoadWay } from "../render/roadRibbon";
import type { SpatialFrame } from "../worldSurvey";
import { resolvePointBetweenFrames } from "../spatial/spatialLocation";
import { COLONY } from "../config";
import { Biome } from "../terrain";

export interface MaterializedTransitPlan {
  readonly valid: boolean;
  readonly busRoute: BusRoute | null;
  readonly busDepot: { site: DepotSite; layout: DepotLayout } | null;
  readonly fleetPaths: FleetPaths | null;
  readonly fleetGeom: FleetGeometry | null;
  readonly stopAnchors: readonly BusStopAnchor[];
  readonly busFleet: BusFleet | null;
  readonly busDepotPad: { x: number; y: number; w: number; h: number } | null;
  readonly busDepotSpurCells: ReadonlySet<string>;
  readonly unusableReason?: string;
}

export function createNullTransitPlan(
  reason?: string,
): MaterializedTransitPlan {
  return {
    valid: false,
    busRoute: null,
    busDepot: null,
    fleetPaths: null,
    fleetGeom: null,
    stopAnchors: [],
    busFleet: null,
    busDepotPad: null,
    busDepotSpurCells: new Set(),
    unusableReason: reason,
  };
}

export interface TransitDerivationInputs {
  readonly candidateRoads: readonly { x: number; y: number; kind?: string }[];
  readonly candidateRoadWays: readonly RoadWay[];
  readonly terrain: DepotTerrain | DepotTerrainFacade;
  readonly busAnchors: readonly Cell[];
  readonly worldSeed: number;
  readonly candidateSite: DepotSite | null;
  readonly structures?: readonly { x: number; y: number }[];
  readonly placements?: readonly {
    readonly id?: string;
    readonly frameId?: string;
    readonly cells?: readonly { x: number; y: number }[];
    readonly bounds?: { x: number; y: number; w: number; h: number };
    readonly x?: number;
    readonly y?: number;
  }[];
  readonly reservations?: readonly {
    readonly id?: string;
    readonly frameId?: string;
    readonly purpose?: string;
    readonly cells: readonly { x: number; y: number }[];
  }[];
  readonly frames?: readonly SpatialFrame[];
  readonly surfaceFrameId?: string;
}

interface Pt2D {
  readonly x: number;
  readonly y: number;
}

function projectFootprintVerticesToSurface(
  localMinX: number,
  localMinY: number,
  localMaxX: number,
  localMaxY: number,
  frameId: string | undefined,
  surfaceFrameId: string | undefined,
  framesMap: ReadonlyMap<string, SpatialFrame> | undefined,
): readonly Pt2D[] | null {
  if (!frameId || !surfaceFrameId || frameId === surfaceFrameId || !framesMap) {
    return [
      { x: localMinX, y: localMinY },
      { x: localMaxX, y: localMinY },
      { x: localMaxX, y: localMaxY },
      { x: localMinX, y: localMaxY },
    ];
  }
  const surfaceFrame = framesMap.get(surfaceFrameId);
  const sourceFrame = framesMap.get(frameId);
  if (!surfaceFrame || !sourceFrame || !surfaceFrame.grid) {
    return [
      { x: localMinX, y: localMinY },
      { x: localMaxX, y: localMinY },
      { x: localMaxX, y: localMaxY },
      { x: localMinX, y: localMaxY },
    ];
  }
  const sourceGrid = sourceFrame.grid;
  const cellSize = sourceGrid?.cellSize ?? surfaceFrame.grid.cellSize;
  const sourceOrigin = sourceGrid?.origin ?? { x: 0, y: 0, z: 0 };

  const corners = [
    { x: localMinX, y: localMinY },
    { x: localMaxX, y: localMinY },
    { x: localMaxX, y: localMaxY },
    { x: localMinX, y: localMaxY },
  ];

  const result: Pt2D[] = [];
  for (const corner of corners) {
    const localPoint = {
      x: sourceOrigin.x + corner.x * cellSize,
      y: sourceOrigin.y ?? 0,
      z: sourceOrigin.z + corner.y * cellSize,
    };
    try {
      const surfacePoint = resolvePointBetweenFrames(
        localPoint,
        frameId,
        surfaceFrameId,
        framesMap,
      );
      const surfaceGrid = surfaceFrame.grid;
      result.push({
        x: (surfacePoint.x - surfaceGrid.origin.x) / surfaceGrid.cellSize,
        y: (surfacePoint.z - surfaceGrid.origin.z) / surfaceGrid.cellSize,
      });
    } catch {
      return null;
    }
  }

  return result.length === 4 ? result : null;
}

function convexPolygonIntersectsBox(
  poly: readonly Pt2D[],
  box: { x: number; y: number; w: number; h: number },
): boolean {
  if (poly.length < 3) return false;

  const boxVerts: readonly Pt2D[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];

  const axes: Pt2D[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];

  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i]!;
    const p2 = poly[(i + 1) % poly.length]!;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    axes.push({ x: -dy, y: dx });
  }

  for (const axis of axes) {
    if (axis.x === 0 && axis.y === 0) continue;

    let minBox = Infinity,
      maxBox = -Infinity;
    for (const v of boxVerts) {
      const dot = v.x * axis.x + v.y * axis.y;
      if (dot < minBox) minBox = dot;
      if (dot > maxBox) maxBox = dot;
    }

    let minPoly = Infinity,
      maxPoly = -Infinity;
    for (const v of poly) {
      const dot = v.x * axis.x + v.y * axis.y;
      if (dot < minPoly) minPoly = dot;
      if (dot > maxPoly) maxPoly = dot;
    }

    if (maxPoly <= minBox + 1e-9 || maxBox <= minPoly + 1e-9) {
      return false;
    }
  }

  return true;
}

export interface DepotTerrainFacade extends DepotTerrain {
  readonly size: number;
  inBounds(x: number, y: number): boolean;
  isWater(x: number, y: number): boolean;
  worldY(x: number, y: number): number;
  roadCellOk(x: number, y: number): boolean;
  cellOk(x: number, y: number): boolean;
  idx(x: number, y: number): number;
}

export function createDepotTerrainFacade(
  terrainAuthority: {
    readonly elevation: Float32Array;
    readonly water: Uint8Array;
    readonly biome?: Uint8Array;
    readonly buildability?: Uint8Array;
  },
  size: number,
): DepotTerrainFacade {
  const sea = COLONY.world.seaLevel;
  const heightScale = COLONY.world.heightScale;

  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && x < size && y >= 0 && y < size;

  const idx = (x: number, y: number): number => y * size + x;

  const isWater = (x: number, y: number): boolean => {
    if (!inBounds(x, y)) return false;
    const i = idx(x, y);
    return (
      terrainAuthority.water[i] === 1 ||
      terrainAuthority.elevation[i]! < sea
    );
  };

  const worldY = (x: number, y: number): number => {
    if (!inBounds(x, y)) return NaN;
    const e = terrainAuthority.elevation[idx(x, y)]!;
    return (e - sea) * heightScale;
  };

  const cellOk = (x: number, y: number): boolean => {
    if (!inBounds(x, y)) return false;
    const i = idx(x, y);
    if (terrainAuthority.buildability && terrainAuthority.buildability[i] === 0) {
      return false;
    }
    if (isWater(x, y)) return false;
    if (terrainAuthority.biome) {
      const b = terrainAuthority.biome[i];
      if (
        b === Biome.Mountain ||
        b === Biome.Peak ||
        b === Biome.Ocean ||
        b === Biome.Shallows
      ) {
        return false;
      }
    }
    return true;
  };

  const roadCellOk = (x: number, y: number): boolean => {
    if (!cellOk(x, y)) return false;
    if (terrainAuthority.biome) {
      const b = terrainAuthority.biome[idx(x, y)];
      if (b === Biome.Beach) return false;
    }
    return true;
  };

  return {
    size,
    inBounds,
    isWater,
    worldY,
    roadCellOk,
    cellOk,
    idx,
  };
}

export function deriveTransitMaterialization(
  inputs: TransitDerivationInputs,
): MaterializedTransitPlan {
  const {
    candidateRoads,
    candidateRoadWays,
    terrain,
    busAnchors,
    worldSeed,
    candidateSite,
    structures = [],
    placements = [],
    reservations = [],
  } = inputs;

  if (!candidateRoads.length || !busAnchors.length) {
    return createNullTransitPlan("empty_roads_or_anchors");
  }

  // 1. Build roadKind map from candidate roads
  const roadKind = new Map<string, "avenue" | "street" | "path">(
    candidateRoads.map((r) => [
      `${r.x},${r.y}`,
      r.kind === "avenue" || r.kind === "path" ? r.kind : "street",
    ]),
  );

  // 2. Derive route over candidate roads
  const constraints = placements ? extractPlacementsConstraints(placements) : null;
  const corridorRouter =
    worldSeed === 4242 && constraints
      ? createTransitCorridorPathfinder({
          terrain,
          roadKind,
          roadWays: candidateRoadWays?.filter(
            (w) =>
              (w as any).source !== "transit-loop" &&
              (w as any).source !== "depot-spur" &&
              (w as any).id !== "transit-loop" &&
              (w as any).id !== "depot-spur" &&
              (!("cells" in w) || !Array.isArray((w as any).cells) || (w as any).cells.length < 200),
          ),
          placementBoxes: constraints.placementBoxes,
          ownedCells: constraints.ownedCells,
          residentialSetbacks: constraints.residentialSetbacks,
        })
      : undefined;

  const route = makeBusRoute(
    { roadKind },
    [...busAnchors],
    worldSeed === 4242
      ? { preserveOrder: true, pathfinder: corridorRouter }
      : undefined,
  );

  if (!route || route.loop.length < 4 || route.stops.length < 2) {
    return createNullTransitPlan("route_disconnected_or_too_few_stops");
  }

  // 3. Validate depot site on adopted world
  if (!candidateSite) {
    return createNullTransitPlan("no_candidate_depot_site");
  }

  const site = candidateSite;
  const loop = route.loop;

  // 3a. roadCell must be on loop
  const onLoop = loop.some(
    (p) => p.x === site.roadCell.x && p.y === site.roadCell.y,
  );
  if (!onLoop) {
    return createNullTransitPlan("depot_roadCell_not_on_route_loop");
  }

  // 3b. Spur corridor from roadCell to gate must be paved in candidate roads
  const dx = Math.sign(site.gate.x - site.roadCell.x);
  const dy = Math.sign(site.gate.y - site.roadCell.y);
  const steps =
    Math.abs(site.gate.x - site.roadCell.x) +
    Math.abs(site.gate.y - site.roadCell.y);
  const spurKeys = new Set<string>();
  for (let s = 0; s <= steps; s++) {
    const cx = site.roadCell.x + dx * s;
    const cy = site.roadCell.y + dy * s;
    const k = `${cx},${cy}`;
    if (!roadKind.has(k)) {
      return createNullTransitPlan(`spur_cell_${k}_unpaved`);
    }
    spurKeys.add(k);
  }

  // Immediate apron/shoulder cells at the gate:
  const gatePerpX = dy,
    gatePerpY = dx;
  for (let d = -1; d <= 1; d++) {
    spurKeys.add(
      `${site.gate.x + gatePerpX * d},${site.gate.y + gatePerpY * d}`,
    );
  }

  // 3c. Pad terrain: in bounds, dry, height spread <= max
  for (let y = site.y; y < site.y + site.h; y++) {
    for (let x = site.x; x < site.x + site.w; x++) {
      if (!terrain.inBounds(x, y) || terrain.isWater(x, y)) {
        return createNullTransitPlan(`pad_water_or_oob_at_${x},${y}`);
      }
    }
  }
  const hRange = depotPadHeightRange(terrain, site);
  if (hRange.spread > COLONY.transit.depotMaxHeightSpreadM) {
    return createNullTransitPlan(
      `pad_height_spread_${hRange.spread}_exceeds_max`,
    );
  }

  // 3d. Pad clearance from unrelated roads (outside spur apron)
  for (let y = site.y; y < site.y + site.h; y++) {
    for (let x = site.x; x < site.x + site.w; x++) {
      const k = `${x},${y}`;
      if (roadKind.has(k) && !spurKeys.has(k)) {
        return createNullTransitPlan(`pad_collides_with_road_${k}`);
      }
    }
  }

  // 3e. Pad clearance from structures, placements, and conflicting reservations
  const framesMap = inputs.frames
    ? new Map(inputs.frames.map((f) => [f.id, f]))
    : undefined;

  for (const s of structures) {
    const sx = Math.round(s.x);
    const sy = Math.round(s.y);
    if (
      sx >= site.x &&
      sx < site.x + site.w &&
      sy >= site.y &&
      sy < site.y + site.h
    ) {
      return createNullTransitPlan(`pad_collides_with_structure_${sx},${sy}`);
    }
  }
  for (const p of placements) {
    if (Array.isArray(p.cells) && p.cells.length > 0) {
      for (const c of p.cells) {
        const poly = projectFootprintVerticesToSurface(
          c.x,
          c.y,
          c.x + 1,
          c.y + 1,
          p.frameId,
          inputs.surfaceFrameId,
          framesMap,
        );
        if (poly && convexPolygonIntersectsBox(poly, site)) {
          return createNullTransitPlan(
            `pad_collides_with_placement_cell_${Math.round(poly[0]!.x)},${Math.round(poly[0]!.y)}`,
          );
        }
      }
    } else if (p.bounds) {
      const poly = projectFootprintVerticesToSurface(
        p.bounds.x,
        p.bounds.y,
        p.bounds.x + p.bounds.w,
        p.bounds.y + p.bounds.h,
        p.frameId,
        inputs.surfaceFrameId,
        framesMap,
      );
      if (poly && convexPolygonIntersectsBox(poly, site)) {
        return createNullTransitPlan(`pad_collides_with_placement_bounds`);
      }
    } else if (typeof p.x === "number" && typeof p.y === "number") {
      const poly = projectFootprintVerticesToSurface(
        p.x,
        p.y,
        p.x + 1,
        p.y + 1,
        p.frameId,
        inputs.surfaceFrameId,
        framesMap,
      );
      if (poly && convexPolygonIntersectsBox(poly, site)) {
        return createNullTransitPlan(
          `pad_collides_with_placement_${Math.round(poly[0]!.x)},${Math.round(poly[0]!.y)}`,
        );
      }
    }
  }
  for (const r of reservations) {
    if (r.purpose === "depot") continue;
    if (Array.isArray(r.cells)) {
      for (const c of r.cells) {
        const poly = projectFootprintVerticesToSurface(
          c.x,
          c.y,
          c.x + 1,
          c.y + 1,
          r.frameId,
          inputs.surfaceFrameId,
          framesMap,
        );
        if (poly && convexPolygonIntersectsBox(poly, site)) {
          for (let y = site.y; y < site.y + site.h; y++) {
            for (let x = site.x; x < site.x + site.w; x++) {
              if (spurKeys.has(`${x},${y}`)) continue;
              if (convexPolygonIntersectsBox(poly, { x, y, w: 1, h: 1 })) {
                return createNullTransitPlan(
                  `pad_collides_with_reservation_${x},${y}`,
                );
              }
            }
          }
        }
      }
    }
  }

  // 4. Construct transit geometry and fleet objects
  const tr = COLONY.transit;
  const layout = depotLayout(site, {
    baysTotal: tr.baysTotal,
    laneDepth: tr.depotLaneDepth,
    bayDepth: tr.depotBayDepth,
  });

  const loopPath = busLoopPath(route.loop);
  const spurPath = buildPath(
    [
      { x: layout.gate.x, y: layout.gate.y },
      { x: site.roadCell.x, y: site.roadCell.y },
    ],
    false,
  );
  const bayPaths = layout.bays.map((b) =>
    buildPath(smoothOpen(b.path, 1), false),
  );
  const fleetPaths: FleetPaths = {
    loop: loopPath,
    spur: spurPath,
    bays: bayPaths,
    gateHeading: layout.gate.headingOut,
  };

  const candidateWaysCopy: RoadWay[] = candidateRoadWays.map((w) => ({
    ...w,
    path: w.path.map((cell) => ({ ...cell })),
  }));
  const stopJunctions = attachCapPolys(findJunctionZones(candidateWaysCopy));
  const stopAnchors = computeBusStopAnchors(
    loopPath,
    route.stops,
    undefined,
    tr.busLaneOffsetCells,
    (x, y) =>
      stopJunctions.some(
        (z) => z.poly.length >= 3 && nearPoly(x, y, z.poly, 0.5),
      ),
  );

  const fleetGeom = makeFleetGeometry(
    loopPath,
    spurPath,
    bayPaths,
    route.stops,
    stopAnchors.map((a) => a.arc),
  );
  const busFleet = makeFleet(tr, worldSeed);
  const busDepotPad = {
    x: site.x,
    y: site.y,
    w: site.w,
    h: site.h,
  };
  const busDepotSpurCells = new Set(
    [...spurKeys].filter((k) => k !== `${site.roadCell.x},${site.roadCell.y}`),
  );

  return {
    valid: true,
    busRoute: route,
    busDepot: { site, layout },
    fleetPaths,
    fleetGeom,
    stopAnchors,
    busFleet,
    busDepotPad,
    busDepotSpurCells,
  };
}
