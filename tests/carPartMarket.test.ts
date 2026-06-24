import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { post, balance } from "../src/colony/ledger";
import {
  addCarPartListing,
  removeCarPartListing,
  findCarPartListing,
  carPartListingId,
} from "../src/colony/bot/carPartMarket";

// Spec 096 G — the Kookerbook car-part classifieds. A player lists an owned part for city coin; another
// buys it, the coin moves between their wallets and the part changes hands. localStorage-backed board,
// so the test installs a mock and drives two operators (seller then buyer) via setOperatorName.
describe("car-part classifieds — pure store (096 G)", () => {
  it("dedupes by id, re-prices, removes, and ignores bad input", () => {
    let m = addCarPartListing([], "joe", "blower", 460);
    expect(m).toHaveLength(1);
    expect(m[0]!.id).toBe(carPartListingId("joe", "blower"));
    // a re-list updates the price, not a second row
    m = addCarPartListing(m, "joe", "blower", 500);
    expect(m).toHaveLength(1);
    expect(m[0]!.price).toBe(500);
    // a different seller is a separate listing
    m = addCarPartListing(m, "ada", "blower", 400);
    expect(m).toHaveLength(2);
    // unknown kind / non-positive price are rejected (input unchanged)
    expect(addCarPartListing(m, "joe", "warp_drive" as never, 100)).toHaveLength(
      2,
    );
    expect(addCarPartListing(m, "joe", "headers", 0)).toHaveLength(2);
    // remove + find
    const id = carPartListingId("ada", "blower");
    expect(findCarPartListing(m, id)).not.toBeNull();
    expect(findCarPartListing(removeCarPartListing(m, id), id)).toBeNull();
  });
});

describe("car-part classifieds — runtime flow (096 G)", () => {
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

  it("lists an owned part, then a second player buys it: coin moves, ownership transfers", () => {
    const rt = new ColonyRuntime(4242);
    const seller = rt.getUiState().citizens.list[0]!;
    const buyer = rt.getUiState().citizens.list[1]!;
    const fund = (citizenId: string, amount: number) =>
      post(rt.sim.state.ledger, "test float", [
        { account: `citizen:${citizenId}`, amount },
        { account: "test:float", amount: -amount },
      ]);

    // seller buys a blower from the shop, then lists it on the board
    rt.setOperatorName(seller.displayName);
    fund(seller.id, 1000);
    expect(rt.buyCarPart("blower")).toBe(true);
    expect(rt.listCarPartForSale("blower", 500)).toBe(true);
    let g = rt.getUiState().garage!;
    expect(g.market).toHaveLength(1);
    expect(g.market[0]!.mine).toBe(true);
    expect(g.market[0]!.price).toBe(500);
    // the listed part left the seller's garage (escrowed) so it is no longer mountable
    expect(rt.mountCarPart("blower")).toBe(false);
    // a mounted part cannot be listed (the seller has none mounted now anyway)
    const listingId = g.market[0]!.id;

    // the buyer signs in: the listing is no longer "mine", and buying moves the coin
    rt.setOperatorName(buyer.displayName);
    fund(buyer.id, 1000);
    g = rt.getUiState().garage!;
    expect(g.market[0]!.mine).toBe(false);
    const sellerBefore = balance(rt.sim.state.ledger, `citizen:${seller.id}`);
    const buyerBefore = balance(rt.sim.state.ledger, `citizen:${buyer.id}`);
    expect(rt.buyCarPartListing(listingId)).toBe(true);

    expect(balance(rt.sim.state.ledger, `citizen:${seller.id}`)).toBe(
      sellerBefore + 500,
    );
    expect(balance(rt.sim.state.ledger, `citizen:${buyer.id}`)).toBe(
      buyerBefore - 500,
    );
    // the buyer now owns it (can mount), and the board is empty
    expect(rt.mountCarPart("blower")).toBe(true);
    expect(rt.getUiState().garage!.market).toHaveLength(0);
  });

  it("refuses to buy your own listing and unlists it back to your garage", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    post(rt.sim.state.ledger, "test float", [
      { account: `citizen:${me.id}`, amount: 1000 },
      { account: "test:float", amount: -1000 },
    ]);
    expect(rt.buyCarPart("headers")).toBe(true);
    expect(rt.listCarPartForSale("headers", 200)).toBe(true);
    const id = rt.getUiState().garage!.market[0]!.id;
    // cannot buy your own listing
    expect(rt.buyCarPartListing(id)).toBe(false);
    // unlist returns it to the garage
    expect(rt.unlistCarPart(id)).toBe(true);
    expect(rt.getUiState().garage!.market).toHaveLength(0);
    expect(rt.mountCarPart("headers")).toBe(true);
  });
});
