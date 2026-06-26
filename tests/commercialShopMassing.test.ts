import { describe, expect, it } from "vitest";
import {
  commercialShopMassing,
  commercialShopNightFloorEmissive,
} from "../src/colony/render/commercialShopMassing";
import { BUSINESSES, type BusinessId } from "../src/colony/commerce/businesses";
import type { ShopKind } from "../src/colony/commerce/district";

function parcel(kind: ShopKind, business: BusinessId, index: number) {
  const w = kind === "showroom" ? 8 : kind === "store" ? 6 : 4;
  const h = kind === "showroom" ? 6 : kind === "store" ? 5 : 4;
  return {
    id: `shop_${index}`,
    kind,
    x: index * 8,
    y: 10,
    w,
    h,
    side: 1 as const,
    doorX: index * 8 + Math.floor(w / 2),
    doorY: 10,
    built: false,
    business,
  };
}

describe("commercial shop massing variety", () => {
  it("gives adjacent real-app shops distinct building forms, not one box recoloured", () => {
    const ids: BusinessId[] = [
      "nearest_bar",
      "sprout_nursery",
      "sportifine_club",
      "chef_market",
    ];
    const models = ids.map((id, i) =>
      commercialShopMassing(parcel(i === 0 ? "showroom" : "store", id, i), BUSINESSES[id], i),
    );

    for (let i = 1; i < models.length; i++) {
      expect(models[i].signatureKey).not.toBe(models[i - 1].signatureKey);
      expect(models[i].roofForm).not.toBe(models[i - 1].roofForm);
    }

    expect(new Set(models.map((m) => m.wallHeight)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(models.map((m) => m.signatureFeature)).size).toBe(ids.length);
  });

  it("keeps the shop night floor emissive deterministic and clamped", () => {
    expect(commercialShopNightFloorEmissive(1)).toBeCloseTo(0.1);
    expect(commercialShopNightFloorEmissive(0)).toBeCloseTo(0.9);
    expect(commercialShopNightFloorEmissive(-1)).toBeCloseTo(0.9);
    expect(commercialShopNightFloorEmissive(2)).toBeCloseTo(0.1);
  });
});
