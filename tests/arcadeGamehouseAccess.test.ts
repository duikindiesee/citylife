// ARCADE.2A — deterministic authorization tests for the fail-closed, default-OFF Gamehouse gate.
// Covers the whole matrix (signed-out, non-player, player+OFF, player+killed, player+ON, bypass) plus
// the pure decision and the network evaluator, all without a DOM or a real network.
import { describe, expect, it } from "vitest";
import {
  ARCADE_3D_FLAG,
  ARCADE_3D_FLAG_PATH,
  CITYLIFE_PLAYER_ROLE,
  decideArcadeEntitlement,
  evaluateArcadeEntitlement,
  arcadeGamehouseAvailable,
  arcadeGamehouseDevBypass,
  isEntitledCityLifePlayer,
  type ArcadeTransportResult,
} from "../src/colony/entitlement/arcadeGamehouse";
import type { DevAuthBypassProbe } from "../src/colony/devAuthBypass";

const ok = (body: unknown): ArcadeTransportResult => ({
  ok: true,
  status: 200,
  body: body as ArcadeTransportResult["body"],
});

const PLAYER = {
  userId: "user-123",
  roles: [CITYLIFE_PLAYER_ROLE],
} as const;

describe("ARCADE.2A — the flag identity is stable and public-safe", () => {
  it("names citylife-arcade-3d-v1 and the token-derived me-scoped path", () => {
    expect(ARCADE_3D_FLAG).toBe("citylife-arcade-3d-v1");
    expect(ARCADE_3D_FLAG_PATH).toBe(
      "/kooker/api/v1/citylife/players/me/feature-flags/citylife-arcade-3d-v1",
    );
    // No caller-supplied userId in the path — identity is resolved server-side from the bearer token.
    expect(ARCADE_3D_FLAG_PATH).not.toMatch(/user-?123|:userId|\{/i);
  });
});

describe("ARCADE.2A — decideArcadeEntitlement fails closed on everything but an explicit positive", () => {
  it("enables ONLY for an unambiguous enabled===true on a non-killed flag", () => {
    expect(decideArcadeEntitlement(ok({ enabled: true })).enabled).toBe(true);
    expect(
      decideArcadeEntitlement(ok({ enabled: true, reason: "cohort-a" })).reason,
    ).toBe("cohort-a");
  });

  it("disables on OFF, missing, non-boolean-true, killed and state=KILLED", () => {
    expect(decideArcadeEntitlement(ok({ enabled: false })).enabled).toBe(false);
    expect(decideArcadeEntitlement(ok({})).enabled).toBe(false);
    expect(decideArcadeEntitlement(ok({ enabled: "true" })).enabled).toBe(
      false,
    );
    expect(decideArcadeEntitlement(ok({ enabled: 1 })).enabled).toBe(false);
    // A kill switch ALWAYS wins, even alongside enabled:true.
    expect(
      decideArcadeEntitlement(ok({ enabled: true, killed: true })).enabled,
    ).toBe(false);
    expect(
      decideArcadeEntitlement(ok({ enabled: true, state: "KILLED" })).enabled,
    ).toBe(false);
  });

  it("disables on a non-ok response and a malformed/absent body", () => {
    expect(
      decideArcadeEntitlement({ ok: false, status: 403, body: null }).enabled,
    ).toBe(false);
    expect(
      decideArcadeEntitlement({ ok: false, status: 401, body: null }).enabled,
    ).toBe(false);
    expect(
      decideArcadeEntitlement({ ok: true, status: 200, body: null }).enabled,
    ).toBe(false);
  });
});

describe("ARCADE.2A — isEntitledCityLifePlayer requires a JWT userId AND the CITYLIFE_PLAYER role", () => {
  it("accepts an authenticated player carrying the role (case-insensitive)", () => {
    expect(isEntitledCityLifePlayer(PLAYER)).toBe(true);
    expect(
      isEntitledCityLifePlayer({ userId: "u", roles: ["citylife_player"] }),
    ).toBe(true);
    expect(
      isEntitledCityLifePlayer({
        userId: "u",
        roles: ["KOOKER_USER", "CITYLIFE_PLAYER"],
      }),
    ).toBe(true);
  });

  it("rejects signed-out, role-less and non-player sessions", () => {
    expect(isEntitledCityLifePlayer(null)).toBe(false);
    expect(isEntitledCityLifePlayer(undefined)).toBe(false);
    expect(isEntitledCityLifePlayer({ userId: null })).toBe(false);
    expect(isEntitledCityLifePlayer({ userId: "u", roles: [] })).toBe(false);
    expect(
      isEntitledCityLifePlayer({ userId: "u", roles: ["CITYLIFE_VISITOR"] }),
    ).toBe(false);
    // An operator/admin is not a *player* — the venue is player-only.
    expect(
      isEntitledCityLifePlayer({ userId: "u", roles: ["CITYLIFE_ADMIN"] }),
    ).toBe(false);
  });
});

describe("ARCADE.2A — arcadeGamehouseAvailable is the single fail-closed availability decision", () => {
  const enabled = { enabled: true } as const;
  const off = { enabled: false } as const;

  it("opens for an authenticated CITYLIFE_PLAYER with the flag ON", () => {
    expect(
      arcadeGamehouseAvailable({
        bypass: false,
        entitlement: enabled,
        session: PLAYER,
      }),
    ).toBe(true);
  });

  it("stays closed for a signed-out visitor even if the flag somehow reads ON", () => {
    expect(
      arcadeGamehouseAvailable({
        bypass: false,
        entitlement: enabled,
        session: null,
      }),
    ).toBe(false);
    expect(
      arcadeGamehouseAvailable({
        bypass: false,
        entitlement: enabled,
        session: { userId: null },
      }),
    ).toBe(false);
  });

  it("stays closed for a signed-in NON-player even with the flag ON", () => {
    expect(
      arcadeGamehouseAvailable({
        bypass: false,
        entitlement: enabled,
        session: { userId: "u", roles: ["CITYLIFE_VISITOR"] },
      }),
    ).toBe(false);
  });

  it("stays closed for an entitled player while the flag is OFF, killed or still loading", () => {
    expect(
      arcadeGamehouseAvailable({
        bypass: false,
        entitlement: off,
        session: PLAYER,
      }),
    ).toBe(false);
    expect(
      arcadeGamehouseAvailable({
        bypass: false,
        entitlement: null,
        session: PLAYER,
      }),
    ).toBe(false);
  });

  it("opens for the narrowly scoped DEV/E2E bypass without any entitlement or role", () => {
    expect(
      arcadeGamehouseAvailable({
        bypass: true,
        entitlement: null,
        session: null,
      }),
    ).toBe(true);
  });
});

describe("ARCADE.2A — the DEV/E2E bypass requires DEV + local origin + explicit opt-in (never null auth)", () => {
  const probe = (over: Partial<DevAuthBypassProbe>): DevAuthBypassProbe => ({
    isDev: false,
    hostname: "",
    localTestSetting: false,
    urlSkip: false,
    ...over,
  });

  it("opens on a DEV build, local host and an explicit opt-in", () => {
    expect(
      arcadeGamehouseDevBypass(
        probe({ isDev: true, hostname: "localhost", localTestSetting: true }),
      ),
    ).toBe(true);
    expect(
      arcadeGamehouseDevBypass(
        probe({ isDev: true, hostname: "127.0.0.1", urlSkip: true }),
      ),
    ).toBe(true);
  });

  it("stays CLOSED without the explicit opt-in even on a local dev build", () => {
    expect(
      arcadeGamehouseDevBypass(probe({ isDev: true, hostname: "localhost" })),
    ).toBe(false);
  });

  it("stays CLOSED off a DEV build (a production build can never bypass)", () => {
    expect(
      arcadeGamehouseDevBypass(
        probe({ isDev: false, hostname: "localhost", localTestSetting: true }),
      ),
    ).toBe(false);
  });

  it("stays CLOSED on a non-local (production) origin even with a dev build + opt-in", () => {
    expect(
      arcadeGamehouseDevBypass(
        probe({
          isDev: true,
          hostname: "citylife.kooker.co.za",
          urlSkip: true,
          localTestSetting: true,
        }),
      ),
    ).toBe(false);
  });
});

describe("ARCADE.2A — evaluateArcadeEntitlement drives the token → flag path and fails closed", () => {
  it("denies with no token and never calls the transport", async () => {
    let called = false;
    const result = await evaluateArcadeEntitlement({
      transport: async () => {
        called = true;
        return ok({ enabled: true });
      },
      getToken: async () => null,
      getUserId: () => null,
    });
    expect(result.enabled).toBe(false);
    expect(called).toBe(false);
  });

  it("sends the bearer + token-derived X-Kooker-User-Id and enables on a live positive", async () => {
    let seenPath = "";
    let seenHeaders: Record<string, string> = {};
    const result = await evaluateArcadeEntitlement({
      transport: async (path, headers) => {
        seenPath = path;
        seenHeaders = headers;
        return ok({ enabled: true });
      },
      getToken: async () => "tok.abc",
      getUserId: () => "user-xyz",
    });
    expect(result.enabled).toBe(true);
    expect(seenPath).toBe(ARCADE_3D_FLAG_PATH);
    expect(seenHeaders.Authorization).toBe("Bearer tok.abc");
    expect(seenHeaders["X-Kooker-User-Id"]).toBe("user-xyz");
  });

  it("fails closed when the transport throws (timeout / network error)", async () => {
    const result = await evaluateArcadeEntitlement({
      transport: async () => {
        throw new Error("aborted");
      },
      getToken: async () => "tok.abc",
      getUserId: () => "user-xyz",
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/couldn't verify/i);
  });

  it("fails closed on a 403 from the flag endpoint", async () => {
    const result = await evaluateArcadeEntitlement({
      transport: async () => ({ ok: false, status: 403, body: null }),
      getToken: async () => "tok.abc",
      getUserId: () => "user-xyz",
    });
    expect(result.enabled).toBe(false);
  });

  it("revokes on an enabled→killed transition (the same session, re-checked live)", async () => {
    // Models the live revalidation the OPEN venue performs: the first check enables, a later re-check —
    // after an operator kill — must flip to disabled so the render guard can close the venue.
    const bodies = [{ enabled: true }, { enabled: true, killed: true }];
    let call = 0;
    const deps = {
      transport: async () => ok(bodies[Math.min(call++, bodies.length - 1)]),
      getToken: async () => "tok.abc",
      getUserId: () => "user-xyz",
    };
    const first = await evaluateArcadeEntitlement(deps);
    expect(first.enabled).toBe(true);
    const second = await evaluateArcadeEntitlement(deps);
    expect(second.enabled).toBe(false);
    expect(second.reason).toMatch(/killed/i);
  });

  it("revokes on an enabled→OFF transition and on an enabled→error transition", async () => {
    const off = await evaluateArcadeEntitlement({
      transport: async () => ok({ enabled: false }),
      getToken: async () => "tok.abc",
      getUserId: () => "user-xyz",
    });
    expect(off.enabled).toBe(false);
    const errored = await evaluateArcadeEntitlement({
      transport: async () => ({ ok: false, status: 401, body: null }),
      getToken: async () => "tok.abc",
      getUserId: () => "user-xyz",
    });
    expect(errored.enabled).toBe(false);
  });
});
