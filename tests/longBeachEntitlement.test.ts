// Spec 169 §5.2 — the `west-coast-long-beach-v1` gate: fail-closed on every ambiguous answer, and
// the DEV bypass is the narrow shared predicate, never auth state. (The full rationale for why this
// gate DOES carry a bypass while the HUD gate does not is in each module's header — additive
// affordance vs moved legacy controls.)
import { describe, expect, it } from "vitest";
import {
  LONG_BEACH_FLAG_PATH,
  decideLongBeachEntitlement,
  evaluateLongBeachEntitlement,
  longBeachAvailable,
  longBeachDevBypass,
  type LongBeachTransportResult,
} from "../src/colony/entitlement/westCoastLongBeach";

const ok = (body: unknown): LongBeachTransportResult =>
  ({ ok: true, status: 200, body }) as LongBeachTransportResult;

describe("Spec 169 — the Long Beach gate", () => {
  it("enables only on an unambiguous live yes; the kill switch beats enabled", () => {
    expect(decideLongBeachEntitlement(ok({ enabled: true })).enabled).toBe(
      true,
    );
    expect(
      decideLongBeachEntitlement(ok({ enabled: true, killed: true })).enabled,
    ).toBe(false);
    expect(
      decideLongBeachEntitlement(ok({ enabled: true, state: "killed" }))
        .enabled,
    ).toBe(false);
    for (const body of [{ enabled: false }, { enabled: "true" }, {}, null])
      expect(
        decideLongBeachEntitlement(ok(body)).enabled,
        JSON.stringify(body),
      ).toBe(false);
    for (const status of [401, 403, 404, 500])
      expect(
        decideLongBeachEntitlement({
          ok: false,
          status,
          body: { enabled: true },
        }).enabled,
      ).toBe(false);
  });

  it("fails closed signed-out without touching the network, and on a thrown transport", async () => {
    let called = false;
    const out = await evaluateLongBeachEntitlement({
      transport: async () => ((called = true), ok({ enabled: true })),
      getToken: async () => null,
      getUserId: () => null,
    });
    expect(out.enabled).toBe(false);
    expect(called).toBe(false);
    const thrown = await evaluateLongBeachEntitlement({
      transport: async () => {
        throw new Error("down");
      },
      getToken: async () => "t",
      getUserId: () => "u",
    });
    expect(thrown.enabled).toBe(false);
  });

  it("hits the flag path with the bearer", async () => {
    let seen = "";
    await evaluateLongBeachEntitlement({
      transport: async (path) => ((seen = path), ok({ enabled: true })),
      getToken: async () => "tok",
      getUserId: () => "u",
    });
    expect(seen).toBe(LONG_BEACH_FLAG_PATH);
  });

  it("availability: bypass or a live positive, nothing else — and the bypass is a PROBE, not auth", () => {
    expect(longBeachAvailable({ bypass: true, entitlement: null })).toBe(true);
    expect(
      longBeachAvailable({ bypass: false, entitlement: { enabled: true } }),
    ).toBe(true);
    expect(longBeachAvailable({ bypass: false, entitlement: null })).toBe(
      false,
    );
    expect(
      longBeachAvailable({ bypass: false, entitlement: { enabled: false } }),
    ).toBe(false);
    // The bypass takes an injectable probe (dev-build + local origin + explicit opt-in), so a null
    // or expired operator can never fail OPEN — the arcadeGamehouse security note, inherited.
    expect(
      longBeachDevBypass({
        isDev: false,
        origin: "https://city.example",
        flag: false,
      } as never),
    ).toBe(false);
  });
});
