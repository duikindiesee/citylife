import type { TestbedParcelInfo } from "./starterGarageCamera";

/** Testbed ground surfaces in metres, XZ plane. Shared by the testbed and fit tests. */
export const ROAD_WIDTH = 9;
export const ROAD_LENGTH = 120;
export const DRIVEWAY_WIDTH = 4;

export interface XzRect {
  name: string;
  cx: number;
  cz: number;
  /** Unit vector of the length axis (XZ). */
  alongX: number;
  alongZ: number;
  length: number;
  width: number;
}

export function testbedDoorFace(info: TestbedParcelInfo): [number, number] {
  const d = info.streetDir;
  return [info.garageWorld[0] + d[0] * 4, info.garageWorld[2] + d[1] * 4];
}

/** Plot-side edge of the testbed road (kerb line centre). */
export function testbedKerb(info: TestbedParcelInfo): [number, number] {
  const d = info.streetDir;
  return [
    info.roadCentreWorld[0] - d[0] * (ROAD_WIDTH / 2),
    info.roadCentreWorld[2] - d[1] * (ROAD_WIDTH / 2),
  ];
}

export function testbedGroundRects(info: TestbedParcelInfo): {
  road: XzRect;
  drivewayRects: XzRect[];
  kerb: [number, number];
  doorFace: [number, number];
} {
  const d = info.streetDir;
  const kerb = testbedKerb(info);
  const doorFace = testbedDoorFace(info);
  // Stop the drive at the plot-side road boundary; the kerb itself remains visible.
  const parcelKerb: [number, number] = [kerb[0] - d[0] * 0.005, kerb[1] - d[1] * 0.005];
  const driveLength = Math.hypot(doorFace[0] - parcelKerb[0], doorFace[1] - parcelKerb[1]) || 1;
  const driveMid: [number, number] = [(doorFace[0] + parcelKerb[0]) / 2, (doorFace[1] + parcelKerb[1]) / 2];
  const roadAlongX = Math.abs(d[1]) > 0.5;
  const alongX = roadAlongX ? 1 : 0;
  const alongZ = roadAlongX ? 0 : 1;
  const road: XzRect = {
    name: "road",
    cx: info.roadCentreWorld[0],
    cz: info.roadCentreWorld[2],
    alongX,
    alongZ,
    length: ROAD_LENGTH,
    width: ROAD_WIDTH,
  };
  const dx = (doorFace[0] - kerb[0]) / driveLength;
  const dz = (doorFace[1] - kerb[1]) / driveLength;
  const driveway: XzRect = {
    name: "driveway",
    cx: driveMid[0],
    cz: driveMid[1],
    alongX: dx,
    alongZ: dz,
    length: Math.max(0, driveLength - 0.005),
    width: DRIVEWAY_WIDTH,
  };
  return { road, drivewayRects: [driveway], kerb, doorFace };
}

function corners(r: XzRect): [number, number][] {
  const px = -r.alongZ, pz = r.alongX;
  const hx = r.alongX * (r.length / 2), hz = r.alongZ * (r.length / 2);
  const wx = px * (r.width / 2), wz = pz * (r.width / 2);
  return [
    [r.cx + hx + wx, r.cz + hz + wz],
    [r.cx + hx - wx, r.cz + hz - wz],
    [r.cx - hx - wx, r.cz - hz - wz],
    [r.cx - hx + wx, r.cz - hz + wz],
  ];
}

function project(r: XzRect, u: [number, number], v: [number, number]): { minU: number; maxU: number; minV: number; maxV: number } {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, z] of corners(r)) {
    const pu = x * u[0] + z * u[1];
    const pv = x * v[0] + z * v[1];
    minU = Math.min(minU, pu); maxU = Math.max(maxU, pu);
    minV = Math.min(minV, pv); maxV = Math.max(maxV, pv);
  }
  return { minU, maxU, minV, maxV };
}

/** Intersection area of two oriented rectangles in the XZ plane, in m². */
export function xzRectIntersectionArea(a: XzRect, b: XzRect): number {
  const u: [number, number] = [a.alongX, a.alongZ];
  const v: [number, number] = [-a.alongZ, a.alongX];
  const A = project(a, u, v), B = project(b, u, v);
  const du = Math.max(0, Math.min(A.maxU, B.maxU) - Math.max(A.minU, B.minU));
  const dv = Math.max(0, Math.min(A.maxV, B.maxV) - Math.max(A.minV, B.minV));
  return du * dv;
}

/** Positive gap (m) between rectangle edges; 0 if they touch or overlap. */
export function xzRectGap(a: XzRect, b: XzRect): number {
  const u: [number, number] = [a.alongX, a.alongZ];
  const v: [number, number] = [-a.alongZ, a.alongX];
  const A = project(a, u, v), B = project(b, u, v);
  const du = Math.max(0, Math.max(A.minU, B.minU) - Math.min(A.maxU, B.maxU));
  const dv = Math.max(0, Math.max(A.minV, B.minV) - Math.min(A.maxV, B.maxV));
  return Math.hypot(du, dv);
}
