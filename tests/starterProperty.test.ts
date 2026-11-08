import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
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
  postBuildHome,
  postConfirmArrival,
  type HomeTruth,
} from "../src/colony/home/starterProperty";
import { deriveHomePlacement } from "../src/colony/home/starterHouseProjection";
import {
  homeTargetCell,
  isWithinArrivalBounds,
  arrivalButtonView,
  HOME_DEED_DRIVE_HOME_ARRIVAL_PATH,
  HOME_ARRIVAL_PATH,
} from "../src/colony/home/driveHome";
import { ColonyRuntime } from "../src/colony/runtime";
import { createWorldLayoutDocument, worldLayoutRevisionId } from "../src/colony/spatial/worldLayoutDocument";
import {
  parseStarterPlotOffers,
  bindStarterPlotOffers,
  verifyX19Pricing,
  projectReturningResidentState,
  loadHouseBuild,
  completeHouseBuild,
  type PublishedPlayerInventory,
  type StarterParcelGeometry,
} from "../src/colony/home/starterCatalogueClient";
import { StarterPropertyOverlay } from "../src/colony/ui/StarterPropertyOverlay";
import { DriveHomeOverlay } from "../src/colony/ui/DriveHomeOverlay";
import { getAuthClient } from "../src/colony/authClient";
import { saveBlueprintLocal, clearBlueprintsLocal } from "../src/colony/bot/blueprintStore";
import { resolveOwnedCar } from "../src/colony/car/ownedCar";

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

function setupTestDOM() {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class MockHTMLElement {}
  class MockHTMLIFrameElement extends MockHTMLElement {}
  for (const tag of [
    "Element",
    "HTMLElement",
    "HTMLDivElement",
    "HTMLButtonElement",
    "HTMLSpanElement",
    "HTMLTextAreaElement",
    "SVGElement",
  ]) {
    (globalThis as Record<string, unknown>)[tag] = class extends MockHTMLElement {};
  }
  (globalThis as any).HTMLIFrameElement = MockHTMLIFrameElement;

  let mockDoc: Record<string, unknown>;
  const createMockNode = (tag: string) => {
    const nodeListeners = new Map<string, Set<(e: unknown) => void>>();
    const propsStore: Record<string, any> = {};
    const baseNode: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      style: {},
      children: [] as unknown[],
      parentNode: null,
      ownerDocument: mockDoc,
      nodeType: 1,
      getAttribute: (attr: string) => (baseNode[attr] as unknown) ?? null,
      setAttribute: (attr: string, val: any) => {
        baseNode[attr] = val;
        propsStore[attr] = val;
      },
      removeAttribute: (attr: string) => {
        delete baseNode[attr];
        delete propsStore[attr];
      },
      hasAttribute: (attr: string) => baseNode[attr] != null,
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        if (!nodeListeners.has(evt)) nodeListeners.set(evt, new Set());
        nodeListeners.get(evt)!.add(fn);
      },
      removeEventListener: (evt: string, fn: (e: unknown) => void) => {
        nodeListeners.get(evt)?.delete(fn);
      },
      appendChild: (child: Record<string, unknown>) => {
        child.parentNode = baseNode;
        (baseNode.children as unknown[]).push(child);
        return child;
      },
      removeChild: (child: Record<string, unknown>) => {
        const arr = baseNode.children as unknown[];
        const idx = arr.indexOf(child);
        if (idx !== -1) arr.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      insertBefore: (newChild: Record<string, unknown>, refChild: unknown) => {
        const arr = baseNode.children as unknown[];
        const idx = arr.indexOf(refChild);
        if (idx !== -1) arr.splice(idx, 0, newChild);
        else arr.push(newChild);
        newChild.parentNode = baseNode;
        return newChild;
      },
      _nodeListeners: nodeListeners,
      _propsStore: propsStore,
    };
    return new Proxy(baseNode, {
      get(target, prop, receiver) {
        if (prop === "disabled") {
          if (propsStore.disabled === false || baseNode.disabled === false) return false;
          return propsStore.disabled === true || propsStore.disabled === "" || Boolean(baseNode.disabled);
        }
        if (prop in target) return Reflect.get(target, prop, receiver);
        return propsStore[prop as string];
      },
      set(target, prop, value, receiver) {
        if (prop in target) return Reflect.set(target, prop, value, receiver);
        propsStore[prop as string] = value;
        return true;
      },
    });
  };

  mockDoc = {
    nodeType: 9,
    createElement: (tag: string) => createMockNode(tag),
    createElementNS: (_ns: string, tag: string) => createMockNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: createMockNode("body"),
    defaultView: globalThis,
    HTMLIFrameElement: MockHTMLIFrameElement,
    activeElement: null,
  };
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.HTMLIFrameElement = MockHTMLIFrameElement;
  (globalThis as any).location = { search: "", origin: "http://localhost" };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.dispatchEvent = () => {};
  g.document = mockDoc;
  g.localStorage = new MemStorage();
}

const findNode = (node: any, predicate: (n: any) => boolean): any => {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
};

const triggerNodeClick = (node: any) => {
  if (!node) return;
  if (node.disabled) return;
  const store = node._propsStore || node;
  for (const k of Object.keys(store)) {
    if (k.startsWith("__reactProps$") && store[k]?.onClick) {
      store[k].onClick({ preventDefault() {}, stopPropagation() {} });
      return;
    }
  }
  if (typeof store.onClick === "function") {
    store.onClick({ preventDefault() {}, stopPropagation() {} });
    return;
  }
  if (typeof node.click === "function") {
    node.click();
  }
};

