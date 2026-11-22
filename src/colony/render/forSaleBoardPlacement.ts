import type { Parcel } from "../neighborhood";
import { CELL_SIZE } from "../scale";
import { FLAT_GROUND, type GroundAt } from "./kitGround";
import { parcelStreetDirection } from "./starterGaragePlacement";

export interface ForSaleBoardPlacement {
  position: [number, number, number];
  rotationY: number;
  gx: number;
  gy: number;
}

/** Place the sale sign outside the front fence, on the street side and clear of the drive. */
export function forSaleBoardPlacement(
  parcel: Parcel,
  mapSize: number,
  groundAt: GroundAt = FLAT_GROUND,
): ForSaleBoardPlacement {
  const [dx, dy] = parcelStreetDirection(parcel);
  // The old sign was offset to its left while facing the plot; preserve that frontage side.
  const left: [number, number] = [dy, -dx];
  const frontY = parcel.gate.y + (parcel.side === 1 ? -0.5 : 0.5);
  const gateGX = parcel.gate.x;
  const gateGY = frontY;
  const streetOffset = 0.25; // 1 m outside the fence line
  const lateralOffset = 1.4; // 5.6 m along the frontage
  const drivewayCells = new Set(parcel.driveway.map((c) => `${c.x},${c.y}`));
  let gx = gateGX + dx * streetOffset + left[0] * lateralOffset;
  let gy = gateGY + dy * streetOffset + left[1] * lateralOffset;
  const key = `${Math.round(gx)},${Math.round(gy)}`;
  if (drivewayCells.has(key)) {
    gx = gateGX + dx * streetOffset - left[0] * lateralOffset;
    gy = gateGY + dy * streetOffset - left[1] * lateralOffset;
  }
  const x = (gx - mapSize / 2) * CELL_SIZE;
  const z = (gy - mapSize / 2) * CELL_SIZE;
  // The board face points away from the plot toward the street.
  return { position: [x, groundAt(gx, gy), z], rotationY: Math.atan2(dx, dy), gx, gy };
}
