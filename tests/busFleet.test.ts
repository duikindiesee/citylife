import { describe, expect, it } from "vitest";
import {
  makeFleet,
  stepFleet,
  makeFleetGeometry,
  busPose,
  shiftMinutes,
  type BusFleet,
  type FleetConfig,
  type FleetGeometry,
  type FleetPaths,
} from "../src/colony/transit/busFleet";
import { buildPath } from "../src/colony/transit/path";

// Spec 149 — the pure dispatch machine: operating hours, the staggered-dispatch gate, dwells,
// break rotation and the overnight return, stepped a sim-minute at a time like the runtime does.

const geom: FleetGeometry = {
  loopLen: 100,
  joinT: 0,
  spurLen: 4,
  bayLen: [10, 10, 10, 10, 10],
  stopsFromJoin: [20, 50, 80],
};

const cfg: FleetConfig = {
  busesOwned: 5,
  baysTotal: 10,
  firstDepartureMin: 8 * 60,
  lastServiceMin: 23 * 60,
  busSpeedCellsPerMin: 1,
  stopDwellMin: 2,
  depotBoardMin: 3,
  breakMin: 30,
  lapsPerShift: 1,
  bayPullOutCells: 3,
};

/** Step minute-by-minute over [from, to) sim-minutes, running `check` after every step. */
function run(
  fleet: BusFleet,
  from: number,
  to: number,
  check?: (m: number) => void,
): void {
  for (let m = from; m < to; m++) {
    stepFleet(fleet, 1, m, geom, cfg);
    check?.(m);
  }
}

/** Buses that have been released from the depot but not yet reached their first stop —
 *  the stagger rule says there can never be more than one. */
function preFirstStopCount(fleet: BusFleet): number {
  return fleet.buses.filter(
    (b) =>
      b.mode === "bay-out" ||
      b.mode === "depot-stop-out" ||
      b.mode === "spur-out" ||
      (b.mode === "service" && !b.reachedFirstStop),
  ).length;
}

