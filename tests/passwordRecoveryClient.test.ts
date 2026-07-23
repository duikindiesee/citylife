import { describe, it, expect, vi, afterEach } from "vitest";
import {
  requestPasswordRecovery,
  validateRecoveryInput,
  RECOVERY_PASSWORD_MIN,
  RECOVERY_PASSWORD_MAX,
} from "../src/colony/passwordRecoveryClient";

// A 12-char (== the minimum) throwaway that is obviously not a real secret.
const OK_PASSWORD = "aaaaaaaaaaaa";

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

describe("passwordRecoveryClient (public R1, token-free)", () => {
  it("posts identifier + newPassword to the EXACT recovery path with NO auth header", async () => {
    const calls = capture({
      ok: true,
      status: 202,
      body: { status: "RECEIVED", requestRef: "A1B2-C3D4" },
    });
    const r = await requestPasswordRecovery("player@test.com", OK_PASSWORD);
    expect(r).toEqual({ status: "RECEIVED", requestRef: "A1B2-C3D4" });
    // Exact public R1 route (through the /kooker proxy) — method + path exact.
    expect(calls[0].url).toBe("/kooker/api/users/password-recovery-request");
    expect((calls[0].init.method ?? "").toUpperCase()).toBe("POST");
    // The candidate password travels ONLY in the body — never a query string.
    expect(calls[0].url).not.toContain(OK_PASSWORD);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      identifier: "player@test.com",
      newPassword: OK_PASSWORD,
    });
    const headerKeys = Object.keys(
      (calls[0].init.headers ?? {}) as Record<string, string>,
    ).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain("authorization");
  });

  it("returns the generic requestRef for ANY identifier (no existence oracle)", async () => {
    // The backend returns 202 + a random-looking ref even for a nonexistent account. The client must
    // treat it identically — the caller can never tell 'eligible' from 'unknown'.
    capture({
      ok: true,
      status: 202,
      body: { status: "RECEIVED", requestRef: "9F9F-9F9F" },
    });
    const r = await requestPasswordRecovery(
      "definitely-not-a-real-user",
      OK_PASSWORD,
    );
    expect(r.status).toBe("RECEIVED");
    expect(r.requestRef).toBe("9F9F-9F9F");
  });

  it("throws with the HTTP status attached and never sends a bearer on failure", async () => {
    const calls = capture({ ok: false, status: 429, body: {} });
    let caught: (Error & { status?: number }) | null = null;
    try {
      await requestPasswordRecovery("player@test.com", OK_PASSWORD);
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

describe("validateRecoveryInput (local only — never weakens the server)", () => {
  it("accepts a well-formed request", () => {
    expect(
      validateRecoveryInput("player@test.com", OK_PASSWORD, OK_PASSWORD, true),
    ).toEqual({ ok: true });
  });

  it("requires an identifier", () => {
    const r = validateRecoveryInput("   ", OK_PASSWORD, OK_PASSWORD, true);
    expect(r.ok).toBe(false);
  });

  it("enforces the 12–128 candidate-password policy (mirrors the backend @Size)", () => {
    const short = "a".repeat(RECOVERY_PASSWORD_MIN - 1);
    const long = "a".repeat(RECOVERY_PASSWORD_MAX + 1);
    expect(validateRecoveryInput("id", short, short, true).ok).toBe(false);
    expect(validateRecoveryInput("id", long, long, true).ok).toBe(false);
    const min = "a".repeat(RECOVERY_PASSWORD_MIN);
    const max = "a".repeat(RECOVERY_PASSWORD_MAX);
    expect(validateRecoveryInput("id", min, min, true).ok).toBe(true);
    expect(validateRecoveryInput("id", max, max, true).ok).toBe(true);
  });

  it("requires the confirmation to match", () => {
    const r = validateRecoveryInput("id", OK_PASSWORD, OK_PASSWORD + "x", true);
    expect(r.ok).toBe(false);
  });

  it("requires explicit consent", () => {
    const r = validateRecoveryInput("id", OK_PASSWORD, OK_PASSWORD, false);
    expect(r.ok).toBe(false);
  });
});
