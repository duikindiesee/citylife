import type { Parcel } from "../neighborhood";
import { CELL_SIZE } from "../scale";
import { parcelStreetDirection } from "../parcelGeometry";
import type { GroundAt } from "../render/kitGround";

/** Limits gathered in sloped-plots-2026-11-22.md §§1.1–1.5. */
export const SLOPE_LIMITS = {
  /** SANS 10400-D §4.3(a): 1:25 in the first 5 m from a street boundary. */
  driveMaxNearStreet: 1 / 25,
  driveNearStreetM: 5,
  /** Functional driveway cap selected from the sourced residential practice in §1.4. */
  driveMax: 1 / 8,
  /** SANS 10400-H standard single-storey detail: fill under floor <= 1.0 m. */
  padFillMaxM: 1.0,
  /** Saldanha Bay IZS 2021 §27(a). */
  floorAboveNglMaxM: 0.5,
  /** SANS 10400 damp protection: floor at least 150 mm over finished ground. */
  floorAboveFinishedMinM: 0.15,
  /** SANS 10400-G permanent cut/bank batter: 1:2. */
  bankMaxGradient: 0.5,
  /** Saldanha Bay IZS 2021 §27(b). */
  wallFaceMaxM: 2.0,
  /** Saldanha Bay IZS 2021 §27(c). */
  terraceCumulativeM: 2.5,
  /** SANS 10400-K Table 16 standard wall; higher walls need rational design. */
  engineerWallM: 1.3,
  /** SANS 10400-H 4.3.2.1.5 site grading threshold. */
  rejectGradient: 0.25,
} as const;

export type SlopeBand = "level" | "gentle" | "moderate" | "steep-uphill" | "steep-downhill" | "reject";
export type GradingTechnique = "level-pad" | "house-platform" | "platform-retaining-wall" | "street-level-garage-cut" | "undercroft-garage" | "reject";
export type GradingViolation = { limit: keyof typeof SLOPE_LIMITS | "rejectGradient"; value: number };
export const UNDERCROFT_STOREY_M = 3.0;
export interface PlotGrading {
  band: SlopeBand;
  technique: GradingTechnique;
  gradient: number;
  gradientDir: [number, number];
  streetY: number;
  padY: number;
  houseFloorY: number;
  rearFloorY: number;
  maxCutM: number;
  maxFillM: number;
  banks: { lengthM: number; heightM: number; gradient: number }[];
  retainingWalls: { from: [number, number]; to: [number, number]; faceHeightM: number; terraces: number; needsEngineer: boolean }[];
  garageFloorY: number;
  garageMode: "on-pad" | "street-level-cut" | "undercroft";
  garageCutDepthM: number;
  garageFillM: number;
  drive: { stationsM: number[]; y: number[]; maxGradeNear: number; maxGrade: number };
  smallholding: boolean;
  padAreaM2: number;
  garageFallback: boolean;
  ok: boolean;
  violations: GradingViolation[];
}

type Rect = { x: number; y: number; w: number; d: number };
type Sample = { x: number; y: number; z: number };

function samples(rect: Rect, groundAt: GroundAt): Sample[] {
  const out: Sample[] = [];
  // Half-metre spacing captures the footprint corners and interior without assuming cell-centre terrain.
  const step = 0.5 / CELL_SIZE;
  for (let y = rect.y - 0.5; y <= rect.y + rect.d - 0.5 + 1e-8; y += step) {
    for (let x = rect.x - 0.5; x <= rect.x + rect.w - 0.5 + 1e-8; x += step) {
      out.push({ x, y, z: groundAt(x, y) });
    }
  }
  return out;
}

function fitPlane(points: Sample[]): { a: number; b: number; c: number } {
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sz += p.z; sxx += p.x * p.x; syy += p.y * p.y;
    sxy += p.x * p.y; sxz += p.x * p.z; syz += p.y * p.z;
  }
  const n = points.length;
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const v = [sxz, syz, sz];
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(A[j]![i]!) > Math.abs(A[pivot]![i]!)) pivot = j;
    [A[i], A[pivot]] = [A[pivot]!, A[i]!]; [v[i], v[pivot]] = [v[pivot]!, v[i]!];
    const div = A[i]![i]! || 1;
    for (let k = i; k < 3; k++) A[i]![k]! /= div;
    v[i]! /= div;
    for (let j = 0; j < 3; j++) if (j !== i) {
      const f = A[j]![i]!;
      for (let k = i; k < 3; k++) A[j]![k]! -= f * A[i]![k]!;
      v[j]! -= f * v[i]!;
    }
  }
  return { a: v[0]!, b: v[1]!, c: v[2]! };
}

