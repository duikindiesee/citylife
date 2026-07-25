import { describe, it, expect } from "vitest";
import {
  coerceEligibleNeighbourhood,
  sanitizeEligibleNeighbourhoods,
  parseHomeTruth,
  isHomeOwned,
  classifyPurchaseStatus,
  purchaseButtonView,
  purchaseStateColor,
  homePurchaseIdempotencyKey,
  postPurchaseHome,
} from "../src/colony/home/starterProperty";

// PLAYER.HOME.1C — the pure model for the dark starter-property slice. Everything here is node-testable
// with no DOM and no network: the dark gate, the SERVER-RETURNED-ONLY eligible-list sanitiser, the
// authoritative home-truth parser, the closed-set purchase classifier, and the local refusals that keep
// a tampered/stale key off the wire.

describe("eligible-list sanitiser (SERVER-RETURNED ONLY)", () => {
  it("coerces a well-formed entry and keeps only a server-quoted price", () => {
    expect(
      coerceEligibleNeighbourhood({ key: "coastal", name: "Coastal", priceKco: 350 }),
    ).toEqual({ key: "coastal", name: "Coastal", priceKco: 350 });
    // no price quoted → null, never a client-invented number
    expect(coerceEligibleNeighbourhood({ key: "vale2" })).toEqual({
      key: "vale2",
      name: "vale2",
      priceKco: null,
    });
    // accepts a `price` alias too
    expect(coerceEligibleNeighbourhood({ key: "k", price: 12.5 })?.priceKco).toBe(
      12.5,
    );
  });
  it("drops keyless / non-object / non-finite-price garbage", () => {
    expect(coerceEligibleNeighbourhood({ name: "no key" })).toBeNull();
    expect(coerceEligibleNeighbourhood({ key: "  " })).toBeNull();
    expect(coerceEligibleNeighbourhood(null)).toBeNull();
    expect(coerceEligibleNeighbourhood("coastal")).toBeNull();
    expect(
      coerceEligibleNeighbourhood({ key: "k", priceKco: "350" })?.priceKco,
    ).toBeNull();
    expect(
      coerceEligibleNeighbourhood({ key: "k", priceKco: Number.NaN })?.priceKco,
    ).toBeNull();
  });
  it("accepts a bare array or a { neighbourhoods } envelope, de-dupes, sorts by key", () => {
    const raw = {
      neighbourhoods: [
        { key: "vale2", name: "Vale", priceKco: 350 },
        { key: "coastal", name: "Coastal", priceKco: 350 },
        { key: "vale2", name: "Vale DUPLICATE", priceKco: 999 }, // dropped (first wins)
        { bogus: true }, // dropped
      ],
    };
    const out = sanitizeEligibleNeighbourhoods(raw);
    expect(out.map((n) => n.key)).toEqual(["coastal", "vale2"]);
    expect(out.find((n) => n.key === "vale2")!.name).toBe("Vale");
  });
  it("returns [] for anything malformed — never a guess", () => {
    expect(sanitizeEligibleNeighbourhoods(null)).toEqual([]);
    expect(sanitizeEligibleNeighbourhoods({ nope: 1 })).toEqual([]);
    expect(sanitizeEligibleNeighbourhoods(42)).toEqual([]);
  });
});

describe("authoritative home-truth parser", () => {
  it("parses the deployed 1.37.3 shape and reads the not-owned baseline", () => {
    const t = parseHomeTruth({
      owned: false,
      status: null,
      neighbourhoodKey: null,
      plotId: null,
      onboardingState: "NONE",
    });
    expect(t).not.toBeNull();
    expect(t!.owned).toBe(false);
    expect(t!.onboardingState).toBe("NONE");
    expect(isHomeOwned(t)).toBe(false);
  });
  it("owned requires an explicit boolean true and a non-contradicting status", () => {
    expect(isHomeOwned(parseHomeTruth({ owned: true, status: "OWNED" }))).toBe(
      true,
    );
    // truthy-but-not-true never counts as owned (fail closed)
    expect(isHomeOwned(parseHomeTruth({ owned: "true" as unknown }))).toBe(false);
    expect(isHomeOwned(parseHomeTruth({ owned: 1 as unknown }))).toBe(false);
    // owned true but the server status contradicts → not owned
    expect(
      isHomeOwned(parseHomeTruth({ owned: true, status: "PENDING" })),
    ).toBe(false);
  });
  it("returns null for a non-object payload", () => {
    expect(parseHomeTruth(null)).toBeNull();
    expect(parseHomeTruth("owned")).toBeNull();
  });
});

