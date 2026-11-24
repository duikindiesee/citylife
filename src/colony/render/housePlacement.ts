import type { Parcel } from "../neighborhood";
import type { PlotGrading } from "../slope/plotGrading";
import { CELL_SIZE } from "../scale";
import { parcelStreetDirection } from "../parcelGeometry";

export const HOUSE_FOOTPRINT_M = { w: 11.5, d: 11.5 } as const;
export interface HousePose {
  position: [number, number, number];
  rotationY: number;
  corners: [number, number][];
}

/** Place the real metre-scale house wholly inside the fenced parcel and statutory building lines. */
export function housePoseForParcel(parcel: Parcel, mapSize: number, grading: PlotGrading): HousePose {
  const ring = [...parcel.fence, parcel.gate];
  const minX = Math.min(...ring.map((cell) => cell.x)) - 0.5;
  const maxX = Math.max(...ring.map((cell) => cell.x)) + 0.5;
  const minY = Math.min(...ring.map((cell) => cell.y)) - 0.5;
  const maxY = Math.max(...ring.map((cell) => cell.y)) + 0.5;
  const street = parcelStreetDirection(parcel);
  const inland: [number, number] = [-street[0], -street[1]];
  const angle = Math.atan2(street[0], street[1]);
  const halfW = HOUSE_FOOTPRINT_M.w / (2 * CELL_SIZE);
  const halfD = HOUSE_FOOTPRINT_M.d / (2 * CELL_SIZE);
  const sideSetback = parcel.w * CELL_SIZE > 16 ? 2.5 : 1.5;
  const front = 3 / CELL_SIZE;
  const rear = 3 / CELL_SIZE;
  const zone = parcel.houseZone;
  const baseX = zone.x + (zone.w - 1) / 2;
  const baseY = zone.y + (zone.d - 1) / 2;
  const halfAlong = Math.abs(Math.sin(angle)) * halfW + Math.abs(Math.cos(angle)) * halfD;
  const halfAcross = Math.abs(Math.cos(angle)) * halfW + Math.abs(Math.sin(angle)) * halfD;
  const side: [number, number] = [-street[1], street[0]];
  const sideProjection = (x: number, y: number) => (x - parcel.gate.x) * side[0] + (y - parcel.gate.y) * side[1];
  const sideValues = ring.map((cell) => sideProjection(cell.x, cell.y));
  const sideMin = Math.min(...sideValues) - 0.5 + sideSetback / CELL_SIZE;
  const sideMax = Math.max(...sideValues) + 0.5 - sideSetback / CELL_SIZE;
  const parcelDepth = Math.abs(street[0]) * (maxX - minX) + Math.abs(street[1]) * (maxY - minY);
  // Try the house-zone centre first, then step inward in quarter-cell increments.
  let cx = baseX, cy = baseY;
  let fits = false;
  for (let step = 0; step <= Math.ceil((zone.w + zone.d) * 4); step++) {
    const candidateX = baseX + inland[0] * step / 4;
    const candidateY = baseY + inland[1] * step / 4;
    const streetProjection = (candidateX - parcel.gate.x) * street[0] + (candidateY - parcel.gate.y) * street[1];
    const acrossProjection = sideProjection(candidateX, candidateY);
    const fitsSideLines = acrossProjection - halfAcross >= sideMin - 1e-6 && acrossProjection + halfAcross <= sideMax + 1e-6;
    const frontClear = streetProjection + halfAlong <= 0.5 - front + 1e-6;
    const rearClear = streetProjection - halfAlong >= 0.5 - parcelDepth + rear - 1e-6;
    if (fitsSideLines && frontClear && rearClear) { cx = candidateX; cy = candidateY; fits = true; break; }
  }
  if (!fits) throw new Error(`No house placement fits parcel ${parcel.id}`);
  const corners: [number, number][] = [[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]].map(([x,z]) => {
    const rx = x * Math.cos(angle) + z * Math.sin(angle);
    const rz = -x * Math.sin(angle) + z * Math.cos(angle);
    return [cx + rx, cy + rz];
  });
  return {
    position: [(cx - mapSize / 2) * CELL_SIZE, grading.houseFloorY - 0.15, (cy - mapSize / 2) * CELL_SIZE],
    rotationY: angle,
    corners,
  };
}
