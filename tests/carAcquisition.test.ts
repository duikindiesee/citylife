import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isCarAcquisitionEnabled,
  vehicleKeyOf,
  serverVehicleKeyOf,
  isCanonicalVehicleKey,
  classifyAcquireStatus,
  acquireButtonView,
  acquireStateColor,
  safeOwnedKeys,
  loadOwnedKeysCache,
  saveOwnedKeysCache,
  clearOwnedKeysCache,
  carOwnershipCacheKey,
  fetchOwnedVehicleKeysBackend,
  postAcquireVehicle,
  acquireIdempotencyKey,
  BACKEND_VEHICLE_PURCHASE_PATH,
} from "../src/colony/car/carAcquisition";
import { SHOWROOM_VEHICLES } from "../src/colony/showroom/showroomCatalog";
import { getAuthClient } from "../src/colony/authClient";

// PLAYER.CAR.1.S4 — showroom acquisition against authoritative server truth, kept dark behind a feature
// gate. These tests pin the contract: the button posts the CANONICAL vehicleKey only, ownership renders
// from the server GET (localStorage is cache only), every response maps to a closed state, and the whole
// path is inert (never touches the network, never claims ownership) while the gate is off.

// node has no localStorage — a tiny in-memory shim (matches furnitureStore.test / blueprintStore.test)
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const ON = { VITE_CITYLIFE_CAR_ACQUISITION: "on" };
const VONK = vehicleKeyOf(SHOWROOM_VEHICLES[0]!);
const KAAP = vehicleKeyOf(SHOWROOM_VEHICLES[1]!);

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("carAcquisition — feature gate (enabled by default)", () => {
  it("is ON when the env var is absent or empty, and an explicit off remains available", () => {
    expect(isCarAcquisitionEnabled({})).toBe(true);
    expect(isCarAcquisitionEnabled({ VITE_CITYLIFE_CAR_ACQUISITION: "" })).toBe(
      true,
    );
    expect(
      isCarAcquisitionEnabled({ VITE_CITYLIFE_CAR_ACQUISITION: "off" }),
    ).toBe(false);
    // called with no argument it reads the real test env, which keeps the enabled default
    expect(isCarAcquisitionEnabled()).toBe(true);
  });
  it("is ON only for an explicit affirmative value (case/space tolerant)", () => {
    for (const v of ["on", "1", "true", "enabled", "  ON ", "True"]) {
      expect(
        isCarAcquisitionEnabled({ VITE_CITYLIFE_CAR_ACQUISITION: v }),
      ).toBe(true);
    }
    for (const v of ["no", "yes-ish", "2", "disabled"]) {
      expect(
        isCarAcquisitionEnabled({ VITE_CITYLIFE_CAR_ACQUISITION: v }),
      ).toBe(false);
    }
  });
});

describe("carAcquisition — canonical vehicleKey screen", () => {
  it("accepts exactly the catalog's CarSpec ids and nothing else", () => {
    for (const v of SHOWROOM_VEHICLES) {
      expect(isCanonicalVehicleKey(vehicleKeyOf(v))).toBe(true);
    }
    expect(isCanonicalVehicleKey("showroom:not-a-car")).toBe(false);
    expect(isCanonicalVehicleKey("")).toBe(false);
    expect(isCanonicalVehicleKey(null)).toBe(false);
    expect(isCanonicalVehicleKey(42)).toBe(false);
  });
});

describe("carAcquisition — response classification", () => {
  it("maps every meaningful status to a closed outcome", () => {
    expect(classifyAcquireStatus(200)).toEqual({ kind: "owned" });
    expect(classifyAcquireStatus(201)).toEqual({ kind: "owned" });
    expect(classifyAcquireStatus(402)).toEqual({ kind: "insufficient_funds" });
    expect(classifyAcquireStatus(422)).toEqual({ kind: "insufficient_funds" });
    expect(classifyAcquireStatus(202)).toEqual({ kind: "pending" });
    expect(classifyAcquireStatus(409)).toEqual({ kind: "pending" });
    expect(classifyAcquireStatus(401)).toEqual({ kind: "disabled" });
    expect(classifyAcquireStatus(403)).toEqual({ kind: "disabled" });
    expect(classifyAcquireStatus(400)).toEqual({ kind: "unsupported" });
    expect(classifyAcquireStatus(500)).toEqual({ kind: "error", status: 500 });
    expect(classifyAcquireStatus(404)).toEqual({ kind: "error", status: 404 });
  });
});

