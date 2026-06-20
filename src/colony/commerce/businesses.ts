// Spec 079 / the commercial economy — each shop plot fronts a REAL kooker app, so the high street
// reads as the apps' public storefronts (operator direction 2026-06-13). Plots stay FOR SALE and are
// not pre-built; this is their business identity/destiny, raised by the builder when a bot buys in.
// Pure + deterministic: the assignment replays identically for the same surveyed plots.
import type { ShopKind } from "./district";

export type BusinessId =
  | "nearest_bar"
  | "sprout_nursery"
  | "sportifine_club"
  | "chef_market"
  | "trading_post"
  | "corner_kiosk";

/** A distinctive rooftop emblem shape so each business reads at a glance from District view. */
export type Emblem = "dish" | "leaf" | "ball" | "pot" | "crate" | "tag";

export interface Business {
  id: BusinessId;
  /** Display name — isPublicSafe (no kooker/token/secret brand-words). */
  name: string;
  /** The real kooker app this storefront fronts. */
  app: string;
  tagline: string;
  /** Neon accent (signage + emblem). */
  palette: number;
  emblem: Emblem;
  /** Bots can go and SIT here (the bar's counter + stools). */
  seating: boolean;
  /** A flagship app that earns one of the biggest plots. */
  marquee: boolean;
}

export const BUSINESSES: Record<BusinessId, Business> = {
  nearest_bar: {
    id: "nearest_bar",
    name: "The Nearest",
    app: "Nearest (energy radar)",
    tagline: "Pull up a stool, watch the radar",
    palette: 0x18e0ff,
    emblem: "dish",
    seating: true,
    marquee: true,
  },
  chef_market: {
    id: "chef_market",
    name: "Chef Ott's Market",
    app: "Chef Ott (kitchen + exercise)",
    tagline: "Cook it, eat it, work it off",
    palette: 0xff6a3d,
    emblem: "crate",
    seating: false,
    marquee: true,
  },
  sportifine_club: {
    id: "sportifine_club",
    name: "Sportifine Club",
    app: "Sportifine (sports)",
    tagline: "Game on",
    palette: 0x7bff4d,
    emblem: "ball",
    seating: false,
    marquee: true,
  },
  sprout_nursery: {
    id: "sprout_nursery",
    name: "Sprout Greenhouse",
    app: "Sprout (plant companion)",
    tagline: "Grow something",
    palette: 0x39d36a,
    emblem: "leaf",
    seating: false,
    marquee: true,
  },
  trading_post: {
    id: "trading_post",
    name: "Trading Post",
    app: "open lot",
    tagline: "For sale",
    palette: 0xffc233,
    emblem: "tag",
    seating: false,
    marquee: false,
  },
  corner_kiosk: {
    id: "corner_kiosk",
    name: "Corner Kiosk",
    app: "open lot",
    tagline: "For sale",
    palette: 0xb24dff,
    emblem: "pot",
    seating: false,
    marquee: false,
  },
};

const MARQUEE_ORDER: BusinessId[] = [
  "nearest_bar",
  "chef_market",
  "sportifine_club",
  "sprout_nursery",
];
const KIND_RANK: Record<ShopKind, number> = { showroom: 0, store: 1, kiosk: 2 };
const shopIdx = (id: string) => parseInt(id.split("_")[1] ?? "0", 10);

/** Assign a business to every surveyed plot: the marquee apps take the biggest plots first (the bar
 *  lands on the largest, so it has room for its counter + stools), the rest fill with generic sites.
 *  Deterministic: plots ranked by size then numeric id, marquee order fixed. */
export function assignBusinesses(
  parcels: { id: string; kind: ShopKind }[],
): Record<string, BusinessId> {
  const sorted = [...parcels].sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] || shopIdx(a.id) - shopIdx(b.id),
  );
  const out: Record<string, BusinessId> = {};
  let m = 0;
  for (const p of sorted) {
    if (m < MARQUEE_ORDER.length) out[p.id] = MARQUEE_ORDER[m++]!;
    else out[p.id] = p.kind === "kiosk" ? "corner_kiosk" : "trading_post";
  }
  return out;
}
