import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  buildBusNetworkMiniMapModel,
  canShowPlayerLocationForAccount,
  resolveLocalPlayerMapPosition,
} from "../src/colony/ui/busNetworkMiniMapModel";
import {
  BusNetworkMiniMap,
  computeBusNetworkMiniMapSignal,
  resolveAuthenticatedPlayerMapMarker,
} from "../src/colony/ui/BusNetworkMiniMap";
import { createColonyLogoutHandler } from "../src/colony/ui/ColonyApp";
import { ColonyRuntime } from "../src/colony/runtime";
import type { RoadWay } from "../src/colony/render/roadRibbon";
import type { PresenceReadout, PresenceReadoutEntry, PresenceStamp } from "../src/colony/spatial/presenceReadout";

function makePresenceReadout(
  entries: Partial<PresenceReadoutEntry>[] = [],
  stamp?: Partial<PresenceStamp>,
): PresenceReadout {
  return {
    stamp: {
      worldSeed: 42,
      sol: 1,
      solHour: 12,
      solMinute: 0,
      layoutRevision: "rev-42",
      ...stamp,
    },
    entries: entries.map((e) => ({
      subjectId: "user-alice",
      displayName: "Alice",
      subjectKind: "player" as const,
      isLocal: true,
      resolution: "exact" as const,
      frame: { frameId: "f1", address: "a1", kind: "region" as const },
      ancestry: [],
      headingDegrees: 0,
      fix: {
        projectionFrameId: "f1",
        world: { x: 0, y: 0, z: 0 },
        cell: { x: 25, y: 35 },
        withinExtent: true,
      },
      ...e,
    })),
    hidden: [],
  };
}

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
      playerLocationAuthorized: true,
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
      playerLocationAuthorized: true,
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
      playerLocationAuthorized: true,
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
      playerLocationAuthorized: true,
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
      playerLocationAuthorized: true,
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
      playerLocationAuthorized: true,
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

  it("updates computeBusNetworkMiniMapSignal when peer carZ changes while cell and carX stay stationary", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-1");
    if (!runtime.sim.state.remoteRacers) {
      runtime.sim.state.remoteRacers = new Map();
    }
    const peer: any = {
      participantId: "peer-1",
      userId: "user-peer-1",
      username: "Peer Walker",
      cell: { x: 70, y: 70 },
      isPedestrian: true,
      carX: 8,
      carY: 0,
      carZ: 12,
      carHeading: 0,
    };
    runtime.sim.state.remoteRacers.set("peer-1", peer);

    const sigInitial = computeBusNetworkMiniMapSignal(runtime);
    expect(sigInitial).toContain("peer-1:70.00:70.00:ped:parked:8.00:12.00");

    // Stable signature when nothing changes
    expect(computeBusNetworkMiniMapSignal(runtime)).toBe(sigInitial);

    // Update carZ only while peer cell and carX stay strictly identical
    peer.carZ = 16;
    const sigZMoved = computeBusNetworkMiniMapSignal(runtime);
    expect(sigZMoved).not.toBe(sigInitial);
    expect(sigZMoved).toContain("peer-1:70.00:70.00:ped:parked:8.00:16.00");
  });

  it("updates computeBusNetworkMiniMapSignal and removes parked marker when peer transitions from walking to driving with retained parked coordinates", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-1");
    if (!runtime.sim.state.remoteRacers) {
      runtime.sim.state.remoteRacers = new Map();
    }
    const peer: any = {
      participantId: "peer-1",
      userId: "user-peer-1",
      username: "Peer Walker",
      cell: { x: 70, y: 70 },
      isPedestrian: true,
      carX: 8,
      carY: 0,
      carZ: 12,
      carHeading: 0,
    };
    runtime.sim.state.remoteRacers.set("peer-1", peer);

    const sigInitial = computeBusNetworkMiniMapSignal(runtime);
    expect(sigInitial).toContain("peer-1:70.00:70.00:ped:parked:8.00:12.00");

    // Mode-only transition to driving (isPedestrian = false) while retaining carX and carZ
    peer.isPedestrian = false;
    const sigDriving = computeBusNetworkMiniMapSignal(runtime);
    expect(sigDriving).not.toBe(sigInitial);
    expect(sigDriving).toContain("peer-1:70.00:70.00:veh:none");
    expect(sigDriving).not.toContain("parked:");

    // Mode transition back to pedestrian restores parked marker signal
    peer.isPedestrian = true;
    const sigRestored = computeBusNetworkMiniMapSignal(runtime);
    expect(sigRestored).toBe(sigInitial);
  });
});

