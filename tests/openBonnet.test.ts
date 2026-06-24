import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { post } from "../src/colony/ledger";

// Spec 096 F — open the bonnet to reveal the engine bay. uiState.garage.engineBay lists the engine and
// hood sockets, each with the parts that fit it and an install state (occupied / installable / empty).
// Buying then fitting an engine part flips its socket to occupied. localStorage-backed ownership, so the
// test installs a mock and sets the operator (same pattern as the economy test).
describe("open bonnet / engine bay (096 F)", () => {
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

  it("is operator-gated and toggles the bonnet state", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.getUiState().garage).toBeNull();
    expect(rt.openBonnet()).toBe(false); // no operator -> no-op

    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    expect(rt.getUiState().garage!.bonnetOpen).toBe(false);
    expect(rt.openBonnet()).toBe(true);
    expect(rt.getUiState().garage!.bonnetOpen).toBe(true);
    rt.closeBonnet();
    expect(rt.getUiState().garage!.bonnetOpen).toBe(false);
  });

  it("exposes the engine and hood sockets with install states; fitting a part occupies its socket", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    post(rt.sim.state.ledger, "test float", [
      { account: `citizen:${me.id}`, amount: 1000 },
      { account: "test:float", amount: -1000 },
    ]);

    const bay = () => rt.getUiState().garage!.engineBay;
    // the bonnet reveals exactly the engine-bay sockets, and only fitting parts under each
    expect(bay().map((s) => s.socket)).toEqual(["engine", "hood"]);
    const engine = () => bay().find((s) => s.socket === "engine")!;
    expect(engine().parts.map((p) => p.kind).sort()).toEqual([
      "blower",
      "fourbarrel_carb",
    ]);
    // nothing owned yet -> the engine socket is empty
    expect(engine().state).toBe("empty");
    expect(engine().mounted).toBeNull();

    // buy a blower -> the socket is now installable (owned, not yet fitted)
    expect(rt.buyCarPart("blower")).toBe(true);
    expect(engine().state).toBe("installable");

    // fit it -> the socket is occupied by the blower
    expect(rt.mountCarPart("blower")).toBe(true);
    expect(engine().state).toBe("occupied");
    expect(engine().mounted).toEqual({
      kind: "blower",
      label: "Supercharger blower",
    });
  });

  it("shows each engine-bay part's handling effect badges", () => {
    const rt = new ColonyRuntime(4242);
    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    const engine = rt
      .getUiState()
      .garage!.engineBay.find((s) => s.socket === "engine")!;
    const blower = engine.parts.find((p) => p.kind === "blower")!;
    // the bonnet view is where the biggest stat decisions are made, so it shows the trade-off too
    expect(blower.effects).toEqual([
      { label: "Spd", up: true },
      { label: "Acc", up: true },
      { label: "Grip", up: false },
    ]);
  });
});
