// Spec 096 G — the Kookerbook CAR-PART classifieds. A player lists a bolt-on part they own for city
// coin; another player buys it, the coin moves between their wallets and the part changes hands. This
// mirrors the furniture marketplace pattern as a SIBLING (it never edits Jack's furniture files): a
// deterministic id, pure model ops, and a fail-soft localStorage layer. One listing per seller per kind
// (a player owns at most one of each). A car part has no player-typed name, only a catalog kind and a
// price, so there is no free-text to screen. In-game ledger only for now; the real-kooker-ledger mirror
// is a later, furniture-lane-coordinated slice.
import { CAR_PARTS, type CarPartKind } from "../car/carParts";

const LS_MARKET = "citylife.carparts.market.v1";

/** The most listings the public board holds — bounds storage and a runaway listing loop. */
export const CARPART_MARKET_CAP = 256;

/** One car-part listing on the public board. id = `${sellerCitizenId}:${kind}`, so one seller has a
 *  single listing per kind and a re-list just updates the price. */
export interface CarPartListing {
  id: string;
  sellerCitizenId: string;
  kind: CarPartKind;
  price: number;
}
export type CarPartMarket = CarPartListing[];

/** The stable listing id for a seller's part kind. */
export function carPartListingId(
  sellerCitizenId: string,
  kind: CarPartKind,
): string {
  return `${sellerCitizenId}:${kind}`;
}

/** Validate one listing, recomputing its id (a tampered id is ignored). Returns a clean listing, or null
 *  when the seller/kind is missing or unknown or the price is not a positive number. */
function safeListing(e: unknown): CarPartListing | null {
  if (!e || typeof e !== "object") return null;
  const { sellerCitizenId, kind, price } = e as {
    sellerCitizenId?: unknown;
    kind?: unknown;
    price?: unknown;
  };
  if (typeof sellerCitizenId !== "string" || sellerCitizenId.length === 0)
    return null;
  if (typeof kind !== "string" || !CAR_PARTS[kind as CarPartKind]) return null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0)
    return null;
  return {
    id: carPartListingId(sellerCitizenId, kind as CarPartKind),
    sellerCitizenId,
    kind: kind as CarPartKind,
    price: Math.round(price),
  };
}

/** Screen a raw board: drop invalid listings, dedupe by id (last wins — a re-list updates price), cap the
 *  count, and sort by id so the board is deterministic regardless of input order. */
function safeMarket(raw: unknown): CarPartMarket {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CarPartListing>();
  for (const e of raw) {
    const ok = safeListing(e);
    if (ok) byId.set(ok.id, ok);
  }
  return [...byId.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, CARPART_MARKET_CAP);
}

// ── Pure model ops (node-testable, no DOM) ──────────────────────────────────────

/** All public listings (a defensive copy; already screened). Pure. */
export function allCarPartListings(market: CarPartMarket): CarPartMarket {
  return market.map((l) => ({ ...l }));
}

/** Find one listing by id (null when absent). Pure. */
export function findCarPartListing(
  market: CarPartMarket,
  id: string,
): CarPartListing | null {
  return market.find((l) => l.id === id) ?? null;
}

/** Add (or re-price) a listing. Rejects an unknown kind / non-positive price by returning the input
 *  unchanged. A re-list of the same kind updates its price; a genuinely new listing is capped. Pure. */
export function addCarPartListing(
  market: CarPartMarket,
  sellerCitizenId: string,
  kind: CarPartKind,
  price: number,
): CarPartMarket {
  const listing = safeListing({ sellerCitizenId, kind, price });
  if (!listing) return market;
  const without = market.filter((l) => l.id !== listing.id);
  if (without.length === market.length && market.length >= CARPART_MARKET_CAP)
    return market;
  return [...without, listing].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** Remove a listing by id (no-op when absent). Pure. */
export function removeCarPartListing(
  market: CarPartMarket,
  id: string,
): CarPartMarket {
  return market.filter((l) => l.id !== id);
}

// ── LOCAL layer (fail-soft; no-ops in the node env without localStorage) ─────────

function ls(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Read the local board. Invalid listings are dropped, never returned. */
export function loadCarPartMarket(): CarPartMarket {
  const store = ls();
  if (!store) return [];
  try {
    const raw = store.getItem(LS_MARKET);
    return raw ? safeMarket(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Persist the whole board (screened first). Returns false if storage is unavailable. */
export function saveCarPartMarket(market: CarPartMarket): boolean {
  const store = ls();
  if (!store) return false;
  try {
    store.setItem(LS_MARKET, JSON.stringify(safeMarket(market)));
    return true;
  } catch {
    return false;
  }
}

/** Forget the local board (colony reset). */
export function clearCarPartMarket(): void {
  const store = ls();
  if (!store) return;
  try {
    store.removeItem(LS_MARKET);
  } catch {
    /* no storage */
  }
}
