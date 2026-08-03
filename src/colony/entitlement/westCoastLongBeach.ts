// Spec 169 §5.2 — the fail-closed, default-OFF gate for West Coast Long Beach (slice 1b).
//
// Everything user-facing about Long Beach mounts behind `west-coast-long-beach-v1`: the Strand Run
// entry and its scene in this slice, the mounted region later. Flag OFF, the game is byte-identical
// to a build without the branch — the founding island's physics are additionally pinned by the
// no-profile tests, so the gate is the second fence, not the only one.
//
// UNLIKE the HUD gate (hudPlayerState.ts) this one DOES carry the standard DEV/E2E bypass, and the
// difference is principled, not inconsistency: the HUD flag MOVES legacy controls that e2e locates by
// role/name, so a bypass would break e2e; this flag only ADDS a new gated affordance, exactly like
// the Gamehouse and showroom entries, which ship the same bypass and coexist with every green spec.
// The bypass is the narrow shared predicate (DEV build + local origin + explicit opt-in), never a
// mere null operator.
import { getAuthClient } from "../authClient";
import { userIdFromToken } from "../bot/ledgerSync";
import {
  isLocalDevAuthBypass,
  type DevAuthBypassProbe,
} from "../devAuthBypass";

export const LONG_BEACH_FLAG = "west-coast-long-beach-v1";
export const LONG_BEACH_FLAG_PATH =
  "/kooker/api/v1/citylife/players/me/feature-flags/west-coast-long-beach-v1";

/** The bounded default before a hung network is treated as a (fail-closed) failure. */
export const DEFAULT_LONG_BEACH_ENTITLEMENT_TIMEOUT_MS = 8000;

/** The raw backend body. Every field `unknown` on purpose — the decision trusts nothing. */
export interface LongBeachFlagBody {
  enabled?: unknown;
  killed?: unknown;
  state?: unknown;
  reason?: unknown;
}

export interface LongBeachEntitlement {
  /** True ONLY for an unambiguous, live, non-killed positive. Default and every error = false. */
  readonly enabled: boolean;
  readonly reason?: string;
}

export type LongBeachTransportResult = {
  ok: boolean;
  status: number;
  body: LongBeachFlagBody | null;
};

export type LongBeachTransport = (
  path: string,
  headers: Record<string, string>,
) => Promise<LongBeachTransportResult>;

export interface LongBeachEntitlementDeps {
  transport: LongBeachTransport;
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
}

function deny(reason: string): LongBeachEntitlement {
  return { enabled: false, reason };
}

/** The pure decision from an already-fetched result — the whole matrix is node-testable. */
export function decideLongBeachEntitlement(
  res: LongBeachTransportResult,
): LongBeachEntitlement {
  if (!res.ok) return deny(`Entitlement unavailable (HTTP ${res.status})`);
  const body = res.body;
  if (!body || typeof body !== "object")
    return deny("Malformed entitlement payload");
  // The kill switch ALWAYS wins, even if `enabled` somehow also reads true.
  const killed =
    body.killed === true ||
    (typeof body.state === "string" && body.state.toUpperCase() === "KILLED");
  if (killed) return deny("Long Beach is killed");
  if (body.enabled === true) {
    return {
      enabled: true,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };
  }
  return deny("Long Beach is off");
}

export async function evaluateLongBeachEntitlement(
  deps: LongBeachEntitlementDeps,
): Promise<LongBeachEntitlement> {
  const token = await deps.getToken();
  if (!token) return deny("Sign in to visit Long Beach");
  const userId = deps.getUserId(token);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  // Token-derived only — never a caller-supplied id.
  if (userId) headers["X-Kooker-User-Id"] = userId;
  try {
    return decideLongBeachEntitlement(
      await deps.transport(LONG_BEACH_FLAG_PATH, headers),
    );
  } catch (e) {
    return deny(
      e instanceof Error
        ? `Couldn't verify entitlement: ${e.message}`
        : "Couldn't verify entitlement",
    );
  }
}

/** The narrow DEV/E2E bypass — the shared predicate, exactly as the Gamehouse entry uses it.
 *  SECURITY: deliberately NOT derived from auth state; a null/expired operator is never a bypass. */
export function longBeachDevBypass(probe?: DevAuthBypassProbe): boolean {
  return isLocalDevAuthBypass(probe);
}

/** The single availability decision for every Long Beach affordance and action. */
export function longBeachAvailable(args: {
  bypass: boolean;
  entitlement: LongBeachEntitlement | null;
}): boolean {
  if (args.bypass) return true;
  return args.entitlement?.enabled === true;
}

/** Browser default deps — GET the flag as the player through the /kooker proxy, time-bounded. */
export function defaultLongBeachDeps(
  timeoutMs = DEFAULT_LONG_BEACH_ENTITLEMENT_TIMEOUT_MS,
): LongBeachEntitlementDeps {
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
        let body: LongBeachFlagBody | null = null;
        try {
          body = (await resp.json()) as LongBeachFlagBody;
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
