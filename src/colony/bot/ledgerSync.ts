// Spec 085 P1 (folds in 083 P4b) — mirror the in-game Kook moves onto the REAL kooker-service-ledger
// as the signed-in player. Best-effort + never-block, exactly like bot/citizenSpawn and
// bot/kookerbookStore: the in-game double-entry ledger (ledger.ts) stays the source of truth and the
// game never waits on the network. A persisted FIFO queue drains in order through the /kooker proxy;
// each move carries a deterministic reference (the in-game txn id) and we remember what synced, so a
// reload or a retry never double-posts (the service has no idempotency key of its own).
//
// The mapping onto kooker-service-ledger (appName citylife, currency KCO, base path /api/ledger):
//   * deposit    -> POST /wallets with initialBalance (idempotent on owner+type+app): seeds the
//                   citizen's real wallet so later transactions have funds. A no-op if it exists.
//   * purchase   -> POST /transactions LAND_PURCHASE: CREDIT citizen, DEBIT the city land office.
//   * commission -> POST /transactions BUILD_FEE:     CREDIT client,  DEBIT the builder (Viw).
// initiatorId = the player's own userId (decoded from the JWT), so the service's caller==initiator
// check passes; the player's signed Bearer token clears the gateway's jwt-auth. Counterparty wallets
// (the land office, Viw) auto-create at balance 0 on first reference, so only the citizen's deposit
// needs seeding. CREDIT lowers a wallet, DEBIT raises it (the service's asset convention), which
// matches the in-game direction: the citizen's balance falls, the office/Viw rises.
import { getAuthClient } from "../authClient";

const WALLETS_PATH = "/kooker/api/ledger/wallets";
const TXNS_PATH = "/kooker/api/ledger/transactions";
const APP_NAME = "citylife";
const CURRENCY = "KCO";
const LAND_OFFICE = "city_treasury"; // the in-game `land` account, mirrored as the city's treasury wallet
const LS_QUEUE = "citylife.ledgersync.queue.v1";
const LS_SYNCED = "citylife.ledgersync.synced.v1";
const QUEUE_CAP = 500; // drop-oldest backstop if the player stays signed out for a very long time
const SYNCED_CAP = 2000; // bound the dedup memory; only the most recent references are worth keeping

export type LedgerMove =
  | { kind: "deposit"; citizenId: string; amount: number }
  | { kind: "purchase"; citizenId: string; lotId: string; amount: number }
  | {
      kind: "commission";
      fromCitizenId: string;
      toCitizenId: string;
      lotId: string;
      amount: number;
    };

export interface SyncStatus {
  pending: number;
  synced: number;
  lastError: string | null;
  lastSyncedRef: string | null;
}

/** The stable reference for a move — CONTENT-ADDRESSED by the economic event's natural identity, not
 *  the in-game txn id. The in-game ledger resets to founders on each boot (it isn't persisted in the
 *  citizen flow) so txn ids restart at 1, while the synced-set persists across reloads; a volatile
 *  id would therefore collide with a stale synced ref and silently skip genuinely-new activity. A
 *  citizen's one-time deposit, their purchase of a given lot, and their build on a given lot each
 *  have a stable identity, so a real re-post is deduped while distinct events never collide. Doubles
 *  as the human-readable memo on the real ledger and the client-side idempotency key. */
export function moveRef(move: LedgerMove): string {
  if (move.kind === "deposit") return `citylife:deposit:${move.citizenId}`;
  if (move.kind === "purchase")
    return `citylife:purchase:${move.citizenId}:${move.lotId}`;
  return `citylife:build:${move.fromCitizenId}:${move.lotId}`;
}

function amountOf(move: LedgerMove): number {
  return move.amount;
}

// ── pure request builders (exported for node tests) ──────────────────────────

export interface WalletBody {
  ownerId: string;
  ownerType: string;
  walletType: string;
  appName: string;
  currency: string;
  initialBalance: number;
}
export interface EntryBody {
  ownerId: string;
  walletType: string;
  entryType: "DEBIT" | "CREDIT";
  amount: number;
}
export interface TxnBody {
  appName: string;
  transactionType: string;
  reference: string;
  initiatorId: string;
  entries: EntryBody[];
}

