import { describe, expect, it, vi } from "vitest";
import { parsePlayerWalletKco, readPlayerWalletKco } from "../src/colony/playerWallet";

const wallet = (overrides: Record<string, unknown> = {}) => ({
  ownerId: "191",
  ownerType: "USER",
  walletType: "DEFAULT",
  appName: "citylife",
  currency: "KCO",
  realm: "TEST",
  balance: "1300.0000",
  ...overrides,
});

describe("authoritative player wallet read", () => {
  it("parses only the caller's CityLife KCO default wallet", () => {
    expect(parsePlayerWalletKco([wallet()], "191")).toBe(1300);
    expect(
      parsePlayerWalletKco(
        [wallet({ walletType: "TREASURY", balance: 5000 }), wallet()],
        "191",
      ),
    ).toBe(1300);
  });

  it("treats a valid empty balance list as zero but rejects ambiguous or cross-account data", () => {
    expect(parsePlayerWalletKco([], "191")).toBe(0);
    expect(parsePlayerWalletKco([wallet({ ownerId: "192" })], "191")).toBeNull();
    expect(parsePlayerWalletKco([wallet(), wallet()], "191")).toBeNull();
    expect(parsePlayerWalletKco({ balance: 1300 }, "191")).toBeNull();
  });

  it("rejects non-CityLife currency and invalid amounts rather than displaying guesses", () => {
    expect(parsePlayerWalletKco([wallet({ appName: "sportifine" })], "191")).toBeNull();
    expect(parsePlayerWalletKco([wallet({ currency: "USD" })], "191")).toBeNull();
    expect(parsePlayerWalletKco([wallet({ balance: "NaN" })], "191")).toBeNull();
    expect(parsePlayerWalletKco([wallet({ balance: -1 })], "191")).toBeNull();
  });

  it("requests only the token-derived user and returns the server's balance", async () => {
    const transport = vi.fn(async () => ({ ok: true, status: 200, body: [wallet()] }));
    const result = await readPlayerWalletKco({
      getToken: async () => "signed-token",
      getUserId: (token) => (token === "signed-token" ? "191" : null),
      transport,
    });

    expect(result).toBe(1300);
    expect(transport).toHaveBeenCalledWith(
      "/kooker/api/ledger/wallets/191/balances?appName=citylife",
      {
        Accept: "application/json",
        Authorization: "Bearer signed-token",
        "X-Kooker-User-Id": "191",
      },
    );
  });

  it("fails closed when authentication or the ledger response is unavailable", async () => {
    const transport = vi.fn(async () => ({ ok: false, status: 403, body: [] }));
    expect(
      await readPlayerWalletKco({
        getToken: async () => null,
        getUserId: () => "191",
        transport,
      }),
    ).toBeNull();
    expect(transport).not.toHaveBeenCalled();

    expect(
      await readPlayerWalletKco(
        {
          getToken: async () => "signed-token",
          getUserId: () => "191",
          transport,
        },
        "192",
      ),
    ).toBeNull();
    expect(transport).not.toHaveBeenCalled();

    expect(
      await readPlayerWalletKco({
        getToken: async () => "signed-token",
        getUserId: () => "191",
        transport,
      }),
    ).toBeNull();
  });
});
