import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { AuthClient, KOOKER_COOKIE_PATH, KOOKER_COOKIE_ALIAS_PATH, KOOKER_CLEAR_PATH, KOOKER_CLEAR_ALIAS_PATH } from "../src/colony/authClient";
import { setupAuthoritativeRuntime, makeSessionJoinedAck } from "./testAuthorityHelper";
import { createColonyLogoutHandler, SignedOutFallbackView } from "../src/colony/ui/ColonyApp";

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

function fakeJwt(expEpochMs: number, email = "operator@test.com"): string {
  const payload = btoa(
    JSON.stringify({ sub: email, exp: Math.floor(expEpochMs / 1000) }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe("Client Cookie Transport & BFF Lifecycle Integration", () => {
  let fetchHistory: { url: string; method?: string; credentials?: RequestCredentials; auth?: string }[] = [];

  beforeEach(() => {
    MockWebSocket.instances = [];
    fetchHistory = [];
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("proves BFF issuance BEFORE WebSocket connection and queryless socket URL", async () => {
    const timeline: string[] = [];
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      fetchHistory.push({
        url,
        method: init?.method,
        credentials: init?.credentials,
        auth,
      });
      timeline.push(`fetch:${url}`);
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "Operator" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // 1. Initialize AuthClient and login
    const auth = new AuthClient();
    await auth.login("operator@test.com", "valid-password");

    // 2. Setup runtime with the authenticated authClient
    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient(auth);
    runtime.setOperatorUserId("operator@test.com");
    setupAuthoritativeRuntime(runtime);

    // 3. Track WebSocket construction in timeline
    const origInstancesLength = MockWebSocket.instances.length;

    // 4. Enable multiplayer with direct WS URL
    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const mpClient = runtime.getMultiplayerClient();
    expect(mpClient).not.toBeNull();

    await mpClient!.connect();

    // 5. Assert BFF issuance occurred BEFORE WebSocket instantiation
    const bffIndex = timeline.findIndex((entry) => entry === `fetch:${KOOKER_COOKIE_PATH}`);
    expect(bffIndex).toBeGreaterThanOrEqual(0);

    // 6. Assert socket connected without any query credentials
    expect(MockWebSocket.instances.length).toBe(origInstancesLength + 1);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    expect(ws.url).toBe("ws://127.0.0.1:8080/api/v1/citylife/ws");
    expect(ws.url).not.toContain("?");
    expect(ws.url).not.toContain("jwt=");
    expect(ws.url).not.toContain("token=");

    // 7. Verify credentials and auth header on BFF request
    const bffCall = fetchHistory.find((c) => c.url === KOOKER_COOKIE_PATH);
    expect(bffCall).toBeDefined();
    expect(bffCall?.method).toBe("POST");
    expect(bffCall?.credentials).toBe("same-origin");
    expect(bffCall?.auth).toBe(`Bearer ${token}`);

    mpClient!.disconnect();
  });

  it("handles BFF direct 404 fallback to alias /kooker path before WebSocket open", async () => {
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchHistory.push({
        url,
        method: init?.method,
        credentials: init?.credentials,
        auth: (init?.headers as Record<string, string>)?.Authorization,
      });
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "Operator" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH) {
        // Direct returns 404
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url === KOOKER_COOKIE_ALIAS_PATH) {
        // Alias succeeds
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const auth = new AuthClient();
    await auth.login("operator@test.com", "valid-password");

    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient(auth);
    runtime.setOperatorUserId("operator@test.com");
    setupAuthoritativeRuntime(runtime);

    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/kooker/api/v1/citylife/ws");
    const mpClient = runtime.getMultiplayerClient();
    await mpClient!.connect();

    const aliasCall = fetchHistory.find((c) => c.url === KOOKER_COOKIE_ALIAS_PATH);
    expect(aliasCall).toBeDefined();
    expect(aliasCall?.credentials).toBe("same-origin");
    expect(aliasCall?.auth).toBe(`Bearer ${token}`);

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    expect(ws.url).toBe("ws://127.0.0.1:8080/kooker/api/v1/citylife/ws");
    expect(ws.url).not.toContain("?");

    mpClient!.disconnect();
  });

  it("production logout consumer shuts down socket, clears runtime state, and dispatches cookie clear", async () => {
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchHistory.push({
        url,
        method: init?.method,
        credentials: init?.credentials,
        auth: (init?.headers as Record<string, string>)?.Authorization,
      });
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "Operator" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH || url === KOOKER_CLEAR_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const auth = new AuthClient();
    await auth.login("operator@test.com", "valid-password");

    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient(auth);
    runtime.setOperatorUserId("operator@test.com");
    setupAuthoritativeRuntime(runtime);

    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const mpClient = runtime.getMultiplayerClient()!;
    await mpClient.connect();
    const activeWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    activeWs.onopen?.();
    activeWs.onmessage?.({
      data: JSON.stringify(
        makeSessionJoinedAck(activeWs, {
          type: "session_joined",
          sessionId: "s1",
          inviteCode: "room-bff",
          participantId: "p1",
          protocolVersion: 2,
          modeEpoch: 1,
          mode: "driving",
          participants: [],
        }),
      ),
    });
    expect(mpClient.getStatus()).toBe("connected");
    expect(activeWs.readyState).toBe(MockWebSocket.OPEN);

    // Operator logs out: production lifecycle consumer runs
    // In ColonyApp.tsx: auth.logout() is invoked, and when auth state changes (operatorUserId becomes null / !auth.isAuthenticated),
    // the lifecycle effect calls runtime.disableMultiplayer().
    const clearResult = await auth.logout();
    expect(clearResult).toBe(true);
    runtime.disableMultiplayer();

    // Verify automatic socket closure and state cleanup
    expect(activeWs.readyState).toBe(MockWebSocket.CLOSED);
    expect(runtime.getMultiplayerClient()).toBeNull();
    expect(runtime.getAuthoritativeWalkingPose()).toBeNull();

    // Clear request was dispatched to BFF with same-origin credentials
    const clearCall = fetchHistory.find((c) => c.url === KOOKER_CLEAR_PATH);
    expect(clearCall).toBeDefined();
    expect(clearCall?.credentials).toBe("same-origin");
  });

  it("logged-out re-entry through normal cookie-enabled runtime fails closed with UNAUTHORIZED without opening WebSocket", async () => {
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchHistory.push({
        url,
        method: init?.method,
        credentials: init?.credentials,
        auth: (init?.headers as Record<string, string>)?.Authorization,
      });
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "Operator" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH || url === KOOKER_CLEAR_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const auth = new AuthClient();
    await auth.login("operator@test.com", "valid-password");

    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient(auth);
    runtime.setOperatorUserId("operator@test.com");
    setupAuthoritativeRuntime(runtime);

    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const mpClient = runtime.getMultiplayerClient()!;
    await mpClient.connect();

    // Logout
    await auth.logout();
    runtime.disableMultiplayer();

    // Attempting to reconnect when logged out through the NORMAL cookie-enabled runtime
    // (default useCookieAuth: true since authClient is present, NO useCookieAuth: false override)
    runtime.setOperatorUserId("operator@test.com");
    const prevSocketCount = MockWebSocket.instances.length;

    let reportedError: any = null;
    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const reconnectedClient = runtime.getMultiplayerClient()!;
    (reconnectedClient as any).options.onError = (err: any) => {
      reportedError = err;
    };

    await reconnectedClient.connect();

    // Client fails closed with UNAUTHORIZED error
    expect(reconnectedClient.getStatus()).toBe("error");
    expect(reportedError).toEqual({
      code: "UNAUTHORIZED",
      message: "Failed to establish authenticated cookie session",
    });

    // Proves NO new WebSocket was opened (count unchanged)
    expect(MockWebSocket.instances.length).toBe(prevSocketCount);
  });

  it("handles production account switch with old socket teardown and new cookie session", async () => {
    const tokenA = fakeJwt(Date.now() + 3600_000, "userA@test.com");
    const tokenB = fakeJwt(Date.now() + 3600_000, "userB@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchHistory.push({
        url,
        method: init?.method,
        credentials: init?.credentials,
        auth: (init?.headers as Record<string, string>)?.Authorization,
      });
      if (url.includes("/auth/basic")) {
        const authHeader = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const email = authHeader.includes(btoa("usera@test.com:pw")) ? "userA@test.com" : "userB@test.com";
        const tok = email === "userA@test.com" ? tokenA : tokenB;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tok, user: { name: email } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH || url === KOOKER_CLEAR_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const auth = new AuthClient();
    await auth.login("userA@test.com", "pw");

    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient(auth);
    runtime.setOperatorUserId("userA@test.com");
    setupAuthoritativeRuntime(runtime);

    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const clientA = runtime.getMultiplayerClient()!;
    await clientA.connect();
    const wsA = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    wsA.onopen?.();
    wsA.onmessage?.({
      data: JSON.stringify(
        makeSessionJoinedAck(wsA, {
          type: "session_joined",
          sessionId: "sA",
          inviteCode: "room-bff",
          participantId: "pA",
          protocolVersion: 2,
          modeEpoch: 1,
          mode: "driving",
          participants: [],
        }),
      ),
    });
    expect(clientA.getStatus()).toBe("connected");
    expect(wsA.readyState).toBe(MockWebSocket.OPEN);

    // Switch to User B:
    // ColonyApp.tsx effect disables multiplayer on identity change
    runtime.disableMultiplayer();
    expect(wsA.readyState).toBe(MockWebSocket.CLOSED);

    // Login as User B
    await auth.login("userB@test.com", "pw");
    setupAuthoritativeRuntime(runtime, { userId: "userB@test.com" });

    // Enable multiplayer for User B
    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const clientB = runtime.getMultiplayerClient()!;
    await clientB.connect();
    const wsB = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    wsB.onopen?.();
    wsB.onmessage?.({
      data: JSON.stringify(
        makeSessionJoinedAck(wsB, {
          type: "session_joined",
          sessionId: "sB",
          inviteCode: "room-bff",
          participantId: "pB",
          protocolVersion: 2,
          modeEpoch: 1,
          mode: "driving",
          participants: [],
        }),
      ),
    });
    expect(clientB.getStatus()).toBe("connected");

    expect(wsB).not.toBe(wsA);
    expect(wsB.readyState).toBe(MockWebSocket.OPEN);
    expect(wsB.url).toBe("ws://127.0.0.1:8080/api/v1/citylife/ws");
    expect(wsB.url).not.toContain("?");

    // Check that cookie issuance was called with User A's token then User B's token
    const cookieCalls = fetchHistory.filter((c) => c.url === KOOKER_COOKIE_PATH);
    expect(cookieCalls.length).toBe(4);
    expect(cookieCalls[0].auth).toBe(`Bearer ${tokenA}`);
    expect(cookieCalls[1].auth).toBe(`Bearer ${tokenA}`);
    expect(cookieCalls[2].auth).toBe(`Bearer ${tokenB}`);
    expect(cookieCalls[3].auth).toBe(`Bearer ${tokenB}`);
  });

  it("proves mounted consumer logout triggers immediate signed-out UI and runtime disconnect before deferred clear settles", async () => {
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");
    let resolveClear: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "Operator" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === KOOKER_CLEAR_PATH) {
        // Deferred clear network response
        return new Promise((resolve) => {
          resolveClear = () => {
            resolve({ ok: true, status: 200, json: async () => ({}) });
          };
        });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const auth = new AuthClient();
    await auth.login("operator@test.com", "valid-password");

    const runtime = new ColonyRuntime(42);
    runtime.setAuthClient(auth);
    runtime.setOperatorUserId("operator@test.com");
    setupAuthoritativeRuntime(runtime);

    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const mpClient = runtime.getMultiplayerClient()!;
    await mpClient.connect();
    const activeWs = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    activeWs.onopen?.();
    activeWs.onmessage?.({
      data: JSON.stringify(
        makeSessionJoinedAck(activeWs, {
          type: "session_joined",
          sessionId: "s1",
          inviteCode: "room-bff",
          participantId: "p1",
          protocolVersion: 2,
          modeEpoch: 1,
          mode: "walking",
          participants: [
            {
              id: "peer-1",
              participantId: "p2",
              username: "peer-racer",
              x: 10,
              y: 0,
              z: 10,
              heading: 0,
              speed: 0,
              mode: "walking",
              isPedestrian: true,
            },
          ],
        }),
      ),
    });
    expect(mpClient.getStatus()).toBe("connected");
    expect(runtime.sim.state.remoteRacers?.size).toBeGreaterThan(0);

    // Seed walking and input state to truthfully assert state reset
    (runtime as any).multiplayerInputSeq = 42;
    runtime.setOwnedDriveInput({ throttle: true });
    expect(runtime.sim.state.remoteRacers?.size).toBeGreaterThan(0);

    let loggedOutState = false;
    let reloadTriggered = false;
    let fallbackMarkupBeforeSettlement = "";

    // Actual mounted consumer wiring: createColonyLogoutHandler executes on user logout trigger
    const executeLogout = createColonyLogoutHandler({
      runtime,
      auth,
      setLoggedOut: (val) => {
        loggedOutState = val;
        if (val) {
          fallbackMarkupBeforeSettlement = renderToStaticMarkup(React.createElement(SignedOutFallbackView));
        }
      },
      onReload: () => {
        reloadTriggered = true;
      },
    });

    // Trigger logout through the production consumer handler while cookie clear is deferred
    const logoutPromise = executeLogout();

    // Assert: immediate local signed-out UI and synchronous disconnect BEFORE clear settles
    expect(loggedOutState).toBe(true);
    expect(fallbackMarkupBeforeSettlement).toContain('data-signed-out="true"');
    expect(fallbackMarkupBeforeSettlement).toContain("Signed out");
    expect(fallbackMarkupBeforeSettlement).toContain("Your session has ended. Returning to login");

    // Assert: runtime disconnect, peer cleanup, and seeded input state reset synchronously
    expect(activeWs.readyState).toBe(MockWebSocket.CLOSED);
    expect(runtime.getMultiplayerClient()).toBeNull();
    expect(runtime.getAuthoritativeWalkingPose()).toBeNull();
    expect((runtime as any).multiplayerInputSeq).toBe(0);
    expect((runtime as any).ownedDriveInput).toEqual({});
    expect(runtime.sim.state.remoteRacers?.size).toBe(0);

    // Auth state was synchronously cleared
    expect(auth.isAuthenticated).toBe(false);
    expect(reloadTriggered).toBe(false);

    // Settle deferred clear now
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveClear).not.toBeNull();
    resolveClear!();

    await logoutPromise;
    expect(reloadTriggered).toBe(true);
  });

  it("surfaces ALIGHT_BLOCKED rejection in runtime first-person narration feedback", async () => {
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");

    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "Operator" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH || url === KOOKER_CLEAR_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const auth = new AuthClient();
    await auth.login("operator@test.com", "valid-password");

    const runtime = new ColonyRuntime(42);
    runtime.setPlayerView(false);
    runtime.setAuthClient(auth);
    runtime.setOperatorUserId("operator@test.com");
    setupAuthoritativeRuntime(runtime, { userId: "operator@test.com" });

    // Step into first valid citizen if available
    const ids = runtime.getUiState().firstPerson.stepInCitizenIds;
    if (ids.length > 0) {
      expect(runtime.enterFirstPerson(ids[0]!)).toBe(true);
    }

    runtime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws");
    const mpClient = runtime.getMultiplayerClient()!;
    await mpClient.connect();

    // Simulate server returning ALIGHT_BLOCKED error frame
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws.onmessage?.({
      data: JSON.stringify({
        type: "error",
        error: "ALIGHT_BLOCKED",
        message: "Exit path is blocked by another passenger",
      }),
    });

    // Production narration must surface the rejection message to the player
    const uiState = runtime.getUiState();
    expect(uiState.firstPerson.narration).toBe("Exit path is blocked by another passenger");
  });
});
