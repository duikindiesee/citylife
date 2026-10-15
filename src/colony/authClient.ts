// CityLife operator auth — real kooker account login.
// POSTs Basic Auth credentials to the kooker auth service via the nginx proxy,
// receives a signed JWT, stores it for the session. Never logs or persists raw credentials.
//
// Security notes:
//  - credentials travel once over HTTPS to /kooker/api/auth/basic and are immediately discarded
//  - the JWT is stored in sessionStorage (cleared on tab close) with a version key
//  - the Bearer token is attached only to /kooker/ proxy calls — never to external URLs
//  - auto-login in dev reads VITE_OPERATOR_EMAIL + VITE_OPERATOR_PASSWORD from the gitignored
//    .env.local and is a no-op in production builds

export interface OperatorSession {
  token: string;
  refreshToken?: string; // kooker refresh token — used to mint a new access token before expiry
  expiresAt: number; // epoch ms
  // `id` is the display name (for the HUD); `userId` is the authenticated kooker user id decoded from
  // the JWT — the stable identity the player view keys off, so own-data / step-into can never be
  // hijacked by a colliding display name. `userId` is null only for a legacy token with no such claim.
  operator: {
    id: string;
    userId: string | null;
    scopes: string[];
    roles: string[];
  };
}

// The inactive-account sub-state behind a 403 (Spec 077). The backend now sends a machine-readable
// `code` on the 403 body so the login surface can tell these apart instead of showing one prompt:
//  - code_issued   — approved; an unlock code is outstanding → drop into the inline code prompt
//  - pending_review — signed up, still awaiting operator approval, no code yet → reassure, no prompt
//  - revoked        — access was explicitly revoked → show a contact-the-operator message, no prompt
//  - disabled       — legacy/unknown disabled (older auth service with no code) → behave as before
export type LoginAccountState =
  | "code_issued"
  | "pending_review"
  | "revoked"
  | "disabled";

// `pending: true` means the password was accepted but the account is inactive and the user can
// self-activate with an unlock code right now — the login gate drops into the inline code prompt.
// `accountState` carries the finer Spec-077 sub-state for messaging (see LoginAccountState).
export type LoginFailure = {
  ok: false;
  error: string;
  pending?: boolean;
  accountState?: LoginAccountState;
};
export type LoginResult = { ok: true } | LoginFailure;

/**
 * Map a non-OK auth response (HTTP status + parsed JSON body) to a {@link LoginResult}. Pure and
 * framework-free so the messaging logic is unit-testable without a DOM. The backend (Spec 077) sends a
 * machine-readable `code` on inactive-account 403s; we branch on it and fall back to the legacy
 * "account disabled" substring so an older auth service still drops the user into the code prompt.
 */
export function classifyLoginFailure(
  status: number,
  body: { message?: string; code?: string } | null,
): LoginFailure {
  if (status === 401) {
    return { ok: false, error: "Wrong email or password." };
  }
  if (status === 403) {
    const code = body?.code ?? "";
    const msg = body?.message ?? "";
    if (code === "ACCOUNT_REVOKED") {
      return {
        ok: false,
        accountState: "revoked",
        error: "Your access has been revoked. Contact the operator.",
      };
    }
    if (code === "ACCOUNT_PENDING_REVIEW") {
      return {
        ok: false,
        accountState: "pending_review",
        error:
          "Your request is still being reviewed — you'll be sent a code soon.",
      };
    }
    if (code === "ACCOUNT_PENDING_CODE_ISSUED") {
      return {
        ok: false,
        pending: true,
        accountState: "code_issued",
        error: "Enter the unlock code your operator sent you.",
      };
    }
    if (code === "ACCOUNT_DISABLED" || /account disabled/i.test(msg)) {
      // Legacy/unknown disabled (older auth service, or no code field) — preserve today's behaviour:
      // treat it as activatable and drop into the code prompt.
      return {
        ok: false,
        pending: true,
        accountState: "disabled",
        error:
          "Your account isn't active yet. Enter the unlock code your operator sent you.",
      };
    }
    if (/does not have access/i.test(msg)) {
      return {
        ok: false,
        error:
          "This account doesn't have CityLife access yet. Ask the operator to grant it.",
      };
    }
    // Unknown 403 (correct password, some other gate) — fail safe: a neutral message rather than
    // falsely blaming the password, and do NOT offer the code field.
    return {
      ok: false,
      error: "This account can't sign in to CityLife right now.",
    };
  }
  return { ok: false, error: `Login failed (HTTP ${status}).` };
}

