// Spec 088 Slice C — FURNITURE INVENTORY. The virtual furniture a player OWNS, held as inventory
// against their citizen id: the pieces they have designed or bought, ready to place in a house (Slice E)
// or list on the Kookerbook marketplace (Slice F). Two layers, both fail-soft, mirroring blueprintStore:
//
//   • LOCAL — a localStorage map keyed by citizen id. Always written; offline/dev reloads keep a
//     player's inventory with no backend at all.
//   • BACKEND — best-effort calls through the /kooker proxy AS THE LOGGED-IN PLAYER: never blocks the
//     game, tolerates 404s while the kooker-side endpoint ships separately (kooker-service-user
//     /api/v1/citylife/*, consolidated in PR #144), and wins over local on restore (cross-device truth).
//
// Safety: every owned piece is screened on write AND read — its name passes isPublicSafe (so a custom
// label can never smuggle a brand word onto the marketplace) and its kind is a real catalog piece, so a
// corrupt stored entry can never reach the builder or the backend. Pure model ops are node-testable.
import { getAuthClient } from "../authClient";
import { FURNITURE_KINDS, type FurnitureKind } from "../furniture";
import { isPublicSafe } from "../newcomers";

const LS_FURNITURE = "citylife.furniture.v1";
const BACKEND_PATH = "/kooker/api/v1/citylife/furniture";

/** The most of a single design a player may stack, and the most distinct designs they may hold — bounds
 *  a runaway purchase/design loop and keeps a player's stored inventory small. */
export const FURNITURE_STACK_CAP = 99;
export const FURNITURE_STACKS_CAP = 64;

/** One stack of owned furniture: a catalog piece, a player-facing name, and how many are held. The id is
 *  derived from kind + name, so the same design dedupes and merges deterministically across layers. */
export interface OwnedFurniture {
  id: string;
  kind: FurnitureKind;
  name: string;
  qty: number;
}
/** A player's inventory keyed by citizen id. */
export type FurnitureInventory = Record<string, OwnedFurniture[]>;

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(FURNITURE_STACK_CAP, Math.floor(n)));
}

/** Slugify a name for the stable id: lowercase, non-alphanumerics to single dashes, trimmed. */
function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "piece";
}

/** Deterministic id for an owned design — `${kind}:${nameSlug}`. The same kind+name always collapses to
 *  one stack, so buying a design twice increments qty and local/backend copies merge cleanly. Pure. */
export function ownedFurnitureId(kind: FurnitureKind, name: string): string {
  return `${kind}:${slug(name)}`;
}

/** Normalise a player-supplied name: collapse whitespace, fall back to the kind when blank. */
function normalizeName(kind: FurnitureKind, name: string | undefined): string {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  return n.length > 0 ? n : kind;
}

/** Validate one owned-furniture entry, recomputing its id from kind+name so a tampered id is ignored.
 *  Returns a screened, normalised stack, or null when the kind is unknown, the name is unsafe, or the
 *  quantity is not a positive integer. */
function safeOwned(e: unknown): OwnedFurniture | null {
  if (!e || typeof e !== "object") return null;
  const { kind, name, qty } = e as {
    kind?: unknown;
    name?: unknown;
    qty?: unknown;
  };
  if (typeof kind !== "string" || !FURNITURE_KINDS.includes(kind as FurnitureKind))
    return null;
  if (typeof name !== "string" || typeof qty !== "number") return null;
  const nm = normalizeName(kind as FurnitureKind, name);
  if (!isPublicSafe(nm)) return null;
  // Reject a non-positive / non-finite quantity (a zero or negative stack only arises from tampering)
  // rather than silently clamping it up to 1, then bound the upper end to the per-stack cap.
  if (!Number.isFinite(qty) || qty < 1) return null;
  const q = Math.min(FURNITURE_STACK_CAP, Math.floor(qty));
  return {
    id: ownedFurnitureId(kind as FurnitureKind, nm),
    kind: kind as FurnitureKind,
    name: nm,
    qty: q,
  };
}

/** Screen a whole stack list (drops unsafe entries) and keep it stably sorted by id so serialisation is
 *  deterministic and equal inventories compare equal. Caps the number of distinct stacks. */
function safeList(raw: unknown): OwnedFurniture[] {
  if (!Array.isArray(raw)) return [];
  // Dedupe by id, SUMMING quantities (two entries that slug to the same design merge, rather than the
  // second silently losing its count), then sort by id and cap — so the kept set is deterministic
  // regardless of the raw input order.
  const byId = new Map<string, OwnedFurniture>();
  for (const e of raw) {
    const ok = safeOwned(e);
    if (!ok) continue;
    const existing = byId.get(ok.id);
    if (existing) existing.qty = clampQty(existing.qty + ok.qty);
    else byId.set(ok.id, ok);
  }
  return [...byId.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, FURNITURE_STACKS_CAP);
}

// ── Pure model ops (node-testable, no DOM) ──────────────────────────────────────

/** The stacks a citizen owns (a defensive copy; empty when they own nothing). Pure. */
export function ownedBy(
  inv: FurnitureInventory,
  citizenId: string,
): OwnedFurniture[] {
  return (inv[citizenId] ?? []).map((s) => ({ ...s }));
}