describe("purchase status classifier (closed set, fail-closed)", () => {
  it("maps each deployed status to its outcome", () => {
    expect(classifyPurchaseStatus(200)).toEqual({ kind: "owned" });
    expect(classifyPurchaseStatus(201)).toEqual({ kind: "owned" });
    expect(classifyPurchaseStatus(422)).toEqual({ kind: "insufficient_funds" });
    expect(classifyPurchaseStatus(202)).toEqual({ kind: "pending" });
    expect(classifyPurchaseStatus(409)).toEqual({ kind: "pending" });
    // signed out / feature off / kill switch all fail closed to disabled
    expect(classifyPurchaseStatus(401)).toEqual({ kind: "disabled" });
    expect(classifyPurchaseStatus(403)).toEqual({ kind: "disabled" });
    expect(classifyPurchaseStatus(503)).toEqual({ kind: "disabled" });
  });
  it("surfaces an error (with status) for anything else", () => {
    expect(classifyPurchaseStatus(500)).toEqual({ kind: "error", status: 500 });
    expect(classifyPurchaseStatus(418)).toEqual({ kind: "error", status: 418 });
  });
});

describe("purchase button view (thin-view state machine)", () => {
  it("owned and pending are terminal, non-firing states", () => {
    expect(purchaseButtonView(true, true, false, undefined).disabled).toBe(true);
    expect(purchaseButtonView(true, true, false, undefined).state).toBe("owned");
    expect(purchaseButtonView(false, true, true, undefined).state).toBe("pending");
    expect(purchaseButtonView(false, true, true, undefined).disabled).toBe(true);
  });
  it("requires a selection before it can fire", () => {
    const v = purchaseButtonView(false, false, false, undefined);
    expect(v.state).toBe("disabled");
    expect(v.disabled).toBe(true);
  });
  it("ready when a choice is selected and no blocking outcome", () => {
    const v = purchaseButtonView(false, true, false, undefined);
    expect(v.state).toBe("ready");
    expect(v.disabled).toBe(false);
  });
  it("insufficient_funds and error are retryable; disabled is not", () => {
    expect(
      purchaseButtonView(false, true, false, { kind: "insufficient_funds" })
        .disabled,
    ).toBe(false);
    expect(
      purchaseButtonView(false, true, false, { kind: "error" }).disabled,
    ).toBe(false);
    expect(
      purchaseButtonView(false, true, false, { kind: "disabled" }).disabled,
    ).toBe(true);
  });
  it("every state has a colour", () => {
    for (const s of [
      "ready",
      "pending",
      "owned",
      "insufficient_funds",
      "disabled",
      "error",
    ] as const) {
      expect(purchaseStateColor(s)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("idempotency key (double-tap / reload = same request)", () => {
  it("is stable for a (player, neighbourhood) pair and varies by each", () => {
    expect(homePurchaseIdempotencyKey("u1", "coastal")).toBe(
      "citylife:home-purchase:u1:coastal",
    );
    expect(homePurchaseIdempotencyKey("u1", "coastal")).toBe(
      homePurchaseIdempotencyKey("u1", "coastal"),
    );
    expect(homePurchaseIdempotencyKey("u1", "coastal")).not.toBe(
      homePurchaseIdempotencyKey("u2", "coastal"),
    );
    expect(homePurchaseIdempotencyKey(null, "coastal")).toContain(":anon:");
  });
});

describe("postPurchaseHome local refusals (never touch the wire)", () => {
  it("refuses a key the server did not just offer (tampered/stale)", async () => {
    await expect(
      postPurchaseHome("private-hamlet", ["coastal", "vale2"]),
    ).resolves.toEqual({ kind: "disabled" });
  });
  it("refuses an empty key", async () => {
    await expect(postPurchaseHome("", ["coastal"])).resolves.toEqual({
      kind: "disabled",
    });
  });
});
