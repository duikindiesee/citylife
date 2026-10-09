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
});
