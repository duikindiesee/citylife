import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";

// Spec 140 — the LIVE seed must actually get its depot: the pad is surveyed and reserved, the gate
// spur is real road, and the five owned buses boot parked inside the pad. If a config or siting
// change ever fails this seed, the fleet silently degrades to the legacy single coach — this test
// makes that regression loud.

describe("bus depot on the live seed", () => {
  it("sites the pad, paves the gate spur, and parks the whole owned fleet in it", () => {
    const rt = new ColonyRuntime(); // the default demo seed
    expect(rt.busRoute).not.toBeNull();
    expect(rt.busDepot).not.toBeNull();
    const { site } = rt.busDepot!;
    // The gate spur was laid as real drivable road.
    expect(rt.sim.state.roadKind.has(`${site.gate.x},${site.gate.y}`)).toBe(true);
    expect(
      rt.sim.state.roadKind.has(`${site.roadCell.x},${site.roadCell.y}`),
    ).toBe(true);
    // The owned fleet exists and boots PARKED, physically inside the pad.
    expect(rt.busFleet?.buses.length).toBe(COLONY.transit.busesOwned);
    expect(rt.busFleet!.buses.every((b) => b.mode === "parked")).toBe(true);
    for (const p of rt.busPoses()) {
      expect(p.x).toBeGreaterThanOrEqual(site.x - 0.6);
      expect(p.x).toBeLessThanOrEqual(site.x + site.w - 0.4);
      expect(p.y).toBeGreaterThanOrEqual(site.y - 0.6);
      expect(p.y).toBeLessThanOrEqual(site.y + site.h - 0.4);
      expect(p.moving).toBe(false);
    }
  });
});