describe("carAcquisition — button state machine", () => {
  it("owned and in-flight are both disabled and never re-post", () => {
    expect(acquireButtonView(true, false, undefined).state).toBe("owned");
    expect(acquireButtonView(true, false, undefined).disabled).toBe(true);
    expect(acquireButtonView(false, true, undefined).state).toBe("pending");
    expect(acquireButtonView(false, true, undefined).disabled).toBe(true);
    // owned wins even if a stale outcome lingers
    expect(acquireButtonView(true, false, { kind: "error" }).state).toBe(
      "owned",
    );
  });
  it("surfaces insufficient funds and errors as retryable, but replay/refusal as locked", () => {
    expect(acquireButtonView(false, false, undefined).state).toBe("ready");
    expect(acquireButtonView(false, false, undefined).disabled).toBe(false);
    expect(
      acquireButtonView(false, false, { kind: "insufficient_funds" }).disabled,
    ).toBe(false);
    expect(acquireButtonView(false, false, { kind: "error" }).disabled).toBe(
      false,
    );
    expect(acquireButtonView(false, false, { kind: "pending" }).disabled).toBe(
      true,
    );
    expect(acquireButtonView(false, false, { kind: "disabled" }).disabled).toBe(
      true,
    );
    expect(
      acquireButtonView(false, false, { kind: "unsupported" }).disabled,
    ).toBe(true);
    expect(acquireButtonView(false, false, { kind: "unsupported" }).state).toBe(
      "unsupported",
    );
    expect(acquireButtonView(false, false, { kind: "unsupported" }).label).toBe(
      "🔒 Preview only",
    );
  });
  it("every state has a colour", () => {
    for (const s of [
      "ready",
      "pending",
      "owned",
      "insufficient_funds",
      "disabled",
      "unsupported",
      "error",
    ] as const) {
      expect(acquireStateColor(s)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("carAcquisition — ownership cache (CACHE ONLY)", () => {
  it("screens, dedupes and sorts, dropping non-canonical entries", () => {
    expect(safeOwnedKeys([KAAP, VONK, VONK, "showroom:fake", 7, null])).toEqual(
      [VONK, KAAP].sort(),
    );
    expect(safeOwnedKeys("not an array")).toEqual([]);
  });
  it("round-trips through localStorage and recovers from a corrupt cache", () => {
    expect(saveOwnedKeysCache([VONK])).toBe(true);
    expect(loadOwnedKeysCache()).toEqual([VONK]);
    localStorage.setItem("citylife.car.ownership.v1", "{not json");
    expect(loadOwnedKeysCache()).toEqual([]);
    clearOwnedKeysCache();
    expect(loadOwnedKeysCache()).toEqual([]);
  });
  it("scopes ownership cache per account to prevent cross-account showroom suppression", () => {
    expect(carOwnershipCacheKey("user-1")).toBe(
      "citylife.car.ownership.v1.user-1",
    );
    expect(carOwnershipCacheKey(null)).toBe("citylife.car.ownership.v1");
    expect(carOwnershipCacheKey("")).toBe("citylife.car.ownership.v1");

    saveOwnedKeysCache([VONK], "user-1");
    expect(loadOwnedKeysCache("user-1")).toEqual([VONK]);
    expect(loadOwnedKeysCache("user-2")).toEqual([]);

    clearOwnedKeysCache("user-1");
    expect(loadOwnedKeysCache("user-1")).toEqual([]);
  });
});

describe("carAcquisition — backend ownership truth (GET)", () => {
  it("returns null when signed out (callers keep the cache)", async () => {
    getAuthClient().logout();
    expect(await fetchOwnedVehicleKeysBackend()).toBeNull();
  });
  it("parses valid arrays and envelopes but refuses partial malformed server truth", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => [KAAP, "showroom:fake", VONK],
    }));
    expect(await fetchOwnedVehicleKeysBackend()).toBeNull();

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => [KAAP, VONK],
    }));
    expect(await fetchOwnedVehicleKeysBackend()).toEqual([VONK, KAAP].sort());

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ownedVehicleKeys: [VONK] }),
    }));
    expect(await fetchOwnedVehicleKeysBackend()).toEqual([VONK]);

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        owned: true,
        status: "OWNED",
        vehicleKey: serverVehicleKeyOf(VONK),
      }),
    }));
    expect(await fetchOwnedVehicleKeysBackend()).toEqual([
      serverVehicleKeyOf(VONK),
    ]);

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        owned: false,
        status: null,
        vehicleKey: null,
      }),
    }));
    expect(await fetchOwnedVehicleKeysBackend()).toEqual([]);
  });
  it("returns null on a non-OK response (e.g. 404 while the endpoint ships)", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    expect(await fetchOwnedVehicleKeysBackend()).toBeNull();
  });
});

