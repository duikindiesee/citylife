import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { post } from "../src/colony/ledger";

// Spec 096 (PLAN 1.3) — a single headline build rating out of 100, derived from the effective stats: a
// stock car reads 50 and every performance part pushes it toward 100. Pure derivation on uiState.garage.
describe("tune points build rating (096)", () => {
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

  it("reads 50 for a stock car and rises when a performance part is fitted", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    post(rt.sim.state.ledger, "test float", [
      { account: `citizen:${me.id}`, amount: 1000 },
      { account: "test:float", amount: -1000 },
    ]);

    // a stock car (every stat 0.5) rates 50
    expect(rt.getUiState().garage!.tunePoints).toBe(50);

    // fit a blower (topSpeed +0.2, accel +0.15, grip -0.1 = +0.25 net) -> rating rises to 56
    expect(rt.buyCarPart("blower")).toBe(true);
    expect(rt.mountCarPart("blower")).toBe(true);
    const tuned = rt.getUiState().garage!;
    expect(tuned.tunePoints).toBe(56);
    // the rating tracks the effective stats exactly: round(sum * 25)
    const s = tuned.stats;
    expect(tuned.tunePoints).toBe(
      Math.round((s.topSpeed + s.acceleration + s.grip + s.braking) * 25),
    );
    expect(tuned.tunePoints).toBeGreaterThan(50);
  });
});