describe("M2-04 / PR#544 fail-closed player location authorization & marker hygiene", () => {
  it("fails closed when playerLocationAuthorized is missing or false: local player and local parked car hidden, remote peers preserved", () => {
    // 1. Missing / undefined authorization
    const missingAuthModel = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      player: { x: 14, y: 10 },
      parkedCar: { x: 12, y: 10 },
      parkedCars: [
        { id: "local-1", ownerName: "Me", isLocal: true, x: 12, y: 10 },
        { id: "remote-1", ownerName: "Bob", isLocal: false, x: 16, y: 10 },
      ],
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

    expect(missingAuthModel.player).toBeNull();
    // Local parkedCar is hidden, local entry in parkedCars is filtered out
    expect(missingAuthModel.parkedCars.some((c) => c.isLocal)).toBe(false);
    // Remote parked car in parkedCars is preserved
    expect(missingAuthModel.parkedCars.some((c) => c.id === "remote-1")).toBe(true);
    // Remote peer and peer parked car are preserved
    expect(missingAuthModel.peers).toHaveLength(1);
    expect(missingAuthModel.peers[0]!.participantId).toBe("peer-1");
    expect(missingAuthModel.parkedCars.some((c) => c.id === "peer-parked-peer-1")).toBe(true);

    // 2. Explicit false authorization
    const falseAuthModel = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      player: { x: 14, y: 10 },
      parkedCar: { x: 12, y: 10 },
      playerLocationAuthorized: false,
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

    expect(falseAuthModel.player).toBeNull();
    expect(falseAuthModel.parkedCars.some((c) => c.isLocal)).toBe(false);
    expect(falseAuthModel.peers).toHaveLength(1);
    expect(falseAuthModel.parkedCars.some((c) => c.id === "peer-parked-peer-1")).toBe(true);

    // 3. Explicit true authorization
    const trueAuthModel = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      player: { x: 14, y: 10 },
      parkedCar: { x: 12, y: 10 },
      playerLocationAuthorized: true,
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

    expect(trueAuthModel.player).not.toBeNull();
    expect(trueAuthModel.player!.outOfBounds).toBe(false);
    expect(trueAuthModel.parkedCars.some((c) => c.isLocal)).toBe(true);
    expect(trueAuthModel.peers).toHaveLength(1);
  });

  it("canShowPlayerLocationForAccount enforces CityLife player flag and exact account key match", () => {
    // Positive case: player role and matching keys
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-42",
        runtimeAccountKey: "user-42",
      }),
    ).toBe(true);

    // Negative: admin / operator role (isCityLifePlayer === false)
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: false,
        authenticatedAccountKey: "user-admin",
        runtimeAccountKey: "user-admin",
      }),
    ).toBe(false);

    // Negative: account key mismatch
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-alice",
        runtimeAccountKey: "user-bob",
      }),
    ).toBe(false);

    // Negative: missing / null authenticated account key
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: null,
        runtimeAccountKey: "user-42",
      }),
    ).toBe(false);

    // Negative: missing / null runtime account key
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-42",
        runtimeAccountKey: null,
      }),
    ).toBe(false);

    // Negative: empty string keys
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "",
        runtimeAccountKey: "",
      }),
    ).toBe(false);

    // Negative: undefined flags
    expect(canShowPlayerLocationForAccount({})).toBe(false);
  });

  it("resolveLocalPlayerMapPosition resolves player marker position with strict fail-closed and citizen inspection gating", () => {
    // 1. Unauthorized fails closed
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: false,
        drivingPosition: { x: 10, y: 20 },
      }),
    ).toBeNull();

    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: false,
        cameraCell: { x: 10, y: 20 },
        activeCitizenId: "cit-1",
        operatorCitizenId: "cit-1",
      }),
    ).toBeNull();

    // 2. Authorized driving position
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        drivingPosition: { x: 15, y: 25 },
      }),
    ).toEqual({ x: 15, y: 25 });

    // 3. Authorized walking own citizen position
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        exactOwnPresence: { x: 12, y: 22 },
        cameraCell: { x: 10, y: 20 },
        activeCitizenId: "cit-mine",
        operatorCitizenId: "cit-mine",
      }),
    ).toEqual({ x: 12, y: 22 });

    // Fallback to cameraCell when exactOwnPresence is not available
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        cameraCell: { x: 10, y: 20 },
        activeCitizenId: "cit-mine",
        operatorCitizenId: "cit-mine",
      }),
    ).toEqual({ x: 10, y: 20 });

    // 4. Bystander citizen inspection: activeCitizenId !== operatorCitizenId -> null (does not display bystander as player marker)
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        cameraCell: { x: 50, y: 50 },
        activeCitizenId: "cit-bystander-9",
        operatorCitizenId: "cit-mine",
      }),
    ).toBeNull();
  });

  it("createColonyLogoutHandler synchronously invokes runtime.setOperatorUserId(null) and disables multiplayer", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-logout-test");
    expect((runtime as any).operatorUserId).toBe("user-logout-test");

    let loggedOutState = false;
    let authLogoutCalled = false;
    let reloadCalled = false;
    let beforeLogoutCalled = false;

    const mockAuth = {
      logout: async () => {
        authLogoutCalled = true;
      },
    } as any;

    const handler = createColonyLogoutHandler({
      runtime,
      auth: mockAuth,
      setLoggedOut: (val) => {
        loggedOutState = val;
      },
      onReload: () => {
        reloadCalled = true;
      },
    });

    await handler(() => {
      beforeLogoutCalled = true;
      // At beforeLogout invocation time, runtime.setOperatorUserId(null) must ALREADY have executed synchronously!
      expect((runtime as any).operatorUserId).toBeNull();
      expect(loggedOutState).toBe(true);
    });

    expect((runtime as any).operatorUserId).toBeNull();
    expect(loggedOutState).toBe(true);
    expect(beforeLogoutCalled).toBe(true);
    expect(authLogoutCalled).toBe(true);
    expect(reloadCalled).toBe(true);

    // Verify location authorization now fails closed for this runtime
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-logout-test",
        runtimeAccountKey: (runtime as any).getBoundOperatorUserId?.() ?? (runtime as any).operatorUserId ?? null,
      }),
    ).toBe(false);
  });
});

