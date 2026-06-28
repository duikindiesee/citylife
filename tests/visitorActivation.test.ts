import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { AuthClient } from "../src/colony/authClient";
import { redeemAndLogin } from "../src/colony/visitorActivation";

/** Unsigned JWT with a far-future exp (only the payload matters client-side). */
function fakeJwt(email = "v@test.com"): string {
  const payload = btoa(JSON.stringify({ sub: email, exp: 4070908800 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

interface FlowOpts {
  redeemOk?: boolean; // does /unlock succeed?
  activatesOnRedeem?: boolean; // does a successful redeem actually flip the account active?
  initiallyActive?: boolean; // account already active before any redeem
  loginThrowsWhenActive?: boolean; // simulate a network failure on the retry login
}

/** One fetch stub spanning /visitor/unlock + /auth/basic, with a mutable `active` flag. */
function mockFlow(opts: FlowOpts) {
  let active = opts.initiallyActive ?? false;
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url.includes("/visitor/unlock")) {
      if (!opts.redeemOk) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ message: "Invalid or expired code." }),
        };
      }
      if (opts.activatesOnRedeem !== false) active = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ userId: 1, active }),
      };
    }
    if (url.includes("/auth/basic")) {
      if (active) {
        if (opts.loginThrowsWhenActive) throw new Error("network down");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: fakeJwt(),
            user: { email: "v@test.com" },
          }),
        };
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({ message: "Account disabled" }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return { calls };
}

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* no sessionStorage */
  }
});
afterEach(() => vi.unstubAllGlobals());

describe("redeemAndLogin", () => {
  it("redeems then auto-signs-in (happy path)", async () => {
    const { calls } = mockFlow({ redeemOk: true });
    const auth = new AuthClient();
    const r = await redeemAndLogin(
      auth,
      "v@test.com",
      "pw",
      "ABCDEF0123456789",
    );
    expect(r).toEqual({ ok: true });
    expect(auth.isAuthenticated).toBe(true);
    expect(calls.filter((u) => u.includes("/visitor/unlock"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("/auth/basic"))).toHaveLength(1);
  });

  it("lets a user in when the code is already-used but the account is already active", async () => {
    // redeem fails (single-use consumed), but a plain login succeeds because they activated earlier.
    const { calls } = mockFlow({ redeemOk: false, initiallyActive: true });
    const auth = new AuthClient();
    const r = await redeemAndLogin(
      auth,
      "v@test.com",
      "pw",
      "ABCDEF0123456789",
    );
    expect(r).toEqual({ ok: true });
    expect(calls.filter((u) => u.includes("/auth/basic"))).toHaveLength(1);
  });

  it("reports a redeem-stage failure for a bad code on a still-inactive account", async () => {
    mockFlow({ redeemOk: false, initiallyActive: false });
    const auth = new AuthClient();
    const r = await redeemAndLogin(
      auth,
      "v@test.com",
      "pw",
      "BADCODE0123456789",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("redeem");
      expect(r.error).toMatch(/invalid or expired/i);
    }
    expect(auth.isAuthenticated).toBe(false);
  });

  it("reports a retry-stage pending failure when redeem succeeds but activation didn't take", async () => {
    mockFlow({ redeemOk: true, activatesOnRedeem: false });
    const auth = new AuthClient();
    const r = await redeemAndLogin(
      auth,
      "v@test.com",
      "pw",
      "ABCDEF0123456789",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("retry");
      expect(r.pending).toBe(true);
    }
  });

  it("reports a retry-stage transient failure when the post-redeem login errors", async () => {
    mockFlow({ redeemOk: true, loginThrowsWhenActive: true });
    const auth = new AuthClient();
    const r = await redeemAndLogin(
      auth,
      "v@test.com",
      "pw",
      "ABCDEF0123456789",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("retry");
      expect(r.pending).toBeUndefined(); // network error, not a pending account
    }
  });
});
