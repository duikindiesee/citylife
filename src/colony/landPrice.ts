import { BIG, COMPACT, ESTATE, GRAND, type Parcel, type ParcelSize } from "./neighborhood";
import { plotPriceKook, type LandConfig } from "./land";
import { COLONY } from "./config";
import { CELL_SIZE } from "./scale";

/** Area component per full parcel square metre: 0.6 Kook per 16 m² house-zone cell. */
export const LAND_PRICE_PER_M2_KCO = COLONY.economy.land.plotAreaRate / (CELL_SIZE * CELL_SIZE);

export function plotSizeM(size: ParcelSize): { w: number; d: number; areaM2: number } {
  const w = size.W * CELL_SIZE;
  const d = size.D * CELL_SIZE;
  return { w, d, areaM2: w * d };
}

/** Board total uses the same buildable house-zone footprint and waterfront premium as the deed. */
export function plotBoardPriceKco(parcel: Parcel, distToWater: number, cfg: LandConfig = COLONY.economy.land): number {
  return plotPriceKook(parcel.houseZone.w * parcel.houseZone.d, distToWater, cfg);
}

export function plotPricePerM2Kco(): number {
  return LAND_PRICE_PER_M2_KCO;
}

export const STANDARD_LAND_TIERS = { GRAND, ESTATE, BIG, COMPACT } as const;
