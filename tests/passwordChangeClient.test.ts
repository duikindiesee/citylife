import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// getAuthClient() is a module singleton, so reset the module graph per test to get a fresh, isolated
// shared AuthClient. Each test seeds (or omits) a session by logging that fresh client in through a
// mocked /auth/basic, then exercises requestPasswordChange.

/** Unsigned JWT with a far-future exp so getValidToken() treats the session as live. */
function fakeJwt(email = "player@test.com"): string {
  const payload = btoa(JSON.stringify({ sub: email, exp: 4070908800 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

interface FetchCase {
  changeOk?: boolean;
  changeStatus?: number;
  throwOnChange?: boolean;
}

/** One fetch stub spanning /auth/basic (login) and /me/password-change-request (E1). */
function mockFetch(cse: FetchCase) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/auth/basic")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: fakeJwt(),
          user: { email: "player@test.com" },
        }),
      };
    }
    if (url.includes("/me/password-change-request")) {
      if (cse.throwOnChange) throw new Error("network down");
      return {
        ok: cse.changeOk ?? true,
        status: cse.changeStatus ?? 200,
        json: async () => ({}),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return calls;
}

/** Fresh module graph → fresh getAuthClient singleton; optionally sign it in first. */
async function freshModules(signIn: boolean) {
  vi.resetModules();
  const authMod = await import("../src/colony/authClient");
  const pwdMod = await import("../src/colony/passwordChangeClient");
  if (signIn) {
    const r = await authMod.getAuthClient().login("player@test.com", "old-pass-1234");
    expect(r.ok).toBe(true);
  }
  return pwdMod;
}

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* node env — no sessionStorage */
  }
});
afterEach(() => vi.unstubAllGlobals());

describe("requestPasswordChange", () => {
  it("posts current + new password with a Bearer token to the exact E1 path", async () => {
    const calls = mockFetch({ changeOk: true });
    const { requestPasswordChange } = await freshModules(true);
    const r = await requestPasswordChange("old-pass-1234", "brand-new-pass-5678");
    expect(r).toEqual({ ok: true });

    const change = calls.find((c) => c.url.includes("/me/password-change-request"));
    expect(change).toBeTruthy();
    expect(change!.url).toBe("/kooker/api/users/me/password-change-request");
    expect(JSON.parse(change!.init.body as string)).toEqual({
      currentPassword: "old-pass-1234",
      newPassword: "brand-new-pass-5678",
    });
    const headers = (change!.init.headers ?? {}) as Record<string, string>;
    const auth = headers["Authorization"] ?? headers["authorization"];
    expect(auth).toMatch(/^Bearer /);
  });

  it("maps a 401 to a specific current-password error (the re-proof failed)", async () => {
    mockFetch({ changeOk: false, changeStatus: 401 });
    const { requestPasswordChange } = await freshModules(true);
    const r = await requestPasswordChange("wrong-current", "brand-new-pass-5678");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/current password is incorrect/i);
  });

  it("maps any other non-2xx to one neutral error", async () => {
    mockFetch({ changeOk: false, changeStatus: 500 });
    const { requestPasswordChange } = await freshModules(true);
    const r = await requestPasswordChange("old-pass-1234", "brand-new-pass-5678");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/try again/i);
  });

  it("refuses without a session and never calls the E1 endpoint", async () => {
    const calls = mockFetch({ changeOk: true });
    const { requestPasswordChange } = await freshModules(false); // not signed in
    const r = await requestPasswordChange("old-pass-1234", "brand-new-pass-5678");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/signed out/i);
    expect(calls.some((c) => c.url.includes("/me/password-change-request"))).toBe(false);
  });

  it("returns a network error when the request throws", async () => {
    mockFetch({ throwOnChange: true });
    const { requestPasswordChange } = await freshModules(true);
    const r = await requestPasswordChange("old-pass-1234", "brand-new-pass-5678");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/network error/i);
  });
});
