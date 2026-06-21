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
  operator: { id: string; scopes: string[]; roles: string[] };
}

export type LoginResult = { ok: true } | { ok: false; error: string };

const STORAGE_KEY = "citylife.session.v4"; // v4: captures the user's roles (for player-view gating)
const SESSION_MS = 1000 * 60 * 60 * 8; // 8 h fallback if JWT has no exp
const KOOKER_AUTH_PATH = "/kooker/api/auth/basic";
const KOOKER_REFRESH_PATH = "/kooker/api/auth/refresh";
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
export function getAuthClient(): AuthClient {
  if (!sharedAuth) sharedAuth = new AuthClient();
  return sharedAuth;
}

export class AuthClient {
  private session: OperatorSession | null = null;
  private readonly now: () => number;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
    this.restore();
  }

  get isAuthenticated(): boolean {
    if (!this.session) return false;
    // A live access token, OR an expired one we can still renew with a refresh token.
    return this.session.expiresAt > this.now() || !!this.session.refreshToken;
  }
  get operator(): OperatorSession["operator"] | null {
    return this.isAuthenticated ? this.session!.operator : null;
  }

  /** True when the signed-in user is a CITYLIFE_PLAYER and NOT an operator/admin — the colony then runs
   *  the restricted player view (own data only). Admins/operators keep the full whole-colony view. */
  get isCityLifePlayer(): boolean {
    const roles = this.operator?.roles ?? [];
    if (roles.includes("ADMIN") || roles.includes("KOOKER_ADMIN")) return false;
    return roles.includes("CITYLIFE_PLAYER");
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
        if (resp.status === 401 || resp.status === 403) {
          return { ok: false, error: "Wrong email or password." };
        }
        return { ok: false, error: `Login failed (HTTP ${resp.status}).` };
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
      this.session = {
        token,
        refreshToken: data.refreshToken,
        expiresAt,
        operator: { id: displayName, scopes: SCOPES, roles: jwtRoles(token) },
      };
      this.persist();
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

  logout(): void {
    this.session = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no storage */
    }
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
    const refreshToken = this.session?.refreshToken;
    if (!refreshToken) return Promise.resolve(null);
    this.refreshInFlight = (async () => {
      try {
        const resp = await fetch(KOOKER_REFRESH_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!resp.ok) {
          // Refresh token expired/revoked — clear the session so the gate shows login again.
          if (resp.status === 401 || resp.status === 403) this.logout();
          return null;
        }
        const data = (await resp.json()) as {
          accessToken?: string;
          refreshToken?: string;
        };
        if (!data.accessToken || !this.session) return null;
        const expFromJwt = jwtExpiresAt(data.accessToken);
        this.session = {
          ...this.session,
          token: data.accessToken,
          refreshToken: data.refreshToken ?? this.session.refreshToken,
          expiresAt: expFromJwt > 0 ? expFromJwt : this.now() + SESSION_MS,
        };
        this.persist();
        return data.accessToken;
      } catch {
        return null;
      } finally {
        this.refreshInFlight = null;
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
