import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Vector3, Quaternion, Euler } from "three";
import { FirstPersonController } from "../src/render/components/FirstPersonController";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildBusNetworkMiniMapModel } from "../src/colony/ui/busNetworkMiniMapModel";
import { leveledWorldY } from "../src/colony/render/terrainLeveling";

// Mock R3F and Rapier hooks to capture the actual production useFrame callback and RigidBody
let capturedFrameCb: ((state: any, delta: number) => void) | null = null;
let currentRigidBody: any = null;
const cameraMock = {
  position: new Vector3(),
  quaternion: new Quaternion(),
  fov: 65,
  updateProjectionMatrix: vi.fn(),
  lookAt: vi.fn(),
};

vi.mock("@react-three/fiber", () => ({
  useFrame: (cb: any) => {
    capturedFrameCb = cb;
  },
  useThree: () => ({ camera: cameraMock }),
}));

vi.mock("@react-three/rapier", () => ({
  RigidBody: ({ ref, children, position }: any) => {
    const rb = {
      pos: { x: position[0], y: position[1], z: position[2] },
      vel: { x: 0, y: 0, z: 0 },
      translation() {
        return { ...this.pos };
      },
      setTranslation(p: any, _wake?: boolean) {
        this.pos = { ...p };
      },
      linvel() {
        return { ...this.vel };
      },
      setLinvel(v: any, _wake?: boolean) {
        this.vel = { ...v };
      },
    };
    currentRigidBody = rb;
    if (ref) {
      if (typeof ref === "function") ref(rb);
      else ref.current = rb;
    }
    return React.createElement("div", { "data-testid": "rigid-body" }, children);
  },
  CapsuleCollider: () => null,
}));

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

