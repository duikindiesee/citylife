// Spec 106 — read-only commercial POI labels. This file turns the already-surveyed commercialDistrict.parcels
// business identities into public-safe, deterministic label models; it never writes world-gen, terrain, parcels,
// or business assignment state.
import type { ShopParcel } from "./district";
import { BUSINESSES, type Business } from "./businesses";
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
  maxVisible: 5,
  minScreenGap: 170,
  farFadeStart: 54,
  farHideDistance: 96,
};

const WALL_H: Record<ShopParcel["kind"], number> = {
  kiosk: 0.9,
  store: 1.25,
  showroom: 1.7,
};

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
    height: WALL_H[parcel.kind] + 1.7,
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
    .filter(({ candidate }) =>
      Number.isFinite(candidate.screenX) &&
      Number.isFinite(candidate.screenY) &&
      Number.isFinite(candidate.distance) &&
      !candidate.occluded &&
      candidate.distance < options.farHideDistance,
    )
    .sort((a, b) =>
      a.candidate.distance - b.candidate.distance ||
      a.candidate.label.shopId.localeCompare(b.candidate.label.shopId),
    );

  const accepted: BusinessLabelDeclutterInput[] = [];
  for (const rankedEntry of ranked) {
    if (accepted.length >= options.maxVisible) break;
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
            1 - (rankedEntry.candidate.distance - options.farFadeStart) / fadeSpan,
          );
    const target = out[rankedEntry.index]!;
    target.visible = true;
    target.opacity = farFade;
    target.priority = rankedEntry.candidate.distance;
    accepted.push(rankedEntry.candidate);
  }
  return out;
}