/** Seed a citizen's real wallet to their arrival deposit (idempotent on owner+walletType+app). */
export function depositBody(citizenId: string, amount: number): WalletBody {
  return {
    ownerId: citizenId,
    ownerType: "USER",
    walletType: "DEFAULT",
    appName: APP_NAME,
    currency: CURRENCY,
    initialBalance: amount,
  };
}

/** A land purchase: the citizen pays the city land office. */
export function purchaseBody(
  playerUserId: string,
  citizenId: string,
  amount: number,
  ref: string,
): TxnBody {
  return {
    appName: APP_NAME,
    transactionType: "LAND_PURCHASE",
    reference: ref,
    initiatorId: playerUserId,
    entries: [
      {
        ownerId: citizenId,
        walletType: "DEFAULT",
        entryType: "CREDIT",
        amount,
      },
      {
        ownerId: LAND_OFFICE,
        walletType: "TREASURY",
        entryType: "DEBIT",
        amount,
      },
    ],
  };
}

/** A build commission: the client pays the builder (Viw). */
export function commissionBody(
  playerUserId: string,
  fromCitizenId: string,
  toCitizenId: string,
  amount: number,
  ref: string,
): TxnBody {
  return {
    appName: APP_NAME,
    transactionType: "BUILD_FEE",
    reference: ref,
    initiatorId: playerUserId,
    entries: [
      {
        ownerId: fromCitizenId,
        walletType: "DEFAULT",
        entryType: "CREDIT",
        amount,
      },
      {
        ownerId: toCitizenId,
        walletType: "DEFAULT",
        entryType: "DEBIT",
        amount,
      },
    ],
  };
}

/** Decode the userId claim from a JWT WITHOUT verifying the signature (verification is the gateway's
 *  job; this only reads who the already-validated token belongs to). Mirrors authClient.jwtExpiresAt. */
export function userIdFromToken(token: string): string | null {
  try {
    const b64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return null;
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4); // base64url drops padding; atob needs it
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const id = payload["userId"] ?? payload["userid"] ?? payload["sub"];
    return id == null ? null : String(id);
  } catch {
    return null;
  }
}

