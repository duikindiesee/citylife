import { describe, it, expect } from "vitest";
import {
  plotPriceKook,
  kookToZar,
  starterDeposit,
  type LandConfig,
} from "../src/colony/land";
import { createLedger, post, balance } from "../src/colony/ledger";
import { COLONY } from "../src/colony/config";

// Spec 085 — the land economy's money math (pure) + the double-entry conservation the runtime
// stands on. The runtime wiring (purchase gate, deposit-on-arrival, commission debit) is verified
// live on :5188; these pin the numbers + that ₭ never appears or vanishes.

const cfg: LandConfig = COLONY.economy.land;

describe("spec 085 — land pricing math", () => {
  it("a plot costs its area plus a waterfront premium, deterministic and rounded", () => {
    // Area is in m²; prices use full parcel area.
    expect(plotPriceKook(640, 999, cfg)).toBe(173);
    expect(plotPriceKook(1008, 999, cfg)).toBe(272);
    // Shore-side adds the premium; a GRAND waterfront plot is dearer than an inland ESTATE.
    expect(plotPriceKook(1008, 0, cfg)).toBeGreaterThan(
      plotPriceKook(640, 999, cfg),
    );
    // The premium decays to nothing far inland.
    expect(plotPriceKook(1008, 0, cfg)).toBe(340);
  });

  it("estate/grand land sits in the expected ₭ and ZAR bands", () => {
    const estate = plotPriceKook(1008, 30, cfg); // a mid-distance Large
    const grand = plotPriceKook(10000, 5, cfg); // a shore-ward smallholding
    expect(estate).toBeGreaterThanOrEqual(272);
    expect(estate).toBeLessThanOrEqual(340);
    expect(grand).toBeGreaterThanOrEqual(2800);
    expect(kookToZar(estate, cfg)).toBe(estate * 25);
    expect(kookToZar(100, cfg)).toBe(2500);
  });

  it("the starter deposit is deterministic, in band, and always covers the dearest plot", () => {
    const dearest = plotPriceKook(1008, 0, cfg); // waterfront Large is the suburban deposit invariant
    for (const seed of [1, 7, 42, 99, 12345]) {
      const a = starterDeposit(seed, cfg);
      const b = starterDeposit(seed, cfg);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(cfg.starterDepositMin);
      expect(a).toBeLessThanOrEqual(
        cfg.starterDepositMin + cfg.starterDepositSpread,
      );
      expect(a).toBeGreaterThanOrEqual(dearest); // covers the dearest suburban plot
    }
  });
});

describe("spec 085 — the ₭ ledger conserves through the full loop", () => {
  it("deposit -> buy land -> pay Viw: every ₭ is accounted for, nothing created or destroyed", () => {
    const led = createLedger();
    const dep = starterDeposit(42, cfg);
    // arrival
    post(led, "arrive", [
      { account: "citizen:c", amount: dep },
      { account: "arrivals", amount: -dep },
    ]);
    // buy a 200 ₭ plot
    post(led, "buy", [
      { account: "citizen:c", amount: -200 },
      { account: "land", amount: 200 },
    ]);
    // pay Viw 300 ₭ for the build
    post(led, "build", [
      { account: "citizen:c", amount: -300 },
      { account: "citizen:viw", amount: 300 },
    ]);

    expect(balance(led, "citizen:c")).toBe(dep - 500);
    expect(balance(led, "land")).toBe(200);
    expect(balance(led, "citizen:viw")).toBe(300);
    // the whole ledger nets to zero — ₭ only ever moves between accounts
    const total = Object.values(led.accounts).reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });

  it("post refuses an unbalanced transaction (a ₭ leak can never commit)", () => {
    const led = createLedger();
    expect(
      post(led, "bad", [
        { account: "citizen:c", amount: -100 },
        { account: "land", amount: 90 },
      ]),
    ).toBe(false);
    expect(balance(led, "citizen:c")).toBe(0); // nothing applied
  });
});
