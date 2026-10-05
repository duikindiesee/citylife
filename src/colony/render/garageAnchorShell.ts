import type { GaragePad } from "../commerce/district";
import type { Terrain } from "../terrain";
import { CELL_SIZE } from "../scale";
import { getSmoothRoadY } from "./roadSurface";
import { ROAD_RIBBON_LIFT } from "./roadRibbon";

export const GARAGE_ASSET_VERSION = "2.0.0";

/**
 * Corner sign pylon in REAL WORLD METRES. The garage group is scaled by
 * renderScale = CELL_SIZE, so the model stores these divided by CELL_SIZE.
 * Petrol-station style: 6.2 m pole, 1.8 m x 1.1 m black hammer-logo panel.
 */
export const GARAGE_PYLON_METRES = {
  poleHeight: 6.2,
  poleRadius: 0.16,
  panelW: 1.8,
  panelH: 1.1,
  panelD: 0.22,
  /** Collider footprint of the pole base (square side). */
  baseSide: 0.45,
} as const;

export interface GarageObstacle {
  readonly id: string;
  readonly kind:
    | "wall"
    | "glass"
    | "door"
    | "column"
    | "pole"
    | "lift_post"
    | "pylon";
  readonly shape: "box" | "cylinder";
  readonly x: number; // local center X in cells
  readonly z: number; // local center Z in cells
  readonly y: number; // local center Y in cells
  readonly w: number; // width along local X in cells
  readonly d: number; // depth along local Z in cells
  readonly h: number; // height in cells
  readonly radius?: number; // for cylinder, radius in cells
}

export interface GarageSurfaceZone {
  readonly id: string;
  readonly kind: "apron" | "forecourt" | "bay_floor" | "showroom_floor";
  readonly x: number; // local center X in cells
  readonly z: number; // local center Z in cells
  readonly w: number; // width in cells
  readonly d: number; // depth in cells
  readonly drivable: boolean; // can vehicles drive here
  readonly walkable: boolean; // can pedestrians walk here
}

export interface GarageAnchorShellModel {
  kind: "garage_anchor_shell";
  publicName: "Gearbox Auto Hub";
  isPublicSafe: true;
  assetVersion: "2.0.0";
  center: { x: number; y: number };
  baseY: number;
  facingAngle: number;
  /** Cells → metres factor the render layer must apply to the whole mesh group so the shell
   *  actually fills its surveyed pad (dimensions below are authored in grid cells). */
  renderScale: number;
  footprint: { w: number; d: number };
  showroom: {
    w: number;
    h: number;
    d: number;
    x: number;
    z: number;
    y: number;
  };
  serviceBay: {
    w: number;
    h: number;
    d: number;
    x: number;
    z: number;
    y: number;
    doorCount: 3;
    bayDoorW: number;
  };
  pylon: {
    w: number;
    h: number;
    d: number;
    x: number;
    z: number;
    y: number;
    /** Black hammer-logo sign panel atop the pole (asset-local cells). */
    panel: { w: number; h: number; d: number };
  };
  forecourt: { w: number; d: number; frontOffset: number; y: number };
  drivewayApron: {
    w: number;
    d: number;
    x: number;
    z: number;
    y: number;
  };
  parkingBays: {
    x: number;
    z: number;
    w: number;
    d: number;
    rot: number;
    label: string;
  }[];
  nightFloor: {
    w: number;
    d: number;
    y: number;
    emissiveIntensity: { day: number; night: number };
  };
  displayCars: { x: number; z: number; rot: number; scale: number }[];
  surfaces: GarageSurfaceZone[];
  obstacles: GarageObstacle[];
}

export function garageAnchorNightFloorEmissive(daylight: number): number {
  const d = Math.max(0, Math.min(1, daylight));
  return 0.12 + (1 - d) * 0.93;
}

/** Transform grid coordinate (gx, gy) to asset-local coordinate (lx, lz). */
export function localFromGridCoordinates(
  garagePad: Pick<GaragePad, "x" | "y" | "w" | "h" | "facingAngle">,
  gx: number,
  gy: number,
): { x: number; z: number } {
  const cx = garagePad.x + (garagePad.w - 1) / 2;
  const cy = garagePad.y + (garagePad.h - 1) / 2;
  const dx = gx - cx;
  const dy = gy - cy;
  const cos = Math.cos(garagePad.facingAngle);
  const sin = Math.sin(garagePad.facingAngle);
  return {
    x: dx * cos - dy * sin,
    z: dx * sin + dy * cos,
  };
}