function isLedgerMove(v: unknown): v is LedgerMove {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  if (typeof m["amount"] !== "number") return false;
  if (m["kind"] === "deposit") return typeof m["citizenId"] === "string";
  if (m["kind"] === "purchase")
    return typeof m["citizenId"] === "string" && typeof m["lotId"] === "string";
  if (m["kind"] === "commission")
    return (
      typeof m["fromCitizenId"] === "string" &&
      typeof m["toCitizenId"] === "string" &&
      typeof m["lotId"] === "string"
    );
  return false;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
type TransportResult = { ok: boolean; status: number };
export interface LedgerSyncDeps {
  transport: (
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ) => Promise<TransportResult>;
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
  storage: StorageLike | null;
  /** Optional re-kick after a TRANSIENT failure (network / 5xx / 429). Omitted in tests so no timers
   *  leak; the browser singleton wires a setTimeout. A non-retryable stop waits for the next notice(). */
  scheduleRetry?: (fn: () => void) => void;
}

export class LedgerSync {
  private queue: LedgerMove[] = [];
  private synced = new Set<string>();
  private drainPromise: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastSyncedRef: string | null = null;
  private readonly deps: LedgerSyncDeps;

  constructor(deps: LedgerSyncDeps) {
    this.deps = deps;
    this.restore();
  }

  status(): SyncStatus {
    return {
      pending: this.queue.length,
      synced: this.synced.size,
      lastError: this.lastError,
      lastSyncedRef: this.lastSyncedRef,
    };
  }

  /** Enqueue an in-game money move to mirror onto the real ledger. Dedupes on the move's reference
   *  (already-synced or already-queued), then kicks a drain. Pure-local + synchronous: never blocks. */
  notice(move: LedgerMove): void {
    if (amountOf(move) <= 0) return; // nothing to mirror (and the service rejects non-positive amounts)
    const ref = moveRef(move);
    if (this.synced.has(ref) || this.queue.some((m) => moveRef(m) === ref))
      return;
    this.queue.push(move);
    if (this.queue.length > QUEUE_CAP) {
      const dropped = this.queue.length - QUEUE_CAP;
      this.queue.splice(0, dropped);
      // No silent cap: surface what coverage was lost so it doesn't read as "everything synced".
      // eslint-disable-next-line no-console
      console.warn(
        `[ledgerSync] queue exceeded ${QUEUE_CAP}; dropped ${dropped} oldest unsynced move(s)`,
      );
    }
    this.persist();
    void this.drain();
  }

  /** Re-attempt the queue now (e.g. once the player signs in, or for a live check). Never throws. */
  flush(): void {
    void this.drain();
  }

  /** Best-effort drain in FIFO order. Never throws. Stops on the first failure with the queue intact
   *  and order preserved, so the next attempt resumes exactly where this one stopped. Concurrent
   *  callers (a notice() kick + an explicit flush) share the single in-flight drain. */
  async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.runDrain().finally(() => {
      this.drainPromise = null;
    });
    return this.drainPromise;
  }

  private async runDrain(): Promise<void> {
    let retryable = false;
    if (this.queue.length === 0) return;
    const token = await this.deps.getToken();
    if (!token) {
      this.lastError = "not signed in";
      return;
    }
    const userId = this.deps.getUserId(token);
    if (!userId) {
      this.lastError = "no userId claim";
      return;
    }
    const headers = {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Kooker-User-Id": userId,
    };
    while (this.queue.length > 0) {
      const move = this.queue[0]!;
      const ref = moveRef(move);
      const { path, body } = this.requestFor(move, userId, ref);
      let res: TransportResult;
      try {
        res = await this.deps.transport(path, body, headers);
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : "network error";
        retryable = true;
        break;
      }
      if (!res.ok) {
        this.lastError = `HTTP ${res.status}`;
        // A transient class (5xx / 429) is worth an auto-retry; a 4xx is a contract problem that a
        // human should see, so we stop-and-preserve and wait for the next notice() to re-kick.
        retryable = res.status >= 500 || res.status === 429;
        break;
      }
      this.synced.add(ref);
      this.lastSyncedRef = ref;
      this.lastError = null;
      this.queue.shift();
      this.capSynced();
      this.persist();
    }
    if (retryable && this.queue.length > 0 && this.deps.scheduleRetry)
      this.deps.scheduleRetry(() => void this.drain());
  }

  private requestFor(
    move: LedgerMove,
    userId: string,
    ref: string,
  ): { path: string; body: unknown } {
    if (move.kind === "deposit")
      return {
        path: WALLETS_PATH,
        body: depositBody(move.citizenId, move.amount),
      };
    if (move.kind === "purchase")
      return {
        path: TXNS_PATH,
        body: purchaseBody(userId, move.citizenId, move.amount, ref),
      };
    return {
      path: TXNS_PATH,
      body: commissionBody(
        userId,
        move.fromCitizenId,
        move.toCitizenId,
        move.amount,
        ref,
      ),
    };
  }

  private capSynced(): void {
    if (this.synced.size <= SYNCED_CAP) return;
    this.synced = new Set(
      [...this.synced].slice(this.synced.size - SYNCED_CAP),
    );
  }

  private persist(): void {
    const st = this.deps.storage;
    if (!st) return;
    try {
      st.setItem(LS_QUEUE, JSON.stringify(this.queue));
      st.setItem(LS_SYNCED, JSON.stringify([...this.synced]));
    } catch {
      /* no storage */
    }
  }

  private restore(): void {
    const st = this.deps.storage;
    if (!st) return;
    try {
      const q = JSON.parse(st.getItem(LS_QUEUE) ?? "[]");
      if (Array.isArray(q)) this.queue = q.filter(isLedgerMove);
      const s = JSON.parse(st.getItem(LS_SYNCED) ?? "[]");
      if (Array.isArray(s))
        this.synced = new Set(
          s.filter((x): x is string => typeof x === "string"),
        );
    } catch {
      /* no storage / bad data */
    }
  }
}

let shared: LedgerSync | null = null;

/** Process-wide LedgerSync used by the runtime — drains through the /kooker proxy as the player. */
export function getLedgerSync(): LedgerSync {
  if (!shared) shared = new LedgerSync(defaultDeps());
  return shared;
}

function defaultDeps(): LedgerSyncDeps {
  return {
    transport: async (path, body, headers) => {
      const resp = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      return { ok: resp.ok, status: resp.status };
    },
    getToken: () => getAuthClient().getValidToken(),
    getUserId: userIdFromToken,
    storage: typeof localStorage !== "undefined" ? localStorage : null,
    scheduleRetry: (fn) => {
      try {
        setTimeout(fn, 15_000);
      } catch {
        /* no timer */
      }
    },
  };
}
