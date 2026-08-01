// HQ.FLAG.1 — the fail-closed, default-OFF client gate for Kooker HQ.
//
// Every new feature lives behind a feature gate (operator standing rule). HQ ships the same way the
// Gamehouse venue and the new-player journey do: the entry stays INVISIBLE and UNUSABLE until the
// operator allowlists a player server-side, so an unfinished reception can never leak to everyone.
//
// Truth is the authenticated, token-derived endpoint
//   GET /api/v1/citylife/players/me/feature-flags/kooker-hq-v1
// resolved server-side from the player's bearer token. We NEVER send a caller-supplied userId; the
// only identity hint is the X-Kooker-User-Id decoded from that same already-validated token.
//
// Fail-closed rule (SECURITY): HQ is enabled ONLY when the backend answers, unambiguously,
// enabled === true AND the flag is not killed. OFF, killed, 401/403, timeout, a malformed payload and
// any network error ALL resolve to disabled. A blip can never open the building to a non-allowlisted
// player, and the kill switch always wins even if `enabled` somehow also reads true.
//
// Mirrors the dep-injected transport + token-getter shape of arcadeGamehouse/newPlayerJourney so the
// decision heart is pure and node-testable without a DOM.
import { getAuthClient } from "../authClient";
import { userIdFromToken } from "../bot/ledgerSync";

export const KOOKER_HQ_FLAG = "kooker-hq-v1";
export const KOOKER_HQ_FLAG_PATH =
  "/kooker/api/v1/citylife/players/me/feature-flags/kooker-hq-v1";

/** The bounded default before a hung network is treated as a (fail-closed) failure. */
export const DEFAULT_HQ_ENTITLEMENT_TIMEOUT_MS = 8000;

/** The raw backend body. Every field is `unknown` on purpose — the decision trusts nothing. */
export interface HqFlagBody {
  enabled?: unknown;
  killed?: unknown;
  state?: unknown;
  reason?: unknown;
}

export interface HqEntitlement {
  /** True ONLY for an unambiguous, live, non-killed positive. Default and every error = false. */
  readonly enabled: boolean;
  /** A short reason, for logging and the disabled-entry tooltip. Never a bearer of access. */
  readonly reason?: string;
}

export type HqTransportResult = {
  ok: boolean;
  status: number;
  body: HqFlagBody | null;
};

export type HqTransport = (
  path: string,
  headers: Record<string, string>,
) => Promise<HqTransportResult>;

export interface HqEntitlementDeps {
  transport: HqTransport;
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
}

function deny(reason: string): HqEntitlement {
  return { enabled: false, reason };
}

/**
 * The pure decision from an already-fetched transport result. Exported so the whole
 * OFF / killed / enabled / non-ok matrix is unit-testable without a network.
 */
export function decideHqEntitlement(res: HqTransportResult): HqEntitlement {
  if (!res.ok) return deny(`Entitlement unavailable (HTTP ${res.status})`);
  const body = res.body;
  if (!body || typeof body !== "object")
    return deny("Malformed entitlement payload");
  // A kill switch ALWAYS wins, even if `enabled` somehow also reads true — killed means disabled.
  const killed =
    body.killed === true ||
    (typeof body.state === "string" && body.state.toUpperCase() === "KILLED");
  if (killed) return deny("Kooker HQ is killed");
  if (body.enabled === true) {
    return {
      enabled: true,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };
  }
  return deny("Kooker HQ is off");
}

/**
 * Evaluate the signed-in player's `kooker-hq-v1` entitlement. Returns a fail-closed
 * `{ enabled: false }` when there is no token, and on every non-ok / malformed / thrown outcome.
 */
export async function evaluateHqEntitlement(
  deps: HqEntitlementDeps,
): Promise<HqEntitlement> {
  const token = await deps.getToken();
  if (!token) return deny("Sign in to enter Kooker HQ");
  const userId = deps.getUserId(token);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Token-derived only — a convenience mirror of the server-side identity, never caller-supplied.
  if (userId) headers["X-Kooker-User-Id"] = userId;
  try {
    return decideHqEntitlement(
      await deps.transport(KOOKER_HQ_FLAG_PATH, headers),
    );
  } catch (e) {
    return deny(
      e instanceof Error
        ? `Couldn't verify entitlement: ${e.message}`
        : "Couldn't verify entitlement",
    );
  }
}

/** The browser default deps — GET the flag as the player through the /kooker proxy, time-bounded so a
 *  hung gateway resolves to disabled rather than leaving the entry in limbo. */
export function defaultHqDeps(
  timeoutMs = DEFAULT_HQ_ENTITLEMENT_TIMEOUT_MS,
): HqEntitlementDeps {
  return {
    transport: async (path, headers) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(path, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        let body: HqFlagBody | null = null;
        try {
          body = (await resp.json()) as HqFlagBody;
        } catch {
          body = null;
        }
        return { ok: resp.ok, status: resp.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
    getToken: () => getAuthClient().getValidToken(),
    getUserId: userIdFromToken,
  };
}
