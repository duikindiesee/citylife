// ARCADE.2A — wire the (already-authored) Gamehouse interior fragment to the GOVERNED commercial plot
// it fronts: the surveyed `kooker_gamehouse` shop parcel on the high street. Pure and deterministic —
// no three.js / React / DOM / fetch — so it runs in node tests exactly like the rest of the spatial
// layer, and the same (district, surface frame) always yields byte-identical portal metadata.
//
// This module READS the commercial district to find where the Gamehouse door is; it NEVER mutates a
// parcel, its ownerCitizenId, its build state, or any world coordinate. It only derives the door cell +
// facing from the governed plot and hands them to the existing withGamehouseInterior/buildGamehouse-
// InteriorFragment authoring, so the whole venue stays a single deterministic append that preserves
// every original island id and coordinate.
import type { CommercialDistrict, ShopParcel } from "../commerce/district";
import type { BusinessId } from "../commerce/businesses";
import type { WorldLayoutFrame } from "./worldLayoutDocument";
import type { WorldLayoutDocumentInput } from "./worldLayoutDocument";
import type { GridCell } from "../worldSurvey";
import {
  buildGamehouseInteriorFragment,
  withGamehouseInterior,
  type GamehouseFacing,
  type GamehouseInteriorFragment,
} from "./gamehouseInterior";

/** The business identity of the plot the Gamehouse venue fronts (public-safe internal id). */
export const GAMEHOUSE_BUSINESS_ID: BusinessId = "kooker_gamehouse";

export type GamehousePortalErrorCode = "NO_GAMEHOUSE_PARCEL";

export class GamehousePortalError extends Error {
  constructor(
    readonly code: GamehousePortalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GamehousePortalError";
  }
}

/** The governed commercial plot the Gamehouse venue is anchored to, plus the derived door/facing that
 *  the interior authoring pins its portals to. Read-only — a snapshot of the plot, never a handle. */
export interface GamehousePortalSite {
  /** The surveyed shop parcel id (e.g. "shop_3"), for stable metadata and cross-referencing. */
  readonly parcelId: string;
  /** The plot's real business identity — always GAMEHOUSE_BUSINESS_ID. */
  readonly business: BusinessId;
  /** Whether the storefront has been built by the buy/build economy (read-only; does not gate entry). */
  readonly built: boolean;
  /** The current owner citizen id, or null — carried through verbatim, never modified here. */
  readonly ownerCitizenId: string | null;
  /** The road-facing entrance door cell of the plot: the surface grid cell both portals pin to. */
  readonly entranceCell: GridCell;
  /** The compass facing derived deterministically from which street side the plot fronts. */
  readonly facing: GamehouseFacing;
}

/** Deterministic mapping from the plot's street side to the Gamehouse door facing. A plot fronting
 *  toward +y (side +1) opens its door southward; a plot fronting toward -y (side -1) opens northward.
 *  The chosen facing only sets the building yaw — the enter/exit portals stay exact inverses either way. */
export function facingForShopSide(side: ShopParcel["side"]): GamehouseFacing {
  return side === 1 ? "s" : "n";
}

/** Locate the single governed Gamehouse commercial plot in a surveyed district. Returns null when the
 *  district carries no `kooker_gamehouse` parcel (e.g. a survey that didn't place it), so callers can
 *  fail closed rather than fabricate a site. Pure: reads the parcel, copies its fields, mutates nothing. */
export function resolveGamehousePortalSite(
  district: CommercialDistrict,
): GamehousePortalSite | null {
  const parcel = district.parcels.find(
    (p) => p.business === GAMEHOUSE_BUSINESS_ID,
  );
  if (!parcel) return null;
  return {
    parcelId: parcel.id,
    business: GAMEHOUSE_BUSINESS_ID,
    built: parcel.built,
    ownerCitizenId: parcel.ownerCitizenId ?? null,
    entranceCell: { x: parcel.doorX, y: parcel.doorY },
    facing: facingForShopSide(parcel.side),
  };
}

/** Build the Gamehouse interior fragment (building frame, 8x8 arcade floor, enter/exit portals and the
 *  Commons_Arcade cabinet) anchored on the governed plot's door. Throws NO_GAMEHOUSE_PARCEL when the
 *  district has no Gamehouse plot. Deterministic for a fixed (surface frame, district). */
export function buildGamehousePortalFragment(
  surfaceFrame: WorldLayoutFrame,
  district: CommercialDistrict,
): { site: GamehousePortalSite; fragment: GamehouseInteriorFragment } {
  const site = resolveGamehousePortalSite(district);
  if (!site)
    throw new GamehousePortalError(
      "NO_GAMEHOUSE_PARCEL",
      "commercial district has no kooker_gamehouse plot to anchor the venue to",
    );
  const fragment = buildGamehouseInteriorFragment(surfaceFrame, {
    entranceCell: site.entranceCell,
    facing: site.facing,
  });
  return { site, fragment };
}

/** Append the Gamehouse venue (frames, portals, cabinet) to a world-layout document input, anchored on
 *  the governed Gamehouse plot's door. Carries every existing frame/portal/placement/road/way/zone/
 *  reservation/network/terrain edit through untouched and in order (withGamehouseInterior's contract),
 *  so no original island id or coordinate changes and the plot's ownership is preserved. Throws
 *  NO_GAMEHOUSE_PARCEL when the district has no Gamehouse plot. */
export function withGamehousePortal(
  input: WorldLayoutDocumentInput,
  district: CommercialDistrict,
): WorldLayoutDocumentInput {
  const site = resolveGamehousePortalSite(district);
  if (!site)
    throw new GamehousePortalError(
      "NO_GAMEHOUSE_PARCEL",
      "commercial district has no kooker_gamehouse plot to anchor the venue to",
    );
  return withGamehouseInterior(input, {
    entranceCell: site.entranceCell,
    facing: site.facing,
  });
}