/** Transform asset-local coordinate (lx, lz) to grid coordinate (gx, gy). */
export function gridFromLocalCoordinates(
  garagePad: Pick<GaragePad, "x" | "y" | "w" | "h" | "facingAngle">,
  lx: number,
  lz: number,
): { x: number; y: number } {
  const cx = garagePad.x + (garagePad.w - 1) / 2;
  const cy = garagePad.y + (garagePad.h - 1) / 2;
  const cos = Math.cos(garagePad.facingAngle);
  const sin = Math.sin(garagePad.facingAngle);
  return {
    x: cx + lx * cos + lz * sin,
    y: cy - lx * sin + lz * cos,
  };
}

/** Spec 177: Test whether coordinate (x, y) is in the garage vicinity (pad bounds + driveway apron throat). */
export function isPointInGarageVicinity(
  x: number,
  y: number,
  garagePad: Pick<GaragePad, "x" | "y" | "w" | "h" | "facingAngle">,
): boolean {
  const local = localFromGridCoordinates(garagePad, x, y);
  const halfW = garagePad.w / 2 + 0.8;
  const halfD = garagePad.h / 2 + 0.5;
  // Pad bounds
  if (Math.abs(local.x) <= halfW && Math.abs(local.z) <= halfD) {
    return true;
  }
  // Driveway apron throat extending forward (+Z) toward municipal road
  if (
    Math.abs(local.x) <= garagePad.w * 0.45 &&
    local.z > halfD - 0.5 &&
    local.z <= halfD + 5.0
  ) {
    return true;
  }
  return false;
}

/**
 * Spec 177: Continuous traversable and rendered surface height across the garage parcel,
 * apron ramp transition zone, and municipal road ribbon contact.
 *
 * For lz <= 4.2: flat forecourt / workshop pad at padSeatY + 0.16m.
 * For lz >= 7.8: municipal road ribbon at roadHeight + ROAD_RIBBON_LIFT (0.18m).
 * For lz in (4.2, 7.8): smoothstep interpolation ensuring C1 slope continuity with
 * zero cliff drops and zero discontinuity across the parcel-to-road transition.
 */
export function garageApronSurfaceY(
  garagePad: Pick<GaragePad, "x" | "y" | "w" | "h" | "facingAngle">,
  terrain: Pick<Terrain, "worldYAt">,
  roadRibbonCells: ReadonlyMap<string, number> | null | undefined,
  lx: number,
  lz: number,
  seatY?: number,
): number {
  const padSeat =
    seatY ??
    (() => {
      const s = terrain.worldYAt(
        garagePad.x + (garagePad.w - 1) / 2,
        garagePad.y + (garagePad.h - 1) / 2,
      );
      return Number.isFinite(s) ? Math.max(s, 0.65) : 0.65;
    })();

  const padTopWorldY = padSeat + 0.16;

  if (lz <= 4.2) {
    return padTopWorldY;
  }

  const ptRoad = gridFromLocalCoordinates(garagePad, lx, 7.8);
  const gx = Math.round(ptRoad.x);
  const gy = Math.round(ptRoad.y);
  const k = `${gx},${gy}`;
  const roadBase =
    roadRibbonCells?.get(k) ??
    Math.max(0, getSmoothRoadY(terrain, ptRoad.x, ptRoad.y));
  const roadTopWorldY = roadBase + ROAD_RIBBON_LIFT;

  if (lz >= 7.8) {
    return roadTopWorldY;
  }

  const u = (lz - 4.2) / (7.8 - 4.2);
  const sm = u * u * (3 - 2 * u);
  return padTopWorldY + (roadTopWorldY - padTopWorldY) * sm;
}

/**
 * Spec 177: Continuous ground elevation beneath the garage apron ramp for terrain leveling.
 * Grades the bare ground to support the asphalt apron mesh with zero hollow underbelly.
 */
