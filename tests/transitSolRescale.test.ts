import { describe, expect, it } from "vitest";
import { COLONY } from "../src/colony/config";
import {
  shiftMinutes,
  type FleetGeometry,
} from "../src/colony/transit/busFleet";
import { MINUTES_PER_SOL } from "../src/colony/sol";

// Spec 150 PR2 — the fleet moved from the speed-scaled sim clock onto canonical sol time, and
// config.transit was rescaled to match. tests/busFleet.test.ts drives its OWN fixture config, so
// these locks cover the REAL COLONY.transit values the live world runs on.

/** A live-scale route: the shipped loop is ~1350 cells (5.4 km) with a short depot spur and bays. */
const liveGeometry: FleetGeometry = {
  loopLen: 1350,
  joinT: 0,
  spurLen: 12,
  bayLen: [5, 5, 5, 5, 5],
  stopsFromJoin: [120, 300, 480, 660, 840, 1020, 1180, 1300],
};

describe("spec 150 PR2 — transit rescale onto sol time", () => {
  it("locks the rescaled transit config", () => {
    expect(COLONY.transit.busSpeedCellsPerMin).toBe(28);
    expect(COLONY.transit.stopDwellMin).toBe(1.5);
    expect(COLONY.transit.depotBoardMin).toBe(2);
    expect(COLONY.transit.breakMin).toBe(18);
    expect(COLONY.transit.firstDepartureMin).toBe(300); // 05:00
    expect(COLONY.transit.lastServiceMin).toBe(1410); // 23:30
  });

  it("keeps the service window inside one sol day", () => {
    expect(COLONY.transit.firstDepartureMin).toBeGreaterThanOrEqual(0);
    expect(COLONY.transit.lastServiceMin).toBeLessThanOrEqual(MINUTES_PER_SOL);
    expect(COLONY.transit.lastServiceMin).toBeGreaterThan(
      COLONY.transit.firstDepartureMin,
    );
  });

  it("fits a whole shift inside the service window — the dispatch gatekeeper", () => {
    // busFleet.ts stops dispatching once a shift no longer fits before lastServiceMin, so a shift
    // that overruns the window would silently strand the fleet in its bays.
    const shift = shiftMinutes(liveGeometry, COLONY.transit);
    expect(shift).toBeGreaterThan(0);
    expect(COLONY.transit.firstDepartureMin + shift).toBeLessThan(
      COLONY.transit.lastServiceMin,
    );
  });

  it("leaves a dispatch window wide enough to stagger every owned bus", () => {
    const shift = shiftMinutes(liveGeometry, COLONY.transit);
    const lastDispatch = COLONY.transit.lastServiceMin - shift;
    const dispatchWindow = lastDispatch - COLONY.transit.firstDepartureMin;
    expect(dispatchWindow).toBeGreaterThan(0);
    // Every owned bus must be able to take a staggered shift (plus its bay break) inside the window.
    expect(dispatchWindow).toBeGreaterThan(
      COLONY.transit.busesOwned * COLONY.transit.breakMin,
    );
  });
});
