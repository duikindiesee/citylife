import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hasStoredCar, saveCar, loadCar } from "../src/colony/car/garageStore";
import {
  isCanonicalVehicleKey,
  serverVehicleKeyOf,
  vehicleKeyOf,
  safeOwnedKeys,
  loadOwnedKeysCache,
  saveOwnedKeysCache,
  clearOwnedKeysCache,
  postAcquireVehicle,
  BACKEND_VEHICLE_PURCHASE_PATH,
  BACKEND_VEHICLE_OFFERS_PATH,
  shouldAutoOpenShowroom,
  fetchOwnedVehicleKeysBackend,
} from "../src/colony/car/carAcquisition";
import { SHOWROOM_VEHICLES } from "../src/colony/showroom/showroomCatalog";
import { type CarSpec } from "../src/colony/car/carSpec";
import { getAuthClient } from "../src/colony/authClient";
import { ColonyRuntime } from "../src/colony/runtime";

vi.mock("../src/colony/render/ShowroomView", () => ({
  ShowroomView: () => null,
}));

import { ShowroomOverlay } from "../src/colony/ui/ShowroomOverlay";

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
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.location;
  delete g.addEventListener;
  delete g.removeEventListener;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setupMountedDOM() {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  class MockHTMLElement {}
  for (const type of [
    "Element",
    "HTMLElement",
    "HTMLCanvasElement",
    "HTMLDivElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLIFrameElement",
    "HTMLAnchorElement",
    "HTMLImageElement",
    "HTMLSpanElement",
    "SVGElement",
  ]) {
    (globalThis as Record<string, unknown>)[type] = class extends (
      MockHTMLElement
    ) {};
  }

  let mockDoc: Record<string, unknown>;
  const createMockNode = (tag: string) => {
    const nodeListeners = new Map<string, Set<(e: unknown) => void>>();
    const node: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      clientWidth: 800,
      clientHeight: 600,
      style: {},
      children: [] as unknown[],
      parentNode: null,
      ownerDocument: mockDoc,
      nodeType: 1,
      getAttribute: (attr: string) =>
        (node[attr] as unknown) ?? (node[`data-${attr}`] as unknown) ?? null,
      setAttribute: (attr: string, val: string) => {
        node[attr] = val;
      },
      removeAttribute: (attr: string) => {
        delete node[attr];
      },
      hasAttribute: (attr: string) => node[attr] != null,
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        if (!nodeListeners.has(evt)) nodeListeners.set(evt, new Set());
        nodeListeners.get(evt)!.add(fn);
      },
      removeEventListener: (evt: string, fn: (e: unknown) => void) => {
        nodeListeners.get(evt)?.delete(fn);
      },
      dispatchEvent: () => {},
      appendChild: (child: Record<string, unknown>) => {
        child.parentNode = node;
        (node.children as unknown[]).push(child);
        return child;
      },
      removeChild: (child: Record<string, unknown>) => {
        const arr = node.children as unknown[];
        const idx = arr.indexOf(child);
        if (idx !== -1) arr.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      insertBefore: (newChild: Record<string, unknown>, refChild: unknown) => {
        const arr = node.children as unknown[];
        const idx = arr.indexOf(refChild);
        if (idx !== -1) arr.splice(idx, 0, newChild);
        else arr.push(newChild);
        newChild.parentNode = node;
        return newChild;
      },
      _listeners: nodeListeners,
    };
    return node;
  };

  mockDoc = {
    nodeType: 9,
    createElement: (tag: string) => createMockNode(tag),
    createElementNS: (_ns: string, tag: string) => createMockNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    body: createMockNode("body"),
  };
  (mockDoc.body as Record<string, unknown>).ownerDocument = mockDoc;

  const g = globalThis as Record<string, unknown>;
  g.addEventListener = vi.fn();
  g.removeEventListener = vi.fn();
  g.location = { search: "", origin: "http://localhost" };
  g.window = globalThis;
  g.document = mockDoc;
}

function findNodeByAttr(
  node: Record<string, unknown>,
  attr: string,
  val: string,
): Record<string, unknown> | null {
  if (
    node.getAttribute &&
    (node.getAttribute as (a: string) => unknown)(attr) === val
  ) {
    return node;
  }
  const children = (node.children as Record<string, unknown>[]) || [];
  for (const child of children) {
    const found = findNodeByAttr(child, attr, val);
    if (found) return found;
  }
  return null;
}

