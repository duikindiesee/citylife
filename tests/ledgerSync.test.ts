import { describe, it, expect } from 'vitest'
import {
  LedgerSync,
  moveRef,
  depositBody,
  purchaseBody,
  commissionBody,
  userIdFromToken,
  type LedgerMove,
  type LedgerSyncDeps,
} from '../src/colony/bot/ledgerSync'

// ── A controllable harness: an in-memory storage + a transport that records every call and can be
// told to fail on the Nth attempt. No network, no timers, fully deterministic. ──────────────────
function memStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _map: m,
  }
}

interface Sent {
  path: string
  body: any
  headers: Record<string, string>
}

function harness(opts?: { failAt?: (n: number) => { ok: boolean; status: number } | null; token?: string | null }) {
  const sent: Sent[] = []
  const retries: Array<() => void> = []
  let n = 0
  const deps: LedgerSyncDeps = {
    transport: async (path, body, headers) => {
      n += 1
      const forced = opts?.failAt?.(n) ?? null
      sent.push({ path, body, headers })
      return forced ?? { ok: true, status: 200 }
    },
    getToken: async () => (opts && 'token' in opts ? opts.token! : 'h.eyJ1c2VySWQiOjgyfQ.s'),
    getUserId: () => '82',
    storage: memStorage(),
    scheduleRetry: (fn) => void retries.push(fn),
  }
  return { deps, sent, retries }
}

const DEPOSIT: LedgerMove = { kind: 'deposit', txnId: 1, citizenId: 'citizen_dax', amount: 700 }
const PURCHASE: LedgerMove = { kind: 'purchase', txnId: 2, citizenId: 'citizen_dax', amount: 196 }
const COMMISSION: LedgerMove = { kind: 'commission', txnId: 3, fromCitizenId: 'citizen_dax', toCitizenId: 'citizen_viw', amount: 472 }

describe('ledgerSync pure request builders', () => {
  it('depositBody seeds the citizen wallet with their arrival balance', () => {
    expect(depositBody('citizen_dax', 700)).toEqual({
      ownerId: 'citizen_dax',
      ownerType: 'USER',
      walletType: 'DEFAULT',
      appName: 'citylife',
      currency: 'KCO',
      initialBalance: 700,
    })
  })

  it('purchaseBody balances (CREDIT citizen == DEBIT land office) and is LAND_PURCHASE', () => {
    const b = purchaseBody('82', 'citizen_dax', 196, 'citylife:2')
    expect(b.appName).toBe('citylife')
    expect(b.transactionType).toBe('LAND_PURCHASE')
    expect(b.reference).toBe('citylife:2')
    expect(b.initiatorId).toBe('82')
    expect(b.entries).toEqual([
      { ownerId: 'citizen_dax', walletType: 'DEFAULT', entryType: 'CREDIT', amount: 196 },
      { ownerId: 'city_treasury', walletType: 'TREASURY', entryType: 'DEBIT', amount: 196 },
    ])
    const debit = b.entries.filter((e) => e.entryType === 'DEBIT').reduce((s, e) => s + e.amount, 0)
    const credit = b.entries.filter((e) => e.entryType === 'CREDIT').reduce((s, e) => s + e.amount, 0)
    expect(debit).toBe(credit) // the service rejects an imbalanced txn
  })

  it('commissionBody pays the builder and is BUILD_FEE', () => {
    const b = commissionBody('82', 'citizen_dax', 'citizen_viw', 472, 'citylife:3')
    expect(b.transactionType).toBe('BUILD_FEE')
    expect(b.entries).toEqual([
      { ownerId: 'citizen_dax', walletType: 'DEFAULT', entryType: 'CREDIT', amount: 472 },
      { ownerId: 'citizen_viw', walletType: 'DEFAULT', entryType: 'DEBIT', amount: 472 },
    ])
  })

  it('moveRef is the deterministic in-game txn id', () => {
    expect(moveRef(DEPOSIT)).toBe('citylife:1')
    expect(moveRef(COMMISSION)).toBe('citylife:3')
  })
})

describe('userIdFromToken', () => {
  const tokenWith = (claims: Record<string, unknown>) => {
    // base64url-encode the payload the way a real JWT does, using btoa (the source decodes with atob).
    const b64 = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `h.${b64}.sig`
  }
  it('reads the camelCase userId claim', () => {
    expect(userIdFromToken(tokenWith({ userId: 82, sub: 'x@y' }))).toBe('82')
  })
  it('falls back to lowercase userid then sub', () => {
    expect(userIdFromToken(tokenWith({ userid: 5 }))).toBe('5')
    expect(userIdFromToken(tokenWith({ sub: 'usr_9' }))).toBe('usr_9')
  })
  it('returns null on a malformed token', () => {
    expect(userIdFromToken('not-a-jwt')).toBeNull()
    expect(userIdFromToken('')).toBeNull()
  })
})

describe('LedgerSync drain — happy path', () => {
  it('posts a deposit to /wallets and a purchase/commission to /transactions, with player auth headers', async () => {
    const { deps, sent } = harness()
    const sync = new LedgerSync(deps)
    sync.notice(DEPOSIT)
    sync.notice(PURCHASE)
    sync.notice(COMMISSION)
    await sync.drain()

    expect(sent.map((s) => s.path)).toEqual([
      '/kooker/api/ledger/wallets',
      '/kooker/api/ledger/transactions',
      '/kooker/api/ledger/transactions',
    ])
    // FIFO: deposit before purchase before commission (a purchase must not precede its deposit).
    expect(sent[0].body.initialBalance).toBe(700)
    expect(sent[1].body.transactionType).toBe('LAND_PURCHASE')
    expect(sent[2].body.transactionType).toBe('BUILD_FEE')
    for (const s of sent) {
      expect(s.headers.Authorization).toMatch(/^Bearer /)
      expect(s.headers['X-Kooker-User-Id']).toBe('82')
    }
    expect(sync.status()).toMatchObject({ pending: 0, synced: 3, lastError: null, lastSyncedRef: 'citylife:3' })
  })
})

