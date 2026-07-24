// PLAYER.FLAG.S3 — the fail-closed, default-OFF client gate for the incomplete new-player journey
// (signup → starter grant → garage → car → home). The whole journey stays INVISIBLE and UNUSABLE
// until operator UAT explicitly allowlists a player, so this is a pure client integration of an
// existing server entitlement — it never flips a flag, mutates a cohort/allowlist, moves KCO, or
// writes car/deed/property ownership.
//
// Truth is the authenticated, token-derived endpoint
//   GET /api/v1/citylife/players/me/feature-flags/new-player-journey-v1
// resolved server-side from the player's bearer token. We NEVER send a caller-supplied userId; the
// only identity hint is the X-Kooker-User-Id decoded from that same already-validated token (a
// convenience mirror of neighbourhoodAccess, never authoritative).
//
// Fail-closed rule (SECURITY): the journey is enabled ONLY when the backend answers, unambiguously,
// enabled === true AND the flag is not killed. OFF, killed, 401/403, timeout, a malformed payload
// and any network error ALL resolve to disabled — a blip can never leak the journey to a
// non-allowlisted player. Mirrors the dep-injected transport + token-getter shape of
// neighbourhoodAccess so the decision heart is pure and node-testable without a DOM.
import { getAuthClient, type AuthClient } from "../authClient";
import { userIdFromToken } from "../bot/ledgerSync";

export const NEW_PLAYER_JOURNEY_FLAG = "new-player-journey-v1";
export const NEW_PLAYER_JOURNEY_PATH =
  "/kooker/api/v1/citylife/players/me/feature-flags/new-player-journey-v1";

/** The bounded default before a hung network is treated as a (fail-closed) failure. */
export const DEFAULT_ENTITLEMENT_TIMEOUT_MS = 8000;

/** The raw backend body. Every field is `unknown` on purpose — the decision below trusts nothing and
 *  fails closed on anything other than an exact `enabled: true` from a non-killed flag. */
export interface JourneyFlagBody {
  enabled?: unknown;
  killed?: unknown;
  state?: unknown;
  reason?: unknown;
}

export interface JourneyEntitlement {
  /** True ONLY for an unambiguous, live, non-killed positive from the backend. Default/every-error = false. */
  enabled: boolean;
  /** A short reason, for logging/telemetry only — never a bearer of access. */
  reason?: string;
}

export type JourneyTransportResult = {
  ok: boolean;
  status: number;
  body: JourneyFlagBody | null;
};

export type JourneyTransport = (
  path: string,
  headers: Record<string, string>,
) => Promise<JourneyTransportResult>;

export interface JourneyEntitlementDeps {
  transport: JourneyTransport;
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
}

function deny(reason: string): JourneyEntitlement {
  return { enabled: false, reason };
}

/**
 * The pure decision from an already-fetched transport result. Exported so the whole OFF / killed /
 * allowlisted / non-ok matrix is unit-testable without a network. Fails closed unless the backend
 * says, unambiguously, `enabled === true` for a flag that is NOT killed.
 */
export function decideJourneyEntitlement(
  res: JourneyTransportResult,
): JourneyEntitlement {
  if (!res.ok) return deny(`Entitlement unavailable (HTTP ${res.status})`);
  const body = res.body;
  if (!body || typeof body !== "object") {
    return deny("Malformed entitlement payload");
  }
  // A kill switch ALWAYS wins, even if `enabled` somehow also reads true — killed means disabled.
  const killed =
    body.killed === true ||
    (typeof body.state === "string" && body.state.toUpperCase() === "KILLED");
  if (killed) return deny("New-player journey is killed");
  if (body.enabled === true) {
    return {
      enabled: true,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };
  }
  return deny("New-player journey is off");
}

/**
 * Evaluate the signed-in player's new-player-journey entitlement. Returns a fail-closed
 * `{ enabled: false }` when there is no token, and on every non-ok / malformed / thrown outcome.
 */
export async function evaluateJourneyEntitlement(
  deps: JourneyEntitlementDeps,
): Promise<JourneyEntitlement> {
  const token = await deps.getToken();
  if (!token) return deny("Sign in to access the new-player journey");
  const userId = deps.getUserId(token);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Token-derived only — a convenience mirror of the server-side identity, never a caller-supplied id.
  if (userId) headers["X-Kooker-User-Id"] = userId;
  try {
    const res = await deps.transport(NEW_PLAYER_JOURNEY_PATH, headers);
    return decideJourneyEntitlement(res);
  } catch (e) {
    return deny(
      e instanceof Error
        ? `Couldn't verify entitlement: ${e.message}`
        : "Couldn't verify entitlement",
    );
  }
}

/**
 * The browser default deps — GET the flag as the player through the /kooker proxy, with a bounded
 * AbortController timeout so a hung request aborts and fails closed (never leaving the gate in an
 * indeterminate, non-fail-closed limbo).
 */
export function defaultJourneyDeps(
  timeoutMs = DEFAULT_ENTITLEMENT_TIMEOUT_MS,
): JourneyEntitlementDeps {
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
        let body: JourneyFlagBody | null = null;
        try {
          body = (await resp.json()) as JourneyFlagBody;
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

/**
 * The local DEV/E2E skip-auth bypass produces a NULL operator (see authClient.canEnterCityBuilder for
 * why this is the only unauthenticated state ColonyApp can mount in, and why it can never occur on a
 * kooker.co.za production build). Exactly as City Builder does, that developer-only state is treated
 * as entitled WITHOUT a network call, so existing local/E2E showroom flows keep working while every
 * real authenticated session is still evaluated and fails closed.
 */
export function journeyEntitlementBypassed(
  auth: Pick<AuthClient, "operator">,
): boolean {
  return auth.operator === null;
}

/**
 * The single UI/runtime availability decision for every new-player-journey-only affordance and action.
 * Fails closed: while the entitlement is still loading (`null`) it is unavailable, and only an
 * unambiguous positive (or the DEV/E2E bypass) opens it. Used both to hide the entry affordance AND to
 * reject a direct/programmatic open, so the gate is never merely cosmetic UI.
 */
export function newPlayerJourneyAvailable(args: {
  bypass: boolean;
  entitlement: JourneyEntitlement | null;
}): boolean {
  if (args.bypass) return true;
  return args.entitlement?.enabled === true;
}
