import { describe, it, expect, vi, beforeEach } from "vitest";
import { MultiplayerClient } from "../src/colony/multiplayer/multiplayerClient";

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sentData: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((err: any) => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 10);
  }

  send(data: string) {
    this.sentData.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }
}

describe("MultiplayerClient", () => {
  beforeEach(() => {
    (globalThis as any).WebSocket = MockWebSocket;
  });

  it("connects and sends join_session with roomCode and user details", async () => {
    let sessionReady = false;
    const client = new MultiplayerClient({
      url: "ws://127.0.0.1:9010/ws",
      userId: "192",
      username: "jamtin",
      vehicleKey: "karoo-vonk-11",
      roomCode: "RACE1",
      onSessionReady: (sessionId, inviteCode) => {
        sessionReady = true;
        expect(inviteCode).toBe("RACE1");
      },
    });

    client.connect();
    expect(client.getStatus()).toBe("connecting");

    await new Promise((r) => setTimeout(r, 20));
    expect(client.getStatus()).toBe("connected");

    const ws = (client as any).ws as MockWebSocket;
    expect(ws.sentData.length).toBe(1);
    const joinMsg = JSON.parse(ws.sentData[0]!);
    expect(joinMsg.type).toBe("join_session");
    expect(joinMsg.inviteCode).toBe("RACE1");
    expect(joinMsg.userId).toBe("192");
    expect(joinMsg.username).toBe("jamtin");

    // Simulate session_joined
    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-123",
        inviteCode: "RACE1",
        participantId: "part-1",
        participants: [
          { participantId: "part-1", userId: "192", username: "jamtin" },
        ],
      }),
    });

    expect(sessionReady).toBe(true);
    client.disconnect();
    expect(client.getStatus()).toBe("disconnected");
  });

  it("handles peer_joined and peer_pose events", async () => {
    let peerJoinedRacer: any = null;
    let peerPoseRacer: any = null;

    const client = new MultiplayerClient({
      userId: "192",
      username: "jamtin",
      roomCode: "RACE1",
      onPeerJoined: (peer) => {
        peerJoinedRacer = peer;
      },
      onPeerPose: (partId, pose) => {
        peerPoseRacer = { partId, ...pose };
      },
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 20));

    const ws = (client as any).ws as MockWebSocket;

    // Simulate peer joining
    ws.onmessage?.({
      data: JSON.stringify({
        type: "peer_joined",
        participant: {
          participantId: "part-2",
          userId: "193",
          username: "jamtin2",
          vehicleKey: "karoo-vonk-11",
        },
      }),
    });

    expect(peerJoinedRacer).not.toBeNull();
    expect(peerJoinedRacer.username).toBe("jamtin2");

    // Simulate peer pose
    ws.onmessage?.({
      data: JSON.stringify({
        type: "peer_pose",
        participantId: "part-2",
        x: 55.4,
        y: 12.3,
        z: 60.1,
        heading: 1.57,
        speed: 14.2,
      }),
    });

    expect(peerPoseRacer).not.toBeNull();
    expect(peerPoseRacer.partId).toBe("part-2");
    expect(peerPoseRacer.x).toBe(55.4);
    expect(peerPoseRacer.speed).toBe(14.2);

    client.disconnect();
  });
});