describe('LedgerSync dedup', () => {
  it('never posts the same move twice — within a batch or after it synced', async () => {
    const { deps, sent } = harness()
    const sync = new LedgerSync(deps)
    sync.notice(PURCHASE)
    sync.notice(PURCHASE) // duplicate while queued — ignored
    await sync.drain()
    expect(sent).toHaveLength(1)
    sync.notice(PURCHASE) // duplicate after it synced — ignored
    await sync.drain()
    expect(sent).toHaveLength(1)
  })

  it('ignores a non-positive amount (the service rejects it anyway)', async () => {
    const { deps, sent } = harness()
    const sync = new LedgerSync(deps)
    sync.notice({ kind: 'commission', txnId: 9, fromCitizenId: 'a', toCitizenId: 'b', amount: 0 })
    await sync.drain()
    expect(sent).toHaveLength(0)
    expect(sync.status().pending).toBe(0)
  })
})

describe('LedgerSync stop-on-failure preserves order', () => {
  it('syncs up to the failure, keeps the rest queued in order, resumes on the next drain', async () => {
    // Fail the 2nd transport call (the purchase); deposit succeeds, purchase + commission stay queued.
    let failNext = true
    const { deps, sent } = harness({ failAt: (n) => (n === 2 && failNext ? { ok: false, status: 503 } : null) })
    const sync = new LedgerSync(deps)
    sync.notice(DEPOSIT)
    sync.notice(PURCHASE)
    sync.notice(COMMISSION)
    await sync.drain()

    expect(sent.map((s) => s.path)).toEqual(['/kooker/api/ledger/wallets', '/kooker/api/ledger/transactions'])
    expect(sync.status()).toMatchObject({ pending: 2, synced: 1, lastError: 'HTTP 503' })

    failNext = false // the upstream recovers
    await sync.drain()
    // Resumes exactly where it stopped: the purchase (retried) then the commission, still in order.
    expect(sent.slice(2).map((s) => s.body.transactionType)).toEqual(['LAND_PURCHASE', 'BUILD_FEE'])
    expect(sync.status()).toMatchObject({ pending: 0, synced: 3, lastError: null })
  })

  it('schedules a retry on a transient 5xx/429 but not on a 4xx contract error', async () => {
    const transient = harness({ failAt: () => ({ ok: false, status: 503 }) })
    const s1 = new LedgerSync(transient.deps)
    s1.notice(PURCHASE)
    await s1.drain()
    expect(transient.retries).toHaveLength(1)

    const contract = harness({ failAt: () => ({ ok: false, status: 400 }) })
    const s2 = new LedgerSync(contract.deps)
    s2.notice(PURCHASE)
    await s2.drain()
    expect(contract.retries).toHaveLength(0)
  })
})

describe('LedgerSync never blocks the game', () => {
  it('queues but posts nothing when no one is signed in', async () => {
    const { deps, sent } = harness({ token: null })
    const sync = new LedgerSync(deps)
    sync.notice(DEPOSIT)
    await sync.drain()
    expect(sent).toHaveLength(0)
    expect(sync.status()).toMatchObject({ pending: 1, synced: 0, lastError: 'not signed in' })
  })

  it('a thrown transport never escapes drain', async () => {
    const sent: Sent[] = []
    const deps: LedgerSyncDeps = {
      transport: async () => {
        throw new Error('boom')
      },
      getToken: async () => 'tok',
      getUserId: () => '82',
      storage: memStorage(),
    }
    const sync = new LedgerSync(deps)
    sync.notice(DEPOSIT)
    await expect(sync.drain()).resolves.toBeUndefined()
    expect(sent).toHaveLength(0)
    expect(sync.status().lastError).toBe('boom')
    expect(sync.status().pending).toBe(1)
  })
})

describe('LedgerSync persistence', () => {
  it('restores a queued move across instances and drains it; restored synced refs block re-posting', async () => {
    const storage = memStorage()
    // First instance: queue + sync the deposit, leave the purchase pending (fail its post).
    const sent1: Sent[] = []
    let block = true
    const deps1: LedgerSyncDeps = {
      transport: async (path, body, headers) => {
        sent1.push({ path, body, headers })
        return block && (body as any)?.transactionType === 'LAND_PURCHASE' ? { ok: false, status: 503 } : { ok: true, status: 200 }
      },
      getToken: async () => 'tok',
      getUserId: () => '82',
      storage,
    }
    const a = new LedgerSync(deps1)
    a.notice(DEPOSIT)
    a.notice(PURCHASE)
    await a.drain()
    expect(a.status()).toMatchObject({ pending: 1, synced: 1 })

    // Second instance restores from the SAME storage: the deposit ref is remembered (won't re-post),
    // the purchase is still queued and drains once the upstream is healthy.
    block = false
    const sent2: Sent[] = []
    const deps2: LedgerSyncDeps = {
      transport: async (path, body, headers) => {
        sent2.push({ path, body, headers })
        return { ok: true, status: 200 }
      },
      getToken: async () => 'tok',
      getUserId: () => '82',
      storage,
    }
    const b = new LedgerSync(deps2)
    expect(b.status().pending).toBe(1) // the purchase carried over
    await b.drain()
    expect(sent2.map((s) => s.body.transactionType)).toEqual(['LAND_PURCHASE']) // deposit NOT re-posted
    expect(b.status()).toMatchObject({ pending: 0, synced: 2 })
  })
})
