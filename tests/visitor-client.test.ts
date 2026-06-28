import { describe, it, expect, vi, afterEach } from "vitest";
import { signupVisitor, redeemUnlockCode } from "../src/colony/visitorClient";

afterEach(() => vi.unstubAllGlobals());

/** Capture every fetch call so we can assert URL, body and headers; return the canned response. */
function capture(resp: { ok: boolean; status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: resp.ok, status: resp.status, json: async () => resp.body };
  });
  return calls;
}

describe("visitorClient (public, token-free)", () => {
  it("signupVisitor posts email/password/username to the signup path with NO auth header", async () => {
    const calls = capture({
      ok: true,
      status: 200,
      body: { userId: 7, status: "PENDING" },
    });
    const r = await signupVisitor("v@test.com", "secret123", "kooker_v");
    expect(r).toEqual({ userId: 7, status: "PENDING" });
    expect(calls[0].url).toContain("/api/v1/citylife/visitor/signup");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      email: "v@test.com",
      password: "secret123",
      username: "kooker_v",
    });
    const headerKeys = Object.keys(
      (calls[0].init.headers ?? {}) as Record<string, string>,
    ).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain("authorization");
  });

  it("redeemUnlockCode posts email+code ONLY (no password) to the unlock path", async () => {
    const calls = capture({
      ok: true,
      status: 200,
      body: { userId: 7, active: true },
    });
    const r = await redeemUnlockCode("v@test.com", "ABCDEF0123456789");
    expect(r).toEqual({ userId: 7, active: true });
    expect(calls[0].url).toContain("/api/v1/citylife/visitor/unlock");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ email: "v@test.com", code: "ABCDEF0123456789" });
    expect(body.password).toBeUndefined();
  });

  it("throws an Error carrying the HTTP status on a non-ok response", async () => {
    capture({ ok: false, status: 429, body: { message: "Too many attempts" } });
    await expect(redeemUnlockCode("v@test.com", "x")).rejects.toMatchObject({
      status: 429,
      message: "Too many attempts",
    });
  });
});
