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
  | "citylife_garage"
  | "mojojo_records"
  | "classifieds_arcade"
  | "ledger_exchange"
  | "tarentaal_tours"
  | "builder_studio"
  | "trading_post"
  | "corner_kiosk";

/** A distinctive rooftop emblem shape so each business reads at a glance from District view. */
export type Emblem =
  | "dish"
  | "leaf"
  | "ball"
  | "pot"
  | "crate"
  | "tag"
  | "garage"
  | "record"
  | "board"
  | "coin"
  | "bird"
  | "frame";

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
  /** Authored/public storefront metadata; not user-entered or secret-bearing. */
  isPublicSafe: true;
}

export const BUSINESSES: Record<BusinessId, Business> = {
  nearest_bar: {
    id: "nearest_bar",
    name: "The Nearest",
    app: "Nearest energy radar",
    tagline: "Pull up a stool, watch the radar",
    palette: 0x18e0ff,
    emblem: "dish",
    seating: true,
    marquee: true,
    isPublicSafe: true,
  },
  chef_market: {
    id: "chef_market",
    name: "Chef Ott's Market",
    app: "Chef Ott kitchen and exercise",
    tagline: "Cook it, eat it, work it off",
    palette: 0xff6a3d,
    emblem: "crate",
    seating: false,
    marquee: true,
    isPublicSafe: true,
  },
  sportifine_club: {
    id: "sportifine_club",
    name: "Sportifine Club",
    app: "Sportifine sports",
    tagline: "Game on",
    palette: 0x7bff4d,
    emblem: "ball",
    seating: false,
    marquee: true,
    isPublicSafe: true,
  },
  sprout_nursery: {
    id: "sprout_nursery",
    name: "Sprout Greenhouse",
    app: "Sprout plant companion",
    tagline: "Grow something",
    palette: 0x39d36a,
    emblem: "leaf",
    seating: false,
    marquee: true,
    isPublicSafe: true,
  },
  citylife_garage: {
    id: "citylife_garage",
    name: "Gearbox Garage",
    app: "CityLife garage",
    tagline: "Tune it before the meetup",
    palette: 0x4da3ff,
    emblem: "garage",
    seating: false,
    marquee: false,
    isPublicSafe: true,
  },
  mojojo_records: {
    id: "mojojo_records",
    name: "MoJoJo Records",
    app: "MoJoJo music shelf",
    tagline: "Drop the needle",
    palette: 0xff4db8,
    emblem: "record",
    seating: false,
    marquee: false,
    isPublicSafe: true,
  },
  classifieds_arcade: {
    id: "classifieds_arcade",
    name: "Classifieds Arcade",
    app: "Classifieds board",
    tagline: "Browse the board",
    palette: 0x9d7cff,
    emblem: "board",
    seating: false,
    marquee: false,
    isPublicSafe: true,
  },
  ledger_exchange: {
    id: "ledger_exchange",
    name: "Coin Counter",
    app: "City ledger",
    tagline: "Balance the books",
    palette: 0xffd34d,
    emblem: "coin",
    seating: false,
    marquee: false,
    isPublicSafe: true,
  },
  tarentaal_tours: {
    id: "tarentaal_tours",
    name: "Tarentaal Tours",
    app: "Wildlife walk",
    tagline: "Follow the flock",
    palette: 0xff8c4d,
    emblem: "bird",
    seating: false,
    marquee: false,
    isPublicSafe: true,
  },
  builder_studio: {
    id: "builder_studio",
    name: "Builder Studio",
    app: "House builder",
    tagline: "Sketch the next room",
    palette: 0x7dd3ff,
    emblem: "frame",
    seating: false,
    marquee: false,
    isPublicSafe: true,
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
    isPublicSafe: true,
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
    isPublicSafe: true,
  },
};

const MARQUEE_ORDER: BusinessId[] = [
  "nearest_bar",
  "chef_market",
  "sportifine_club",
  "sprout_nursery",
];
const SECONDARY_ORDER: BusinessId[] = [
  "citylife_garage",
  "mojojo_records",
  "classifieds_arcade",
  "ledger_exchange",
  "tarentaal_tours",
  "builder_studio",
  "trading_post",
  "corner_kiosk",
];
const KIND_RANK: Record<ShopKind, number> = { showroom: 0, store: 1, kiosk: 2 };
const shopIdx = (id: string) => parseInt(id.split("_")[1] ?? "0", 10);

/** Assign a business to every surveyed plot: marquee apps still claim the biggest plots first, but the
 *  visible strip no longer collapses to repeated generic names. Secondary identities cycle through a
 *  larger authored roster and avoid immediate-neighbour repeats in parcel order. */
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
  }

  let s = 0;
  const ordered = [...parcels].sort((a, b) => shopIdx(a.id) - shopIdx(b.id));
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!;
    if (out[p.id]) continue;
    const prev = i > 0 ? out[ordered[i - 1]!.id] : undefined;
    let next = SECONDARY_ORDER[s % SECONDARY_ORDER.length]!;
    if (next === prev) {
      s++;
      next = SECONDARY_ORDER[s % SECONDARY_ORDER.length]!;
    }
    out[p.id] = next;
    s++;
  }
  return out;
}
