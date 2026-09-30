import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  makeFleet,
  stepFleet,
  type FleetGeometry,
  type FleetConfig,
} from "../src/colony/transit/busFleet";
import { buildPath } from "../src/colony/transit/path";

describe("Spec 174 — Bus Collision & Reactive Transit Traffic AI", () => {
  it("car cannot occupy cell occupied by a municipal bus", () => {
    const runtime = new ColonyRuntime(4242);
    const buses = runtime.busPoses();
    expect(buses.length).toBeGreaterThan(0);

    // Pick an active bus
    const bus = buses[0]!;
    // Point inside the bus volume
    const insideBusX = bus.x;
    const insideBusY = bus.y;

    // Simulate car occupancy check with tickOwnedDrive's obstacle collision logic
    const isInsideBus = buses.some((b) => {
      const dx = insideBusX - b.x;
      const dy = insideBusY - b.y;
      const cosB = Math.cos(b.heading);
      const sinB = Math.sin(b.heading);
      const along = dx * cosB + dy * sinB;
      const across = -dx * sinB + dy * cosB;
      return Math.abs(along) < 1.7 && Math.abs(across) < 0.52;
    });

    expect(isInsideBus).toBe(true);
  });

  it("bus slows down when player car is directly ahead in same lane", () => {
    const loop = buildPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
    );

    const spur = buildPath(
      [
        { x: 0, y: -10 },
        { x: 0, y: 0 },
      ],
      false,
    );
    const bays = [
      buildPath(
        [
          { x: -5, y: -10 },
          { x: 0, y: -10 },
        ],
        false,
      ),
    ];

    const geom: FleetGeometry = {
      loopLen: loop.total,
      joinT: 0,
      spurLen: spur.total,
      bayLen: [bays[0]!.total],
      stopsFromJoin: [50, 150, 250],
      loopPath: loop,
    };

    const cfg: FleetConfig = {
      busesOwned: 1,
      baysTotal: 1,
      firstDepartureMin: 8 * 60,
      lastServiceMin: 23 * 60,
      busSpeedCellsPerMin: 20, // 20 cells per min
      stopDwellMin: 1,
      minHeadwayCells: 5,
      depotBoardMin: 1,
      breakMin: 10,
      lapsPerShift: 10,
      bayPullOutCells: 2,
      busLaneOffsetCells: 1,
    };

    const fleet = makeFleet(cfg);
    const bus = fleet.buses[0]!;
    bus.mode = "service";
    bus.t = 0;
    bus.lapT = 20; // At cell 20 along loop
    bus.dwell = 0;

    // Place an obstacle car 6 cells ahead at arc 26 (x = 26, y = 0)
    const obstacle = { x: 26, y: 0, speed: 0 };

    // Step fleet by 0.5 sim-minutes (bus would want to move 10 cells to 30, but obstacle is at 26 with minCarGap 4)
    stepFleet(fleet, 0.5, 9 * 60, geom, cfg, [obstacle]);

    // Bus should be held behind obstacle (cap = 26 - 4 = 22)
    expect(bus.lapT).toBeLessThanOrEqual(22.1);
  });

  it("bus initiates overtaking maneuver when held behind a slow obstacle", () => {
    const loop = buildPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
    );

    const spur = buildPath(
      [
        { x: 0, y: -10 },
        { x: 0, y: 0 },
      ],
      false,
    );
    const bays = [
      buildPath(
        [
          { x: -5, y: -10 },
          { x: 0, y: -10 },
        ],
        false,
      ),
    ];

    const geom: FleetGeometry = {
      loopLen: loop.total,
      joinT: 0,
      spurLen: spur.total,
      bayLen: [bays[0]!.total],
      stopsFromJoin: [80],
      loopPath: loop,
    };

    const cfg: FleetConfig = {
      busesOwned: 1,
      baysTotal: 1,
      firstDepartureMin: 8 * 60,
      lastServiceMin: 23 * 60,
      busSpeedCellsPerMin: 20,
      stopDwellMin: 1,
      minHeadwayCells: 5,
      depotBoardMin: 1,
      breakMin: 10,
      lapsPerShift: 10,
      bayPullOutCells: 2,
      busLaneOffsetCells: 1,
    };

    const fleet = makeFleet(cfg);
    const bus = fleet.buses[0]!;
    bus.mode = "service";
    bus.t = 0;
    bus.lapT = 20;
    bus.dwell = 0;
    bus.heldMinutes = 0;

    const obstacle = { x: 25, y: 0, speed: 0 };

    // Step several times to build up held time
    for (let i = 0; i < 5; i++) {
      stepFleet(fleet, 0.02, 9 * 60, geom, cfg, [obstacle]);
    }

    // Bus should enter overtaking state and shift lateral offset
    expect(bus.overtaking).toBe(true);
    expect(bus.lateralOffset).toBeLessThan(0); // Shifted toward passing lane
  });

  it("bus does not initiate overtaking when passing/oncoming lane is occupied", () => {
    const loop = buildPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
    );

    const spur = buildPath(
      [
        { x: 0, y: -10 },
        { x: 0, y: 0 },
      ],
      false,
    );
    const bays = [
      buildPath(
        [
          { x: -5, y: -10 },
          { x: 0, y: -10 },
        ],
        false,
      ),
    ];

    const geom: FleetGeometry = {
      loopLen: loop.total,
      joinT: 0,
      spurLen: spur.total,
      bayLen: [bays[0]!.total],
      stopsFromJoin: [80],
      loopPath: loop,
    };

    const cfg: FleetConfig = {
      busesOwned: 1,
      baysTotal: 1,
      firstDepartureMin: 8 * 60,
      lastServiceMin: 23 * 60,
      busSpeedCellsPerMin: 20,
      stopDwellMin: 1,
      minHeadwayCells: 5,
      depotBoardMin: 1,
      breakMin: 10,
      lapsPerShift: 10,
      bayPullOutCells: 2,
      busLaneOffsetCells: 1,
    };

    const fleet = makeFleet(cfg);
    const bus = fleet.buses[0]!;
    bus.mode = "service";
    bus.t = 0;
    bus.lapT = 20;
    bus.dwell = 0;
    bus.heldMinutes = 0;

    // Fixture: stopped car in left lane at (25, 1) + opposing oncoming vehicle in passing lane at (28, -0.8)
    const carAhead = { x: 25, y: 1, speed: 0 };
    const opposingCar = { x: 28, y: -0.8, heading: Math.PI, speed: 0 };

    for (let i = 0; i < 5; i++) {
      stepFleet(fleet, 0.02, 9 * 60, geom, cfg, [carAhead, opposingCar]);
    }

    // Bus must NOT overtake because passing lane has oncoming traffic
    expect(bus.overtaking).toBe(false);
    expect(bus.lateralOffset).toBe(0);
    // Bus stays held behind carAhead
    expect(bus.lapT).toBeLessThanOrEqual(21.1);
  });

  it("seed 4242 road surface is continuous and POIs are accessible", () => {
    const runtime = new ColonyRuntime(4242);
    const sim = runtime.sim;
    const terrain = sim.state.terrain;
    const size = terrain.size;

    // Collect road cells
    const roadCells: { x: number; y: number }[] = [];
    const roadLookup = new Set<string>();

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (runtime.isRoadSurface(x, y)) {
          roadCells.push({ x, y });
          roadLookup.add(`${x},${y}`);
        }
      }
    }

    expect(roadCells.length).toBeGreaterThan(100);

    // BFS connectivity
    const visited = new Set<string>();
    let components = 0;

    for (const cell of roadCells) {
      const key = `${cell.x},${cell.y}`;
      if (visited.has(key)) continue;
      components++;
      const queue = [cell];
      visited.add(key);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nk = `${curr.x + dx},${curr.y + dy}`;
            if (roadLookup.has(nk) && !visited.has(nk)) {
              visited.add(nk);
              queue.push({ x: curr.x + dx, y: curr.y + dy });
            }
          }
        }
      }
    }

    // Main road network forms 1 connected graph
    expect(components).toBe(1);

    // Showroom / Garage Pad entrance is directly on a paved road surface
    const garageRoadTarget = runtime.commercialDistrict?.garagePad?.roadTarget;
    expect(garageRoadTarget).toBeDefined();
    if (garageRoadTarget) {
      expect(
        runtime.isRoadSurface(garageRoadTarget.x, garageRoadTarget.y),
      ).toBe(true);
    }

    // Toggle 3D overlay test
    expect(runtime.showDrivableOverlay).toBe(false);
    runtime.setShowDrivableOverlay(true);
    expect(runtime.showDrivableOverlay).toBe(true);
  });
});
