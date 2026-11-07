import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MultiplayerClient,
  type PartyRaceState,
} from "../src/colony/multiplayer/multiplayerClient";
import {
  buildBusNetworkMiniMapModel,
  canShowPlayerLocationForAccount,
  resolveLocalPlayerMapPosition,
} from "../src/colony/ui/busNetworkMiniMapModel";
import { createColonyLogoutHandler } from "../src/colony/ui/ColonyApp";
import { ColonyRuntime } from "../src/colony/runtime";
import type { RoadWay } from "../src/colony/render/roadRibbon";

// Mock WebSocket class for network protocol testing
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
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((err: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    try {
      this.sent.push(JSON.parse(data));
    } catch {
      this.sent.push(data);
    }
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
}

const mockWays: RoadWay[] = [
  {
    kind: "street",
    width: 3,
    source: "builder",
    path: [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
    ],
  },
  {
    kind: "street",
    width: 3,
    source: "depot-spur",
    path: [
      { x: 30, y: 10 },
      { x: 30, y: 20 },
    ],
  },
];

describe("Adversarial Milestone 2: Session Identity & Reconnect Teardown (M2-01)", () => {
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

  async function establishConnectedClient(sessionId = "sess-adversarial-100") {
    const events: Array<{ state: PartyRaceState | null; event?: string }> = [];
    const client = new MultiplayerClient({
      userId: "1001",
      username: "AdversaryRacer",
      token: "valid-token-1001",
      worldId: "seed-4242",
      layoutRevision: "wl:v1:0:" + "b".repeat(64),
      neighbourhoodKey: "wood1",
      onPartyRaceState: (state, event) => {
        events.push({ state, event });
      },
    });

    await client.connect("ADVROOM");
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();

    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        sessionId,
        inviteCode: "ADVROOM",
        participantId: "part-1001",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        worldId: "seed-4242",
        layoutRevision: "wl:v1:0:" + "b".repeat(64),
        neighbourhoodKey: "wood1",
        participants: [],
      }),
    });

    expect(client.getStatus()).toBe("connected");
    expect(client.getSessionId()).toBe(sessionId);

    return { client, ws, events };
  }

  const sampleRaceState: PartyRaceState = {
    raceId: "race-adv-999",
    hostUserId: "1001",
    hostParticipantId: "part-1001",
    status: "lobby",
    createdAtMs: 1000,
    countdownMs: 3000,
    countdownEndsAtMs: null,
    startedAtMs: null,
    finishedAtMs: null,
    winnerUserId: null,
    checkpoints: [{ x: 10, z: 20, radiusMetres: 8, label: "CP1" }],
    entrants: [
      {
        userId: "1001",
        participantId: "part-1001",
        username: "AdversaryRacer",
        vehicleKey: "showroom:karoo-kaap-gt-v8",
        ready: false,
        checkpointIndex: 0,
        finishedAtMs: null,
        elapsedMs: null,
        place: null,
        joinedAtMs: 1000,
      },
    ],
  };

  it("drops inbound party_race_state before session is established (unconnected states)", async () => {
    const events: Array<{ state: PartyRaceState | null; event?: string }> = [];
    const client = new MultiplayerClient({
      userId: "1001",
      username: "AdversaryRacer",
      token: "valid-token-1001",
      onPartyRaceState: (state, event) => {
        events.push({ state, event });
      },
    });

    // 1. Initial disconnected state
    expect(client.getStatus()).toBe("disconnected");
    expect(client.getSessionId()).toBeNull();

    // Fabricate message arriving while disconnected
    (client as any).handleMessage({
      type: "party_race_state",
      sessionId: "sess-fake",
      partyRace: sampleRaceState,
      event: "invited",
    });

    expect(client.getPartyRaceState()).toBeNull();
    expect(events).toHaveLength(0);

    // 2. Connecting state (WebSocket opened, but join_session not yet acknowledged)
    void client.connect("ADVROOM");
    const ws = MockWebSocket.instances[0]!;
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();
    expect(client.getStatus()).toBe("connecting");

    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-fake",
        partyRace: sampleRaceState,
        event: "invited",
      }),
    });

    expect(client.getPartyRaceState()).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("exhaustively drops inbound party_race_state with empty, null, undefined, numeric, or mismatched sessionId", async () => {
    const { client, ws, events } = await establishConnectedClient("sess-authoritative-42");

    // Initially null partyRaceState
    expect(client.getPartyRaceState()).toBeNull();
    let expectedEventCount = events.length;

    const invalidSessionIds = [
      "", // empty string
      null, // null
      undefined, // undefined
      0, // falsy numeric zero
      42, // numeric matching number
      12345, // positive integer
      -1, // negative integer
      NaN, // NaN
      false, // boolean false
      true, // boolean true
      {}, // empty object
      { sessionId: "sess-authoritative-42" }, // nested object
      [], // array
      ["sess-authoritative-42"], // array of string
      "sess-authoritative-42-other", // mismatched suffix
      "sess-authoritative", // prefix only
      "SESS-AUTHORITATIVE-42", // case-mismatched
      " sess-authoritative-42 ", // leading/trailing spaces
      "sess-stale-from-prior-room", // stale session ID
    ];

    for (const badSessionId of invalidSessionIds) {
      const payload: any = {
        type: "party_race_state",
        event: "invited",
        partyRace: sampleRaceState,
      };
      if (badSessionId !== undefined) {
        payload.sessionId = badSessionId;
      }

      ws.onmessage?.({
        data: JSON.stringify(payload),
      });

      // Assert state was strictly unmutated (remains null)
      expect(client.getPartyRaceState()).toBeNull();
      // Assert callback was NEVER emitted
      expect(events).toHaveLength(expectedEventCount);
    }

    // Now populate a valid race state with authoritative sessionId
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-authoritative-42",
        event: "invited",
        partyRace: sampleRaceState,
      }),
    });

    expectedEventCount++;
    expect(client.getPartyRaceState()?.raceId).toBe("race-adv-999");
    expect(events).toHaveLength(expectedEventCount);
    expect(events.at(-1)?.event).toBe("invited");

    // Stress test: Subsequent attack with corrupted sessionId must NOT mutate or wipe existing valid state!
    const corruptedAttackState: PartyRaceState = {
      ...sampleRaceState,
      raceId: "race-corrupted-exploit",
      status: "finished",
    };

    for (const badSessionId of invalidSessionIds) {
      const attackPayload: any = {
        type: "party_race_state",
        event: "corrupted_event",
        partyRace: corruptedAttackState,
      };
      if (badSessionId !== undefined) {
        attackPayload.sessionId = badSessionId;
      }

      ws.onmessage?.({
        data: JSON.stringify(attackPayload),
      });

      // State MUST remain strictly the prior valid race state, untouched!
      expect(client.getPartyRaceState()?.raceId).toBe("race-adv-999");
      expect(client.getPartyRaceState()?.status).toBe("lobby");
      // Callback MUST NOT be fired
      expect(events).toHaveLength(expectedEventCount);
    }
  });

  it("drops inbound snapshot messages containing partyRace when sessionId is missing or mismatched", async () => {
    const { client, ws, events } = await establishConnectedClient("sess-snap-test");
    const baselineEvents = events.length;

    // Snapshot with mismatched session ID
    ws.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-different-snap",
        seq: 10,
        participants: [],
        partyRace: sampleRaceState,
      }),
    });

    expect(client.getPartyRaceState()).toBeNull();
    expect(events.length).toBe(baselineEvents);

    // Snapshot with missing session ID
    ws.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        seq: 11,
        participants: [],
        partyRace: sampleRaceState,
      }),
    });

    expect(client.getPartyRaceState()).toBeNull();
    expect(events.length).toBe(baselineEvents);

    // Valid snapshot with matching sessionId accepts partyRace
    ws.onmessage?.({
      data: JSON.stringify({
        type: "snapshot",
        sessionId: "sess-snap-test",
        seq: 12,
        participants: [],
        partyRace: sampleRaceState,
      }),
    });

    expect(client.getPartyRaceState()?.raceId).toBe("race-adv-999");
    expect(events.length).toBe(baselineEvents + 1);
    expect(events.at(-1)?.event).toBe("snapshot");
  });

  it("outbound invitePartyRace never transmits client-side raceId and requires connected session", async () => {
    const { client, ws } = await establishConnectedClient("sess-outbound-test");
    const initialSentCount = ws.sent.length;

    // 1. Ordinary invite call
    const res1 = client.invitePartyRace({
      countdownMs: 3000,
      trackId: "track-alberta",
    });
    expect(res1).toBe(true);

    const sent1 = ws.sent.at(-1);
    expect(sent1.type).toBe("party_race_invite");
    expect(sent1.sessionId).toBe("sess-outbound-test");
    expect(sent1.trackId).toBe("track-alberta");
    expect(sent1.countdownMs).toBe(3000);
    // CRITICAL: raceId must NOT be present in transmitted payload
    expect("raceId" in sent1).toBe(false);
    expect(sent1.raceId).toBeUndefined();

    // 2. Adversarial caller attempting to inject client-controlled raceId
    const res2 = client.invitePartyRace({
      trackId: "track-loop",
      raceId: "client-malicious-race-id",
    } as any);
    expect(res2).toBe(true);

    const sent2 = ws.sent.at(-1);
    expect(sent2.type).toBe("party_race_invite");
    expect(sent2.sessionId).toBe("sess-outbound-test");
    expect(sent2.trackId).toBe("track-loop");
    // Client MUST strip/ignore injected raceId
    expect("raceId" in sent2).toBe(false);
    expect(sent2.raceId).toBeUndefined();

    // 3. Disconnected client returns false and sends nothing
    client.disconnect();
    const sentCountAfterDisconnect = ws.sent.length;
    expect(client.invitePartyRace()).toBe(false);
    expect(ws.sent.length).toBe(sentCountAfterDisconnect);
  });

  it("outbound calls (join, ready, start, cancel, leave) strictly enforce non-empty raceId and bind this.sessionId", async () => {
    const { client, ws } = await establishConnectedClient("sess-actions-test");

    // 1. Without active partyRaceState and without explicit raceId: ALL operations return false
    expect(client.getPartyRaceState()).toBeNull();
    const sentCountBefore = ws.sent.length;

    expect(client.joinPartyRace()).toBe(false);
    expect(client.setPartyRaceReady(true)).toBe(false);
    expect(client.startPartyRace()).toBe(false);
    expect(client.cancelPartyRace()).toBe(false);
    expect(client.leavePartyRace()).toBe(false);
    expect(ws.sent.length).toBe(sentCountBefore);

    // 2. With invalid / empty / whitespace / non-string explicit raceId: ALL operations return false
    const invalidRaceIds = [
      "",
      "   ",
      "\t\n",
      null as any,
      undefined,
      12345 as any,
      {} as any,
      [] as any,
    ];

    for (const badRaceId of invalidRaceIds) {
      expect(client.joinPartyRace(badRaceId)).toBe(false);
      expect(client.setPartyRaceReady(true, badRaceId)).toBe(false);
      expect(client.startPartyRace(badRaceId)).toBe(false);
      expect(client.cancelPartyRace(badRaceId)).toBe(false);
      expect(client.leavePartyRace(badRaceId)).toBe(false);
      expect(ws.sent.length).toBe(sentCountBefore);
    }

    // 3. Explicit valid raceId transmits sessionId and trimmed raceId
    expect(client.joinPartyRace("  race-join-1  ")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_join",
      sessionId: "sess-actions-test",
      raceId: "race-join-1",
    });

    expect(client.setPartyRaceReady(true, "race-ready-1")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_ready",
      sessionId: "sess-actions-test",
      raceId: "race-ready-1",
      ready: true,
    });

    expect(client.setPartyRaceReady(false, "race-ready-1")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_ready",
      sessionId: "sess-actions-test",
      raceId: "race-ready-1",
      ready: false,
    });

    expect(client.startPartyRace("race-start-1")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_start",
      sessionId: "sess-actions-test",
      raceId: "race-start-1",
    });

    expect(client.cancelPartyRace("race-cancel-1")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_cancel",
      sessionId: "sess-actions-test",
      raceId: "race-cancel-1",
    });

    expect(client.leavePartyRace("race-leave-1")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_leave",
      sessionId: "sess-actions-test",
      raceId: "race-leave-1",
    });

    // 4. Fallback to active partyRaceState.raceId when raceId parameter is omitted
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-actions-test",
        event: "invited",
        partyRace: { ...sampleRaceState, raceId: "race-state-fallback" },
      }),
    });
    expect(client.getPartyRaceState()?.raceId).toBe("race-state-fallback");

    expect(client.joinPartyRace()).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_join",
      sessionId: "sess-actions-test",
      raceId: "race-state-fallback",
    });

    expect(client.setPartyRaceReady(true)).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_ready",
      sessionId: "sess-actions-test",
      raceId: "race-state-fallback",
      ready: true,
    });

    expect(client.startPartyRace()).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_start",
      sessionId: "sess-actions-test",
      raceId: "race-state-fallback",
    });

    expect(client.cancelPartyRace()).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_cancel",
      sessionId: "sess-actions-test",
      raceId: "race-state-fallback",
    });

    expect(client.leavePartyRace()).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_leave",
      sessionId: "sess-actions-test",
      raceId: "race-state-fallback",
    });

    // 5. Explicit raceId overrides active state raceId
    expect(client.leavePartyRace("race-override-explicit")).toBe(true);
    expect(ws.sent.at(-1)).toEqual({
      type: "party_race_leave",
      sessionId: "sess-actions-test",
      raceId: "race-override-explicit",
    });
  });

  it("tears down party race state immediately on reconnect without partyRace or with null partyRace", async () => {
    const { client, ws, events } = await establishConnectedClient("sess-recon-test");

    // Populate active race state
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-recon-test",
        event: "invited",
        partyRace: sampleRaceState,
      }),
    });
    expect(client.getPartyRaceState()?.raceId).toBe("race-adv-999");

    // Scenario A: session_reconnected arrives without partyRace property
    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_reconnected",
        sessionId: "sess-recon-test",
        inviteCode: "ADVROOM",
        participantId: "part-1001",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 2,
        worldId: "seed-4242",
        layoutRevision: "wl:v1:0:" + "b".repeat(64),
        neighbourhoodKey: "wood1",
        participants: [],
        // partyRace omitted
      }),
    });

    expect(client.getPartyRaceState()).toBeNull();
    expect(events.at(-1)).toEqual({
      state: null,
      event: "session_reconnected",
    });

    // Re-populate race state
    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-recon-test",
        event: "invited",
        partyRace: sampleRaceState,
      }),
    });
    expect(client.getPartyRaceState()?.raceId).toBe("race-adv-999");

    // Scenario B: session_reconnected arrives with explicit partyRace: null
    ws.onmessage?.({
      data: JSON.stringify({
        type: "session_reconnected",
        sessionId: "sess-recon-test",
        inviteCode: "ADVROOM",
        participantId: "part-1001",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 3,
        worldId: "seed-4242",
        layoutRevision: "wl:v1:0:" + "b".repeat(64),
        neighbourhoodKey: "wood1",
        participants: [],
        partyRace: null,
      }),
    });

    expect(client.getPartyRaceState()).toBeNull();
    expect(events.at(-1)).toEqual({
      state: null,
      event: "session_reconnected",
    });
  });

  it("tears down party race state immediately on explicit disconnect or account switch", async () => {
    const { client, ws } = await establishConnectedClient("sess-teardown-lifecycle");

    ws.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-teardown-lifecycle",
        event: "invited",
        partyRace: sampleRaceState,
      }),
    });
    expect(client.getPartyRaceState()?.raceId).toBe("race-adv-999");

    // 1. Explicit disconnect
    client.disconnect();
    expect(client.getPartyRaceState()).toBeNull();
    expect(client.getStatus()).toBe("disconnected");

    // 2. Re-establish and test updateAccount
    await client.connect("ADVROOM");
    const ws2 = MockWebSocket.instances.at(-1)!;
    ws2.readyState = MockWebSocket.OPEN;
    ws2.onopen?.();
    ws2.onmessage?.({
      data: JSON.stringify({
        type: "session_created",
        sessionId: "sess-account-switch",
        inviteCode: "ADVROOM",
        participantId: "part-1001",
        protocolVersion: 2,
        mode: "driving",
        modeEpoch: 1,
        worldId: "seed-4242",
        layoutRevision: "wl:v1:0:" + "b".repeat(64),
        neighbourhoodKey: "wood1",
        participants: [],
      }),
    });
    ws2.onmessage?.({
      data: JSON.stringify({
        type: "party_race_state",
        sessionId: "sess-account-switch",
        event: "invited",
        partyRace: sampleRaceState,
      }),
    });
    expect(client.getPartyRaceState()?.raceId).toBe("race-adv-999");

    // Switch account
    client.updateAccount({ userId: "1002", username: "NewAccountUser" });
    expect(client.getPartyRaceState()).toBeNull();
    expect(client.getStatus()).toBe("disconnected");
  });
});

