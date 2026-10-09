import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MultiplayerClient, redactUrl } from "../src/colony/multiplayer/multiplayerClient";
import { resolveOwnedCar } from "../src/colony/car/ownedCar";
import { buildBusNetworkMiniMapModel } from "../src/colony/ui/busNetworkMiniMapModel";

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((err: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code: 1000 });
    }
  }
}

describe("MultiplayerClient Auth & Lifecycle Boundaries", () => {
  const originalWebSocket = (globalThis as any).WebSocket;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
    (globalThis as any).window = {
      location: {
        protocol: "https:",
        host: "synthetic.citylife.invalid",
        hostname: "synthetic.citylife.invalid",
      },
    };
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).window = originalWindow;
  });

  it("does not create a socket if disconnected while getToken is awaiting", async () => {
    let resolveToken: (token: string) => void = () => {};
    const tokenPromise = new Promise<string>((r) => {
      resolveToken = r;
    });

    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      getToken: () => tokenPromise,
    });

    const connectPromise = client.connect();
    client.disconnect();
    resolveToken("test-bearer-token");
    await connectPromise;

    expect(MockWebSocket.instances.length).toBe(0);
    expect(client.getStatus()).toBe("disconnected");
  });

  it("deduplicates overlapping connects while awaiting token", async () => {
    let resolveToken: (token: string) => void = () => {};
    const tokenPromise = new Promise<string>((r) => {
      resolveToken = r;
    });

    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      getToken: () => tokenPromise,
    });

    const p1 = client.connect();
    const p2 = client.connect();
    resolveToken("test-bearer-token");
    await Promise.all([p1, p2]);

    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("ignores late acceptance message from old socket after account teardown", async () => {
    let peerCallbacks = 0;
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
      onPeerJoined: () => {
        peerCallbacks++;
      },
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    client.disconnect();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "room-abc",
        inviteCode: "ABC",
        participantId: "self",
        participants: [
          {
            participantId: "peer-1",
            userId: "102",
            username: "peer-user",
            vehicleKey: "karoo-vonk-11",
            x: 10,
            y: 0,
            z: 10,
            heading: 0,
            speed: 0,
          },
        ],
      }),
    });

    expect(client.getStatus()).toBe("disconnected");
    expect(peerCallbacks).toBe(0);
  });

  it("rejects cross-origin endpoint before appending account token", async () => {
    const errorSpy = vi.fn();
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "secret-account-token",
      url: "wss://foreign-domain.invalid/ws",
      onError: errorSpy,
    });

    await client.connect();

    expect(MockWebSocket.instances.length).toBe(0);
    expect(client.getStatus()).toBe("error");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: "UNAPPROVED_ENDPOINT" }),
    );
  });

  it("rejects protocol-relative third-party endpoint", async () => {
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "secret-token",
      url: "//another-origin.invalid/ws",
    });

    await client.connect();
    expect(MockWebSocket.instances.length).toBe(0);
    expect(client.getStatus()).toBe("error");
  });

  it("rejects production HTTPS origin sending tokens to arbitrary loopback port", async () => {
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "secret-token",
      url: "ws://127.0.0.1:9876/ws",
    });

    await client.connect();
    expect(MockWebSocket.instances.length).toBe(0);
    expect(client.getStatus()).toBe("error");
  });

  it("allows same-origin relative path /api/v1/citylife/ws", async () => {
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
      url: "/api/v1/citylife/ws",
    });

    await client.connect();
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0]!.url).toContain("/api/v1/citylife/ws?jwt=valid-token");
    expect(MockWebSocket.instances[0]!.url).not.toContain("token=");
  });

  it("packages mode: driving and mode: walking correctly in sendPose", async () => {
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;

    client.sendPose({ x: 10, y: 0, z: 20, heading: 1.5, speed: 25, mode: "driving" });
    const sentPose1 = socket.sent.find((m: any) => m.type === "pose");
    expect(sentPose1).toBeDefined();
    expect(sentPose1.mode).toBe("driving");
    expect(sentPose1.speed).toBe(25);
  });

  it("handles peer_pose mode transitions with vehicleKey and pedestrian flag", async () => {
    const posesReceived: any[] = [];
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
      onPeerPose: (participantId, pose) => {
        posesReceived.push({ participantId, ...pose });
      },
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "peer_pose",
        participantId: "peer-99",
        mode: "walking",
        isPedestrian: true,
        vehicleKey: null,
        x: 15,
        y: 0,
        z: 30,
        heading: 0.2,
        speed: 2,
      }),
    });

    expect(posesReceived).toHaveLength(1);
    expect(posesReceived[0].mode).toBe("walking");
    expect(posesReceived[0].isPedestrian).toBe(true);
    expect(posesReceived[0].vehicleKey).toBeNull();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "peer_pose",
        participantId: "peer-99",
        mode: "driving",
        isPedestrian: false,
        vehicleKey: "karoo-vonk-11",
        x: 40,
        y: 0,
        z: 80,
        heading: 1.1,
        speed: 35,
      }),
    });

    expect(posesReceived).toHaveLength(2);
    expect(posesReceived[1].mode).toBe("driving");
    expect(posesReceived[1].isPedestrian).toBe(false);
    expect(posesReceived[1].vehicleKey).toBe("karoo-vonk-11");
  });

  it("emits layoutRevision in join_session frame and binds confirmed context on session_joined", async () => {
    const revision = "wl:v1:0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const client = new MultiplayerClient({
      userId: "101",
      username: "Player101",
      roomCode: "TEST-ROOM",
      token: "test-token",
      worldId: "seed-4242",
      layoutRevision: revision,
      neighbourhoodKey: "citylife-central",
    });

    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    const joinFrame = socket.sent.find((f: any) => f.type === "join_session");
    expect(joinFrame).toBeDefined();
    expect(joinFrame.worldId).toBe("seed-4242");
    expect(joinFrame.layoutRevision).toBe(revision);

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-123",
        inviteCode: "TEST-ROOM",
        participantId: "part-1",
        worldId: "seed-4242",
        layoutRevision: revision,
        neighbourhoodKey: "citylife-central",
        participants: [],
      }),
    });

    expect(client.getStatus()).toBe("connected");
    const sessionInfo = client.getSessionInfo();
    expect(sessionInfo.worldId).toBe("seed-4242");
    expect(sessionInfo.layoutRevision).toBe(revision);
    client.disconnect();
  });

  it("rejects admission and transitions to error status when server returns mismatched or missing layoutRevision", async () => {
    const revision = "wl:v1:0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const client = new MultiplayerClient({
      userId: "102",
      username: "Player102",
      roomCode: "TEST-ROOM",
      token: "test-token",
      worldId: "seed-4242",
      layoutRevision: revision,
    });

    await client.connect();
    const socket = MockWebSocket.instances[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-123",
        inviteCode: "TEST-ROOM",
        participantId: "part-2",
        worldId: "seed-4242",
        layoutRevision: "wl:v1:1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        participants: [],
      }),
    });

    expect(client.getStatus()).toBe("error");
    const sessionInfo = client.getSessionInfo();
    expect(sessionInfo.worldId).toBeNull();
    expect(sessionInfo.layoutRevision).toBeNull();
  });

  it("handles LAYOUT_REVISION_MISMATCH error frame as terminal admission denial", async () => {
    const errorSpy = vi.fn();
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
      onError: errorSpy,
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;

    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        error: "LAYOUT_REVISION_MISMATCH",
        message: "Session belongs to layout revision wl:v1:0:different",
      }),
    });

    expect(client.getStatus()).toBe("error");
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LAYOUT_REVISION_MISMATCH" }),
    );
    expect(client.getSessionInfo().sessionId).toBeNull();
    expect(client.sendDrivingInput({ throttle: 1 })).toBe(false);
    expect(client.sendWalkingInput({ forward: 1 })).toBe(false);
  });

  it("enters connecting on abrupt socket close to attempt retry", async () => {
    const statusChanges: string[] = [];
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
      onStatusChange: (status) => statusChanges.push(status),
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-1",
        inviteCode: "ROOM1",
        participantId: "part-1",
        participants: [],
      }),
    });
    expect(client.getStatus()).toBe("connected");

    // Abrupt close (not explicit disconnect)
    socket.close();

    expect(client.getStatus()).toBe("connecting");
    expect(statusChanges).toContain("connecting");
    client.disconnect();
  });

  it("handles snapshot frame and dispatches onSnapshot and onPeerPose", async () => {
    let receivedSnapshot: any = null;
    const peerPoses: Record<string, any> = {};

    const client = new MultiplayerClient({
      userId: "101",
      username: "local-player",
      token: "valid-token",
      onSnapshot: (snap) => {
        receivedSnapshot = snap;
      },
      onPeerPose: (id, pose) => {
        peerPoses[id] = pose;
      },
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-snap",
        inviteCode: "SNAP1",
        participantId: "part-local",
        participants: [],
      }),
    });

    // Server emits 10Hz authoritative snapshot
    socket.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap",
        seq: 42,
        timestamp: 1791392000000,
        participants: [
          {
            participantId: "part-local",
            userId: "101",
            alias: "local-player",
            x: 10,
            y: 0,
            z: 20,
            heading: 0,
            speed: 5,
            mode: "driving",
          },
          {
            participantId: "part-remote",
            userId: "102",
            alias: "remote-player",
            x: 50,
            y: 0,
            z: 80,
            heading: 1.57,
            speed: 15,
            mode: "driving",
            vehicleKey: "karoo-kaap-gt-v8",
          },
        ],
      }),
    });

    expect(receivedSnapshot).not.toBeNull();
    expect(receivedSnapshot.seq).toBe(42);
    expect(receivedSnapshot.participants).toHaveLength(2);

    expect(peerPoses["part-remote"]).toBeDefined();
    expect(peerPoses["part-remote"].x).toBe(50);
    expect(peerPoses["part-remote"].z).toBe(80);
    expect(peerPoses["part-remote"].mode).toBe("driving");
    expect(peerPoses["part-remote"].vehicleKey).toBe("karoo-kaap-gt-v8");

    client.disconnect();
  });

  it("sends input frames with monotonic sequence, throttle, steer, and brake", async () => {
    const client = new MultiplayerClient({
      userId: "101",
      username: "local-player",
      token: "valid-token",
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-input",
        inviteCode: "INPUT1",
        participantId: "part-local",
        participants: [],
      }),
    });

    client.sendInput({
      seq: 1,
      throttle: 0.75,
      steer: -0.25,
      brake: false,
    });

    const sentInput = socket.sent.find((f: any) => f.type === "input");
    expect(sentInput).toBeDefined();
    expect(sentInput.seq).toBe(1);
    expect(sentInput.throttle).toBe(0.75);
    expect(sentInput.steer).toBe(-0.25);
    expect(sentInput.brake).toBe(false);

    client.disconnect();
  });

  it("normalizes procedural showroom car spec id to canonical server vehicleKey on join_session (resolver-to-wire positive regression)", async () => {
    // 1. Resolver and catalog return procedural spec id: "showroom:karoo-vonk-11"
    const spec = resolveOwnedCar(["karoo-vonk-11"]);
    expect(spec).not.toBeNull();
    expect(spec!.id).toBe("showroom:karoo-vonk-11");

    // 2. Client configured with procedural model id from authoritative car
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
      vehicleKey: spec!.id,
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    const joinFrame = socket.sent.find((f: any) => f.type === "join_session");
    expect(joinFrame).toBeDefined();
    // Invariant: Server wire key MUST be normalized to "karoo-vonk-11", NOT "showroom:karoo-vonk-11"
    expect(joinFrame.vehicleKey).toBe("karoo-vonk-11");
    client.disconnect();
  });

  it("handles unowned vehicle admission denial as terminal error (genuinely unowned-car negative case)", async () => {
    // 1. Resolver returns null for genuinely unowned / unknown vehicle keys
    const unknownSpec = resolveOwnedCar(["unowned-car"]);
    expect(unknownSpec).toBeNull();

    // 2. If client attempts to request an unowned vehicle key and server rejects with VEHICLE_NOT_OWNED
    const errorSpy = vi.fn();
    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "valid-token",
      vehicleKey: "unowned-car",
      onError: errorSpy,
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        error: "VEHICLE_NOT_OWNED",
        message: "Requested vehicle 'unowned-car' does not match authoritative owned vehicle 'karoo-vonk-11'",
      }),
    });

    expect(client.getStatus()).toBe("error");
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "VEHICLE_NOT_OWNED",
        message: expect.stringContaining("Requested vehicle 'unowned-car'"),
      }),
    );
    expect(client.getSessionInfo().sessionId).toBeNull();
    expect(client.getParkedCar()).toBeUndefined();
    expect(client.sendDrivingInput({ throttle: 1 })).toBe(false);
    expect(client.sendWalkingInput({ forward: 1 })).toBe(false);
    client.disconnect();
  });

  it("throttles same-mode poses within 45ms deterministically but never drops mode transitions or forced poses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      getToken: async () => "test-token",
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    const getSentPoses = () => socket.sent.filter((m: any) => m.type === "pose");

    // 1. Initial driving pose at t=1000 is sent
    client.sendPose({ x: 10, y: 1, z: 20, heading: 0, speed: 10, mode: "driving" });
    expect(getSentPoses()).toHaveLength(1);
    expect(getSentPoses()[0]).toMatchObject({ type: "pose", mode: "driving", x: 10 });

    // 2. Advance by 20ms to t=1020: immediate second driving pose (<45ms) should be throttled
    vi.advanceTimersByTime(20);
    client.sendPose({ x: 10.5, y: 1, z: 20.5, heading: 0, speed: 10, mode: "driving" });
    expect(getSentPoses()).toHaveLength(1);

    // 3. Advance by 10ms to t=1030: immediate mode transition to walking (<45ms) MUST NOT be throttled
    vi.advanceTimersByTime(10);
    client.sendPose({ x: 10.5, y: 1, z: 20.5, heading: 0, speed: 0, mode: "walking" });
    expect(getSentPoses()).toHaveLength(2);
    expect(getSentPoses()[1]).toMatchObject({ type: "pose", mode: "walking", x: 10.5 });

    // 4. Advance by 10ms to t=1040: immediate second walking pose (<45ms) should be throttled
    vi.advanceTimersByTime(10);
    client.sendPose({ x: 11, y: 1, z: 21, heading: 0, speed: 1, mode: "walking" });
    expect(getSentPoses()).toHaveLength(2);

    // 5. Same tick t=1040: forced walking pose (<45ms) MUST NOT be throttled
    client.sendPose({ x: 11, y: 1, z: 21, heading: 0, speed: 1, mode: "walking", force: true });
    expect(getSentPoses()).toHaveLength(3);
    expect(getSentPoses()[2]).toMatchObject({ type: "pose", mode: "walking", x: 11 });

    // 6. Advance by 50ms to t=1090 (>45ms interval): normal walking pose is sent
    vi.advanceTimersByTime(50);
    client.sendPose({ x: 12, y: 1, z: 22, heading: 0, speed: 1.5, mode: "walking" });
    expect(getSentPoses()).toHaveLength(4);
    expect(getSentPoses()[3]).toMatchObject({ type: "pose", mode: "walking", x: 12 });

    client.disconnect();
    vi.useRealTimers();
  });

  it("does not advance pose tracking when send drops on non-OPEN socket, avoiding ghost throttling upon connection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);

    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "test-token",
    });

    const connectPromise = client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    // Socket is still CONNECTING (not yet OPEN)
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);

    // Attempt to send pose while socket is not open: should be dropped without advancing state
    client.sendPose({ x: 5, y: 0, z: 5, heading: 0, speed: 0, mode: "driving" });
    expect(socket.sent).toHaveLength(0);

    // Advance by 10ms to t=2010 and open socket
    vi.advanceTimersByTime(10);
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();
    await connectPromise;

    // Advance by 5ms to t=2015 (<45ms from the dropped call):
    // First pose on OPEN socket MUST NOT be throttled by the dropped call's timestamp
    vi.advanceTimersByTime(5);
    client.sendPose({ x: 5, y: 0, z: 5, heading: 0, speed: 0, mode: "driving" });

    const sentPoses = socket.sent.filter((m: any) => m.type === "pose");
    expect(sentPoses).toHaveLength(1);
    expect(sentPoses[0]).toMatchObject({ type: "pose", mode: "driving", x: 5 });

    client.disconnect();
    vi.useRealTimers();
  });

  it("resets pose tracking on disconnect and reconnect so fresh session is never throttled by prior session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);

    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "test-token",
    });

    await client.connect();
    const socket1 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket1.readyState = MockWebSocket.OPEN;
    socket1.onopen!();

    // Session 1 sends driving pose at t=5000
    client.sendPose({ x: 10, y: 0, z: 10, heading: 0, speed: 5, mode: "driving" });
    expect(socket1.sent.filter((m: any) => m.type === "pose")).toHaveLength(1);

    // Disconnect session 1 at t=5010
    vi.advanceTimersByTime(10);
    client.disconnect();

    // Reconnect session 2 at t=5015 (<45ms from session 1 pose)
    vi.advanceTimersByTime(5);
    const connectPromise = client.connect();
    const socket2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    expect(socket2).not.toBe(socket1);
    socket2.readyState = MockWebSocket.OPEN;
    socket2.onopen!();
    await connectPromise;

    // Send driving pose in session 2 at t=5020 (<45ms from session 1):
    // Must NOT be throttled by session 1's lastPoseSentAt or lastSentMode
    vi.advanceTimersByTime(5);
    client.sendPose({ x: 10, y: 0, z: 10, heading: 0, speed: 5, mode: "driving" });
    expect(socket2.sent.filter((m: any) => m.type === "pose")).toHaveLength(1);

    client.disconnect();
    vi.useRealTimers();
  });

  it("resets pose tracking on socket close so reconnection transmits fresh pose immediately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(8000);

    const client = new MultiplayerClient({
      userId: "101",
      username: "test-user",
      token: "test-token",
    });

    await client.connect();
    const socket1 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket1.readyState = MockWebSocket.OPEN;
    socket1.onopen!();

    client.sendPose({ x: 20, y: 0, z: 20, heading: 0, speed: 8, mode: "driving" });
    expect(socket1.sent.filter((m: any) => m.type === "pose")).toHaveLength(1);

    // Socket 1 abruptly closes at t=8010
    vi.advanceTimersByTime(10);
    socket1.close();

    // Wait for the reconnect timer (500ms delay for 1st attempt) to fire
    vi.advanceTimersByTime(500);
    await Promise.resolve();

    const socket2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    expect(socket2).not.toBe(socket1);
    socket2.readyState = MockWebSocket.OPEN;
    socket2.onopen!();

    // Pose sent on reconnected socket at t=8525 (<45ms from reconnection setup)
    vi.advanceTimersByTime(5);
    client.sendPose({ x: 20, y: 0, z: 20, heading: 0, speed: 8, mode: "driving" });
    expect(socket2.sent.filter((m: any) => m.type === "pose")).toHaveLength(1);

    client.disconnect();
    vi.useRealTimers();
  });
});

