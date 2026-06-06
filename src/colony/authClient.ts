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
  token: string
  expiresAt: number // epoch ms
  operator: { id: string; scopes: string[] }
}

export type LoginResult = { ok: true } | { ok: false; error: string }

const STORAGE_KEY = 'citylife.session.v2' // v2: real kooker JWT (not the old unsigned dev token)
const SESSION_MS = 1000 * 60 * 60 * 8 // 8 h fallback if JWT has no exp
const KOOKER_AUTH_PATH = '/kooker/api/auth/basic'
const APP_NAME = 'citylife'
const SCOPES = ['newcomer:create', 'newcomer:read', 'chat:read', 'migration:decide', 'simulation:mutate']

/** The base64 Basic Auth header value sent once to the backend. Never logged or persisted. */
export function basicAuth(username: string, password: string): string {
  return 'Basic ' + btoa(`${username}:${password}`)
}

/** Decode the exp claim from a JWT without verifying the signature (verification is server-side). */
function jwtExpiresAt(token: string): number {
  try {
    const b64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/')
    if (!b64) return 0
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>
    return typeof payload['exp'] === 'number' ? (payload['exp'] as number) * 1000 : 0
  } catch {
    return 0
  }
}

function envVar(name: string): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
  } catch {
    return undefined
  }
}

function isDevBuild(): boolean {
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
  } catch {
    return false
  }
}

export class AuthClient {
  private session: OperatorSession | null = null
  private readonly now: () => number

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now())
    this.restore()
  }

  get isAuthenticated(): boolean {
    return this.session !== null && this.session.expiresAt > this.now()
  }
  get operator(): OperatorSession['operator'] | null {
    return this.isAuthenticated ? this.session!.operator : null
  }

  /** Sign in with a kooker account. Async — POSTs to the kooker auth service. */
  async login(email: string, password: string): Promise<LoginResult> {
    const id = email.trim().toLowerCase()
    if (!id) return { ok: false, error: 'Enter your kooker email.' }
    if (!password) return { ok: false, error: 'Enter your password.' }
    try {
      const resp = await fetch(KOOKER_AUTH_PATH, {
        method: 'POST',
        headers: {
          Authorization: basicAuth(id, password),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ appName: APP_NAME }),
      })
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          return { ok: false, error: 'Wrong email or password.' }
        }
        return { ok: false, error: `Login failed (HTTP ${resp.status}).` }
      }
      const data = (await resp.json()) as {
        accessToken?: string
        accessExpiresIn?: number
        user?: { email?: string; name?: string }
      }
      const token = data.accessToken
      if (!token) return { ok: false, error: 'No token in auth response.' }
      const expFromJwt = jwtExpiresAt(token)
      const expiresAt = expFromJwt > 0 ? expFromJwt : this.now() + SESSION_MS
      const displayName = data.user?.name || data.user?.email || id
      this.session = { token, expiresAt, operator: { id: displayName, scopes: SCOPES } }
      this.persist()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error — is the gateway reachable?' }
    }
  }

  /** Dev-only convenience: if VITE_OPERATOR_EMAIL and VITE_OPERATOR_PASSWORD are set in the
   *  gitignored .env.local, authenticate automatically so the login gate never blocks local runs.
   *  No-op (resolves false) in a production bundle or if either var is absent. */
  async tryAutoLogin(): Promise<boolean> {
    if (this.isAuthenticated) return true
    if (!isDevBuild()) return false
    const email = envVar('VITE_OPERATOR_EMAIL')
    const password = envVar('VITE_OPERATOR_PASSWORD')
    if (!email || !password) return false
    const r = await this.login(email, password)
    return r.ok
  }

  logout(): void {
    this.session = null
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* no storage */
    }
  }

  /** Bearer header for backend calls — empty string when not authenticated (calls fail closed). */
  authHeader(): Record<string, string> {
    return this.isAuthenticated ? { Authorization: `Bearer ${this.session!.token}` } : {}
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.session))
    } catch {
      /* no storage */
    }
  }
  private restore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const s = JSON.parse(raw) as OperatorSession
      if (s && s.expiresAt > this.now()) this.session = s
    } catch {
      /* no storage / bad data */
    }
  }
}