function readNodeText(node: Record<string, unknown>): string {
  if (node.nodeType === 3) return String(node.nodeValue ?? "");
  if (typeof node.textContent === "string") return node.textContent;
  return ((node.children as Record<string, unknown>[]) ?? [])
    .map(readNodeText)
    .join("");
}

function clickNode(node: Record<string, unknown>): void {
  const event = {
    type: "click",
    target: node,
    button: 0,
    bubbles: true,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
  let current: Record<string, unknown> | null = node;
  while (current) {
    const listeners = current._listeners as Map<
      string,
      Set<(e: unknown) => void>
    >;
    listeners?.get("click")?.forEach((fn) => fn(event));
    current = current.parentNode as Record<string, unknown> | null;
  }
}

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
    expect(serverVehicleKeyOf("showroom:karoo-kaap-gt-v8")).toBe(
      "karoo-kaap-gt-v8",
    );
    expect(serverVehicleKeyOf("showroom:karoo-x19-targa")).toBe(
      "karoo-x19-targa",
    );
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

describe("PLAYER.CAR.1.S5 — distinct user ID vs citizen ID persistence via runtime.acquireCar", () => {
  it("persists to resolved citizenId rather than userId, updates parked car mesh, and drives with acquired stats", () => {
    const rt = new ColonyRuntime(4242);
    const citizen = rt.getUiState().citizens.list[0]!;
    const citizenId = citizen.id; // e.g. "citizen_0"
    const userId = "kooker-user-distinct-8888";

    // Operator logs in with distinct userId
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId(userId);

    expect(rt.operatorCitizenId()).toBe(citizenId);
    expect(rt.operatorCitizenId()).not.toBe(userId);

    const setOperatorCarSpy = vi.fn();
    (rt as unknown as { renderer: unknown }).renderer = {
      setOperatorCar: setOperatorCarSpy,
      setRaceState: vi.fn(),
      enterFirstPerson: vi.fn(),
      exitFirstPerson: vi.fn(),
    };

    const acquired = SHOWROOM_VEHICLES[2]!; // Karoo X19 Targa
    expect(rt.hasStoredCar()).toBe(false);

    // Acquire vehicle via identity-bound runtime method
    const ok = rt.acquireCar(acquired.spec, citizenId);
    expect(ok).toBe(true);
    rt.applyVehicleOwnership(userId, [vehicleKeyOf(acquired)]);

    // Assert stored under citizenId, NOT userId
    expect(hasStoredCar(citizenId)).toBe(true);
    expect(hasStoredCar(userId)).toBe(false);
    expect(loadCar(citizenId).id).toBe(acquired.spec.id);
    expect(rt.hasStoredCar()).toBe(true);
    expect(rt.hasStoredCar(citizenId)).toBe(true);

    // Parked car mesh refresh
    expect(setOperatorCarSpy).toHaveBeenCalled();
    const [renderedCar, renderedCell] = setOperatorCarSpy.mock.calls.at(-1)!;
    expect(renderedCar?.id).toBe(acquired.spec.id);
    expect(renderedCell).toBeDefined();

    // UI state reads the acquired car
    expect(rt.getUiState().garage?.carName).toBe(acquired.spec.name);
    expect(rt.getUiState().garage?.stats.topSpeed).toBeCloseTo(
      acquired.spec.stats.topSpeed,
    );

    // Driving loop resolves stats from the acquired car
    const raceStarted = rt.startRace();
    expect(raceStarted).toBe(true);
    expect(rt.sim.state.raceState?.stats.topSpeed).toBeCloseTo(
      acquired.spec.stats.topSpeed,
    );
  });

  it("acquireCar rejects if expectedCitizenId does not match resolved operatorCitizenId", () => {
    const rt = new ColonyRuntime(4242);
    const citizen = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId("user-1");

    const acquired = SHOWROOM_VEHICLES[1]!;
    const ok = rt.acquireCar(acquired.spec, "wrong-citizen-id");
    expect(ok).toBe(false);
    expect(rt.hasStoredCar()).toBe(false);
  });
});

describe("PLAYER.CAR.1.S5 — account-scoped cache isolation", () => {
  it("replaces the wrong cached model and rejects a stale account ownership response", () => {
    const rt = new ColonyRuntime(4242);
    const citizen = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId("owner-a");
    saveCar(citizen.id, SHOWROOM_VEHICLES[0]!.spec);
    const render = vi.fn();
    (rt as unknown as { renderer: unknown }).renderer = {
      setOperatorCar: render,
    };
    rt.applyVehicleOwnership("owner-a", ["karoo-x19-targa"]);
    expect(loadCar(citizen.id).id).toBe(SHOWROOM_VEHICLES[2]!.spec.id);
    expect(render.mock.calls.at(-1)![0].id).toBe(SHOWROOM_VEHICLES[2]!.spec.id);
    rt.applyVehicleOwnership("owner-a", []);
    expect(render).toHaveBeenLastCalledWith(null, null);
    rt.setOperatorUserId("owner-b");
    expect(rt.applyVehicleOwnership("owner-a", ["karoo-x19-targa"])).toBe(
      false,
    );
    expect(render).toHaveBeenLastCalledWith(null, null);
  });

  it("isolates ownership cache between distinct user accounts", () => {
    const userA = "user-alice-101";
    const userB = "user-bob-202";

    saveOwnedKeysCache(["karoo-vonk-11"], userA);
    expect(loadOwnedKeysCache(userA)).toEqual(["karoo-vonk-11"]);
    expect(loadOwnedKeysCache(userB)).toEqual([]);

    clearOwnedKeysCache(userA);
    expect(loadOwnedKeysCache(userA)).toEqual([]);
  });

  it("prevents account A cached ownership from suppressing account B new-player showroom", () => {
    const userA = "user-alice-101";
    const userB = "user-bob-202";

    // Alice has a car cached in her scope
    saveOwnedKeysCache(["karoo-vonk-11"], userA);

    // Bob has no car in garageStore and no cached keys in his scope
    expect(hasStoredCar("citizen-bob")).toBe(false);
    expect(loadOwnedKeysCache(userB).length).toBe(0);
    // User A's cache did not bleed into User B
    expect(loadOwnedKeysCache(userB)).not.toContain("karoo-vonk-11");
  });
});

describe("PLAYER.CAR.1.S5 — ShowroomOverlay cross-account late completion & unmount guards", () => {
  beforeEach(() => {
    setupMountedDOM();
  });

  it.each(["selected", "different", "unavailable", "empty"])(
    "persists only fresh server ownership: %s",
    async (scenario) => {
      const rt = new ColonyRuntime(4242);
      const citizen = rt.getUiState().citizens.list[0]!;
      rt.setOperatorName(citizen.displayName);
      rt.setOperatorUserId("buyer-test");
      const auth = getAuthClient();
      vi.spyOn(auth, "getValidToken").mockResolvedValue("test-jwt");
      (auth as unknown as { session: unknown }).session = {
        token: "test-jwt",
        expiresAt: Date.now() + 100000,
        operator: {
          id: "Buyer",
          userId: "buyer-test",
          scopes: [],
          roles: ["CITYLIFE_PLAYER"],
        },
      };
      const confirmed = SHOWROOM_VEHICLES[scenario === "different" ? 2 : 0]!;
      const purchaseStarted = vi.fn();
      vi.stubGlobal("fetch", async (url: string) => {
        if (url.includes(BACKEND_VEHICLE_OFFERS_PATH)) {
          return {
            ok: true,
            status: 200,
            json: async () => SHOWROOM_VEHICLES.map((entry) => ({
              vehicleKey: serverVehicleKeyOf(vehicleKeyOf(entry)),
              priceKco: entry.plannedPriceK,
              currency: "KCO",
            })),
          };
        }
        if (url.includes("/vehicle/purchase")) {
          purchaseStarted();
          return {
            ok: true,
            status: 200,
            json: async () => ({
              owned: true,
              vehicleKey: serverVehicleKeyOf(vehicleKeyOf(confirmed)),
            }),
          };
        }
        if (!purchaseStarted.mock.calls.length)
          return { ok: true, status: 200, json: async () => [] };
        if (scenario === "unavailable") return { ok: false, status: 503 };
        return {
          ok: true,
          status: 200,
          json: async () =>
            scenario === "empty"
              ? []
              : {
                  owned: true,
                  vehicleKey: serverVehicleKeyOf(vehicleKeyOf(confirmed)),
                },
        };
      });
      const container = (
        globalThis as unknown as {
          document: { createElement: (t: string) => Record<string, unknown> };
        }
      ).document.createElement("div");
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(
          React.createElement(ShowroomOverlay, {
            runtime: rt,
            canAcquire: true,
            onClose: () => {},
          }),
        );
      });
      await act(async () => {
        clickNode(
          findNodeByAttr(container, "data-build-action", "showroom-acquire")!,
        );
      });
      expect(purchaseStarted).toHaveBeenCalledTimes(1);
      if (scenario === "unavailable" || scenario === "empty") {
        expect(hasStoredCar(citizen.id)).toBe(false);
        expect(loadOwnedKeysCache("buyer-test")).toEqual([]);
      } else {
        expect(loadCar(citizen.id).id).toBe(confirmed.spec.id);
        expect(loadOwnedKeysCache("buyer-test")).toEqual([
          serverVehicleKeyOf(vehicleKeyOf(confirmed)),
        ]);
      }
      await act(async () => {
        root?.unmount();
      });
    },
  );

  it("suppresses completion if account switches while acquisition request is in flight", async () => {
    const rt = new ColonyRuntime(4242);
    const citizenA = rt.getUiState().citizens.list[0]!;
    const citizenB = rt.getUiState().citizens.list[1]!;

    const auth = getAuthClient();
    vi.spyOn(auth, "getValidToken").mockResolvedValue("test-jwt");

    // Start as Alice
    (auth as unknown as { session: unknown }).session = {
      token: "test-jwt",
      expiresAt: Date.now() + 100000,
      operator: {
        id: "Alice",
        userId: "user-alice-101",
        scopes: [],
        roles: ["CITYLIFE_PLAYER"],
      },
    };
    rt.setOperatorName(citizenA.displayName);
    rt.setOperatorUserId("user-alice-101");
    expect(rt.operatorCitizenId()).toBe(citizenA.id);

    // Controlled in-flight purchase deferred promise
    let resolvePurchase!: (val: { ok: boolean; status: number }) => void;
    const purchasePromise = new Promise<{ ok: boolean; status: number }>(
      (res) => {
        resolvePurchase = res;
      },
    );

    const purchaseStarted = vi.fn();
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes(BACKEND_VEHICLE_OFFERS_PATH)) {
        return {
          ok: true,
          status: 200,
          json: async () => SHOWROOM_VEHICLES.map((entry) => ({
            vehicleKey: serverVehicleKeyOf(vehicleKeyOf(entry)),
            priceKco: entry.plannedPriceK,
            currency: "KCO",
          })),
        };
      }
      if (
        url.includes("/vehicle/purchase") ||
        url.includes("/car-acquisitions")
      ) {
        purchaseStarted();
        return purchasePromise;
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          purchaseStarted.mock.calls.length
            ? { owned: true, vehicleKey: "karoo-vonk-11" }
            : [],
      };
    });

    const container = (
      globalThis as unknown as {
        document: { createElement: (t: string) => Record<string, unknown> };
      }
    ).document.createElement("div");

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(ShowroomOverlay, {
          runtime: rt,
          canAcquire: true,
          onClose: () => {},
        }),
      );
    });

    // Find and click acquire button as Alice
    const btn = findNodeByAttr(
      container,
      "data-build-action",
      "showroom-acquire",
    );
    expect(btn).not.toBeNull();

    await act(async () => {
      clickNode(btn!);
    });
    expect(purchaseStarted).toHaveBeenCalledTimes(1);

    // While request is in flight, switch session to Bob!
    (auth as unknown as { session: unknown }).session = {
      token: "test-jwt-bob",
      expiresAt: Date.now() + 100000,
      operator: {
        id: "Bob",
        userId: "user-bob-202",
        scopes: [],
        roles: ["CITYLIFE_PLAYER"],
      },
    };
    rt.setOperatorName(citizenB.displayName);
    rt.setOperatorUserId("user-bob-202");
    expect(rt.operatorCitizenId()).toBe(citizenB.id);

    // Now resolve Alice's late response
    await act(async () => {
      resolvePurchase({ ok: true, status: 200 });
    });

    // Guard MUST suppress: Bob's citizenId and Bob's userId must NOT have Alice's car!
    expect(hasStoredCar(citizenB.id)).toBe(false);
    expect(hasStoredCar("user-bob-202")).toBe(false);
    expect(loadOwnedKeysCache("user-bob-202")).toEqual([]);

    await act(async () => {
      root?.unmount();
    });
  });

  it("suppresses completion if component unmounts while request is in flight", async () => {
    const rt = new ColonyRuntime(4242);
    const citizen = rt.getUiState().citizens.list[0]!;

    const auth = getAuthClient();
    vi.spyOn(auth, "getValidToken").mockResolvedValue("test-jwt");
    (auth as unknown as { session: unknown }).session = {
      token: "test-jwt",
      expiresAt: Date.now() + 100000,
      operator: {
        id: "Alice",
        userId: "user-alice-101",
        scopes: [],
        roles: ["CITYLIFE_PLAYER"],
      },
    };
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId("user-alice-101");

    let resolvePurchase!: (val: { ok: boolean; status: number }) => void;
    const purchasePromise = new Promise<{ ok: boolean; status: number }>(
      (res) => {
        resolvePurchase = res;
      },
    );

    const purchaseStarted = vi.fn();
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes(BACKEND_VEHICLE_OFFERS_PATH)) {
        return {
          ok: true,
          status: 200,
          json: async () => SHOWROOM_VEHICLES.map((entry) => ({
            vehicleKey: serverVehicleKeyOf(vehicleKeyOf(entry)),
            priceKco: entry.plannedPriceK,
            currency: "KCO",
          })),
        };
      }
      if (
        url.includes("/vehicle/purchase") ||
        url.includes("/car-acquisitions")
      ) {
        purchaseStarted();
        return purchasePromise;
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          purchaseStarted.mock.calls.length
            ? { owned: true, vehicleKey: "karoo-vonk-11" }
            : [],
      };
    });

    const container = (
      globalThis as unknown as {
        document: { createElement: (t: string) => Record<string, unknown> };
      }
    ).document.createElement("div");

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(ShowroomOverlay, {
          runtime: rt,
          canAcquire: true,
          onClose: () => {},
        }),
      );
    });

    const btn = findNodeByAttr(
      container,
      "data-build-action",
      "showroom-acquire",
    );
    expect(btn).not.toBeNull();

    await act(async () => {
      clickNode(btn!);
    });
    expect(purchaseStarted).toHaveBeenCalledTimes(1);

    // Unmount before response arrives
    await act(async () => {
      root?.unmount();
    });

    // Resolve response after unmount
    await act(async () => {
      resolvePurchase({ ok: true, status: 200 });
    });

    // Stored car must not have been saved
    expect(hasStoredCar(citizen.id)).toBe(false);
  });

  it("renders locked preview button when canAcquire is false", async () => {
    const rt = new ColonyRuntime(4242);
    const container = (
      globalThis as unknown as {
        document: { createElement: (t: string) => Record<string, unknown> };
      }
    ).document.createElement("div");

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(ShowroomOverlay, {
          runtime: rt,
          canAcquire: false,
          onClose: () => {},
        }),
      );
    });

    const previewBtn = findNodeByAttr(
      container,
      "data-build-action",
      "showroom-acquire-preview",
    );
    expect(previewBtn).not.toBeNull();
    expect((previewBtn as any).hasAttribute("disabled")).toBe(true);

    const acquireBtn = findNodeByAttr(
      container,
      "data-build-action",
      "showroom-acquire",
    );
    expect(acquireBtn).toBeNull();
  });

  it("shows the server X19 price and exact shortfall before purchase", async () => {
    const rt = new ColonyRuntime(4242);
    const citizen = rt.getUiState().citizens.list[0]!;
    rt.setOperatorName(citizen.displayName);
    rt.setOperatorUserId("buyer-x19");
    const auth = getAuthClient();
    vi.spyOn(auth, "getValidToken").mockResolvedValue("test-jwt");
    (auth as unknown as { session: unknown }).session = {
      token: "test-jwt",
      expiresAt: Date.now() + 100000,
      operator: {
        id: "Buyer",
        userId: "buyer-x19",
        scopes: [],
        roles: ["CITYLIFE_PLAYER"],
      },
    };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes(BACKEND_VEHICLE_OFFERS_PATH)) {
        return {
          ok: true,
          status: 200,
          json: async () => SHOWROOM_VEHICLES.map((entry) => ({
            vehicleKey: serverVehicleKeyOf(vehicleKeyOf(entry)),
            priceKco: entry.publicName.includes("X19") ? 950 : entry.plannedPriceK,
            currency: "KCO",
          })),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });

    const container = (
      globalThis as unknown as {
        document: { createElement: (t: string) => Record<string, unknown> };
      }
    ).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(React.createElement(ShowroomOverlay, {
        runtime: rt,
        canAcquire: true,
        accountKey: "buyer-x19",
        walletKco: 750,
        onClose: () => {},
      }));
    });
    await act(async () => {
      clickNode(findNodeByAttr(container, "data-build-action", "showroom-next")!);
      clickNode(findNodeByAttr(container, "data-build-action", "showroom-next")!);
    });

    const price = findNodeByAttr(container, "data-testid", "showroom-card-price")!;
    const getAttribute = price.getAttribute as (attr: string) => unknown;
    expect(getAttribute("data-price-source")).toBe("server");
    expect(getAttribute("data-price-kco")).toBe("950");
    const acquire = findNodeByAttr(container, "data-build-action", "showroom-acquire")!;
    const hasAttribute = acquire.hasAttribute as (attr: string) => boolean;
    expect(hasAttribute("disabled")).toBe(true);
    const affordability = findNodeByAttr(container, "data-testid", "showroom-affordability")!;
    const affordabilityAttr = affordability.getAttribute as (attr: string) => unknown;
    expect(affordabilityAttr("data-affordability")).toBe("insufficient");
    expect(readNodeText(affordability)).toContain("Need ₭200 more");
    await act(async () => root?.unmount());
  });
});

