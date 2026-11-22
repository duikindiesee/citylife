import type { Parcel } from "./neighborhood";

/** Direction from a parcel toward its street, inferred from the gate-side driveway segment. */
export function parcelStreetDirection(parcel: Parcel): [number, number] {
  const a = parcel.driveway[0], b = parcel.gate;
  if (a && b) {
    const dx = a.x - b.x, dy = a.y - b.y, n = Math.hypot(dx, dy);
    if (n > 0) return [dx / n, dy / n];
  }
  return [0, -parcel.side];
}