export function garageApronGroundY(
  garagePad: Pick<GaragePad, "x" | "y" | "w" | "h" | "facingAngle">,
  terrain: Pick<Terrain, "worldYAt">,
  roadRibbonCells: ReadonlyMap<string, number> | null | undefined,
  lx: number,
  lz: number,
  seatY?: number,
): number {
  const padSeat =
    seatY ??
    (() => {
      const s = terrain.worldYAt(
        garagePad.x + (garagePad.w - 1) / 2,
        garagePad.y + (garagePad.h - 1) / 2,
      );
      return Number.isFinite(s) ? Math.max(s, 0.65) : 0.65;
    })();

  if (lz <= 4.2) {
    return padSeat;
  }

  const ptRoad = gridFromLocalCoordinates(garagePad, lx, 7.8);
  const gx = Math.round(ptRoad.x);
  const gy = Math.round(ptRoad.y);
  const k = `${gx},${gy}`;
  const roadBase =
    roadRibbonCells?.get(k) ??
    Math.max(0, getSmoothRoadY(terrain, ptRoad.x, ptRoad.y));

  if (lz >= 7.8) {
    return roadBase;
  }

  const u = (lz - 4.2) / (7.8 - 4.2);
  const sm = u * u * (3 - 2 * u);
  return padSeat + (roadBase - padSeat) * sm;
}

