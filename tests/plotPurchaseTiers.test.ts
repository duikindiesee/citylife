import { describe, expect, it } from "vitest";
import {
  groupPlotPurchaseTiers,
  plotPurchaseGrantCopy,
} from "../src/colony/ui/ColonyApp";

const lots = [
  {
    id: "lot_small",
    built: false,
    owner: null,
    ownerId: null,
    occupied: false,
    reserved: false,
    price: 650,
    priceZar: 16250,
    houseZoneArea: 45,
  },
  {
    id: "lot_medium",
    built: false,
    owner: null,
    ownerId: null,
    occupied: false,
    reserved: false,
    price: 1250,
    priceZar: 31250,
    houseZoneArea: 154,
  },
  {
    id: "lot_large",
    built: false,
    owner: null,
    ownerId: null,
    occupied: false,
    reserved: false,
    price: 5200,
    priceZar: 130000,
    houseZoneArea: 368,
  },
];

describe("plot purchase tier HUD", () => {
  it("groups available plots into small medium and large tiers with K and ZAR prices", () => {
    const tiers = groupPlotPurchaseTiers(lots, 750);

    expect(tiers.map((t) => t.label)).toEqual(["Small", "Medium", "Large"]);
    expect(tiers.map((t) => t.priceLine)).toEqual([
      "₭650 · ≈ R16,250",
      "₭1,250 · ≈ R31,250",
      "₭5,200 · ≈ R130,000",
    ]);
    expect(tiers[0].grantLine).toBe("750 signup grant buys this tier");
    expect(tiers[1].grantLine).toBe("above the 750 signup grant");
    expect(tiers[2].grantLine).toBe("above the 750 signup grant");
  });

  it("makes the grant affordability promise explicit when small plots are in reach", () => {
    expect(plotPurchaseGrantCopy(groupPlotPurchaseTiers(lots, 750), 750)).toBe(
      "750 signup grant buys a Small plot from ₭650.",
    );
  });
});
