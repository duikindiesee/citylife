import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { post } from "../src/colony/ledger";
import { isPublicSafe } from "../src/colony/newcomers";

// Spec 096 / player privacy — the car-part classifieds board is public, but player-scoped
// HUDs must not expose other citizens' private display names in seller copy.
describe("player car-part marketplace HUD privacy", () => {
  const realLS = (globalThis as { localStorage?: Storage }).localStorage;

  beforeEach(() => {
    const map = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  afterEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = realLS;
  });

  it("masks other sellers in player-scoped car-part listings", () => {
    const rt = new ColonyRuntime(4242);
    const adminUi = rt.getUiState();
    const seller = adminUi.citizens.list[0]!;
    const buyer = adminUi.citizens.list[1]!;
    const fund = (citizenId: string, amount: number) =>
      post(rt.sim.state.ledger, "test float", [
        { account: `citizen:${citizenId}`, amount },
        { account: "test:float", amount: -amount },
      ]);

    rt.setOperatorName(seller.displayName);
    fund(seller.id, 1000);
    expect(rt.buyCarPart("blower")).toBe(true);
    expect(rt.listCarPartForSale("blower", 500)).toBe(true);
    expect(rt.getUiState().garage!.market[0]!.sellerName).toBe(
      seller.displayName,
    );

    rt.setOperatorName(buyer.displayName);
    rt.setPlayerView(true);

    const playerListing = rt.getUiState().garage!.market[0]!;
    expect(playerListing.mine).toBe(false);
    expect(playerListing.sellerName).toBe("another resident");
    expect(playerListing.sellerName).not.toBe(seller.displayName);
    expect(playerListing.sellerName).not.toMatch(/Joe|Jack|Mira|Ledger/i);
    expect(isPublicSafe(playerListing.sellerName)).toBe(true);
  });
});
