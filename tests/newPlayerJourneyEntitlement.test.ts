import { describe, it, expect } from "vitest";
import {
  NEW_PLAYER_JOURNEY_PATH,
  decideJourneyEntitlement,
  evaluateJourneyEntitlement,
  journeyEntitlementBypassed,
  newPlayerJourneyAvailable,
  type JourneyEntitlementDeps,
  type JourneyFlagBody,
} from "../src/colony/entitlement/newPlayerJourney";

// Opaque non-secret fixture: the mock getUserId below maps THIS exact string to "42"
// by identity, so the token's contents are irrelevant to the test.
const PLAYER_TOKEN = "test-player-token-not-a-secret";

function deps(
  over: {
    ok?: boolean;
    status?: number;
    body?: JourneyFlagBody | null;
    throws?: boolean;
    token?: string | null;
    getUserId?: (token: string) => string | null;
  } = {},
): {
  deps: JourneyEntitlementDeps;
  calls: { path: string; headers: Record<string, string> }[];
} {
  const calls: { path: string; headers: Record<string, string> }[] = [];
  const d: JourneyEntitlementDeps = {
    transport: async (path, headers) => {
      calls.push({ path, headers });
      if (over.throws) throw new Error("offline");
      return {
        ok: over.ok ?? true,
        status: over.status ?? 200,
        body: over.body === undefined ? { enabled: true } : over.body,
      };
    },
    getToken: async () =>
      over.token === undefined ? PLAYER_TOKEN : over.token,
    getUserId: over.getUserId ?? ((t) => (t === PLAYER_TOKEN ? "42" : null)),
  };
  return { deps: d, calls };
}

describe("decideJourneyEntitlement (pure fail-closed decision)", () => {
  it("enables ONLY on an unambiguous enabled:true from a non-killed flag (UAT_ALLOWLIST)", () => {
    expect(
      decideJourneyEntitlement({
        ok: true,
        status: 200,
        body: { enabled: true, state: "UAT_ALLOWLIST", reason: "allowlisted" },
      }),
    ).toEqual({ enabled: true, reason: "allowlisted" });
  });

  it("fails closed when OFF (enabled:false)", () => {
    const r = decideJourneyEntitlement({
      ok: true,
      status: 200,
      body: { enabled: false, state: "OFF" },
    });
    expect(r.enabled).toBe(false);
  });

  it("fails closed when the flag is KILLED even if enabled somehow reads true (kill wins)", () => {
    expect(
      decideJourneyEntitlement({
        ok: true,
        status: 200,
        body: { enabled: true, killed: true },
      }).enabled,
    ).toBe(false);
    expect(
      decideJourneyEntitlement({
        ok: true,
        status: 200,
        body: { enabled: true, state: "killed" },
      }).enabled,
    ).toBe(false);
  });

  it("fails closed on 401/403 (not authorized / not allowlisted)", () => {
    for (const status of [401, 403]) {
      const r = decideJourneyEntitlement({ ok: false, status, body: null });
      expect(r.enabled).toBe(false);
      expect(r.reason).toMatch(new RegExp(String(status)));
    }
  });

  it("fails closed on a 5xx / non-ok response", () => {
    expect(
      decideJourneyEntitlement({ ok: false, status: 503, body: null }).enabled,
    ).toBe(false);
  });

  it("fails closed on a malformed / missing payload", () => {
    expect(
      decideJourneyEntitlement({ ok: true, status: 200, body: null }).enabled,
    ).toBe(false);
    // A truthy value that is not exactly enabled:true must NOT open the gate.
    expect(
      decideJourneyEntitlement({
        ok: true,
        status: 200,
        body: { enabled: "true" as unknown },
      }).enabled,
    ).toBe(false);
    expect(
      decideJourneyEntitlement({
        ok: true,
        status: 200,
        body: { enabled: 1 as unknown },
      }).enabled,
    ).toBe(false);
  });
});

describe("evaluateJourneyEntitlement (transport + token wiring)", () => {
  it("targets the token-derived players/me endpoint through the /kooker proxy", () => {
    expect(NEW_PLAYER_JOURNEY_PATH).toBe(
      "/kooker/api/v1/citylife/players/me/feature-flags/new-player-journey-v1",
    );
  });

  it("fails closed and makes NO network call when there is no token", async () => {
    const { deps: d, calls } = deps({ token: null });
    const r = await evaluateJourneyEntitlement(d);
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/sign in/i);
    expect(calls).toHaveLength(0);
  });

  it("enables for an allowlisted player and sends the bearer + token-derived id (never a caller id)", async () => {
    const { deps: d, calls } = deps({ body: { enabled: true } });
    const r = await evaluateJourneyEntitlement(d);
    expect(r.enabled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(NEW_PLAYER_JOURNEY_PATH);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${PLAYER_TOKEN}`);
    // The only id hint is derived from the already-validated token, not supplied by the caller.
    expect(calls[0]!.headers["X-Kooker-User-Id"]).toBe("42");
  });

  it("omits the id header when the token carries no derivable userId", async () => {
    const { deps: d, calls } = deps({ getUserId: () => null });
    await evaluateJourneyEntitlement(d);
    expect(calls[0]!.headers["X-Kooker-User-Id"]).toBeUndefined();
  });

  it("fails closed when disabled (OFF)", async () => {
    const { deps: d } = deps({ body: { enabled: false } });
    expect((await evaluateJourneyEntitlement(d)).enabled).toBe(false);
  });

  it("fails closed on a fetch failure / timeout (transport throws / aborts)", async () => {
    const { deps: d } = deps({ throws: true });
    const r = await evaluateJourneyEntitlement(d);
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/offline/);
  });
});

describe("newPlayerJourneyAvailable (the single UI/runtime gate)", () => {
  it("is unavailable while the entitlement is still loading (null) — fail closed", () => {
    expect(
      newPlayerJourneyAvailable({ bypass: false, entitlement: null }),
    ).toBe(false);
  });

  it("is unavailable when the entitlement resolved disabled", () => {
    expect(
      newPlayerJourneyAvailable({
        bypass: false,
        entitlement: { enabled: false },
      }),
    ).toBe(false);
  });

  it("is available for an allowlisted (enabled) entitlement", () => {
    expect(
      newPlayerJourneyAvailable({
        bypass: false,
        entitlement: { enabled: true },
      }),
    ).toBe(true);
  });

  it("is available for the DEV/E2E null-operator bypass without any entitlement", () => {
    expect(
      newPlayerJourneyAvailable({ bypass: true, entitlement: null }),
    ).toBe(true);
  });
});

describe("journeyEntitlementBypassed (DEV/E2E carve-out)", () => {
  it("bypasses ONLY the null-operator skip-auth state, never an authenticated player", () => {
    expect(journeyEntitlementBypassed({ operator: null })).toBe(true);
    expect(
      journeyEntitlementBypassed({
        operator: { id: "p", userId: "u", scopes: [], roles: ["CITYLIFE_PLAYER"] },
      }),
    ).toBe(false);
  });
});

describe("account switch (no cross-user cache bleed)", () => {
  // The evaluator is stateless — each identity re-derives from its OWN token, so a prior user's
  // positive entitlement can never carry into the next session's decision.
  it("re-derives per identity: allowlisted user A then OFF user B", async () => {
    const a = deps({ token: "A", body: { enabled: true }, getUserId: () => "A" });
    expect((await evaluateJourneyEntitlement(a.deps)).enabled).toBe(true);
    const b = deps({ token: "B", body: { enabled: false }, getUserId: () => "B" });
    expect((await evaluateJourneyEntitlement(b.deps)).enabled).toBe(false);
  });
});