// PLAYER.HOME.1C — the pure model for the dark starter-property slice. Everything here is node-testable
// with no DOM and no network: the dark gate, the SERVER-RETURNED-ONLY eligible-list sanitiser, the
// authoritative home-truth parser, the closed-set purchase classifier, and the local refusals that keep
// a tampered/stale key off the wire.

describe("eligible-list sanitiser (SERVER-RETURNED ONLY)", () => {
  it("coerces a well-formed entry and keeps only a server-quoted price", () => {
    expect(
      coerceEligibleNeighbourhood({
        key: "coastal",
        name: "Coastal",
        priceKco: 350,
      }),
    ).toEqual({ key: "coastal", name: "Coastal", priceKco: 350 });
    // no price quoted → null, never a client-invented number
    expect(coerceEligibleNeighbourhood({ key: "vale2" })).toEqual({
      key: "vale2",
      name: "vale2",
      priceKco: null,
    });
    // accepts a `price` alias too
    expect(
      coerceEligibleNeighbourhood({ key: "k", price: 12.5 })?.priceKco,
    ).toBe(12.5);
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
    expect(isHomeOwned(parseHomeTruth({ owned: "true" as unknown }))).toBe(
      false,
    );
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
    expect(purchaseButtonView(true, true, false, undefined).disabled).toBe(
      true,
    );
    expect(purchaseButtonView(true, true, false, undefined).state).toBe(
      "owned",
    );
    expect(purchaseButtonView(false, true, true, undefined).state).toBe(
      "pending",
    );
    expect(purchaseButtonView(false, true, true, undefined).disabled).toBe(
      true,
    );
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
  it("accepts PurchaseHomeOptions with plotId and layoutRevision", async () => {
    await expect(
      postPurchaseHome(
        {
          neighbourhoodKey: "unoffered",
          plotId: "plot-42",
          layoutRevision: "a".repeat(64),
        },
        ["coastal"],
      ),
    ).resolves.toEqual({ kind: "disabled" });
  });
});

describe("published HomeTruth parsing & required-read fail-closed validations", () => {
  it("parses full published geometry, build state, arrival, and owned-vehicle projection", () => {
    const raw = {
      owned: true,
      status: "RESIDENT",
      neighbourhoodKey: "wood1",
      plotId: "wood1_lot_1",
      frameId: "frame-wood1",
      onboardingState: "OWNED",
      priceKco: 450,
      layoutRevision: "b".repeat(64),
      x: 32,
      y: 48,
      geometry: {
        plotId: "wood1_lot_1",
        worldId: "seed-4242",
        layoutRevision: "b".repeat(64),
        neighbourhoodKey: "wood1",
        parcel: { x: 30, y: 46, width: 8, depth: 8 },
        houseZone: { x: 32, y: 48, width: 6, depth: 6 },
        door: { x: 35, y: 48 },
        driveway: [
          { x: 35, y: 44 },
          { x: 35, y: 45 },
          { x: 35, y: 46 },
          { x: 35, y: 47 },
        ],
        spawn: { x: 35, y: 46 },
      },
      buildState: "COMPLETED",
      completed: true,
      script: 'house{w:6 d:6 wallH:2 door:s} room{kind:living x:0 y:0 w:6 d:6 win:1}',
      arrivalStatus: "RESIDENT",
      isResident: true,
      vehicleId: "car-x19-owned-1",
      vehicleModel: "showroom:karoo-x19-targa",
      vehiclePose: { x: 35, y: 46, heading: 1.57 },
    };

    const truth = parseHomeTruth(raw);
    expect(truth).not.toBeNull();
    expect(truth!.owned).toBe(true);
    expect(isHomeOwned(truth)).toBe(true);
    expect(truth!.isResident).toBe(true);
    expect(truth!.completed).toBe(true);
    expect(truth!.x).toBe(32);
    expect(truth!.y).toBe(48);
    expect(truth!.geometry?.driveway).toHaveLength(4);
    expect(truth!.geometry?.door).toEqual({ x: 35, y: 48 });
    expect(truth!.vehicleId).toBe("car-x19-owned-1");
    expect(truth!.vehiclePose?.x).toBe(35);
  });

  it("required-read failure: malformed geometry or non-finite coordinates fail closed", () => {
    // Non-finite x coordinate drops x to null
    const badCoords = parseHomeTruth({
      owned: true,
      status: "OWNED",
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
    });
    expect(badCoords!.x).toBeNull();
    expect(badCoords!.y).toBeNull();

    // Contradictory status makes isHomeOwned false
    const contradictory = parseHomeTruth({
      owned: true,
      status: "REJECTED_INSUFFICIENT_FUNDS",
    });
    expect(isHomeOwned(contradictory)).toBe(false);

    // Unowned body returns owned: false
    const unowned = parseHomeTruth({ owned: false });
    expect(isHomeOwned(unowned)).toBe(false);
  });
});

describe("published coordinate adoption in deriveHomePlacement and homeTargetCell", () => {
  it("adopts published server-owned coordinates over deed hashing", () => {
    const publishedTruth: HomeTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_lot_1",
      frameId: "frame-1",
      onboardingState: "OWNED",
      priceKco: 300,
      x: 42,
      y: 55,
    };
    expect(deriveHomePlacement(publishedTruth)).toEqual({ x: 42, y: 55 });
    expect(homeTargetCell(publishedTruth)).toEqual({ x: 42, y: 55 });
  });

  it("adopts published geometry door or houseZone when x/y not direct", () => {
    const geomTruth: HomeTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_lot_1",
      frameId: "frame-1",
      onboardingState: "OWNED",
      priceKco: 300,
      geometry: {
        door: { x: 23, y: 34 },
      },
    };
    expect(deriveHomePlacement(geomTruth)).toEqual({ x: 23, y: 34 });
    expect(homeTargetCell(geomTruth)).toEqual({ x: 23, y: 34 });
  });

  it("falls back to deterministic deed hashing when published coordinates absent", () => {
    const legacyTruth: HomeTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "coastal",
      plotId: "plot-legacy",
      frameId: "frame-legacy",
      onboardingState: "OWNED",
      priceKco: 300,
    };
    const placement = deriveHomePlacement(legacyTruth);
    expect(placement.x).toBeGreaterThanOrEqual(0);
    expect(placement.x).toBeLessThan(64);
    expect(placement.y).toBeGreaterThanOrEqual(0);
    expect(placement.y).toBeLessThan(64);
    expect(homeTargetCell(legacyTruth)).toEqual(placement);
  });
});

