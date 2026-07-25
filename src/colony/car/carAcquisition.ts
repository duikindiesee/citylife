// PLAYER.CAR.1.S4 — showroom acquisition wired to AUTHORITATIVE SERVER TRUTH, kept DARK behind a
// feature gate until operator UAT. The contract is deliberately thin on the client:
//
//   • The acquire button posts the CANONICAL vehicleKey ONLY. The client never names a price, never
//     moves KCO and never decides ownership — the kooker service is the sole authority. A tampered or
//     unknown key is rejected before it can even be posted.
//   • Ownership renders from the server GET truth (fetchOwnedVehicleKeysBackend). localStorage is a
//     CACHE ONLY — a fail-soft mirror so a returning player sees their garage before the truth call
//     resolves — and is always overwritten by, never merged ahead of, the server response.
//   • Every acquire response is classified into a small closed set of states the overlay renders:
//     owned (success), insufficient_funds, pending (replay / already in flight), disabled
//     (feature off, signed out, or refused), error.
//
// Pure model ops (the gate, key screen, cache codec and response classifier) take no DOM and are
// node-testable, mirroring the carSpec / showroomState purity rule. The backend layer is best-effort
// and fail-soft like furnitureStore: it never throws, never blocks the game, and tolerates a 404 while
// the kooker-side endpoint ships separately.
import { getAuthClient } from "../authClient";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";

/** GET the player's owned vehicles — the cross-device server truth. */
const BACKEND_OWNERSHIP_PATH = "/kooker/api/v1/citylife/car-ownership";
/** POST a single canonical vehicleKey to acquire; the service checks funds and moves coin itself. */
const BACKEND_ACQUIRE_PATH = "/kooker/api/v1/citylife/car-acquisitions";
/** Cache-only mirror of the server ownership truth — never authoritative. */
const LS_CAR_OWNERSHIP = "citylife.car.ownership.v1";

/** The feature is DARK by default. It turns on only when the operator sets VITE_CITYLIFE_CAR_ACQUISITION
 *  to "on"/"1"/"true" in the build env for UAT — this worker never sets it, so production stays dark. */
export function isCarAcquisitionEnabled(
  env?: Record<string, string | undefined>,
): boolean {
  const raw = (env ?? readViteEnv())["VITE_CITYLIFE_CAR_ACQUISITION"];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "on" || v === "1" || v === "true" || v === "enabled";
}

function readViteEnv(): Record<string, string | undefined> {
  try {
    return (
      (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env ?? {}
    );
  } catch {
    return {};
  }
}

/** The canonical acquire key for a showroom vehicle IS its procedural CarSpec id (e.g.
 *  "showroom:karoo-vonk-11"). It is the only thing the client is allowed to send. */
export function vehicleKeyOf(v: { spec: { id: string } }): string {
  return v.spec.id;
}

/** The closed set of canonical keys the showroom can ever offer. Anything outside it is never posted. */
const CANONICAL_VEHICLE_KEYS: ReadonlySet<string> = new Set(
  SHOWROOM_VEHICLES.map(vehicleKeyOf),
);

/** True only for a key the current catalog actually sells — guards the POST body against a tampered or
 *  stale client value so the authority only ever sees a real vehicleKey. Pure. */
export function isCanonicalVehicleKey(key: unknown): key is string {
  return typeof key === "string" && CANONICAL_VEHICLE_KEYS.has(key);
}

// ── Response classification ──────────────────────────────────────────────────────

/** The states the acquire flow can be in — the overlay renders exactly one of these. */
export type AcquireOutcome =
  | { kind: "owned" } // 200/201 — the server granted (or confirms prior) ownership
  | { kind: "insufficient_funds" } // 402 — not enough KCO; no coin moved
  | { kind: "pending" } // 202/409 — accepted or a replay of an in-flight/settled request
  | { kind: "disabled" } // 401/403 — signed out or refused; the client never retries blindly
  | { kind: "error"; status?: number }; // anything else — a transient/unknown failure

/** Map an acquire HTTP status to a closed outcome. The kooker service owns the decision; the client only
 *  interprets it. 409 (conflict) and 202 (accepted) both mean "already being handled" — a safe, idempotent
 *  replay that must never double-charge, so we surface a neutral pending rather than a second POST. Pure. */
export function classifyAcquireStatus(status: number): AcquireOutcome {
  if (status === 200 || status === 201) return { kind: "owned" };
  if (status === 402) return { kind: "insufficient_funds" };
  if (status === 202 || status === 409) return { kind: "pending" };
  if (status === 401 || status === 403) return { kind: "disabled" };
  return { kind: "error", status };
}

/** The rendered shape of the acquire control, derived purely from ownership + in-flight + last outcome so
 *  the overlay stays a thin view and the "handle every state" logic is node-testable. `state` is the stable
 *  key an E2E asserts (data-acquire-state); `disabled` is true whenever a click must not fire another POST
 *  (already owned, in flight, being processed, or refused). No THREE, no React, no colour policy. */
export interface AcquireButtonView {
  readonly state:
    "ready" | "pending" | "owned" | "insufficient_funds" | "disabled" | "error";
  readonly label: string;
  readonly disabled: boolean;
}

export function acquireButtonView(
  isOwned: boolean,
  isPending: boolean,
  outcome: AcquireOutcome | undefined,
): AcquireButtonView {
  if (isOwned)
    return { state: "owned", label: "✓ In your garage", disabled: true };
  if (isPending)
    return { state: "pending", label: "⏳ Acquiring…", disabled: true };
  switch (outcome?.kind) {
    case "insufficient_funds":
      return {
        state: "insufficient_funds",
        label: "Not enough ₭ — try later",
        disabled: false,
      };
    case "pending":
      return { state: "pending", label: "⏳ Processing…", disabled: true };
    case "disabled":
      return {
        state: "disabled",
        label: "🔒 Sign in to acquire",
        disabled: true,
      };
    case "error":
      return {
        state: "error",
        label: "Couldn't acquire — retry",
        disabled: false,
      };
    default:
      return { state: "ready", label: "Acquire", disabled: false };
  }
}

/** The accent colour for an acquire state. Kept next to the pure view so the overlay carries no policy,
 *  but separated from {@link acquireButtonView} so the state machine stays colour-free and testable. */
export function acquireStateColor(state: AcquireButtonView["state"]): string {
  switch (state) {
    case "owned":
      return "#9fd4a6";
    case "pending":
      return "#ffd25a";
    case "insufficient_funds":
      return "#f2a35a";
    case "error":
      return "#e07a7a";
    case "disabled":
      return "#7a90a0";
    default:
      return "#a0d4f0";
  }
}

// ── Ownership cache (localStorage — CACHE ONLY) ───────────────────────────────────

/** Screen a raw list into the sorted, de-duped set of canonical keys we are willing to store or trust.
 *  Unknown/tampered entries are dropped, so a corrupt cache can never surface a fake owned car. Pure. */
export function safeOwnedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keep = new Set<string>();
  for (const e of raw) if (isCanonicalVehicleKey(e)) keep.add(e);
  return [...keep].sort();
}

