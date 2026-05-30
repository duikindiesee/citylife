// Double-entry ledger for the Kookerverse. Each settler has a bank account; the colony has a
// treasury; arriving settlers inject their Earth holdings into the economy at border security.
// Currency: the Kook (₭). Game-side for now — mirrors what a kooker-service-ledger would hold,
// so it can sync to a real double-entry service later (each user = one account).
export const CURRENCY = '₭'

export type AccountId = string // 'earth' | 'treasury' | `settler:${kookerId}`

export interface LedgerEntry {
  account: AccountId
  amount: number // signed; a transaction's entries must net to zero
}
export interface LedgerTxn {
  id: number
  ts: number
  memo: string
  entries: LedgerEntry[]
}
export interface Ledger {
  accounts: Record<string, number>
  txns: LedgerTxn[]
  nextId: number
}

export function createLedger(): Ledger {
  return { accounts: {}, txns: [], nextId: 1 }
}

export function balance(ledger: Ledger, account: AccountId): number {
  return ledger.accounts[account] ?? 0
}

/** Post a balanced double-entry transaction (entries must net to ~0). */
export function post(ledger: Ledger, memo: string, entries: LedgerEntry[]): boolean {
  if (Math.abs(entries.reduce((s, e) => s + e.amount, 0)) > 1e-6) return false
  for (const e of entries) ledger.accounts[e.account] = (ledger.accounts[e.account] ?? 0) + e.amount
  ledger.txns.unshift({ id: ledger.nextId++, ts: Date.now(), memo, entries })
  if (ledger.txns.length > 200) ledger.txns.length = 200
  return true
}

/** Total Kook held by the Kookerverse bank across every settler account. */
export function bankDeposits(ledger: Ledger): number {
  let sum = 0
  for (const k of Object.keys(ledger.accounts)) if (k.startsWith('settler:')) sum += ledger.accounts[k]!
  return sum
}

export function settlerAccounts(ledger: Ledger): { id: number; balance: number }[] {
  return Object.keys(ledger.accounts)
    .filter((k) => k.startsWith('settler:'))
    .map((k) => ({ id: Number(k.slice('settler:'.length)), balance: ledger.accounts[k]! }))
}