describe("mounted consumer controls for own-subject map binding (#544)", () => {
  it("own-player exact positive: matching authenticated account and exact presence yields visible player marker", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-alice";
    (runtime as any).fpCameraCell = { x: 25, y: 35 };

    const presenceReadout = makePresenceReadout([
      {
        isLocal: true,
        subjectId: "user-alice",
        resolution: "exact",
        fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
      },
    ]);

    const markers = resolveAuthenticatedPlayerMapMarker({
      playerLocationAuthorized: true,
      runtime,
      presenceReadout,
      authenticatedUserId: "user-alice",
    });

    expect(markers.player).toEqual({ x: 25, y: 35 });
  });

  it("inspected other citizen negative: viewing non-self citizen suppresses own player marker", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-bystander-bob"; // inspected non-self citizen
    (runtime as any).fpCameraCell = { x: 50, y: 60 };

    const markers = resolveAuthenticatedPlayerMapMarker({
      playerLocationAuthorized: true,
      runtime,
      authenticatedUserId: "user-alice",
    });

    expect(markers.player).toBeNull();
    expect(markers.parkedCar).toBeNull();
  });

  it("coarse fallback negative: coarse presence resolution fails closed to null marker", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-alice";

    const presenceReadout = makePresenceReadout([
      {
        isLocal: true,
        subjectId: "user-alice",
        resolution: "coarse",
        fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
      },
    ]);

    const markers = resolveAuthenticatedPlayerMapMarker({
      playerLocationAuthorized: true,
      runtime,
      presenceReadout,
      authenticatedUserId: "user-alice",
    });

    expect(markers.player).toBeNull();
    expect(markers.parkedCar).toBeNull();
  });

  it("wrong-subject negative: presence readout for different subject fails closed", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-alice";

    const presenceReadout = makePresenceReadout([
      {
        isLocal: true,
        subjectId: "user-eve",
        resolution: "exact",
        fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
      },
    ]);

    const markers = resolveAuthenticatedPlayerMapMarker({
      playerLocationAuthorized: true,
      runtime,
      presenceReadout,
      authenticatedUserId: "user-alice",
    });

    expect(markers.player).toBeNull();
    expect(markers.parkedCar).toBeNull();
  });

  it("logout negative: unauthorized player location returns null player and parked car", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).fpCameraCell = { x: 25, y: 35 };

    const markers = resolveAuthenticatedPlayerMapMarker({
      playerLocationAuthorized: false, // logged out / unauthorized
      runtime,
      authenticatedUserId: "user-alice",
    });

    expect(markers.player).toBeNull();
    expect(markers.parkedCar).toBeNull();
  });

  it("account-switch negative: authenticated account mismatch with runtime fails closed", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).fpCameraCell = { x: 25, y: 35 };

    const markers = resolveAuthenticatedPlayerMapMarker({
      playerLocationAuthorized: true,
      runtime,
      authenticatedUserId: "user-bob", // switch / mismatch
    });

    expect(markers.player).toBeNull();
    expect(markers.parkedCar).toBeNull();
  });

  it("held older response negative: generation/stamp mismatch or out-of-extent presence fails closed", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-alice";

    // 1. Generation/stamp mismatch: worldSeed mismatch
    const staleStampReadout = makePresenceReadout(
      [
        {
          isLocal: true,
          subjectId: "user-alice",
          resolution: "exact",
          fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
        },
      ],
      { worldSeed: 9999 },
    );
    expect(
      resolveAuthenticatedPlayerMapMarker({
        playerLocationAuthorized: true,
        runtime,
        presenceReadout: staleStampReadout,
        authenticatedUserId: "user-alice",
        expectedWorldSeed: 42,
      }).player,
    ).toBeNull();

    // 2. Out of extent fix
    const outOfExtentReadout = makePresenceReadout([
      {
        isLocal: true,
        subjectId: "user-alice",
        resolution: "exact",
        fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: false },
      },
    ]);
    expect(
      resolveAuthenticatedPlayerMapMarker({
        playerLocationAuthorized: true,
        runtime,
        presenceReadout: outOfExtentReadout,
        authenticatedUserId: "user-alice",
      }).player,
    ).toBeNull();

    // 3. Null fix
    const nullFixReadout = makePresenceReadout([
      {
        isLocal: true,
        subjectId: "user-alice",
        resolution: "exact",
        fix: null,
      },
    ]);
    expect(
      resolveAuthenticatedPlayerMapMarker({
        playerLocationAuthorized: true,
        runtime,
        presenceReadout: nullFixReadout,
        authenticatedUserId: "user-alice",
      }).player,
    ).toBeNull();
  });

  it("preserves genuine remote peer markers across all failure modes", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      player: null, // Local player failed closed
      parkedCar: null, // Local parked car failed closed
      playerLocationAuthorized: false,
      peers: [
        {
          participantId: "peer-remote-1",
          username: "Remote Racer 1",
          x: 20,
          y: 20,
          parkedCar: { x: 19, y: 20 },
        },
        {
          participantId: "peer-remote-2",
          username: "Remote Racer 2",
          x: 40,
          y: 40,
        },
      ],
      width: 200,
      height: 132,
      padding: 8,
    });

    expect(model.player).toBeNull();
    expect(model.parkedCars.some((c) => c.isLocal)).toBe(false);
    expect(model.peers).toHaveLength(2);
    expect(model.peers[0]!.participantId).toBe("peer-remote-1");
    expect(model.peers[1]!.participantId).toBe("peer-remote-2");
    expect(model.parkedCars.some((c) => c.id === "peer-parked-peer-remote-1")).toBe(true);
  });
});


