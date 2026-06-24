// Spec 096 Slice D — the car-part shop: the in-game city-coin (KCO) price of a part and the shop's
// ledger account. Prices live on the catalog (CAR_PARTS[kind].cost); this is the thin shop face over
// them. The real-kooker-ledger mirror (ledgerSync, coordinated with the furniture lane) is a later
// slice; for now a purchase moves only the in-game double-entry ledger.
import { CAR_PARTS, type CarPartKind } from "./carParts";

/** The in-game ledger account the car shop's takings land in (distinct from the furniture shop till). */
export const CAR_SHOP_ACCOUNT = "shop:car";

/** Price of a part in city coin (KCO). 0 = a free/stock part. */
export function carPartPriceK(kind: CarPartKind): number {
  return CAR_PARTS[kind]?.cost ?? 0;
}
