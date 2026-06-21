import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { AuthClient, basicAuth } from "../src/colony/authClient";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal JWT (unsigned — only the payload matters for client-side exp parsing). */
function fakeJwt(expEpochMs: number, email = "mayor@test.com"): string {
  const payload = btoa(
    JSON.stringify({ sub: email, exp: Math.floor(expEpochMs / 1000) }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

/** Build an unsigned JWT carrying roles + a far-future exp (only the payload matters client-side). */
function fakeJwtWithRoles(roles: string[], email = "player@test.com"): string {
  const payload = btoa(
    JSON.stringify({ sub: email, exp: 4070908800, roles }), // exp ~year 2099
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function mockFetchOk(token: string, email = "mayor@test.com", name = "Mayor") {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => ({ accessToken: token, user: { email, name } }),
  }));
}

function mockFetchFail(status = 401) {
  vi.stubGlobal("fetch", async () => ({
    ok: false,
    status,
    json: async () => ({}),
  }));
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Node without localStorage support: nothing to clear.
  }
  try {
    sessionStorage.clear();
  } catch {
    // Node without sessionStorage support: nothing to clear.
  }
});

afterEach(() => vi.unstubAllGlobals());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AuthClient (kooker login gate)", () => {
  it("builds an encoded Basic Auth header without plaintext password", () => {
    const h = basicAuth("mayor@test.com", "hunter2");
    expect(h).toBe("Basic " + btoa("mayor@test.com:hunter2"));
    expect(h.includes("hunter2")).toBe(false);
  });

  it("rejects an empty email before hitting the network", async () => {
    const a = new AuthClient();
    const r = await a.login("", "any");
    expect(r).toEqual({ ok: false, error: "Enter your kooker email." });
    expect(a.isAuthenticated).toBe(false);
  });

  it("flags a CITYLIFE_PLAYER for the restricted view, but not an admin", async () => {
    mockFetchOk(fakeJwtWithRoles(["CITYLIFE_PLAYER"]));
    const player = new AuthClient();
    await player.login("player@test.com", "pw");
    expect(player.operator?.roles).toContain("CITYLIFE_PLAYER");
    expect(player.isCityLifePlayer).toBe(true);

    // An admin who also holds the player role keeps the full whole-colony view (not restricted).
    mockFetchOk(fakeJwtWithRoles(["CITYLIFE_PLAYER", "ADMIN"]));
    const admin = new AuthClient();
    await admin.login("admin@test.com", "pw");
    expect(admin.isCityLifePlayer).toBe(false);

    // A plain operator with no player role is not restricted either.
    mockFetchOk(fakeJwtWithRoles(["KOOKER_USER"]));
    const op = new AuthClient();
    await op.login("op@test.com", "pw");
    expect(op.isCityLifePlayer).toBe(false);
  });

  it("rejects an empty password before hitting the network", async () => {
    const a = new AuthClient();
    const r = await a.login("mayor@test.com", "");
    expect(r).toEqual({ ok: false, error: "Enter your password." });
    expect(a.isAuthenticated).toBe(false);
  });

  it("returns ok:false and stays logged out on a 401 from the server", async () => {
    mockFetchFail(401);
    const a = new AuthClient();
    const r = await a.login("mayor@test.com", "wrong");
    expect(r).toEqual({ ok: false, error: "Wrong email or password." });
    expect(a.isAuthenticated).toBe(false);
    expect(a.authHeader()).toEqual({});
  });

  it("accepts a valid login and attaches a Bearer token", async () => {
    const now = 1_000_000_000;
    const token = fakeJwt(now + 1000 * 60 * 60 * 8);
    mockFetchOk(token);
    const a = new AuthClient({ now: () => now });
    const r = await a.login("mayor@test.com", "correct");
    expect(r).toEqual({ ok: true });
    expect(a.isAuthenticated).toBe(true);
    expect(a.operator?.id).toBe("Mayor"); // uses name from user object
    expect(a.authHeader().Authorization?.startsWith("Bearer ")).toBe(true);
  });

  it("reads session expiry from the JWT exp claim and fails closed after it passes", async () => {
    let t = 1_000_000_000;
    const token = fakeJwt(t + 1000 * 60 * 60 * 8); // JWT expires 8 h from now
    mockFetchOk(token);
    const a = new AuthClient({ now: () => t });
    await a.login("mayor@test.com", "correct");
    expect(a.isAuthenticated).toBe(true);
    t += 1000 * 60 * 60 * 9; // advance 9 h — past the 8 h JWT window
    expect(a.isAuthenticated).toBe(false);
    expect(a.authHeader()).toEqual({});
  });

  it("logout clears the session immediately", async () => {
    const token = fakeJwt(Date.now() + 1000 * 60 * 60 * 8);
    mockFetchOk(token);
    const a = new AuthClient();
    await a.login("mayor@test.com", "correct");
    expect(a.isAuthenticated).toBe(true);
    a.logout();
    expect(a.isAuthenticated).toBe(false);
    expect(a.authHeader()).toEqual({});
  });

  it("surfaces a network error as ok:false", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const a = new AuthClient();
    const r = await a.login("mayor@test.com", "correct");
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toMatch(/network down/);
  });
});