describe("carAcquisition — POST acquire (server authority, vehicleKey only)", () => {
  it("refuses locally WITHOUT any network call when the gate is explicitly dark", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    expect(await postAcquireVehicle(VONK, { VITE_CITYLIFE_CAR_ACQUISITION: "off" })).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("refuses a non-canonical key without posting, even when enabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    expect(await postAcquireVehicle("showroom:fake", ON)).toEqual({
      kind: "disabled",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("is disabled (never posts) when signed out", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue(null);
    expect(await postAcquireVehicle(VONK, ON)).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("posts ONLY the vehicleKey with a bearer + stable idempotency key, and classifies the result", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    let url = "";
    let init: RequestInit = {};
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return { ok: true, status: 200 };
    });
    const r = await postAcquireVehicle(VONK, ON);
    expect(r).toEqual({ kind: "owned" });
    expect(url).toBe(BACKEND_VEHICLE_PURCHASE_PATH);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt.tok");
    expect(headers["Idempotency-Key"]).toContain(serverVehicleKeyOf(VONK));
    // The body carries the canonical key and NOTHING else — no price, amount, or ownership claim.
    expect(JSON.parse(init.body as string)).toEqual({
      vehicleKey: serverVehicleKeyOf(VONK),
    });
  });
  it("maps a 402 or 422 to insufficient funds and a 409 to a neutral pending replay", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 402 }));
    expect(await postAcquireVehicle(KAAP, ON)).toEqual({
      kind: "insufficient_funds",
    });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 422 }));
    expect(await postAcquireVehicle(KAAP, ON)).toEqual({
      kind: "insufficient_funds",
    });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 409 }));
    expect(await postAcquireVehicle(KAAP, ON)).toEqual({ kind: "pending" });
  });
  it("maps a thrown/network failure to a transient error", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await postAcquireVehicle(VONK, ON)).toEqual({ kind: "error" });
  });
});

describe("carAcquisition — idempotency key", () => {
  it("is stable per (user, vehicle) so a double-tap can never double-charge", () => {
    expect(acquireIdempotencyKey("u1", VONK)).toBe(
      acquireIdempotencyKey("u1", VONK),
    );
    expect(acquireIdempotencyKey("u1", VONK)).not.toBe(
      acquireIdempotencyKey("u2", VONK),
    );
    expect(acquireIdempotencyKey("u1", VONK)).not.toBe(
      acquireIdempotencyKey("u1", KAAP),
    );
    expect(acquireIdempotencyKey(null, VONK)).toContain("anon");
  });
});
