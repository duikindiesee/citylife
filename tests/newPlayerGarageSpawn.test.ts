import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hasStoredCar,
  saveCar,
  loadCar,
} from "../src/colony/car/garageStore";
import {
  isCanonicalVehicleKey,
  serverVehicleKeyOf,
  vehicleKeyOf,
  safeOwnedKeys,
  loadOwnedKeysCache,
  saveOwnedKeysCache,
  postAcquireVehicle,
  BACKEND_VEHICLE_PURCHASE_PATH,
} from "../src/colony/car/carAcquisition";
import { SHOWROOM_VEHICLES } from "../src/colony/showroom/showroomCatalog";
import { type CarSpec } from "../src/colony/car/carSpec";
import { getAuthClient } from "../src/colony/authClient";

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
  clear(): void {
    this.m.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PLAYER.CAR.1.S5 — garageStore vehicle presence & persistence", () => {
  it("hasStoredCar returns false when no car is saved on profile", () => {
    expect(hasStoredCar("citizen-new")).toBe(false);
    const fallback = loadCar("citizen-new");
    expect(fallback).toBeDefined();
    expect(hasStoredCar("citizen-new")).toBe(false);
  });

  it("hasStoredCar returns true after saveCar persists a valid CarSpec", () => {
    const vonkSpec = SHOWROOM_VEHICLES[0]!.spec;
    saveCar("citizen-new", vonkSpec);
    expect(hasStoredCar("citizen-new")).toBe(true);
    const stored = loadCar("citizen-new");
    expect(stored.id).toBe(vonkSpec.id);
    expect(stored.name).toBe(vonkSpec.name);
  });

  it("ignores corrupted or invalid spec data", () => {
    saveCar("citizen-bad", { id: "" } as unknown as CarSpec);
    expect(hasStoredCar("citizen-bad")).toBe(false);
  });
});

describe("PLAYER.CAR.1.S5 — canonical key handling for server authority", () => {
  it("strips showroom: prefix for server authority endpoint", () => {
    expect(serverVehicleKeyOf("showroom:karoo-vonk-11")).toBe("karoo-vonk-11");
    expect(serverVehicleKeyOf("showroom:karoo-kaap-gt-v8")).toBe("karoo-kaap-gt-v8");
    expect(serverVehicleKeyOf("showroom:karoo-x19-targa")).toBe("karoo-x19-targa");
    expect(serverVehicleKeyOf("karoo-vonk-11")).toBe("karoo-vonk-11");
  });

  it("accepts both client procedural and server canonical keys as canonical", () => {
    for (const v of SHOWROOM_VEHICLES) {
      const clientKey = vehicleKeyOf(v);
      const serverKey = serverVehicleKeyOf(clientKey);
      expect(isCanonicalVehicleKey(clientKey)).toBe(true);
      expect(isCanonicalVehicleKey(serverKey)).toBe(true);
    }
    expect(isCanonicalVehicleKey("unrelated-key")).toBe(false);
  });

  it("safeOwnedKeys screens valid server and client keys", () => {
    const screened = safeOwnedKeys([
      "karoo-vonk-11",
      "showroom:karoo-x19-targa",
      "invalid-model",
    ]);
    expect(screened).toEqual(["karoo-vonk-11", "showroom:karoo-x19-targa"]);
  });
});

describe("PLAYER.CAR.1.S5 — acquisition persistence integration", () => {
  it("purchasing a vehicle posts to authoritative S2 endpoint with server key", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("test-token");
    let capturedUrl = "";
    let capturedBody = "";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return { ok: true, status: 200 };
    });

    const vonk = SHOWROOM_VEHICLES[0]!;
    const outcome = await postAcquireVehicle(vehicleKeyOf(vonk), undefined, {
      bypassGate: true,
    });

    expect(outcome).toEqual({ kind: "owned" });
    expect(capturedUrl).toBe(BACKEND_VEHICLE_PURCHASE_PATH);
    expect(JSON.parse(capturedBody)).toEqual({ vehicleKey: "karoo-vonk-11" });
  });

  it("saves acquired vehicle into garageStore for in-world use", () => {
    const citizenId = "citizen-buyer";
    expect(hasStoredCar(citizenId)).toBe(false);

    const acquired = SHOWROOM_VEHICLES[2]!;
    saveCar(citizenId, acquired.spec);
    saveOwnedKeysCache([vehicleKeyOf(acquired)]);

    expect(hasStoredCar(citizenId)).toBe(true);
    expect(loadOwnedKeysCache()).toContain(vehicleKeyOf(acquired));
    expect(loadCar(citizenId).id).toBe(acquired.spec.id);
  });
});