describe("Adversarial Milestone 2: Fail-Closed Location Authorization & Logout Hygiene (M2-04)", () => {
  const baseMapInput = {
    ways: mockWays,
    routeStops: [{ x: 15, y: 10 }],
    depot: { x: 30, y: 20 },
    buses: [{ id: 1, x: 20, y: 10 }],
    width: 200,
    height: 132,
    padding: 8,
  };

  const samplePeers = [
    {
      participantId: "peer-remote-1",
      username: "RemotePeer1",
      x: 18,
      y: 10,
      parkedCar: { x: 17, y: 10 },
    },
    {
      participantId: "peer-remote-2",
      username: "RemotePeer2",
      x: 22,
      y: 10,
      parkedCar: null,
    },
  ];

  const sampleParkedCarsList = [
    { id: "local-car-1", ownerName: "LocalUser", isLocal: true, x: 14, y: 10 },
    { id: "remote-car-1", ownerName: "RemoteUser1", isLocal: false, x: 25, y: 10 },
  ];

  it("buildBusNetworkMiniMapModel fails closed on missing, undefined, false, null, and malformed authorization", () => {
    const unauthInputs = [
      undefined, // omitted/undefined
      false, // boolean false
      null, // null
      "true", // string "true" (truthy non-boolean)
      "false", // string "false"
      1, // number 1 (truthy)
      0, // number 0
      {}, // object (truthy)
      [], // array (truthy)
      NaN, // NaN
      () => true, // function (truthy)
    ];

    for (const testAuthVal of unauthInputs) {
      const model = buildBusNetworkMiniMapModel({
        ...baseMapInput,
        player: { x: 14, y: 10 },
        parkedCar: { x: 12, y: 10 },
        parkedCars: sampleParkedCarsList,
        peers: samplePeers,
        playerLocationAuthorized: testAuthVal as any,
      });

      // 1. Private player location MUST be strictly null
      expect(model.player).toBeNull();

      // 2. Local parked cars MUST be omitted
      expect(model.parkedCars.some((c) => c.isLocal)).toBe(false);
      expect(model.parkedCars.some((c) => c.id === "local-parked-car")).toBe(false);
      expect(model.parkedCars.some((c) => c.id === "local-car-1")).toBe(false);

      // 3. Remote peers MUST remain visible and projected (no regression in peer awareness)
      expect(model.peers).toHaveLength(2);
      expect(model.peers[0]!.participantId).toBe("peer-remote-1");
      expect(model.peers[0]!.username).toBe("RemotePeer1");
      expect(model.peers[1]!.participantId).toBe("peer-remote-2");
      expect(model.peers[1]!.username).toBe("RemotePeer2");

      // 4. Remote parked cars MUST remain visible
      expect(model.parkedCars.some((c) => c.id === "remote-car-1")).toBe(true);
      expect(model.parkedCars.some((c) => c.id === "peer-parked-peer-remote-1")).toBe(true);
    }
  });

  it("buildBusNetworkMiniMapModel projects player and local parked cars ONLY when playerLocationAuthorized === true", () => {
    const model = buildBusNetworkMiniMapModel({
      ...baseMapInput,
      player: { x: 14, y: 10 },
      parkedCar: { x: 12, y: 10 },
      parkedCars: sampleParkedCarsList,
      peers: samplePeers,
      playerLocationAuthorized: true, // explicit boolean true
    });

    // 1. Player is projected
    expect(model.player).not.toBeNull();
    expect(model.player!.outOfBounds).toBe(false);

    // 2. Local parked cars are included
    expect(model.parkedCars.some((c) => c.isLocal)).toBe(true);
    expect(model.parkedCars.some((c) => c.id === "local-parked-car")).toBe(true);
    expect(model.parkedCars.some((c) => c.id === "local-car-1")).toBe(true);

    // 3. Remote peers and remote parked cars are preserved
    expect(model.peers).toHaveLength(2);
    expect(model.parkedCars.some((c) => c.id === "remote-car-1")).toBe(true);
    expect(model.parkedCars.some((c) => c.id === "peer-parked-peer-remote-1")).toBe(true);
  });

  it("canShowPlayerLocationForAccount rejects mismatched keys, non-CityLife accounts, and empty/invalid values", () => {
    // 1. Valid case
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "user-alpha",
      }),
    ).toBe(true);

    // 2. Mismatched account keys
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "user-beta",
      }),
    ).toBe(false);

    // 3. Non-CityLife player flag (e.g. spectator, builder, admin, false)
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: false,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "user-alpha",
      }),
    ).toBe(false);

    // 4. Missing/undefined/null isCityLifePlayer
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: undefined,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "user-alpha",
      }),
    ).toBe(false);

    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: null,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "user-alpha",
      }),
    ).toBe(false);

    // 5. Truthy non-boolean isCityLifePlayer (e.g. 1, "true", {})
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: "true" as any,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "user-alpha",
      }),
    ).toBe(false);

    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: 1 as any,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "user-alpha",
      }),
    ).toBe(false);

    // 6. Empty string keys
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "",
        runtimeAccountKey: "",
      }),
    ).toBe(false);

    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: "",
      }),
    ).toBe(false);

    // 7. Null or undefined account keys
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: null,
        runtimeAccountKey: "user-alpha",
      }),
    ).toBe(false);

    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: "user-alpha",
        runtimeAccountKey: null,
      }),
    ).toBe(false);

    // 8. Non-string account keys (numbers, objects)
    expect(
      canShowPlayerLocationForAccount({
        isCityLifePlayer: true,
        authenticatedAccountKey: 12345 as any,
        runtimeAccountKey: 12345 as any,
      }),
    ).toBe(false);

    // 9. Completely empty input object
    expect(canShowPlayerLocationForAccount({})).toBe(false);
  });

  it("resolveLocalPlayerMapPosition gates position strictly to authorized citizen and fails closed on bystanders", () => {
    // 1. Unauthorized always returns null
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: false,
        drivingPosition: { x: 50, y: 50 },
      }),
    ).toBeNull();

    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: false,
        cameraCell: { x: 50, y: 50 },
        activeCitizenId: "cit-100",
        operatorCitizenId: "cit-100",
      }),
    ).toBeNull();

    // 2. Authorized driving position
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        drivingPosition: { x: 40, y: 60 },
      }),
    ).toEqual({ x: 40, y: 60 });

    // 3. Authorized walking own citizen position
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        exactOwnPresence: { x: 35, y: 45 },
        cameraCell: { x: 30, y: 40 },
        activeCitizenId: "cit-own",
        operatorCitizenId: "cit-own",
      }),
    ).toEqual({ x: 35, y: 45 });

    // Fallback to cameraCell when exactOwnPresence is missing
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        exactOwnPresence: null,
        cameraCell: { x: 30, y: 40 },
        activeCitizenId: "cit-own",
        operatorCitizenId: "cit-own",
      }),
    ).toEqual({ x: 30, y: 40 });

    // 4. Bystander citizen inspection: activeCitizenId !== operatorCitizenId -> MUST return null
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        cameraCell: { x: 99, y: 99 },
        activeCitizenId: "cit-bystander-77",
        operatorCitizenId: "cit-own",
      }),
    ).toBeNull();

    // 5. Missing citizen IDs -> returns null
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        cameraCell: { x: 30, y: 40 },
        activeCitizenId: null,
        operatorCitizenId: "cit-own",
      }),
    ).toBeNull();

    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        cameraCell: { x: 30, y: 40 },
        activeCitizenId: "cit-own",
        operatorCitizenId: null,
      }),
    ).toBeNull();
  });

  it("createColonyLogoutHandler synchronously invokes runtime.setOperatorUserId(null) before async boundaries", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-logout-order-test");
    expect((runtime as any).operatorUserId).toBe("user-logout-order-test");

    const callOrder: string[] = [];

    // Spy on runtime methods
    const origDisable = runtime.disableMultiplayer.bind(runtime);
    runtime.disableMultiplayer = () => {
      callOrder.push("disableMultiplayer");
      origDisable();
    };

    const origSetOp = runtime.setOperatorUserId.bind(runtime);
    runtime.setOperatorUserId = (id) => {
      callOrder.push(`setOperatorUserId:${id}`);
      origSetOp(id);
    };

    let loggedOutState = false;
    const setLoggedOut = (val: boolean) => {
      callOrder.push(`setLoggedOut:${val}`);
      loggedOutState = val;
    };

    let authLogoutCompleted = false;
    const mockAuth = {
      logout: async () => {
        callOrder.push("auth.logout:start");
        // Simulate network latency during cookie cleanup
        await new Promise((r) => setTimeout(r, 10));
        authLogoutCompleted = true;
        callOrder.push("auth.logout:end");
      },
    } as any;

    let reloadCalled = false;
    const onReload = () => {
      callOrder.push("onReload");
      reloadCalled = true;
    };

    const handler = createColonyLogoutHandler({
      runtime,
      auth: mockAuth,
      setLoggedOut,
      onReload,
    });

    let beforeLogoutObservedOperatorId: string | null = "not-called";
    const logoutPromise = handler(() => {
      callOrder.push("beforeLogout");
      // Synchronous invariant assertion: at beforeLogout execution time, operatorUserId MUST ALREADY be null!
      beforeLogoutObservedOperatorId = (runtime as any).operatorUserId;
    });

    // Before awaiting the logout promise, synchronous steps MUST already have completed!
    expect(callOrder).toContain("disableMultiplayer");
    expect(callOrder).toContain("setOperatorUserId:null");
    expect(callOrder).toContain("setLoggedOut:true");
    expect(callOrder).toContain("beforeLogout");
    expect(beforeLogoutObservedOperatorId).toBeNull();
    expect(loggedOutState).toBe(true);
    expect((runtime as any).operatorUserId).toBeNull();

    // Now await async portion
    await logoutPromise;

    expect(authLogoutCompleted).toBe(true);
    expect(reloadCalled).toBe(true);

    // Verify exact sequence of calls
    expect(callOrder).toEqual([
      "disableMultiplayer",
      "setOperatorUserId:null",
      "setLoggedOut:true",
      "beforeLogout",
      "auth.logout:start",
      "auth.logout:end",
      "onReload",
    ]);
  });

  it("createColonyLogoutHandler preserves synchronous operator clearing and calls onReload even if auth.logout fails", async () => {
    const runtime = new ColonyRuntime(42);
    runtime.setOperatorUserId("user-logout-fault-test");

    let reloadCalled = false;
    const failingAuth = {
      logout: async () => {
        throw new Error("Network failure during cookie clearance");
      },
    } as any;

    const handler = createColonyLogoutHandler({
      runtime,
      auth: failingAuth,
      setLoggedOut: () => {},
      onReload: () => {
        reloadCalled = true;
      },
    });

    await expect(handler()).rejects.toThrow("Network failure during cookie clearance");

    // Operator ID must be null
    expect((runtime as any).operatorUserId).toBeNull();
    // onReload must have been invoked in finally block
    expect(reloadCalled).toBe(true);
  });
});
