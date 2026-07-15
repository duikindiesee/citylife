import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { updateTraffic } from "../src/colony/traffic";
import { RNG } from "../src/engine/rng";
import {
  plotRoadOverlapCells,
  conservativeRoadRibbonBlockedCells,
} from "../src/colony/placementValidation";

// Spec 149 — the LIVE seed must actually get its depot: the pad is surveyed and reserved, the gate
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
    expect(rt.sim.state.busDepotSpurCells?.has(`${site.gate.x},${site.gate.y}`)).toBe(true);
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

  it("keeps the depot plot clear of the conservative pre-existing road-ribbon footprint", () => {
    const rt = new ColonyRuntime(4242);
    const pad = rt.sim.state.busDepotPad!;
    // Runtime appends the depot spur after siting; all earlier ways contribute to the conservative
    // smoothing/width blocked-cell approximation that the plot must never cover.
    const preExistingWays = (rt.sim.state.roadWays ?? []).filter(
      (way) => way.source !== "depot-spur",
    );
    const covered = conservativeRoadRibbonBlockedCells(
      preExistingWays,
      rt.sim.state.terrain,
      COLONY.transit.depotRoadRibbonClearanceCells,
    );
    const overlaps = plotRoadOverlapCells(pad, covered);
    expect(
      overlaps,
      `depot overlaps conservative road-footprint cells: ${overlaps.join(" ")}`,
    ).toEqual([]);
  });

  it("fences the depot spur off from ambient car traffic (buses never meet a car on it)", () => {
    const rt = new ColonyRuntime();
    const spur = rt.sim.state.busDepotSpurCells;
    expect(spur && spur.size).toBeGreaterThan(0); // the spur was recorded as a no-car zone
    // Drive real traffic for a long stretch; no car may ever occupy a spur cell.
    const rng = new RNG(7);
    for (let i = 0; i < 400; i++) {
      updateTraffic(rt.sim.state, rng, 1.5);
      for (const car of rt.sim.state.cars)
        expect(spur!.has(`${Math.round(car.x)},${Math.round(car.y)}`)).toBe(
          false,
        );
    }
  });
});
