// Spec 106 — read-only commercial POI labels. This file turns the already-surveyed commercialDistrict.parcels
// business identities into public-safe, deterministic label models; it never writes world-gen, terrain, parcels,
// or business assignment state.
import type { ShopParcel } from "./district";
import { BUSINESSES, type Business } from "./businesses";
import { shopKindWallHeightM } from "../render/commercialShopMassing";
import { isPublicSafe } from "../newcomers";

export interface BusinessLabel {
  shopId: string;
  businessId: string;
  text: string;
  x: number;
  y: number;
  height: number;
  color: number;
  nightEmissiveFloor: number;
  nightEmissivePeak: number;
}

export interface BusinessLabelDeclutterInput {
  label: BusinessLabel;
  screenX: number;
  screenY: number;
  distance: number;
  occluded?: boolean;
}

export interface BusinessLabelDeclutterOptions {
  maxVisible: number;
  minScreenGap: number;
  farFadeStart: number;
  farHideDistance: number;
  screenBandHeight?: number;
  maxVisiblePerScreenBand?: number;
}

export interface BusinessLabelVisibility {
  shopId: string;
  businessId: string;
  text: string;
  visible: boolean;
  opacity: number;
  priority: number;
}

export const DEFAULT_BUSINESS_LABEL_DECLUTTER: BusinessLabelDeclutterOptions = {
  maxVisible: 4,
  minScreenGap: 190,
  farFadeStart: 54,
  farHideDistance: 96,
  screenBandHeight: 180,
  maxVisiblePerScreenBand: 2,
};

export const BUSINESS_LABEL_VIEWPORT_NDC_LIMIT = 0.82;

/** Clearance above the metric roofline (spec 143): the venue shells stand 3.5–7.6 m at
 *  the eaves now, so the plate rides the SHARED massing height + headroom instead of the
 *  legacy cell-unit copy that left labels hovering inside the new walls. */
const LABEL_CLEARANCE_M = 3.2;

const SAFE_LABEL_FALLBACK: Partial<Record<Business["id"], string>> = {
  sportifine_club: "Sports Club",
};

export function businessLabelModel(
  parcel: ShopParcel,
  business: Business,
): BusinessLabel | null {
  if (!parcel.business) return null;
  if (!isPublicSafe(parcel.id)) return null;
  const text = isPublicSafe(business.name)
    ? business.name
    : SAFE_LABEL_FALLBACK[business.id];
  if (!text || !isPublicSafe(text)) return null;
  const x = parcel.x + (parcel.w - 1) / 2;
  const y = parcel.y + (parcel.h - 1) / 2;
  return {
    shopId: parcel.id,
    businessId: business.id,
    text,
    x,
    y,
    height: shopKindWallHeightM(parcel.kind) + LABEL_CLEARANCE_M,
    color: business.palette,
    nightEmissiveFloor: 0.65,
    nightEmissivePeak: 1.45,
  };
}

export function surveyBusinessLabels(district: {
  parcels: readonly ShopParcel[];
}): BusinessLabel[] {
  const out: BusinessLabel[] = [];
  for (const parcel of district.parcels) {
    if (!parcel.business) continue;
    const business = BUSINESSES[parcel.business];
    const label = businessLabelModel(parcel, business);
    if (label) out.push(label);
  }
  return out;
}

export function declutterBusinessLabels(
  candidates: readonly BusinessLabelDeclutterInput[],
  options: BusinessLabelDeclutterOptions = DEFAULT_BUSINESS_LABEL_DECLUTTER,
): BusinessLabelVisibility[] {
  const out = candidates.map((candidate, index) => ({
    shopId: candidate.label.shopId,
    businessId: candidate.label.businessId,
    text: candidate.label.text,
    visible: false,
    opacity: 0,
    priority: candidate.occluded
      ? Number.POSITIVE_INFINITY
      : candidate.distance + index * 0.001,
  }));
  const ranked = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        Number.isFinite(candidate.screenX) &&
        Number.isFinite(candidate.screenY) &&
        Number.isFinite(candidate.distance) &&
        !candidate.occluded &&
        candidate.distance < options.farHideDistance,
    )
    .sort(
      (a, b) =>
        a.candidate.distance - b.candidate.distance ||
        a.candidate.label.shopId.localeCompare(b.candidate.label.shopId),
    );

  const accepted: BusinessLabelDeclutterInput[] = [];
  const acceptedByBand = new Map<number, number>();
  const bandHeight = options.screenBandHeight ?? 0;
  const maxPerBand =
    options.maxVisiblePerScreenBand ?? Number.POSITIVE_INFINITY;
  for (const rankedEntry of ranked) {
    if (accepted.length >= options.maxVisible) break;
    const band =
      bandHeight > 0
        ? Math.floor(rankedEntry.candidate.screenY / bandHeight)
        : 0;
    if ((acceptedByBand.get(band) ?? 0) >= maxPerBand) continue;
    const overlaps = accepted.some(
      (acceptedCandidate) =>
        Math.hypot(
          rankedEntry.candidate.screenX - acceptedCandidate.screenX,
          rankedEntry.candidate.screenY - acceptedCandidate.screenY,
        ) < options.minScreenGap,
    );
    if (overlaps) continue;
    const fadeSpan = Math.max(
      1,
      options.farHideDistance - options.farFadeStart,
    );
    const farFade =
      rankedEntry.candidate.distance <= options.farFadeStart
        ? 1
        : Math.max(
            0.2,
            1 -
              (rankedEntry.candidate.distance - options.farFadeStart) /
                fadeSpan,
          );
    const target = out[rankedEntry.index]!;
    target.visible = true;
    target.opacity = farFade;
    target.priority = rankedEntry.candidate.distance;
    accepted.push(rankedEntry.candidate);
    acceptedByBand.set(band, (acceptedByBand.get(band) ?? 0) + 1);
  }
  return out;
}

export function labelOpacityForVisibility(
  label: Pick<BusinessLabel, "nightEmissiveFloor" | "nightEmissivePeak">,
  visibilityOpacity: number,
  night: number,
): { spriteOpacity: number; floorOpacity: number } {
  const clampedVisibility = Math.max(0, Math.min(1, visibilityOpacity));
  const clampedNight = Math.max(0, Math.min(1, night));
  const glow =
    label.nightEmissiveFloor +
    clampedNight * (label.nightEmissivePeak - label.nightEmissiveFloor);
  return {
    spriteOpacity: Math.max(0.3, Math.min(1, glow) * clampedVisibility),
    floorOpacity: Math.max(
      0.12,
      (0.18 + clampedNight * 0.34) * clampedVisibility,
    ),
  };
}
