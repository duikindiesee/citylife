import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  AuthClient,
  basicAuth,
  canEnterCityBuilder,
  classifyLoginFailure,
  KOOKER_REFRESH_PATH,
  KOOKER_COOKIE_PATH,
  KOOKER_COOKIE_ALIAS_PATH,
  KOOKER_CLEAR_PATH,
  KOOKER_CLEAR_ALIAS_PATH,
  getAuthClient,
  resetSharedAuthClient,
} from "../src/colony/authClient";

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

/** Build an unsigned JWT carrying an explicit kooker userId claim + a far-future exp. */
function fakeJwtWithUserId(userId: string, email = "player@test.com"): string {
  const payload = btoa(JSON.stringify({ sub: email, exp: 4070908800, userId }))
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

function mockFetchFail403(message: string) {
  vi.stubGlobal("fetch", async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message }),
  }));
}

function mockFetchFail403Body(body: { message?: string; code?: string }) {
  vi.stubGlobal("fetch", async () => ({
    ok: false,
    status: 403,
    json: async () => body,
  }));
}

beforeEach(() => {
  resetSharedAuthClient();
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

afterEach(() => {
  resetSharedAuthClient();
  vi.unstubAllGlobals();
});

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

  it("exposes the kooker userId from the JWT on the operator", async () => {
    mockFetchOk(fakeJwtWithUserId("kooker-77"));
    const a = new AuthClient();
    await a.login("player@test.com", "pw");
    expect(a.operator?.userId).toBe("kooker-77");
    // The display id stays the human label, distinct from the identity key.
    expect(a.operator?.id).toBe("Mayor");
  });

  it("falls back to the sub claim when no userId claim is present", async () => {
    // fakeJwt carries only sub (the kooker subject) — userIdFromToken-style fallback reads it.
    mockFetchOk(fakeJwt(Date.now() + 1000 * 60 * 60, "sub-user@test.com"));
    const a = new AuthClient();
    await a.login("sub-user@test.com", "pw");
    expect(a.operator?.userId).toBe("sub-user@test.com");
  });

  it("restricts every non-operator to the player view (fail closed); full view only for operators", async () => {
    // The restricted own-data view applies to a CITYLIFE_PLAYER...
    mockFetchOk(fakeJwtWithRoles(["CITYLIFE_PLAYER"]));
    const player = new AuthClient();
    await player.login("player@test.com", "pw");
    expect(player.isCityLifePlayer).toBe(true);

    // ...to an activated CITYLIFE_VISITOR (the bug: a visitor was loading as admin + FP on anyone)...
    mockFetchOk(fakeJwtWithRoles(["CITYLIFE_VISITOR"]));
    const visitor = new AuthClient();
    await visitor.login("visitor@test.com", "pw");
    expect(visitor.isCityLifePlayer).toBe(true);

    // ...to a plain KOOKER_USER, and to an empty/unrecognised role set (fail closed).
    mockFetchOk(fakeJwtWithRoles(["KOOKER_USER"]));
    const basic = new AuthClient();
    await basic.login("basic@test.com", "pw");
    expect(basic.isCityLifePlayer).toBe(true);

    mockFetchOk(fakeJwtWithRoles([]));
    const none = new AuthClient();
    await none.login("none@test.com", "pw");
    expect(none.isCityLifePlayer).toBe(true);

    // ONLY operator/admin roles keep the full whole-colony view.
    for (const role of ["ADMIN", "KOOKER_ADMIN", "CITYLIFE_ADMIN"]) {
      mockFetchOk(fakeJwtWithRoles([role]));
      const op = new AuthClient();
      await op.login("op@test.com", "pw");
      expect(op.isCityLifePlayer).toBe(false);
    }

    // An operator who also holds CITYLIFE_PLAYER still keeps the full view.
    mockFetchOk(fakeJwtWithRoles(["CITYLIFE_PLAYER", "ADMIN"]));
    const adminPlayer = new AuthClient();
    await adminPlayer.login("admin@test.com", "pw");
    expect(adminPlayer.isCityLifePlayer).toBe(false);
  });

  it("gates City Builder to operator roles, failing closed for every player/visitor/unknown role", async () => {
    // A CITYLIFE_PLAYER — the exact regression this guards — must not be able to build.
    mockFetchOk(fakeJwtWithRoles(["CITYLIFE_PLAYER"]));
    const player = new AuthClient();
    await player.login("player@test.com", "pw");
    expect(canEnterCityBuilder(player)).toBe(false);

    // Every other non-operator role, and no roles at all, also fail closed.
    for (const roles of [["CITYLIFE_VISITOR"], ["KOOKER_USER"], []]) {
      mockFetchOk(fakeJwtWithRoles(roles));
      const restricted = new AuthClient();
      await restricted.login("restricted@test.com", "pw");
      expect(canEnterCityBuilder(restricted)).toBe(false);
    }

    // ADMIN, KOOKER_ADMIN and CITYLIFE_ADMIN may build.
    for (const role of ["ADMIN", "KOOKER_ADMIN", "CITYLIFE_ADMIN"]) {
      mockFetchOk(fakeJwtWithRoles([role]));
      const op = new AuthClient();
      await op.login("op@test.com", "pw");
      expect(canEnterCityBuilder(op)).toBe(true);
    }

    // A principal holding CITYLIFE_PLAYER plus an operator role remains allowed — the operator
    // role is authoritative.
    mockFetchOk(fakeJwtWithRoles(["CITYLIFE_PLAYER", "ADMIN"]));
    const adminPlayer = new AuthClient();
    await adminPlayer.login("admin@test.com", "pw");
    expect(canEnterCityBuilder(adminPlayer)).toBe(true);
  });

  it("allows City Builder for a signed-out session — the only way this occurs is AuthGate's own local DEV/E2E skip-auth bypass, which is provably impossible on a production build/host", () => {
    const signedOut = new AuthClient();
    expect(signedOut.operator).toBeNull();
    expect(canEnterCityBuilder(signedOut)).toBe(true);
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

  it("flags a 403 'Account disabled' as pending so the gate can prompt for a code", async () => {
    mockFetchFail403("Account disabled");
    const a = new AuthClient();
    const r = await a.login("newbie@test.com", "correctpw");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pending).toBe(true);
      expect(r.error).toMatch(/unlock code/i);
    }
    expect(a.isAuthenticated).toBe(false);
  });

  it("treats a 403 'no app access' as a non-pending access error", async () => {
    mockFetchFail403("User does not have access to app: citylife");
    const a = new AuthClient();
    const r = await a.login("u@test.com", "correctpw");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pending).toBeUndefined();
      expect(r.error).toMatch(/CityLife access/i);
    }
  });

  it("fails safe on an unparseable 403 — neutral error, not pending", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 403,
      json: async () => {
        throw new Error("no body");
      },
    }));
    const a = new AuthClient();
    const r = await a.login("u@test.com", "pw");
    expect(r).toEqual({
      ok: false,
      error: "This account can't sign in to CityLife right now.",
    });
  });

  it("accepts a valid login and attaches a Bearer token", async () => {
    const now = 1_000_000_000;
    const token = fakeJwt(now + 1000 * 60 * 60 * 8);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: token,
        user: { email: "mayor@test.com", name: "Mayor" },
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const a = new AuthClient({ now: () => now });
    const r = await a.login("mayor@test.com", "correct");
    expect(r).toEqual({ ok: true });
    expect(a.isAuthenticated).toBe(true);
    expect(a.operator?.id).toBe("Mayor"); // uses name from user object
    expect(a.authHeader().Authorization?.startsWith("Bearer ")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/kooker/api/auth/basic",
      expect.objectContaining({ method: "POST" }),
    );
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

describe("classifyLoginFailure (Spec 077 account-status messaging)", () => {
  it("maps ACCOUNT_REVOKED to a revoked state with no code prompt", () => {
    const r = classifyLoginFailure(403, {
      code: "ACCOUNT_REVOKED",
      message: "Account disabled: your access has been revoked.",
    });
    expect(r.accountState).toBe("revoked");
    expect(r.pending).toBeUndefined();
    expect(r.error).toMatch(/revoked/i);
  });

  it("maps ACCOUNT_PENDING_REVIEW to awaiting-review with no code prompt", () => {
    const r = classifyLoginFailure(403, {
      code: "ACCOUNT_PENDING_REVIEW",
      message:
        "Account disabled: your visitor request is still being reviewed.",
    });
    expect(r.accountState).toBe("pending_review");
    expect(r.pending).toBeUndefined();
    expect(r.error).toMatch(/still being reviewed/i);
  });

  it("maps ACCOUNT_PENDING_CODE_ISSUED to the inline code prompt", () => {
    const r = classifyLoginFailure(403, {
      code: "ACCOUNT_PENDING_CODE_ISSUED",
      message: "Account disabled: enter your unlock code to activate.",
    });
    expect(r.accountState).toBe("code_issued");
    expect(r.pending).toBe(true);
    expect(r.error).toMatch(/unlock code/i);
  });

  it("treats an explicit ACCOUNT_DISABLED code as the legacy activatable state", () => {
    const r = classifyLoginFailure(403, {
      code: "ACCOUNT_DISABLED",
      message: "Account disabled",
    });
    expect(r.accountState).toBe("disabled");
    expect(r.pending).toBe(true);
  });

  it("falls back to the legacy substring when no code is present (older auth service)", () => {
    const r = classifyLoginFailure(403, { message: "Account disabled" });
    expect(r.pending).toBe(true);
    expect(r.accountState).toBe("disabled");
    expect(r.error).toMatch(/unlock code/i);
  });

  it("keeps no-app-access a non-pending access error", () => {
    const r = classifyLoginFailure(403, {
      message: "User does not have access to app: citylife",
    });
    expect(r.pending).toBeUndefined();
    expect(r.accountState).toBeUndefined();
    expect(r.error).toMatch(/CityLife access/i);
  });

  it("maps a 401 to a credentials error", () => {
    expect(classifyLoginFailure(401, {})).toEqual({
      ok: false,
      error: "Wrong email or password.",
    });
  });
});

describe("AuthClient.login (Spec 077 end-to-end)", () => {
  it("surfaces a revoked account via login() without prompting for a code", async () => {
    mockFetchFail403Body({
      code: "ACCOUNT_REVOKED",
      message: "Account disabled: your access has been revoked.",
    });
    const a = new AuthClient();
    const r = await a.login("revoked@test.com", "correctpw");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.accountState).toBe("revoked");
      expect(r.pending).toBeUndefined();
    }
    expect(a.isAuthenticated).toBe(false);
  });

  it("surfaces an awaiting-review account via login() without prompting for a code", async () => {
    mockFetchFail403Body({
      code: "ACCOUNT_PENDING_REVIEW",
      message:
        "Account disabled: your visitor request is still being reviewed.",
    });
    const a = new AuthClient();
    const r = await a.login("newbie@test.com", "correctpw");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.accountState).toBe("pending_review");
      expect(r.pending).toBeUndefined();
    }
  });

  it("drops a code-issued account into the inline code prompt via login()", async () => {
    mockFetchFail403Body({
      code: "ACCOUNT_PENDING_CODE_ISSUED",
      message: "Account disabled: enter your unlock code to activate.",
    });
    const a = new AuthClient();
    const r = await a.login("ready@test.com", "correctpw");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pending).toBe(true);
      expect(r.accountState).toBe("code_issued");
    }
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
    expect(calls).toContain("/kooker/api/auth/refresh");
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