export function buildGarageAnchorShellModel(
  garagePad: GaragePad,
  surfaceY: (x: number, y: number) => number,
): GarageAnchorShellModel {
  const center = {
    x: garagePad.x + (garagePad.w - 1) / 2,
    y: garagePad.y + (garagePad.h - 1) / 2,
  };
  let baseY = Infinity;
  for (const x of [garagePad.x, garagePad.x + garagePad.w - 1])
    for (const y of [garagePad.y, garagePad.y + garagePad.h - 1])
      baseY = Math.min(baseY, surfaceY(x, y));
  const footprint = { w: garagePad.w, d: garagePad.h };
  // Spec 177: Comprehensive architectural redesign of Gearbox Auto Hub
  // West Wing: Grand double-height glass showroom pavilion (X in [-7.76, -0.08], Z in [-3.30, +2.20])
  // East Wing: High-tech motorsport service workshop (X in [+0.16, +7.52], Z in [-3.30, +2.20])
  // Dividing Core: Solid architectural pier/dividing wall at X = 0.0 with ZERO showroom columns in front of bay doors!
  // Symmetrical facade alignment at front Z = +2.20, leaving unobstructed apron approach to all rollup doors.
  const showroom = {
    w: footprint.w * 0.48, // 7.68 cells wide (~30.7m)
    h: 3.15,
    d: footprint.d * 0.5, // 5.50 cells deep (~22.0m)
    x: -footprint.w * 0.245, // -3.92 cells (spans [-7.76, -0.08])
    z: 1.45, // spans [-1.30, +4.20], aligning front facade with commercial district line
    y: 1.575,
  };
  const serviceBay = {
    w: footprint.w * 0.46, // 7.36 cells wide (~29.4m)
    h: 2.35,
    d: footprint.d * 0.5, // 5.50 cells deep (~22.0m)
    x: footprint.w * 0.24, // +3.84 cells (spans [+0.16, +7.52])
    z: 1.45, // spans [-1.30, +4.20], aligning front facade with showroom
    y: 1.175,
    doorCount: 3 as const,
    bayDoorW: footprint.w * 0.115, // 1.84 cells wide (~7.4m per bay)
  };
  // Dimensions are authored in GRID CELLS (footprint = pad cells).
  const localFromGrid = (grid: { x: number; y: number }) => {
    return localFromGridCoordinates(garagePad, grid.x, grid.y);
  };
  // Spec 177 (PR 555 re-review): the pylon stands at the street-facing PLOT CORNER on the
  // side of the surveyed islandCell. With the facade moved forward to z = +4.2 the raw
  // islandCell (z = +4.0) now falls inside the workshop footprint, so the pole is pushed
  // to the pad's front corner, 0.4 cells in from both pad edges: outside the building
  // line, outside the driveway apron/forecourt, and still on the owned pad.
  const islandLocal = localFromGrid(garagePad.islandCell);
  const cornerInset = 0.4;
  const toCells = (m: number) => m / CELL_SIZE;
  const pylon = {
    w: toCells(GARAGE_PYLON_METRES.baseSide),
    h: toCells(GARAGE_PYLON_METRES.poleHeight),
    d: toCells(GARAGE_PYLON_METRES.baseSide),
    x: Math.sign(islandLocal.x || 1) * (footprint.w / 2 - cornerInset),
    z: Math.sign(islandLocal.z || 1) * (footprint.d / 2 - cornerInset),
    y: toCells(GARAGE_PYLON_METRES.poleHeight) / 2,
    panel: {
      w: toCells(GARAGE_PYLON_METRES.panelW),
      h: toCells(GARAGE_PYLON_METRES.panelH),
      d: toCells(GARAGE_PYLON_METRES.panelD),
    },
  };
  const forecourtDepth = 1.1;
  const forecourt = {
    w: footprint.w * 0.88,
    d: forecourtDepth,
    // Forecourt slab sits strictly within the surveyed pad boundaries, in front of the workshop & showroom.
    frontOffset: 4.8,
    y: 0.045,
  };

  // Spec 177: Driveway Apron connecting forecourt forward to the municipal road edge without penetrating carriageway
  const drivewayApron = {
    w: footprint.w * 0.72, // ~11.5 cells wide, spanning full approach to bays and stalls
    d: 3.6, // spans from Z=4.20 to Z=7.80, stopping at road edge (world Y=267.20 >= 267.0)
    x: footprint.w * 0.08, // aligned across bay approach and forecourt
    z: 6.0, // centered across the setback transition zone
    y: 0.04,
  };

  // Spec 176 / 177: Customer parking bays on the forecourt in front of showroom.
  // Oriented lengthwise into/out of the stall with rot: Math.PI / 2.
  // Stall depth (bayD = 1.25 cells = 5.0m) along Z; stall width (bayW = 0.68 cells = 2.72m) along X.
  // Positioned at bayZ = 4.80 on forecourt, providing wide clearance to showroom glass wall.
  const bayW = 0.68;
  const bayD = 1.25;
  const bayZ = 4.8;
  const stallRotation = Math.PI / 2; // Aligned with stall lines (not sideways across lines)
  const parkingBays = [
    {
      x: -footprint.w * 0.32,
      z: bayZ,
      w: bayW,
      d: bayD,
      rot: stallRotation,
      label: "BAY 01",
    },
    {
      x: -footprint.w * 0.21,
      z: bayZ,
      w: bayW,
      d: bayD,
      rot: stallRotation,
      label: "BAY 02",
    },
    {
      x: -footprint.w * 0.1,
      z: bayZ,
      w: bayW,
      d: bayD,
      rot: stallRotation,
      label: "BAY 03",
    },
  ];

  const bayFaceZ = serviceBay.z + serviceBay.d / 2 + 0.045;
  const bayDoorSpacing = serviceBay.bayDoorW * 1.25;
  const bay1X = serviceBay.x - bayDoorSpacing;
  const bay2X = serviceBay.x;
  const bay3X = serviceBay.x + bayDoorSpacing;
  const hdw = serviceBay.bayDoorW / 2;
  const westX = serviceBay.x - serviceBay.w / 2;
  const eastX = serviceBay.x + serviceBay.w / 2;
  const pierZ = serviceBay.z + serviceBay.d / 2 - 0.11;
  const pierH = serviceBay.h * 0.78;

  // Spec 177: Discrete Drivable & Walkable Surface Zones in asset-local coordinates
  const surfaces: GarageSurfaceZone[] = [
    // 1. Driveway Apron throat linking municipal road to the parcel
    {
      id: "driveway_apron",
      kind: "apron",
      x: drivewayApron.x,
      z: drivewayApron.z,
      w: drivewayApron.w,
      d: drivewayApron.d,
      drivable: true,
      walkable: true,
    },
    // 2. Forecourt parking apron and maneuvering lane
    {
      id: "forecourt_parking",
      kind: "forecourt",
      x: 0,
      z: forecourt.frontOffset,
      w: forecourt.w,
      d: forecourt.d + 0.5,
      drivable: true,
      walkable: true,
    },
    // 3. Open Service Bay 2 interior floor (drive in onto inspection lift)
    // Sized to fit cleanly within the open bay corridor between partition inner faces
    {
      id: "open_service_bay_floor",
      kind: "bay_floor",
      x: serviceBay.x,
      z: bayFaceZ - serviceBay.d * 0.45,
      w: serviceBay.bayDoorW * 1.05,
      d: serviceBay.d * 0.95,
      drivable: true,
      walkable: true,
    },
    // 4. Showroom interior floor (pedestrian walk-in customer area)
    {
      id: "showroom_interior_floor",
      kind: "showroom_floor",
      x: showroom.x,
      z: showroom.z,
      w: showroom.w * 0.94,
      d: showroom.d * 0.94,
      drivable: false,
      walkable: true,
    },
  ];

  // Spec 177: Discrete Physical Obstacle Shapes in asset-local coordinates
  // Open Bay 2 is explicitly 100% CLEAR of door obstacles.
  // The service bay approach has ZERO obstructing light poles.
  const obstacles: GarageObstacle[] = [
    // --- Showroom Exterior Walls ---
    {
      id: "showroom_glass_front",
      kind: "glass",
      shape: "box",
      x: showroom.x,
      z: showroom.z + showroom.d / 2,
      y: showroom.y,
      w: showroom.w,
      d: 0.22,
      h: showroom.h,
    },
    {
      id: "showroom_wall_west",
      kind: "wall",
      shape: "box",
      x: showroom.x - showroom.w / 2,
      z: showroom.z,
      y: showroom.y,
      w: 0.22,
      d: showroom.d,
      h: showroom.h,
    },
    {
      id: "showroom_wall_back",
      kind: "wall",
      shape: "box",
      x: showroom.x,
      z: showroom.z - showroom.d / 2,
      y: showroom.y,
      w: showroom.w,
      d: 0.22,
      h: showroom.h,
    },
    // --- Central Dividing Wall between Showroom and Service Bay ---
    {
      id: "dividing_wall",
      kind: "wall",
      shape: "box",
      x: (showroom.x + showroom.w / 2 + serviceBay.x - serviceBay.w / 2) / 2,
      z: showroom.z,
      y: showroom.y,
      w: 0.28,
      d: showroom.d,
      h: showroom.h,
    },
    // --- Service Bay Exterior Walls ---
    {
      id: "service_bay_wall_back",
      kind: "wall",
      shape: "box",
      x: serviceBay.x,
      z: serviceBay.z - serviceBay.d / 2,
      y: serviceBay.y,
      w: serviceBay.w,
      d: 0.22,
      h: serviceBay.h,
    },
    {
      id: "service_bay_wall_east",
      kind: "wall",
      shape: "box",
      x: serviceBay.x + serviceBay.w / 2,
      z: serviceBay.z,
      y: serviceBay.y,
      w: 0.22,
      d: serviceBay.d,
      h: serviceBay.h,
    },
    // --- Service Bay Interior Partition Walls (Spec 177) ---
    // Solid divider walls enclosing closed Bays 1 and 3 while leaving Bay 2 completely open
    {
      id: "service_bay_partition_1_2",
      kind: "wall",
      shape: "box",
      x: (bay1X + hdw + bay2X - hdw) / 2,
      z: serviceBay.z,
      y: serviceBay.y,
      w: 0.22,
      d: serviceBay.d - 0.44,
      h: serviceBay.h,
    },
    {
      id: "service_bay_partition_2_3",
      kind: "wall",
      shape: "box",
      x: (bay2X + hdw + bay3X - hdw) / 2,
      z: serviceBay.z,
      y: serviceBay.y,
      w: 0.22,
      d: serviceBay.d - 0.44,
      h: serviceBay.h,
    },
    // --- Service Bay Front Structural Piers (Spec 177) ---
    // Structural piers framing the 3 bay door openings along the front facade
    {
      id: "service_bay_pier_west",
      kind: "wall",
      shape: "box",
      x: (westX + bay1X - hdw) / 2,
      z: pierZ,
      y: pierH / 2,
      w: bay1X - hdw - westX,
      d: 0.22,
      h: pierH,
    },
    {
      id: "service_bay_pier_1_2",
      kind: "wall",
      shape: "box",
      x: (bay1X + hdw + bay2X - hdw) / 2,
      z: pierZ,
      y: pierH / 2,
      w: bay2X - hdw - (bay1X + hdw),
      d: 0.22,
      h: pierH,
    },
    {
      id: "service_bay_pier_2_3",
      kind: "wall",
      shape: "box",
      x: (bay2X + hdw + bay3X - hdw) / 2,
      z: pierZ,
      y: pierH / 2,
      w: bay3X - hdw - (bay2X + hdw),
      d: 0.22,
      h: pierH,
    },
    {
      id: "service_bay_pier_east",
      kind: "wall",
      shape: "box",
      x: (bay3X + hdw + eastX) / 2,
      z: pierZ,
      y: pierH / 2,
      w: eastX - (bay3X + hdw),
      d: 0.22,
      h: pierH,
    },
    // --- Closed Service Bay Rollup Doors (Bay 1 and Bay 3) ---
    {
      id: "rollup_door_1",
      kind: "door",
      shape: "box",
      x: serviceBay.x - bayDoorSpacing,
      z: bayFaceZ,
      y: serviceBay.y,
      w: serviceBay.bayDoorW,
      d: 0.2,
      h: serviceBay.h,
    },
    {
      id: "rollup_door_3",
      kind: "door",
      shape: "box",
      x: serviceBay.x + bayDoorSpacing,
      z: bayFaceZ,
      y: serviceBay.y,
      w: serviceBay.bayDoorW,
      d: 0.2,
      h: serviceBay.h,
    },
    // Note: Bay 2 (middle door at x = serviceBay.x) is OPEN! NO DOOR OBSTACLE!

    // --- Service Bay Hydraulic Car Lift Posts (Inside Bay 2) ---
    {
      id: "lift_post_left",
      kind: "lift_post",
      shape: "box",
      x: serviceBay.x - serviceBay.bayDoorW * 0.38,
      z: bayFaceZ - serviceBay.d * 0.26,
      y: serviceBay.h * 0.32,
      w: 0.2,
      d: 0.22,
      h: serviceBay.h * 0.65,
    },
    {
      id: "lift_post_right",
      kind: "lift_post",
      shape: "box",
      x: serviceBay.x + serviceBay.bayDoorW * 0.38,
      z: bayFaceZ - serviceBay.d * 0.26,
      y: serviceBay.h * 0.32,
      w: 0.2,
      d: 0.22,
      h: serviceBay.h * 0.65,
    },

    // --- Corner Sign Pylon ---
    {
      id: "corner_pylon",
      kind: "pylon",
      shape: "box",
      x: pylon.x,
      z: pylon.z,
      y: pylon.y,
      w: pylon.w,
      d: pylon.d,
      h: pylon.h,
    },

    // --- Forecourt Perimeter Lighting Pole ---
    // Placed strictly on the far western perimeter curb corner, completely clear of all vehicle driving paths.
    // The old stanchion on the east side (which blocked the service bay entrance) is eliminated!
    {
      id: "forecourt_light_pole_west",
      kind: "pole",
      shape: "cylinder",
      x: -forecourt.w / 2 + 0.4,
      z: forecourt.frontOffset + forecourt.d / 2 - 0.3,
      y: 2.1,
      w: 0.25,
      d: 0.25,
      h: 4.2,
      radius: 0.12,
    },
  ];

  return {
    kind: "garage_anchor_shell",
    publicName: "Gearbox Auto Hub",
    isPublicSafe: true,
    assetVersion: GARAGE_ASSET_VERSION,
    center,
    baseY,
    facingAngle: garagePad.facingAngle,
    renderScale: CELL_SIZE,
    footprint,
    showroom,
    serviceBay,
    pylon,
    forecourt,
    drivewayApron,
    parkingBays,
    nightFloor: {
      w: footprint.w * 0.98,
      d: footprint.d * 0.92,
      y: 0.035,
      emissiveIntensity: { day: 0.0, night: 0.0 },
    },
    displayCars: [
      {
        x: parkingBays[0]!.x,
        z: parkingBays[0]!.z,
        rot: parkingBays[0]!.rot,
        scale: 1.0,
      },
      {
        x: parkingBays[1]!.x,
        z: parkingBays[1]!.z,
        rot: parkingBays[1]!.rot,
        scale: 1.0,
      },
    ],
    surfaces,
    obstacles,
  };
}

