import { describe, it, expect, vi, afterEach } from 'vitest'
import { AuthClient, basicAuth } from '../src/colony/authClient'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal JWT (unsigned — only the payload matters for client-side exp parsing). */
function fakeJwt(expEpochMs: number, email = 'mayor@test.com'): string {
  const payload = btoa(JSON.stringify({ sub: email, exp: Math.floor(expEpochMs / 1000) }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `eyJhbGciOiJub25lIn0.${payload}.sig`
}

function mockFetchOk(token: string, email = 'mayor@test.com', name = 'Mayor') {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ accessToken: token, user: { email, name } }),
  }))
}

function mockFetchFail(status = 401) {
  vi.stubGlobal('fetch', async () => ({
    ok: false,
    status,
    json: async () => ({}),
  }))
}

afterEach(() => vi.unstubAllGlobals())

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthClient (kooker login gate)', () => {
  it('builds an encoded Basic Auth header without plaintext password', () => {
    const h = basicAuth('mayor@test.com', 'hunter2')
    expect(h).toBe('Basic ' + btoa('mayor@test.com:hunter2'))
    expect(h.includes('hunter2')).toBe(false)
  })

  it('rejects an empty email before hitting the network', async () => {
    const a = new AuthClient()
    const r = await a.login('', 'any')
    expect(r).toEqual({ ok: false, error: 'Enter your kooker email.' })
    expect(a.isAuthenticated).toBe(false)
  })

  it('rejects an empty password before hitting the network', async () => {
    const a = new AuthClient()
    const r = await a.login('mayor@test.com', '')
    expect(r).toEqual({ ok: false, error: 'Enter your password.' })
    expect(a.isAuthenticated).toBe(false)
  })

  it('returns ok:false and stays logged out on a 401 from the server', async () => {
    mockFetchFail(401)
    const a = new AuthClient()
    const r = await a.login('mayor@test.com', 'wrong')
    expect(r).toEqual({ ok: false, error: 'Wrong email or password.' })
    expect(a.isAuthenticated).toBe(false)
    expect(a.authHeader()).toEqual({})
  })

  it('accepts a valid login and attaches a Bearer token', async () => {
    const now = 1_000_000_000
    const token = fakeJwt(now + 1000 * 60 * 60 * 8)
    mockFetchOk(token)
    const a = new AuthClient({ now: () => now })
    const r = await a.login('mayor@test.com', 'correct')
    expect(r).toEqual({ ok: true })
    expect(a.isAuthenticated).toBe(true)
    expect(a.operator?.id).toBe('Mayor') // uses name from user object
    expect(a.authHeader().Authorization?.startsWith('Bearer ')).toBe(true)
  })

  it('reads session expiry from the JWT exp claim and fails closed after it passes', async () => {
    let t = 1_000_000_000
    const token = fakeJwt(t + 1000 * 60 * 60 * 8) // JWT expires 8 h from now
    mockFetchOk(token)
    const a = new AuthClient({ now: () => t })
    await a.login('mayor@test.com', 'correct')
    expect(a.isAuthenticated).toBe(true)
    t += 1000 * 60 * 60 * 9 // advance 9 h — past the 8 h JWT window
    expect(a.isAuthenticated).toBe(false)
    expect(a.authHeader()).toEqual({})
  })

  it('logout clears the session immediately', async () => {
    const token = fakeJwt(Date.now() + 1000 * 60 * 60 * 8)
    mockFetchOk(token)
    const a = new AuthClient()
    await a.login('mayor@test.com', 'correct')
    expect(a.isAuthenticated).toBe(true)
    a.logout()
    expect(a.isAuthenticated).toBe(false)
    expect(a.authHeader()).toEqual({})
  })

  it('surfaces a network error as ok:false', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network down') })
    const a = new AuthClient()
    const r = await a.login('mayor@test.com', 'correct')
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: string }).error).toMatch(/network down/)
  })
})