describe("AuthClient (BFF cookie and clear session sync)", () => {
  it("issues cookie session via direct BFF path with same-origin credentials", async () => {
    const fetchCalls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url === KOOKER_COOKIE_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");
    const ok = await a.issueCookieSession(token);

    expect(ok).toBe(true);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe(KOOKER_COOKIE_PATH);
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(fetchCalls[0].init?.credentials).toBe("same-origin");
    expect((fetchCalls[0].init?.headers as Record<string, string>)?.Authorization).toBe(`Bearer ${token}`);
  });

  it("falls back to alias path if direct cookie path returns 404", async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push(url);
      if (url === KOOKER_COOKIE_PATH) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url === KOOKER_COOKIE_ALIAS_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });

    const a = new AuthClient();
    const token = fakeJwt(Date.now() + 3600_000, "operator@test.com");
    const ok = await a.issueCookieSession(token);

    expect(ok).toBe(true);
    expect(fetchCalls).toEqual([KOOKER_COOKIE_PATH, KOOKER_COOKIE_ALIAS_PATH]);
  });

  it("fails closed when no token is available for cookie issuance", async () => {
    const a = new AuthClient();
    const ok = await a.issueCookieSession();
    expect(ok).toBe(false);
  });

  it("clears cookie session via direct clear path with same-origin credentials", async () => {
    const fetchCalls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url === KOOKER_CLEAR_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    const ok = await a.clearCookieSession();

    expect(ok).toBe(true);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe(KOOKER_CLEAR_PATH);
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(fetchCalls[0].init?.credentials).toBe("same-origin");
  });

  it("falls back to alias clear path if direct clear path returns 404", async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls.push(url);
      if (url === KOOKER_CLEAR_PATH) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url === KOOKER_CLEAR_ALIAS_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });

    const a = new AuthClient();
    const ok = await a.clearCookieSession();

    expect(ok).toBe(true);
    expect(fetchCalls).toEqual([KOOKER_CLEAR_PATH, KOOKER_CLEAR_ALIAS_PATH]);
  });

  it("invokes cookie issuance on successful login and cookie clear on logout", async () => {
    const calls: { url: string; method?: string; auth?: string }[] = [];
    const token = fakeJwt(Date.now() + 3600_000, "player@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        auth: (init?.headers as Record<string, string>)?.Authorization,
      });
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "Player" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH || url === KOOKER_CLEAR_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    const loginResult = await a.login("player@test.com", "secret");
    expect(loginResult).toEqual({ ok: true });

    const cookieCall = calls.find((c) => c.url === KOOKER_COOKIE_PATH);
    expect(cookieCall).toBeDefined();
    expect(cookieCall?.auth).toBe(`Bearer ${token}`);

    a.logout();
    // Allow pending promise to settle
    await new Promise((resolve) => setTimeout(resolve, 10));
    const clearCall = calls.find((c) => c.url === KOOKER_CLEAR_PATH);
    expect(clearCall).toBeDefined();
  });

  it("handles account switch by issuing cookie session for the new account", async () => {
    const issuedTokens: string[] = [];
    const tokenA = fakeJwt(Date.now() + 3600_000, "userA@test.com");
    const tokenB = fakeJwt(Date.now() + 3600_000, "userB@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const email = auth.includes(btoa("usera@test.com:pw")) ? "userA@test.com" : "userB@test.com";
        const tok = email === "userA@test.com" ? tokenA : tokenB;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tok, user: { name: email } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        issuedTokens.push(auth.replace("Bearer ", ""));
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    await a.login("userA@test.com", "pw");
    expect(a.operator?.id).toBe("userA@test.com");

    await a.login("userB@test.com", "pw");
    expect(a.operator?.id).toBe("userB@test.com");

    expect(issuedTokens).toEqual([tokenA, tokenB]);
  });

  it("aborts in-flight cookie issuance when logout occurs before issuance completes", async () => {
    let abortObserved = false;
    let finishDeferredFetch: () => void = () => {};

    const tokenA = fakeJwt(Date.now() + 3600_000, "userA@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tokenA, user: { name: "UserA" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH) {
        init?.signal?.addEventListener("abort", () => {
          abortObserved = true;
        });
        return new Promise((resolve) => {
          finishDeferredFetch = () => {
            resolve({ ok: true, status: 200, json: async () => ({}) });
          };
        });
      }
      if (url === KOOKER_CLEAR_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    // Start login without waiting for slow cookie issuance
    const loginPromise = a.login("userA@test.com", "pw");
    await new Promise((r) => setTimeout(r, 10));

    // User logs out while issuance is still pending
    const logoutPromise = a.logout();

    // Abort should have been signaled to the in-flight issuance fetch
    expect(abortObserved).toBe(true);

    finishDeferredFetch();
    await loginPromise;
    const clearResult = await logoutPromise;
    expect(clearResult).toBe(true);
    expect(a.isAuthenticated).toBe(false);
  });

  it("serializes in-flight clear completion before new account cookie issuance", async () => {
    const events: string[] = [];
    let resolveClear: () => void = () => {};

    const tokenA = fakeJwt(Date.now() + 3600_000, "userA@test.com");
    const tokenB = fakeJwt(Date.now() + 3600_000, "userB@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const email = auth.includes(btoa("usera@test.com:pw")) ? "userA@test.com" : "userB@test.com";
        const tok = email === "userA@test.com" ? tokenA : tokenB;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tok, user: { name: email } }),
        };
      }
      if (url === KOOKER_CLEAR_PATH) {
        events.push("start:clear");
        return new Promise((resolve) => {
          resolveClear = () => {
            events.push("finish:clear");
            resolve({ ok: true, status: 200, json: async () => ({}) });
          };
        });
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "userA" : "userB";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    await a.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:userA"]);

    // Kick off logout (clear is deferred)
    const logoutPromise = a.logout();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:userA", "start:clear"]);

    // Account B logs in while clear is still in flight
    const loginBPromise = a.login("userB@test.com", "pw");

    // Clear has not finished yet, so userB issue MUST NOT have started
    expect(events).not.toContain("issue:userB");

    // Settle clear
    resolveClear();
    await logoutPromise;
    await loginBPromise;

    // Verify ordering: finish:clear happens BEFORE issue:userB
    expect(events).toEqual(["issue:userA", "start:clear", "finish:clear", "issue:userB"]);
  });

  it("handles failed clear gracefully and allows subsequent login and issuance", async () => {
    const token = fakeJwt(Date.now() + 3600_000, "user@test.com");

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "User" } }),
        };
      }
      if (url === KOOKER_CLEAR_PATH || url === KOOKER_CLEAR_ALIAS_PATH) {
        // Clear endpoint fails with 500
        return { ok: false, status: 500, json: async () => ({ error: "INTERNAL" }) };
      }
      if (url === KOOKER_COOKIE_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    await a.login("user@test.com", "pw");

    // Logout should return false (clear failed) without throwing unhandled rejection
    const clearResult = await a.logout();
    expect(clearResult).toBe(false);
    expect(a.isAuthenticated).toBe(false);

    // Subsequent login works without being blocked by previous failed clear
    const login2 = await a.login("user@test.com", "pw");
    expect(login2.ok).toBe(true);
    expect(a.isAuthenticated).toBe(true);
  });

  it("proves immediate local signout and bounded settlement on deferred/stalled clear", async () => {
    const token = fakeJwt(Date.now() + 3600_000, "user@test.com");
    let clearSignal: AbortSignal | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: token, user: { name: "User" } }),
        };
      }
      if (url === KOOKER_COOKIE_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === KOOKER_CLEAR_PATH) {
        clearSignal = init?.signal ?? null;
        if (clearSignal?.aborted) {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          return Promise.reject(err);
        }
        // Stalled clear: never resolves until aborted
        return new Promise((resolve, reject) => {
          clearSignal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    await a.login("user@test.com", "pw");
    expect(a.isAuthenticated).toBe(true);

    vi.useFakeTimers();
    try {
      // 1. Kick off logout: immediate local signout occurs synchronously
      const logoutPromise = a.logout();
      expect(a.isAuthenticated).toBe(false);
      expect(a.operator).toBeNull();

      // 2. Allow microtasks to execute so run() starts and registers its timeout
      await Promise.resolve();

      // 3. Bounded settlement: advance timers past the 5000ms deadline asynchronously
      await vi.advanceTimersByTimeAsync(5100);

      const result = await logoutPromise;
      // Stalled clear was bounded and cleanly resolved false without hanging
      expect(result).toBe(false);
      expect(a.isAuthenticated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles normal clear settlement and late/competing issuance controls cleanly", async () => {
    const tokenA = fakeJwt(Date.now() + 3600_000, "userA@test.com");
    const tokenB = fakeJwt(Date.now() + 3600_000, "userB@test.com");
    const events: string[] = [];
    let resolveClear: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const email = auth.includes(btoa("usera@test.com:pw")) ? "userA@test.com" : "userB@test.com";
        const tok = email === "userA@test.com" ? tokenA : tokenB;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tok, user: { name: email } }),
        };
      }
      if (url === KOOKER_CLEAR_PATH) {
        events.push("start:clear");
        return new Promise((resolve, reject) => {
          if (init?.signal?.aborted) {
            events.push("abort:clear");
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
            return;
          }
          init?.signal?.addEventListener("abort", () => {
            events.push("abort:clear");
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
          resolveClear = () => {
            events.push("finish:clear");
            resolve({ ok: true, status: 200, json: async () => ({}) });
          };
        });
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "userA" : "userB";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient();
    // 1. Normal login and issuance for user A
    await a.login("userA@test.com", "pw");
    expect(a.isAuthenticated).toBe(true);
    expect(events).toEqual(["issue:userA"]);

    // 2. Normal clear settlement
    const logoutAPromise = a.logout();
    expect(a.isAuthenticated).toBe(false); // immediate signout
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:userA", "start:clear"]);
    resolveClear!();
    const clearResultA = await logoutAPromise;
    expect(clearResultA).toBe(true);
    expect(events).toEqual(["issue:userA", "start:clear", "finish:clear"]);

    // 3. Abort-aware competing issuance: login B while old clear is deferred without manual success
    events.length = 0;
    await a.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:userA"]);

    const logoutA2Promise = a.logout();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:userA", "start:clear"]);

    // User B logs in while clear is still in flight (superseding login triggers controller abort)
    const loginBPromise = a.login("userB@test.com", "pw");

    const clearResultA2 = await logoutA2Promise;
    const loginBResult = await loginBPromise;

    // Verify: old clear was aborted and settled false, new session was issued and preserved
    expect(clearResultA2).toBe(false);
    expect(loginBResult.ok).toBe(true);
    expect(a.isAuthenticated).toBe(true);
    expect(a.operator?.id).toBe("userB@test.com");
    expect(events).toEqual(["issue:userA", "start:clear", "abort:clear", "issue:userB"]);
  });

  it("fences in-flight refresh so post-clear settlement never resurrects cookie session", async () => {
    let now = 1_000_000_000;
    const tokenA = fakeJwt(now + 1000, "userA@test.com");
    const tokenA2 = fakeJwt(now + 3600_000, "userA@test.com");
    const events: string[] = [];
    let resolveRefresh: (() => void) | null = null;
    let resolveClear: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tokenA, refreshToken: "refrA", user: { name: "userA@test.com" } }),
        };
      }
      if (url === KOOKER_REFRESH_PATH) {
        events.push("start:refresh");
        return new Promise((resolve) => {
          resolveRefresh = () => {
            events.push("finish:refresh");
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ accessToken: tokenA2, refreshToken: "refrA2" }),
            });
          };
        });
      }
      if (url === KOOKER_CLEAR_PATH) {
        events.push("start:clear");
        return new Promise((resolve) => {
          resolveClear = () => {
            events.push("finish:clear");
            resolve({ ok: true, status: 200, json: async () => ({}) });
          };
        });
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "initial" : auth.includes(tokenA2) ? "renewed" : "unknown";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient({ now: () => now });
    await a.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:initial"]);
    expect(a.isAuthenticated).toBe(true);

    // Fast-forward so token expires and triggers refresh
    now += 5000;
    const refreshPromise = a.getValidToken();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:initial", "start:refresh"]);

    // User logs out while refresh is in flight
    const logoutPromise = a.logout();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:initial", "start:refresh", "start:clear"]);
    expect(a.isAuthenticated).toBe(false);

    // Settle clear
    resolveClear!();
    await logoutPromise;
    expect(events).toEqual(["issue:initial", "start:refresh", "start:clear", "finish:clear"]);

    // Settle stale refresh now
    resolveRefresh!();
    const refreshedToken = await refreshPromise;

    // Verify: stale refresh was fenced out, returned null, and did NOT reissue cookie
    expect(refreshedToken).toBeNull();
    expect(a.isAuthenticated).toBe(false);
    expect(a.operator).toBeNull();
    expect(events).toEqual([
      "issue:initial",
      "start:refresh",
      "start:clear",
      "finish:clear",
      "finish:refresh",
    ]);
    expect(events).not.toContain("issue:renewed");
  });

  it("fences in-flight refresh so stale A refresh success after B login never overwrites B token or issues A cookie", async () => {
    let now = 1_000_000_000;
    const tokenA = fakeJwt(now + 1000, "userA@test.com");
    const tokenA2 = fakeJwt(now + 3600_000, "userA@test.com");
    const tokenB = fakeJwt(now + 3600_000, "userB@test.com");
    const events: string[] = [];
    let resolveRefresh: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const email = auth.includes(btoa("usera@test.com:pw")) ? "userA@test.com" : "userB@test.com";
        const tok = email === "userA@test.com" ? tokenA : tokenB;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tok, refreshToken: `refr_${email}`, user: { name: email } }),
        };
      }
      if (url === KOOKER_REFRESH_PATH) {
        events.push("start:refresh:userA");
        return new Promise((resolve) => {
          resolveRefresh = () => {
            events.push("finish:refresh:userA");
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ accessToken: tokenA2, refreshToken: "refrA2" }),
            });
          };
        });
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "userA" : auth.includes(tokenA2) ? "userA2" : "userB";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient({ now: () => now });
    await a.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:userA"]);

    // Trigger refresh for user A
    now += 5000;
    const refreshAPromise = a.getValidToken();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:userA", "start:refresh:userA"]);

    // User B logs in while A's refresh is still pending
    await a.login("userB@test.com", "pw");
    expect(events).toEqual(["issue:userA", "start:refresh:userA", "issue:userB"]);
    expect(a.operator?.id).toBe("userB@test.com");
    expect(a.authHeader()).toEqual({ Authorization: `Bearer ${tokenB}` });

    // Settle stale A refresh with 200 OK
    resolveRefresh!();
    const tokenFromStaleA = await refreshAPromise;

    // Verify: stale A was fenced out, user B is completely preserved, no userA2 cookie issued
    expect(tokenFromStaleA).toBeNull();
    expect(a.isAuthenticated).toBe(true);
    expect(a.operator?.id).toBe("userB@test.com");
    expect(a.authHeader()).toEqual({ Authorization: `Bearer ${tokenB}` });
    expect(events).toEqual([
      "issue:userA",
      "start:refresh:userA",
      "issue:userB",
      "finish:refresh:userA",
    ]);
    expect(events).not.toContain("issue:userA2");
  });

  it("fences in-flight refresh so stale A 401/403 failure after B login never logs out User B", async () => {
    let now = 1_000_000_000;
    const tokenA = fakeJwt(now + 1000, "userA@test.com");
    const tokenB = fakeJwt(now + 3600_000, "userB@test.com");
    const events: string[] = [];
    let resolveRefresh: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const email = auth.includes(btoa("usera@test.com:pw")) ? "userA@test.com" : "userB@test.com";
        const tok = email === "userA@test.com" ? tokenA : tokenB;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tok, refreshToken: `refr_${email}`, user: { name: email } }),
        };
      }
      if (url === KOOKER_REFRESH_PATH) {
        events.push("start:refresh:userA");
        return new Promise((resolve) => {
          resolveRefresh = () => {
            events.push("fail:refresh:userA");
            resolve({
              ok: false,
              status: 401,
              json: async () => ({ error: "invalid_grant" }),
            });
          };
        });
      }
      if (url === KOOKER_CLEAR_PATH) {
        events.push("start:clear");
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "userA" : "userB";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient({ now: () => now });
    await a.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:userA"]);

    // Trigger refresh for user A
    now += 5000;
    const refreshAPromise = a.getValidToken();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:userA", "start:refresh:userA"]);

    // User B logs in while A's refresh is still pending
    await a.login("userB@test.com", "pw");
    expect(events).toEqual(["issue:userA", "start:refresh:userA", "issue:userB"]);
    expect(a.operator?.id).toBe("userB@test.com");

    // Settle stale A refresh with 401 failure
    resolveRefresh!();
    const tokenFromStaleA = await refreshAPromise;

    // Verify: stale 401 was fenced out, B was NOT logged out, clear was NOT called
    expect(tokenFromStaleA).toBeNull();
    expect(a.isAuthenticated).toBe(true);
    expect(a.operator?.id).toBe("userB@test.com");
    expect(events).toEqual([
      "issue:userA",
      "start:refresh:userA",
      "issue:userB",
      "fail:refresh:userA",
    ]);
    expect(events).not.toContain("start:clear");
  });

  it("fences in-flight refresh so stale A 403 failure after B login never logs out User B", async () => {
    let now = 1_000_000_000;
    const tokenA = fakeJwt(now + 1000, "userA@test.com");
    const tokenB = fakeJwt(now + 3600_000, "userB@test.com");
    const events: string[] = [];
    let resolveRefresh: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const email = auth.includes(btoa("usera@test.com:pw")) ? "userA@test.com" : "userB@test.com";
        const tok = email === "userA@test.com" ? tokenA : tokenB;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tok, refreshToken: `refr_${email}`, user: { name: email } }),
        };
      }
      if (url === KOOKER_REFRESH_PATH) {
        events.push("start:refresh:userA");
        return new Promise((resolve) => {
          resolveRefresh = () => {
            events.push("fail:refresh:userA:403");
            resolve({
              ok: false,
              status: 403,
              json: async () => ({ error: "forbidden" }),
            });
          };
        });
      }
      if (url === KOOKER_CLEAR_PATH) {
        events.push("start:clear");
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "userA" : "userB";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient({ now: () => now });
    await a.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:userA"]);

    // Trigger refresh for user A
    now += 5000;
    const refreshAPromise = a.getValidToken();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:userA", "start:refresh:userA"]);

    // User B logs in while A's refresh is still pending
    await a.login("userB@test.com", "pw");
    expect(events).toEqual(["issue:userA", "start:refresh:userA", "issue:userB"]);
    expect(a.operator?.id).toBe("userB@test.com");

    // Settle stale A refresh with 403 failure
    resolveRefresh!();
    const tokenFromStaleA = await refreshAPromise;

    // Verify: stale 403 was fenced out, B was NOT logged out, clear was NOT called
    expect(tokenFromStaleA).toBeNull();
    expect(a.isAuthenticated).toBe(true);
    expect(a.operator?.id).toBe("userB@test.com");
    expect(events).toEqual([
      "issue:userA",
      "start:refresh:userA",
      "issue:userB",
      "fail:refresh:userA:403",
    ]);
    expect(events).not.toContain("start:clear");
  });

  it("fences in-flight refresh at the deferred JSON await boundary so supersession during JSON parsing is rejected", async () => {
    let now = 1_000_000_000;
    const tokenA = fakeJwt(now + 1000, "userA@test.com");
    const tokenA2 = fakeJwt(now + 3600_000, "userA@test.com");
    const events: string[] = [];
    let resolveJson: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tokenA, refreshToken: "refrA", user: { name: "userA@test.com" } }),
        };
      }
      if (url === KOOKER_REFRESH_PATH) {
        events.push("start:refresh");
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              resolveJson = () => {
                events.push("finish:json");
                resolve({ accessToken: tokenA2, refreshToken: "refrA2" });
              };
            }),
        };
      }
      if (url === KOOKER_CLEAR_PATH) {
        events.push("start:clear");
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "initial" : auth.includes(tokenA2) ? "renewed" : "unknown";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const a = new AuthClient({ now: () => now });
    await a.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:initial"]);

    // Advance clock to trigger refresh
    now += 5000;
    const refreshPromise = a.getValidToken();
    await new Promise((r) => setTimeout(r, 10));
    // Fetch has returned, but JSON parsing is now pending
    expect(events).toEqual(["issue:initial", "start:refresh"]);

    // User logs out while json() is pending
    await a.logout();
    expect(a.isAuthenticated).toBe(false);
    expect(events).toEqual(["issue:initial", "start:refresh", "start:clear"]);

    // Now resolve JSON parsing
    resolveJson!();
    const refreshedToken = await refreshPromise;

    // Post-json await fence must reject the refreshed token
    expect(refreshedToken).toBeNull();
    expect(a.isAuthenticated).toBe(false);
    expect(events).toEqual(["issue:initial", "start:refresh", "start:clear", "finish:json"]);
    expect(events).not.toContain("issue:renewed");
  });

  it("synchronizes refreshed session across active AuthClient instances upon successful refresh", async () => {
    resetSharedAuthClient();
    let now = 1_000_000_000;
    const tokenA = fakeJwt(now + 1000, "userA@test.com");
    const tokenA2 = fakeJwt(now + 3600_000, "userA@test.com");
    const events: string[] = [];

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tokenA, refreshToken: "refrA", user: { name: "userA@test.com" } }),
        };
      }
      if (url === KOOKER_REFRESH_PATH) {
        events.push("refresh");
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tokenA2, refreshToken: "refrA2" }),
        };
      }
      if (url === KOOKER_COOKIE_PATH) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const client1 = getAuthClient({ now: () => now });
    const client2 = new AuthClient({ now: () => now });

    await client1.login("userA@test.com", "pw");
    expect(client1.isAuthenticated).toBe(true);
    expect(client2.isAuthenticated).toBe(true);

    // Expire token
    now += 5000;

    // Refresh through client1
    const refreshedToken = await client1.getValidToken();
    expect(refreshedToken).toBe(tokenA2);

    // client2 session is synchronized and valid with tokenA2 without calling refresh again
    expect(client2.isAuthenticated).toBe(true);
    expect(client2.authHeader()).toEqual({ Authorization: `Bearer ${tokenA2}` });
    expect(events).toEqual(["refresh"]); // Only 1 refresh network call

    client2.dispose();
    resetSharedAuthClient();
  });

  it("coordinates shared session authority across instances: app logout invalidates shared singleton and suppresses stale shared refresh cookie", async () => {
    resetSharedAuthClient();
    let now = 1_000_000_000;
    const tokenA = fakeJwt(now + 1000, "userA@test.com");
    const tokenA2 = fakeJwt(now + 3600_000, "userA@test.com");
    const events: string[] = [];
    let resolveRefresh: (() => void) | null = null;
    let resolveClear: (() => void) | null = null;

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/basic")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: tokenA, refreshToken: "refrA", user: { name: "userA@test.com" } }),
        };
      }
      if (url === KOOKER_REFRESH_PATH) {
        events.push("start:refresh");
        return new Promise((resolve) => {
          resolveRefresh = () => {
            events.push("finish:refresh");
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ accessToken: tokenA2, refreshToken: "refrA2" }),
            });
          };
        });
      }
      if (url === KOOKER_CLEAR_PATH) {
        events.push("start:clear");
        return new Promise((resolve) => {
          resolveClear = () => {
            events.push("finish:clear");
            resolve({ ok: true, status: 200, json: async () => ({}) });
          };
        });
      }
      if (url === KOOKER_COOKIE_PATH) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        const sub = auth.includes(tokenA) ? "initial" : auth.includes(tokenA2) ? "renewed" : "unknown";
        events.push(`issue:${sub}`);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const sharedAuth = getAuthClient({ now: () => now });
    await sharedAuth.login("userA@test.com", "pw");
    expect(events).toEqual(["issue:initial"]);
    expect(sharedAuth.isAuthenticated).toBe(true);

    // Trigger refresh on shared instance (e.g. from background store or AuthGate)
    now += 5000;
    const refreshPromise = sharedAuth.getValidToken();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:initial", "start:refresh"]);

    // App instance logs out
    const appAuth = new AuthClient({ now: () => now });
    const logoutPromise = appAuth.logout();
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["issue:initial", "start:refresh", "start:clear"]);

    // Shared instance is invalidated by app logout!
    expect(appAuth.isAuthenticated).toBe(false);
    expect(sharedAuth.isAuthenticated).toBe(false);

    // Settle clear
    resolveClear!();
    await logoutPromise;
    expect(events).toEqual(["issue:initial", "start:refresh", "start:clear", "finish:clear"]);

    // Now settle shared in-flight refresh with 200 OK
    resolveRefresh!();
    const refreshedToken = await refreshPromise;

    // Verify: stale shared refresh was fenced out, returned null, and did NOT reissue cookie
    expect(refreshedToken).toBeNull();
    expect(sharedAuth.isAuthenticated).toBe(false);
    expect(events).toEqual([
      "issue:initial",
      "start:refresh",
      "start:clear",
      "finish:clear",
      "finish:refresh",
    ]);
    expect(events).not.toContain("issue:renewed");
    resetSharedAuthClient();
  });
});