// v5: captures the authenticated kooker userId on the operator so the player view is identity-keyed.
// Bumping the version means a stale v4 session is ignored on restore and the userId is re-derived on
// the next login (the JWT carries it), rather than silently leaving an operator with userId=null.
const STORAGE_KEY = "citylife.session.v5";
const SESSION_MS = 1000 * 60 * 60 * 8; // 8 h fallback if JWT has no exp
const KOOKER_AUTH_PATH = "/kooker/api/auth/basic";
export const KOOKER_REFRESH_PATH = "/kooker/api/auth/refresh";
export const KOOKER_COOKIE_PATH = "/api/v1/citylife/auth/cookie";
export const KOOKER_COOKIE_ALIAS_PATH = "/kooker/api/v1/citylife/auth/cookie";
export const KOOKER_CLEAR_PATH = "/api/v1/citylife/auth/clear";
export const KOOKER_CLEAR_ALIAS_PATH = "/kooker/api/v1/citylife/auth/clear";
const APP_NAME = "citylife";
const SCOPES = [
  "newcomer:create",
  "newcomer:read",
  "chat:read",
  "migration:decide",
  "simulation:mutate",
];
// Renew the access token this long before it actually expires, so an in-flight inference call
// (which can take seconds) never races the expiry boundary.
const REFRESH_SKEW_MS = 60_000;

/** The base64 Basic Auth header value sent once to the backend. Never logged or persisted. */
export function basicAuth(username: string, password: string): string {
  return "Basic " + btoa(`${username}:${password}`);
}

/** Decode the exp claim from a JWT without verifying the signature (verification is server-side). */
function jwtExpiresAt(token: string): number {
  try {
    const b64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return 0;
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
    return typeof payload["exp"] === "number"
      ? (payload["exp"] as number) * 1000
      : 0;
  } catch {
    return 0;
  }
}

/** Decode the role names from a JWT without verifying the signature (verification is server-side). Reads
 *  the usual claim shapes — roles / role / authorities — as a comma list or array, upper-cased. */
