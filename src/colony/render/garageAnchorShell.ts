import type { GaragePad } from "../commerce/district";

export interface GarageAnchorShellModel {
  kind: "garage_anchor_shell";
  publicName: "Gearbox Auto Hub";
  isPublicSafe: true;
  center: { x: number; y: number };
  baseY: number;
  facingAngle: number;
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
  const pylon = {
    w: 0.7,
    h: 5.4,
    d: 0.42,
    x: -footprint.w * 0.46,
    z: footprint.d * 0.43,
    y: 2.7,
  };
  const forecourt = {
    w: footprint.w * 0.92,
    d: footprint.d * 0.34,
    frontOffset: footprint.d * 0.52,
    y: 0.045,
  };
  return {
    kind: "garage_anchor_shell",
    publicName: "Gearbox Auto Hub",
    isPublicSafe: true,
    center,
    baseY,
    facingAngle: garagePad.facingAngle,
    footprint,
    showroom,
    serviceBay,
    pylon,
    forecourt,
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