describe("ColonyRuntime published driveway & home target resolution", () => {
  it("getPlayerHomeDriveway and getOperatorHomeTarget resolve published coordinates and driveway", () => {
    const runtime = new ColonyRuntime(42);
    expect(runtime.hasOperatorHome()).toBe(false);

    const publishedTruth: HomeTruth = {
      owned: true,
      status: "RESIDENT",
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_9",
      frameId: "frame-wood1",
      onboardingState: "OWNED",
      priceKco: 450,
      x: 18,
      y: 22,
      geometry: {
        plotId: "wood1_plot_9",
        driveway: [
          { x: 18, y: 20 },
          { x: 18, y: 21 },
          { x: 18, y: 22 },
        ],
        door: { x: 18, y: 22 },
      },
    };

    runtime.setAuthoritativeHomeTruth(publishedTruth);
    expect(runtime.hasOperatorHome()).toBe(true);

    const driveway = runtime.getPlayerHomeDriveway();
    expect(driveway).not.toBeNull();
    expect(driveway!.plotId).toBe("wood1_plot_9");
    expect(driveway!.cells).toEqual([
      { x: 18, y: 20 },
      { x: 18, y: 21 },
      { x: 18, y: 22 },
    ]);
    expect(driveway!.gate).toEqual({ x: 18, y: 22 });

    const target = runtime.getOperatorHomeTarget();
    expect(target).not.toBeNull();
    expect(target!.x).toBe(18);
    expect(target!.y).toBe(22);
    expect(target!.lotId).toBe("wood1_plot_9");
  });
});

