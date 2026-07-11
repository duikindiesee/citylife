import { describe, expect, it } from "vitest";
import {
  makeFleet,
  stepFleet,
  makeFleetGeometry,
  busPose,
  shiftMinutes,
  inCorridor,
  type BusFleet,
  type FleetConfig,
  type FleetGeometry,
  type FleetPaths,
} from "../src/colony/transit/busFleet";
import { buildPath } from "../src/colony/transit/path";

// Spec 149 — the pure dispatch machine: operating hours, the 2nd-stop spacing gate, the single-
// occupancy depot corridor (the collision fix), random free-bay parking, dwells, break rotation and
// the overnight return, stepped a sim-minute at a time like the runtime does.

const geom: FleetGeometry = {
  loopLen: 100,
  joinT: 0,
  spurLen: 4,
  bayLen: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
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

const corridorCount = (fleet: BusFleet): number =>
  fleet.buses.filter((b) => inCorridor(b.mode)).length;

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
    expect(fleet.corridorBusyBy).toBe(0);
    for (let i = 1; i < 5; i++) expect(fleet.buses[i]!.mode).toBe("parked");
  });

  it("NEVER lets two buses share the depot corridor — the collision fix, all day", () => {
    const fleet = makeFleet(cfg);
    run(fleet, 0, 26 * 60, () => {
      // The single-lane spur + gate + apron admits at most ONE bus at a time, so a departing and a
      // returning bus can never meet head-on. This is the invariant the operator asked for.
      expect(corridorCount(fleet)).toBeLessThanOrEqual(1);
    });
  });

  it("holds the next bus until the running one clears its SECOND stop (route spacing)", () => {
    const fleet = makeFleet(cfg);
    run(fleet, 0, 481); // bus 0 dispatched
    // Step through bus 0's FIRST shift only: while it has cleared fewer than two stops, the gate is
    // held and no other bus may leave. Stop asserting the instant it clears the 2nd stop.
    let released = false;
    let heldWhileUnderTwo = true;
    for (let m = 481; m < 700 && !released; m++) {
      stepFleet(fleet, 1, m, geom, cfg);
      const b0 = fleet.buses[0]!;
      if (b0.stopsReached < 2) {
        if (fleet.gateHeldBy !== 0) heldWhileUnderTwo = false;
        if (!fleet.buses.slice(1).every((b) => b.mode === "parked"))
          heldWhileUnderTwo = false;
      } else {
        released = true;
      }
    }
    expect(heldWhileUnderTwo).toBe(true);
    expect(released).toBe(true);
    // Once the 2nd stop is cleared the gate opens; bus 1 rolls out within the next stretch.
    run(fleet, 700, 760);
    expect(fleet.buses[1]!.mode).not.toBe("parked");
  });

  it("rolls all five out over the day, in order, one corridor entry at a time", () => {
    const fleet = makeFleet(cfg);
    const dispatched: number[] = [];
    run(fleet, 0, 900, () => {
      expect(corridorCount(fleet)).toBeLessThanOrEqual(1);
      for (const b of fleet.buses)
        if (b.mode === "bay-out" && !dispatched.includes(b.id))
          dispatched.push(b.id);
    });
    expect(dispatched.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("dwells doors-open at stops, comes home after its lap, breaks, then rolls again", () => {
    const fleet = makeFleet(cfg);
    let sawDwell = false;
    let parkedAt = -1;
    let breakUntilAtPark = -1;
    run(fleet, 0, 900, (m) => {
      const b = fleet.buses[0]!;
      if (b.mode === "service" && b.dwell > 0) sawDwell = true;
      if (parkedAt < 0 && b.mode === "parked" && b.breakUntil > 0) {
        parkedAt = m;
        breakUntilAtPark = b.breakUntil; // capture at the FIRST park (it re-parks later)
      }
    });
    expect(sawDwell).toBe(true);
    expect(parkedAt).toBeGreaterThan(480 + 120);
    expect(breakUntilAtPark).toBe(parkedAt + cfg.breakMin);
    // After its break the rotation brings a bus back out through the depot again.
    let redispatched = false;
    run(fleet, 900, 1400, () => {
      if (fleet.buses.some((b) => b.mode === "bay-out")) redispatched = true;
    });
    expect(redispatched).toBe(true);
  });

  it("parks a returning bus in a random FREE bay — bays stay distinct and in range", () => {
    const fleet = makeFleet(cfg);
    let sawNonOwnBay = false;
    run(fleet, 0, 24 * 60, () => {
      const held = fleet.buses.filter((b) => b.bay >= 0).map((b) => b.bay);
      // No two buses ever claim the same bay, and every bay index is valid.
      expect(new Set(held).size).toBe(held.length);
      for (const k of held) expect(k).toBeGreaterThanOrEqual(0);
      for (const k of held) expect(k).toBeLessThan(cfg.baysTotal);
      // Over the day at least one bus parks somewhere other than its starting bay (the lottery works).
      for (const b of fleet.buses)
        if (b.mode === "parked" && b.bay !== b.id) sawNonOwnBay = true;
    });
    expect(sawNonOwnBay).toBe(true);
  });

  it("drains the streets by closing time and parks everyone overnight", () => {
    const fleet = makeFleet(cfg);
    run(fleet, 0, 23 * 60);
    expect(shiftMinutes(geom, cfg)).toBe(140);
    run(fleet, 23 * 60, 27 * 60);
    for (const b of fleet.buses) expect(b.mode).toBe("parked");
    expect(fleet.gateHeldBy).toBeNull();
    expect(fleet.corridorBusyBy).toBeNull();
    const bays = fleet.buses.map((b) => b.bay);
    expect(new Set(bays).size).toBe(bays.length); // everyone in a distinct bay
    expect(fleet.buses.length).toBe(cfg.busesOwned);
  });

  it("stays contained when the loop is too long for a shift to fit the hours", () => {
    const hugeGeom: FleetGeometry = { ...geom, loopLen: 100000 };
    const fleet = makeFleet(cfg);
    for (let m = 0; m < 600; m++) stepFleet(fleet, 1, m, hugeGeom, cfg);
    // The morning bus still leaves, but it never clears its 2nd stop (200 cells of a 100k lap it will
    // not finish today), so the gate never opens and nobody else is dispatched.
    expect(fleet.buses[0]!.mode).not.toBe("parked");
    expect(fleet.buses.slice(1).every((b) => b.mode === "parked")).toBe(true);
    expect(corridorCount(fleet)).toBeLessThanOrEqual(1);
  });
});

describe("fleet geometry + poses", () => {
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
      { x: 25, y: 10 },
      { x: 10, y: 0 },
    ]);
    expect(g.loopLen).toBe(100);
    expect(g.joinT).toBe(0);
    expect(g.spurLen).toBe(4);
    expect(g.stopsFromJoin).toEqual([10, 35]);
    expect(g.bayLen).toEqual([11, 12, 13, 14, 15]);
  });

  it("poses index by b.bay: parked sits at the claimed bay nose; bay-out reverses out of it", () => {
    const g = makeFleetGeometry(loop, spur, bays, [{ x: 10, y: 0 }]);
    // A bus that parked in bay 3 sits at bay 3's nose, not bay 0's.
    const parked = busPose(
      { ...makeFleet(cfg).buses[0]!, mode: "parked", bay: 3 },
      paths,
      g,
      cfg,
    );
    expect(parked.x).toBeCloseTo(4); // bay 3 nose x = k+1 = 4
    expect(parked.y).toBeCloseTo(-14);
    expect(parked.moving).toBe(false);
    const backing = busPose(
      { ...makeFleet(cfg).buses[0]!, mode: "bay-out", bay: 0, t: 1 },
      paths,
      g,
      cfg,
    );
    expect(backing.reversing).toBe(true);
    expect(backing.y).toBeCloseTo(-13);
    expect(Math.cos(backing.heading)).toBeCloseTo(0, 5);
    expect(Math.sin(backing.heading)).toBeCloseTo(-1, 5);
    const dwelling = busPose(
      { ...makeFleet(cfg).buses[0]!, mode: "service", bay: -1, lapT: 10, dwell: 2 },
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
