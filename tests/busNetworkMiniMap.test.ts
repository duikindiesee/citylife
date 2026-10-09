import { describe, expect, it } from "vitest";
import { buildBusNetworkMiniMapModel } from "../src/colony/ui/busNetworkMiniMapModel";
import { computeBusNetworkMiniMapSignal } from "../src/colony/ui/BusNetworkMiniMap";
import { ColonyRuntime } from "../src/colony/runtime";
import type { RoadWay } from "../src/colony/render/roadRibbon";

const ways: RoadWay[] = [
  {
    kind: "street",
    width: 3,
    source: "builder",
    path: [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ],
  },
  {
    kind: "street",
    width: 3,
    source: "depot-spur",
    path: [
      { x: 20, y: 10 },
      { x: 20, y: 14 },
    ],
  },
];

describe("always-visible bus network minimap model", () => {
  it("projects every road way, route stop, depot and live coach into the fixed viewport", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [
        { x: 12, y: 10 },
        { x: 18, y: 10 },
      ],
      depot: { x: 20, y: 14 },
      buses: [
        { id: 0, x: 15, y: 10 },
        { id: 1, x: 20, y: 12 },
      ],
      player: { x: 16, y: 10 },
      width: 200,
      height: 132,
      padding: 8,
    });
    expect(model.roads).toHaveLength(2);
    expect(model.stops).toHaveLength(2);
    expect(model.buses).toHaveLength(2);
    expect(model.busClusters.reduce((sum, c) => sum + c.ids.length, 0)).toBe(2);
    expect(model.depot).not.toBeNull();
    expect(model.player).not.toBeNull();
    expect(model.player!.outOfBounds).toBe(false);
    for (const p of [
      ...model.stops,
      ...model.buses,
      model.depot!,
      model.player!,
    ]) {
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThanOrEqual(192);
      expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.y).toBeLessThanOrEqual(124);
    }
  });

  it("clusters overlapping coaches and preserves the visible fleet count", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [0, 1, 2, 3, 4].map((id) => ({ id, x: 15, y: 10 })),
      width: 200,
      height: 132,
      padding: 8,
    });
    expect(model.busClusters).toHaveLength(1);
    expect(model.busClusters[0]!.ids).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps a stable non-zero scale for a one-cell network", () => {
    const model = buildBusNetworkMiniMapModel({
      ways: [{ kind: "street", width: 3, path: [{ x: 4, y: 4 }] }],
      routeStops: [],
      depot: null,
      buses: [],
      width: 180,
      height: 120,
      padding: 8,
    });
    expect(model.roads[0]!.points).toMatch(/^\d/);
    expect(model.bounds.spanX).toBeGreaterThan(0);
    expect(model.bounds.spanY).toBeGreaterThan(0);
  });

  it("keeps network bounds fixed as moving markers travel and indicates off-map positions", () => {
    const first = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [{ x: 12, y: 10 }],
      depot: { x: 20, y: 14 },
      buses: [{ id: 0, x: 15, y: 10 }],
      player: { x: 16, y: 10 },
      width: 200,
      height: 132,
      padding: 8,
    });
    const moved = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [{ x: 12, y: 10 }],
      depot: { x: 20, y: 14 },
      buses: [{ id: 0, x: 500, y: 400 }],
      player: { x: -100, y: 900 },
      width: 200,
      height: 132,
      padding: 8,
    });

    expect(moved.bounds).toEqual(first.bounds);
    expect(moved.roads).toEqual(first.roads);
    expect(moved.buses[0]!.outOfBounds).toBe(true);
    expect(moved.player!.outOfBounds).toBe(true);
    expect(moved.buses[0]!.x).toBe(192);
    expect(moved.buses[0]!.y).toBe(124);
    expect(moved.player!.x).toBe(8);
    expect(moved.player!.y).toBe(124);
  });

  it("projects stationary parked cars alongside walking player and remote peers", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      player: { x: 14, y: 10 },
      parkedCar: { x: 12, y: 10 },
      peers: [
        {
          participantId: "peer-1",
          username: "Alice",
          x: 18,
          y: 10,
          parkedCar: { x: 17, y: 10 },
        },
      ],
      width: 200,
      height: 132,
      padding: 8,
    });

    expect(model.player).not.toBeNull();
    expect(model.player!.outOfBounds).toBe(false);

    expect(model.peers).toHaveLength(1);
    expect(model.peers[0]!.participantId).toBe("peer-1");
    expect(model.peers[0]!.username).toBe("Alice");

    expect(model.parkedCars).toHaveLength(2);

    const localParked = model.parkedCars.find((c) => c.isLocal);
    expect(localParked).toBeDefined();
    expect(localParked!.id).toBe("local-parked-car");
    expect(localParked!.ownerName).toBe("You");
    expect(localParked!.outOfBounds).toBe(false);

    const peerParked = model.parkedCars.find((c) => !c.isLocal);
    expect(peerParked).toBeDefined();
    expect(peerParked!.id).toBe("peer-parked-peer-1");
    expect(peerParked!.ownerName).toBe("Alice");
    expect(peerParked!.outOfBounds).toBe(false);
  });

  it("updates local walker projection coordinates while parked car remains strictly stationary", () => {
    const initialModel = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      player: { x: 12, y: 10 },
      parkedCar: { x: 12, y: 10 },
      peers: [
        {
          participantId: "peer-1",
          username: "Alice",
          x: 18,
          y: 10,
          parkedCar: { x: 17, y: 10 },
        },
      ],
      width: 200,
      height: 132,
      padding: 8,
    });

    const movedModel = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      player: { x: 15, y: 12 }, // Local walker moved 3 units east, 2 units south
      parkedCar: { x: 12, y: 10 }, // Stationary parked car
      peers: [
        {
          participantId: "peer-1",
          username: "Alice",
          x: 18,
          y: 10,
          parkedCar: { x: 17, y: 10 },
        },
      ],
      width: 200,
      height: 132,
      padding: 8,
    });

    // Walker position changed
    expect(movedModel.player!.x).not.toEqual(initialModel.player!.x);
    expect(movedModel.player!.y).not.toEqual(initialModel.player!.y);
    expect(movedModel.player!.x).toBeGreaterThan(initialModel.player!.x);

    // Parked cars remain strictly stationary at identical SVG coordinates
    const initialParked = initialModel.parkedCars.find((c) => c.isLocal)!;
    const movedParked = movedModel.parkedCars.find((c) => c.isLocal)!;
    expect(movedParked.x).toEqual(initialParked.x);
    expect(movedParked.y).toEqual(initialParked.y);

    const initialPeerParked = initialModel.parkedCars.find((c) => !c.isLocal)!;
    const movedPeerParked = movedModel.parkedCars.find((c) => !c.isLocal)!;
    expect(movedPeerParked.x).toEqual(initialPeerParked.x);
    expect(movedPeerParked.y).toEqual(initialPeerParked.y);
  });

  it("updates computeBusNetworkMiniMapSignal when local walker moves while parked car and peers remain stationary", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    // Park car and step out to walk
    runtime.exitOwnedCar();

    const sigInitial = computeBusNetworkMiniMapSignal(runtime);
    expect(sigInitial).toContain("foot:");

    // Stable signature while nothing moves
    expect(computeBusNetworkMiniMapSignal(runtime)).toBe(sigInitial);

    // Move walking position while parked car stays strictly stationary
    const currentWalk = runtime.getWalkingCell()!;
    (runtime as any).fpCameraCell = { x: currentWalk.x + 2, y: currentWalk.y + 1 };

    const sigMoved = computeBusNetworkMiniMapSignal(runtime);
    expect(sigMoved).not.toBe(sigInitial);
    expect(sigMoved).toContain(`foot:${(currentWalk.x + 2).toFixed(2)}:${(currentWalk.y + 1).toFixed(2)}`);

    // Verify parked car portion of the signature remained unchanged
    const parkedPose = runtime.getParkedCarPose()!;
    expect(sigMoved).toContain(`:${parkedPose.x.toFixed(2)}:${parkedPose.y.toFixed(2)}`);
  });
});
