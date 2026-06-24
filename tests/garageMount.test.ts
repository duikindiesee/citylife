import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { post } from "../src/colony/ledger";

// Spec 096 — the playable mount/unmount loop: the signed-in player tunes their car (mount parts on
// sockets, one per socket) and uiState.garage reflects the parts + derived stats. garageStore persists
// to localStorage, so the test installs a mock; the operator gate is set via setOperatorName.
describe("garage mount/unmount (096)", () => {
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

  it("mounts/unmounts parts on the operator car, one per socket, updating derived stats", () => {
    const rt = new ColonyRuntime(4242);
    // no operator -> no garage, and mount is a no-op
    expect(rt.getUiState().garage).toBeNull();
    expect(rt.mountCarPart("blower")).toBe(false);

    const me = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(me.displayName);
    // Slice D — mounting now requires owning the part; fund the wallet and buy them first
    post(rt.sim.state.ledger, "test float", [
      { account: `citizen:${me.id}`, amount: 1000 },
      { account: "test:float", amount: -1000 },
    ]);
    expect(rt.buyCarPart("blower")).toBe(true);
    expect(rt.buyCarPart("fourbarrel_carb")).toBe(true);
    const g0 = rt.getUiState().garage!;
    expect(g0).toBeTruthy();
    expect(g0.parts.every((p) => !p.mounted)).toBe(true);
    const baseTop = g0.stats.topSpeed;

    // mount a blower (engine socket) -> mounted + topSpeed rises
    expect(rt.mountCarPart("blower")).toBe(true);
    let g = rt.getUiState().garage!;
    expect(g.parts.find((p) => p.kind === "blower")!.mounted).toBe(true);
    expect(g.stats.topSpeed).toBeGreaterThan(baseTop);

    // mounting a four-barrel (also the engine socket) REPLACES the blower (one per socket)
    expect(rt.mountCarPart("fourbarrel_carb")).toBe(true);
    g = rt.getUiState().garage!;
    expect(g.parts.find((p) => p.kind === "fourbarrel_carb")!.mounted).toBe(
      true,
    );
    expect(g.parts.find((p) => p.kind === "blower")!.mounted).toBe(false);

    // unknown kind -> no-op
    expect(rt.mountCarPart("warp_drive")).toBe(false);

    // unmount clears the socket
    expect(rt.unmountCarPart("fourbarrel_carb")).toBe(true);
    g = rt.getUiState().garage!;
    expect(g.parts.find((p) => p.kind === "fourbarrel_carb")!.mounted).toBe(
      false,
    );
  });
});
