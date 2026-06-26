import type { ShopParcel } from "../commerce/district";
import type { Business, BusinessId } from "../commerce/businesses";

export type CommercialShopRoofForm =
  | "flat"
  | "gable"
  | "mono"
  | "sawtooth"
  | "greenhouse"
  | "arena"
  | "market-canopy"
  | "tower-cap";

export type CommercialShopSignatureFeature =
  | "radar-bar"
  | "greenhouse-trellis"
  | "sports-pitch"
  | "chef-market"
  | "garage-bay"
  | "records-booth"
  | "classifieds-boards"
  | "ledger-counter"
  | "tour-perch"
  | "builder-frame"
  | "trade-crates"
  | "kiosk-pots";

export interface CommercialShopMassing {
  bodyW: number;
  bodyD: number;
  wallHeight: number;
  roofForm: CommercialShopRoofForm;
  roofRise: number;
  roofOverhang: number;
  frontageScale: number;
  depthScale: number;
  signWidthScale: number;
  windowCount: number;
  signatureFeature: CommercialShopSignatureFeature;
  /** Compact deterministic proof key used by Vitest and browser proof. */
  signatureKey: string;
}

type BusinessMassing = {
  heightBonus: number;
  frontageScale: number;
  depthScale: number;
  roofForm: CommercialShopRoofForm;
  roofRise: number;
  roofOverhang: number;
  signWidthScale: number;
  windowCount: number;
  signatureFeature: CommercialShopSignatureFeature;
};

const KIND_BASE_HEIGHT: Record<ShopParcel["kind"], number> = {
  kiosk: 0.86,
  store: 1.22,
  showroom: 1.62,
};

const DEFAULT_MASSING: BusinessMassing = {
  heightBonus: 0,
  frontageScale: 0.78,
  depthScale: 0.78,
  roofForm: "flat",
  roofRise: 0.14,
  roofOverhang: 1.04,
  signWidthScale: 0.58,
  windowCount: 2,
  signatureFeature: "trade-crates",
};

const BUSINESS_MASSING: Record<BusinessId, BusinessMassing> = {
  nearest_bar: {
    heightBonus: 0.16,
    frontageScale: 0.9,
    depthScale: 0.78,
    roofForm: "tower-cap",
    roofRise: 0.62,
    roofOverhang: 1.08,
    signWidthScale: 0.72,
    windowCount: 3,
    signatureFeature: "radar-bar",
  },
  sprout_nursery: {
    heightBonus: -0.04,
    frontageScale: 0.84,
    depthScale: 0.92,
    roofForm: "greenhouse",
    roofRise: 0.46,
    roofOverhang: 1.02,
    signWidthScale: 0.55,
    windowCount: 4,
    signatureFeature: "greenhouse-trellis",
  },
  sportifine_club: {
    heightBonus: 0.28,
    frontageScale: 0.94,
    depthScale: 0.86,
    roofForm: "arena",
    roofRise: 0.38,
    roofOverhang: 1.12,
    signWidthScale: 0.78,
    windowCount: 1,
    signatureFeature: "sports-pitch",
  },
  chef_market: {
    heightBonus: 0.08,
    frontageScale: 0.88,
    depthScale: 0.84,
    roofForm: "market-canopy",
    roofRise: 0.32,
    roofOverhang: 1.18,
    signWidthScale: 0.68,
    windowCount: 3,
    signatureFeature: "chef-market",
  },
  citylife_garage: {
    heightBonus: 0.18,
    frontageScale: 0.96,
    depthScale: 0.82,
    roofForm: "mono",
    roofRise: 0.28,
    roofOverhang: 1.08,
    signWidthScale: 0.74,
    windowCount: 1,
    signatureFeature: "garage-bay",
  },
  mojojo_records: {
    heightBonus: 0.02,
    frontageScale: 0.76,
    depthScale: 0.8,
    roofForm: "sawtooth",
    roofRise: 0.34,
    roofOverhang: 1.05,
    signWidthScale: 0.62,
    windowCount: 2,
    signatureFeature: "records-booth",
  },
  classifieds_arcade: {
    heightBonus: 0.12,
    frontageScale: 0.82,
    depthScale: 0.82,
    roofForm: "flat",
    roofRise: 0.2,
    roofOverhang: 1.1,
    signWidthScale: 0.8,
    windowCount: 2,
    signatureFeature: "classifieds-boards",
  },
  ledger_exchange: {
    heightBonus: 0.24,
    frontageScale: 0.8,
    depthScale: 0.88,
    roofForm: "gable",
    roofRise: 0.5,
    roofOverhang: 1.04,
    signWidthScale: 0.56,
    windowCount: 2,
    signatureFeature: "ledger-counter",
  },
  tarentaal_tours: {
    heightBonus: -0.08,
    frontageScale: 0.86,
    depthScale: 0.76,
    roofForm: "mono",
    roofRise: 0.22,
    roofOverhang: 1.16,
    signWidthScale: 0.64,
    windowCount: 2,
    signatureFeature: "tour-perch",
  },
  builder_studio: {
    heightBonus: 0.2,
    frontageScale: 0.9,
    depthScale: 0.9,
    roofForm: "sawtooth",
    roofRise: 0.42,
    roofOverhang: 1.06,
    signWidthScale: 0.7,
    windowCount: 3,
    signatureFeature: "builder-frame",
  },
  trading_post: {
    ...DEFAULT_MASSING,
    roofForm: "gable",
    roofRise: 0.3,
    signatureFeature: "trade-crates",
  },
  corner_kiosk: {
    ...DEFAULT_MASSING,
    heightBonus: -0.08,
    frontageScale: 0.74,
    depthScale: 0.74,
    roofForm: "flat",
    signWidthScale: 0.5,
    windowCount: 1,
    signatureFeature: "kiosk-pots",
  },
};

export function commercialShopMassing(
  parcel: ShopParcel,
  business: Business | undefined,
  index: number,
): CommercialShopMassing {
  const variant = business ? BUSINESS_MASSING[business.id] : DEFAULT_MASSING;
  const wallHeight = KIND_BASE_HEIGHT[parcel.kind] + variant.heightBonus;
  const bodyW = parcel.w * variant.frontageScale;
  const bodyD = parcel.h * variant.depthScale;
  return {
    bodyW,
    bodyD,
    wallHeight,
    roofForm: variant.roofForm,
    roofRise: variant.roofRise,
    roofOverhang: variant.roofOverhang,
    frontageScale: variant.frontageScale,
    depthScale: variant.depthScale,
    signWidthScale: variant.signWidthScale,
    windowCount: variant.windowCount,
    signatureFeature: variant.signatureFeature,
    signatureKey: [
      parcel.kind,
      business?.id ?? "open",
      variant.roofForm,
      variant.signatureFeature,
      wallHeight.toFixed(2),
      bodyW.toFixed(2),
      bodyD.toFixed(2),
      index % 3,
    ].join(":"),
  };
}

export function commercialShopNightFloorEmissive(daylight: number): number {
  const clamped = Math.max(0, Math.min(1, daylight));
  return 0.1 + (1 - clamped) * 0.8;
}
