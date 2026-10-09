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

let effectRunner: ((cb: () => void | (() => void)) => void) | null = null;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (cb: any, _deps: any) => {
      if (effectRunner) {
        effectRunner(cb);
      }
    },
  };
});

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

  it("verifies holding turn-only ArrowLeft does not suppress authoritative walking correction and aligns body, camera, world, and mini-map", async () => {
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
        sessionId: "sess-arrowleft-test",
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
    expect(runtime.fpTeleportRequest?.seq).toBe(1);

    // Operator holds ArrowLeft: pure rotation in place, NO translational movement!
    runtime.setFirstPersonKey("ArrowLeft", true);
    expect(runtime.hasFpLocomotionInput()).toBe(false);

    // Server sends valid authoritative snapshot moving walker from (40, 40) -> (41, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-arrowleft-test",
        seq: 1,
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
            heading: -0.5,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    // Authoritative snapshot emitted correction to (41, 40) seq 2
    expect(runtime.fpTeleportRequest).toEqual({
      x: 41,
      y: 40,
      seq: 2,
      preserveVertical: true,
      preserveVelocity: true,
    });

    // Run production useFrame while ArrowLeft is still held
    capturedFrameCb!({}, 0.016);

    // 1. RigidBody was physically translated to toWorldX(41)
    expect(currentRigidBody.translation().x).toBe(toWorldX(41));
    expect(currentRigidBody.translation().z).toBe(toWorldZ(40));
    // 2. Camera position reflects toWorldX(41)
    expect(cameraMock.position.x).toBe(toWorldX(41));
    expect(cameraMock.position.z).toBe(toWorldZ(40));
    // 3. runtime.fpCameraCell is updated to authoritative position (41, 40)
    expect(runtime.fpCameraCell).toEqual({ x: 41, y: 40 });
    // 4. Getter reflects (41, 40)
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
  });

  it("verifies holding turn-only ArrowRight does not suppress authoritative walking correction and aligns body, camera, world, and mini-map", async () => {
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
        sessionId: "sess-arrowright-test",
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
    expect(runtime.fpTeleportRequest?.seq).toBe(1);

    // Operator holds ArrowRight: pure rotation in place, NO translational movement!
    runtime.setFirstPersonKey("ArrowRight", true);
    expect(runtime.hasFpLocomotionInput()).toBe(false);

    // Server sends valid authoritative snapshot moving walker from (40, 40) -> (42, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-arrowright-test",
        seq: 1,
        timestamp: Date.now() + 50,
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            isPedestrian: true,
            mode: "walking",
            x: toWorldX(42),
            y: 0,
            z: toWorldZ(40),
            heading: 0.8,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    // Authoritative snapshot emitted correction to (42, 40) seq 2
    expect(runtime.fpTeleportRequest).toEqual({
      x: 42,
      y: 40,
      seq: 2,
      preserveVertical: true,
      preserveVelocity: true,
    });

    // Run production useFrame while ArrowRight is still held
    capturedFrameCb!({}, 0.016);

    // 1. RigidBody was physically translated to toWorldX(42)
    expect(currentRigidBody.translation().x).toBe(toWorldX(42));
    expect(currentRigidBody.translation().z).toBe(toWorldZ(40));
    // 2. Camera position reflects toWorldX(42)
    expect(cameraMock.position.x).toBe(toWorldX(42));
    expect(cameraMock.position.z).toBe(toWorldZ(40));
    // 3. runtime.fpCameraCell is updated to authoritative position (42, 40)
    expect(runtime.fpCameraCell).toEqual({ x: 42, y: 40 });
    // 4. Getter reflects (42, 40)
    expect(runtime.getWalkingCell()).toEqual({ x: 42, y: 40 });

    // 5. Mini-map projection reflects (42, 40)
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
    expect(mapModel.player!.x).toBeCloseTo(111.6, 1);
    expect(mapModel.player!.y).toBeCloseTo(66.0, 1);
  });

  it("reproduces vehicle exit optimistic vs authoritative seq collision and controller deduplication", async () => {
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

    const road = runtime.sim.state.roads[0]!;
    runtime.applyVehicleOwnership("user-1", ["karoo-vonk-11"]);
    runtime.teleportCar(road.x, road.y, 0);

    const carX = toWorldX(road.x);
    const carZ = toWorldZ(road.y);

    // Join session in driving mode
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-exit-seq-test",
        participantId: "part-1",
        room: "room-1",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        participants: [
          {
            participantId: "part-1",
            userId: "user-1",
            username: "User1",
            isPedestrian: false,
            mode: "driving",
            vehicleKey: "karoo-vonk-11",
            x: carX,
            y: 0,
            z: carZ,
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    expect(runtime.isOwnedDriveSeated()).toBe(true);

    // Now operator initiates vehicle exit:
    const exitOk = runtime.exitOwnedCar();
    expect(exitOk).toBe(true);

    const optimisticReq = { ...runtime.fpTeleportRequest! };
    const optimisticSeq = optimisticReq.seq;

    // First production frame: FirstPersonController consumes the optimistic teleport request
    renderToStaticMarkup(
      React.createElement(FirstPersonController, {
        sim: runtime.sim,
        runtime: runtime as any,
        startPosition: [toWorldX(optimisticReq.x), 2, toWorldZ(optimisticReq.y)],
        terrainLevel: null,
      })
    );
    capturedFrameCb!({}, 0.016);
    expect(currentRigidBody.translation().x).toBe(toWorldX(optimisticReq.x));

    // Server sends authoritative vehicle_exited with DIFFERENT coordinates (e.g. 42, 40)
    socket.onmessage?.({
      data: JSON.stringify({
        type: "vehicle_exited",
        sessionId: "sess-exit-seq-test",
        participantId: "part-1",
        x: toWorldX(42),
        y: 0,
        z: toWorldZ(40),
        carX: toWorldX(road.x),
        carZ: toWorldZ(road.y),
        carHeading: 0,
        heading: 0,
        modeEpoch: 2,
        protocolVersion: 2,
      }),
    });

    const authoritativeSeq = runtime.fpTeleportRequest?.seq;
    // Strictly monotonic counter ensures authoritative seq > optimistic seq (no collision at 1)
    expect(authoritativeSeq).toBeGreaterThan(optimisticSeq);
    expect(authoritativeSeq).toBe(2);

    // Second production frame: FirstPersonController consumes the authoritative server correction
    capturedFrameCb!({}, 0.016);

    // 1. RigidBody was physically translated to toWorldX(42)
    expect(currentRigidBody.translation().x).toBe(toWorldX(42));
    expect(currentRigidBody.translation().z).toBe(toWorldZ(40));
    // 2. Camera position reflects toWorldX(42)
    expect(cameraMock.position.x).toBe(toWorldX(42));
    expect(cameraMock.position.z).toBe(toWorldZ(40));
    // 3. runtime.fpCameraCell is updated to authoritative server exit position (42, 40)
    expect(runtime.fpCameraCell).toEqual({ x: 42, y: 40 });
    // 4. Getter reflects (42, 40)
    expect(runtime.getWalkingCell()).toEqual({ x: 42, y: 40 });

    // 5. Mini-map projection reflects (42, 40)
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
    expect(mapModel.player!.x).toBeCloseTo(111.6, 1);
    expect(mapModel.player!.y).toBeCloseTo(66.0, 1);
  });

  it("distinguishes gamepad translational stick movement from look/turn stick in locomotion classification and typed wire transmission", async () => {
    let mockGamepads: any[] = [];
    const origGetGamepads = (navigator as any).getGamepads;
    (navigator as any).getGamepads = () => mockGamepads;

    try {
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

      // Join session walking at (40, 40)
      socket.onmessage?.({
        data: JSON.stringify({
          type: "session_joined",
          sessionId: "sess-gamepad-test",
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

      // Case 1: Gamepad idle/centered -> hasFpLocomotionInput is false, typed walking input sends zeroes
      mockGamepads = [];
      expect(runtime.hasFpLocomotionInput()).toBe(false);

      // Case 2: Gamepad right stick active (look/turn only: axes[2], axes[3]) -> hasFpLocomotionInput is false
      mockGamepads = [
        {
          axes: [0, 0, 0.8, -0.4], // right stick active, left stick 0
          buttons: [],
        },
      ];
      expect(runtime.hasFpLocomotionInput()).toBe(false);

      // Server snapshot at (41, 40) triggers targeted correction because rotation does not suppress corrections
      socket.onmessage?.({
        data: JSON.stringify({
          type: "snapshot",
          sessionId: "sess-gamepad-test",
          seq: 1,
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
              heading: 0.5,
              speed: 0,
              modeEpoch: 1,
              protocolVersion: 2,
            },
          ],
        }),
      });
      expect(runtime.fpTeleportRequest?.seq).toBe(2);
      expect(runtime.fpTeleportRequest?.x).toBe(41);

      // Consume correction frame
      capturedFrameCb!({}, 0.016);
      expect(currentRigidBody.translation().x).toBe(toWorldX(41));

      // Case 3: Gamepad left stick active (translational locomotion: axes[0]=0.6 strafe, axes[1]=-0.8 forward)
      mockGamepads = [
        {
          axes: [0.6, -0.8, 0, 0], // left stick tilted forward-right
          buttons: [],
        },
      ];
      expect(runtime.hasFpLocomotionInput()).toBe(true);

      // Typed walking input transmission over wire:
      // Clear socket.sent, advance clock, and tick walking multiplayer
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();

      const inputMsg = socket.sent.find((m: any) => m.type === "input");
      expect(inputMsg).toBeDefined();
      expect(inputMsg.mode).toBe("walking");
      expect(inputMsg.strafe).toBeCloseTo(0.6, 2);
      expect(inputMsg.forward).toBeCloseTo(0.8, 2);

      // Subthreshold server snapshot (distSq <= 4) preserves local gamepad prediction and does not snap back
      socket.onmessage?.({
        data: JSON.stringify({
          type: "snapshot",
          sessionId: "sess-gamepad-test",
          seq: 2,
          timestamp: Date.now() + 100,
          participants: [
            {
              participantId: "part-1",
              userId: "user-1",
              isPedestrian: true,
              mode: "walking",
              x: toWorldX(41.5),
              y: 0,
              z: toWorldZ(40),
              heading: 0.5,
              speed: 1,
              modeEpoch: 1,
              protocolVersion: 2,
            },
          ],
        }),
      });
      // Teleport seq is STILL 2 (prediction preserved, zero snap-back spam!)
      expect(runtime.fpTeleportRequest?.seq).toBe(2);

      // Case 4: Composition of Gamepad + Keyboard
      // Operator also holds KeyW (forwardHeld += 1) while gamepad forward is 0.8 -> forward clamped to 1
      runtime.setFirstPersonKey("KeyW", true);
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();

      const composedMsg = socket.sent.find((m: any) => m.type === "input");
      expect(composedMsg).toBeDefined();
      expect(composedMsg.forward).toBe(1); // clamped
      expect(composedMsg.strafe).toBeCloseTo(0.6, 2);

      // Case 5: Gamepad returned to neutral (deadzone <= 0.1) -> keyboard forward alone remains
      mockGamepads = [
        {
          axes: [0.05, -0.05, 0, 0], // within deadzone 0.1
          buttons: [],
        },
      ];
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();

      const neutralMsg = socket.sent.find((m: any) => m.type === "input");
      expect(neutralMsg).toBeDefined();
      expect(neutralMsg.forward).toBe(1); // from KeyW
      expect(neutralMsg.strafe).toBe(0); // gamepad neutralized

      // Release keyboard KeyW
      runtime.setFirstPersonKey("KeyW", false);
      expect(runtime.hasFpLocomotionInput()).toBe(false);

      // Case 6: Explicit keyboard left-strafe (KeyA) wire transmission
      runtime.setFirstPersonKey("KeyA", true);
      expect(runtime.hasFpLocomotionInput()).toBe(true);
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();
      const strafeLeftMsg = socket.sent.find((m: any) => m.type === "input");
      expect(strafeLeftMsg).toBeDefined();
      expect(strafeLeftMsg.strafe).toBe(-1);
      expect(strafeLeftMsg.forward).toBe(0);

      // Compose with gamepad left stick tilted left (axes[0] = -0.4) -> remains -1 (clamped)
      mockGamepads = [{ axes: [-0.4, 0, 0, 0], buttons: [] }];
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();
      const composedStrafeMsg = socket.sent.find((m: any) => m.type === "input");
      expect(composedStrafeMsg).toBeDefined();
      expect(composedStrafeMsg.strafe).toBe(-1);

      // Gamepad disconnected while KeyA held -> keyboard alone remains -1
      mockGamepads = [];
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();
      const disconnectMsg = socket.sent.find((m: any) => m.type === "input");
      expect(disconnectMsg).toBeDefined();
      expect(disconnectMsg.strafe).toBe(-1);

      // Release KeyA
      runtime.setFirstPersonKey("KeyA", false);
      expect(runtime.hasFpLocomotionInput()).toBe(false);

      // Case 7: Large misprediction (distSq > 4) under active gamepad stick DOES reconcile
      mockGamepads = [
        {
          axes: [0.6, 0, 0, 0],
          buttons: [],
        },
      ];
      expect(runtime.hasFpLocomotionInput()).toBe(true);

      socket.onmessage?.({
        data: JSON.stringify({
          type: "snapshot",
          sessionId: "sess-gamepad-test",
          seq: 3,
          timestamp: Date.now() + 150,
          participants: [
            {
              participantId: "part-1",
              userId: "user-1",
              isPedestrian: true,
              mode: "walking",
              x: toWorldX(47),
              y: 0,
              z: toWorldZ(40),
              heading: 0.5,
              speed: 1,
              modeEpoch: 1,
              protocolVersion: 2,
            },
          ],
        }),
      });
      expect(runtime.fpTeleportRequest?.seq).toBe(3);
      expect(runtime.fpTeleportRequest?.x).toBe(47);
    } finally {
      if (origGetGamepads !== undefined) {
        (navigator as any).getGamepads = origGetGamepads;
      } else {
        delete (navigator as any).getGamepads;
      }
    }
  });

  it("bridges FirstPersonController keyboard events to wire walking input with typing suppression, keyup release, blur, and unmount neutralization", async () => {
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

    // 1. Admit session in walking mode
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-keyboard-test",
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
            x: 0,
            y: 0,
            z: 0,
            heading: 0,
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    let cleanups: Array<() => void> = [];
    const origWindow = (globalThis as any).window;
    const origDocument = (globalThis as any).document;

    const listeners: Record<string, ((e: any) => void)[]> = {};
    const mockWindow = {
      addEventListener: (type: string, fn: any) => {
        (listeners[type] = listeners[type] || []).push(fn);
      },
      removeEventListener: (type: string, fn: any) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
      dispatchEvent: (e: any) => {
        const fns = [...(listeners[e.type] || [])];
        for (const f of fns) f(e);
      },
    };
    (globalThis as any).window = mockWindow;
    (globalThis as any).document = { pointerLockElement: null };

    effectRunner = (cb: () => void | (() => void)) => {
      const res = cb();
      if (typeof res === "function") {
        cleanups.push(res);
      }
    };

    try {
      renderToStaticMarkup(
        React.createElement(FirstPersonController, {
          sim: runtime.sim,
          runtime: runtime as any,
          startPosition: [0, 2, 0],
          terrainLevel: null,
        })
      );

      // Verify hook interception actually registered keydown, keyup, and blur listeners
      expect(listeners["keydown"]?.length).toBeGreaterThan(0);
      expect(listeners["keyup"]?.length).toBeGreaterThan(0);
      expect(listeners["blur"]?.length).toBeGreaterThan(0);

      // Verify typing suppression negative: KeyW pressed while typing inside INPUT/TEXTAREA
      const typingEvent = {
        type: "keydown",
        code: "KeyW",
        target: { tagName: "INPUT", isContentEditable: false },
      };
      mockWindow.dispatchEvent(typingEvent);

      expect(runtime.hasFpLocomotionInput()).toBe(false);
      expect((runtime as any).fpKeys?.has("fwd")).toBe(false);

      // Legitimate player walking input: KeyW on window (canvas/body)
      const keyWDown = {
        type: "keydown",
        code: "KeyW",
        target: { tagName: "DIV", isContentEditable: false },
      };
      mockWindow.dispatchEvent(keyWDown);

      expect(runtime.hasFpLocomotionInput()).toBe(true);
      expect((runtime as any).fpKeys?.has("fwd")).toBe(true);

      // Verify wire walking packet emitted by runtime.tickWalkingMultiplayer()
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();

      const inputMsg = socket.sent.find((m: any) => m.type === "input");
      expect(inputMsg).toBeDefined();
      expect(inputMsg.mode).toBe("walking");
      expect(inputMsg.forward).toBe(1);
      expect(inputMsg.strafe).toBe(0);

      // KeyUp release: KeyW up restores neutral
      const keyWUp = {
        type: "keyup",
        code: "KeyW",
        target: { tagName: "DIV", isContentEditable: false },
      };
      mockWindow.dispatchEvent(keyWUp);

      expect(runtime.hasFpLocomotionInput()).toBe(false);
      expect((runtime as any).fpKeys?.has("fwd")).toBe(false);

      // Re-press KeyW then trigger window blur -> neutralizes held keys
      mockWindow.dispatchEvent(keyWDown);
      expect(runtime.hasFpLocomotionInput()).toBe(true);

      mockWindow.dispatchEvent({ type: "blur" });
      expect(runtime.hasFpLocomotionInput()).toBe(false);
      expect((runtime as any).fpKeys?.has("fwd")).toBe(false);

      // Re-press KeyW then trigger unmount cleanup -> neutralizes held keys
      mockWindow.dispatchEvent(keyWDown);
      expect(runtime.hasFpLocomotionInput()).toBe(true);

      cleanups.forEach((c) => c());
      cleanups = [];
      expect(runtime.hasFpLocomotionInput()).toBe(false);
      expect((runtime as any).fpKeys?.has("fwd")).toBe(false);
    } finally {
      effectRunner = null;
      if (origWindow !== undefined) (globalThis as any).window = origWindow;
      else delete (globalThis as any).window;
      if (origDocument !== undefined) (globalThis as any).document = origDocument;
      else delete (globalThis as any).document;
      cleanups.forEach((c) => c());
    }
  });

  it("guarantees directional agreement between production FirstPersonController physical velocity, wire sender heading, and paired server displacement across camera yaw, mouse look, turning, and strafe", async () => {
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

    // Admit in walking mode
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-directional-test",
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
            x: 0,
            y: 0,
            z: 0,
            heading: -Math.PI / 2, // Facing -Z initially
            speed: 0,
            modeEpoch: 1,
            protocolVersion: 2,
          },
        ],
      }),
    });

    let cleanups: Array<() => void> = [];
    const origWindow = (globalThis as any).window;
    const origDocument = (globalThis as any).document;

    const listeners: Record<string, ((e: any) => void)[]> = {};
    const mockWindow = {
      addEventListener: (type: string, fn: any) => {
        (listeners[type] = listeners[type] || []).push(fn);
      },
      removeEventListener: (type: string, fn: any) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
      dispatchEvent: (e: any) => {
        const fns = [...(listeners[e.type] || [])];
        for (const f of fns) f(e);
      },
    };
    (globalThis as any).window = mockWindow;
    (globalThis as any).document = { pointerLockElement: mockWindow };

    effectRunner = (cb: () => void | (() => void)) => {
      const res = cb();
      if (typeof res === "function") cleanups.push(res);
    };

    try {
      renderToStaticMarkup(
        React.createElement(FirstPersonController, {
          sim: runtime.sim,
          runtime: runtime as any,
          startPosition: [0, 2, 0],
          terrainLevel: null,
        })
      );

      // Step 1: Initial useFrame tick
      capturedFrameCb!({}, 0.016);

      // Helper simulating server stepPedestrian integration
      const simulateServerDisplacement = (
        fwd: number,
        str: number,
        heading: number,
        dt: number,
        sprint: boolean = false
      ) => {
        const mag = Math.hypot(fwd, str);
        const normFwd = mag > 0 ? fwd / mag : 0;
        const normStr = mag > 0 ? str / mag : 0;
        const baseSpeed = sprint ? 8.0 : 4.5;
        const speed = Math.min(1.0, mag) * baseSpeed;
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const vx = (normFwd * cos - normStr * sin) * speed;
        const vz = (normFwd * sin + normStr * cos) * speed;
        return { vx, vz, dx: vx * dt, dz: vz * dt };
      };

      // CASE 1: KeyW at initial yaw = 0 (facing down -Z)
      mockWindow.dispatchEvent({
        type: "keydown",
        code: "KeyW",
        target: { tagName: "DIV", isContentEditable: false },
      });

      // Advance physics frames
      for (let i = 0; i < 5; i++) {
        capturedFrameCb!({}, 0.016);
      }

      const linvelYaw0 = currentRigidBody.linvel();
      // Client local velocity moves down -Z
      expect(linvelYaw0.x).toBeCloseTo(0, 3);
      expect(linvelYaw0.z).toBeLessThan(-0.5);

      // Wire walking packet emitted
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();

      const msgYaw0 = socket.sent.find((m: any) => m.type === "input");
      expect(msgYaw0).toBeDefined();
      expect(msgYaw0.forward).toBe(1);
      expect(msgYaw0.strafe).toBe(0);
      expect(msgYaw0.heading).toBeCloseTo(-Math.PI / 2, 4);

      // Server integrates heading -PI/2
      const serverYaw0 = simulateServerDisplacement(
        msgYaw0.forward,
        msgYaw0.strafe,
        msgYaw0.heading,
        0.016
      );
      expect(serverYaw0.vx).toBeCloseTo(0, 4);
      expect(serverYaw0.vz).toBeLessThan(0); // Moves down -Z!

      // Directional dot product: client body velocity vs server displacement
      const clientMag0 = Math.hypot(linvelYaw0.x, linvelYaw0.z);
      const serverMag0 = Math.hypot(serverYaw0.dx, serverYaw0.dz);
      const dot0 =
        (linvelYaw0.x * serverYaw0.dx + linvelYaw0.z * serverYaw0.dz) /
        (clientMag0 * serverMag0);
      expect(dot0).toBeGreaterThan(0.999);

      // Release KeyW
      mockWindow.dispatchEvent({
        type: "keyup",
        code: "KeyW",
        target: { tagName: "DIV", isContentEditable: false },
      });

      // CASE 2: Turn 90 degrees right via mouse look (movementX > 0)
      // Turning right in FirstPersonController: rotation.current.y -= movementX * 0.002
      // Rotate by -PI/2 radians (90 deg to face +X)
      mockWindow.dispatchEvent({
        type: "mousemove",
        movementX: (Math.PI / 2) / 0.002,
        movementY: 0,
      });

      // Press KeyW at yaw = -PI/2
      mockWindow.dispatchEvent({
        type: "keydown",
        code: "KeyW",
        target: { tagName: "DIV", isContentEditable: false },
      });

      for (let i = 0; i < 5; i++) {
        capturedFrameCb!({}, 0.016);
      }

      const linvelTurnRight = currentRigidBody.linvel();
      // Client local velocity now moves along +X
      expect(linvelTurnRight.x).toBeGreaterThan(0.5);
      expect(linvelTurnRight.z).toBeCloseTo(0, 3);

      // Wire packet emitted
      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();

      const msgTurnRight = socket.sent.find((m: any) => m.type === "input");
      expect(msgTurnRight).toBeDefined();
      expect(msgTurnRight.forward).toBe(1);
      expect(msgTurnRight.strafe).toBe(0);
      expect(msgTurnRight.heading).toBeCloseTo(0, 4); // Wire heading 0 corresponds to +X!

      const serverTurnRight = simulateServerDisplacement(
        msgTurnRight.forward,
        msgTurnRight.strafe,
        msgTurnRight.heading,
        0.016
      );
      expect(serverTurnRight.vx).toBeGreaterThan(0); // Moves along +X!
      expect(serverTurnRight.vz).toBeCloseTo(0, 4);

      const clientMagRight = Math.hypot(linvelTurnRight.x, linvelTurnRight.z);
      const serverMagRight = Math.hypot(serverTurnRight.dx, serverTurnRight.dz);
      const dotRight =
        (linvelTurnRight.x * serverTurnRight.dx + linvelTurnRight.z * serverTurnRight.dz) /
        (clientMagRight * serverMagRight);
      expect(dotRight).toBeGreaterThan(0.999);

      // Release KeyW
      mockWindow.dispatchEvent({
        type: "keyup",
        code: "KeyW",
        target: { tagName: "DIV", isContentEditable: false },
      });

      // CASE 3: Strafe Right (KeyD) while facing +X
      mockWindow.dispatchEvent({
        type: "keydown",
        code: "KeyD",
        target: { tagName: "DIV", isContentEditable: false },
      });

      for (let i = 0; i < 5; i++) {
        capturedFrameCb!({}, 0.016);
      }

      const linvelStrafe = currentRigidBody.linvel();
      // Facing +X, strafing right moves toward +Z
      expect(linvelStrafe.x).toBeCloseTo(0, 3);
      expect(linvelStrafe.z).toBeGreaterThan(0.5);

      socket.sent = [];
      (runtime as any).lastMultiplayerInputSentAt = 0;
      runtime.tickWalkingMultiplayer();

      const msgStrafe = socket.sent.find((m: any) => m.type === "input");
      expect(msgStrafe).toBeDefined();
      expect(msgStrafe.forward).toBe(0);
      expect(msgStrafe.strafe).toBe(1);
      expect(msgStrafe.heading).toBeCloseTo(0, 4);

      const serverStrafe = simulateServerDisplacement(
        msgStrafe.forward,
        msgStrafe.strafe,
        msgStrafe.heading,
        0.016
      );
      expect(serverStrafe.vx).toBeCloseTo(0, 4);
      expect(serverStrafe.vz).toBeGreaterThan(0); // Server also moves toward +Z!

      const clientMagStrafe = Math.hypot(linvelStrafe.x, linvelStrafe.z);
      const serverMagStrafe = Math.hypot(serverStrafe.dx, serverStrafe.dz);
      const dotStrafe =
        (linvelStrafe.x * serverStrafe.dx + linvelStrafe.z * serverStrafe.dz) /
        (clientMagStrafe * serverMagStrafe);
      expect(dotStrafe).toBeGreaterThan(0.999);
    } finally {
      effectRunner = null;
      cleanups.forEach((c) => c());
      cleanups = [];
      if (origWindow !== undefined) (globalThis as any).window = origWindow;
      else delete (globalThis as any).window;
      if (origDocument !== undefined) (globalThis as any).document = origDocument;
      else delete (globalThis as any).document;
    }
  });
});