/** Read the cached ownership mirror. Never authoritative — callers replace it the moment the server
 *  truth resolves. Returns [] on any storage/parse failure. */
export function loadOwnedKeysCache(): string[] {
  try {
    const raw = localStorage.getItem(LS_CAR_OWNERSHIP);
    if (!raw) return [];
    return safeOwnedKeys(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Overwrite the cache with the given keys (screened + sorted). Returns false if storage is unavailable.
 *  Only ever called with values the server returned — the cache follows the truth, never leads it. */
export function saveOwnedKeysCache(keys: readonly string[]): boolean {
  try {
    localStorage.setItem(LS_CAR_OWNERSHIP, JSON.stringify(safeOwnedKeys(keys)));
    return true;
  } catch {
    return false;
  }
}

/** Forget the cached ownership mirror (colony reset / sign-out). */
export function clearOwnedKeysCache(): void {
  try {
    localStorage.removeItem(LS_CAR_OWNERSHIP);
  } catch {
    /* no storage */
  }
}

// ── Backend layer (best-effort, as the logged-in player) ──────────────────────────

/** Fetch the player's owned vehicleKeys from the authority. Null when signed out, the endpoint is
 *  missing (404 while it ships separately), or the body is malformed — callers fall back to the cache.
 *  Accepts either a bare array or an { ownedVehicleKeys: [...] } envelope. Never throws. */
export async function fetchOwnedVehicleKeysBackend(): Promise<string[] | null> {
  const token = await getAuthClient().getValidToken();
  if (!token) return null;
  try {
    const resp = await fetch(BACKEND_OWNERSHIP_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === "object"
        ? (data as { ownedVehicleKeys?: unknown }).ownedVehicleKeys
        : null;
    return arr ? safeOwnedKeys(arr) : null;
  } catch {
    return null;
  }
}

/** A stable idempotency key for one (player, vehicle) acquisition, so a double-tap or a reload-retry is
 *  the SAME request to the service and can never double-charge. Pure. userId is best-effort — a signed-in
 *  player always has one; the "anon" fallback only appears in a degraded/dev path where no POST fires. */
export function acquireIdempotencyKey(
  userId: string | null,
  vehicleKey: string,
): string {
  return `citylife:car-acquire:${userId ?? "anon"}:${vehicleKey}`;
}

/** Post an acquisition. Sends the canonical vehicleKey ONLY (no price, no amount, no ownership claim) plus
 *  a stable Idempotency-Key; the service alone checks funds, moves coin and records ownership. Returns a
 *  classified {@link AcquireOutcome}. Refuses locally — without ever touching the network — when the
 *  feature is dark, the key is not canonical, or the player is signed out, so authority is never bypassed. */
export async function postAcquireVehicle(
  vehicleKey: string,
  env?: Record<string, string | undefined>,
): Promise<AcquireOutcome> {
  if (!isCarAcquisitionEnabled(env)) return { kind: "disabled" };
  if (!isCanonicalVehicleKey(vehicleKey)) return { kind: "disabled" };
  const auth = getAuthClient();
  const token = await auth.getValidToken();
  if (!token) return { kind: "disabled" };
  const idemKey = acquireIdempotencyKey(
    auth.operator?.userId ?? null,
    vehicleKey,
  );
  try {
    const resp = await fetch(BACKEND_ACQUIRE_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify({ vehicleKey }),
    });
    return classifyAcquireStatus(resp.status);
  } catch {
    return { kind: "error" };
  }
}
