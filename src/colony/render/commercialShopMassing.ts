// Spec 143 — commercial shop massing IN METRES. The legacy table authored heights and
// footprints in grid-cell units on a 4 m/cell world, so every shop rendered ~4× too small
// (a knee-high kiosk rattling around a 24 m parcel — the operator's toy-box complaint).
// The massing now takes its footprint budget from the venue placement survey
// (venuePlacement.ts): the placement decides WHERE the building stands, how big and which
// way it faces; this module only flavours the shell per business (roof form, height bonus,
// sign width, signature feature) so adjacent shops stay distinct silhouettes.
import type { ShopParcel } from "../commerce/district";
import type { Business, BusinessId } from "../commerce/businesses";
import type { VenuePlacement } from "./venuePlacement";
import { STOREY_M } from "./venuePlacement";

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
  /** Building shell footprint, world metres (equals the placement footprint — the GLB
   *  swap-in contract needs the primitive and the model to claim the same ground). */
  bodyW: number;
  bodyD: number;
  /** Eaves height, metres (storeys × 3.5 m + per-business flair). */
  wallHeight: number;
  roofForm: CommercialShopRoofForm;
  /** Roof rise above the eaves, metres. */
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
  /** Metres added to (or shaved off) the storey-derived eaves height. */
  heightBonus: number;
  frontageScale: number;
  depthScale: number;
  roofForm: CommercialShopRoofForm;
  /** Roof rise, metres. */
  roofRise: number;
  roofOverhang: number;
  signWidthScale: number;
  windowCount: number;
  signatureFeature: CommercialShopSignatureFeature;
};

/** Eaves height per shop kind, metres: kiosk one storey, store/showroom two (the
 *  showroom gets a taller frontage via its height bonus headroom below). */
const KIND_BASE_HEIGHT_M: Record<ShopParcel["kind"], number> = {
  kiosk: STOREY_M,
  store: 2 * STOREY_M,
  showroom: 2 * STOREY_M + 0.8,
};

/** Shared with businessLabels so the floating shop labels clear the new roofline instead
 *  of hovering inside it. */
export function shopKindWallHeightM(kind: ShopParcel["kind"]): number {
  return KIND_BASE_HEIGHT_M[kind];
}

const DEFAULT_MASSING: BusinessMassing = {
  heightBonus: 0,
  frontageScale: 0.78,
  depthScale: 0.78,
  roofForm: "flat",
  roofRise: 0.55,
  roofOverhang: 1.04,
  signWidthScale: 0.58,
  windowCount: 2,
  signatureFeature: "trade-crates",
};

