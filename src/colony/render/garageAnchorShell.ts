import type { GaragePad } from "../commerce/district";
import { CELL_SIZE } from "../scale";

export const GARAGE_ASSET_VERSION = "2.0.0";

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
  pylon: { w: number; h: number; d: number; x: number; z: number; y: number };
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
    emissiveIntensity: { day: 0.12; night: 1.05 };
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
  const showroom = {
    w: footprint.w * 0.52,
    h: 2.85,
    d: footprint.d * 0.5,
    x: -footprint.w * 0.22,
    z: footprint.d * 0.06,
    y: 1.425,
  };
  const serviceBay = {
    w: footprint.w * 0.58,
    h: 2.15,
    d: footprint.d * 0.56,
    x: footprint.w * 0.21,
    z: -footprint.d * 0.06,
    y: 1.075,
    doorCount: 3 as const,
    bayDoorW: footprint.w * 0.135,
  };
  // Dimensions are authored in GRID CELLS (footprint = pad cells).
  const localFromGrid = (grid: { x: number; y: number }) => {
    return localFromGridCoordinates(garagePad, grid.x, grid.y);
  };
  const pylonLocal = localFromGrid(garagePad.islandCell);
  const pylon = {
    w: 0.7,
    h: 5.4,
    d: 0.42,
    x: pylonLocal.x,
    z: pylonLocal.z,
    y: 2.7,
  };
  const forecourtDepth = footprint.d * 0.32;
  const forecourt = {
    w: footprint.w * 0.88,
    d: forecourtDepth,
    // Forecourt slab sits strictly within the surveyed pad boundaries, in front of the workshop & showroom.
    frontOffset: Math.max(0, footprint.d / 2 - forecourtDepth / 2 - 0.05),
    y: 0.045,
  };

  // Spec 177: Driveway Apron connecting forecourt forward to the municipal road edge
  const drivewayApron = {
    w: footprint.w * 0.54, // ~8.6 cells wide
    d: 4.8, // spans from forecourt forward into the road connection zone
    x: footprint.w * 0.1, // aligned between forecourt center and bay approach
    z: footprint.d / 2 + 2.0, // centered across the setback transition zone
    y: 0.04,
  };

  // Spec 176 / 177: Customer parking bays on the forecourt in front of showroom.
  // Oriented lengthwise into/out of the stall with rot: Math.PI / 2.
  // Stall depth (bayD = 1.25 cells = 5.0m) along Z; stall width (bayW = 0.68 cells = 2.72m) along X.
  // Positioned at bayZ = 4.28 on forecourt, providing 1.48m clearance from showroom glass wall (z = 3.41).
  const bayW = 0.68;
  const bayD = 1.25;
  const bayZ = 4.28;
  const stallRotation = Math.PI / 2; // Aligned with stall lines (not sideways across lines)
  const parkingBays = [
    {
      x: -footprint.w * 0.28,
      z: bayZ,
      w: bayW,
      d: bayD,
      rot: stallRotation,
      label: "BAY 01",
    },
    {
      x: -footprint.w * 0.16,
      z: bayZ,
      w: bayW,
      d: bayD,
      rot: stallRotation,
      label: "BAY 02",
    },
    {
      x: -footprint.w * 0.04,
      z: bayZ,
      w: bayW,
      d: bayD,
      rot: stallRotation,
      label: "BAY 03",
    },
  ];

  const bayFaceZ = serviceBay.z + serviceBay.d / 2 + 0.045;
  const bayDoorSpacing = serviceBay.bayDoorW * 1.25;

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
    {
      id: "open_service_bay_floor",
      kind: "bay_floor",
      x: serviceBay.x,
      z: bayFaceZ - serviceBay.d * 0.45,
      w: serviceBay.bayDoorW * 1.25,
      d: serviceBay.d * 0.82,
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
      x: serviceBay.x - serviceBay.w / 2,
      z: 0.1,
      y: showroom.y,
      w: 0.26,
      d: footprint.d * 0.58,
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
      emissiveIntensity: { day: 0.12, night: 1.05 },
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
