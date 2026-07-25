// PLAYER.HOME.1C — the dark, server-truth client contract for the starter-property selection and
// identity-bound house projection. It mirrors PLAYER.CAR.1.S4's carAcquisition purity rules exactly:
//
//   • The eligible starter choices are SERVER-RETURNED ONLY. The client never infers a choice from the
//     map, a static layout, localStorage or any client state — it renders exactly what the authority
//     lists and nothing else. A private/inaccessible neighbourhood is simply ABSENT from that list
//     (the server omits it), so omission is server-owned and never a client filter that could leak.
//   • On purchase the client posts the SELECTED neighbourhoodKey ONLY, and only when that key is one the
//     server just offered. It never names a price, never moves KCO, never claims a plot/frame/owner/deed
//     — the kooker service is the sole authority for identity (from the bearer token), price and grant.
//   • Ownership renders from the authoritative home-truth GET. There is NO localStorage authority: the
//     projected house is a pure function of the re-fetched server truth (see starterHouseProjection).
//   • Every purchase response is classified into a small closed set the overlay renders: owned (grant),
//     insufficient_funds (422), pending (accepted/replay), disabled (signed out / flag off / kill
//     switch), error. 422 (not the vehicle flow's 402) is the deployed home-purchase shortfall status;
//     503 (kill switch) and 401/403 (signed out / feature off) all fail closed to disabled.
//
// The pure model ops (the dark gate, the eligible-list and home-truth sanitisers, the response
// classifier and the button view) take no DOM and are node-testable. The backend layer is best-effort
// and fail-soft like carAcquisition / furnitureStore: it never throws, never blocks the game, and
// tolerates a 404 while a kooker-side endpoint ships separately — so the whole slice stays inert and
// falls back to the legacy entry until the operator UAT turns it on.
import { getAuthClient } from "../authClient";

/** GET the server-eligible starter neighbourhood choices for THIS signed-in player (token-derived).
 *  The server has already applied the stricter `isPubliclyEligibleForStarterHome` gate, so a private
 *  or inaccessible neighbourhood never appears here. */
export const HOME_ELIGIBLE_PATH =
  "/kooker/api/v1/citylife/players/me/home/eligible-neighbourhoods";
/** GET the authoritative home truth (owned/status/plot/frame) for the signed-in player. */
export const HOME_TRUTH_PATH = "/kooker/api/v1/citylife/players/me/home";
/** POST a single selected neighbourhoodKey to purchase; the service checks funds, moves coin, derives
 *  the plot/frame/deed from the token identity and records ownership itself. */
export const HOME_PURCHASE_PATH =
  "/kooker/api/v1/citylife/players/me/home/purchase";

/** The starter home's server-owned onboarding states, mirrored for the guided-journey advance. Only
 *  `OWNED` truth (owned === true) advances the journey and projects a house. */
export type HomeOnboardingState =
  | "NONE"
  | "PENDING"
  | "OWNED"
  | "REQUIRES_OPERATOR"
  | string;

/** The feature is DARK by default. It turns on only when the operator sets VITE_CITYLIFE_HOME_PURCHASE
 *  to "on"/"1"/"true"/"enabled" in the build env for UAT — this worker never sets it, so production
 *  stays dark and the legacy entry is preserved. Mirrors isCarAcquisitionEnabled exactly. */
