import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  AuthClient,
  basicAuth,
  classifyLoginFailure,
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