function jwtRoles(token: string): string[] {
  try {
    const b64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return [];
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
    const raw = payload["roles"] ?? payload["role"] ?? payload["authorities"];
    const list = Array.isArray(raw)
      ? raw.map(String)
      : typeof raw === "string"
        ? raw.split(/[,\s]+/)
        : [];
    return list.map((r) => r.trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Decode the kooker userId claim from a JWT WITHOUT verifying the signature (verification is the
 *  gateway's job; this only reads who the already-validated token belongs to). Reads the usual claim
 *  shapes — userId / userid / sub — and mirrors bot/ledgerSync.userIdFromToken, including the
 *  base64url padding atob needs. Returns null when no such claim is present. */
function jwtUserId(token: string): string | null {
  try {
    const b64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return null;
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const id = payload["userId"] ?? payload["userid"] ?? payload["sub"];
    return id == null ? null : String(id);
  } catch {
    return null;
  }
}

function envVar(name: string): string | undefined {
  try {
    return (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env?.[name];
  } catch {
    return undefined;
  }
}

function isDevBuild(): boolean {
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
  } catch {
    return false;
  }
}

/** Process-wide AuthClient shared by the login gate and the bot inference adapter, so the player's
 *  session JWT (and its refresh) is the single source of truth for who is calling kooker inference. */
let sharedAuth: AuthClient | null = null;
const activeAuthClients = new Set<AuthClient>();

let globalActiveIssueController: AbortController | null = null;
let globalActiveClearController: AbortController | null = null;
let globalCookieOpChain: Promise<any> = Promise.resolve();

export function getAuthClient(opts?: { now?: () => number }): AuthClient {
  if (!sharedAuth) sharedAuth = new AuthClient(opts);
  return sharedAuth;
}

export function resetSharedAuthClient(): void {
  if (sharedAuth) {
    sharedAuth.invalidateInstance();
    activeAuthClients.delete(sharedAuth);
    sharedAuth = null;
  }
}

export class AuthClient {
  private session: OperatorSession | null = null;
  private readonly now: () => number;
  private refreshInFlight: Promise<string | null> | null = null;
  private sessionGeneration = 0;
  private activeIssueController: AbortController | null = null;
  private activeClearController: AbortController | null = null;
  private cookieOpChain: Promise<any> = Promise.resolve();

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
    activeAuthClients.add(this);
    this.restore();
  }

  dispose(): void {
    activeAuthClients.delete(this);
  }

  /** Synchronously clear this instance's session, increment generation, abort active issue, and cancel in-flight refresh. */
  invalidateInstance(): void {
    this.session = null;
    this.sessionGeneration++;
    this.refreshInFlight = null;
    if (this.activeIssueController) {
      this.activeIssueController.abort();
      this.activeIssueController = null;
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no storage */
    }
  }

  get isAuthenticated(): boolean {
    if (!this.session) return false;
    // A live access token, OR an expired one we can still renew with a refresh token.
    return this.session.expiresAt > this.now() || !!this.session.refreshToken;
  }
  get operator(): OperatorSession["operator"] | null {
    return this.isAuthenticated ? this.session!.operator : null;
  }

  /** Whether the signed-in user runs the RESTRICTED player view — own data only, and may step into
   *  their OWN avatar only. SECURITY: this FAILS CLOSED. Only an operator/admin role gets the full
   *  whole-colony view (and step-into-anyone); EVERY other signed-in user — CITYLIFE_PLAYER,
   *  CITYLIFE_VISITOR, a plain KOOKER_USER, or any newcomer role — is restricted. A non-operator must
   *  never fall through to the operator view (an activated visitor was previously loaded as admin). */
  get isCityLifePlayer(): boolean {
    const roles = this.operator?.roles ?? [];
    const OPERATOR_ROLES = ["ADMIN", "KOOKER_ADMIN", "CITYLIFE_ADMIN"];
    return !OPERATOR_ROLES.some((r) => roles.includes(r));
  }

  get isCityLifeAdmin(): boolean {
    const roles = this.operator?.roles ?? [];
    return (
      roles.includes("ADMIN") ||
      roles.includes("KOOKER_ADMIN") ||
      roles.includes("CITYLIFE_ADMIN")
    );
  }

  get isCityLifeModerator(): boolean {
    const roles = this.operator?.roles ?? [];
    return roles.includes("CITYLIFE_MODERATOR") || this.isCityLifeAdmin;
  }

  /** Sign in with a kooker account. Async — POSTs to the kooker auth service. */
  async login(email: string, password: string): Promise<LoginResult> {
    const id = email.trim().toLowerCase();
    if (!id) return { ok: false, error: "Enter your kooker email." };
    if (!password) return { ok: false, error: "Enter your password." };
    try {
      const resp = await fetch(KOOKER_AUTH_PATH, {
        method: "POST",
        headers: {
          Authorization: basicAuth(id, password),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appName: APP_NAME }),
      });
      if (!resp.ok) {
        // The password was accepted (verifyPin runs before these gates) when we reach a 403; the body
        // carries WHICH gate rejected. Parse it once and let the pure classifier do the messaging.
        let body: { message?: string; code?: string } | null = null;
        try {
          body = (await resp.json()) as { message?: string; code?: string };
        } catch {
          /* no JSON body */
        }
        return classifyLoginFailure(resp.status, body);
      }
      const data = (await resp.json()) as {
        accessToken?: string;
        refreshToken?: string;
        accessExpiresIn?: number;
        user?: { email?: string; name?: string };
      };
      const token = data.accessToken;
      if (!token) return { ok: false, error: "No token in auth response." };
      const expFromJwt = jwtExpiresAt(token);
      const expiresAt = expFromJwt > 0 ? expFromJwt : this.now() + SESSION_MS;
      const displayName = data.user?.name || data.user?.email || id;
      this.sessionGeneration++;
      if (this.activeClearController) {
        this.activeClearController.abort();
        this.activeClearController = null;
      }
      if (globalActiveClearController) {
        globalActiveClearController.abort();
        globalActiveClearController = null;
      }
      if (this.activeIssueController) {
        this.activeIssueController.abort();
        this.activeIssueController = null;
      }
      this.refreshInFlight = null;
      this.session = {
        token,
        refreshToken: data.refreshToken,
        expiresAt,
        operator: {
          id: displayName,
          userId: jwtUserId(token),
          scopes: SCOPES,
          roles: jwtRoles(token),
        },
      };
      this.persist();

      // Synchronize/invalidate other active instances so they reflect the new session and abort stale refreshes
      for (const client of activeAuthClients) {
        if (client !== this) {
          client.sessionGeneration++;
          client.refreshInFlight = null;
          if (client.activeIssueController) {
            client.activeIssueController.abort();
            client.activeIssueController = null;
          }
          client.session = this.session;
        }
      }

      try {
        await this.issueCookieSession(token);
      } catch {
        /* best-effort in tests/offline */
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? e.message
            : "Network error — is the gateway reachable?",
      };
    }
  }

  /** Dev-only convenience: if VITE_OPERATOR_EMAIL and VITE_OPERATOR_PASSWORD are set in the
   *  gitignored .env.local, authenticate automatically so the login gate never blocks local runs.
   *  No-op (resolves false) in a production bundle or if either var is absent. */
  async tryAutoLogin(): Promise<boolean> {
    if (this.isAuthenticated) return true;
    if (!isDevBuild()) return false;
    // Accept either naming: main's login uses EMAIL/PASSWORD; the homesteads line's dev gate used
    // NAME/PASSCODE. Bridge both so a local .env.local from either lineage auto-logs in.
    const email = envVar("VITE_OPERATOR_EMAIL") ?? envVar("VITE_OPERATOR_NAME");
    const password =
      envVar("VITE_OPERATOR_PASSWORD") ?? envVar("VITE_OPERATOR_PASSCODE");
    if (!email || !password) return false;
    const r = await this.login(email, password);
    return r.ok;
  }

  async logout(): Promise<boolean> {
    this.invalidateInstance();
    // Coordinate process-wide invalidation across all active AuthClient instances
    for (const client of activeAuthClients) {
      if (client !== this) {
        client.invalidateInstance();
      }
    }
    if (globalActiveIssueController) {
      globalActiveIssueController.abort();
      globalActiveIssueController = null;
    }
    return this.clearCookieSession();
  }

  /**
   * Request host-only HttpOnly session cookies from the CityLife BFF endpoint.
   * Sends caller's verified Auth Bearer with credentials: "same-origin".
   * Tries direct path first, falling back to /kooker alias if direct returns 404.
   * Serializes behind in-flight cookie operations and aborts if session is invalidated.
   */
  async issueCookieSession(token?: string): Promise<boolean> {
    const bearer = token ?? (await this.getValidToken());
    if (!bearer) return false;

    const opGen = this.sessionGeneration;

    const run = async (): Promise<boolean> => {
      if (this.sessionGeneration !== opGen) {
        return false;
      }

      if (this.activeClearController) {
        this.activeClearController.abort();
        this.activeClearController = null;
      }
      if (globalActiveClearController) {
        globalActiveClearController.abort();
        globalActiveClearController = null;
      }

      if (this.activeIssueController) {
        this.activeIssueController.abort();
        this.activeIssueController = null;
      }

      const controller = new AbortController();
      this.activeIssueController = controller;
      globalActiveIssueController = controller;

      try {
        const paths = [KOOKER_COOKIE_PATH, KOOKER_COOKIE_ALIAS_PATH];
        for (const path of paths) {
          if (controller.signal.aborted || this.sessionGeneration !== opGen) {
            return false;
          }
          try {
            const resp = await fetch(path, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${bearer}`,
              },
              credentials: "same-origin",
              signal: controller.signal,
            });
            if (controller.signal.aborted || this.sessionGeneration !== opGen) {
              return false;
            }
            if (resp.ok) return true;
            if (resp.status !== 404) return false;
          } catch (err: any) {
            if (err?.name === "AbortError" || controller.signal.aborted) {
              return false;
            }
            // Network error, try next path or return false
          }
        }
        return false;
      } finally {
        if (this.activeIssueController === controller) {
          this.activeIssueController = null;
        }
        if (globalActiveIssueController === controller) {
          globalActiveIssueController = null;
        }
      }
    };

    const nextOp = Promise.all([this.cookieOpChain, globalCookieOpChain])
      .catch(() => {})
      .then(run);
    this.cookieOpChain = nextOp;
    globalCookieOpChain = nextOp;
    return nextOp;
  }

  /**
   * Request removal of host-only HttpOnly session cookies via the CityLife BFF clear endpoint.
   * Calls with credentials: "same-origin".
   * Tries direct path first, falling back to /kooker alias if direct returns 404.
   * Serializes behind in-flight cookie operations, bounds execution with a timeout,
   * and aborts if superseded by a new session.
   */
  async clearCookieSession(): Promise<boolean> {
    this.sessionGeneration++;
    const opGen = this.sessionGeneration;
    if (this.activeIssueController) {
      this.activeIssueController.abort();
      this.activeIssueController = null;
    }
    if (globalActiveIssueController) {
      globalActiveIssueController.abort();
      globalActiveIssueController = null;
    }

    const run = async (): Promise<boolean> => {
      if (this.sessionGeneration !== opGen) {
        return false;
      }

      if (this.activeClearController) {
        this.activeClearController.abort();
        this.activeClearController = null;
      }

      const controller = new AbortController();
      this.activeClearController = controller;
      globalActiveClearController = controller;

      // Bound actual clear settlement/abort through supported lifecycle
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 5000);

      try {
        const paths = [KOOKER_CLEAR_PATH, KOOKER_CLEAR_ALIAS_PATH];
        for (const path of paths) {
          if (controller.signal.aborted || this.sessionGeneration !== opGen) {
            return false;
          }
          try {
            const resp = await fetch(path, {
              method: "POST",
              credentials: "same-origin",
              signal: controller.signal,
            });
            if (controller.signal.aborted || this.sessionGeneration !== opGen) {
              return false;
            }
            if (resp.ok) return true;
            if (resp.status !== 404) return false;
          } catch (err: any) {
            if (err?.name === "AbortError" || controller.signal.aborted) {
              return false;
            }
            // Network error, try next path
          }
        }
        return false;
      } finally {
        clearTimeout(timeoutId);
        if (this.activeClearController === controller) {
          this.activeClearController = null;
        }
        if (globalActiveClearController === controller) {
          globalActiveClearController = null;
        }
      }
    };

    const nextOp = Promise.all([this.cookieOpChain, globalCookieOpChain])
      .catch(() => {})
      .then(run);
    this.cookieOpChain = nextOp;
    globalCookieOpChain = nextOp;
    return nextOp;
  }

  /** Bearer header for backend calls — empty object when not authenticated (calls fail closed).
   *  Synchronous + best-effort: use getValidToken() for the refresh-aware path on long-lived calls. */
  authHeader(): Record<string, string> {
    return this.isAuthenticated
      ? { Authorization: `Bearer ${this.session!.token}` }
      : {};
  }

  /** Return a currently-valid access token, renewing it via the refresh token when it is expired or
   *  within REFRESH_SKEW_MS of expiry. Returns null when there is no session or the refresh fails
   *  (the caller then surfaces a re-login). Concurrent callers share a single in-flight refresh. */
  async getValidToken(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expiresAt - this.now() > REFRESH_SKEW_MS) return s.token;
    if (!s.refreshToken) {
      // No refresh token (e.g. a legacy session) — fail closed once expired.
      return s.expiresAt > this.now() ? s.token : null;
    }
    return this.refresh();
  }

  /** Exchange the refresh token for a fresh access token. Dedupes concurrent calls. */
  private refresh(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const initiatingSession = this.session;
    if (!initiatingSession) return Promise.resolve(null);
    const initiatingRefreshToken = initiatingSession.refreshToken;
    if (!initiatingRefreshToken) return Promise.resolve(null);

    const initiatingGen = this.sessionGeneration;
    const initiatingToken = initiatingSession.token;
    const initiatingUserId = initiatingSession.operator.userId;
    const initiatingOperatorId = initiatingSession.operator.id;

    const isInitiatingCurrent = (): boolean => {
      if (this.sessionGeneration !== initiatingGen) return false;
      if (!this.session) return false;
      if (this.session.token !== initiatingToken) return false;
      if (this.session.refreshToken !== initiatingRefreshToken) return false;
      if (this.session.operator.userId !== initiatingUserId) return false;
      if (this.session.operator.id !== initiatingOperatorId) return false;
      return true;
    };

    this.refreshInFlight = (async () => {
      try {
        const resp = await fetch(KOOKER_REFRESH_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: initiatingRefreshToken }),
        });

        // Fence 1: Post-fetch await
        if (!isInitiatingCurrent()) {
          return null;
        }

        if (!resp.ok) {
          // Refresh token expired/revoked — clear the session so the gate shows login again,
          // strictly fenced so a stale 401/403 failure cannot log out a newer session or B login.
          if (resp.status === 401 || resp.status === 403) {
            if (isInitiatingCurrent()) {
              await this.logout();
            }
          }
          return null;
        }

        const data = (await resp.json()) as {
          accessToken?: string;
          refreshToken?: string;
        };

        // Fence 2: Post-json await
        if (!isInitiatingCurrent() || !data.accessToken) {
          return null;
        }

        const expFromJwt = jwtExpiresAt(data.accessToken);
        if (!isInitiatingCurrent()) return null;

        this.session = {
          ...this.session!,
          token: data.accessToken,
          refreshToken: data.refreshToken ?? this.session!.refreshToken,
          expiresAt: expFromJwt > 0 ? expFromJwt : this.now() + SESSION_MS,
        };
        this.persist();

        // Synchronize refreshed session across active instances so they stay consistent
        for (const client of activeAuthClients) {
          if (client !== this) {
            client.sessionGeneration++;
            client.refreshInFlight = null;
            if (client.activeIssueController) {
              client.activeIssueController.abort();
              client.activeIssueController = null;
            }
            client.session = this.session;
          }
        }

        const isUpdatedCurrent = (): boolean => {
          if (this.sessionGeneration !== initiatingGen) return false;
          if (!this.session) return false;
          if (this.session.token !== data.accessToken) return false;
          if (this.session.operator.userId !== initiatingUserId) return false;
          if (this.session.operator.id !== initiatingOperatorId) return false;
          return true;
        };

        // Fence 3: Post-refresh cookie issuance
        try {
          if (isUpdatedCurrent()) {
            await this.issueCookieSession(data.accessToken);
          }
        } catch {
          /* best-effort in tests/offline */
        }

        return isUpdatedCurrent() ? data.accessToken : null;
      } catch {
        return null;
      } finally {
        if (this.sessionGeneration === initiatingGen) {
          this.refreshInFlight = null;
        }
      }
    })();
    return this.refreshInFlight;
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    } catch {
      /* no storage */
    }
  }
  private restore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as OperatorSession;
      // Keep a restored session if the access token is still valid OR it carries a refresh token
      // (getValidToken will renew it on the next call).
      if (s && (s.expiresAt > this.now() || s.refreshToken)) this.session = s;
    } catch {
      /* no storage / bad data */
    }
  }
}

/**
 * Whether a session may enter City Builder mode: an operator/admin role, OR a null `operator` —
 * the one state AuthGate's own strictly-scoped local DEV/E2E skip-auth bypass produces (a DEV
 * build, served from localhost/LAN, with the explicit `VITE_LOCAL_TEST` or `?skipauth=1` opt-in).
 * ColonyApp is mounted ONLY inside `<AuthGate>`, which never renders it unauthenticated on any
 * other path, so a null operator can never occur on a kooker.co.za production build — this keeps
 * existing local/E2E builder workflows (which never log in) working without widening production
 * access. SECURITY: fails closed for every authenticated non-operator role, including
 * CITYLIFE_PLAYER, CITYLIFE_VISITOR, a plain KOOKER_USER, and any empty/unknown role list.
 *
 * Exported standalone (rather than only as the `AuthClient.canEnterCityBuilder` getter) so callers
 * can unit-test the decision against a plain `{ isCityLifeAdmin, operator }` shape without needing
 * a real login round trip.
 */
export function canEnterCityBuilder(
  auth: Pick<AuthClient, "isCityLifeAdmin" | "operator">,
): boolean {
  return auth.isCityLifeAdmin || auth.operator === null;
}
