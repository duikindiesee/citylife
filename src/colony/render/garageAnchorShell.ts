import type { CommercialDistrict, GaragePad } from "../commerce/district";

export type PromenadeLampPosition = { x: number; y: number; side: 1 | -1 };

export function commercialPromenadeLampPosition(
  c: { x: number; y: number },
  streetIndex: number,
): PromenadeLampPosition {
  const side = Math.floor(streetIndex / 5) % 2 === 0 ? 1 : -1;
  return { x: c.x, y: c.y + side * 1.4, side };
}

function insideRect(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
  pad = 0,
): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.w - 1 + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.h - 1 + pad
  );
}

export function commercialPromenadeLampAllowed(
  p: { x: number; y: number },
  d: Pick<CommercialDistrict, "garagePad" | "mallPad" | "parcels">,
): boolean {
  if (d.garagePad && insideRect(p, d.garagePad, 0)) return false;
  if (insideRect(p, d.mallPad, 0)) return false;
  return !d.parcels.some((parcel) => insideRect(p, parcel, 0));
}

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
    d: footprint.d * 0.33,
    x: footprint.w * 0.21,
    z: 0,
    y: 1.075,
    doorCount: 3 as const,
    bayDoorW: footprint.w * 0.135,
  };
  const pylon = {
    w: serviceBay.w * 0.82,
    h: 0.38,
    d: 0.12,
    x: serviceBay.x,
    z: serviceBay.z + serviceBay.d / 2 + 0.055,
    y: serviceBay.h - 0.18,
  };
  const forecourt = {
    w: footprint.w * 0.92,
    d: footprint.d * 0.3,
    frontOffset: footprint.d * 0.26,
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
      w: footprint.w * 0.93,
      d: footprint.d * 0.86,
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