/** Check if a 2D local point (lx, lz) intersects any discrete obstacle in model.obstacles. */
export function isPointInsideGarageObstacle(
  lx: number,
  lz: number,
  obstacles: readonly GarageObstacle[],
  margin = 0.05,
): boolean {
  for (const obs of obstacles) {
    if (obs.shape === "cylinder") {
      const r = (obs.radius ?? obs.w / 2) + margin;
      const d2 = (lx - obs.x) ** 2 + (lz - obs.z) ** 2;
      if (d2 <= r * r) return true;
    } else {
      const hw = obs.w / 2 + margin;
      const hd = obs.d / 2 + margin;
      if (Math.abs(lx - obs.x) <= hw && Math.abs(lz - obs.z) <= hd) {
        return true;
      }
    }
  }
  return false;
}

/** Check if a 2D local point (lx, lz) is within any drivable surface zone. */
export function isPointInDrivableSurface(
  lx: number,
  lz: number,
  surfaces: readonly GarageSurfaceZone[],
): boolean {
  for (const s of surfaces) {
    if (!s.drivable) continue;
    const hw = s.w / 2;
    const hd = s.d / 2;
    if (Math.abs(lx - s.x) <= hw && Math.abs(lz - s.z) <= hd) {
      return true;
    }
  }
  return false;
}

