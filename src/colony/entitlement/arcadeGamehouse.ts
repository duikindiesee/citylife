// ARCADE.2A — the fail-closed, default-OFF client gate for the authenticated Gamehouse portal and its
// 3D cabinet inspection. The whole venue (its entry affordance AND the streamed interior) stays
// INVISIBLE and UNENTERABLE until BOTH are true for THIS session:
//   1. the caller is an authenticated CityLife *player* — a JWT-derived userId plus the CITYLIFE_PLAYER
//      role (a signed-out visitor, or a signed-in non-player, is never entitled); and
//   2. the server, per-user/cohort, unambiguously enables `citylife-arcade-3d-v1` for that player.
//
// This is a pure client integration of an existing server entitlement. It NEVER flips a flag, mutates a
// cohort/allowlist, moves KCO, or writes any ownership. `citylife-arcade-3d-v1` stays globally OFF; the
// only positive path is a backend that answers `enabled === true` for a non-killed flag (or the narrowly
// scoped DEV/E2E bypass — a DEV build, local origin and explicit opt-in — see arcadeGamehouseDevBypass).
//
// Truth is the authenticated, token-derived endpoint
//   GET /api/v1/citylife/players/me/feature-flags/citylife-arcade-3d-v1
// resolved server-side from the player's bearer token. We NEVER send a caller-supplied userId; the only
// identity hint is the X-Kooker-User-Id decoded from that same already-validated token (a convenience
// mirror, never authoritative). Mirrors newPlayerJourney's dep-injected transport + token-getter shape
// so the decision heart is pure and node-testable without a DOM. Fail-closed rule (SECURITY): OFF,
// killed, 401/403, timeout, a malformed payload and any network error ALL resolve to disabled — a blip
// can never leak the venue to a non-entitled player.
import { getAuthClient } from "../authClient";
import { userIdFromToken } from "../bot/ledgerSync";
import {
  isLocalDevAuthBypass,
  type DevAuthBypassProbe,
} from "../devAuthBypass";
import {
  isAuthenticatedCityLifePlayer,
  type GamehousePlayerSession,
} from "../spatial/gamehouseCabinet";

/** The per-user/cohort feature flag. It is GLOBALLY OFF by default; this slice never enables it. */
export const ARCADE_3D_FLAG = "citylife-arcade-3d-v1";
export const ARCADE_3D_FLAG_PATH =
  "/kooker/api/v1/citylife/players/me/feature-flags/citylife-arcade-3d-v1";

/** The CityLife player role a session must carry (in addition to a real userId) to be a player. */
export const CITYLIFE_PLAYER_ROLE = "CITYLIFE_PLAYER";

/** The bounded default before a hung network is treated as a (fail-closed) failure. */
export const DEFAULT_ARCADE_ENTITLEMENT_TIMEOUT_MS = 8000;

/** How often the OPEN venue re-checks the flag so a mid-session kill/OFF revokes access promptly
 *  (a bounded cadence — the venue also revalidates on entry and on tab refocus). */
export const ARCADE_ENTITLEMENT_REVALIDATE_MS = 15000;

/** The raw backend body. Every field is `unknown` on purpose — the decision below trusts nothing and
 *  fails closed on anything other than an exact `enabled: true` from a non-killed flag. */
export interface ArcadeFlagBody {
  enabled?: unknown;
  killed?: unknown;
  state?: unknown;
  reason?: unknown;
}

export interface ArcadeEntitlement {
  /** True ONLY for an unambiguous, live, non-killed positive from the backend. Default/every-error = false. */
  enabled: boolean;
  /** A short reason, for logging/telemetry only — never a bearer of access. */
  reason?: string;
}

export type ArcadeTransportResult = {
  ok: boolean;
  status: number;
  body: ArcadeFlagBody | null;
};

export type ArcadeTransport = (
  path: string,
  headers: Record<string, string>,
) => Promise<ArcadeTransportResult>;

export interface ArcadeEntitlementDeps {
  transport: ArcadeTransport;
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
}

function deny(reason: string): ArcadeEntitlement {
  return { enabled: false, reason };
}

/**
 * The pure decision from an already-fetched transport result. Exported so the whole OFF / killed /
 * enabled / non-ok matrix is unit-testable without a network. Fails closed unless the backend says,
 * unambiguously, `enabled === true` for a flag that is NOT killed.
 */