describe("bus fleet state machine", () => {
  it("keeps every bus parked overnight and dispatches the first at exactly 08:00", () => {
    const fleet = makeFleet(cfg);
    run(fleet, 0, 480, () => {
      expect(fleet.buses.every((b) => b.mode === "parked")).toBe(true);
      expect(fleet.gateHeldBy).toBeNull();
    });
    stepFleet(fleet, 1, 480, geom, cfg); // 08:00 sharp
    expect(fleet.buses[0]!.mode).toBe("bay-out");
    expect(fleet.gateHeldBy).toBe(0);
    for (let i = 1; i < 5; i++) expect(fleet.buses[i]!.mode).toBe("parked");
  });

  it("holds the second bus until the first reaches its first stop (the stagger gate)", () => {
    const fleet = makeFleet(cfg);
    run(fleet, 0, 481);
    // Bus 0's run to the first stop: bay 10 + board 3 + spur 4 + 20 loop cells = 37 minutes.
    run(fleet, 481, 510, () => {
      expect(fleet.buses[1]!.mode).toBe("parked");
      expect(fleet.gateHeldBy).toBe(0);
    });
    run(fleet, 510, 530);
    expect(fleet.buses[0]!.reachedFirstStop).toBe(true);
    expect(fleet.buses[1]!.mode).not.toBe("parked"); // released once bus 0 arrived
  });

  it("never has more than one dispatched-but-pre-first-stop bus, and all five roll out in order", () => {
    const fleet = makeFleet(cfg);
    const dispatched: number[] = [];
    run(fleet, 0, 700, () => {
      expect(preFirstStopCount(fleet)).toBeLessThanOrEqual(1);
      for (const b of fleet.buses)
        if (b.mode === "bay-out" && !dispatched.includes(b.id))
          dispatched.push(b.id);
    });
    expect(dispatched.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("dwells doors-open at stops, comes home after its lap, takes its break, then rolls again", () => {
    const fleet = makeFleet(cfg);
    let sawDwell = false;
    let parkedAt = -1;
    run(fleet, 0, 700, (m) => {
      const b = fleet.buses[0]!;
      if (b.mode === "service" && b.dwell > 0) sawDwell = true;
      if (parkedAt < 0 && b.mode === "parked" && b.breakUntil > 0) parkedAt = m;
    });
    expect(sawDwell).toBe(true);
    // Shift: bay 10 + board 3 + spur 4 + lap 100 + 3 stop dwells 6 + spur 4 + board 3 + bay 10 = 140.
    expect(parkedAt).toBeGreaterThan(480 + 130);
    expect(parkedAt).toBeLessThan(480 + 160);
    const b0 = fleet.buses[0]!;
    expect(b0.breakUntil).toBe(parkedAt + cfg.breakMin);
    // After the break the rotation brings bus 0 back out through the same gate.
    let redispatched = false;
    run(fleet, 700, 900, () => {
      if (fleet.buses[0]!.mode === "bay-out") redispatched = true;
    });
    expect(redispatched).toBe(true);
  });

  it("drains the streets by closing time and parks everyone overnight in their own bays", () => {
    const fleet = makeFleet(cfg);
    run(fleet, 0, 23 * 60);
    // No NEW shift starts after (close - shift length); shiftMinutes covers the whole round trip.
    expect(shiftMinutes(geom, cfg)).toBe(140);
    run(fleet, 23 * 60, 26 * 60);
    for (const b of fleet.buses) expect(b.mode).toBe("parked");
    expect(fleet.gateHeldBy).toBeNull();
    // Only the five owned buses exist — bays 5..9 stay empty for future purchases.
    expect(fleet.buses.length).toBe(cfg.busesOwned);
  });

  it("stays parked all day when the loop is too long for a shift to fit the hours", () => {
    const hugeGeom: FleetGeometry = { ...geom, loopLen: 100000 };
    const fleet = makeFleet(cfg);
    for (let m = 0; m < 600; m++) stepFleet(fleet, 1, m, hugeGeom, cfg);
    // lastDispatch clamps to just past opening, so the morning bus still leaves...
    expect(fleet.buses[0]!.mode).not.toBe("parked");
    // ...but the gate never releases (first stop is 20 cells out of a 100k lap it will not finish
    // today), so nobody else is dispatched — the stagger rule contains the pathological seed.
    expect(fleet.buses.slice(1).every((b) => b.mode === "parked")).toBe(true);
  });
});

describe("fleet geometry + poses", () => {
  // A 100-cell square loop, a 4-cell spur joining at (0,0), five 10-cell straight bay paths.
  const loop = buildPath(
    [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 25 },
      { x: 0, y: 25 },
    ],
    true,
  );
  const spur = buildPath(
    [
      { x: 0, y: -4 },
      { x: 0, y: 0 },
    ],
    false,
  );
  const bays = [0, 1, 2, 3, 4].map((k) =>
    buildPath(
      [
        { x: 0, y: -4 },
        { x: k + 1, y: -4 },
        { x: k + 1, y: -14 },
      ],
      false,
    ),
  );
  const paths: FleetPaths = { loop, spur, bays, gateHeading: Math.PI / 2 };

  it("projects the join point and stops onto the loop in ascending join-relative order", () => {
    const g = makeFleetGeometry(loop, spur, bays, [
      { x: 25, y: 10 }, // right edge, 35 cells after the join
      { x: 10, y: 0 }, // top edge, 10 cells after the join
    ]);
    expect(g.loopLen).toBe(100);
    expect(g.joinT).toBe(0);
    expect(g.spurLen).toBe(4);
    expect(g.stopsFromJoin).toEqual([10, 35]);
    expect(g.bayLen).toEqual([11, 12, 13, 14, 15]); // gate run + the 10-cell bay leg
  });

  it("poses: parked sits at the bay nose; bay-out REVERSES down the bay leg nose-in", () => {
    const g = makeFleetGeometry(loop, spur, bays, [{ x: 10, y: 0 }]);
    const parked = busPose(
      { ...makeFleet(cfg).buses[0]!, mode: "parked" },
      paths,
      g,
      cfg,
    );
    expect(parked.x).toBeCloseTo(1);
    expect(parked.y).toBeCloseTo(-14);
    expect(parked.moving).toBe(false);
    const backing = busPose(
      { ...makeFleet(cfg).buses[0]!, mode: "bay-out", t: 1 },
      paths,
      g,
      cfg,
    );
    expect(backing.reversing).toBe(true);
    expect(backing.y).toBeCloseTo(-13); // moved 1 cell gate-ward out of the bay...
    expect(Math.cos(backing.heading)).toBeCloseTo(0, 5); // ...nose still pointing down the bay (-y)
    expect(Math.sin(backing.heading)).toBeCloseTo(-1, 5);
    const dwelling = busPose(
      { ...makeFleet(cfg).buses[0]!, mode: "service", lapT: 10, dwell: 2 },
      paths,
      g,
      cfg,
    );
    expect(dwelling.doorsOpen).toBe(true);
    expect(dwelling.moving).toBe(false);
    expect(dwelling.x).toBeCloseTo(10);
    expect(dwelling.y).toBeCloseTo(0);
  });
});
