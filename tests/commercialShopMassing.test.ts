import { describe, expect, it } from "vitest";
import {
  commercialShopMassing,
  commercialShopNightFloorEmissive,
  shopKindWallHeightM,
} from "../src/colony/render/commercialShopMassing";
import {
  surveyVenuePlacements,
  CELL_M,
  STOREY_M,
} from "../src/colony/render/venuePlacement";
import { BUSINESSES, type BusinessId } from "../src/colony/commerce/businesses";
import type { ShopParcel, ShopKind } from "../src/colony/commerce/district";

function parcel(
  kind: ShopKind,
  business: BusinessId,
  index: number,
): ShopParcel {
  const w = kind === "showroom" ? 8 : kind === "store" ? 6 : 4;
  const h = kind === "showroom" ? 6 : kind === "store" ? 5 : 4;
  return {
    id: `shop_${index}`,
    kind,
    x: index * 10,
    y: 10,
    w,
    h,
    side: 1 as const,
    doorX: index * 10 + Math.floor(w / 2),
    doorY: 10,
    built: false,
    business,
  };
}

/** Spec 143 — massings take their footprint from the venue placement survey; build the
 *  placements exactly the way the layer does (side 1 parcels front a street at y = 8). */
function placementsFor(parcels: ShopParcel[]) {
  const street = parcels.map((p) => ({ x: p.doorX, y: p.doorY - 2 }));
  return surveyVenuePlacements({ parcels, street }, []);
}

describe("commercial shop massing variety", () => {
  it("gives adjacent real-app shops distinct building forms, not one box recoloured", () => {
    const ids: BusinessId[] = [
      "nearest_bar",
      "sprout_nursery",
      "sportifine_club",
      "chef_market",
    ];
    const parcels = ids.map((id, i) =>
      parcel(i === 0 ? "showroom" : "store", id, i),
    );
    const places = placementsFor(parcels);
    const models = ids.map((id, i) =>
      commercialShopMassing(parcels[i]!, BUSINESSES[id], i, places[i]!),
    );

    for (let i = 1; i < models.length; i++) {
      expect(models[i]!.signatureKey).not.toBe(models[i - 1]!.signatureKey);
      expect(models[i]!.roofForm).not.toBe(models[i - 1]!.roofForm);
    }

    expect(
      new Set(models.map((m) => m.wallHeight)).size,
    ).toBeGreaterThanOrEqual(3);
    expect(new Set(models.map((m) => m.signatureFeature)).size).toBe(
      ids.length,
    );
  });

  it("masses in METRES on the scale constitution: storey walls, plot-filling bodies", () => {
    const ids: BusinessId[] = ["nearest_bar", "corner_kiosk", "builder_studio"];
    const kinds: ShopKind[] = ["showroom", "kiosk", "store"];
    const parcels = ids.map((id, i) => parcel(kinds[i]!, id, i));
    const places = placementsFor(parcels);
    for (let i = 0; i < ids.length; i++) {
      const m = commercialShopMassing(
        parcels[i]!,
        BUSINESSES[ids[i]!],
        i,
        places[i]!,
      );
      // walls at least one 3.5 m storey (minus small flavour trims), never knee-high
      expect(m.wallHeight).toBeGreaterThanOrEqual(STOREY_M - 0.5);
      // the body IS the placement footprint (the GLB swap-in contract)
      expect(m.bodyW).toBeCloseTo(places[i]!.footprint.w, 10);
      expect(m.bodyD).toBeCloseTo(places[i]!.footprint.d, 10);
      // and the footprint is parcel-scaled: more than half the parcel frontage
      expect(m.bodyW).toBeGreaterThan((parcels[i]!.w * CELL_M) / 2);
    }
    // the shared label hook mirrors the massing base heights
    expect(shopKindWallHeightM("kiosk")).toBeCloseTo(STOREY_M);
    expect(shopKindWallHeightM("store")).toBeCloseTo(2 * STOREY_M);
  });

  it("keeps the shop night floor emissive deterministic and clamped", () => {
    expect(commercialShopNightFloorEmissive(1)).toBeCloseTo(0.1);
    expect(commercialShopNightFloorEmissive(0)).toBeCloseTo(0.9);
    expect(commercialShopNightFloorEmissive(-1)).toBeCloseTo(0.9);
    expect(commercialShopNightFloorEmissive(2)).toBeCloseTo(0.1);
  });
});
