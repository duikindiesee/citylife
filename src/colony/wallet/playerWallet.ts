/** A self-scoped snapshot from kooker-service-ledger. Missing or failed reads are never zero. */
export type PlayerWalletStatus = "loading" | "ready" | "missing" | "unavailable";

export interface PlayerWalletSnapshot {
  accountKey: string | null;
  status: PlayerWalletStatus;
  balanceKco: number | null;
}

type PlayerWalletAuth = {
  getValidToken(): Promise<string | null>;
  operator: { userId?: string | null } | null;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const emptyPlayerWallet = (
  accountKey: string | null,
  status: PlayerWalletStatus,
): PlayerWalletSnapshot => ({ accountKey, status, balanceKco: null });

/** Human-readable state for wallet displays. A missing wallet is distinct from a zero balance. */
export function playerWalletLabel(
  wallet: PlayerWalletSnapshot,
  currency = "₭",
): string {
  switch (wallet.status) {
    case "loading":
      return "Loading…";
    case "ready":
      return wallet.balanceKco === null
        ? "Unavailable"
        : `${currency}${Math.round(wallet.balanceKco).toLocaleString()} KCO`;
    case "missing":
      return "Wallet not set up";
    case "unavailable":
      return "Balance unavailable";
  }
}

/**
 * Read only the bearer caller's CityLife DEFAULT/KCO wallet. The API derives owner and realm from
 * the signed session; this client sends no owner id. Any account mismatch or malformed projection
 * fails closed, and HTTP 404 remains a separate no-wallet state rather than a fabricated zero.
 */
export async function readPlayerWallet(
  auth: PlayerWalletAuth,
  expectedAccountKey: string,
  fetcher: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<PlayerWalletSnapshot> {
  const unavailable = () => emptyPlayerWallet(expectedAccountKey, "unavailable");
  try {
    const token = await auth.getValidToken();
    if (
      !token ||
      auth.operator?.userId == null ||
      String(auth.operator.userId) !== expectedAccountKey
    ) {
      return unavailable();
    }
    const response = await fetcher("/kooker/api/ledger/me/wallet", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal,
    });
    if (response.status === 404) {
      // The gateway can also return a generic 404 when a route is absent. Call it missing only when
      // the ledger's documented no-wallet response is explicit; an unrecognized 404 is unavailable.
      let message = "";
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object") {
          const record = body as Record<string, unknown>;
          message = [record.message, record.detail, record.error]
            .filter((value): value is string => typeof value === "string")
            .join(" ");
        }
      } catch {
        /* Keep an unstructured 404 unavailable. */
      }
      return /no DEFAULT wallet exists yet for this account/i.test(message)
        ? emptyPlayerWallet(expectedAccountKey, "missing")
        : unavailable();
    }
    if (!response.ok) return unavailable();

    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return unavailable();
    const wallet = body as Record<string, unknown>;
    const appName =
      typeof wallet.appName === "string" ? wallet.appName.toLowerCase() : "";
    const walletType =
      typeof wallet.walletType === "string" ? wallet.walletType.toUpperCase() : "";
    const instrument =
      typeof wallet.instrument === "string" ? wallet.instrument.toUpperCase() : "";
    const balance =
      typeof wallet.balance === "number"
        ? wallet.balance
        : typeof wallet.balance === "string" && wallet.balance.trim() !== ""
          ? Number(wallet.balance)
          : Number.NaN;
    if (
      wallet.ownerId == null ||
      String(wallet.ownerId) !== expectedAccountKey ||
      appName !== "citylife" ||
      walletType !== "DEFAULT" ||
      instrument !== "KCO" ||
      !Number.isFinite(balance) ||
      balance < 0
    ) {
      return unavailable();
    }
    return {
      accountKey: expectedAccountKey,
      status: "ready",
      balanceKco: balance,
    };
  } catch {
    return unavailable();
  }
}
