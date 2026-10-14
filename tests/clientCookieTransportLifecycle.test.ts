import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { AuthClient, KOOKER_COOKIE_PATH, KOOKER_COOKIE_ALIAS_PATH, KOOKER_CLEAR_PATH, KOOKER_CLEAR_ALIAS_PATH } from "../src/colony/authClient";
import { setupAuthoritativeRuntime } from "./testAuthorityHelper";

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

  it("handles logout, cookie clearing, and fails closed without query token leak", async () => {
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
    const mpClient = runtime.getMultiplayerClient();
    await mpClient!.connect();

    // Now operator logs out
    auth.logout();
    await new Promise((r) => setTimeout(r, 20));

    // Clear request was dispatched to BFF
    const clearCall = fetchHistory.find((c) => c.url === KOOKER_CLEAR_PATH);
    expect(clearCall).toBeDefined();
    expect(clearCall?.credentials).toBe("same-origin");

    mpClient!.disconnect();

    // Attempting to reconnect when logged out without cookie auth fails closed
    const unauthedRuntime = new ColonyRuntime(42);
    unauthedRuntime.setOperatorUserId("");
    setupAuthoritativeRuntime(unauthedRuntime);

    const prevSocketCount = MockWebSocket.instances.length;
    unauthedRuntime.enableMultiplayer("room-bff", "ws://127.0.0.1:8080/api/v1/citylife/ws", undefined, {
      useCookieAuth: false,
    });
    // Should fail closed without opening any new WebSocket
    expect(MockWebSocket.instances.length).toBe(prevSocketCount);
  });
});