const BUSINESS_MASSING: Record<BusinessId, BusinessMassing> = {
  nearest_bar: {
    heightBonus: 0.6,
    frontageScale: 0.9,
    depthScale: 0.78,
    roofForm: "tower-cap",
    roofRise: 2.4,
    roofOverhang: 1.08,
    signWidthScale: 0.72,
    windowCount: 3,
    signatureFeature: "radar-bar",
  },
  sprout_nursery: {
    heightBonus: -0.3,
    frontageScale: 0.84,
    depthScale: 0.92,
    roofForm: "greenhouse",
    roofRise: 1.8,
    roofOverhang: 1.02,
    signWidthScale: 0.55,
    windowCount: 4,
    signatureFeature: "greenhouse-trellis",
  },
  sportifine_club: {
    heightBonus: 1.1,
    frontageScale: 0.94,
    depthScale: 0.86,
    roofForm: "arena",
    roofRise: 1.5,
    roofOverhang: 1.12,
    signWidthScale: 0.78,
    windowCount: 1,
    signatureFeature: "sports-pitch",
  },
  chef_market: {
    heightBonus: 0.3,
    frontageScale: 0.88,
    depthScale: 0.84,
    roofForm: "market-canopy",
    roofRise: 1.3,
    roofOverhang: 1.18,
    signWidthScale: 0.68,
    windowCount: 3,
    signatureFeature: "chef-market",
  },
  citylife_garage: {
    heightBonus: 0.7,
    frontageScale: 0.96,
    depthScale: 0.82,
    roofForm: "mono",
    roofRise: 1.1,
    roofOverhang: 1.08,
    signWidthScale: 0.74,
    windowCount: 1,
    signatureFeature: "garage-bay",
  },
  mojojo_records: {
    heightBonus: 0.1,
    frontageScale: 0.76,
    depthScale: 0.8,
    roofForm: "sawtooth",
    roofRise: 1.35,
    roofOverhang: 1.05,
    signWidthScale: 0.62,
    windowCount: 2,
    signatureFeature: "records-booth",
  },
  classifieds_arcade: {
    heightBonus: 0.45,
    frontageScale: 0.82,
    depthScale: 0.82,
    roofForm: "flat",
    roofRise: 0.8,
    roofOverhang: 1.1,
    signWidthScale: 0.8,
    windowCount: 2,
    signatureFeature: "classifieds-boards",
  },
  ledger_exchange: {
    heightBonus: 0.9,
    frontageScale: 0.8,
    depthScale: 0.88,
    roofForm: "gable",
    roofRise: 2.0,
    roofOverhang: 1.04,
    signWidthScale: 0.56,
    windowCount: 2,
    signatureFeature: "ledger-counter",
  },
  tarentaal_tours: {
    heightBonus: -0.3,
    frontageScale: 0.86,
    depthScale: 0.76,
    roofForm: "mono",
    roofRise: 0.9,
    roofOverhang: 1.16,
    signWidthScale: 0.64,
    windowCount: 2,
    signatureFeature: "tour-perch",
  },
  builder_studio: {
    heightBonus: 0.8,
    frontageScale: 0.9,
    depthScale: 0.9,
    roofForm: "sawtooth",
    roofRise: 1.7,
    roofOverhang: 1.06,
    signWidthScale: 0.7,
    windowCount: 3,
    signatureFeature: "builder-frame",
  },
  rimlight_detail: {
    ...DEFAULT_MASSING,
    heightBonus: 0.55,
    frontageScale: 0.86,
    depthScale: 0.82,
    roofForm: "mono",
    roofRise: 1.05,
    signWidthScale: 0.68,
    windowCount: 2,
    signatureFeature: "garage-bay",
  },
  neon_tire: {
    ...DEFAULT_MASSING,
    heightBonus: 0.4,
    frontageScale: 0.82,
    depthScale: 0.84,
    roofForm: "tower-cap",
    roofRise: 1.35,
    signWidthScale: 0.64,
    windowCount: 1,
    signatureFeature: "ledger-counter",
  },
  harbor_books: {
    ...DEFAULT_MASSING,
    heightBonus: -0.1,
    frontageScale: 0.78,
    depthScale: 0.86,
    roofForm: "gable",
    roofRise: 1.45,
    signWidthScale: 0.56,
    windowCount: 3,
    signatureFeature: "builder-frame",
  },
  skyline_cafe: {
    ...DEFAULT_MASSING,
    heightBonus: 0.25,
    frontageScale: 0.84,
    depthScale: 0.8,
    roofForm: "market-canopy",
    roofRise: 1.2,
    roofOverhang: 1.16,
    signWidthScale: 0.66,
    windowCount: 3,
    signatureFeature: "chef-market",
  },
  parcel_press: {
    ...DEFAULT_MASSING,
    heightBonus: 0.15,
    frontageScale: 0.8,
    depthScale: 0.82,
    roofForm: "sawtooth",
    roofRise: 1.3,
    signWidthScale: 0.62,
    windowCount: 2,
    signatureFeature: "classifieds-boards",
  },
  arcade_lane: {
    ...DEFAULT_MASSING,
    heightBonus: 0.45,
    frontageScale: 0.88,
    depthScale: 0.84,
    roofForm: "arena",
    roofRise: 1.4,
    roofOverhang: 1.12,
    signWidthScale: 0.74,
    windowCount: 1,
    signatureFeature: "records-booth",
  },
  plant_lab: {
    ...DEFAULT_MASSING,
    heightBonus: -0.25,
    frontageScale: 0.8,
    depthScale: 0.9,
    roofForm: "greenhouse",
    roofRise: 1.75,
    windowCount: 4,
    signatureFeature: "greenhouse-trellis",
  },
  tool_library: {
    ...DEFAULT_MASSING,
    heightBonus: 0.3,
    frontageScale: 0.86,
    depthScale: 0.88,
    roofForm: "sawtooth",
    roofRise: 1.6,
    signWidthScale: 0.68,
    windowCount: 2,
    signatureFeature: "builder-frame",
  },
  poster_union: {
    ...DEFAULT_MASSING,
    heightBonus: 0,
    frontageScale: 0.82,
    depthScale: 0.78,
    roofForm: "flat",
    roofRise: 0.8,
    signWidthScale: 0.76,
    windowCount: 2,
    signatureFeature: "classifieds-boards",
  },
  trading_post: {
    ...DEFAULT_MASSING,
    roofForm: "gable",
    roofRise: 1.2,
    signatureFeature: "trade-crates",
  },
  corner_kiosk: {
    ...DEFAULT_MASSING,
    heightBonus: -0.3,
    frontageScale: 0.74,
    depthScale: 0.74,
    roofForm: "flat",
    roofRise: 0.45,
    signWidthScale: 0.5,
    windowCount: 1,
    signatureFeature: "kiosk-pots",
  },
};

export function commercialShopMassing(
  parcel: ShopParcel,
  business: Business | undefined,
  index: number,
  placement: Pick<VenuePlacement, "footprint">,
): CommercialShopMassing {
  const variant = business ? BUSINESS_MASSING[business.id] : DEFAULT_MASSING;
  const wallHeight = KIND_BASE_HEIGHT_M[parcel.kind] + variant.heightBonus;
  const bodyW = placement.footprint.w;
  const bodyD = placement.footprint.d;
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
