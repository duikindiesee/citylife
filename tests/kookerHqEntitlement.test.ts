// HQ.FLAG.1 — the `kooker-hq-v1` gate must fail CLOSED on every ambiguous answer.
//
// The whole point of the gate is that an unfinished reception cannot leak to players who were never
// allowlisted. So the interesting cases are not the happy path — they are every way the backend can
// fail to say a clear yes. Each of these is a separate way to fail OPEN if the decision is written
// carelessly, which is why they are enumerated rather than sampled.
import { describe, expect, it } from "vitest";
import {
  KOOKER_HQ_FLAG,
  KOOKER_HQ_FLAG_PATH,
  decideHqEntitlement,
  evaluateHqEntitlement,
  type HqTransportResult,
} from "../src/colony/entitlement/kookerHq";

const ok = (body: unknown): HqTransportResult =>
  ({ ok: true, status: 200, body }) as HqTransportResult;

describe("HQ.FLAG.1 — the only way in is an unambiguous yes", () => {
  it("enables on exactly enabled:true from a live flag", () => {
    expect(decideHqEntitlement(ok({ enabled: true })).enabled).toBe(true);
  });

  it("a kill switch beats enabled:true", () => {
    // Both forms of kill, each with enabled ALSO true — the dangerous shape.
    expect(
      decideHqEntitlement(ok({ enabled: true, killed: true })).enabled,
    ).toBe(false);
    expect(
      decideHqEntitlement(ok({ enabled: true, state: "KILLED" })).enabled,
    ).toBe(false);
    expect(
      decideHqEntitlement(ok({ enabled: true, state: "killed" })).enabled,
    ).toBe(false);
  });

  it("fails closed on every non-yes body", () => {
    for (const body of [
      { enabled: false },
      { enabled: "true" }, // a STRING, not the boolean — must not be coerced
      { enabled: 1 },
      {},
      null,
      "enabled",
    ]) {
      expect(decideHqEntitlement(ok(body)).enabled, JSON.stringify(body)).toBe(
        false,
      );
    }
  });

  it("fails closed on every non-ok status", () => {
    for (const status of [401, 403, 404, 429, 500, 502, 503]) {
      expect(
        decideHqEntitlement({ ok: false, status, body: { enabled: true } })
          .enabled,
        `HTTP ${status}`,
      ).toBe(false);
    }
  });

  it("fails closed when signed out — and never calls the backend", async () => {
    let called = false;
    const result = await evaluateHqEntitlement({
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
    const result = await evaluateHqEntitlement({
      transport: async () => {
        throw new Error("network down");
      },
      getToken: async () => "token",
      getUserId: () => "u1",
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain("network down");
  });

  it("sends the bearer and only a TOKEN-DERIVED user id, to the flag path", async () => {
    let seenPath = "";
    let seenHeaders: Record<string, string> = {};
    await evaluateHqEntitlement({
      transport: async (path, headers) => {
        seenPath = path;
        seenHeaders = headers;
        return ok({ enabled: true });
      },
      getToken: async () => "tok123",
      getUserId: () => "user-from-token",
    });
    expect(seenPath).toBe(KOOKER_HQ_FLAG_PATH);
    expect(seenPath).toContain(KOOKER_HQ_FLAG);
    expect(seenHeaders["Authorization"]).toBe("Bearer tok123");
    expect(seenHeaders["X-Kooker-User-Id"]).toBe("user-from-token");
  });

  it("omits the user-id header entirely when the token yields none", async () => {
    let seenHeaders: Record<string, string> = {};
    await evaluateHqEntitlement({
      transport: async (_p, headers) => {
        seenHeaders = headers;
        return ok({ enabled: true });
      },
      getToken: async () => "tok",
      getUserId: () => null,
    });
    expect("X-Kooker-User-Id" in seenHeaders).toBe(false);
  });
});