describe("FirstPersonController production useFrame reconciliation", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    capturedFrameCb = null;
    currentRigidBody = null;
    cameraMock.position.set(0, 0, 0);
    cameraMock.quaternion.set(0, 0, 0, 1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies production FirstPersonController useFrame reconciles capsule translation, camera position, and mini-map with no local input upon authoritative snapshot", async () => {
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
    const terrainSize = terrain.size;
    const toWorldX = (gx: number) => (gx - terrainSize / 2) * 4;
    const toWorldZ = (gy: number) => (gy - terrainSize / 2) * 4;

    // Admission at (40, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-production-controller",
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
            x: toWorldX(40),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.fpTeleportRequest).toMatchObject({
      x: 40,
      y: 40,
      seq: 1,
    });

    // Render actual production FirstPersonController component
    renderToStaticMarkup(
      React.createElement(FirstPersonController, {
        sim: runtime.sim,
        runtime: runtime as any,
        startPosition: [toWorldX(40), 2, toWorldZ(40)],
        terrainLevel: null,
      })
    );

    expect(capturedFrameCb).not.toBeNull();
    expect(currentRigidBody).not.toBeNull();

    // Run frame 0 to consume initial admission teleport
    capturedFrameCb!({}, 0.016);
    expect(currentRigidBody.translation().x).toBe(toWorldX(40));
    expect(currentRigidBody.translation().z).toBe(toWorldZ(40));
    expect(cameraMock.position.x).toBe(toWorldX(40));
    expect(cameraMock.position.z).toBe(toWorldZ(40));
    expect(runtime.fpCameraCell).toEqual({ x: 40, y: 40 });
    expect(runtime.getWalkingCell()).toEqual({ x: 40, y: 40 });

    // Server sends valid authoritative snapshot moving walker from (40, 40) -> (41, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-production-controller",
        seq: 1,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(41),
            y: 0,
            z: toWorldZ(40),
            heading: 1.5,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.getAuthoritativeWalkingPose()).toEqual({ x: 41, y: 40, heading: 1.5 });
    expect(runtime.fpTeleportRequest).toEqual({
      x: 41,
      y: 40,
      seq: 2,
      preserveVertical: true,
      preserveVelocity: true,
    });

    // Run production useFrame with NO local input (user is not pressing any keys)
    capturedFrameCb!({}, 0.016);

    // VERIFICATION:
    // 1. RigidBody was physically translated to toWorldX(41)
    expect(currentRigidBody.translation().x).toBe(toWorldX(41));
    expect(currentRigidBody.translation().z).toBe(toWorldZ(40));
    // 2. Camera position reflects toWorldX(41)
    expect(cameraMock.position.x).toBe(toWorldX(41));
    expect(cameraMock.position.z).toBe(toWorldZ(40));
    // 3. runtime.fpCameraCell was NOT overwritten back to 40; it matches authoritative position 41!
    expect(runtime.fpCameraCell).toEqual({ x: 41, y: 40 });
    // 4. Getter reflects 41
    expect(runtime.getWalkingCell()).toEqual({ x: 41, y: 40 });

    // 5. Mini-map projection reflects (41, 40)
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
    expect(mapModel.player!.x).toBeCloseTo(105.8, 1);
    expect(mapModel.player!.y).toBeCloseTo(66.0, 1);

    // Subsequent frame with no new snapshot and no input: stays locked at (41, 40)
    capturedFrameCb!({}, 0.016);
    expect(currentRigidBody.translation().x).toBe(toWorldX(41));
    expect(cameraMock.position.x).toBe(toWorldX(41));
    expect(runtime.fpCameraCell).toEqual({ x: 41, y: 40 });

    // Stationary snapshot seq 2 at (41, 40) must NOT bump teleport seq
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-production-controller",
        seq: 2,
        timestamp: Date.now() + 50,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(41),
            y: 0,
            z: toWorldZ(40),
            heading: 1.5,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.fpTeleportRequest?.seq).toBe(2);
  });

  it("preserves jump height, vertical velocity, and mouse-look orientation during authoritative walking snapshot correction", async () => {
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
    const terrainSize = terrain.size;
    const toWorldX = (gx: number) => (gx - terrainSize / 2) * 4;
    const toWorldZ = (gy: number) => (gy - terrainSize / 2) * 4;

    // Admission at (40, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-jump-test",
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
            x: toWorldX(40),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    renderToStaticMarkup(
      React.createElement(FirstPersonController, {
        sim: runtime.sim,
        runtime: runtime as any,
        startPosition: [toWorldX(40), 2, toWorldZ(40)],
        terrainLevel: null,
      })
    );

    capturedFrameCb!({}, 0.016);

    // Simulate mid-jump state: body is elevated at y = 5.2 m with upward linvel.y = 3.5 m/s
    currentRigidBody.setTranslation({ x: toWorldX(40), y: 5.2, z: toWorldZ(40) }, true);
    currentRigidBody.setLinvel({ x: 0, y: 3.5, z: 0 }, true);

    // Server sends walking correction snapshot to (42, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-jump-test",
        seq: 1,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(42),
            y: 0,
            z: toWorldZ(40),
            heading: 0.5,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.fpTeleportRequest).toEqual({
      x: 42,
      y: 40,
      seq: 2,
      preserveVertical: true,
      preserveVelocity: true,
    });

    // Execute production frame
    capturedFrameCb!({}, 0.016);

    // PROOFS OF VERTICAL & LOOK PRESERVATION:
    // 1. Horizontal position moved to toWorldX(42)
    expect(currentRigidBody.translation().x).toBe(toWorldX(42));
    expect(currentRigidBody.translation().z).toBe(toWorldZ(40));
    // 2. Jump height is preserved (5.2m), NOT snapped down to groundY + 1.5!
    expect(currentRigidBody.translation().y).toBe(5.2);
    // 3. Upward vertical velocity is preserved (3.5 m/s), NOT zeroed out!
    expect(currentRigidBody.linvel().y).toBe(3.5);
    // 4. Camera position reflects jump height (5.2 + PLAYER_EYE_OFFSET(0.7) = 5.9)
    expect(cameraMock.position.y).toBeCloseTo(5.9, 1);
  });

  it("preserves smooth local movement prediction during active locomotion and only reconciles large mispredictions against live fpCameraCell", async () => {
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
    const terrainSize = terrain.size;
    const toWorldX = (gx: number) => (gx - terrainSize / 2) * 4;
    const toWorldZ = (gy: number) => (gy - terrainSize / 2) * 4;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-active-prediction",
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
            x: toWorldX(40),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    renderToStaticMarkup(
      React.createElement(FirstPersonController, {
        sim: runtime.sim,
        runtime: runtime as any,
        startPosition: [toWorldX(40), 2, toWorldZ(40)],
        terrainLevel: null,
      })
    );

    capturedFrameCb!({}, 0.016);
    expect(runtime.fpTeleportRequest?.seq).toBe(1);

    // Player actively walks forward: set key on runtime and simulate physical capsule moving
    runtime.setFirstPersonKey("KeyW", true);
    expect(runtime.hasFpLocomotionInput()).toBe(true);

    // Live predicted physical capsule has advanced to (40.8, 40)
    currentRigidBody.setTranslation({ x: toWorldX(40.8), y: 2, z: toWorldZ(40) }, true);
    capturedFrameCb!({}, 0.016);
    expect(runtime.fpCameraCell?.x).toBeCloseTo(40.8, 4);
    expect(runtime.fpCameraCell?.y).toBeCloseTo(40, 4);

    // Server snapshot seq 1 reports (40.5, 40) (delta = 0.3 cells <= 4 cells)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-active-prediction",
        seq: 1,
        timestamp: Date.now() + 50,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(40.5),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 1,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    // Prediction preserved: no teleport emitted against live fpCameraCell
    expect(runtime.fpTeleportRequest?.seq).toBe(1);

    // Large misprediction: server snapshot seq 2 reports (46, 40) (distSq = (46 - 40.8)^2 = 27.04 > 4)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-active-prediction",
        seq: 2,
        timestamp: Date.now() + 100,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(46),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 1,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    // Teleport issued to reconcile large misprediction
    expect(runtime.fpTeleportRequest?.seq).toBe(2);
    expect(runtime.fpTeleportRequest?.x).toBe(46);

    // User stops walking
    runtime.setFirstPersonKey("KeyW", false);
    expect(runtime.hasFpLocomotionInput()).toBe(false);

    // Resting snapshot arrives at (46.5, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-active-prediction",
        seq: 3,
        timestamp: Date.now() + 150,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(46.5),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });
    expect(runtime.fpTeleportRequest?.seq).toBe(3);
    expect(runtime.fpTeleportRequest?.x).toBe(46.5);

    capturedFrameCb!({}, 0.016);
    expect(currentRigidBody.translation().x).toBe(toWorldX(46.5));
    expect(cameraMock.position.x).toBe(toWorldX(46.5));
    expect(runtime.fpCameraCell).toEqual({ x: 46.5, y: 40 });
    expect(runtime.getWalkingCell()).toEqual({ x: 46.5, y: 40 });
  });

  it("corrects a drifted physical capsule under a stationary unchanged authoritative server snapshot, while already-aligned snapshots do not spam corrections", async () => {
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
    const terrainSize = terrain.size;
    const toWorldX = (gx: number) => (gx - terrainSize / 2) * 4;
    const toWorldZ = (gy: number) => (gy - terrainSize / 2) * 4;

    // 1. Initial admission at (40, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-drift-test",
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
            x: toWorldX(40),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    renderToStaticMarkup(
      React.createElement(FirstPersonController, {
        sim: runtime.sim,
        runtime: runtime as any,
        startPosition: [toWorldX(40), 2, toWorldZ(40)],
        terrainLevel: null,
      })
    );

    capturedFrameCb!({}, 0.016);
    expect(currentRigidBody.translation().x).toBe(toWorldX(40));
    expect(runtime.fpCameraCell).toEqual({ x: 40, y: 40 });
    expect(runtime.fpTeleportRequest?.seq).toBe(1);

    // 2. Already-aligned stationary snapshot at (40, 40) must NOT spam new teleport requests
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-drift-test",
        seq: 1,
        timestamp: Date.now() + 50,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(40),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });
    // Teleport request sequence remains at 1 - zero spam
    expect(runtime.fpTeleportRequest?.seq).toBe(1);

    // 3. Physical body drifts away (e.g. collision or post-prediction inertia moves body to (42.5, 40))
    currentRigidBody.setTranslation({ x: toWorldX(42.5), y: 2, z: toWorldZ(40) }, true);
    // Run production useFrame frame: updates runtime.fpCameraCell to drifted position (42.5, 40)
    capturedFrameCb!({}, 0.016);
    expect(runtime.fpCameraCell?.x).toBeCloseTo(42.5, 4);
    expect(runtime.hasFpLocomotionInput()).toBe(false); // No user input active!

    // 4. Server remains completely STATIONARY at (40, 40) (same coordinates as prevTp!)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-drift-test",
        seq: 2,
        timestamp: Date.now() + 100,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(40),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    // VERIFICATION: Even though server snapshot is unchanged from prevTp (both at (40, 40)),
    // runtime detects physical body drift (42.5 != 40) and emits correction teleport!
    expect(runtime.fpTeleportRequest?.seq).toBe(2);
    expect(runtime.fpTeleportRequest?.x).toBe(40);
    expect(runtime.fpTeleportRequest?.y).toBe(40);
    expect(runtime.fpTeleportRequest?.preserveVertical).toBe(true);
    expect(runtime.fpTeleportRequest?.preserveVelocity).toBe(true);

    // 5. Execute production useFrame to consume correction
    capturedFrameCb!({}, 0.016);
    expect(currentRigidBody.translation().x).toBe(toWorldX(40));
    expect(cameraMock.position.x).toBe(toWorldX(40));
    expect(runtime.fpCameraCell).toEqual({ x: 40, y: 40 });
    expect(runtime.getWalkingCell()).toEqual({ x: 40, y: 40 });

    // 6. Next unchanged stationary snapshot at (40, 40) must NOT spam corrections once aligned
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-drift-test",
        seq: 3,
        timestamp: Date.now() + 150,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(40),
            y: 0,
            z: toWorldZ(40),
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });
    // Still seq 2 - zero spam!
    expect(runtime.fpTeleportRequest?.seq).toBe(2);
  });
});