describe("Starter catalogue client & returning resident projection", () => {
  it("parses starter plot offers and rejects invalid/out-of-bounds prices or dimensions", () => {
    const valid = [
      {
        plotId: "plot-1",
        frameId: "frame-1",
        priceKco: 500,
        geometry: {
          worldId: "seed-4242",
          plotId: "plot-1",
          neighbourhoodKey: "wood1",
          layoutRevision: "c".repeat(64),
          parcel: { width: 8, depth: 8 },
        },
      },
    ];
    const parsed = parseStarterPlotOffers(valid);
    expect(parsed).toHaveLength(1);
    expect(parsed![0].plotId).toBe("plot-1");
    expect(parsed![0].priceKco).toBe(500);

    // Non-finite price or invalid revision
    expect(
      parseStarterPlotOffers([
        { ...valid[0], priceKco: -10 },
      ]),
    ).toBeNull();
    expect(
      parseStarterPlotOffers([
        { ...valid[0], geometry: { ...valid[0].geometry, layoutRevision: "not-a-hash" } },
      ]),
    ).toBeNull();
  });

  it("verifies authoritative server X19 pricing", () => {
    expect(verifyX19Pricing(null)).toEqual({ valid: false, priceKco: null });
    expect(verifyX19Pricing({ "karoo-vonk-11": 250 })).toEqual({
      valid: false,
      priceKco: null,
    });
    expect(
      verifyX19Pricing({ "karoo-x19-targa": 950, "karoo-vonk-11": 250 }),
    ).toEqual({ valid: true, priceKco: 950 });
  });

  it("projects returning resident home and exact owned vehicle on reload", () => {
    const unowned = projectReturningResidentState(null);
    expect(unowned.isResident).toBe(false);
    expect(unowned.homeCell).toBeNull();
    expect(unowned.vehicle).toBeNull();

    const residentTruth: HomeTruth = {
      owned: true,
      status: "RESIDENT",
      neighbourhoodKey: "wood1",
      plotId: "wood1_lot_1",
      frameId: "frame-wood1",
      onboardingState: "OWNED",
      priceKco: 450,
      x: 32,
      y: 48,
      isResident: true,
      vehicleId: "car-x19-res-1",
      vehicleModel: "showroom:karoo-x19-targa",
      vehiclePose: { x: 35, y: 46, heading: 0 },
    };

    const proj = projectReturningResidentState(residentTruth);
    expect(proj.isResident).toBe(true);
    expect(proj.homeCell).toEqual({ x: 32, y: 48 });
    expect(proj.vehicle).not.toBeNull();
    expect(proj.vehicle!.id).toBe("car-x19-res-1");
    expect(proj.vehicle!.model).toBe("showroom:karoo-x19-targa");
    expect(proj.vehicle!.x).toBe(35);
    expect(proj.vehicle!.y).toBe(46);
  });
  it("does not infer residency from completed build alone, and does not synthesize fake vehicle defaults", () => {
    // 1. Completed build without explicit server truth RESIDENT
    const completedBuildUnconfirmedResident: HomeTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_lot_1",
      frameId: "frame-wood1",
      onboardingState: "OWNED",
      priceKco: 450,
      x: 32,
      y: 48,
      completed: true,
      buildState: "COMPLETED",
    };

    const proj1 = projectReturningResidentState(completedBuildUnconfirmedResident);
    expect(proj1.isResident).toBe(false); // Residency must NOT be inferred from completed build alone!

    // 2. Missing vehicleId or missing vehicleModel must NOT synthesize defaults
    const missingVehicleModel: HomeTruth = {
      ...completedBuildUnconfirmedResident,
      status: "RESIDENT",
      isResident: true,
      vehicleId: "my-car-1",
    };
    const proj2 = projectReturningResidentState(missingVehicleModel);
    expect(proj2.isResident).toBe(true);
    expect(proj2.vehicle).toBeNull(); // Do NOT synthesize fake default vehicle model!

    const missingVehicleId: HomeTruth = {
      ...completedBuildUnconfirmedResident,
      status: "RESIDENT",
      isResident: true,
      vehicleModel: "showroom:karoo-x19-targa",
    };
    const proj3 = projectReturningResidentState(missingVehicleId);
    expect(proj3.vehicle).toBeNull(); // Do NOT synthesize fake default vehicle id!
  });

  it("handles purchase options with server-bound plotId and layoutRevision", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        if (url === "/kooker/api/v1/citylife/players/me/home/purchase") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ owned: true }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }) as typeof fetch;

      const result = await postPurchaseHome(
        {
          neighbourhoodKey: "wood1",
          plotId: "plot-alpha",
          layoutRevision: "a".repeat(64),
        },
        ["wood1"],
      );

      // In tests without active auth token, postPurchaseHome fails closed to disabled
      expect(result.kind).toBe("disabled");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("handles malformed/missing required reads and bodies, stale identity, and physical arrival negatives", async () => {
    // 1. postBuildHome with missing plotId/script fails closed
    const buildRes = await postBuildHome({
      plotId: "",
      layoutRevision: "",
      script: "",
    });
    expect(buildRes.kind).toBe("disabled");

    // 2. postConfirmArrival fails closed when signed out
    const arrivalRes = await postConfirmArrival({
      plotId: "plot-1",
      layoutRevision: "rev-1",
    });
    expect(arrivalRes.kind).toBe("disabled");
  });

  it("P1: adopts initialWorldLayout before resident/blueprint restore, and fails closed on invalid layout", () => {
    // 1. Seed saved blueprint locally before runtime constructor runs
    (globalThis as any).localStorage = new MemStorage();
    const testScript =
      "house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}";
    saveBlueprintLocal("lot_3", "citizen_joe", testScript);

    // Valid layout adoption with clean document from survey
    const baseRuntime = new ColonyRuntime(1234, { surveyOnly: true });
    const captured = baseRuntime.captureWorldLayout();
    const validDoc = createWorldLayoutDocument({
      ...captured,
      placements: [],
    });
    // Normal player runtime without surveyOnly: proves layout adoption before resident and blueprint restoration
    const runtime = new ColonyRuntime(1234, { initialWorldLayout: validDoc });
    expect(runtime.getActiveLayoutRevisionId()).toBe(worldLayoutRevisionId(validDoc.revision));
    expect(runtime.lots().length).toBeGreaterThan(0);
    expect(runtime.lots()[0]!.built).toBe(true);
    expect((runtime as any).citizens.byId("citizen_joe")).toBeDefined();

    // Verify blueprint was restored on lot_3
    const lot3 = runtime.lots().find((l) => l.id === "lot_3");
    if (lot3) {
      expect(lot3.blueprint).toBe(testScript);
    }

    // 2. Corrupt / invalid layout throws fail-closed inside hydrateWorldLayout before restoreColony/restoreBlueprints
    expect(() => {
      new ColonyRuntime(1234, { initialWorldLayout: { invalid: true } as any });
    }).toThrow();
  }, 60_000);

  it("P2: exercises player-owned house builder session and submission with server confirmation", async () => {
    // 1. Without signed in operator, loadHouseBuild rejects fail-closed
    await expect(loadHouseBuild()).rejects.toThrow(/Sign in to CityLife/);

    // 2. postBuildHome fails closed cleanly without active operator session
    const confirm = await postBuildHome({
      plotId: "plot-alpha-1",
      layoutRevision: "rev-alpha",
      script: "wall(0, 0, 4, 0); door(2, 0);",
    });
    expect(confirm.kind).toBe("disabled");

    // 3. Paid-plot player (PLOT_OWNED) retains plotOwned and requiresBuild
    const paidPlotTruth = parseHomeTruth({
      owned: false,
      status: "PLOT_OWNED",
      plotOwned: true,
      requiresBuild: true,
      plotId: "plot-alpha-1",
      frameId: "frame-alpha-1",
      neighbourhoodKey: "coastal",
    });
    expect(paidPlotTruth).not.toBeNull();
    expect(paidPlotTruth!.plotOwned).toBe(true);
    expect(paidPlotTruth!.requiresBuild).toBe(true);
    expect(paidPlotTruth!.owned).toBe(false);
    expect(isHomeOwned(paidPlotTruth)).toBe(false);
  });

  it("P3: returning resident residency authority, atomic pose validation, and genuine CarSpec resolution", () => {
    // 1. Onboarding state RESIDENT recognized as resident
    const residentTruth = parseHomeTruth({
      owned: true,
      status: "OWNED",
      onboardingState: "RESIDENT",
      plotId: "plot-1",
      frameId: "frame-1",
      neighbourhoodKey: "coastal",
      geometry: {
        spawn: { x: 10, y: 20 },
      },
      vehicleId: "karoo-x19-targa",
      vehicleModel: "karoo-x19-targa",
      vehiclePose: { x: 50, y: 60, heading: 1.57 },
    });
    const proj = projectReturningResidentState(residentTruth);
    expect(proj.isResident).toBe(true);
    expect(proj.vehicle).toEqual({
      id: "karoo-x19-targa",
      model: "karoo-x19-targa",
      x: 50,
      y: 60,
      heading: 1.57,
    });

    // 2. Appendix F atomic whole-pose validation: malformed x rejects atomically with null
    const malformedXTruth = parseHomeTruth({
      owned: true,
      status: "RESIDENT",
      plotId: "plot-1",
      geometry: { spawn: { x: 10, y: 20 } },
      vehicleId: "karoo-x19-targa",
      vehicleModel: "karoo-x19-targa",
      vehiclePose: { x: NaN, y: 800, heading: 0 },
    });
    const malformedXProj = projectReturningResidentState(malformedXTruth);
    expect(malformedXProj.isResident).toBe(true);
    expect(malformedXProj.vehicle).toBeNull(); // Never mixes fallback spawn x: 10 with y: 800!

    // 3. Malformed y rejects atomically with null
    const malformedYTruth = parseHomeTruth({
      owned: true,
      status: "RESIDENT",
      plotId: "plot-1",
      geometry: { spawn: { x: 10, y: 20 } },
      vehicleId: "karoo-x19-targa",
      vehicleModel: "karoo-x19-targa",
      vehiclePose: { x: 50, y: Infinity, heading: 0 },
    });
    expect(projectReturningResidentState(malformedYTruth).vehicle).toBeNull();

    // 4. Malformed heading rejects atomically with null
    const malformedHeadingTruth = parseHomeTruth({
      owned: true,
      status: "RESIDENT",
      plotId: "plot-1",
      geometry: { spawn: { x: 10, y: 20 } },
      vehicleId: "karoo-x19-targa",
      vehicleModel: "karoo-x19-targa",
      vehiclePose: { x: 50, y: 60, heading: NaN },
    });
    expect(projectReturningResidentState(malformedHeadingTruth).vehicle).toBeNull();

    // 5. Absent vehiclePose adopts whole authorized spawn
    const absentPoseTruth = parseHomeTruth({
      owned: true,
      status: "RESIDENT",
      plotId: "plot-1",
      geometry: { spawn: { x: 10, y: 20 } },
      vehicleId: "karoo-x19-targa",
      vehicleModel: "karoo-x19-targa",
    });
    const absentProj = projectReturningResidentState(absentPoseTruth);
    expect(absentProj.vehicle).toEqual({
      id: "karoo-x19-targa",
      model: "karoo-x19-targa",
      x: 10,
      y: 20,
      heading: 0,
    });

    // 6. Genuine CarSpec resolution in ColonyRuntime (no partial cast)
    const runtime = new ColonyRuntime(1234, { surveyOnly: true });
    runtime.setOperatorUserId("user-bob");
    runtime.setAuthoritativeOwnedVehicle({
      id: "karoo-x19-targa",
      model: "karoo-x19-targa",
      x: 25,
      y: 35,
      heading: 1.57,
    });
    expect(runtime.getAuthoritativeCar()).not.toBeNull();
    expect(runtime.getAuthoritativeCar()?.id).toBe("showroom:karoo-x19-targa");
    expect(runtime.getPhysicalCarPosition()).toEqual({ x: 25, y: 35 });
    expect(runtime.getParkedCarPose()).toEqual({ x: 25, y: 35, heading: 1.57 });
  });

  it("P4: discriminating negative: physical vehicle authority governs arrival eligibility", () => {
    const home = { x: 32, y: 48 };
    const cursorAtHome = { x: 32, y: 48 };
    const vehicleAtDealership = { x: 10, y: 10 };

    const cursorWithinBounds = isWithinArrivalBounds(cursorAtHome, home);
    const physicalWithinBounds = isWithinArrivalBounds(vehicleAtDealership, home);

    expect(cursorWithinBounds).toBe(true);
    expect(physicalWithinBounds).toBe(false);

    // Negative: vehicle away at dealership must disable arrival even if cursor is at home
    const buttonViewAway = arrivalButtonView(false, physicalWithinBounds, false, undefined);
    expect(buttonViewAway.disabled).toBe(true);
    expect(buttonViewAway.label).toBe("Drive to your home plot");

    // Positive: physical car at home must enable arrival even if cursor is away
    const vehicleAtHome = { x: 32, y: 48 };
    const physicalArrived = isWithinArrivalBounds(vehicleAtHome, home);
    expect(physicalArrived).toBe(true);

    const buttonViewArrived = arrivalButtonView(false, physicalArrived, false, undefined);
    expect(buttonViewArrived.disabled).toBe(false);
    expect(buttonViewArrived.label).toBe("Pull into your home");
  });

  it("P2/P4-C3: mounts StarterPropertyOverlay with paid-plot provider DTO, exercises single build mutation with confirmation, and validates negative controls", async () => {
    setupTestDOM();
    const auth = getAuthClient();
    let currentAuthUser = "user-alice";
    vi.spyOn(auth, "operator", "get").mockImplementation(() => ({
      id: "Alice",
      userId: currentAuthUser,
      scopes: [],
      roles: [],
    }));
    vi.spyOn(auth, "isAuthenticated", "get").mockReturnValue(true);
    vi.spyOn(auth, "getValidToken").mockResolvedValue("jwt.tok");

    const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const layout = createWorldLayoutDocument({
      worldId: "seed-4242",
      seed: 4242,
      revision: { number: 1, parentHash: "a".repeat(64) },
      frames: [
        { id: "surface", address: "spatial://citylife/surface", kind: "region", layer: "surface", transform },
        { id: "frame-coast4-1", address: "spatial://citylife/surface/region/parcel", kind: "region", layer: "surface", parentId: "surface", transform },
      ],
      placements: [],
      roads: [],
      ways: [],
      terrainEdits: [],
      portals: [],
    });

    const plotGeometry: StarterParcelGeometry = {
      plotId: "coast4_1",
      worldId: "seed-4242",
      layoutRevision: layout.revision.contentHash,
      neighbourhoodKey: "coast4",
      parcel: { x: 10, y: 10, width: 10, depth: 10 },
      houseZone: { x: 12, y: 12, width: 6, depth: 5 },
      driveway: [{ x: 15, y: 18 }, { x: 15, y: 17 }],
      roadCells: [{ x: 15, y: 19 }],
      spawn: { x: 10, y: 20 },
    };

    const validScript =
      "house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}";

    const catalogueManifest = {
      published: true,
      manifest: {
        schemaVersion: "citylife.starter-parcel-manifest/v1",
        worldId: "seed-4242",
        layoutRevision: layout.revision.contentHash,
        sourceLayoutRevision: "a".repeat(64),
        layout,
        plots: [
          {
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            geometry: plotGeometry,
          },
        ],
      },
    };

    let buildPostCount = 0;
    let buildPostPayload: any = null;
    let buildGetCount = 0;
    let homeTruthGetCount = 0;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.includes("/neighbourhoods/eligible")) {
        return new Response(JSON.stringify({ neighbourhoods: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifest), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.endsWith("/home/build")) {
        if (method === "POST") {
          buildPostCount++;
          buildPostPayload = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              layoutRevision: layout.revision.contentHash,
              geometry: plotGeometry,
              completed: true,
              script: validScript,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        buildGetCount++;
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
            completed: buildPostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/players/me/home")) {
        homeTruthGetCount++;
        if (buildPostCount > 0) {
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              onboardingState: "RESIDENT",
              plotId: "coast4_1",
              neighbourhoodKey: "coast4",
              frameId: "frame-coast4-1",
              layoutRevision: layout.revision.contentHash,
              geometry: plotGeometry,
              completed: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            owned: false,
            status: "PLOT_OWNED",
            plotOwned: true,
            requiresBuild: true,
            plotId: "coast4_1",
            neighbourhoodKey: "coast4",
            frameId: "frame-coast4-1",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
            completed: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("{}", { status: 200 });
    });

    const mockRuntime: any = {
      getOperatorUserId: () => "user-alice",
      claimStarterHome: vi.fn().mockReturnValue(true),
      applyBlueprint: vi.fn().mockReturnValue(true),
    };
    const onHomePurchased = vi.fn();

    const container = (globalThis as any).document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: mockRuntime,
          onHomePurchased,
        }),
      );
    });

    // 1. Verifies [data-testid="plot-secured-card"] and [data-testid="home-build-start-btn"] ("🔨 Build Your House") render
    const plotCard = findNode(container, (n) => n.getAttribute?.("data-testid") === "plot-secured-card");
    expect(plotCard, "plot-secured-card must render for PLOT_OWNED player").not.toBeNull();

    const startBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBtn, "home-build-start-btn must render").not.toBeNull();
    const startBtnText = startBtn.children?.[0]?.nodeValue || startBtn.nodeValue || startBtn.textContent || "";
    expect(startBtnText).toContain("🔨 Build Your House");

    // 2. Click home-build-start-btn -> opens [data-testid="home-builder-panel"]
    await act(async () => {
      triggerNodeClick(startBtn);
    });

    const builderPanel = findNode(container, (n) => n.getAttribute?.("data-testid") === "home-builder-panel");
    expect(builderPanel, "home-builder-panel must open on build start").not.toBeNull();

    const submitBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBtn, "home-builder-submit must render inside builder panel").not.toBeNull();

    // 3. Submits blueprint via home-builder-submit -> verifies exactly 1 POST mutation
    await act(async () => {
      triggerNodeClick(submitBtn);
    });

    expect(buildPostCount, "Exactly 1 POST mutation to /players/me/home/build must occur").toBe(1);
    expect(buildPostPayload).toEqual({
      plotId: "coast4_1",
      layoutRevision: layout.revision.contentHash,
      script: validScript,
    });
    expect(buildGetCount, "GET /players/me/home/build confirmation must be executed").toBeGreaterThanOrEqual(1);
    expect(homeTruthGetCount, "GET /players/me/home must refresh residency truth").toBeGreaterThanOrEqual(2);
    expect(mockRuntime.claimStarterHome).toHaveBeenCalled();
    expect(mockRuntime.applyBlueprint).toHaveBeenCalledWith("coast4_1", validScript);
    expect(onHomePurchased).toHaveBeenCalled();

    // 4. Negative controls
    // Negative 4a: Unpaid user does not render plot-secured-card or build button
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/neighbourhoods/eligible")) {
        return new Response(JSON.stringify({ neighbourhoods: [] }), { status: 200 });
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(JSON.stringify({ owned: false, status: null }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const unpaidContainer = (globalThis as any).document.createElement("div");
    const unpaidRoot = createRoot(unpaidContainer);
    await act(async () => {
      unpaidRoot.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: mockRuntime,
        }),
      );
    });
    expect(findNode(unpaidContainer, (n) => n.getAttribute?.("data-testid") === "plot-secured-card")).toBeNull();
    expect(findNode(unpaidContainer, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn")).toBeNull();

    // Negative 4b: Account-switch during build rejects fail-closed
    const switchingRuntime: any = {
      currentUserId: "user-alice",
      getOperatorUserId() { return this.currentUserId; },
    };
    const switchContainer = (globalThis as any).document.createElement("div");
    const switchRoot = createRoot(switchContainer);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        switchingRuntime.currentUserId = "user-mallory";
        currentAuthUser = "user-mallory";
        return new Response(JSON.stringify(catalogueManifest), { status: 200 });
      }
      if (url.endsWith("/home/build")) {
        return new Response(JSON.stringify({ plotId: "coast4_1", frameId: "frame-coast4-1", layoutRevision: layout.revision.contentHash, geometry: plotGeometry, completed: false, script: null }), { status: 200 });
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(JSON.stringify({ owned: false, status: "PLOT_OWNED", plotOwned: true, requiresBuild: true, plotId: "coast4_1", frameId: "frame-coast4-1", neighbourhoodKey: "coast4", layoutRevision: layout.revision.contentHash, geometry: plotGeometry }), { status: 200 });
      }
      return new Response(JSON.stringify({ neighbourhoods: [] }), { status: 200 });
    });

    switchingRuntime.currentUserId = "user-alice";
    currentAuthUser = "user-alice";
    await act(async () => {
      switchRoot.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: switchingRuntime,
        }),
      );
    });

    const switchStartBtn = findNode(switchContainer, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(switchStartBtn).not.toBeNull();
    await act(async () => {
      triggerNodeClick(switchStartBtn);
    });
    const errorNode = findNode(switchContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(errorNode, "Error message must be displayed on account switch").not.toBeNull();

    vi.unstubAllGlobals();
  });

  it("P3-C1 & P3-C2: exercises real HomeTruthResponse DTO, async completion ordering convergence, pre-resident/no-home car retention, and account switch fencing", () => {
    // 1. Real provider HomeTruthResponse DTO (no inline vehicleId/vehicleModel/vehiclePose) + ownedVehicleKeys
    const realProviderTruth = parseHomeTruth({
      owned: true,
      status: "OWNED",
      onboardingState: "RESIDENT",
      neighbourhoodKey: "coast4",
      plotId: "plot-1",
      frameId: "frame-1",
      priceKco: 350,
      layoutRevision: "rev-1",
      geometry: {
        spawn: { x: 14, y: 28 },
      },
    });
    expect(realProviderTruth).not.toBeNull();
    expect((realProviderTruth as any).vehicleId).toBeNull();

    // With ownedVehicleKeys: resolves vehicle identity from resolveOwnedCar and parks at geometry.spawn
    const residentProj = projectReturningResidentState(realProviderTruth, undefined, ["karoo-x19-targa"]);
    expect(residentProj.isResident).toBe(true);
    expect(residentProj.vehicle).toEqual({
      id: "showroom:karoo-x19-targa",
      model: "showroom:karoo-x19-targa",
      x: 14,
      y: 28,
      heading: 0,
    });

    // 2. Async order 1: fetchOwnedVehicleKeysBackend resolves first, fetchHomeTruth resolves second
    const rt1 = new ColonyRuntime(1234, { surveyOnly: true });
    rt1.setOperatorUserId("user-bob");
    // Vehicle ownership arrives first:
    rt1.applyVehicleOwnership("user-bob", ["karoo-x19-targa"]);
    expect(rt1.getAuthoritativeCar()?.id).toBe("showroom:karoo-x19-targa");
    // Home truth arrives second with resident projection:
    rt1.setAuthoritativeOwnedVehicle(residentProj.vehicle);
    expect(rt1.getPhysicalCarPosition()).toEqual({ x: 14, y: 28 });
    expect(rt1.getParkedCarPose()).toEqual({ x: 14, y: 28, heading: 0 });

    // 3. Async order 2: fetchHomeTruth resolves first, fetchOwnedVehicleKeysBackend resolves second
    const rt2 = new ColonyRuntime(1234, { surveyOnly: true });
    rt2.setOperatorUserId("user-bob");
    // Home truth arrives first:
    rt2.claimStarterHome(realProviderTruth!);
    rt2.setAuthoritativeOwnedVehicle(residentProj.vehicle);
    expect(rt2.getPhysicalCarPosition()).toEqual({ x: 14, y: 28 });
    // Vehicle ownership arrives second: applyVehicleOwnership must NOT clobber resident pose back to dealership!
    rt2.applyVehicleOwnership("user-bob", ["karoo-x19-targa"]);
    expect(rt2.getAuthoritativeCar()?.id).toBe("showroom:karoo-x19-targa");
    expect(rt2.getPhysicalCarPosition()).toEqual({ x: 14, y: 28 });
    expect(rt2.getParkedCarPose()?.x).toBe(14);
    expect(rt2.getParkedCarPose()?.y).toBe(28);

    // 4. Pre-resident (PLOT_OWNED) with owned car -> keeps owned car at dealership
    const preResidentTruth = parseHomeTruth({
      owned: false,
      status: "PLOT_OWNED",
      plotOwned: true,
      requiresBuild: true,
      plotId: "plot-1",
      frameId: "frame-1",
      neighbourhoodKey: "coast4",
      geometry: { spawn: { x: 14, y: 28 } },
    });
    const preResidentProj = projectReturningResidentState(preResidentTruth, undefined, ["karoo-x19-targa"]);
    expect(preResidentProj.isResident).toBe(false);
    expect(preResidentProj.vehicle).toBeNull();

    // 5. No-home (owned: false) with owned car keeps car in runtime without clobber
    const rt3 = new ColonyRuntime(1234, { surveyOnly: true });
    rt3.setOperatorUserId("user-bob");
    rt3.applyVehicleOwnership("user-bob", ["karoo-x19-targa"]);
    expect(rt3.getAuthoritativeCar()?.id).toBe("showroom:karoo-x19-targa");
    const noHomeProj = projectReturningResidentState(null, undefined, ["karoo-x19-targa"]);
    expect(noHomeProj.isResident).toBe(false);
    expect(noHomeProj.vehicle).toBeNull();

    // 6. Account-switch / logout fencing: applyVehicleOwnership with mismatched userId is rejected
    expect(rt3.applyVehicleOwnership("user-mallory", ["karoo-x19-targa"])).toBe(false);
  });

  it("P4-C1, P4-C2 & P2/P4-C3: mounts DriveHomeOverlay with physical vehicle pose subscription, single arrival mutation, and discriminating negative controls", async () => {
    setupTestDOM();
    const auth = getAuthClient();
    vi.spyOn(auth, "operator", "get").mockReturnValue({ id: "Alice", userId: "user-alice", scopes: [], roles: [] });
    vi.spyOn(auth, "isAuthenticated", "get").mockReturnValue(true);
    vi.spyOn(auth, "getValidToken").mockResolvedValue("jwt.tok");

    const homeTruth = {
      owned: true,
      status: "OWNED",
      onboardingState: "ONBOARDING",
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      neighbourhoodKey: "coast4",
      layoutRevision: "rev-coast4",
      geometry: {
        spawn: { x: 32, y: 48 },
      },
    };

    let arrivalPostCount = 0;
    let arrivalPostPayload: any = null;
    let arrivalPostUrl: string | null = null;
    let isResidentConfirmed = false;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        arrivalPostCount++;
        arrivalPostUrl = url;
        arrivalPostPayload = JSON.parse(String(init?.body));
        isResidentConfirmed = true;
        return new Response(JSON.stringify({ ok: true, resident: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.endsWith("/players/me/home")) {
        return new Response(
          JSON.stringify({
            ...homeTruth,
            onboardingState: isResidentConfirmed ? "RESIDENT" : "ONBOARDING",
            garageUnlocked: isResidentConfirmed,
            homeGarageUnlocked: isResidentConfirmed,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("{}", { status: 200 });
    });

    const subscribers = new Set<() => void>();
    let physicalCarPos = { x: 10, y: 10 };

    const mockRuntime: any = {
      focusSurveyCell: vi.fn(),
      getOwnedDrivePose: () => physicalCarPos,
      getPhysicalCarPosition: () => physicalCarPos,
      getActiveLayoutRevisionId: () => "rev-coast4",
      getOperatorUserId: () => "user-alice",
      getAuthoritativeCar: () => ({ id: "showroom:karoo-x19-targa" }),
      subscribe: (listener: () => void) => {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    };

    const container = (globalThis as any).document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: mockRuntime,
        }),
      );
    });

    // Cursor at dealership, car at dealership -> arrival button disabled
    const arriveBtnInitial = findNode(container, (n) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnInitial, "drive-home-arrive button must render").not.toBeNull();
    expect(arriveBtnInitial.disabled, "Arrival button must be disabled when car is at dealership").toBe(true);

    // Negative control: cursor-at-home / car-away
    const driveEastBtn = findNode(container, (n) => n.getAttribute?.("data-testid") === "drive-right");
    expect(driveEastBtn).not.toBeNull();
    await act(async () => {
      triggerNodeClick(driveEastBtn);
    });
    expect(arriveBtnInitial.disabled, "Arrival button must remain disabled when physical car is away").toBe(true);
    await act(async () => {
      triggerNodeClick(arriveBtnInitial);
    });
    expect(arrivalPostCount, "Zero POSTs must fire when physical car is away").toBe(0);

    // Positive: physical car moves to home spawn { x: 32, y: 48 } while cursor is away
    physicalCarPos = { x: 32, y: 48 };
    await act(async () => {
      for (const sub of subscribers) sub();
    });

    const arriveBtnArrived = findNode(container, (n) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnArrived.disabled, "Arrival button must enable when physical car reaches home plot").toBe(false);
    const arriveBtnText = arriveBtnArrived.children?.[0]?.nodeValue || arriveBtnArrived.nodeValue || arriveBtnArrived.textContent || "";
    expect(arriveBtnText).toContain("Pull into your home");

    // Click arrive button -> sends exactly 1 POST mutation with plotId, frameId, vehicleKey to HOME_DEED_DRIVE_HOME_ARRIVAL_PATH
    await act(async () => {
      triggerNodeClick(arriveBtnArrived);
    });

    expect(arrivalPostCount, "Exactly 1 arrival POST must be sent").toBe(1);
    expect(arrivalPostUrl).toBe(HOME_DEED_DRIVE_HOME_ARRIVAL_PATH);
    expect(arrivalPostPayload).toEqual({
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      vehicleKey: "karoo-x19-targa",
      cell: { x: 32, y: 48 },
      plotRef: expect.any(String),
    });

    // After server confirms arrival, home-garage-portal renders
    const garagePortal = findNode(container, (n) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(garagePortal, "home-garage-portal must render after arrival confirmation").not.toBeNull();

    vi.unstubAllGlobals();
  });
});