function bandFor(g: number, inlandRise: number): SlopeBand {
  if (g < 0.03) return "level";
  if (g < 0.08) return "gentle";
  if (g < 0.125) return "moderate";
  if (g < SLOPE_LIMITS.rejectGradient) return inlandRise >= 0 ? "steep-uphill" : "steep-downhill";
  return "reject";
}

function techniqueFor(band: SlopeBand): GradingTechnique {
  const lookup: Record<SlopeBand, GradingTechnique> = { level: "level-pad", gentle: "house-platform", moderate: "platform-retaining-wall", "steep-uphill": "street-level-garage-cut", "steep-downhill": "undercroft-garage", reject: "reject" };
  return lookup[band];
}

/** Select a deterministic earthworks approach from sampled ground elevations. Coordinates and footprint are grid cells. */
export function gradePlot(parcel: Parcel, groundAt: GroundAt, opts: { houseFootprint?: { x: number; y: number; w: number; d: number } } = {}): PlotGrading {
  const z = parcel.houseZone;
  const footprint = opts.houseFootprint ?? { x: z.x, y: z.y, w: z.w, d: z.d };
  const housePts = samples(footprint, groundAt);
  const ring = [...parcel.fence, parcel.gate];
  // Residential parcel x/y are centre cells. Match zonedPlacementFromParcel's floor-based
  // bounds convention, which also handles even-depth parcels without shifting a half-cell.
  const plot = parcel.fence.length === 0
    ? {
        x: parcel.x - Math.floor((parcel.w - 1) / 2),
        y: parcel.y - Math.floor((parcel.h - 1) / 2),
        w: parcel.w,
        d: parcel.h,
      }
    : {
        x: Math.min(...ring.map((c) => c.x)) - 0.5,
        y: Math.min(...ring.map((c) => c.y)) - 0.5,
        w: Math.max(...ring.map((c) => c.x)) - Math.min(...ring.map((c) => c.x)) + 1,
        d: Math.max(...ring.map((c) => c.y)) - Math.min(...ring.map((c) => c.y)) + 1,
      };
  const plotPts = samples(plot, (x, y) => groundAt(x, y));
  const plane = fitPlane(plotPts);
  const [streetX, streetYdir] = parcelStreetDirection(parcel);
  const inward = [-streetX, -streetYdir] as const;
  const gx = plane.a / CELL_SIZE, gy = plane.b / CELL_SIZE;
  const gradient = Math.hypot(gx, gy);
  const gradientDir: [number, number] = gradient > 0 ? [gx / gradient, gy / gradient] : [0, 0];
  const inlandRise = gx * inward[0] + gy * inward[1];
  const band = bandFor(gradient, inlandRise);
  const technique = techniqueFor(band);
  const all = housePts.map((p) => p.z);
  const low = Math.min(...all), high = Math.max(...all);
  const violations: GradingViolation[] = [];
  const smallholding = parcel.tier === "GRAND" || parcel.w >= 25;
  const padAreaM2 = Math.min((footprint.w + 0.5) * (footprint.d + 0.5), (footprint.w + 1) * (footprint.d + 1)) * CELL_SIZE * CELL_SIZE;
  // The floor-above-NGL rule binds at the lowest footprint sample; apply both upper clamps
  // in sequence and let any resulting imbalance become cut.
  let padY = Math.min((low + high) / 2, low + SLOPE_LIMITS.floorAboveNglMaxM - SLOPE_LIMITS.floorAboveFinishedMinM);
  padY = Math.min(padY, low + SLOPE_LIMITS.padFillMaxM);
  const maxCutM = Math.max(0, high - padY);
  const maxFillM = Math.max(0, padY - low);
  const houseFloorY = padY + SLOPE_LIMITS.floorAboveFinishedMinM;
  if (maxFillM > SLOPE_LIMITS.padFillMaxM + 1e-6) violations.push({ limit: "padFillMaxM", value: maxFillM });
  if (houseFloorY - low > SLOPE_LIMITS.floorAboveNglMaxM + SLOPE_LIMITS.floorAboveFinishedMinM + 1e-6) violations.push({ limit: "floorAboveNglMaxM", value: houseFloorY - low });

  const banks: PlotGrading["banks"] = [];
  const retainingWalls: PlotGrading["retainingWalls"] = [];
  const minY = plot.y, maxY = plot.y + plot.d;
  const frontDepth = Math.max(0, (footprint.y - minY) * CELL_SIZE);
  const rearDepth = Math.max(0, (maxY - (footprint.y + footprint.d)) * CELL_SIZE);
  const uphill = inlandRise >= 0;
  const edges = [
    { height: uphill ? maxCutM : maxFillM, depth: frontDepth, y: footprint.y, fill: !uphill },
    { height: uphill ? maxFillM : maxCutM, depth: rearDepth, y: footprint.y + footprint.d, fill: uphill },
  ];
  for (const edge of edges) {
    if (edge.height <= 1e-9) continue;
    const bankLengthM = edge.height / SLOPE_LIMITS.bankMaxGradient;
    const absorbed = Math.min(edge.height, edge.depth * SLOPE_LIMITS.bankMaxGradient);
    if (absorbed > 1e-9) banks.push({ lengthM: absorbed / SLOPE_LIMITS.bankMaxGradient, heightM: absorbed, gradient: SLOPE_LIMITS.bankMaxGradient });
    const face = edge.height - absorbed;
    if (face > 1e-9) {
      const terraces = Math.max(1, Math.ceil(face / SLOPE_LIMITS.wallFaceMaxM));
      const perTerrace = face / terraces;
      const x0 = footprint.x, x1 = footprint.x + footprint.w;
      retainingWalls.push({ from: [x0, edge.y], to: [x1, edge.y], faceHeightM: perTerrace, terraces, needsEngineer: perTerrace > SLOPE_LIMITS.engineerWallM });
      if (face > SLOPE_LIMITS.terraceCumulativeM) violations.push({ limit: "terraceCumulativeM", value: face });
    }
  }

  const gateGroundY = groundAt(parcel.gate.x, parcel.gate.y);
  const streetY = gateGroundY;
  const driveLength = Math.max(0, parcel.driveway.length - 1) * CELL_SIZE;
  const nearLength = Math.min(SLOPE_LIMITS.driveNearStreetM, driveLength);
  const nearRise = nearLength * SLOPE_LIMITS.driveMaxNearStreet;
  let garageFloorY = padY;
  let garageMode: PlotGrading["garageMode"] = band === "steep-uphill" ? "street-level-cut" : band === "steep-downhill" ? "undercroft" : "on-pad";
  let garageFallback = false;
  const inX = -streetX, inY = -streetYdir;
  const doorOffsetCells = garageMode === "undercroft" ? 1 / CELL_SIZE : 1;
  const doorX = parcel.gate.x + inX * doorOffsetCells;
  const doorY = parcel.gate.y + inY * doorOffsetCells;
  if (garageMode === "street-level-cut") garageFloorY = streetY + Math.max(-CELL_SIZE * SLOPE_LIMITS.driveMaxNearStreet, Math.min(CELL_SIZE * SLOPE_LIMITS.driveMaxNearStreet, padY - streetY));
  else if (garageMode === "undercroft") garageFloorY = streetY - 1 * SLOPE_LIMITS.driveMaxNearStreet;
  const routeLength = garageMode === "undercroft" ? 1 : garageMode === "street-level-cut" ? CELL_SIZE : driveLength;
  const routeNear = Math.min(SLOPE_LIMITS.driveNearStreetM, routeLength);
  const stationsM = routeLength > routeNear ? [0, routeNear, routeLength] : [0, routeLength];
  let driveY: number[];
  const routeNearRise = routeNear * SLOPE_LIMITS.driveMaxNearStreet;
  const nearTarget = streetY + Math.max(-routeNearRise, Math.min(routeNearRise, garageFloorY - streetY));
  driveY = routeLength > routeNear ? [streetY, nearTarget, garageFloorY] : [streetY, garageFloorY];
  const garageRearY = groundAt(doorX + inX * (8 / CELL_SIZE), doorY + inY * (8 / CELL_SIZE));
  const garageCutDepthM = garageMode === "street-level-cut" || garageMode === "undercroft" ? Math.max(0, garageRearY - garageFloorY) : 0;
  let garageFillM = garageMode === "undercroft" ? Math.max(0, garageFloorY - garageRearY) : 0;
  let finalHouseFloorY = houseFloorY;
  let rearFloorY = houseFloorY;
  if (garageMode === "undercroft") {
    finalHouseFloorY = garageFloorY + UNDERCROFT_STOREY_M;
    rearFloorY = padY + SLOPE_LIMITS.floorAboveFinishedMinM;
    padY = garageFloorY - SLOPE_LIMITS.floorAboveFinishedMinM;
    const doorNgl = groundAt(doorX, doorY);
    if (garageFloorY > doorNgl + SLOPE_LIMITS.floorAboveNglMaxM + 1e-6) violations.push({ limit: "floorAboveNglMaxM", value: garageFloorY - doorNgl });
    // Undercroft garage floors are suspended on foundation walls; garageFillM is informational.
  }
  const maxGradeNear = stationsM[1]! > 0 ? Math.abs(driveY[1]! - driveY[0]!) / stationsM[1]! : 0;
  const restLength = routeLength - routeNear;
  const maxGrade = restLength > 0 && driveY.length > 2 ? Math.abs(driveY[2]! - driveY[1]!) / restLength : maxGradeNear;
  let fallbackRouteLength = routeLength;
  let fallbackDoorX = doorX;
  let fallbackDoorY = doorY;
  // A rejected plot is not built; keep its garage mode on-pad for reporting.
  if ((maxGradeNear > SLOPE_LIMITS.driveMaxNearStreet + 1e-6 || maxGrade > SLOPE_LIMITS.driveMax + 1e-6) && garageMode === "on-pad" && band !== "reject") {
    garageFallback = true;
    garageMode = inlandRise >= 0 ? "street-level-cut" : "undercroft";
    const fallbackDoorOffset = garageMode === "undercroft" ? 1 / CELL_SIZE : 1;
    fallbackDoorX = parcel.gate.x + inX * fallbackDoorOffset;
    fallbackDoorY = parcel.gate.y + inY * fallbackDoorOffset;
    garageFloorY = garageMode === "street-level-cut"
      ? streetY + Math.max(-CELL_SIZE * SLOPE_LIMITS.driveMaxNearStreet, Math.min(CELL_SIZE * SLOPE_LIMITS.driveMaxNearStreet, padY - streetY))
      : streetY - SLOPE_LIMITS.driveMaxNearStreet;
    fallbackRouteLength = garageMode === "undercroft" ? 1 : CELL_SIZE;
    const fallbackNear = Math.min(SLOPE_LIMITS.driveNearStreetM, fallbackRouteLength);
    const fallbackTarget = streetY + Math.max(-fallbackNear * SLOPE_LIMITS.driveMaxNearStreet, Math.min(fallbackNear * SLOPE_LIMITS.driveMaxNearStreet, garageFloorY - streetY));
    stationsM.splice(0, stationsM.length, ...(fallbackRouteLength > fallbackNear ? [0, fallbackNear, fallbackRouteLength] : [0, fallbackRouteLength]));
    driveY = fallbackRouteLength > fallbackNear ? [streetY, fallbackTarget, garageFloorY] : [streetY, garageFloorY];
  }
  const finalGarageRearY = garageFallback
    ? groundAt(fallbackDoorX + inX * (8 / CELL_SIZE), fallbackDoorY + inY * (8 / CELL_SIZE))
    : garageRearY;
  const finalGarageCutDepthM = garageMode === "street-level-cut" || garageMode === "undercroft" ? Math.max(0, finalGarageRearY - garageFloorY) : 0;
  if (garageMode === "undercroft") garageFillM = Math.max(0, garageFloorY - finalGarageRearY);
  const finalNear = Math.min(SLOPE_LIMITS.driveNearStreetM, fallbackRouteLength);
  const finalMaxGradeNear = finalNear > 0 ? Math.abs(driveY[1]! - driveY[0]!) / finalNear : 0;
  const finalRest = fallbackRouteLength - finalNear;
  const finalMaxGrade = finalRest > 0 && driveY.length > 2 ? Math.abs(driveY[2]! - driveY[1]!) / finalRest : finalMaxGradeNear;
  if (finalMaxGradeNear > SLOPE_LIMITS.driveMaxNearStreet + 1e-6) violations.push({ limit: "driveMaxNearStreet", value: finalMaxGradeNear });
  if (finalMaxGrade > SLOPE_LIMITS.driveMax + 1e-6) violations.push({ limit: "driveMax", value: finalMaxGrade });
  if (band === "reject") violations.push({ limit: "rejectGradient", value: gradient });
  const ok = violations.length === 0;
  return { band, technique: retainingWalls.length && band !== "steep-uphill" && band !== "steep-downhill" ? "platform-retaining-wall" : technique, gradient, gradientDir, streetY, padY, houseFloorY: finalHouseFloorY, rearFloorY, maxCutM, maxFillM, banks, retainingWalls, garageFloorY, garageMode, garageCutDepthM: finalGarageCutDepthM, garageFillM, drive: { stationsM, y: driveY, maxGradeNear: finalMaxGradeNear, maxGrade: finalMaxGrade }, smallholding, padAreaM2, garageFallback, ok, violations };
}

export function summarizeBands(parcels: readonly Parcel[], groundAt: GroundAt): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const parcel of parcels) {
    const result = gradePlot(parcel, groundAt);
    const key = `${result.band}/${result.technique}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