describe("BusNetworkMiniMapModel peer integration", () => {
  it("projects peer positions within the minimap model bounds", () => {
    const model = buildBusNetworkMiniMapModel({
      ways: [
        {
          source: "avenue",
          path: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        } as any,
      ],
      routeStops: [],
      depot: null,
      buses: [],
      peers: [
        { participantId: "p1", username: "Racer1", x: 25, y: 50 },
        { participantId: "p2", username: "Racer2", x: 75, y: 80 },
      ],
      player: { x: 50, y: 50 },
      width: 200,
      height: 132,
      padding: 8,
    });

    expect(model.peers).toHaveLength(2);
    expect(model.peers[0]!.participantId).toBe("p1");
    expect(model.peers[0]!.username).toBe("Racer1");
    expect(model.peers[0]!.outOfBounds).toBe(false);
    expect(model.peers[0]!.x).toBeGreaterThan(0);
    expect(model.peers[0]!.y).toBeGreaterThan(0);
  });

  it("redacts plain, percent-encoded token and jwt parameters, and userinfo in URLs", () => {
    const canary = "SYNTHETIC_LOG_CANARY";
    expect(redactUrl(`wss://example.invalid/ws?jwt=${canary}`)).toBe("wss://example.invalid/ws?jwt=[REDACTED]");
    expect(redactUrl(`wss://example.invalid/ws?%6a%77%74=${canary}`)).toBe("wss://example.invalid/ws?%6a%77%74=[REDACTED]");
    expect(redactUrl(`wss://example.invalid/ws?%74%6f%6b%65%6e=${canary}`)).toBe("wss://example.invalid/ws?%74%6f%6b%65%6e=[REDACTED]");
    expect(redactUrl(`https://user:pass@example.invalid/ws`)).toBe("https://[REDACTED]:[REDACTED]@example.invalid/ws");
  });
});

