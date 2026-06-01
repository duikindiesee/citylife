// CityLife operator auth (plan Slice 2 / issue #7). A login gate so nobody reaches Border Control
// or any backend API unauthenticated. The client builds a Basic Auth login request and holds a
// short-lived session, attaching a Bearer token to backend calls. It never logs credentials/tokens.
//
// Security note: there is no citylife-backend yet, so dev uses a SOFT local gate — a passcode read
// from a gitignored env var (VITE_OPERATOR_PASSCODE) that mints a short-lived dev token. This is NOT
// a real security boundary (the token is unsigned and the check is client-side); the real gate is
// the backend issuing a signed JWT at POST /api/auth/login (issue #7). The client is written so
// swapping the local check for that endpoint is a small, isolated change.

export interface OperatorSession {
  token: string
  expiresAt: number // epoch ms
  operator: { id: string; scopes: string[] }
}

export type LoginResult = { ok: true } | { ok: false; error: string }

const STORAGE_KEY = 'citylife.session.v1'
const SESSION_MS = 1000 * 60 * 60 * 8 // 8 hours
const SCOPES = ['newcomer:create', 'newcomer:read', 'chat:read', 'migration:decide', 'simulation:mutate']

/** The base64 Basic Auth header value the real backend login will use. Never logged or persisted. */
export function basicAuth(username: string, password: string): string {
  return 'Basic ' + btoa(`${username}:${password}`)
}

function envPasscode(): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_OPERATOR_PASSCODE
  } catch {
    return undefined
  }
}

function envOperatorName(): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_OPERATOR_NAME
  } catch {
    return undefined
  }
}

/** True only under a Vite dev server — auto-login is never available in a production bundle. */
function isDevBuild(): boolean {
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
  } catch {
    return false
  }
}

export class AuthClient {
  private session: OperatorSession | null = null
  private readonly expected: string | undefined
  private readonly now: () => number

  constructor(opts?: { expectedPasscode?: string; now?: () => number }) {
    this.expected = opts?.expectedPasscode ?? envPasscode()
    this.now = opts?.now ?? (() => Date.now())
    this.restore()
  }

  get isAuthenticated(): boolean {
    return this.session !== null && this.session.expiresAt > this.now()
  }
  get operator(): OperatorSession['operator'] | null {
    return this.isAuthenticated ? this.session!.operator : null
  }
  /** Whether a passcode is configured at all (false => dev needs VITE_OPERATOR_PASSCODE). */
  get configured(): boolean {
    return !!this.expected
  }

  /** Attempt login. Dev validates a passcode locally; the real path will POST Basic Auth to the backend. */
  login(operatorName: string, passcode: string): LoginResult {
    const id = operatorName.trim()
    if (!id) return { ok: false, error: 'Enter an operator name.' }
    // Build the header the real backend call will use — locally, never logged or stored.
    void basicAuth(id, passcode)
    if (!this.expected) return { ok: false, error: 'No operator passcode configured. Set VITE_OPERATOR_PASSCODE in .env.local.' }
    if (passcode !== this.expected) return { ok: false, error: 'Wrong passcode.' }
    const expiresAt = this.now() + SESSION_MS
    this.session = { token: this.mintDevToken(id, expiresAt), expiresAt, operator: { id, scopes: SCOPES } }
    this.persist()
    return { ok: true }
  }

  /** Dev-only convenience for the local test run: if VITE_OPERATOR_NAME and VITE_OPERATOR_PASSCODE are
   *  both set in the gitignored .env.local, authenticate automatically so the operator gate never
   *  blocks local testing. No-op (returns false) in a production build or if either var is missing. */
  tryAutoLogin(): boolean {
    if (this.isAuthenticated) return true
    if (!isDevBuild()) return false
    const name = envOperatorName()
    if (!name || !this.expected) return false
    return this.login(name, this.expected).ok
  }

  logout(): void {
    this.session = null
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* no storage */
    }
  }

  /** Bearer header for backend calls — empty when not authenticated, so calls fail closed. */
  authHeader(): Record<string, string> {
    return this.isAuthenticated ? { Authorization: `Bearer ${this.session!.token}` } : {}
  }

  private mintDevToken(sub: string, exp: number): string {
    // a clearly-non-secret dev token (prefixed, base64 JSON) — NOT a signed JWT
    return 'dev.' + btoa(JSON.stringify({ sub, exp }))
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
