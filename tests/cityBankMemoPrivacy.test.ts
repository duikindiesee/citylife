import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

// Boot the real runtime. seedDeposit posts the City Bank "arrives with" memos, which the HUD renders
// verbatim, so they must carry public display names and never raw ledger ids such as citizen_viw.
const rt = new ColonyRuntime(4242);
const arrivals = rt.sim.state.ledger.txns.filter((tx) =>
  tx.memo.includes("arrives with"),
);

describe("City Bank arrival memos never leak raw citizen ids", () => {
  it("seeds at least one arrival deposit", () => {
    expect(arrivals.length).toBeGreaterThan(0);
  });

  it("renders the builder publicly as KOOKER the Builder, not citizen_viw", () => {
    const builder = arrivals.find((tx) =>
      tx.memo.includes("KOOKER the Builder"),
    );
    expect(builder, "builder arrival memo should exist").toBeDefined();
    expect(builder!.memo).not.toContain("citizen_viw");
  });

  it("does not echo any raw citizen_ id in an arrival memo", () => {
    const leaks = arrivals
      .map((tx) => tx.memo)
      .filter((memo) => memo.includes("citizen_"));
    expect(leaks).toEqual([]);
  });
});
