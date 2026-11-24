import type { Parcel } from "../neighborhood";
import { parcelStreetDirection } from "../parcelGeometry";
import { CELL_SIZE } from "../scale";

export interface CarNativeSize { x: number; y: number; z: number }
export interface CarNativeBox extends CarNativeSize { min: { x: number; y: number; z: number } }

export function carScaleFromNativeSize(size: CarNativeSize): number {
  const length = Math.max(size.x, size.z);
  const width = Math.min(size.x, size.z);
  return Math.min(4.2 / length, 2.0 / width, 2.0 / size.y);
}

export function carPoseForParcel(
  parcel: Parcel,
  mapSize: number,
  groundAt: (x: number, y: number) => number,
  nativeBox: CarNativeBox,
) {
  const street = parcelStreetDirection(parcel);
  const inland: [number, number] = [-street[0], -street[1]];
  const candidates = parcel.driveway
    .filter((cell) => !(cell.x === parcel.gate.x && cell.y === parcel.gate.y))
    .filter((cell) => (cell.x - parcel.gate.x) * inland[0] + (cell.y - parcel.gate.y) * inland[1] > 0)
    .filter((cell) => cell.x < parcel.houseZone.x || cell.x >= parcel.houseZone.x + parcel.houseZone.w || cell.y < parcel.houseZone.y || cell.y >= parcel.houseZone.y + parcel.houseZone.d);
  const cell = candidates[0] ?? parcel.driveway.find((candidate) => candidate.x !== parcel.gate.x || candidate.y !== parcel.gate.y) ?? parcel.gate;
  const gx = cell.x, gy = cell.y;
  const scale = carScaleFromNativeSize(nativeBox);
  return {
    position: [(gx - mapSize / 2) * CELL_SIZE, groundAt(gx, gy) - nativeBox.min.y * scale, (gy - mapSize / 2) * CELL_SIZE] as [number, number, number],
    rotationY: Math.atan2(street[0], street[1]),
    scale,
    cell: { x: gx, y: gy },
  };
}
