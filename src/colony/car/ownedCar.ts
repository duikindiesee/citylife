import type { CarSpec } from "./carSpec";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";

/** Resolve the one authoritative model. Unknown or ambiguous truth never selects a default. */
export function resolveOwnedCar(
  keys: readonly string[] | null,
): CarSpec | null {
  if (!keys?.length) return null;
  const unique = [...new Set(keys.map((key) => key.replace(/^showroom:/, "")))];
  if (unique.length !== 1) return null;
  return (
    SHOWROOM_VEHICLES.find(
      (vehicle) => vehicle.spec.id.replace(/^showroom:/, "") === unique[0],
    )?.spec ?? null
  );
}
