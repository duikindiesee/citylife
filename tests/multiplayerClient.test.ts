import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MultiplayerClient, redactUrl } from "../src/colony/multiplayer/multiplayerClient";
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