describe("AuthClient (token refresh)", () => {
  // A fetch stub that answers /basic (login) and /refresh distinctly, recording calls.
  function mockAuthEndpoints(
    loginToken: string,
    refreshTokenOut: string,
    refreshAnswer: { token?: string; status?: number },
  ) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: loginToken,
            refreshToken: refreshTokenOut,
            user: { name: "Mayor" },
          }),
        };
      }
      if (url.includes("/auth/refresh")) {
        if (refreshAnswer.status && refreshAnswer.status >= 400)
          return {
            ok: false,
            status: refreshAnswer.status,
            json: async () => ({}),
          };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: refreshAnswer.token,
            refreshToken: "r2",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    return calls;
  }

  it("getValidToken returns the current token when it is not near expiry", async () => {
    let t = 1_000_000_000;
    mockAuthEndpoints(fakeJwt(t + 1000 * 60 * 60), "r1", {});
    const a = new AuthClient({ now: () => t });
    await a.login("mayor@test.com", "pw");
    const tok = await a.getValidToken();
    expect(tok).toBe(fakeJwt(t + 1000 * 60 * 60));
  });

  it("getValidToken renews via the refresh token when the access token is expired", async () => {
    let t = 1_000_000_000;
    const fresh = fakeJwt(t + 1000 * 60 * 120); // new token valid 2h
    const calls = mockAuthEndpoints(fakeJwt(t + 1000), "r1", { token: fresh }); // login token expires in 1s
    const a = new AuthClient({ now: () => t });
    await a.login("mayor@test.com", "pw");
    t += 1000 * 60 * 5; // 5 min later — access token expired
    const tok = await a.getValidToken();
    expect(tok).toBe(fresh);
    expect(calls.some((u) => u.includes("/auth/refresh"))).toBe(true);
    expect(a.isAuthenticated).toBe(true);
  });

  it("stays authenticated while a refresh token exists even after the access token expires", async () => {
    let t = 1_000_000_000;
    mockAuthEndpoints(fakeJwt(t + 1000), "r1", {
      token: fakeJwt(t + 1000 * 60 * 120),
    });
    const a = new AuthClient({ now: () => t });
    await a.login("mayor@test.com", "pw");
    t += 1000 * 60 * 5;
    expect(a.isAuthenticated).toBe(true); // renewable
  });

  it("logs out when the refresh token is rejected (401)", async () => {
    let t = 1_000_000_000;
    mockAuthEndpoints(fakeJwt(t + 1000), "r1", { status: 401 });
    const a = new AuthClient({ now: () => t });
    await a.login("mayor@test.com", "pw");
    t += 1000 * 60 * 5;
    const tok = await a.getValidToken();
    expect(tok).toBeNull();
    expect(a.isAuthenticated).toBe(false);
  });

  it("dedupes concurrent refreshes into a single network call", async () => {
    let t = 1_000_000_000;
    const calls = mockAuthEndpoints(fakeJwt(t + 1000), "r1", {
      token: fakeJwt(t + 1000 * 60 * 120),
    });
    const a = new AuthClient({ now: () => t });
    await a.login("mayor@test.com", "pw");
    t += 1000 * 60 * 5;
    await Promise.all([
      a.getValidToken(),
      a.getValidToken(),
      a.getValidToken(),
    ]);
    expect(calls.filter((u) => u.includes("/auth/refresh")).length).toBe(1);
  });
});
