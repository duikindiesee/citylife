import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { post } from "../src/colony/ledger";

// Spec 096 Slice D — the Street Rod money loop: a part must be BOUGHT (city coin from the in-game
// ledger) before it can be mounted. Free parts are owned implicitly. carStore persists ownership to
// localStorage, so the test installs a mock; the operator is set via setOperatorName.
describe("car shop economy (096 Slice D)", () => {
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

  it("requires buying a paid part before it can be mounted; spends city coin", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    // fund the player so the purchase can clear (in-game ledger, net-zero entry)
    post(rt.sim.state.ledger, "test float", [
      { account: `citizen:${me.id}`, amount: 1000 },
      { account: "test:float", amount: -1000 },
    ]);

    const blower = () =>
      rt.getUiState().garage!.parts.find((p) => p.kind === "blower")!;
    expect(blower().owned).toBe(false);

    // cannot mount a part you do not own
    expect(rt.mountCarPart("blower")).toBe(false);
    expect(blower().mounted).toBe(false);

    // buy it: ownership recorded, wallet drops by the price (blower = 460)
    const walletBefore = rt.getUiState().garage!.walletK;
    expect(rt.buyCarPart("blower")).toBe(true);
    const g = rt.getUiState().garage!;
    expect(g.parts.find((p) => p.kind === "blower")!.owned).toBe(true);
    expect(walletBefore - g.walletK).toBe(460);

    // now it mounts, and the stats move
    const baseTop = g.stats.topSpeed;
    expect(rt.mountCarPart("blower")).toBe(true);
    const g2 = rt.getUiState().garage!;
    expect(g2.parts.find((p) => p.kind === "blower")!.mounted).toBe(true);
    expect(g2.stats.topSpeed).toBeGreaterThan(baseTop);

    // a free part (cost 0) is owned implicitly and mounts without buying
    expect(
      rt.getUiState().garage!.parts.find((p) => p.kind === "street_tyres")!
        .owned,
    ).toBe(true);
    expect(rt.mountCarPart("street_tyres")).toBe(true);
  });

  it("refuses a purchase the player cannot afford", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    // drain the wallet to zero so nothing is affordable
    const bal = rt.getUiState().garage!.walletK;
    if (bal > 0)
      post(rt.sim.state.ledger, "drain", [
        { account: `citizen:${me.id}`, amount: -bal },
        { account: "test:sink", amount: bal },
      ]);
    expect(rt.buyCarPart("blower")).toBe(false);
    expect(
      rt.getUiState().garage!.parts.find((p) => p.kind === "blower")!.owned,
    ).toBe(false);
  });
});
