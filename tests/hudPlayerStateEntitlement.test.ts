// UI.STATE.1 slice 1 — the `hud-player-state-v1` gate must fail CLOSED on every ambiguous answer,
// and must have NO dev/e2e bypass.
//
// The no-bypass property is the one that differs from the kookerHq/newPlayerJourney pattern and the
// one most likely to be "fixed" back by a well-meaning edit, so it gets its own named test with the
// reason in the assertion message: e2e runs under the skip-auth bypass and clicks legacy topbar
// controls by role and name (e2e/passwordActivation.spec.ts, "Change password"). A bypass here flips
// every e2e run onto the new HUD and breaks them, while the acceptance criterion says flag OFF keeps
// e2e green on the legacy bar.
import { describe, expect, it } from "vitest";
import {
  HUD_PLAYER_STATE_FLAG,
  HUD_PLAYER_STATE_FLAG_PATH,
  decideHudEntitlement,
  evaluateHudEntitlement,
  hudPlayerStateAvailable,
  type HudTransportResult,
} from "../src/colony/entitlement/hudPlayerState";

const ok = (body: unknown): HudTransportResult =>
  ({ ok: true, status: 200, body }) as HudTransportResult;

describe("UI.STATE.1 — the only way to the new HUD is an unambiguous yes", () => {
  it("enables on exactly enabled:true from a live flag", () => {
    expect(decideHudEntitlement(ok({ enabled: true })).enabled).toBe(true);
  });

  it("a kill switch beats enabled:true", () => {
    expect(
      decideHudEntitlement(ok({ enabled: true, killed: true })).enabled,
    ).toBe(false);
    expect(
      decideHudEntitlement(ok({ enabled: true, state: "KILLED" })).enabled,
    ).toBe(false);
    expect(
      decideHudEntitlement(ok({ enabled: true, state: "killed" })).enabled,
    ).toBe(false);
  });

  it("fails closed on every non-yes body", () => {
    for (const body of [
      { enabled: false },
      { enabled: "true" }, // a STRING — must not be coerced
      { enabled: 1 },
      {},
      null,
      "enabled",
    ]) {
      expect(decideHudEntitlement(ok(body)).enabled, JSON.stringify(body)).toBe(
        false,
      );
    }
  });

  it("fails closed on every non-ok status", () => {
    for (const status of [401, 403, 404, 429, 500, 502, 503]) {
      expect(
        decideHudEntitlement({ ok: false, status, body: { enabled: true } })
          .enabled,
        `HTTP ${status}`,
      ).toBe(false);
    }
  });

  it("fails closed when signed out — and never calls the backend", async () => {
    let called = false;
    const result = await evaluateHudEntitlement({
      transport: async () => {
        called = true;
        return ok({ enabled: true });
      },
      getToken: async () => null,
      getUserId: () => null,
    });
    expect(result.enabled).toBe(false);
    expect(called, "no token must short-circuit before the request").toBe(
      false,
    );
  });

  it("fails closed when the transport throws", async () => {
    const result = await evaluateHudEntitlement({
      transport: async () => {
        throw new Error("network down");
      },
      getToken: async () => "token",
      getUserId: () => "u1",
    });
    expect(result.enabled).toBe(false);
  });

  it("hits the hud-player-state-v1 flag path with the bearer", async () => {
    let seenPath = "";
    let seenHeaders: Record<string, string> = {};
    await evaluateHudEntitlement({
      transport: async (path, headers) => {
        seenPath = path;
        seenHeaders = headers;
        return ok({ enabled: true });
      },
      getToken: async () => "tok123",
      getUserId: () => "user-from-token",
    });
    expect(seenPath).toBe(HUD_PLAYER_STATE_FLAG_PATH);
    expect(seenPath).toContain(HUD_PLAYER_STATE_FLAG);
    expect(seenHeaders["Authorization"]).toBe("Bearer tok123");
    expect(seenHeaders["X-Kooker-User-Id"]).toBe("user-from-token");
  });
});

describe("UI.STATE.1 — availability has NO bypass, by design", () => {
  it("a null (loading) entitlement renders the legacy topbar", () => {
    expect(hudPlayerStateAvailable({ entitlement: null })).toBe(false);
  });

  it("only an unambiguous positive opens the new HUD", () => {
    expect(hudPlayerStateAvailable({ entitlement: { enabled: true } })).toBe(
      true,
    );
    expect(hudPlayerStateAvailable({ entitlement: { enabled: false } })).toBe(
      false,
    );
  });

  it("takes no bypass argument at all — the skip-auth session must stay on the legacy bar", () => {
    // e2e runs signed-out under skip-auth and locates legacy topbar controls by role/name; a bypass
    // that treats operator===null as entitled would flip e2e onto the new HUD and break them. If a
    // future edit adds a bypass parameter, this arity pin fails and points here.
    expect(hudPlayerStateAvailable.length).toBe(1);
  });
});