describe("MultiplayerClient Protocol-v2 Contract & State Lifecycle", () => {
  const originalWebSocket = (globalThis as any).WebSocket;
  const originalWindow = (globalThis as any).window;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
    (globalThis as any).window = {
      location: {
        protocol: "http:",
        host: "127.0.0.1:8080",
        hostname: "127.0.0.1",
      },
    };
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
    (globalThis as any).window = originalWindow;
  });

  it("negotiates protocolVersion 2 on join_session and adopts validated server modeEpoch and session context", async () => {
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-v2-1",
      username: "Pilot1",
      vehicleKey: "karoo-vonk-11",
      roomCode: "v2-room",
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    const joinMsg = socket.sent.find((m: any) => m.type === "join_session");
    expect(joinMsg).toBeDefined();
    expect(joinMsg.protocolVersion).toBe(2);

    // Simulate server admitting client with non-hardcoded epoch 7
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "session-v2-777",
        participantId: "part-v2-1",
        inviteCode: "v2-room",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 7,
        participants: [],
      }),
    });

    expect(client.getProtocolVersion()).toBe(2);
    expect(client.getModeEpoch()).toBe(7);
    expect(client.getMode()).toBe("driving");
    expect(client.getSessionInfo().modeEpoch).toBe(7);

    client.disconnect();
  });

  it("rejects unsupported or non-negotiated protocolVersion on admission", async () => {
    const invalidVersions = [1, 3, "2", null, undefined, -1, 2.5];

    for (const badVersion of invalidVersions) {
      let capturedError: any = null;
      const client = new MultiplayerClient({
        url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
        token: "valid-jwt",
        userId: "user-bad-proto",
        username: "BadProtoTester",
        onError: (err) => { capturedError = err; },
      });

      await client.connect();
      const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen!();

      socket.onmessage!({
        data: JSON.stringify({
          type: "session_joined",
          sessionId: "session-bad-proto",
          participantId: "part-proto",
          protocolVersion: badVersion,
          mode: "driving",
          modeEpoch: 1,
          participants: [],
        }),
      });

      expect(capturedError).toBeDefined();
      expect(capturedError.code).toBe("INVALID_PROTOCOL_VERSION");
      expect(client.getStatus()).toBe("error");

      client.disconnect();
    }
  });

  it("fails closed across separate missing, zero, negative, fractional, string, and unsafe-integer modeEpoch cases", async () => {
    const testCases: { name: string; epoch: any }[] = [
      { name: "missing epoch", epoch: undefined },
      { name: "zero epoch", epoch: 0 },
      { name: "negative epoch", epoch: -1 },
      { name: "fractional epoch", epoch: 1.5 },
      { name: "string epoch", epoch: "2" },
      { name: "unsafe-integer epoch", epoch: Number.MAX_SAFE_INTEGER + 100 },
      { name: "NaN epoch", epoch: NaN },
      { name: "null epoch", epoch: null },
    ];

    for (const tc of testCases) {
      let capturedError: any = null;
      const client = new MultiplayerClient({
        url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
        token: "valid-jwt",
        userId: `user-epoch-${tc.name}`,
        username: "EpochTester",
        onError: (err) => { capturedError = err; },
      });

      await client.connect();
      const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen!();

      const frame: any = {
        type: "session_joined",
        sessionId: "session-epoch",
        participantId: "part-epoch",
        protocolVersion: 2,
        mode: "driving",
        participants: [],
      };
      if (tc.epoch !== undefined) {
        frame.modeEpoch = tc.epoch;
      }

      socket.onmessage!({
        data: JSON.stringify(frame),
      });

      expect(capturedError, `Expected rejection for ${tc.name}`).toBeDefined();
      expect(capturedError.code).toBe("INVALID_EPOCH");
      expect(client.getStatus()).toBe("error");

      client.disconnect();
    }
  });

  it("initial join extracts parked car from self record within participants list", async () => {
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-join-parked",
      username: "JoinParkedTester",
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    // Production initial admission: top-level carX is omitted, but self participant record has carX
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "session-join-records",
        participantId: "part-join-me",
        protocolVersion: 2,
        mode: "walking",
        modeEpoch: 2,
        participants: [
          {
            participantId: "part-peer",
            userId: "user-peer",
            mode: "driving",
            x: 10,
            y: 0,
            z: 10,
          },
          {
            participantId: "part-join-me",
            userId: "user-join-parked",
            mode: "walking",
            x: 55,
            y: 0,
            z: 75,
            heading: 1.57,
            carX: 50.0,
            carY: 1.5,
            carZ: 70.0,
            carHeading: 0.0,
          },
        ],
      }),
    });

    expect(client.getStatus()).toBe("connected");
    expect(client.getMode()).toBe("walking");
    expect(client.getModeEpoch()).toBe(2);
    expect(client.getParkedCar()).toEqual({
      x: 50.0,
      y: 1.5,
      z: 70.0,
      heading: 0.0,
      speed: 0,
    });

    client.disconnect();
  });

  it("fails closed when server replies with stale modeEpoch on session_reconnected", async () => {
    let capturedError: any = null;
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-stale-reconnect",
      username: "StaleReconnectTester",
      onError: (err) => { capturedError = err; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    // Admitted at epoch 5
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "session-epoch-5",
        participantId: "part-reconnect",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 5,
        participants: [],
      }),
    });

    expect(client.getModeEpoch()).toBe(5);

    // Reconnected message returns stale epoch 4
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_reconnected",
        sessionId: "session-epoch-5",
        participantId: "part-reconnect",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 4,
        participants: [],
      }),
    });

    expect(capturedError).toBeDefined();
    expect(capturedError.code).toBe("EPOCH_MISMATCH");
    expect(client.getStatus()).toBe("error");

    client.disconnect();
  });

  it("rejects pre-admission inputs and enforces mode matching for driving and walking controls", async () => {
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-pre-admission",
      username: "PreAdmissionTester",
    });

    // 1. Before connection/admission: sending input must return false and send nothing
    const preDriveResult = client.sendDrivingInput({ throttle: 1 });
    const preWalkResult = client.sendWalkingInput({ forward: 1 });
    expect(preDriveResult).toBe(false);
    expect(preWalkResult).toBe(false);

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    // Still not admitted
    expect(client.sendDrivingInput({ throttle: 1 })).toBe(false);
    expect(client.sendWalkingInput({ forward: 1 })).toBe(false);

    // 2. Admitted in driving mode at epoch 3
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "session-admit",
        participantId: "part-admit",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 3,
        participants: [],
      }),
    });

    // In driving mode: sendWalkingInput must return false
    expect(client.sendWalkingInput({ forward: 1 })).toBe(false);

    // In driving mode: sendDrivingInput succeeds
    expect(client.sendDrivingInput({ throttle: 1, steer: 0, brake: false })).toBe(true);
    const driveInputs = socket.sent.filter((m: any) => m.type === "input");
    expect(driveInputs).toHaveLength(1);
    expect(driveInputs[0].seq).toBe(1);
    expect(driveInputs[0].epoch).toBe(3);
    expect(driveInputs[0].mode).toBe("driving");

    client.disconnect();
  });

  it("resets monotonic sequence counter to 0 upon admission and reconnection", async () => {
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-v2-seq",
      username: "SeqTester",
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-seq",
        participantId: "part-seq",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 3,
        participants: [],
      }),
    });

    // Send driving input: seq increments from 0 to 1
    expect(client.sendDrivingInput({ throttle: 1, steer: 0, brake: false })).toBe(true);
    const firstInput = socket.sent.find((m: any) => m.type === "input");
    expect(firstInput).toBeDefined();
    expect(firstInput.seq).toBe(1);
    expect(firstInput.epoch).toBe(3);

    expect(client.sendDrivingInput({ throttle: 0.5, steer: 0, brake: false })).toBe(true);
    const inputs = socket.sent.filter((m: any) => m.type === "input");
    expect(inputs).toHaveLength(2);
    expect(inputs[1].seq).toBe(2);

    // Now simulate reconnect with a new modeEpoch 4: sequence must reset to 0
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_reconnected",
        sessionId: "sess-seq",
        participantId: "part-seq",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 4,
        participants: [],
      }),
    });

    expect(client.getModeEpoch()).toBe(4);
    expect(client.sendDrivingInput({ throttle: 0.8, steer: 0, brake: false })).toBe(true);
    const reconnectedInput = socket.sent.filter((m: any) => m.type === "input")[2];
    expect(reconnectedInput.seq).toBe(1); // sequence restarted monotonically from 1
    expect(reconnectedInput.epoch).toBe(4);

    client.disconnect();
  });

  it("fails closed when vehicle_exited receipt has invalid, missing, or stale modeEpoch", async () => {
    let capturedError: any = null;
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-stale-exit",
      username: "StaleExitTester",
      onError: (err) => { capturedError = err; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-exit-stale",
        participantId: "part-exit-stale",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 2,
        participants: [],
      }),
    });

    // Server sends vehicle_exited with stale epoch 2 (must be strictly greater than active 2)
    socket.onmessage!({
      data: JSON.stringify({
        type: "vehicle_exited",
        participantId: "part-exit-stale",
        modeEpoch: 2,
        x: 45.0,
        y: 1.0,
        z: 60.0,
        heading: 1.57,
        carX: 42.0,
        carY: 1.0,
        carZ: 60.0,
        carHeading: 0.0,
      }),
    });

    expect(capturedError).toBeDefined();
    expect(capturedError.code).toBe("INVALID_EPOCH");
    expect(client.getStatus()).toBe("error");

    client.disconnect();
  });

  it("fails closed when vehicle_exited receipt is missing parked car coordinates", async () => {
    let capturedError: any = null;
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-malformed-exit",
      username: "MalformedExitTester",
      onError: (err) => { capturedError = err; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-malformed",
        participantId: "part-malformed",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        participants: [],
      }),
    });

    // Server sends vehicle_exited with valid epoch 2 but missing carX/carZ
    socket.onmessage!({
      data: JSON.stringify({
        type: "vehicle_exited",
        participantId: "part-malformed",
        modeEpoch: 2,
        x: 45.0,
        y: 1.0,
        z: 60.0,
        heading: 1.57,
        // carX and carZ intentionally missing
      }),
    });

    expect(capturedError).toBeDefined();
    expect(capturedError.code).toBe("MALFORMED_TRANSITION_RECEIPT");
    expect(client.getStatus()).toBe("error");

    client.disconnect();
  });

  it("dispatches exit_vehicle with active modeEpoch, resets sequence, adopts walking mode and parked car on receipt", async () => {
    let modeChangedEvent: any = null;
    let vehicleExitedEvent: any = null;

    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-v2-exit",
      username: "Walker1",
      vehicleKey: "karoo-vonk-11",
      onModeChanged: (ev) => { modeChangedEvent = ev; },
      onVehicleExited: (ev) => { vehicleExitedEvent = ev; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-exit",
        participantId: "part-exit",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        participants: [],
      }),
    });

    // Advance sequence in driving mode
    expect(client.sendDrivingInput({ throttle: 1 })).toBe(true);
    expect(socket.sent.filter((m: any) => m.type === "input")[0].seq).toBe(1);

    // Call exitVehicle()
    expect(client.exitVehicle()).toBe(true);
    const exitMsg = socket.sent.find((m: any) => m.type === "exit_vehicle");
    expect(exitMsg).toBeDefined();
    expect(exitMsg.epoch).toBe(1);

    // Receive vehicle_exited confirmation from server with incremented epoch 2 and parked car pose
    socket.onmessage!({
      data: JSON.stringify({
        type: "vehicle_exited",
        participantId: "part-exit",
        modeEpoch: 2,
        x: 45.0,
        y: 1.0,
        z: 60.0,
        heading: 1.57,
        carX: 42.0,
        carY: 1.0,
        carZ: 60.0,
        carHeading: 0.0,
      }),
    });

    expect(client.getMode()).toBe("walking");
    expect(client.getModeEpoch()).toBe(2);
    expect(client.getParkedCar()).toEqual({
      x: 42.0,
      y: 1.0,
      z: 60.0,
      heading: 0.0,
      speed: 0,
    });
    expect(vehicleExitedEvent).toBeDefined();
    expect(vehicleExitedEvent.modeEpoch).toBe(2);
    expect(modeChangedEvent).toBeDefined();
    expect(modeChangedEvent.mode).toBe("walking");
    expect(modeChangedEvent.carX).toBe(42.0);

    // Driving input must now be rejected in walking mode
    expect(client.sendDrivingInput({ throttle: 1 })).toBe(false);

    // Next walking input must start at seq: 1 with epoch: 2
    expect(client.sendWalkingInput({ forward: 1, strafe: 0, heading: 1.57, sprint: true })).toBe(true);
    const walkInputs = socket.sent.filter((m: any) => m.type === "input" && m.mode === "walking");
    expect(walkInputs).toHaveLength(1);
    expect(walkInputs[0].seq).toBe(1);
    expect(walkInputs[0].epoch).toBe(2);
    expect(walkInputs[0].forward).toBe(1);
    expect(walkInputs[0].sprint).toBe(true);

    client.disconnect();
  });

  it("dispatches board_vehicle with active modeEpoch, resets sequence, adopts driving mode and clears parked car", async () => {
    let modeChangedEvent: any = null;

    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-v2-board",
      username: "Boarder",
      vehicleKey: "karoo-vonk-11",
      onModeChanged: (ev) => { modeChangedEvent = ev; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    // Admitted on foot with parked car
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-board",
        participantId: "part-board",
        protocolVersion: 2,
        mode: "walking",
        modeEpoch: 2,
        carX: 50.0,
        carY: 2.0,
        carZ: 80.0,
        carHeading: 3.14,
        participants: [],
      }),
    });

    expect(client.getMode()).toBe("walking");
    expect(client.getParkedCar()).toBeDefined();

    // Walking player cannot call exitVehicle()
    expect(client.exitVehicle()).toBe(false);

    // Call boardVehicle()
    expect(client.boardVehicle()).toBe(true);
    const boardMsg = socket.sent.find((m: any) => m.type === "board_vehicle");
    expect(boardMsg).toBeDefined();
    expect(boardMsg.epoch).toBe(2);

    // Server acknowledges vehicle_boarded with incremented epoch 3
    socket.onmessage!({
      data: JSON.stringify({
        type: "vehicle_boarded",
        participantId: "part-board",
        modeEpoch: 3,
        vehicleKey: "karoo-vonk-11",
        x: 50.0,
        y: 2.0,
        z: 80.0,
        heading: 3.14,
      }),
    });

    expect(client.getMode()).toBe("driving");
    expect(client.getModeEpoch()).toBe(3);
    expect(client.getParkedCar()).toBeUndefined();
    expect(modeChangedEvent.mode).toBe("driving");

    // Driving input starts at seq 1 with epoch 3
    expect(client.sendDrivingInput({ throttle: 1, steer: 0, brake: false })).toBe(true);
    const driveInputs = socket.sent.filter((m: any) => m.type === "input" && m.mode === "driving");
    expect(driveInputs).toHaveLength(1);
    expect(driveInputs[0].seq).toBe(1);
    expect(driveInputs[0].epoch).toBe(3);

    client.disconnect();
  });

  it("fails closed when vehicle_boarded receipt has stale modeEpoch", async () => {
    let capturedError: any = null;
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-stale-board",
      username: "StaleBoardTester",
      onError: (err) => { capturedError = err; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-board-stale",
        participantId: "part-board-stale",
        protocolVersion: 2,
        mode: "walking",
        modeEpoch: 3,
        carX: 50.0,
        carY: 2.0,
        carZ: 80.0,
        carHeading: 0.0,
        participants: [],
      }),
    });

    // Server sends vehicle_boarded with stale epoch 3 (must be strictly greater than active 3)
    socket.onmessage!({
      data: JSON.stringify({
        type: "vehicle_boarded",
        participantId: "part-board-stale",
        modeEpoch: 3,
        vehicleKey: "karoo-vonk-11",
        x: 50.0,
        y: 2.0,
        z: 80.0,
        heading: 0.0,
      }),
    });

    expect(capturedError).toBeDefined();
    expect(capturedError.code).toBe("INVALID_EPOCH");
    expect(client.getStatus()).toBe("error");

    client.disconnect();
  });

  it("handles peer_mode_changed and snapshot parked-car coordinates for remote participants", async () => {
    let peerPoseReceived: any = null;

    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-v2-peer",
      username: "PeerObserver",
      onPeerPose: (pid, pose) => { peerPoseReceived = { pid, pose }; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-peers",
        participantId: "my-part",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        participants: [],
      }),
    });

    // Receive peer mode change (production format omits car coordinates)
    socket.onmessage!({
      data: JSON.stringify({
        type: "peer_mode_changed",
        participantId: "remote-peer-1",
        mode: "walking",
        modeEpoch: 2,
        isPedestrian: true,
        vehicleKey: "karoo-vonk-11",
        x: 100.0,
        y: 2.0,
        z: 200.0,
        heading: 0.5,
      }),
    });

    expect(peerPoseReceived).toBeDefined();
    expect(peerPoseReceived.pid).toBe("remote-peer-1");
    expect(peerPoseReceived.pose.isPedestrian).toBe(true);
    expect(peerPoseReceived.pose.modeEpoch).toBe(2);
    expect(peerPoseReceived.pose.carX).toBeUndefined();

    // Receive snapshot with peer having parked car
    socket.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-peers",
        seq: 10,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "remote-peer-1",
            userId: "user-rem-1",
            username: "RemoteGuy",
            isPedestrian: true,
            mode: "walking",
            modeEpoch: 2,
            x: 105.0,
            y: 2.0,
            z: 202.0,
            heading: 0.6,
            speed: 1.2,
            carX: 98.0,
            carY: 2.0,
            carZ: 200.0,
            carHeading: 0.0,
          },
        ],
      }),
    });

    expect(peerPoseReceived.pose.x).toBe(105.0);
    expect(peerPoseReceived.pose.carX).toBe(98.0);
    expect(peerPoseReceived.pose.carHeading).toBe(0.0);

    client.disconnect();
  });

  it("fails closed on OWNERSHIP_AUTHORITY_ABSENT error from server", async () => {
    let capturedError: any = null;

    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-v2-absent",
      username: "AbsentClient",
      onError: (err) => { capturedError = err; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "error",
        error: "OWNERSHIP_AUTHORITY_ABSENT",
        message: "Authoritative User service ownership client is not configured",
      }),
    });

    expect(capturedError).toBeDefined();
    expect(capturedError.code).toBe("OWNERSHIP_AUTHORITY_ABSENT");
    expect(client.getStatus()).toBe("error");
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(client.getSessionInfo().sessionId).toBeNull();
    expect(client.getParkedCar()).toBeUndefined();
    expect(client.sendDrivingInput({ throttle: 1 })).toBe(false);
    expect(client.sendWalkingInput({ forward: 1 })).toBe(false);

    client.disconnect();
  });

  it("handles post-admission ownership denial by closing socket, clearing state, and rejecting further input", async () => {
    let capturedError: any = null;

    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-post-admit",
      username: "PostAdmitClient",
      onError: (err) => { capturedError = err; },
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    // 1. Successfully admit driving
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-post-admit",
        inviteCode: "POST1",
        participantId: "part-post-admit",
        participants: [],
      }),
    });

    expect(client.getStatus()).toBe("connected");
    expect(client.getSessionInfo().sessionId).toBe("sess-post-admit");
    expect(client.sendDrivingInput({ throttle: 1, steer: 0, brake: false })).toBe(true);

    // 2. Server subsequently emits OWNERSHIP_AUTHORITY_ABSENT post-admission
    socket.onmessage!({
      data: JSON.stringify({
        type: "error",
        error: "OWNERSHIP_AUTHORITY_ABSENT",
        message: "Authoritative User service ownership revoked post-admission",
      }),
    });

    expect(capturedError).toBeDefined();
    expect(capturedError.code).toBe("OWNERSHIP_AUTHORITY_ABSENT");
    expect(client.getStatus()).toBe("error");
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    expect(client.getSessionInfo().sessionId).toBeNull();
    expect(client.getSessionInfo().participantId).toBeNull();
    expect(client.getModeEpoch()).toBe(0);
    expect(client.getParkedCar()).toBeUndefined();
    expect(client.sendDrivingInput({ throttle: 1 })).toBe(false);
    expect(client.sendWalkingInput({ forward: 1 })).toBe(false);

    client.disconnect();
  });

  it("ignores late snapshot and pose frames after account change or session change", async () => {
    let receivedSnapshots = 0;
    let receivedPeerPoses = 0;

    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "jwt-u1",
      userId: "u1",
      username: "User1",
      onSnapshot: () => { receivedSnapshots++; },
      onPeerPose: () => { receivedPeerPoses++; },
    });

    await client.connect();
    const socket1 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket1.readyState = MockWebSocket.OPEN;
    socket1.onopen!();

    socket1.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-1",
        participantId: "part-1",
        participants: [],
      }),
    });

    const oldOnMessage = socket1.onmessage;

    // Change account to u2
    client.updateAccount({
      userId: "u2",
      username: "User2",
      token: "jwt-u2",
    });

    expect(client.getStatus()).toBe("disconnected");
    expect(socket1.readyState).toBe(MockWebSocket.CLOSED);
    expect(socket1.onmessage).toBeNull();

    // Late snapshot from old session arriving on old socket handler
    oldOnMessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-1",
        seq: 5,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "part-remote",
            userId: "u3",
            mode: "walking",
            x: 10,
            y: 0,
            z: 20,
            carX: 5,
            carZ: 5,
          },
        ],
      }),
    });

    // Late peer pose from old socket handler
    oldOnMessage?.({
      data: JSON.stringify({
        type: "peer_pose",
        participantId: "part-remote",
        mode: "walking",
        x: 12,
        y: 0,
        z: 22,
      }),
    });

    // Neither callback should have fired after account change
    expect(receivedSnapshots).toBe(0);
    expect(receivedPeerPoses).toBe(0);
    expect(client.getParkedCar()).toBeUndefined();
    expect(client.getModeEpoch()).toBe(0);

    client.disconnect();
  });

  it("clears obsolete parked-car, session, and control state on reconnect and account change", async () => {
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "jwt-user-1",
      userId: "user-1",
      username: "Player1",
      roomCode: "ROOM-1",
    });

    await client.connect();
    const socket1 = MockWebSocket.instances[0]!;
    socket1.readyState = MockWebSocket.OPEN;
    socket1.onopen!();

    // Admitted walking with a parked car
    socket1.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 3,
        mode: "walking",
        sessionId: "sess-abc",
        inviteCode: "ROOM-1",
        participantId: "part-1",
        carX: 100,
        carY: 2,
        carZ: 200,
        carHeading: 1.57,
        participants: [],
      }),
    });

    expect(client.getStatus()).toBe("connected");
    expect(client.getMode()).toBe("walking");
    expect(client.getParkedCar()).toEqual({
      x: 100,
      y: 2,
      z: 200,
      heading: 1.57,
      speed: 0,
    });
    expect(client.getModeEpoch()).toBe(3);

    // Send some walking input to advance sequence
    client.sendWalkingInput({ forward: 1 });

    // Now reconnected with driving mode (e.g. fresh spawn or boarded elsewhere)
    socket1.onmessage!({
      data: JSON.stringify({
        type: "session_reconnected",
        protocolVersion: 2,
        modeEpoch: 4,
        mode: "driving",
        sessionId: "sess-abc",
        inviteCode: "ROOM-1",
        participantId: "part-1",
        participants: [],
      }),
    });

    // Parked car must be cleared, mode updated to driving, sequence reset
    expect(client.getMode()).toBe("driving");
    expect(client.getParkedCar()).toBeUndefined();
    expect(client.getModeEpoch()).toBe(4);

    // Now account change: updateAccount should disconnect and clear all state
    client.updateAccount({
      userId: "user-2",
      username: "Player2",
      token: "jwt-user-2",
    });

    expect(client.getStatus()).toBe("disconnected");
    expect(client.getModeEpoch()).toBe(0);
    expect(client.getParkedCar()).toBeUndefined();
    expect(client.getSessionInfo().sessionId).toBeNull();
  });

  it("enforces snapshot sessionId matching, monotonic sequence progression, and drops stale or mismatched snapshots", async () => {
    let snapshotCount = 0;
    let peerPoseCount = 0;
    let lastReceivedSeq = 0;

    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "snap-user",
      username: "SnapUser",
      onSnapshot: (snap) => {
        snapshotCount++;
        lastReceivedSeq = snap.seq;
      },
      onPeerPose: () => {
        peerPoseCount++;
      },
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    // 1. Negative: Snapshot sent before admission is dropped
    socket.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap",
        seq: 1,
        timestamp: Date.now(),
        participants: [],
      }),
    });
    expect(snapshotCount).toBe(0);
    expect(client.getLastSnapshotSeq()).toBe(0);

    // 2. Admit session
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-snap",
        participantId: "part-snap",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        participants: [],
      }),
    });
    expect(client.getStatus()).toBe("connected");

    // 3. Positive: Valid new snapshot with seq: 10
    socket.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap",
        seq: 10,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "peer-snap",
            userId: "peer-user",
            mode: "walking",
            x: 20,
            y: 0,
            z: 30,
          },
        ],
      }),
    });
    expect(snapshotCount).toBe(1);
    expect(peerPoseCount).toBe(1);
    expect(lastReceivedSeq).toBe(10);
    expect(client.getLastSnapshotSeq()).toBe(10);

    // 4. Negatives: Invalid sessionId cases (missing, null, empty string, mismatched) are dropped
    const invalidSessionIds = [undefined, null, "", "wrong-session-id"];
    for (const sid of invalidSessionIds) {
      socket.onmessage!({
        data: JSON.stringify({
          type: "snapshot",
          sessionId: sid,
          seq: 15,
          timestamp: Date.now(),
          participants: [{ participantId: "peer-snap", x: 50, z: 50 }],
        }),
      });
      expect(snapshotCount).toBe(1);
      expect(client.getLastSnapshotSeq()).toBe(10);
    }

    // 5. Negatives: Invalid seq cases (missing, null, string, zero, negative, fractional, unsafe integer) are dropped
    const invalidSeqs = [
      undefined,
      null,
      "12",
      0,
      -1,
      12.5,
      Number.MAX_SAFE_INTEGER + 100,
      NaN,
      Infinity,
    ];
    for (const badSeq of invalidSeqs) {
      socket.onmessage!({
        data: JSON.stringify({
          type: "snapshot",
          sessionId: "sess-snap",
          seq: badSeq,
          timestamp: Date.now(),
          participants: [{ participantId: "peer-snap", x: 60, z: 60 }],
        }),
      });
      expect(snapshotCount).toBe(1);
      expect(client.getLastSnapshotSeq()).toBe(10);
    }

    // 6. Negatives: Stale/older sequence (seq: 8 <= 10) and duplicate sequence (seq: 10 <= 10) are dropped
    socket.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap",
        seq: 8,
        timestamp: Date.now(),
        participants: [{ participantId: "peer-snap", x: 99, z: 99 }],
      }),
    });
    expect(snapshotCount).toBe(1);
    expect(client.getLastSnapshotSeq()).toBe(10);

    socket.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap",
        seq: 10,
        timestamp: Date.now(),
        participants: [{ participantId: "peer-snap", x: 99, z: 99 }],
      }),
    });
    expect(snapshotCount).toBe(1);
    expect(client.getLastSnapshotSeq()).toBe(10);

    // 7. Positive: Advance sequence to seq: 11
    socket.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap",
        seq: 11,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "peer-snap",
            userId: "peer-user",
            mode: "walking",
            x: 25,
            y: 0,
            z: 35,
          },
        ],
      }),
    });
    expect(snapshotCount).toBe(2);
    expect(peerPoseCount).toBe(2);
    expect(lastReceivedSeq).toBe(11);
    expect(client.getLastSnapshotSeq()).toBe(11);

    // 8. Positive: Reconnect resets snapshot sequence and adopts fresh initial snapshot
    socket.onmessage!({
      data: JSON.stringify({
        type: "session_reconnected",
        protocolVersion: 2,
        modeEpoch: 2,
        mode: "driving",
        sessionId: "sess-snap-reconnected",
        inviteCode: "RECON1",
        participantId: "part-snap",
        participants: [],
      }),
    });
    expect(client.getLastSnapshotSeq()).toBe(0);
    expect(client.getSessionInfo().sessionId).toBe("sess-snap-reconnected");

    // Now snapshot with seq: 1 on new session is adopted!
    socket.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap-reconnected",
        seq: 1,
        timestamp: Date.now(),
        participants: [
          {
            participantId: "peer-snap",
            userId: "peer-user",
            mode: "driving",
            x: 30,
            y: 0,
            z: 40,
          },
        ],
      }),
    });
    expect(snapshotCount).toBe(3);
    expect(lastReceivedSeq).toBe(1);
    expect(client.getLastSnapshotSeq()).toBe(1);

    client.disconnect();
  });

  it("verifies request-sent positives: exitVehicle, boardVehicle, and typed inputs emit exact protocol-v2 frames", async () => {
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:8080/api/v1/citylife/ws",
      token: "valid-jwt",
      userId: "user-req-test",
      username: "Requester",
    });

    await client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen!();

    socket.onmessage!({
      data: JSON.stringify({
        type: "session_joined",
        protocolVersion: 2,
        modeEpoch: 1,
        mode: "driving",
        sessionId: "sess-req-1",
        inviteCode: "REQ001",
        participantId: "part-req-1",
        participants: [],
      }),
    });

    // 1. exitVehicle emits exact { type: "exit_vehicle", epoch: 1 }
    const exitSent = client.exitVehicle();
    expect(exitSent).toBe(true);
    const exitMsg = socket.sent.find((m) => m.type === "exit_vehicle");
    expect(exitMsg).toEqual({
      type: "exit_vehicle",
      epoch: 1,
    });

    // Simulate server acknowledging exit -> mode becomes walking, epoch becomes 2
    socket.onmessage!({
      data: JSON.stringify({
        type: "vehicle_exited",
        modeEpoch: 2,
        participantId: "part-req-1",
        x: 10,
        y: 0,
        z: 20,
        heading: 0,
        carX: 0,
        carY: 0,
        carZ: 0,
        carHeading: 0,
      }),
    });
    expect(client.getMode()).toBe("walking");
    expect(client.getModeEpoch()).toBe(2);

    // 2. sendWalkingInput emits exact { type: "input", mode: "walking", seq: 101, epoch: 2, ... }
    const walkInputSent = client.sendWalkingInput({
      seq: 101,
      epoch: 2,
      forward: 1,
      strafe: 0,
      heading: 1.57,
      sprint: false,
    });
    expect(walkInputSent).toBe(true);
    const walkMsg = socket.sent.find((m) => m.type === "input" && m.mode === "walking");
    expect(walkMsg).toEqual({
      type: "input",
      mode: "walking",
      seq: 101,
      epoch: 2,
      forward: 1,
      strafe: 0,
      heading: 1.57,
      sprint: false,
    });

    // 3. boardVehicle emits exact { type: "board_vehicle", epoch: 2 }
    const boardSent = client.boardVehicle();
    expect(boardSent).toBe(true);
    const boardMsg = socket.sent.find((m) => m.type === "board_vehicle");
    expect(boardMsg).toEqual({
      type: "board_vehicle",
      epoch: 2,
    });

    // Simulate server acknowledging boarding -> mode becomes driving, epoch becomes 3
    socket.onmessage!({
      data: JSON.stringify({
        type: "vehicle_boarded",
        modeEpoch: 3,
        participantId: "part-req-1",
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
      }),
    });
    expect(client.getMode()).toBe("driving");
    expect(client.getModeEpoch()).toBe(3);

    // 4. sendDrivingInput emits exact { type: "input", mode: "driving", seq: 201, epoch: 3, ... }
    const driveInputSent = client.sendDrivingInput({
      seq: 201,
      epoch: 3,
      throttle: 1,
      steer: 0,
      brake: false,
    });
    expect(driveInputSent).toBe(true);
    const driveMsg = socket.sent.find((m) => m.type === "input" && m.mode === "driving");
    expect(driveMsg).toEqual({
      type: "input",
      mode: "driving",
      seq: 201,
      epoch: 3,
      throttle: 1,
      steer: 0,
      brake: false,
    });

    client.disconnect();
  });
});
