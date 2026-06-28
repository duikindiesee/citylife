// The buy-side gate for CityLife private communities. A neighbourhood is DATA on the backend (a row),
// never a JWT role; a PRIVATE one is allowlist-gated. Before the player buys a plot in a satellite
// hamlet we ask the backend whether THIS signed-in player may buy there — keyed by the hamlet's stable
// engine key (wood1/hill2/vale2), resolved server-side from the player's bearer token (never a
// spoofable header). The primary coastal neighbourhood has no key and is open land (no network call).
//
// Mirrors ledgerSync's shape: a small dep-injected transport + token getter so the heart is pure and
// node-testable, with a browser default that drains through the same /kooker proxy as the player.
import { getAuthClient } from "../authClient";
import { userIdFromToken } from "./ledgerSync";

const CHECK_BASE = "/kooker/api/v1/citylife/neighbourhoods/by-key";

/** The CHECK url for a hamlet key. */
export function checkPath(key: string): string {
  return `${CHECK_BASE}/${encodeURIComponent(key)}/access/check`;
}

/** Derive a lot's neighbourhood key from its id. Satellite-hamlet lots are prefixed at world build
 *  (`wood1_lot_3`); the primary coastal lots are bare (`lot_3`) and have no key (open land → null). */
export function neighbourhoodKeyForLot(lotId: string): string | null {
  const m = lotId.match(/^(.+)_lot_\d+$/);
  return m ? m[1]! : null;
}

export interface AccessDecision {
  allowed: boolean;
  /** A short human reason when denied, for the buy UI to surface. */
  reason?: string;
}

export type AccessTransport = (
  path: string,
  headers: Record<string, string>,
) => Promise<{ ok: boolean; status: number; allowed: boolean | null }>;

export interface NeighbourhoodAccessDeps {
  transport: AccessTransport;
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
}

/**
 * May the signed-in player buy a plot in the neighbourhood with this key?
 *   * no key            → open land, allowed without a network call.
 *   * not signed in     → denied (a keyed hamlet might be private; we can't verify).
 *   * backend allowed   → the authoritative decision (unregistered/public = true, private = allowlist).
 *   * error / non-ok    → denied with a reason (fail-closed, so a network blip never leaks a private
 *                         hamlet to a non-granted player; the UI invites a retry).
 */
export async function checkNeighbourhoodAccess(
  key: string | null | undefined,
  deps: NeighbourhoodAccessDeps,
): Promise<AccessDecision> {
  if (!key) return { allowed: true };

  const token = await deps.getToken();
  if (!token) {
    return { allowed: false, reason: "Sign in to buy in this neighbourhood" };
  }
  const userId = deps.getUserId(token);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (userId) headers["X-Kooker-User-Id"] = userId;

  try {
    const res = await deps.transport(checkPath(key), headers);
    if (!res.ok) {
      return {
        allowed: false,
        reason: `Couldn't verify neighbourhood access (HTTP ${res.status})`,
      };
    }
    if (res.allowed === true) return { allowed: true };
    return {
      allowed: false,
      reason: "This is a private neighbourhood — ask the owner for access",
    };
  } catch (e) {
    return {
      allowed: false,
      reason:
        e instanceof Error
          ? `Couldn't verify access: ${e.message}`
          : "Couldn't verify neighbourhood access",
    };
  }
}

/** The browser default deps — GET the CHECK as the player through the /kooker proxy. */
export function defaultAccessDeps(): NeighbourhoodAccessDeps {
  return {
    transport: async (path, headers) => {
      const resp = await fetch(path, { method: "GET", headers });
      let allowed: boolean | null = null;
      try {
        const body = (await resp.json()) as { allowed?: boolean };
        allowed = typeof body?.allowed === "boolean" ? body.allowed : null;
      } catch {
        allowed = null;
      }
      return { ok: resp.ok, status: resp.status, allowed };
    },
    getToken: () => getAuthClient().getValidToken(),
    getUserId: userIdFromToken,
  };
}