export function decideArcadeEntitlement(
  res: ArcadeTransportResult,
): ArcadeEntitlement {
  if (!res.ok) return deny(`Entitlement unavailable (HTTP ${res.status})`);
  const body = res.body;
  if (!body || typeof body !== "object") {
    return deny("Malformed entitlement payload");
  }
  // A kill switch ALWAYS wins, even if `enabled` somehow also reads true — killed means disabled.
  const killed =
    body.killed === true ||
    (typeof body.state === "string" && body.state.toUpperCase() === "KILLED");
  if (killed) return deny("Arcade 3D venue is killed");
  if (body.enabled === true) {
    return {
      enabled: true,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };
  }
  return deny("Arcade 3D venue is off");
}

/**
 * Evaluate the signed-in player's `citylife-arcade-3d-v1` entitlement. Returns a fail-closed
 * `{ enabled: false }` when there is no token, and on every non-ok / malformed / thrown outcome.
 */
export async function evaluateArcadeEntitlement(
  deps: ArcadeEntitlementDeps,
): Promise<ArcadeEntitlement> {
  const token = await deps.getToken();
  if (!token) return deny("Sign in to enter the Gamehouse");
  const userId = deps.getUserId(token);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Token-derived only — a convenience mirror of the server-side identity, never a caller-supplied id.
  if (userId) headers["X-Kooker-User-Id"] = userId;
  try {
    const res = await deps.transport(ARCADE_3D_FLAG_PATH, headers);
    return decideArcadeEntitlement(res);
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
export function defaultArcadeDeps(
  timeoutMs = DEFAULT_ARCADE_ENTITLEMENT_TIMEOUT_MS,
): ArcadeEntitlementDeps {
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
        let body: ArcadeFlagBody | null = null;
        try {
          body = (await resp.json()) as ArcadeFlagBody;
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
 * The local DEV/E2E skip-auth bypass. SECURITY: this is deliberately NOT derived from auth state. A
 * mounted app can drop to a null/expired/signed-out operator at any time, so `operator === null` is NOT
 * a safe bypass signal — keying off it could fail OPEN in production. Instead this delegates to the
 * shared `isLocalDevAuthBypass`, which is true ONLY for a DEV build, on a local origin, with an explicit
 * developer opt-in (`VITE_LOCAL_TEST` or `?skipauth=1`) — the exact same predicate AuthGate uses to
 * mount login-free. Production, expired and signed-out sessions all fail closed and are evaluated
 * normally (and fail closed again) by the entitlement path. The probe is injectable for node tests.
 */
export function arcadeGamehouseDevBypass(probe?: DevAuthBypassProbe): boolean {
  return isLocalDevAuthBypass(probe);
}

/**
 * True iff the session is an authenticated CityLife *player*: a JWT-derived userId AND the
 * CITYLIFE_PLAYER role. A signed-out visitor (null userId) and a signed-in non-player (operator/admin,
 * visitor, or any role list without CITYLIFE_PLAYER) are both rejected — the venue is for entitled
 * players only. The role match is case-insensitive; authClient already upper-cases decoded roles.
 */
export function isEntitledCityLifePlayer(
  session: GamehousePlayerSession | null | undefined,
): boolean {
  if (!isAuthenticatedCityLifePlayer(session)) return false;
  const roles = session?.roles ?? [];
  return roles.some((r) => r.toUpperCase() === CITYLIFE_PLAYER_ROLE);
}

/**
 * The single UI/runtime availability decision for every Gamehouse-venue affordance and action (the
 * entry button, the guarded open, the streamed interior, and the cabinet inspection). Fails closed:
 * while the entitlement is still loading (`null`) it is unavailable, and it opens ONLY for
 *   - the narrowly scoped DEV/E2E bypass (DEV build + local origin + explicit opt-in), OR
 *   - an authenticated CITYLIFE_PLAYER whose server flag is unambiguously enabled.
 * Used both to hide the entry affordance AND to reject a direct/programmatic open, so the gate is never
 * merely cosmetic UI. Signed-out and non-entitled sessions can never enter.
 */
export function arcadeGamehouseAvailable(args: {
  bypass: boolean;
  entitlement: ArcadeEntitlement | null;
  session: GamehousePlayerSession | null | undefined;
}): boolean {
  if (args.bypass) return true;
  if (!isEntitledCityLifePlayer(args.session)) return false;
  return args.entitlement?.enabled === true;
}
