import { describe, it, expect, vi, afterEach } from "vitest";
import { activatePassword } from "../src/colony/passwordActivateClient";

// Obviously-fake 32-hex fixtures, built from a repeated block so they carry no real entropy and can
// never be mistaken for a live token by a secret scanner.
const FAKE_TOKEN = "ABCD1234".repeat(4); // 32 hex chars
const BAD_TOKEN = "0BAD0BAD".repeat(4);

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

describe("passwordActivateClient (public, token-free)", () => {
  it("posts identifier + token to the exact password-activate path with NO auth header", async () => {
    const calls = capture({
      ok: true,
      status: 200,
      body: { userId: 42, status: "ACTIVATED" },
    });
    const r = await activatePassword("player@test.com", FAKE_TOKEN);
    expect(r).toEqual({ userId: 42, status: "ACTIVATED" });
    expect(calls[0].url).toBe("/kooker/api/users/password-activate");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      identifier: "player@test.com",
      token: FAKE_TOKEN,
    });
    const headerKeys = Object.keys(
      (calls[0].init.headers ?? {}) as Record<string, string>,
    ).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain("authorization");
  });

  it("throws the backend's generic message on any failure (no oracle)", async () => {
    capture({
      ok: false,
      status: 401,
      body: { message: "Invalid or expired code" },
    });
    await expect(
      activatePassword("player@test.com", BAD_TOKEN),
    ).rejects.toThrow(/invalid or expired code/i);
  });

  it("attaches the HTTP status to the thrown error and never sends a bearer", async () => {
    const calls = capture({ ok: false, status: 429, body: {} });
    let caught: (Error & { status?: number }) | null = null;
    try {
      await activatePassword("player@test.com", BAD_TOKEN);
    } catch (e) {
      caught = e as Error & { status: number };
    }
    expect(caught?.status).toBe(429);
    const headerKeys = Object.keys(
      (calls[0].init.headers ?? {}) as Record<string, string>,
    ).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain("authorization");
  });
});
