// UI.STATE.1 slice 1 — the fail-closed, default-OFF gate for the player-state HUD (spec 170).
//
// The restructured topbar ships behind `hud-player-state-v1` so the operator can UAT it on their own
// allowlisted account before anyone else sees it, exactly like every other gated feature. Flag OFF
// renders today's topbar byte-identically — that is spec 170's first acceptance criterion, and the
// tests in tests/topbarPlan.test.ts hold the OFF branch to it control by control.
//
// DELIBERATE DEVIATION FROM THE kookerHq/newPlayerJourney PATTERN: there is NO dev/e2e bypass here.
//
// Those gates treat the skip-auth session (`auth.operator === null`) as entitled, so local dev can see
// gated features without a backend. This gate must not, and the reason is measured, not stylistic:
// the e2e suite runs under that same skip-auth bypass, and e2e/passwordActivation.spec.ts clicks the
// topbar "Change password" button by role and name — a control this flag MOVES into the ☰ menu. A
// bypass would flip every e2e run onto the new HUD and break specs that locate legacy controls, while
// the acceptance criterion says flag OFF keeps e2e green on the legacy HUD. Entitlement-only means
// e2e (no gateway, fetch fails, fail-closed OFF) deterministically exercises the legacy branch, and
// the operator turns the new HUD on server-side for their own account — the same allowlist flow they
// already use for new-player-journey.
//
// Fail-closed rule (unchanged from the pattern): enabled ONLY on an unambiguous, live, non-killed
// `enabled === true`. OFF, killed, 401/403, timeout, malformed payload and any network error all
// resolve to disabled, and the kill switch wins even if `enabled` somehow also reads true.
import { getAuthClient } from "../authClient";
import { userIdFromToken } from "../bot/ledgerSync";

export const HUD_PLAYER_STATE_FLAG = "hud-player-state-v1";
export const HUD_PLAYER_STATE_FLAG_PATH =
  "/kooker/api/v1/citylife/players/me/feature-flags/hud-player-state-v1";

/** The bounded default before a hung network is treated as a (fail-closed) failure. */
export const DEFAULT_HUD_ENTITLEMENT_TIMEOUT_MS = 8000;

/** The raw backend body. Every field is `unknown` on purpose — the decision trusts nothing. */
export interface HudFlagBody {
  enabled?: unknown;
  killed?: unknown;
  state?: unknown;
  reason?: unknown;
}

export interface HudEntitlement {
  /** True ONLY for an unambiguous, live, non-killed positive. Default and every error = false. */
  readonly enabled: boolean;
  /** A short reason, for logging only. Never a bearer of access. */
  readonly reason?: string;
}

export type HudTransportResult = {
  ok: boolean;
  status: number;
  body: HudFlagBody | null;
};

export type HudTransport = (
  path: string,
  headers: Record<string, string>,
) => Promise<HudTransportResult>;

export interface HudEntitlementDeps {
  transport: HudTransport;
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
}

function deny(reason: string): HudEntitlement {
  return { enabled: false, reason };
}

/** The pure decision from an already-fetched transport result. Exported so the whole
 *  OFF / killed / enabled / non-ok matrix is unit-testable without a network. */
export function decideHudEntitlement(res: HudTransportResult): HudEntitlement {
  if (!res.ok) return deny(`Entitlement unavailable (HTTP ${res.status})`);
  const body = res.body;
  if (!body || typeof body !== "object")
    return deny("Malformed entitlement payload");
  // A kill switch ALWAYS wins, even if `enabled` somehow also reads true — killed means disabled.
  const killed =
    body.killed === true ||
    (typeof body.state === "string" && body.state.toUpperCase() === "KILLED");
  if (killed) return deny("Player-state HUD is killed");
  if (body.enabled === true) {
    return {
      enabled: true,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };
  }
  return deny("Player-state HUD is off");
}

/** Evaluate the signed-in player's `hud-player-state-v1` entitlement. Fail-closed on no token and on
 *  every non-ok / malformed / thrown outcome. */
export async function evaluateHudEntitlement(
  deps: HudEntitlementDeps,
): Promise<HudEntitlement> {
  const token = await deps.getToken();
  if (!token) return deny("Signed out");
  const userId = deps.getUserId(token);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Token-derived only — a convenience mirror of the server-side identity, never caller-supplied.
  if (userId) headers["X-Kooker-User-Id"] = userId;
  try {
    return decideHudEntitlement(
      await deps.transport(HUD_PLAYER_STATE_FLAG_PATH, headers),
    );
  } catch (e) {
    return deny(
      e instanceof Error
        ? `Couldn't verify entitlement: ${e.message}`
        : "Couldn't verify entitlement",
    );
  }
}

/**
 * The single availability decision. NO bypass parameter, on purpose — see the header. A null
 * (still-loading) entitlement is unavailable, so the legacy topbar renders during the fetch and the
 * new one only after an unambiguous yes; the swap is one-way per session in practice because the
 * entitlement is evaluated once per identity.
 */
export function hudPlayerStateAvailable(args: {
  entitlement: HudEntitlement | null;
}): boolean {
  return args.entitlement?.enabled === true;
}

/** The browser default deps — GET the flag as the player through the /kooker proxy, time-bounded. */
export function defaultHudDeps(
  timeoutMs = DEFAULT_HUD_ENTITLEMENT_TIMEOUT_MS,
): HudEntitlementDeps {
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
        let body: HudFlagBody | null = null;
        try {
          body = (await resp.json()) as HudFlagBody;
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
