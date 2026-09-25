import { describe, expect, it, vi } from "vitest";
import {
  playerWalletLabel,
  readPlayerWallet,
  type PlayerWalletSnapshot,
} from "../src/colony/wallet/playerWallet";

function auth(userId: string | null, token: string | null = "test-token") {
  return {
    operator: userId === null ? null : { userId },
    getValidToken: vi.fn(async () => token),
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validWallet = {
  ownerId: "player-42",
  appName: "CITYLIFE",
  walletType: "DEFAULT",
  instrument: "KCO",
  realm: "TEST",
  balance: "750.00",
};

describe("authoritative player wallet read", () => {
  it("reads the self-scoped CityLife KCO wallet and never sends an owner selector", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init });
      return response(validWallet);
    };

    const wallet = await readPlayerWallet(
      auth("player-42"),
      "player-42",
      fetcher,
    );

    expect(wallet).toEqual({
      accountKey: "player-42",
      status: "ready",
      balanceKco: 750,
    } satisfies PlayerWalletSnapshot);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.input).toBe("/kooker/api/ledger/me/wallet");
    expect(requests[0]!.init).toMatchObject({
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: "Bearer test-token",
        Accept: "application/json",
      },
    });
    expect(JSON.stringify(requests[0]!.init)).not.toContain("ownerId");
  });

  it("keeps a missing wallet separate from a zero balance", async () => {
    const wallet = await readPlayerWallet(
      auth("player-42"),
      "player-42",
      async () =>
        response(
          { message: "No DEFAULT wallet exists yet for this account" },
          404,
        ),
    );

    expect(wallet).toEqual({
      accountKey: "player-42",
      status: "missing",
      balanceKco: null,
    });
    expect(playerWalletLabel(wallet)).toBe("Wallet not set up");
    expect(
      playerWalletLabel({
        accountKey: "player-42",
        status: "ready",
        balanceKco: 0,
      }),
    ).toBe("₭0 KCO");
  });

  it.each([
    ["another account", { ...validWallet, ownerId: "player-99" }],
    ["another app", { ...validWallet, appName: "KOOKER_WEB" }],
    ["another wallet type", { ...validWallet, walletType: "SAVINGS" }],
    ["another instrument", { ...validWallet, instrument: "ZAR" }],
    ["malformed balance", { ...validWallet, balance: "not-money" }],
  ])("fails closed for %s", async (_name, body) => {
    const wallet = await readPlayerWallet(
      auth("player-42"),
      "player-42",
      async () => response(body),
    );
    expect(wallet.status).toBe("unavailable");
    expect(wallet.balanceKco).toBeNull();
  });

  it("does not request when the session identity or bearer token is missing", async () => {
    const fetcher = vi.fn(async () => response(validWallet));

    const mismatch = await readPlayerWallet(
      auth("player-99"),
      "player-42",
      fetcher,
    );
    const signedOut = await readPlayerWallet(
      auth("player-42", null),
      "player-42",
      fetcher,
    );

    expect(mismatch.status).toBe("unavailable");
    expect(signedOut.status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not convert HTTP and transport failures into zero", async () => {
    const denied = await readPlayerWallet(
      auth("player-42"),
      "player-42",
      async () => response({}, 503),
    );
    const offline = await readPlayerWallet(
      auth("player-42"),
      "player-42",
      async () => {
        throw new Error("offline");
      },
    );
    const routeMissing = await readPlayerWallet(
      auth("player-42"),
      "player-42",
      async () => response({ message: "Not Found" }, 404),
    );

    expect(denied.status).toBe("unavailable");
    expect(offline.status).toBe("unavailable");
    expect(routeMissing.status).toBe("unavailable");
    expect(denied.balanceKco).toBeNull();
    expect(offline.balanceKco).toBeNull();
    expect(playerWalletLabel(denied)).toBe("Balance unavailable");
  });
});