describe("mounted consumer chain: ColonyApp -> BusNetworkMiniMap -> DOM (#544)", () => {
  function setupTestDOM() {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    class MockHTMLElement {}
    class MockHTMLIFrameElement extends MockHTMLElement {}
    for (const tag of [
      "Element",
      "HTMLElement",
      "HTMLDivElement",
      "HTMLButtonElement",
      "HTMLSpanElement",
      "SVGElement",
    ]) {
      (globalThis as Record<string, unknown>)[tag] = class extends MockHTMLElement {};
    }
    (globalThis as any).HTMLIFrameElement = MockHTMLIFrameElement;

    let mockDoc: Record<string, unknown>;
    const createMockNode = (tag: string) => {
      const nodeListeners = new Map<string, Set<(e: unknown) => void>>();
      const propsStore: Record<string, any> = {};
      const baseNode: Record<string, unknown> = {
        tagName: tag.toUpperCase(),
        style: {},
        children: [] as unknown[],
        parentNode: null,
        ownerDocument: mockDoc,
        nodeType: 1,
        getAttribute: (attr: string) => (baseNode[attr] as unknown) ?? null,
        setAttribute: (attr: string, val: any) => {
          baseNode[attr] = val;
          propsStore[attr] = val;
        },
        removeAttribute: (attr: string) => {
          delete baseNode[attr];
        },
        hasAttribute: (attr: string) => baseNode[attr] != null,
        addEventListener: (evt: string, fn: (e: unknown) => void) => {
          if (!nodeListeners.has(evt)) nodeListeners.set(evt, new Set());
          nodeListeners.get(evt)!.add(fn);
        },
        removeEventListener: (evt: string, fn: (e: unknown) => void) => {
          nodeListeners.get(evt)?.delete(fn);
        },
        appendChild: (child: Record<string, unknown>) => {
          child.parentNode = baseNode;
          (baseNode.children as unknown[]).push(child);
          return child;
        },
        removeChild: (child: Record<string, unknown>) => {
          const arr = baseNode.children as unknown[];
          const idx = arr.indexOf(child);
          if (idx !== -1) arr.splice(idx, 1);
          child.parentNode = null;
          return child;
        },
        insertBefore: (newChild: Record<string, unknown>, refChild: unknown) => {
          const arr = baseNode.children as unknown[];
          const idx = arr.indexOf(refChild);
          if (idx !== -1) arr.splice(idx, 0, newChild);
          else arr.push(newChild);
          newChild.parentNode = baseNode;
          return newChild;
        },
      };
      return new Proxy(baseNode, {
        get(target, prop, receiver) {
          if (prop in target) return Reflect.get(target, prop, receiver);
          return propsStore[prop as string];
        },
        set(target, prop, value, receiver) {
          if (prop in target) return Reflect.set(target, prop, value, receiver);
          propsStore[prop as string] = value;
          return true;
        },
      });
    };

    mockDoc = {
      nodeType: 9,
      createElement: (tag: string) => createMockNode(tag),
      createElementNS: (_ns: string, tag: string) => createMockNode(tag),
      createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
      addEventListener: () => {},
      removeEventListener: () => {},
      body: createMockNode("body"),
      defaultView: globalThis,
      HTMLIFrameElement: MockHTMLIFrameElement,
      activeElement: null,
    };
    const g = globalThis as Record<string, unknown>;
    g.window = globalThis;
    g.HTMLIFrameElement = MockHTMLIFrameElement;
    (globalThis as any).location = { search: "", origin: "http://localhost" };
    g.addEventListener = () => {};
    g.removeEventListener = () => {};
    g.dispatchEvent = () => {};
    g.document = mockDoc;
  }

  const findNode = (node: any, predicate: (n: any) => boolean): any => {
    if (!node) return null;
    if (predicate(node)) return node;
    for (const child of node.children || []) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  };

  it("mounts BusNetworkMiniMap in DOM and renders own player marker on exact authorized positive", async () => {
    setupTestDOM();
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-alice";
    (runtime as any).fpCameraCell = { x: 25, y: 35 };

    const presenceReadout = {
      stamp: { worldSeed: 42, sol: 1, solHour: 12, solMinute: 0 },
      entries: [
        {
          isLocal: true,
          subjectId: "user-alice",
          resolution: "exact" as const,
          frame: { frameId: "f1", address: "a1", kind: "region" as const },
          ancestry: [],
          headingDegrees: 0,
          fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
        },
      ],
      hidden: [],
    };

    const container = (globalThis as any).document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "Alice Wallet",
          presenceReadout: presenceReadout as any,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: true,
          authenticatedUserId: "user-alice",
        }),
      );
    });

    const playerMarker = findNode(
      container,
      (n) => n.getAttribute?.("data-testid") === "city-map-player-marker",
    );
    expect(playerMarker).not.toBeNull();
  });

  it("mounts BusNetworkMiniMap and verifies fail-closed marker refusal across negative conditions", async () => {
    setupTestDOM();
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";

    // 1. Inspected other citizen: fpCitizenId !== operatorCitizenId
    (runtime as any).fpCitizenId = "cit-bob";
    const container1 = (globalThis as any).document.createElement("div");
    const root1 = createRoot(container1);
    await act(async () => {
      root1.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "Alice",
          presenceReadout: null,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: true,
          authenticatedUserId: "user-alice",
        }),
      );
    });
    expect(findNode(container1, (n) => n.getAttribute?.("data-testid") === "city-map-player-marker")).toBeNull();

    // 2. Coarse fallback negative
    (runtime as any).fpCitizenId = "cit-alice";
    const coarseReadout = {
      entries: [
        {
          isLocal: true,
          subjectId: "user-alice",
          resolution: "coarse" as const,
          frame: { frameId: "f1", address: "a1", kind: "region" as const },
          ancestry: [],
          headingDegrees: null,
          fix: null,
        },
      ],
      hidden: [],
    };
    const container2 = (globalThis as any).document.createElement("div");
    const root2 = createRoot(container2);
    await act(async () => {
      root2.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "Alice",
          presenceReadout: coarseReadout as any,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: true,
          authenticatedUserId: "user-alice",
        }),
      );
    });
    expect(findNode(container2, (n) => n.getAttribute?.("data-testid") === "city-map-player-marker")).toBeNull();

    // 3. Logout / unauthorized
    const container3 = (globalThis as any).document.createElement("div");
    const root3 = createRoot(container3);
    await act(async () => {
      root3.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "City view",
          presenceReadout: null,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: false,
          authenticatedUserId: null,
        }),
      );
    });
    expect(findNode(container3, (n) => n.getAttribute?.("data-testid") === "city-map-player-marker")).toBeNull();
  });

  it("mounts BusNetworkMiniMap and verifies foreign generation stamp fences fail closed against mismatched worldSeed or layoutRevision (Challenger 1)", async () => {
    setupTestDOM();
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-alice";
    (runtime as any).fpCameraCell = { x: 25, y: 35 };

    // Set active layout revision on runtime
    (runtime as any).getActiveLayoutRevisionId = () => "rev-42";

    // 1. Foreign worldSeed in presence readout stamp (e.g. 9999 vs 42) fails closed without rendering player marker
    const foreignSeedReadout = makePresenceReadout(
      [
        {
          isLocal: true,
          subjectId: "user-alice",
          resolution: "exact",
          fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
        },
      ],
      { worldSeed: 9999, layoutRevision: "rev-42" },
    );

    const container1 = (globalThis as any).document.createElement("div");
    const root1 = createRoot(container1);
    await act(async () => {
      root1.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "Alice Wallet",
          presenceReadout: foreignSeedReadout as any,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: true,
          authenticatedUserId: "user-alice",
        }),
      );
    });
    expect(
      findNode(container1, (n) => n.getAttribute?.("data-testid") === "city-map-player-marker"),
    ).toBeNull();

    // 2. Foreign layoutRevision in presence readout stamp (e.g. 'foreign-rev-999' vs 'rev-42') fails closed
    const foreignLayoutReadout = makePresenceReadout(
      [
        {
          isLocal: true,
          subjectId: "user-alice",
          resolution: "exact",
          fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
        },
      ],
      { worldSeed: 42, layoutRevision: "foreign-rev-999" },
    );

    const container2 = (globalThis as any).document.createElement("div");
    const root2 = createRoot(container2);
    await act(async () => {
      root2.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "Alice Wallet",
          presenceReadout: foreignLayoutReadout as any,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: true,
          authenticatedUserId: "user-alice",
        }),
      );
    });
    expect(
      findNode(container2, (n) => n.getAttribute?.("data-testid") === "city-map-player-marker"),
    ).toBeNull();

    // 3. Matching generation stamp renders player marker
    const matchingReadout = makePresenceReadout(
      [
        {
          isLocal: true,
          subjectId: "user-alice",
          resolution: "exact",
          fix: { projectionFrameId: "f1", world: { x: 0, y: 0, z: 0 }, cell: { x: 25, y: 35 }, withinExtent: true },
        },
      ],
      { worldSeed: 42, layoutRevision: "rev-42" },
    );

    const container3 = (globalThis as any).document.createElement("div");
    const root3 = createRoot(container3);
    await act(async () => {
      root3.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "Alice Wallet",
          presenceReadout: matchingReadout as any,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: true,
          authenticatedUserId: "user-alice",
        }),
      );
    });
    expect(
      findNode(container3, (n) => n.getAttribute?.("data-testid") === "city-map-player-marker"),
    ).not.toBeNull();
  });

  it("mounts BusNetworkMiniMap using normal ColonyRuntime presenceReadout and validates player location marker", async () => {
    setupTestDOM();
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-alice");
    (runtime as any).operatorCitizenId = () => "cit-alice";
    (runtime as any).fpCitizenId = "cit-alice";
    (runtime as any).fpCameraCell = { x: 25, y: 35 };

    const liveReadout = runtime.presenceReadout();
    expect(liveReadout.stamp.worldSeed).toBe(42);

    const container = (globalThis as any).document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(BusNetworkMiniMap, {
          runtime,
          walletLabel: "Alice Wallet",
          presenceReadout: liveReadout,
          open: true,
          onClose: () => {},
          playerLocationAuthorized: true,
          authenticatedUserId: "user-alice",
        }),
      );
    });

    const marker = findNode(container, (n) => n.getAttribute?.("data-testid") === "city-map-player-marker");
    expect(marker).not.toBeNull();
  });
});