/** Check if a 2D local point (lx, lz) is within any walkable surface zone. */
export function isPointInWalkableSurface(
  lx: number,
  lz: number,
  surfaces: readonly GarageSurfaceZone[],
): boolean {
  for (const s of surfaces) {
    if (!s.walkable) continue;
    const hw = s.w / 2;
    const hd = s.d / 2;
    if (Math.abs(lx - s.x) <= hw && Math.abs(lz - s.z) <= hd) {
      return true;
    }
  }
  return false;
}

/**
 * Spec 177: Exact Separating Axis Theorem (SAT) swept footprint collision check in asset-local coordinates.
 * Tests vehicle oriented bounding box (OBB) against discrete obstacle boxes and cylinders.
 * Returns true if the full vehicle footprint is 100% clear of all obstacles.
 */
export function isCarFootprintClearOfGarageObstacles(
  carGridX: number,
  carGridY: number,
  carHeading: number,
  garagePad: Pick<GaragePad, "x" | "y" | "w" | "h" | "facingAngle">,
  obstacles: readonly GarageObstacle[],
  halfLengthMetres = 1.8,
  halfWidthMetres = 0.75,
  cellMetres = 4,
): boolean {
  const carLocal = localFromGridCoordinates(garagePad, carGridX, carGridY);
  // Heading in local asset coordinates
  const localAngle = carHeading - garagePad.facingAngle;
  const cosA = Math.cos(localAngle);
  const sinA = Math.sin(localAngle);
  const absCosA = Math.abs(cosA);
  const absSinA = Math.abs(sinA);

  const hL = halfLengthMetres / cellMetres;
  const hW = halfWidthMetres / cellMetres;

  for (const obs of obstacles) {
    const ohw =
      obs.shape === "cylinder" ? (obs.radius ?? obs.w / 2) : obs.w / 2;
    const ohd =
      obs.shape === "cylinder" ? (obs.radius ?? obs.d / 2) : obs.d / 2;

    const dx = obs.x - carLocal.x;
    const dz = obs.z - carLocal.z;

    // Test Axis 1: Obstacle X axis
    const carProjX = hL * absCosA + hW * absSinA;
    if (Math.abs(dx) > ohw + carProjX) continue;

    // Test Axis 2: Obstacle Z axis
    const carProjZ = hL * absSinA + hW * absCosA;
    if (Math.abs(dz) > ohd + carProjZ) continue;

    // Test Axis 3: Car longitudinal axis (along car)
    const along = dx * cosA + dz * sinA;
    const obsProjAlong = ohw * absCosA + ohd * absSinA;
    if (Math.abs(along) > hL + obsProjAlong) continue;

    // Test Axis 4: Car lateral axis (across car)
    const across = -dx * sinA + dz * cosA;
    const obsProjAcross = ohw * absSinA + ohd * absCosA;
    if (Math.abs(across) > hW + obsProjAcross) continue;

    // Overlaps on all 4 separating axes -> Collision detected!
    return false;
  }
  return true;
}
