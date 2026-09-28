import { getAuthClient, jwtUserId } from "./authClient";

const LEDGER_WALLETS_PATH = "/kooker/api/ledger/wallets";
const APP_NAME = "citylife";
const CURRENCY = "KCO";
const WALLET_TYPE = "DEFAULT";

export interface PlayerWalletResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface PlayerWalletDeps {
  getToken: () => Promise<string | null>;
  getUserId: (token: string) => string | null;
  transport: (
    path: string,
    headers: Record<string, string>,
  ) => Promise<PlayerWalletResponse>;
}

/**
 * Read only the authenticated player's KCO DEFAULT wallet. Ledger's route binds app and realm to
 * the verified JWT and rejects an ownerId other than the caller, so this client-supplied path value
 * is only a routing hint; it never grants access to another user's balance.
 *
 * A valid empty list means no wallet exists yet and therefore the spendable balance is zero. Any
 * transport, identity, or payload ambiguity returns null so the UI reports balance as unavailable.
 */
export function parsePlayerWalletKco(payload: unknown, userId: string): number | null {
  if (!Array.isArray(payload)) return null;

  const matching: number[] = [];
  for (const candidate of payload) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return null;
    const row = candidate as Record<string, unknown>;
    if (
      row.ownerId !== userId ||
      row.ownerType !== "USER" ||
      typeof row.appName !== "string" ||
      row.appName.toLowerCase() !== APP_NAME ||
      typeof row.currency !== "string" ||
      row.currency.toUpperCase() !== CURRENCY
    ) {
      return null;
    }
    if (row.walletType !== WALLET_TYPE) continue;

    const balance =
      typeof row.balance === "number" || typeof row.balance === "string"
        ? Number(row.balance)
        : Number.NaN;
    if (!Number.isFinite(balance) || balance < 0 || balance > Number.MAX_SAFE_INTEGER)
      return null;
    matching.push(balance);
  }

  // The ledger's owner/type/app/realm key permits one DEFAULT wallet. Duplicates mean the response
  // contract is inconsistent, so do not sum them or display a guessed balance.
  if (matching.length > 1) return null;
  return matching[0] ?? 0;
}

export async function readPlayerWalletKco(
  deps: PlayerWalletDeps,
  expectedUserId?: string,
): Promise<number | null> {
  try {
    const token = await deps.getToken();
    if (!token) return null;
    const userId = deps.getUserId(token);
    if (!userId || (expectedUserId !== undefined && userId !== expectedUserId))
      return null;

    const path = `${LEDGER_WALLETS_PATH}/${encodeURIComponent(userId)}/balances?appName=${APP_NAME}`;
    const result = await deps.transport(path, {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      // Convenience header only. Both values are derived from the bearer token and the service
      // independently verifies identity, app and realm from that token.
      "X-Kooker-User-Id": userId,
    });
    if (!result.ok) return null;
    return parsePlayerWalletKco(result.body, userId);
  } catch {
    return null;
  }
}

export function defaultPlayerWalletDeps(
  timeoutMs = 5000,
): PlayerWalletDeps {
  return {
    getToken: () => getAuthClient().getValidToken(),
    getUserId: jwtUserId,
    transport: async (path, headers) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(path, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return { ok: response.ok, status: response.status, body };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