/** Add qty of a design to a citizen's inventory. Increments an existing stack (capped) or appends a new
 *  one (until the per-citizen stack cap). Rejects an unsafe name or unknown kind by returning the input
 *  unchanged. Pure — returns a new inventory, never mutates. */
export function addOwned(
  inv: FurnitureInventory,
  citizenId: string,
  kind: FurnitureKind,
  name?: string,
  qty = 1,
): FurnitureInventory {
  if (!citizenId) return inv;
  const piece = safeOwned({ kind, name: normalizeName(kind, name), qty });
  if (!piece) return inv;
  const list = inv[citizenId] ?? [];
  const idx = list.findIndex((s) => s.id === piece.id);
  let next: OwnedFurniture[];
  if (idx >= 0) {
    next = list.map((s, i) =>
      i === idx ? { ...s, qty: clampQty(s.qty + piece.qty) } : s,
    );
  } else if (list.length < FURNITURE_STACKS_CAP) {
    next = [...list, piece];
  } else {
    return inv; // the player already holds the maximum number of distinct designs
  }
  next.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...inv, [citizenId]: next };
}

/** Remove qty of a stack (by id) from a citizen's inventory; drops the stack at zero and the citizen key
 *  when their inventory empties. A missing citizen or id is a no-op. Pure. */
export function removeOwned(
  inv: FurnitureInventory,
  citizenId: string,
  id: string,
  qty = 1,
): FurnitureInventory {
  const list = inv[citizenId];
  if (!list) return inv;
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return inv;
  const left = list[idx]!.qty - Math.max(1, Math.floor(qty));
  const next =
    left > 0
      ? list.map((s, i) => (i === idx ? { ...s, qty: left } : s))
      : list.filter((_, i) => i !== idx);
  const copy = { ...inv };
  if (next.length > 0) copy[citizenId] = next;
  else delete copy[citizenId];
  return copy;
}

/** Merge restore layers: the backend (when reachable) wins per citizen — it is the cross-device truth —
 *  while local fills any player the backend does not know about. Null backend is a no-op. Pure. */
export function mergeInventories(
  local: FurnitureInventory,
  backend: FurnitureInventory | null,
): FurnitureInventory {
  return { ...local, ...(backend ?? {}) };
}

// ── LOCAL layer ─────────────────────────────────────────────────────────────────

/** Read the local inventory. Unsafe/invalid stacks are dropped, never returned. */
export function loadInventoryLocal(): FurnitureInventory {
  try {
    const raw = localStorage.getItem(LS_FURNITURE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: FurnitureInventory = {};
    for (const [citizenId, list] of Object.entries(parsed)) {
      if (!citizenId) continue;
      const safe = safeList(list);
      if (safe.length > 0) out[citizenId] = safe;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the whole inventory locally (screened first). Returns false if storage is unavailable. */
export function saveInventoryLocal(inv: FurnitureInventory): boolean {
  try {
    const clean: FurnitureInventory = {};
    for (const [citizenId, list] of Object.entries(inv)) {
      if (!citizenId) continue;
      const safe = safeList(list);
      if (safe.length > 0) clean[citizenId] = safe;
    }
    localStorage.setItem(LS_FURNITURE, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

/** Convenience: add a piece to a citizen's inventory and persist the result locally. Returns the new
 *  inventory (unchanged on an unsafe piece or storage failure). */
export function recordOwnedLocal(
  citizenId: string,
  kind: FurnitureKind,
  name?: string,
  qty = 1,
): FurnitureInventory {
  const next = addOwned(loadInventoryLocal(), citizenId, kind, name, qty);
  saveInventoryLocal(next);
  return next;
}

/** Forget all locally stored inventory (colony reset). */
export function clearInventoryLocal(): void {
  try {
    localStorage.removeItem(LS_FURNITURE);
  } catch {
    /* no storage */
  }
}

// ── BACKEND layer (best-effort, as the logged-in player) ─────────────────────────

export type BackendSaveResult = { ok: true } | { ok: false; error: string };

/** Best-effort: persist one citizen's inventory to the citylife backend as the logged-in player. Never
 *  throws, never blocks the game — a 404 just means the kooker-side endpoint has not shipped yet. */
export async function saveInventoryBackend(
  citizenId: string,
  items: OwnedFurniture[],
): Promise<BackendSaveResult> {
  if (!citizenId) return { ok: false, error: "no citizen" };
  const safe = safeList(items);
  const token = await getAuthClient().getValidToken();
  if (!token) return { ok: false, error: "not signed in" };
  try {
    const resp = await fetch(BACKEND_PATH, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ citizenId, items: safe }),
    });
    return resp.ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** Best-effort: fetch the player's stored inventory from the backend. Null when signed out, the endpoint
 *  is missing, or the response is malformed — callers fall back to the local inventory. */
export async function fetchInventoryBackend(): Promise<FurnitureInventory | null> {
  const token = await getAuthClient().getValidToken();
  if (!token) return null;
  try {
    const resp = await fetch(BACKEND_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    if (!data || typeof data !== "object") return null;
    const out: FurnitureInventory = {};
    for (const [citizenId, list] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (!citizenId) continue;
      const safe = safeList(list);
      if (safe.length > 0) out[citizenId] = safe;
    }
    return out;
  } catch {
    return null;
  }
}