describe("PLAYER.CAR.1.S5 — shouldAutoOpenShowroom pure decision rule", () => {
  it("does not turn unknown server-owned vehicles into an empty ownership list", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue(
      "fixture-token",
    );
    for (const response of [
      { owned: true, vehicleKey: "future-vehicle" },
      { ownedVehicleKeys: ["future-vehicle"] },
      ["future-vehicle"],
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => response,
        }),
      );
      expect(await fetchOwnedVehicleKeysBackend()).toBeNull();
    }
  });

  it("fails closed when session token refresh rejects", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockRejectedValue(
      new Error("Refresh unavailable"),
    );
    expect(await fetchOwnedVehicleKeysBackend()).toBeNull();
  });

  const baseValidArgs = {
    hasRealAccount: true,
    isAuthenticated: true,
    newPlayerJourneyEnabled: true,
    hasStoredCarLocally: false,
    ownedKeysInCache: [] as string[],
    backendTruth: [] as string[],
  };

  it("returns true when authenticated player has journey enabled, no local car, and 0 backend owned cars", () => {
    expect(shouldAutoOpenShowroom(baseValidArgs)).toBe(true);
  });

  it("returns false when user does not have a real account (e.g. dev/e2e skip-auth bypass)", () => {
    expect(
      shouldAutoOpenShowroom({
        ...baseValidArgs,
        hasRealAccount: false,
      }),
    ).toBe(false);
  });

  it("returns false when session is unauthenticated", () => {
    expect(
      shouldAutoOpenShowroom({
        ...baseValidArgs,
        isAuthenticated: false,
      }),
    ).toBe(false);
  });

  it("returns false when new player journey is disabled", () => {
    expect(
      shouldAutoOpenShowroom({
        ...baseValidArgs,
        newPlayerJourneyEnabled: false,
      }),
    ).toBe(false);
  });

  it("server-reported no ownership wins over an extra stale local car hint", () => {
    const staleLocalHints = { ...baseValidArgs, hasStoredCarLocally: true };
    expect(shouldAutoOpenShowroom(staleLocalHints)).toBe(true);
  });

  it("server-reported no ownership wins over extra stale cached vehicle keys", () => {
    const staleLocalHints = {
      ...baseValidArgs,
      ownedKeysInCache: ["karoo-vonk-11"],
    };
    expect(shouldAutoOpenShowroom(staleLocalHints)).toBe(true);
  });

  it("returns false when backend truth is null (fails closed on network/endpoint error)", () => {
    expect(
      shouldAutoOpenShowroom({
        ...baseValidArgs,
        backendTruth: null,
      }),
    ).toBe(false);
  });

  it("returns false when backend truth reports an owned car", () => {
    expect(
      shouldAutoOpenShowroom({
        ...baseValidArgs,
        backendTruth: ["karoo-x19-targa"],
      }),
    ).toBe(false);
  });
});
