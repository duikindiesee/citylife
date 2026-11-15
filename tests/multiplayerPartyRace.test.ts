import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MultiplayerClient,
  type PartyRaceState,
} from "../src/colony/multiplayer/multiplayerClient";

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

describe("MultiplayerClient Party Race Protocol & State Sync", () => {
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

  it("dispatches party_race_invite, party_race_join, party_race_ready, party_race_start, party_race_leave, party_race_cancel with session authority and tracks state", async () => {
    const events: Array<{ state: PartyRaceState | null; event?: string }> = [];
    const client = new MultiplayerClient({
      userId: "2001",
      username: "RacerHost",
      token: "valid-token",
      worldId: "seed-4242",
      layoutRevision: "wl:v1:0:" + "a".repeat(64),
      neighbourhoodKey: "wood1",
      onPartyRaceState: (state, event) => {
        events.push({ state, event });
      },
    });

    await client.connect("PARTY1");
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        sessionId: "sess-party-1",
        inviteCode: "PARTY1",
        participantId: "part-host",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        worldId: "seed-4242",
        layoutRevision: "wl:v1:0:" + "a".repeat(64),
        neighbourhoodKey: "wood1",
        participants: [],
      }),
    });

    expect(client.getStatus()).toBe("connected");
    expect(client.getPartyRaceState()).toBeNull();

    // 1. Invite without client raceId (server generates raceId)
    const invited = client.invitePartyRace({
      countdownMs: 2000,
      checkpoints: [{ x: 10, z: 20, radiusMetres: 8, label: "Finish" }],
    });
    expect(invited).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_invite",
      sessionId: "sess-party-1",
      countdownMs: 2000,
      checkpoints: [{ x: 10, z: 20, radiusMetres: 8, label: "Finish" }],
    });

    // Operations without a raceId before any state exist must return false
    expect(client.joinPartyRace()).toBe(false);
    expect(client.setPartyRaceReady(true)).toBe(false);
    expect(client.startPartyRace()).toBe(false);
    expect(client.cancelPartyRace()).toBe(false);
    expect(client.leavePartyRace()).toBe(false);

    const sampleRace: PartyRaceState = {
      raceId: "race-123",
      hostUserId: "2001",
      hostParticipantId: "part-host",
      status: "lobby",
      createdAtMs: 1000,
      countdownMs: 2000,
      countdownEndsAtMs: null,
      startedAtMs: null,
      finishedAtMs: null,
      winnerUserId: null,
      checkpoints: [{ x: 10, z: 20, radiusMetres: 8, label: "Finish" }],
      entrants: [
        {
          userId: "2001",
          participantId: "part-host",
          username: "RacerHost",
          vehicleKey: "showroom:karoo-kaap-gt-v8",
          ready: true,
          checkpointIndex: 0,
          finishedAtMs: null,
          elapsedMs: null,
          place: null,
          joinedAtMs: 1000,
        },
      ],
    };

    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-party-1",
        event: "invited",
        partyRace: sampleRace,
      }),
    });

    expect(client.getPartyRaceState()?.raceId).toBe("race-123");
    expect(events.at(-1)?.event).toBe("invited");

    // 2. Join, Ready, Start, Leave, Cancel include sessionId and raceId
    expect(client.joinPartyRace("race-123")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_join",
      sessionId: "sess-party-1",
      raceId: "race-123",
    });

    // Fallback to existing partyRaceState.raceId when omitted
    expect(client.setPartyRaceReady(true)).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_ready",
      sessionId: "sess-party-1",
      raceId: "race-123",
      ready: true,
    });

    expect(client.startPartyRace("race-123")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_start",
      sessionId: "sess-party-1",
      raceId: "race-123",
    });

    expect(client.leavePartyRace()).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_leave",
      sessionId: "sess-party-1",
      raceId: "race-123",
    });

    expect(client.cancelPartyRace("race-123")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_cancel",
      sessionId: "sess-party-1",
      raceId: "race-123",
    });

    // 3. Receive ready_changed and joined server events
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-party-1",
        event: "ready_changed",
        partyRace: sampleRace,
      }),
    });
    expect(events.at(-1)?.event).toBe("ready_changed");

    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-party-1",
        event: "joined",
        partyRace: sampleRace,
      }),
    });
    expect(events.at(-1)?.event).toBe("joined");

    // 4. Reconnect restores partyRace from session_reconnected when provided
    const finishedRace: PartyRaceState = {
      ...sampleRace,
      status: "finished",
      winnerUserId: "2001",
      finishedAtMs: 5000,
    };
    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_reconnected",
        sessionId: "sess-party-1",
        inviteCode: "PARTY1",
        participantId: "part-host",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 2,
        worldId: "seed-4242",
        layoutRevision: "wl:v1:0:" + "a".repeat(64),
        neighbourhoodKey: "wood1",
        participants: [],
        partyRace: finishedRace,
      }),
    });

    expect(client.getPartyRaceState()?.status).toBe("finished");
    expect(client.getPartyRaceState()?.winnerUserId).toBe("2001");
    expect(events.at(-1)?.event).toBe("session_reconnected");

    // 5. Disconnect clears local partyRace state
    client.disconnect();
    expect(client.getPartyRaceState()).toBeNull();
  });

  it("strictly validates sessionId in inbound party_race_state messages and drops missing, empty, or mismatched frames", async () => {
    const events: Array<{ state: PartyRaceState | null; event?: string }> = [];
    const client = new MultiplayerClient({
      userId: "2002",
      username: "GuestRacer",
      token: "valid-token",
      worldId: "seed-4242",
      onPartyRaceState: (state, event) => {
        events.push({ state, event });
      },
    });

    await client.connect("PARTY2");
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        sessionId: "sess-party-valid",
        inviteCode: "PARTY2",
        participantId: "part-guest",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        worldId: "seed-4242",
        participants: [],
      }),
    });

    expect(client.getPartyRaceState()).toBeNull();
    const eventCountBefore = events.length;

    const sampleRace: PartyRaceState = {
      raceId: "race-999",
      hostUserId: "2001",
      hostParticipantId: "part-host",
      status: "lobby",
      createdAtMs: 1000,
      countdownMs: 3000,
      countdownEndsAtMs: null,
      startedAtMs: null,
      finishedAtMs: null,
      winnerUserId: null,
      checkpoints: [],
      entrants: [],
    };

    // A. Missing sessionId (omitted) -> dropped
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        event: "invited",
        partyRace: sampleRace,
      }),
    });
    expect(client.getPartyRaceState()).toBeNull();
    expect(events.length).toBe(eventCountBefore);

    // B. Empty string sessionId -> dropped
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "",
        event: "invited",
        partyRace: sampleRace,
      }),
    });
    expect(client.getPartyRaceState()).toBeNull();
    expect(events.length).toBe(eventCountBefore);

    // C. Non-string sessionId -> dropped
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: 99999,
        event: "invited",
        partyRace: sampleRace,
      }),
    });
    expect(client.getPartyRaceState()).toBeNull();
    expect(events.length).toBe(eventCountBefore);

    // D. Wrong / stale sessionId -> dropped
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-party-other",
        event: "invited",
        partyRace: sampleRace,
      }),
    });
    expect(client.getPartyRaceState()).toBeNull();
    expect(events.length).toBe(eventCountBefore);

    // E. Matching valid sessionId -> accepted
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-party-valid",
        event: "invited",
        partyRace: sampleRace,
      }),
    });
    expect(client.getPartyRaceState()?.raceId).toBe("race-999");
    expect(events.length).toBe(eventCountBefore + 1);
    expect(events.at(-1)?.event).toBe("invited");
  });

  it("tears down party race state on reconnect when partyRace is omitted", async () => {
    const events: Array<{ state: PartyRaceState | null; event?: string }> = [];
    const client = new MultiplayerClient({
      userId: "2003",
      username: "ReconnectRacer",
      token: "valid-token",
      worldId: "seed-4242",
      onPartyRaceState: (state, event) => {
        events.push({ state, event });
      },
    });

    await client.connect("PARTY3");
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        sessionId: "sess-party-recon",
        inviteCode: "PARTY3",
        participantId: "part-recon",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        worldId: "seed-4242",
        participants: [],
      }),
    });

    // Populate active race state
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-party-recon",
        event: "invited",
        partyRace: {
          raceId: "race-active-1",
          hostUserId: "2003",
          hostParticipantId: "part-recon",
          status: "active",
          createdAtMs: 1000,
          countdownMs: 2000,
          countdownEndsAtMs: null,
          startedAtMs: 3000,
          finishedAtMs: null,
          winnerUserId: null,
          checkpoints: [],
          entrants: [],
        },
      }),
    });
    expect(client.getPartyRaceState()?.raceId).toBe("race-active-1");

    // Reconnect where partyRace is omitted (server has ended or cleaned up race)
    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_reconnected",
        sessionId: "sess-party-recon",
        inviteCode: "PARTY3",
        participantId: "part-recon",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 2,
        worldId: "seed-4242",
        participants: [],
        // partyRace omitted
      }),
    });

    expect(client.getPartyRaceState()).toBeNull();
    expect(events.at(-1)).toEqual({
      state: null,
      event: "session_reconnected",
    });
  });

  it("consumes server c7d1d813 defensive race contract with opaque session-local participant references (R4)", async () => {
    const client = new MultiplayerClient({
      userId: "u-charlie-999",
      username: "Charlie",
      token: "valid-token-charlie",
      vehicleKey: "car-falcon",
    });

    await client.connect("C7RACE");
    const ws = MockWebSocket.instances.at(-1)!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    // Server c7 session_joined establishes session and participantId
    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_joined",
        sessionId: "sess-c7-race",
        inviteCode: "C7RACE",
        participantId: "p-charlie-001",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        worldId: "seed-4242",
        participants: [
          {
            participantId: "p-charlie-001",
            username: "Charlie",
            role: "host",
            carKey: "car-falcon",
            isDriving: true,
            isSeatedBus: false,
          },
          {
            participantId: "p-dana-002",
            username: "Dana",
            role: "guest",
            carKey: "car-comet",
            isDriving: true,
            isSeatedBus: false,
          },
        ],
      }),
    });

    // Server c7 party_race_state uses hostParticipantId and winnerParticipantId; entrants have NO userId
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-c7-race",
        event: "finished",
        partyRace: {
          raceId: "race-c7-win",
          hostParticipantId: "p-charlie-001",
          status: "finished",
          createdAtMs: 1000,
          countdownMs: 3000,
          countdownEndsAtMs: 4000,
          startedAtMs: 4000,
          finishedAtMs: 15000,
          winnerParticipantId: "p-dana-002",
          checkpoints: [
            { x: 10, z: 20, radiusMetres: 8, label: "CP1" },
            { x: 50, z: 60, radiusMetres: 8, label: "Finish" },
          ],
          entrants: [
            {
              participantId: "p-charlie-001",
              username: "Charlie",
              vehicleKey: "car-falcon",
              ready: true,
              checkpointIndex: 2,
              finishedAtMs: 16500,
              elapsedMs: 12500,
              place: 2,
              joinedAtMs: 1100,
            },
            {
              participantId: "p-dana-002",
              username: "Dana",
              vehicleKey: "car-comet",
              ready: true,
              checkpointIndex: 2,
              finishedAtMs: 15000,
              elapsedMs: 11000,
              place: 1,
              joinedAtMs: 1200,
            },
          ],
        },
      }),
    });

    const state = client.getPartyRaceState();
    expect(state).not.toBeNull();
    expect(state?.hostParticipantId).toBe("p-charlie-001");
    expect(state?.winnerParticipantId).toBe("p-dana-002");
    expect(state?.winnerUserId).toBeUndefined();

    // Verify entrant opaque participantId is preserved and userId is absent
    const dana = state?.entrants.find((e) => e.participantId === "p-dana-002");
    expect(dana).toBeDefined();
    expect(dana?.username).toBe("Dana");
    expect(dana?.userId).toBeUndefined();

    // Verify winner resolution via opaque participant reference
    const winnerRef = state?.winnerParticipantId ?? state?.winnerUserId;
    const winnerEntrant = state?.entrants.find(
      (e) => e.participantId === winnerRef || (e as any).userId === winnerRef,
    );
    expect(winnerEntrant?.username).toBe("Dana");
  });
});