export function isHomePurchaseEnabled(
  env?: Record<string, string | undefined>,
): boolean {
  const raw = (env ?? readViteEnv())["VITE_CITYLIFE_HOME_PURCHASE"];
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

// ── Eligible starter choices (SERVER-RETURNED ONLY) ───────────────────────────────

/** One server-offered starter-property choice. `key` is the ONLY thing the client may ever post back;
 *  `name` and `priceKco` are display-only server truth the UI shows but must never author or submit. */
export interface EligibleNeighbourhood {
  readonly key: string;
  readonly name: string;
  /** The canonical server price in KCO. Display only — never submitted. `null` when the server did not
   *  quote one (the UI shows it as unknown rather than inventing a number). */
  readonly priceKco: number | null;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

/** Coerce a raw server entry into an EligibleNeighbourhood, or null if it lacks a usable key. Price is
 *  kept only when the server sent a finite number — never defaulted, so the UI can only ever show the
 *  authority's own quote. Pure. */
export function coerceEligibleNeighbourhood(
  raw: unknown,
): EligibleNeighbourhood | null {
  const o = asRecord(raw);
  if (!o) return null;
  const key = typeof o.key === "string" ? o.key.trim() : "";
  if (!key) return null;
  const name =
    typeof o.name === "string" && o.name.trim() ? o.name.trim() : key;
  const priceRaw = o.priceKco ?? o.price;
  const priceKco =
    typeof priceRaw === "number" && Number.isFinite(priceRaw) ? priceRaw : null;
  return { key, name, priceKco };
}

/** Screen a raw server body into the sorted, de-duped list of eligible choices we are willing to render
 *  and post. Accepts either a bare array or a { neighbourhoods: [...] } envelope. Unknown/keyless
 *  entries are dropped; duplicate keys keep the first. Sorted by key for a deterministic render order.
 *  Returns [] for anything malformed — the overlay then shows an empty/legacy state, never a guess. */
export function sanitizeEligibleNeighbourhoods(
  raw: unknown,
): EligibleNeighbourhood[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw)?.neighbourhoods)
      ? (asRecord(raw)!.neighbourhoods as unknown[])
      : null;
  if (!arr) return [];
  const seen = new Set<string>();
  const out: EligibleNeighbourhood[] = [];
  for (const e of arr) {
    const n = coerceEligibleNeighbourhood(e);
    if (!n || seen.has(n.key)) continue;
    seen.add(n.key);
    out.push(n);
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

// ── Authoritative home truth ──────────────────────────────────────────────────────

/** The authoritative home truth the server returns (shape from the deployed user-service 1.37.3
 *  contract: `{owned,status,neighbourhoodKey,plotId,onboardingState}`, plus an optional frame/price the
 *  house projection binds to when present). Every field is server-owned; the client only reads it. */
export interface HomeTruth {
  readonly owned: boolean;
  readonly status: string | null;
  readonly neighbourhoodKey: string | null;
  readonly plotId: string | null;
  readonly frameId: string | null;
  readonly onboardingState: HomeOnboardingState;
  /** The canonical price the server charged/charges, display only. */
  readonly priceKco: number | null;
}

/** Coerce a raw home-truth body into a HomeTruth, or null if it is not a usable object. `owned` is true
 *  ONLY on an explicit boolean true — anything ambiguous reads as not-owned so the journey never
 *  advances and no house projects on a malformed payload. Pure, fail-closed. */
export function parseHomeTruth(raw: unknown): HomeTruth | null {
  const o = asRecord(raw);
  if (!o) return null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const priceRaw = o.priceKco ?? o.price;
  return {
    owned: o.owned === true,
    status: str(o.status),
    neighbourhoodKey: str(o.neighbourhoodKey),
    plotId: str(o.plotId),
    frameId: str(o.frameId),
    onboardingState: str(o.onboardingState) ?? "NONE",
    priceKco:
      typeof priceRaw === "number" && Number.isFinite(priceRaw)
        ? priceRaw
        : null,
  };
}

/** Does the authoritative truth say the home is owned? The single guard the guided journey advances on
 *  and the projection keys off — owned must be explicitly true AND the status must not contradict it.
 *  Pure. */
export function isHomeOwned(truth: HomeTruth | null): boolean {
  if (!truth) return false;
  if (!truth.owned) return false;
  // A status is optional, but if the server sent one it must not say the home is unowned/pending.
  if (truth.status && truth.status.toUpperCase() !== "OWNED") return false;
  return true;
}

// ── Purchase response classification ──────────────────────────────────────────────

/** The states one purchase attempt can settle into — the overlay renders exactly one. */
export type PurchaseOutcome =
  | { kind: "owned" } // 200/201 — the server granted (or confirms prior) ownership
  | { kind: "insufficient_funds" } // 422 — not enough KCO; the service moved no coin
  | { kind: "pending" } // 202/409 — accepted or a replay of an in-flight/settled request
  | { kind: "disabled" } // 401/403/503 — signed out, feature off, or kill switch; never blind-retry
  | { kind: "error"; status?: number }; // anything else — a transient/unknown failure

/** Map a purchase HTTP status to a closed outcome. The kooker service owns the decision; the client only
 *  interprets it. 409/202 both mean "already being handled" — an idempotent replay that must never
 *  double-charge, so we surface a neutral pending rather than a second POST. 422 is the deployed
 *  insufficient-funds shortfall (distinct from the vehicle flow's 402). 503 is the home kill switch and
 *  403 the feature-flag/off gate — both fail closed to disabled so the journey holds on the legacy
 *  path. Pure. */
export function classifyPurchaseStatus(status: number): PurchaseOutcome {
  if (status === 200 || status === 201) return { kind: "owned" };
  if (status === 422) return { kind: "insufficient_funds" };
  if (status === 202 || status === 409) return { kind: "pending" };
  if (status === 401 || status === 403 || status === 503)
    return { kind: "disabled" };
  return { kind: "error", status };
}

/** The rendered shape of the purchase control, derived purely from ownership + selection + in-flight +
 *  last outcome so the overlay stays a thin view and the "handle every state" logic is node-testable.
 *  `state` is the stable key an E2E asserts (data-purchase-state); `disabled` is true whenever a tap
 *  must not fire another POST (already owned, nothing selected, in flight, being processed, or refused). */
export interface PurchaseButtonView {
  readonly state:
    | "ready"
    | "pending"
    | "owned"
    | "insufficient_funds"
    | "disabled"
    | "error";
  readonly label: string;
  readonly disabled: boolean;
}

export function purchaseButtonView(
  isOwned: boolean,
  hasSelection: boolean,
  isPending: boolean,
  outcome: PurchaseOutcome | undefined,
): PurchaseButtonView {
  if (isOwned) return { state: "owned", label: "✓ Home secured", disabled: true };
  if (isPending)
    return { state: "pending", label: "⏳ Securing…", disabled: true };
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
      return { state: "disabled", label: "🔒 Sign in to buy", disabled: true };
    case "error":
      return { state: "error", label: "Couldn't buy — retry", disabled: false };
    default:
      if (!hasSelection)
        return { state: "disabled", label: "Pick a neighbourhood", disabled: true };
      return { state: "ready", label: "Secure this home", disabled: false };
  }
}

/** The accent colour for a purchase state. Kept next to the pure view so the overlay carries no policy,
 *  but separated from {@link purchaseButtonView} so the state machine stays colour-free and testable. */
export function purchaseStateColor(state: PurchaseButtonView["state"]): string {
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

/** A stable idempotency key for one (player, neighbourhood) purchase, so a double-tap or a reload-retry
 *  is the SAME request to the service and can never create a second deed / double-charge. Pure. userId
 *  is best-effort — a signed-in player always has one; the "anon" fallback only appears in a degraded
 *  path where no POST fires. */
export function homePurchaseIdempotencyKey(
  userId: string | null,
  neighbourhoodKey: string,
): string {
  return `citylife:home-purchase:${userId ?? "anon"}:${neighbourhoodKey}`;
}

// ── Backend layer (best-effort, as the logged-in player) ──────────────────────────

async function bearer(): Promise<string | null> {
  return getAuthClient().getValidToken();
}

/** Fetch the SERVER-eligible starter neighbourhood choices. Null when signed out, the endpoint is
 *  missing (404 while it ships separately), or the body is malformed — callers then show the empty /
 *  legacy state, never a client-invented list. Never throws. */
export async function fetchEligibleNeighbourhoods(): Promise<
  EligibleNeighbourhood[] | null
> {
  const token = await bearer();
  if (!token) return null;
  try {
    const resp = await fetch(HOME_ELIGIBLE_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    return sanitizeEligibleNeighbourhoods(data);
  } catch {
    return null;
  }
}

/** Fetch the authoritative home truth. Null when signed out, the endpoint is absent, or the payload is
 *  malformed — callers keep the legacy entry and never project a house. Never throws. */
export async function fetchHomeTruth(): Promise<HomeTruth | null> {
  const token = await bearer();
  if (!token) return null;
  try {
    const resp = await fetch(HOME_TRUTH_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    return parseHomeTruth(data);
  } catch {
    return null;
  }
}

/** Post a starter-home purchase. Sends the SELECTED neighbourhoodKey ONLY (no price, no amount, no owner
 *  or plot claim) plus a stable Idempotency-Key; the service alone checks funds, moves coin, derives the
 *  identity-bound plot/frame/deed and records ownership. Returns a classified {@link PurchaseOutcome}.
 *  Refuses locally — without ever touching the network — when the feature is dark, the player is signed
 *  out, or the key is NOT one the server just offered (`eligibleKeys`), so a tampered/stale key can never
 *  reach the authority and authority is never bypassed. */
export async function postPurchaseHome(
  neighbourhoodKey: string,
  eligibleKeys: readonly string[],
  env?: Record<string, string | undefined>,
): Promise<PurchaseOutcome> {
  if (!isHomePurchaseEnabled(env)) return { kind: "disabled" };
  if (!neighbourhoodKey || !eligibleKeys.includes(neighbourhoodKey))
    return { kind: "disabled" };
  const auth = getAuthClient();
  const token = await auth.getValidToken();
  if (!token) return { kind: "disabled" };
  const idemKey = homePurchaseIdempotencyKey(
    auth.operator?.userId ?? null,
    neighbourhoodKey,
  );
  try {
    const resp = await fetch(HOME_PURCHASE_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify({ neighbourhoodKey }),
    });
    return classifyPurchaseStatus(resp.status);
  } catch {
    return { kind: "error" };
  }
}
