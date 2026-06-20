import { describe, it, expect, vi, beforeEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { getLedgerSync } from "../src/colony/bot/ledgerSync";

// The runtime mirrors money moves to the real ledger best-effort; with no session the sync is a
// silent no-op, so these tests never touch the network. Spy on notice() to assert the mirror shape.

function fundedRuntime() {
  const rt = new ColonyRuntime(42);
  return rt;
}

// Find a citizen id with a wallet (the founders Joe + Viw are seeded with ₭ on boot).
function richestCitizen(rt: ColonyRuntime): string {
  return rt
    .getUiState()
    .citizens.list.map((c) => ({ id: c.id, k: rt.walletK(c.id) }))
    .sort((a, b) => b.k - a.k)[0]!.id;
}

describe("079 P1 — buying a shop plot", () => {
  beforeEach(() => {
    // ensure a clean sync queue between tests (the singleton persists in-process)
    vi.restoreAllMocks();
  });

  it("surveys shop plots and exposes the cheapest free one", () => {
    const rt = fundedRuntime();
    expect(rt.commercialDistrict).not.toBeNull();
    const cheap = rt.cheapestFreeShop();
    expect(cheap).not.toBeNull();
    // the cheapest must be a kiosk (220) — the lowest-priced kind
    expect(rt.shopPriceK(cheap!.kind)).toBe(rt.shopPriceK("kiosk"));
  });

  it("debits the buyer, credits the city land office, and conserves the ledger", () => {
    const rt = fundedRuntime();
    const buyer = richestCitizen(rt);
    const shop = rt.cheapestFreeShop()!;
    const price = rt.shopPriceK(shop.kind);
    const before = rt.walletK(buyer);
    const landBefore = Math.round(rt.sim.state.ledger.accounts["land"] ?? 0);

    expect(rt.buyCommercialShop(buyer, shop.id)).toBe(true);

    expect(rt.walletK(buyer)).toBe(before - price);
    expect(Math.round(rt.sim.state.ledger.accounts["land"] ?? 0)).toBe(
      landBefore + price,
    );
    // whole ledger still nets to zero (double-entry conserved)
    const net = Object.values(rt.sim.state.ledger.accounts).reduce(
      (s, v) => s + v,
      0,
    );
    expect(Math.round(net)).toBe(0);
    // ownership recorded
    expect(
      rt.commercialDistrict!.parcels.find((p) => p.id === shop.id)!
        .ownerCitizenId,
    ).toBe(buyer);
  });

  it("mirrors the sale to the real ledger as a content-addressed shop purchase", () => {
    const rt = fundedRuntime();
    const spy = vi.spyOn(getLedgerSync(), "notice");
    const buyer = richestCitizen(rt);
    const shop = rt.cheapestFreeShop()!;
    rt.buyCommercialShop(buyer, shop.id);
    const move = spy.mock.calls
      .map((c) => c[0])
      .find((m: any) => m.kind === "purchase" && m.lotId === shop.id);
    expect(move).toBeTruthy();
    expect(move).toMatchObject({
      kind: "purchase",
      citizenId: buyer,
      lotId: shop.id,
      amount: rt.shopPriceK(shop.kind),
    });
  });

  it("rejects a double-buy and an unaffordable buy", () => {
    const rt = fundedRuntime();
    const buyer = richestCitizen(rt);
    const shop = rt.cheapestFreeShop()!;
    expect(rt.buyCommercialShop(buyer, shop.id)).toBe(true);
    // same shop again — already owned
    expect(rt.buyCommercialShop(buyer, shop.id)).toBe(false);
    // a citizen with no wallet cannot buy
    expect(
      rt.buyCommercialShop("citizen_nobody", rt.cheapestFreeShop()!.id),
    ).toBe(false);
  });

  it("claimNextShop is deterministic — the wealthiest shopless citizen takes the cheapest plot", () => {
    const rt = fundedRuntime();
    const expected = rt
      .getUiState()
      .citizens.list.map((c) => ({ id: c.id, k: rt.walletK(c.id) }))
      .sort((a, b) => b.k - a.k || (a.id < b.id ? -1 : 1))[0]!.id;
    const cheapest = rt.cheapestFreeShop()!.id;
    const owner = rt.claimNextShop();
    expect(owner).toBe(expected);
    expect(
      rt.commercialDistrict!.parcels.find((p) => p.id === cheapest)!
        .ownerCitizenId,
    ).toBe(owner);
  });

  it("the commerce uiState reflects ownership + the buy gate", () => {
    const rt = fundedRuntime();
    const before = rt.getUiState().commerce;
    expect(before.free).toBe(before.plots);
    expect(before.canClaim).toBe(true);
    expect(before.cheapest).toMatchObject({ kind: "kiosk" });
    rt.claimNextShop();
    const after = rt.getUiState().commerce;
    expect(after.free).toBe(before.free - 1);
    expect(after.parcels.some((p) => p.owner !== null)).toBe(true);
  });

  it("removing a citizen frees the shop they owned (no ghost owner)", () => {
    const rt = fundedRuntime();
    const buyer = richestCitizen(rt);
    const shop = rt.cheapestFreeShop()!;
    expect(rt.buyCommercialShop(buyer, shop.id)).toBe(true);
    const freeAfterBuy = rt.getUiState().commerce.free;
    rt.removeCitizen(buyer);
    // the plot returns to the market — free count restored and the parcel is claimable again
    expect(rt.getUiState().commerce.free).toBe(freeAfterBuy + 1);
    expect(
      rt.commercialDistrict!.parcels.find((p) => p.id === shop.id)!
        .ownerCitizenId,
    ).toBeUndefined();
  });

  it("cheapestFreeShop tie-breaks by NUMERIC plot index, not the string (shop_9 before shop_10)", () => {
    const rt = fundedRuntime();
    // inject two equal-price free kiosks with multi-digit ids; the lower numeric index must win
    rt.commercialDistrict!.parcels = [
      {
        id: "shop_10",
        kind: "kiosk",
        x: 0,
        y: 0,
        w: 4,
        h: 4,
        side: -1,
        doorX: 2,
        doorY: -1,
        built: false,
      },
      {
        id: "shop_9",
        kind: "kiosk",
        x: 6,
        y: 0,
        w: 4,
        h: 4,
        side: -1,
        doorX: 8,
        doorY: -1,
        built: false,
      },
    ];
    expect(rt.cheapestFreeShop()!.id).toBe("shop_9");
  });
});
