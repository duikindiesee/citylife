import { describe, expect, it, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { isPublicSafe } from "../src/colony/newcomers";
import {
  businessLabelModel,
  declutterBusinessLabels,
  labelOpacityForVisibility,
  surveyBusinessLabels,
} from "../src/colony/commerce/businessLabels";

const RT_CACHE = new Map<number, ColonyRuntime>();
function rtFor(seed: number): ColonyRuntime {
  let rt = RT_CACHE.get(seed);
  if (!rt) {
    rt = new ColonyRuntime(seed);
    RT_CACHE.set(seed, rt);
  }
  return rt;
}

describe("commercial business labels", () => {
  it("surveys one public-safe floating label above each shop parcel that has a business", () => {
    const rt = rtFor(4242);
    const labels = surveyBusinessLabels(rt.commercialDistrict!);
    const parcelsWithBusiness = rt.commercialDistrict!.parcels.filter(
      (p) => p.business,
    );

    expect(labels.map((l) => l.shopId)).toEqual(
      parcelsWithBusiness.map((p) => p.id),
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((l) => l.businessId === "sportifine_club")).toBe(true);
    expect(labels.map((l) => l.text)).toContain("Sports Club");
    expect(labels.map((l) => l.text)).not.toContain("Sportifine Club");
    for (const label of labels) {
      const parcel = parcelsWithBusiness.find((p) => p.id === label.shopId)!;
      expect(label.x).toBe(parcel.x + (parcel.w - 1) / 2);
      expect(label.y).toBe(parcel.y + (parcel.h - 1) / 2);
      expect(label.height).toBeGreaterThan(2.5);
      expect(isPublicSafe(label.text)).toBe(true);
      expect(label.nightEmissiveFloor).toBeGreaterThan(0);
      expect(label.nightEmissiveFloor).toBeLessThanOrEqual(
        label.nightEmissivePeak,
      );
    }
  });

  it("screens unsafe business names instead of rendering them", () => {
    const label = businessLabelModel(
      {
        id: "bad_shop",
        kind: "store",
        x: 10,
        y: 20,
        w: 6,
        h: 5,
        side: 1,
        doorX: 13,
        doorY: 25,
        built: false,
        business: "nearest_bar",
      },
      {
        id: "nearest_bar",
        name: "secret token mall",
        app: "open lot",
        tagline: "safe",
        palette: 0x18e0ff,
        emblem: "dish",
        seating: false,
        marquee: false,
        isPublicSafe: true,
      },
    );

    expect(label).toBeNull();
  });

  it("declutters close and distant labels while preserving real business identity", () => {
    const labels = surveyBusinessLabels(rtFor(4242).commercialDistrict!);
    const candidates = labels.map((label, index) => ({
      label,
      screenX: index < 4 ? 400 + index * 14 : 100 + index * 120,
      screenY: index < 4 ? 320 + index * 10 : 140 + index * 28,
      distance:
        index === 0
          ? 22
          : index === 1
            ? 18
            : index === 2
              ? 68
              : index === 3
                ? 120
                : 28 + index,
    }));

    const visible = declutterBusinessLabels(candidates, {
      maxVisible: 3,
      minScreenGap: 72,
      farFadeStart: 50,
      farHideDistance: 100,
    });

    expect(visible).toHaveLength(labels.length);
    expect(visible.filter((l) => l.visible)).toHaveLength(3);
    expect(visible.find((l) => l.shopId === labels[1]!.shopId)?.visible).toBe(
      true,
    );
    expect(visible.find((l) => l.shopId === labels[0]!.shopId)?.visible).toBe(
      false,
    );
    expect(
      visible.find((l) => l.shopId === labels[2]!.shopId)?.opacity,
    ).toBeLessThan(1);
    expect(visible.find((l) => l.shopId === labels[3]!.shopId)?.visible).toBe(
      false,
    );
    for (const out of visible) {
      const source = labels.find((label) => label.shopId === out.shopId)!;
      expect(out.businessId).toBe(source.businessId);
      expect(out.text).toBe(source.text);
    }
  });

  it("hides occluded labels before they can overlap the shop strip", () => {
    const labels = surveyBusinessLabels(rtFor(4242).commercialDistrict!).slice(
      0,
      3,
    );
    const visible = declutterBusinessLabels(
      labels.map((label, index) => ({
        label,
        screenX: 500 + index * 160,
        screenY: 260,
        distance: 20 + index,
        occluded: index === 1,
      })),
      {
        maxVisible: 3,
        minScreenGap: 60,
        farFadeStart: 70,
        farHideDistance: 120,
      },
    );

    expect(visible[1]?.visible).toBe(false);
    expect(visible.filter((l) => l.visible).map((l) => l.shopId)).toEqual([
      labels[0]!.shopId,
      labels[2]!.shopId,
    ]);
  });

  it("caps default visibility to four nearest non-overlapping readable signs", () => {
    const labels = surveyBusinessLabels(rtFor(4242).commercialDistrict!).slice(
      0,
      8,
    );
    const visible = declutterBusinessLabels(
      labels.map((label, index) => ({
        label,
        screenX: 80 + index * 220,
        screenY: index < 2 ? 220 : index < 4 ? 420 : 620,
        distance: 18 + index * 3,
      })),
    );

    expect(visible.filter((l) => l.visible).map((l) => l.shopId)).toEqual(
      labels.slice(0, 4).map((label) => label.shopId),
    );
  });

  it("spreads labels across screen bands instead of filling one cluttered strip", () => {
    const labels = surveyBusinessLabels(rtFor(4242).commercialDistrict!).slice(
      0,
      7,
    );
    const visible = declutterBusinessLabels(
      labels.map((label, index) => ({
        label,
        screenX: 80 + index * 210,
        screenY: index < 5 ? 250 : 470,
        distance: index < 5 ? 18 + index : 34 + index,
      })),
      {
        maxVisible: 4,
        minScreenGap: 120,
        farFadeStart: 70,
        farHideDistance: 120,
        screenBandHeight: 180,
        maxVisiblePerScreenBand: 2,
      },
    );

    expect(visible.filter((l) => l.visible).map((l) => l.shopId)).toEqual([
      labels[0]!.shopId,
      labels[1]!.shopId,
      labels[5]!.shopId,
      labels[6]!.shopId,
    ]);
  });

  it("keeps accepted signs readable in day and night after declutter opacity", () => {
    const [label] = surveyBusinessLabels(rtFor(4242).commercialDistrict!);
    const day = labelOpacityForVisibility(label!, 0.35, 0);
    const night = labelOpacityForVisibility(label!, 0.35, 1);

    expect(day.spriteOpacity).toBeGreaterThanOrEqual(0.3);
    expect(day.floorOpacity).toBeGreaterThanOrEqual(0.12);
    expect(night.spriteOpacity).toBeGreaterThan(day.spriteOpacity);
    expect(night.floorOpacity).toBeGreaterThan(day.floorOpacity);
  });

  it("is deterministic and touches no wall-clock or RNG", () => {
    const rt = rtFor(4242);
    const fresh = new ColonyRuntime(4242);
    const dateSpy = vi.spyOn(Date, "now");
    const randSpy = vi.spyOn(Math, "random");
    try {
      const a = surveyBusinessLabels(rt.commercialDistrict!);
      const b = surveyBusinessLabels(fresh.commercialDistrict!);
      expect(b).toEqual(a);
      expect(
        declutterBusinessLabels(
          a.map((label, index) => ({
            label,
            screenX: index * 100,
            screenY: index * 25,
            distance: 20 + index,
          })),
        ),
      ).toEqual(
        declutterBusinessLabels(
          b.map((label, index) => ({
            label,
            screenX: index * 100,
            screenY: index * 25,
            distance: 20 + index,
          })),
        ),
      );
      expect(dateSpy).not.toHaveBeenCalled();
      expect(randSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      randSpy.mockRestore();
    }
  });
});
