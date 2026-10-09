import { describe, it, expect, vi, beforeEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildBusNetworkMiniMapModel } from "../src/colony/ui/busNetworkMiniMapModel";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.OPEN;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

describe("Runtime multiplayer transitions and account lifecycle", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it("reverts optimistic seated mode upon denied vehicle boarding and verifies board request was sent", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    // Admitted walking with parked car and matching self participant record
    const terrain = runtime.sim.state.terrain;
    const carX = (road.x - terrain.size / 2) * 4;
    const carZ = (road.y - terrain.size / 2) * 4;
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "walking",
        sessionId: "sess-trans-1",
        participantId: "part-1",
        carX,
        carY: 0,
        carZ,
        carHeading: 0,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            mode: "walking",
            isPedestrian: true,
            modeEpoch: 1,
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
            carX,
            carY: 0,
            carZ,
            carHeading: 0,
          },
        ],
      }),
    });

    expect(runtime.isOwnedDriveSeated()).toBe(false);
    expect(runtime.canEnterOwnedCar()).toBe(true);

    // Call enterOwnedCar -> returns true, emits exact board_vehicle wire message
    const entered = runtime.enterOwnedCar();
    expect(entered).toBe(true);

    const boardMsg = socket.sent.find((m) => m.type === "board_vehicle");
    expect(boardMsg).toBeDefined();
    expect(boardMsg).toEqual({
      type: "board_vehicle",
      epoch: 1,
    });
    // Negative wire assertion: v2 boarding must NOT send coordinate poses
    expect(socket.sent.filter((m: any) => m.type === "pose")).toHaveLength(0);

    // Optimistically seated before server ack
    expect(runtime.isOwnedDriveSeated()).toBe(true);

    // Server denies boarding with MODE_MISMATCH
    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        error: "MODE_MISMATCH",
        message: "Boarding denied: mode mismatch",
      }),
    });

    // Invariant: no lasting optimistic seated state on denied boarding!
    expect(runtime.isOwnedDriveSeated()).toBe(false);
    expect(runtime.getParkedCarPose()).not.toBeNull();
  });

  it("reverts optimistic walking mode upon denied vehicle exit and verifies exit request was sent", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const carX = (road.x - terrain.size / 2) * 4;
    const carZ = (road.y - terrain.size / 2) * 4;

    // Admitted driving with matching self participant record
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-trans-2",
        participantId: "part-1",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            mode: "driving",
            isPedestrian: false,
            modeEpoch: 1,
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
          },
        ],
      }),
    });

    expect(runtime.isOwnedDriveSeated()).toBe(true);

    // Call exitOwnedCar -> returns true, emits exact exit_vehicle wire message
    const exited = runtime.exitOwnedCar();
    expect(exited).toBe(true);

    const exitMsg = socket.sent.find((m) => m.type === "exit_vehicle");
    expect(exitMsg).toBeDefined();
    expect(exitMsg).toEqual({
      type: "exit_vehicle",
      epoch: 1,
    });

    // Optimistically walking before server ack
    expect(runtime.isOwnedDriveSeated()).toBe(false);

    // Server denies exit with COORDINATE_AUTHORITY_DENIED
    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        error: "COORDINATE_AUTHORITY_DENIED",
        message: "Exit denied by server",
      }),
    });

    // Invariant: no lasting optimistic walking state on denied exit!
    expect(runtime.isOwnedDriveSeated()).toBe(true);
  });

  it("successfully transitions to driving upon valid acknowledged vehicle_boarded", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const carX = (road.x - terrain.size / 2) * 4;
    const carZ = (road.y - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "walking",
        sessionId: "sess-trans-pos-1",
        participantId: "part-1",
        carX,
        carY: 0,
        carZ,
        carHeading: 0,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            mode: "walking",
            isPedestrian: true,
            modeEpoch: 1,
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
            carX,
            carY: 0,
            carZ,
            carHeading: 0,
          },
        ],
      }),
    });

    expect(runtime.isOwnedDriveSeated()).toBe(false);
    expect(runtime.getParkedCarPose()).not.toBeNull();

    // Call enterOwnedCar
    const entered = runtime.enterOwnedCar();
    expect(entered).toBe(true);

    const boardMsg = socket.sent.find((m) => m.type === "board_vehicle");
    expect(boardMsg).toEqual({ type: "board_vehicle", epoch: 1 });
    // Negative wire assertion: v2 boarding must NOT send coordinate poses
    expect(socket.sent.filter((m: any) => m.type === "pose")).toHaveLength(0);

    // Server returns valid vehicle_boarded ack with modeEpoch: 2
    socket.onmessage?.({
      data: JSON.stringify({
        type: "vehicle_boarded",
        modeEpoch: 2,
        participantId: "part-1",
        x: carX,
        y: 0,
        z: carZ,
        heading: 0,
      }),
    });

    // Authoritatively confirmed in driving mode
    expect(runtime.isOwnedDriveSeated()).toBe(true);
    expect(runtime.getMultiplayerClient()?.getMode()).toBe("driving");
    expect(runtime.getMultiplayerClient()?.getModeEpoch()).toBe(2);
    expect(runtime.getParkedCarPose()).toBeNull();
  });

  it("successfully transitions to walking upon valid acknowledged vehicle_exited", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const carX = (road.x - terrain.size / 2) * 4;
    const carZ = (road.y - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-trans-pos-2",
        participantId: "part-1",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            mode: "driving",
            isPedestrian: false,
            modeEpoch: 1,
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
          },
        ],
      }),
    });

    expect(runtime.isOwnedDriveSeated()).toBe(true);
    expect(runtime.getParkedCarPose()).toBeNull();

    // Call exitOwnedCar
    const exited = runtime.exitOwnedCar();
    expect(exited).toBe(true);

    const exitMsg = socket.sent.find((m) => m.type === "exit_vehicle");
    expect(exitMsg).toEqual({ type: "exit_vehicle", epoch: 1 });

    // Server returns valid vehicle_exited ack with parked car coordinates and modeEpoch: 2
    socket.onmessage?.({
      data: JSON.stringify({
        type: "vehicle_exited",
        modeEpoch: 2,
        participantId: "part-1",
        x: carX + 4,
        y: 0,
        z: carZ,
        heading: 0,
        carX,
        carY: 0,
        carZ,
        carHeading: 0,
      }),
    });

    // Authoritatively confirmed in walking mode
    expect(runtime.isOwnedDriveSeated()).toBe(false);
    expect(runtime.getMultiplayerClient()?.getMode()).toBe("walking");
    expect(runtime.getMultiplayerClient()?.getModeEpoch()).toBe(2);
    expect(runtime.getParkedCarPose()).not.toBeNull();
    expect(runtime.getParkedCarPose()?.x).toBe(road.x);
    expect(runtime.getParkedCarPose()?.y).toBe(road.y);
  });

  it("clears remote peers and owned/parked car world+map state on real account logout/switch", () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    // Park the car and place walking camera
    runtime.exitOwnedCar();

    // Register remote peer in sim state
    runtime.sim.state.remoteRacers = new Map();
    runtime.sim.state.remoteRacers.set("peer-99", {
      participantId: "peer-99",
      userId: "u-99",
      username: "PeerGuy",
      isPedestrian: true,
      cell: { x: road.x + 2, y: road.y + 2 },
      heading: 0,
      speed: 0,
      carX: (road.x + 2 - 64) * 4,
      carZ: (road.y + 2 - 64) * 4,
      lastSeen: Date.now(),
    } as any);

    // Verify state before logout
    expect(runtime.getParkedCarPose()).not.toBeNull();
    expect(runtime.getWalkingCell()).not.toBeNull();
    expect(runtime.sim.state.remoteRacers.size).toBe(1);

    // Build mini-map model before logout
    const preLogoutModel = buildBusNetworkMiniMapModel({
      ways: [],
      routeStops: [],
      depot: null,
      buses: [],
      player: runtime.getWalkingCell(),
      parkedCar: runtime.getParkedCarPose(),
      peers: Array.from(runtime.sim.state.remoteRacers.values()).map((r) => ({
        participantId: r.participantId,
        username: r.username,
        x: r.cell.x,
        y: r.cell.y,
        parkedCar: r.carX !== undefined ? { x: r.carX, y: r.carZ ?? 0 } : undefined,
      })),
      width: 200,
      height: 132,
      padding: 8,
    });
    expect(preLogoutModel.parkedCars.length).toBe(2); // local + peer
    expect(preLogoutModel.peers.length).toBe(1);

    // Perform real logout
    runtime.setOperatorUserId(null);

    // Assert complete clearing of world + map state
    expect(runtime.getParkedCarPose()).toBeNull();
    expect(runtime.getOwnedDrivePose()).toBeNull();
    expect(runtime.isOwnedDriveSeated()).toBe(false);
    expect(runtime.sim.state.remoteRacers?.size).toBe(0);
    expect(runtime.getMultiplayerClient()).toBeNull();

    // Re-build mini-map model after logout
    const postLogoutModel = buildBusNetworkMiniMapModel({
      ways: [],
      routeStops: [],
      depot: null,
      buses: [],
      player: runtime.getWalkingCell(),
      parkedCar: runtime.getParkedCarPose(),
      peers: Array.from(runtime.sim.state.remoteRacers?.values() ?? []).map((r) => ({
        participantId: r.participantId,
        username: r.username,
        x: r.cell.x,
        y: r.cell.y,
        parkedCar: r.carX !== undefined ? { x: r.carX, y: r.carZ ?? 0 } : undefined,
      })),
      width: 200,
      height: 132,
      padding: 8,
    });
    expect(postLogoutModel.parkedCars.length).toBe(0);
    expect(postLogoutModel.peers.length).toBe(0);
  });

  it("adopts authoritative self walking pose on valid snapshots with repeated subthreshold updates and explicit map projections", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const initX = (40 - terrain.size / 2) * 4;
    const initZ = (40 - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-1",
        participantId: "part-1",
        room: "room-1",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "walking",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: initX,
            y: 0,
            z: initZ,
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.getWalkingCell()).toEqual({ x: 40, y: 40 });
    expect(runtime.getAuthoritativeWalkingPose()).toEqual({ x: 40, y: 40, heading: 0 });

    // Snapshot seq 1: 1-cell movement to (41, 40) (dx=1, distSq=1 <= 4)
    const nextX1 = (41 - terrain.size / 2) * 4;
    const nextZ1 = (40 - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 1,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: nextX1,
            y: 0,
            z: nextZ1,
            heading: 1.5,
            speed: 0.5,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.getWalkingCell()?.x).toBe(41);
    expect(runtime.getWalkingCell()?.y).toBe(40);
    expect(runtime.getAuthoritativeWalkingPose()).toEqual({ x: 41, y: 40, heading: 1.5 });

    // Snapshot seq 2: repeated small subthreshold movement to (41.5, 40.2) (dx=0.5, dy=0.2, distSq=0.29 <= 4)
    const nextX2 = (41.5 - terrain.size / 2) * 4;
    const nextZ2 = (40.2 - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 2,
        timestamp: Date.now() + 50,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: nextX2,
            y: 0,
            z: nextZ2,
            heading: 1.6,
            speed: 0.8,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.getWalkingCell()?.x).toBeCloseTo(41.5, 4);
    expect(runtime.getWalkingCell()?.y).toBeCloseTo(40.2, 4);
    expect(runtime.getAuthoritativeWalkingPose()?.x).toBeCloseTo(41.5, 4);
    expect(runtime.getAuthoritativeWalkingPose()?.y).toBeCloseTo(40.2, 4);
    expect(runtime.getAuthoritativeWalkingPose()?.heading).toBe(1.6);

    // Build mini-map model and verify exact mathematical projection of server pose
    const mapModel = buildBusNetworkMiniMapModel({
      ways: [
        {
          kind: "avenue",
          width: 2,
          path: [
            { x: 30, y: 30 },
            { x: 50, y: 50 },
          ],
        },
      ],
      routeStops: [],
      depot: null,
      buses: [],
      player: runtime.getWalkingCell(),
      parkedCar: null,
      peers: [],
      width: 200,
      height: 132,
      padding: 8,
    });

    expect(mapModel.player).not.toBeNull();
    // Compute expected SVG projection for (41.5, 40.2) within bounding box [30..50, 30..50]
    // Inner width = 200 - 16 = 184, inner height = 132 - 16 = 116. Scale = min(184/20, 116/20) = 5.8
    // usedW = 20 * 5.8 = 116, usedH = 20 * 5.8 = 116
    // Centering offsets: ox = 8 + (184 - 116) / 2 = 42, oy = 8 + (116 - 116) / 2 = 8
    // expectedX = ox + (41.5 - 30) * 5.8 = 42 + 66.7 = 108.7
    // expectedY = oy + (40.2 - 30) * 5.8 = 8 + 59.16 = 67.16
    expect(mapModel.player!.x).toBeCloseTo(108.7, 1);
    expect(mapModel.player!.y).toBeCloseTo(67.16, 1);
  });

  it("rejects stale/duplicate sequences, mismatched sessions, and stale modeEpoch snapshots", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const initX = (40 - terrain.size / 2) * 4;
    const initZ = (40 - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-1",
        participantId: "part-1",
        room: "room-1",
        protocolVersion: 2,
        modeEpoch: 2,
        mode: "walking",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: initX,
            y: 0,
            z: initZ,
            heading: 0,
            speed: 0,
            modeEpoch: 2,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.getWalkingCell()).toEqual({ x: 40, y: 40 });

    // Valid seq 5
    const posSeq5X = (45 - terrain.size / 2) * 4;
    const posSeq5Z = (40 - terrain.size / 2) * 4;
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 5,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: posSeq5X,
            y: 0,
            z: posSeq5Z,
            heading: 0,
            speed: 1,
            modeEpoch: 2,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()?.x).toBe(45);

    // Rejection 1: Stale sequence (seq 4 < active 5) must be ignored
    const posStaleSeqX = (50 - terrain.size / 2) * 4;
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 4,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: posStaleSeqX,
            y: 0,
            z: posSeq5Z,
            heading: 0,
            speed: 1,
            modeEpoch: 2,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()?.x).toBe(45);

    // Rejection 2: Duplicate sequence (seq 5 again) must be ignored
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 5,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: posStaleSeqX,
            y: 0,
            z: posSeq5Z,
            heading: 0,
            speed: 1,
            modeEpoch: 2,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()?.x).toBe(45);

    // Rejection 3: Wrong session ID must be ignored
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "wrong-session",
        seq: 6,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: posStaleSeqX,
            y: 0,
            z: posSeq5Z,
            heading: 0,
            speed: 1,
            modeEpoch: 2,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()?.x).toBe(45);

    // Rejection 4: Stale modeEpoch (epoch 1 < active 2) must be ignored
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 7,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: posStaleSeqX,
            y: 0,
            z: posSeq5Z,
            heading: 0,
            speed: 1,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()?.x).toBe(45);

    // Rejection 5: Stale mode (driving participant while client is walking) must be ignored
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 8,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: false,
            mode: "driving",
            vehicleKey: "karoo-vonk-11",
            x: posStaleSeqX,
            y: 0,
            z: posSeq5Z,
            heading: 0,
            speed: 1,
            modeEpoch: 2,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()?.x).toBe(45);
  });

  it("clears authoritative walking pose on disconnect and disableMultiplayer, allowing legitimate local walking and reconnect sequence reset", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket1 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket1.readyState = MockWebSocket.OPEN;
    socket1.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const initX = (40 - terrain.size / 2) * 4;
    const initZ = (40 - terrain.size / 2) * 4;

    socket1.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-1",
        participantId: "part-1",
        room: "room-1",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "walking",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: initX,
            y: 0,
            z: initZ,
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    // Receive snapshot seq 5 at (45, 40)
    const snapX = (45 - terrain.size / 2) * 4;
    const snapZ = (40 - terrain.size / 2) * 4;
    socket1.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 5,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: snapX,
            y: 0,
            z: snapZ,
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.getWalkingCell()).toEqual({ x: 45, y: 40 });

    // Disconnect: socket closes
    socket1.close();
    expect(runtime.getAuthoritativeWalkingPose()).toBeNull();

    // Legitimate local walking after disconnect
    runtime.fpCameraCell = { x: 50, y: 52 };
    expect(runtime.getWalkingCell()).toEqual({ x: 50, y: 52 });

    // Also verify disableMultiplayer cleans up
    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    runtime.disableMultiplayer();
    expect(runtime.getAuthoritativeWalkingPose()).toBeNull();
    runtime.fpCameraCell = { x: 55, y: 57 };
    expect(runtime.getWalkingCell()).toEqual({ x: 55, y: 57 });

    // Reconnect to a new session (room-2, sess-2)
    runtime.enableMultiplayer("room-2", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket2.readyState = MockWebSocket.OPEN;
    socket2.onopen?.();

    const newInitX = (60 - terrain.size / 2) * 4;
    const newInitZ = (60 - terrain.size / 2) * 4;
    socket2.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-2",
        participantId: "part-2",
        room: "room-2",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "walking",
        participants: [
          {
            participantId: "part-2",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: newInitX,
            y: 0,
            z: newInitZ,
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()).toEqual({ x: 60, y: 60 });

    // Seq resets in new session: snapshot seq 1 (< prior session's seq 5) must be accepted!
    const newSnapX = (61 - terrain.size / 2) * 4;
    const newSnapZ = (60 - terrain.size / 2) * 4;
    socket2.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-2",
        seq: 1,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-2",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: newSnapX,
            y: 0,
            z: newSnapZ,
            heading: 0,
            speed: 0.5,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.getWalkingCell()?.x).toBe(61);
  });

  it("runtime tick sends driving input and zero coordinate pose frames during active driving in protocol v2", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const carX = (road.x - terrain.size / 2) * 4;
    const carZ = (road.y - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-drive-tick-1",
        participantId: "part-1",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            mode: "driving",
            isPedestrian: false,
            modeEpoch: 1,
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
          },
        ],
      }),
    });

    expect(runtime.isOwnedDriveSeated()).toBe(true);
    socket.sent.length = 0;

    // Simulate user drive input and advance multiplayer driving tick
    (runtime as any).lastMultiplayerInputSentAt = 0;
    (runtime as any).ownedDriveInput = { throttle: true, right: true, brake: false };
    runtime.tickOwnedDrive(0.05);

    // Negative wire assertion: MUST NOT send coordinate pose in v2
    const poseMessages = socket.sent.filter((m: any) => m.type === "pose");
    expect(poseMessages).toHaveLength(0);

    // Wire assertion: MUST send typed driving input with sequence, epoch, and controls
    const inputMessages = socket.sent.filter((m: any) => m.type === "input" && m.mode === "driving");
    expect(inputMessages.length).toBeGreaterThan(0);
    const lastInput = inputMessages[inputMessages.length - 1];
    expect(lastInput).toMatchObject({
      type: "input",
      mode: "driving",
      throttle: 1,
      steer: 1,
      brake: false,
      epoch: 1,
      seq: 1,
    });
    expect(typeof lastInput.seq).toBe("number");
  });

  it("connected teleportCar in protocol v2 sets local transform without emitting coordinate pose frames on the wire", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const carX = (road.x - terrain.size / 2) * 4;
    const carZ = (road.y - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-teleport-1",
        participantId: "part-1",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            mode: "driving",
            isPedestrian: false,
            modeEpoch: 1,
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
          },
        ],
      }),
    });

    socket.sent.length = 0;

    // Teleport car to another road tile
    const road2 = runtime.sim.state.roads[1] ?? { x: road.x + 2, y: road.y + 2 };
    runtime.teleportCar(road2.x, road2.y, Math.PI / 2);

    // Negative wire assertion: teleportCar must NOT emit coordinate pose frames in protocol v2 (even with force: true)
    const poseMessages = socket.sent.filter((m: any) => m.type === "pose");
    expect(poseMessages).toHaveLength(0);

    // Transform updated locally
    const drivePose = runtime.getOwnedDrivePose();
    expect(drivePose).not.toBeNull();
    expect(drivePose?.x).toBeCloseTo(road2.x);
    expect(drivePose?.y).toBeCloseTo(road2.y);
    expect(drivePose?.heading).toBeCloseTo(Math.PI / 2);
  });

  it("reverts optimistic transition and enters error state upon server COORDINATE_AUTHORITY_DENIED error", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient({
      getValidToken: async () => "valid-mock-token",
    } as any);
    runtime.setOperatorUserId("user-1");
    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    runtime.enableMultiplayer("room-1", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    await runtime.getMultiplayerClient()?.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.();

    const terrain = runtime.sim.state.terrain;
    const carX = (road.x - terrain.size / 2) * 4;
    const carZ = (road.y - terrain.size / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "walking",
        sessionId: "sess-boundary-1",
        participantId: "part-1",
        carX,
        carY: 0,
        carZ,
        carHeading: 0,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            mode: "walking",
            isPedestrian: true,
            modeEpoch: 1,
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
            carX,
            carY: 0,
            carZ,
            carHeading: 0,
          },
        ],
      }),
    });

    // Client attempts optimistic vehicle boarding
    runtime.enterOwnedCar();
    expect(runtime.isOwnedDriveSeated()).toBe(true);

    // Server returns terminal COORDINATE_AUTHORITY_DENIED frame
    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        error: "COORDINATE_AUTHORITY_DENIED",
        message: "Protocol v2 clients may not submit coordinate poses",
      }),
    });

    // Optimistic seated state must be reverted to pre-transition state (false)
    expect(runtime.isOwnedDriveSeated()).toBe(false);
    expect(runtime.getMultiplayerClient()?.getStatus()).toBe("error");
  });
});
