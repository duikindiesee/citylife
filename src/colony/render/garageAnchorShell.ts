import type { GaragePad } from "../commerce/district";
import { CELL_SIZE } from "../scale";

export interface GarageAnchorShellModel {
  kind: "garage_anchor_shell";
  publicName: "Gearbox Auto Hub";
  isPublicSafe: true;
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
  drivewayApron: { w: number; d: number; z: number; y: number };
  parkingBays: { x: number; z: number; w: number; d: number; rot: number; label: string }[];
  nightFloor: {
    w: number;
    d: number;
    y: number;
    emissiveIntensity: { day: 0.12; night: 1.05 };
  };
  displayCars: { x: number; z: number; rot: number; scale: number }[];
}

export function garageAnchorNightFloorEmissive(daylight: number): number {
  const d = Math.max(0, Math.min(1, daylight));
  return 0.12 + (1 - d) * 0.93;
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
  // PLAYER.GARAGE.1 — every dimension above is authored in GRID CELLS (footprint = pad cells).
  // The render layer positions the shell in world metres (4 m per cell), so the mesh group must
  // be scaled by CELL_SIZE or the whole landmark renders at exactly quarter size on its pad —
  // the operator-reported "size is wrong" defect. Declared here, applied by the layer.
  const localFromGrid = (grid: { x: number; y: number }) => {
    const dx = grid.x - center.x;
    const dy = grid.y - center.y;
    const cos = Math.cos(garagePad.facingAngle);
    const sin = Math.sin(garagePad.facingAngle);
    return {
      x: dx * cos - dy * sin,
      z: dx * sin + dy * cos,
    };
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
  const forecourtDepth = footprint.d * 0.34;
  const forecourt = {
    w: footprint.w * 0.92,
    d: forecourtDepth,
    // Spec 114 — the forecourt slab sits in front of the workshop & showroom.
    frontOffset: Math.max(0, footprint.d / 2 - forecourtDepth / 2 - 0.01),
    y: 0.045,
  };

  // Spec 176 — Paved driveway throat / entrance apron connecting municipal road to forecourt.
  // Bridges the setback gap between the road ribbon and the garage pad so cars can drive in smoothly
  // without hitting a dirt verge or curb step.
  const roadTargetLocal = localFromGrid(garagePad.roadTarget);
  const apronFrontZ = Math.max(forecourt.frontOffset + forecourtDepth / 2 + 1.2, roadTargetLocal.z + 0.3);
  const apronBackZ = forecourt.frontOffset + forecourtDepth * 0.2;
  const apronDepth = Math.max(1.8, apronFrontZ - apronBackZ);
  const drivewayApron = {
    w: footprint.w * 0.72,
    d: apronDepth,
    z: apronBackZ + apronDepth / 2,
    y: 0.038,
  };

  // Spec 176 — Dedicated customer parking bays painted on the forecourt
  const bayW = 2.4;
  const bayD = 4.2;
  const parkingBays = [
    { x: -footprint.w * 0.32, z: forecourt.frontOffset + 0.1, w: bayW, d: bayD, rot: 0, label: "BAY 01" },
    { x: -footprint.w * 0.14, z: forecourt.frontOffset + 0.1, w: bayW, d: bayD, rot: 0, label: "BAY 02" },
    { x: footprint.w * 0.28, z: forecourt.frontOffset + 0.1, w: bayW, d: bayD, rot: 0, label: "BAY 03" },
  ];

  return {
    kind: "garage_anchor_shell",
    publicName: "Gearbox Auto Hub",
    isPublicSafe: true,
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
        x: -footprint.w * 0.22,
        z: forecourt.frontOffset,
        rot: -0.22,
        scale: 0.7,
      },
      {
        x: footprint.w * 0.18,
        z: forecourt.frontOffset * 0.92,
        rot: 0.18,
        scale: 0.68,
      },
    ],
  };
}
