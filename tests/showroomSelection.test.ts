import { describe, expect, it } from "vitest";
import {
  SHOWROOM_DEFAULT_ZOOM,
  SHOWROOM_MAX_ZOOM,
  SHOWROOM_MIN_ZOOM,
  clampShowroomZoom,
  stepSelection,
  wrapIndex,
} from "../src/colony/showroom/showroomState";
import {
  SHOWROOM_VEHICLES,
  showroomCardModel,
} from "../src/colony/showroom/showroomCatalog";
import { safeCarSpec } from "../src/colony/car/carSpec";
import { isPublicSafe } from "../src/colony/newcomers";

describe("showroom carousel selection (PLAYER.GARAGE.1)", () => {
  it("wraps at both ends", () => {
    const n = SHOWROOM_VEHICLES.length;
    expect(stepSelection(0, n, -1)).toBe(n - 1); // left from first wraps to last
    expect(stepSelection(n - 1, n, 1)).toBe(0); // right from last wraps to first
    expect(stepSelection(0, n, 1)).toBe(1 % n);
  });

  it("recovers bad indices instead of crashing", () => {
    expect(wrapIndex(-7, 2)).toBe(1);
    expect(wrapIndex(9, 2)).toBe(1);
    expect(wrapIndex(3.5, 2)).toBe(0);
    expect(wrapIndex(0, 0)).toBe(0);
    expect(stepSelection(0, 0, 1)).toBe(0);
  });

  it("clamps camera zoom to the safe envelope and recovers non-finite input", () => {
    expect(clampShowroomZoom(0)).toBe(SHOWROOM_MIN_ZOOM);
    expect(clampShowroomZoom(999)).toBe(SHOWROOM_MAX_ZOOM);
    expect(clampShowroomZoom(SHOWROOM_MIN_ZOOM)).toBe(SHOWROOM_MIN_ZOOM);
    expect(clampShowroomZoom(SHOWROOM_MAX_ZOOM)).toBe(SHOWROOM_MAX_ZOOM);
    expect(clampShowroomZoom(5)).toBe(5);
    expect(clampShowroomZoom(Number.NaN)).toBe(SHOWROOM_DEFAULT_ZOOM);
    expect(clampShowroomZoom(Number.POSITIVE_INFINITY)).toBe(
      SHOWROOM_DEFAULT_ZOOM,
    );
    expect(SHOWROOM_MIN_ZOOM).toBeLessThan(SHOWROOM_DEFAULT_ZOOM);
    expect(SHOWROOM_DEFAULT_ZOOM).toBeLessThan(SHOWROOM_MAX_ZOOM);
  });
});

describe("showroom catalog and specification card", () => {
  it("offers at least two distinct, valid vehicles", () => {
    expect(SHOWROOM_VEHICLES.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(SHOWROOM_VEHICLES.map((v) => v.spec.id));
    expect(ids.size).toBe(SHOWROOM_VEHICLES.length);
    for (const v of SHOWROOM_VEHICLES) {
      // every catalog car must round-trip the CarSpec safety validator unchanged
      expect(safeCarSpec(v.spec)).toEqual(v.spec);
      expect(v.plannedPriceK).toBeGreaterThan(0);
    }
  });

  it("keeps the two launch vehicles visibly different on the card", () => {
    const [vonk, kaap] = SHOWROOM_VEHICLES;
    const a = showroomCardModel(vonk!);
    const b = showroomCardModel(kaap!);
    expect(a.name).toBe("Karoo Vonk 1.1");
    expect(b.name).toBe("Karoo Kaap GT-V8");
    expect(a.name).not.toBe(b.name);
    expect(a.priceLabel).not.toBe(b.priceLabel);
    // the selected-spec rendering must actually differ: top speed and acceleration diverge
    const stat = (m: typeof a, label: string) =>
      m.stats.find((s) => s.label === label)!.pct;
    expect(stat(a, "Top speed")).not.toBe(stat(b, "Top speed"));
    expect(stat(a, "Acceleration")).not.toBe(stat(b, "Acceleration"));
    // acquisition can never be live in this slice
    expect(a.acquirePreviewOnly).toBe(true);
    expect(b.acquirePreviewOnly).toBe(true);
  });

  it("ships no real manufacturer name, badge word or unsafe label", () => {
    const banned = /fiat|ford|capri|perana|uno\b/i;
    for (const v of SHOWROOM_VEHICLES) {
      expect(v.publicName).not.toMatch(banned);
      expect(v.spec.name).not.toMatch(banned);
      expect(v.vehicleClass).not.toMatch(banned);
      expect(v.blurb).not.toMatch(banned);
      expect(isPublicSafe(v.publicName)).toBe(true);
      expect(isPublicSafe(v.blurb)).toBe(true);
    }
  });
});
