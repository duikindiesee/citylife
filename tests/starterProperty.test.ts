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
  postHomeArrival,
  parseDriveHomeArrivalReceipt,
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
  houseDoor,
  type PublishedPlayerInventory,
  type StarterParcelGeometry,
} from "../src/colony/home/starterCatalogueClient";
import { StarterPropertyOverlay } from "../src/colony/ui/StarterPropertyOverlay";
import { DriveHomeOverlay } from "../src/colony/ui/DriveHomeOverlay";
import { getAuthClient } from "../src/colony/authClient";
import { saveBlueprintLocal, clearBlueprintsLocal } from "../src/colony/bot/blueprintStore";
import { resolveOwnedCar } from "../src/colony/car/ownedCar";
import { surveyStarterParcels } from "../src/colony/starterParcelSurvey";
import { cellOk } from "../src/colony/pathfind";
import { COLONY } from "../src/colony/config";

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
    const scriptNode = findNode(switchContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-script");
    const confirmedNode = findNode(switchContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    const staleErrorNode = findNode(switchContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(scriptNode, "Superseded build start must not write script to new context").toBeNull();
    expect(confirmedNode, "Superseded build start must not confirm build in new context").toBeNull();
    expect(staleErrorNode, "Superseded build start must not overwrite new context with stale error").toBeNull();

    // Healthy-current error control: genuine error on current owner is displayed
    const healthyErrRuntime: any = {
      currentUserId: "user-alice",
      getOperatorUserId() { return this.currentUserId; },
    };
    currentAuthUser = "user-alice";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(JSON.stringify({ owned: false, status: "PLOT_OWNED", plotOwned: true, requiresBuild: true, plotId: "coast4_1", frameId: "frame-coast4-1", neighbourhoodKey: "coast4", layoutRevision: layout.revision.contentHash, geometry: plotGeometry }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const healthyErrContainer = (globalThis as any).document.createElement("div");
    const healthyErrRoot = createRoot(healthyErrContainer);
    await act(async () => {
      healthyErrRoot.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: healthyErrRuntime,
        }),
      );
    });
    const healthyStartBtn = findNode(healthyErrContainer, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(healthyStartBtn).not.toBeNull();
    await act(async () => {
      triggerNodeClick(healthyStartBtn);
    });
    const healthyErrorNode = findNode(healthyErrContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(healthyErrorNode, "Healthy current operator must display error on genuine failure").not.toBeNull();

    // Negative 4c: Account-switch during fetchHomeTruth() await in finishHouseBuild aborts fail-closed
    const switchMidRuntime: any = {
      currentUserId: "user-alice",
      getOperatorUserId() { return this.currentUserId; },
      claimStarterHome: vi.fn(),
      applyBlueprint: vi.fn(),
    };
    const switchMidContainer = (globalThis as any).document.createElement("div");
    const switchMidRoot = createRoot(switchMidContainer);
    let switchMidBuildPostCount = 0;
    let switchedDuringTruth = false;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifest), { status: 200 });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          switchMidBuildPostCount++;
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
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
            completed: switchMidBuildPostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (switchMidBuildPostCount > 0) {
          switchedDuringTruth = true;
          switchMidRuntime.currentUserId = "user-mallory";
          currentAuthUser = "user-mallory";
        }
        return new Response(
          JSON.stringify({
            owned: true,
            status: "OWNED",
            plotOwned: true,
            requiresBuild: false,
            completed: true,
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            neighbourhoodKey: "coast4",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ neighbourhoods: [] }), { status: 200 });
    });

    currentAuthUser = "user-alice";
    await act(async () => {
      switchMidRoot.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: switchMidRuntime,
        }),
      );
    });

    const switchMidStartBtn = findNode(switchMidContainer, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(switchMidStartBtn);
    });
    const switchMidConfirmBtn = findNode(switchMidContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(switchMidConfirmBtn).not.toBeNull();

    await act(async () => {
      triggerNodeClick(switchMidConfirmBtn);
    });

    expect(switchMidBuildPostCount, "Build POST must execute before truth readback").toBe(1);
    expect(switchedDuringTruth, "Account switch must occur specifically during truth readback").toBe(true);
    const switchMidErrorNode = findNode(switchMidContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-error");
    const switchMidConfirmedNode = findNode(switchMidContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(switchMidConfirmedNode, "Account switch during truth readback must NOT confirm build").toBeNull();
    expect(switchMidErrorNode, "Superseded finishHouseBuild must NOT write stale error into new owner context").toBeNull();
    expect(switchMidRuntime.claimStarterHome).not.toHaveBeenCalled();

    // Negative 4d: Foreign / mismatched plotId returned from fetchHomeTruth() aborts
    const foreignRuntime: any = {
      currentUserId: "user-alice",
      getOperatorUserId() { return this.currentUserId; },
      claimStarterHome: vi.fn(),
      applyBlueprint: vi.fn(),
    };
    const foreignContainer = (globalThis as any).document.createElement("div");
    const foreignRoot = createRoot(foreignContainer);
    let foreignBuildPostCount = 0;
    let foreignReadbackReached = false;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifest), { status: 200 });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          foreignBuildPostCount++;
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
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
            completed: foreignBuildPostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (foreignBuildPostCount > 0) {
          foreignReadbackReached = true;
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              plotOwned: true,
              requiresBuild: false,
              completed: true,
              plotId: "foreign_99",
              frameId: "frame-foreign-99",
              neighbourhoodKey: "coast4",
              layoutRevision: layout.revision.contentHash,
              geometry: plotGeometry,
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
            frameId: "frame-coast4-1",
            neighbourhoodKey: "coast4",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ neighbourhoods: [] }), { status: 200 });
    });

    currentAuthUser = "user-alice";
    await act(async () => {
      foreignRoot.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: foreignRuntime,
        }),
      );
    });

    const foreignStartBtn = findNode(foreignContainer, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(foreignStartBtn);
    });
    const foreignConfirmBtn = findNode(foreignContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-submit");
    await act(async () => {
      triggerNodeClick(foreignConfirmBtn);
    });

    expect(foreignBuildPostCount, "Build POST must succeed").toBe(1);
    expect(foreignReadbackReached, "Foreign readback must be reached").toBe(true);
    const foreignErrorNode = findNode(foreignContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(foreignErrorNode, "Foreign plot mismatch must display error").not.toBeNull();
    expect(foreignRuntime.claimStarterHome).not.toHaveBeenCalled();

    // Negative 4e: Empty {} truth returned on /players/me/home after build completion aborts
    const emptyTruthRuntime: any = {
      currentUserId: "user-alice",
      getOperatorUserId() { return this.currentUserId; },
      claimStarterHome: vi.fn(),
      applyBlueprint: vi.fn(),
    };
    const emptyTruthContainer = (globalThis as any).document.createElement("div");
    const emptyTruthRoot = createRoot(emptyTruthContainer);
    let emptyTruthBuildPostCount = 0;
    let emptyTruthReadbackReached = false;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifest), { status: 200 });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          emptyTruthBuildPostCount++;
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
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
            completed: emptyTruthBuildPostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (emptyTruthBuildPostCount > 0) {
          emptyTruthReadbackReached = true;
          return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(
          JSON.stringify({
            owned: false,
            status: "PLOT_OWNED",
            plotOwned: true,
            requiresBuild: true,
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            neighbourhoodKey: "coast4",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ neighbourhoods: [] }), { status: 200 });
    });

    currentAuthUser = "user-alice";
    await act(async () => {
      emptyTruthRoot.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: emptyTruthRuntime,
        }),
      );
    });

    const emptyStartBtn = findNode(emptyTruthContainer, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(emptyStartBtn);
    });
    const emptyConfirmBtn = findNode(emptyTruthContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-submit");
    await act(async () => {
      triggerNodeClick(emptyConfirmBtn);
    });

    expect(emptyTruthBuildPostCount, "Build POST must succeed").toBe(1);
    expect(emptyTruthReadbackReached, "Empty truth final readback must be reached").toBe(true);
    const emptyErrorNode = findNode(emptyTruthContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(emptyErrorNode, "Empty truth must display error").not.toBeNull();
    expect(emptyTruthRuntime.claimStarterHome).not.toHaveBeenCalled();

    // Negative 4f: Mismatched frameId returned from fetchHomeTruth() aborts
    const frameMismatchRuntime: any = {
      currentUserId: "user-alice",
      getOperatorUserId() { return this.currentUserId; },
      claimStarterHome: vi.fn(),
      applyBlueprint: vi.fn(),
    };
    const frameMismatchContainer = (globalThis as any).document.createElement("div");
    const frameMismatchRoot = createRoot(frameMismatchContainer);
    let frameMismatchPostCount = 0;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifest), { status: 200 });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          frameMismatchPostCount++;
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
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
            completed: frameMismatchPostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (frameMismatchPostCount > 0) {
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              plotOwned: true,
              requiresBuild: false,
              completed: true,
              plotId: "coast4_1",
              frameId: "frame-foreign-frame",
              neighbourhoodKey: "coast4",
              layoutRevision: layout.revision.contentHash,
              geometry: plotGeometry,
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
            frameId: "frame-coast4-1",
            neighbourhoodKey: "coast4",
            layoutRevision: layout.revision.contentHash,
            geometry: plotGeometry,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ neighbourhoods: [] }), { status: 200 });
    });

    currentAuthUser = "user-alice";
    await act(async () => {
      frameMismatchRoot.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: frameMismatchRuntime,
        }),
      );
    });

    const frameStartBtn = findNode(frameMismatchContainer, (n) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(frameStartBtn);
    });
    const frameConfirmBtn = findNode(frameMismatchContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-submit");
    await act(async () => {
      triggerNodeClick(frameConfirmBtn);
    });

    expect(frameMismatchPostCount, "Build POST must succeed").toBe(1);
    const frameErrorNode = findNode(frameMismatchContainer, (n) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(frameErrorNode, "Frame mismatch must display error").not.toBeNull();
    expect(frameMismatchRuntime.claimStarterHome).not.toHaveBeenCalled();

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
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            homeGarageUnlocked: true,
            homeGarageUnlockedAt: "2026-11-08T10:00:00Z",
            vehicleStorageLocation: "HOME",
            onboardingState: "RESIDENT",
            alreadyArrived: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/players/me/home")) {
        return new Response(
          JSON.stringify({
            ...homeTruth,
            resident: isResidentConfirmed,
            isResident: isResidentConfirmed,
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

    // Negative 4b: 404 from HOME_DEED_DRIVE_HOME_ARRIVAL_PATH produces rejected without automatic fallback to legacy
    let deed404PostCount = 0;
    let legacyPostCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === HOME_DEED_DRIVE_HOME_ARRIVAL_PATH) {
        deed404PostCount++;
        return new Response("Not Found", { status: 404 });
      }
      if (url === HOME_ARRIVAL_PATH) {
        legacyPostCount++;
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const outcome404 = await postHomeArrival({ x: 32, y: 48 }, homeTruth as any, {
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      vehicleKey: "karoo-x19-targa",
    });
    expect(outcome404, "404 must classify as error without fallback").toEqual({ kind: "error", status: 404 });
    expect(deed404PostCount, "Exactly 1 POST to home-deed arrival route").toBe(1);
    expect(legacyPostCount, "Zero automatic fallback POSTs to legacy arrival route").toBe(0);

    // Negative 4c: Incomplete identity (missing vehicleKey) fails closed with rejected and 0 POSTs
    deed404PostCount = 0;
    const outcomeMissingKey = await postHomeArrival({ x: 32, y: 48 }, homeTruth as any, {
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      vehicleKey: "",
    });
    expect(outcomeMissingKey.kind, "Missing vehicleKey must fail closed as rejected").toBe("rejected");
    expect(deed404PostCount, "Zero POSTs when vehicleKey is missing").toBe(0);

    // Negative 4d: Layout revision mismatch between runtime and truth disables arrival
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/players/me/home")) {
        return new Response(
          JSON.stringify({
            ...homeTruth,
            onboardingState: "ONBOARDING",
            garageUnlocked: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const mismatchRuntime: any = {
      ...mockRuntime,
      getActiveLayoutRevisionId: () => "foreign-layout-rev-9999",
    };
    const mismatchContainer = (globalThis as any).document.createElement("div");
    const mismatchRoot = createRoot(mismatchContainer);
    await act(async () => {
      mismatchRoot.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: mismatchRuntime,
        }),
      );
    });
    const mismatchArriveBtn = findNode(mismatchContainer, (n) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(mismatchArriveBtn, "Arrival button must render in ready phase").not.toBeNull();
    expect(mismatchArriveBtn.disabled, "Arrival button must remain disabled on layout revision mismatch").toBe(true);

    // Negative 4e: Malformed arrival receipt (missing homeGarageUnlocked) is rejected
    vi.stubGlobal("fetch", async () => {
      return new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          homeGarageUnlocked: false,
          vehicleStorageLocation: "HOME",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const malformedOutcome = await postHomeArrival({ x: 32, y: 48 }, homeTruth as any, {
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      vehicleKey: "karoo-x19-targa",
    });
    expect(malformedOutcome.kind, "Malformed arrival receipt must be rejected").toBe("rejected");

    // Negative 4f: Mismatched vehicleStorageLocation is rejected
    vi.stubGlobal("fetch", async () => {
      return new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          homeGarageUnlocked: true,
          vehicleStorageLocation: "DEALERSHIP",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const storageOutcome = await postHomeArrival({ x: 32, y: 48 }, homeTruth as any, {
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      vehicleKey: "karoo-x19-targa",
    });
    expect(storageOutcome.kind, "Mismatched vehicleStorageLocation must be rejected").toBe("rejected");

    // Negative 4g: Mismatched plotId in receipt is rejected
    vi.stubGlobal("fetch", async () => {
      return new Response(
        JSON.stringify({
          plotId: "foreign_plot_99",
          frameId: "frame-coast4-1",
          homeGarageUnlocked: true,
          vehicleStorageLocation: "HOME",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const plotMismatchOutcome = await postHomeArrival({ x: 32, y: 48 }, homeTruth as any, {
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      vehicleKey: "karoo-x19-targa",
    });
    expect(plotMismatchOutcome.kind, "Mismatched plotId in receipt must be rejected").toBe("rejected");

    // Positive 4: Valid DriveHomeArrivalResponse confirms with parsed receipt
    vi.stubGlobal("fetch", async () => {
      return new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          homeGarageUnlocked: true,
          homeGarageUnlockedAt: "2026-11-08T10:00:00Z",
          vehicleStorageLocation: "HOME",
          onboardingState: "RESIDENT",
          alreadyArrived: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const validOutcome = await postHomeArrival({ x: 32, y: 48 }, homeTruth as any, {
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      vehicleKey: "karoo-x19-targa",
    });
    expect(validOutcome.kind).toBe("confirmed");
    expect((validOutcome as any).receipt?.homeGarageUnlocked).toBe(true);
    expect((validOutcome as any).receipt?.vehicleStorageLocation).toBe("HOME");

    vi.unstubAllGlobals();
  });

  it("Review 124 R1: fences arrival and builder operations to initiating runtime/opId across held responses, A-to-B runtime swap, auth-only switch, and unmount", async () => {
    setupTestDOM();
    const auth = getAuthClient();
    let currentAuthUser = "user-alice";
    vi.spyOn(auth, "operator", "get").mockImplementation(() => ({
      id: currentAuthUser,
      userId: currentAuthUser,
      scopes: [],
      roles: [],
    }));
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
      geometry: { spawn: { x: 32, y: 48 } },
    };

    function createDeferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    const createMockRuntime = (userId: string, rev = "rev-coast4") => {
      const subs = new Set<() => void>();
      let curUserId = userId;
      let curRev = rev;
      return {
        get userId() {
          return curUserId;
        },
        get rev() {
          return curRev;
        },
        setUserId: (newId: string) => {
          curUserId = newId;
        },
        setRev: (newRev: string) => {
          curRev = newRev;
        },
        notify: () => {
          for (const l of Array.from(subs)) l();
        },
        claimStarterHome: vi.fn().mockReturnValue(true),
        applyBlueprint: vi.fn().mockReturnValue(true),
        focusSurveyCell: vi.fn(),
        getOwnedDrivePose: () => ({ x: 32, y: 48 }),
        getPhysicalCarPosition: () => ({ x: 32, y: 48 }),
        getActiveLayoutRevisionId: () => curRev,
        getOperatorUserId: () => curUserId,
        getAuthoritativeCar: () => ({ id: "showroom:karoo-x19-targa" }),
        subscribe: (l: () => void) => {
          subs.add(l);
          return () => subs.delete(l);
        },
      };
    };

    // Part 1: Arrival held response with runtime swap A-to-B
    // Must return legitimate matching resident final readback so guard is not masked by nonresident fixture
    let arrivalPostCount = 0;
    let finalReadReachedPart1 = false;
    let homeTruthFetchCountPart1 = 0;
    const deferredFinalResidencyPart1 = createDeferred<Response>();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        arrivalPostCount++;
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            homeGarageUnlocked: true,
            vehicleStorageLocation: "HOME",
            onboardingState: "RESIDENT",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        homeTruthFetchCountPart1++;
        // Call 1 is runtimeA initial mount load.
        // Call 2 is runtimeA post-arrival authoritative residency readback (held).
        // Call 3 is runtimeB initial mount load.
        // Call 4+ is runtimeB post-arrival residency readback.
        if (homeTruthFetchCountPart1 === 2) {
          finalReadReachedPart1 = true;
          return deferredFinalResidencyPart1.promise;
        }
        if (homeTruthFetchCountPart1 >= 4) {
          return new Response(
            JSON.stringify({
              ...homeTruth,
              resident: true,
              onboardingState: "RESIDENT",
              status: "OWNED",
              homeGarageUnlocked: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(homeTruth), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200 });
    });

    const runtimeA = createMockRuntime("user-alice");
    const runtimeB = createMockRuntime("user-alice");

    const container = (globalThis as any).document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: runtimeA as any,
        }),
      );
    });

    const arriveBtn = findNode(container, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtn).not.toBeNull();
    expect(arriveBtn.disabled).toBe(false);

    await act(async () => {
      triggerNodeClick(arriveBtn);
    });
    expect(arrivalPostCount).toBe(1);
    expect(finalReadReachedPart1, "Authoritative post-arrival residency readback must be reached and held").toBe(true);

    // Rerender overlay with runtime B while post-arrival residency read is held
    await act(async () => {
      root.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: runtimeB as any,
        }),
      );
    });

    // Release runtime A's residency readback with genuine resident confirmation
    deferredFinalResidencyPart1.resolve(
      new Response(
        JSON.stringify({
          ...homeTruth,
          resident: true,
          onboardingState: "RESIDENT",
          status: "OWNED",
          homeGarageUnlocked: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(arrivalPostCount).toBe(1);
    expect(finalReadReachedPart1, "Authoritative post-arrival residency readback must be reached").toBe(true);
    const portal = findNode(container, (n: any) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(portal, "Old arrival in runtime A must NOT unlock garage portal in runtime B despite valid resident readback").toBeNull();

    // Trigger arrival on runtime B: healthy unmodified production-consumer positive on B succeeds
    const arriveBtnB = findNode(container, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnB).not.toBeNull();
    expect(arriveBtnB.disabled).toBe(false);
    await act(async () => {
      triggerNodeClick(arriveBtnB);
    });
    expect(arrivalPostCount, "Runtime B arrival must send its own arrival POST").toBe(2);
    const portalB = findNode(container, (n: any) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(portalB, "Runtime B's own arrival must succeed and unlock garage portal on B").not.toBeNull();

    // Part 2: Held arrival response followed by unmount
    const deferredPostUnmount = createDeferred<Response>();
    let unmountArrivalPostCount = 0;
    let postUnmountHomeReadCount = 0;
    let postArrivalResolvedPart2 = false;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        unmountArrivalPostCount++;
        return deferredPostUnmount.promise.then((res) => {
          postArrivalResolvedPart2 = true;
          return res;
        });
      }
      if (url.endsWith("/players/me/home")) {
        if (postArrivalResolvedPart2) {
          postUnmountHomeReadCount++;
        }
        return new Response(JSON.stringify(homeTruth), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const runtimeC = createMockRuntime("user-alice");
    const containerC = (globalThis as any).document.createElement("div");
    const rootC = createRoot(containerC);
    await act(async () => {
      rootC.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: runtimeC as any,
        }),
      );
    });
    const arriveBtnC = findNode(containerC, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnC).not.toBeNull();
    await act(async () => {
      triggerNodeClick(arriveBtnC);
    });
    expect(unmountArrivalPostCount).toBe(1);

    await act(async () => {
      rootC.unmount();
    });
    deferredPostUnmount.resolve(
      new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          homeGarageUnlocked: true,
          vehicleStorageLocation: "HOME",
        }),
        { status: 200 },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(unmountArrivalPostCount).toBe(1);
    expect(postUnmountHomeReadCount, "Unmounted arrival overlay continuation must exit before fetchHomeResidency").toBe(0);

    // Also test StarterPropertyOverlay unmount while completeHouseBuild POST is held
    const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const builderPlotGeometryPart2: StarterParcelGeometry = {
      plotId: "coast4_1",
      worldId: "seed-4242",
      layoutRevision: "a".repeat(64),
      neighbourhoodKey: "coast4",
      parcel: { x: 10, y: 10, width: 10, depth: 10 },
      houseZone: { x: 12, y: 12, width: 6, depth: 5 },
      driveway: [{ x: 15, y: 18 }, { x: 15, y: 17 }],
      roadCells: [{ x: 15, y: 19 }],
      spawn: { x: 10, y: 20 },
    };
    const validScriptPart2 =
      "house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}";
    const builderLayoutPart2 = createWorldLayoutDocument({
      layoutId: "seed-4242",
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
    const layoutRevPart2 = builderLayoutPart2.revision.contentHash;
    (builderPlotGeometryPart2 as any).layoutRevision = layoutRevPart2;
    const catalogueManifestPart2 = {
      published: true,
      manifest: {
        schemaVersion: "citylife.starter-parcel-manifest/v1",
        worldId: "seed-4242",
        layoutRevision: layoutRevPart2,
        sourceLayoutRevision: "a".repeat(64),
        layout: builderLayoutPart2,
        plots: [
          {
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            geometry: builderPlotGeometryPart2,
          },
        ],
      },
    };

    const deferredBuildUnmount = createDeferred<Response>();
    let unmountBuildPostCount = 0;
    let unmountTruthReadCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart2), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          unmountBuildPostCount++;
          return deferredBuildUnmount.promise;
        }
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart2,
            geometry: builderPlotGeometryPart2,
            completed: true,
            script: validScriptPart2,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (unmountBuildPostCount > 0) {
          unmountTruthReadCount++;
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              plotOwned: true,
              requiresBuild: false,
              neighbourhoodKey: "coast4",
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              layoutRevision: layoutRevPart2,
              priceKco: 10000,
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
            neighbourhoodKey: "coast4",
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart2,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const unmountRuntime = createMockRuntime("user-alice", layoutRevPart2);
    unmountRuntime.claimStarterHome = vi.fn();
    unmountRuntime.applyBlueprint = vi.fn();
    const onPurchasedSpy = vi.fn();
    const containerUnmount = (globalThis as any).document.createElement("div");
    const rootUnmount = createRoot(containerUnmount);
    await act(async () => {
      rootUnmount.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          onHomePurchased: onPurchasedSpy,
          runtime: unmountRuntime as any,
        }),
      );
    });
    const startBuildBtnUnmount = findNode(containerUnmount, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(startBuildBtnUnmount);
    });
    const submitBtnUnmount = findNode(containerUnmount, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    await act(async () => {
      triggerNodeClick(submitBtnUnmount);
    });
    expect(unmountBuildPostCount).toBe(1);

    await act(async () => {
      rootUnmount.unmount();
    });
    deferredBuildUnmount.resolve(
      new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          layoutRevision: layoutRevPart2,
          geometry: builderPlotGeometryPart2,
          completed: true,
          script: validScriptPart2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(unmountRuntime.claimStarterHome, "Unmounted builder must not claim home").not.toHaveBeenCalled();
    expect(unmountRuntime.applyBlueprint, "Unmounted builder must not apply blueprint").not.toHaveBeenCalled();
    expect(onPurchasedSpy, "Unmounted builder must not call onHomePurchased").not.toHaveBeenCalled();
    expect(unmountTruthReadCount, "Unmounted builder must not re-read home truth").toBe(0);

    // Part 3: Auth-only switch while runtime still reports A
    currentAuthUser = "user-alice";
    const runtimeD = createMockRuntime("user-alice");
    let authArrivalPostCount = 0;
    let finalResidencyFetchedPart3 = false;
    const deferredFinalResidency = createDeferred<Response>();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        authArrivalPostCount++;
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            homeGarageUnlocked: true,
            vehicleStorageLocation: "HOME",
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (authArrivalPostCount > 0) {
          finalResidencyFetchedPart3 = true;
          return deferredFinalResidency.promise;
        }
        return new Response(
          JSON.stringify({
            ...homeTruth,
            onboardingState: "ONBOARDING",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerD = (globalThis as any).document.createElement("div");
    const rootD = createRoot(containerD);
    await act(async () => {
      rootD.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: runtimeD as any,
        }),
      );
    });

    const arriveBtnD = findNode(containerD, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnD).not.toBeNull();

    await act(async () => {
      triggerNodeClick(arriveBtnD);
    });

    expect(authArrivalPostCount, "Arrival POST must succeed before residency fetch").toBe(1);
    expect(finalResidencyFetchedPart3, "Residency fetch must be reached and held").toBe(true);

    // Switch auth identity mid-await
    currentAuthUser = "user-eve";
    deferredFinalResidency.resolve(
      new Response(
        JSON.stringify({
          ...homeTruth,
          resident: true,
          onboardingState: "RESIDENT",
          homeGarageUnlocked: true,
        }),
        { status: 200 },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const portalD = findNode(containerD, (n: any) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(portalD, "Auth-only switch must fail closed and refuse garage portal").toBeNull();

    // Part 4: Builder held operation across runtime swap A-to-B
    currentAuthUser = "user-alice";
    const transformR1 = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const builderLayoutR1 = createWorldLayoutDocument({
      layoutId: "seed-4242",
      worldId: "seed-4242",
      seed: 4242,
      revision: { number: 1, parentHash: "a".repeat(64) },
      frames: [
        { id: "surface", address: "spatial://citylife/surface", kind: "region", layer: "surface", transform: transformR1 },
        { id: "frame-coast4-1", address: "spatial://citylife/surface/region/parcel", kind: "region", layer: "surface", parentId: "surface", transform: transformR1 },
      ],
      placements: [],
      roads: [],
      ways: [],
      terrainEdits: [],
      portals: [],
    });
    const layoutRevPart4 = builderLayoutR1.revision.contentHash;

    const builderPlotGeometry: StarterParcelGeometry = {
      plotId: "coast4_1",
      worldId: "seed-4242",
      layoutRevision: layoutRevPart4,
      neighbourhoodKey: "coast4",
      parcel: { x: 10, y: 10, width: 10, depth: 10 },
      houseZone: { x: 12, y: 12, width: 6, depth: 5 },
      driveway: [{ x: 15, y: 18 }, { x: 15, y: 17 }],
      roadCells: [{ x: 15, y: 19 }],
      spawn: { x: 10, y: 20 },
    };
    const validScript =
      "house{w:6 d:5 wallH:2 door:s} room{kind:living x:0 y:0 w:4 d:3 win:1} room{kind:bedroom x:4 y:0 w:2 d:3 win:1} room{kind:patio x:0 y:3 w:6 d:2 win:0}";
    const catalogueManifestPart4 = {
      published: true,
      manifest: {
        schemaVersion: "citylife.starter-parcel-manifest/v1",
        worldId: "seed-4242",
        layoutRevision: layoutRevPart4,
        sourceLayoutRevision: "a".repeat(64),
        layout: builderLayoutR1,
        plots: [
          {
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            geometry: builderPlotGeometry,
          },
        ],
      },
    };

    let builderPostCountPart4 = 0;
    const deferredBuildPostPart4 = createDeferred<Response>();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart4), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          builderPostCountPart4++;
          return deferredBuildPostPart4.promise;
        }
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            geometry: builderPlotGeometry,
            completed: true,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (builderPostCountPart4 > 0) {
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              plotOwned: true,
              requiresBuild: false,
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              neighbourhoodKey: "coast4",
              layoutRevision: layoutRevPart4,
              priceKco: 10000,
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
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const builderRuntimeA = createMockRuntime("user-alice", layoutRevPart4);
    const builderRuntimeB = createMockRuntime("user-alice", layoutRevPart4);

    const containerBuilder = (globalThis as any).document.createElement("div");
    const rootBuilder = createRoot(containerBuilder);

    await act(async () => {
      rootBuilder.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: builderRuntimeA as any,
        }),
      );
    });

    const startBuildBtn4 = findNode(containerBuilder, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBuildBtn4).not.toBeNull();
    await act(async () => {
      triggerNodeClick(startBuildBtn4);
    });

    const submitBuildBtn4 = findNode(containerBuilder, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBuildBtn4).not.toBeNull();

    await act(async () => {
      triggerNodeClick(submitBuildBtn4);
    });
    expect(builderPostCountPart4).toBe(1);

    // Swap runtime prop to builderRuntimeB while build is held
    await act(async () => {
      rootBuilder.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: builderRuntimeB as any,
        }),
      );
    });

    // Release held build POST with success
    deferredBuildPostPart4.resolve(
      new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          layoutRevision: layoutRevPart4,
          geometry: builderPlotGeometry,
          completed: true,
          script: validScript,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(builderRuntimeA.claimStarterHome, "Original runtime A must NOT have claimStarterHome called").not.toHaveBeenCalled();
    expect(builderRuntimeB.claimStarterHome, "Swapped runtime B must NOT have claimStarterHome called").not.toHaveBeenCalled();
    const confirmedNode4 = findNode(containerBuilder, (n: any) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(confirmedNode4, "Swapped runtime B must NOT show build confirmed").toBeNull();

    // Part 5A: True Auth-only switch with legitimately completing helper, held overlay readback, and error suppression
    currentAuthUser = "user-alice";
    const builderRuntimePart5A = createMockRuntime("user-alice", layoutRevPart4);
    let builderPostCountPart5A = 0;
    let truthReadbackCount5A = 0;
    const deferredTruthReadbackPart5A = createDeferred<Response>();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart4), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          builderPostCountPart5A++;
        }
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            geometry: builderPlotGeometry,
            completed: true,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        truthReadbackCount5A++;
        if (truthReadbackCount5A === 1) {
          // Initial mount truth: PLOT_OWNED, requiresBuild: true
          return new Response(
            JSON.stringify({
              owned: false,
              status: "PLOT_OWNED",
              plotOwned: true,
              requiresBuild: true,
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              layoutRevision: layoutRevPart4,
              priceKco: 10000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Call 2 is finishHouseBuild's post-build final truth readback (held!)
        if (truthReadbackCount5A === 2) {
          return deferredTruthReadbackPart5A.promise;
        }
        // Subsequent calls return completed truth
        return new Response(
          JSON.stringify({
            owned: true,
            status: "OWNED",
            plotOwned: true,
            requiresBuild: false,
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            neighbourhoodKey: "coast4",
            layoutRevision: layoutRevPart4,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerPart5A = (globalThis as any).document.createElement("div");
    const rootPart5A = createRoot(containerPart5A);

    await act(async () => {
      rootPart5A.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: builderRuntimePart5A as any,
        }),
      );
    });

    const startBuildBtn5A = findNode(containerPart5A, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBuildBtn5A).not.toBeNull();
    await act(async () => {
      triggerNodeClick(startBuildBtn5A);
      await new Promise((r) => setTimeout(r, 20));
    });

    const submitBuildBtn5A = findNode(containerPart5A, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBuildBtn5A).not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBuildBtn5A);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(builderPostCountPart5A, "Helper POST must have succeeded").toBe(1);
    expect(truthReadbackCount5A, "Final overlay-owned truth readback must be reached").toBe(2);

    // True Auth-only switch: runtime object and operator user remain "user-alice", no notify called
    currentAuthUser = "user-mallory";

    // Release held overlay-owned truth readback with valid completed truth
    deferredTruthReadbackPart5A.resolve(
      new Response(
        JSON.stringify({
          owned: true,
          status: "OWNED",
          plotOwned: true,
          requiresBuild: false,
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          layoutRevision: layoutRevPart4,
          priceKco: 10000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(builderRuntimePart5A.claimStarterHome, "Auth-only switch must NOT allow claimStarterHome").not.toHaveBeenCalled();
    const confirmedNode5A = findNode(containerPart5A, (n: any) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(confirmedNode5A, "Auth-only switch must fail closed without confirming build").toBeNull();
    const errNode5A = findNode(containerPart5A, (n: any) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(errNode5A, "Overlay Auth fence must suppress error rendering into new owner context").toBeNull();

    // Current-owner recovery: Switch Auth back to Alice and execute fresh build to completion
    currentAuthUser = "user-alice";
    await act(async () => {
      rootPart5A.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: builderRuntimePart5A as any,
        }),
      );
    });
    const startBuildBtn5ARecover = findNode(containerPart5A, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    if (startBuildBtn5ARecover) {
      await act(async () => {
        triggerNodeClick(startBuildBtn5ARecover);
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    const submitBuildBtn5ARecover = findNode(containerPart5A, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBuildBtn5ARecover, "Recovered current owner must see builder submit control").not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBuildBtn5ARecover);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(builderRuntimePart5A.claimStarterHome, "Recovered Alice must claim starter home").toHaveBeenCalledTimes(1);
    const confirmedNode5ARecovered = findNode(containerPart5A, (n: any) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(confirmedNode5ARecovered, "Recovered Alice must show build confirmed").not.toBeNull();

    // Part 5B: Same-object operator switch where runtime operator changes without notify()
    currentAuthUser = "user-alice";
    const builderRuntimePart5B = createMockRuntime("user-alice", layoutRevPart4);
    let builderPostCountPart5B = 0;
    const deferredBuildPostPart5B = createDeferred<Response>();

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart4), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          builderPostCountPart5B++;
          return deferredBuildPostPart5B.promise;
        }
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            geometry: builderPlotGeometry,
            completed: true,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (builderPostCountPart5B > 0) {
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              plotOwned: true,
              requiresBuild: false,
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              neighbourhoodKey: "coast4",
              layoutRevision: layoutRevPart4,
              priceKco: 10000,
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
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerPart5B = (globalThis as any).document.createElement("div");
    const rootPart5B = createRoot(containerPart5B);

    await act(async () => {
      rootPart5B.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: builderRuntimePart5B as any,
        }),
      );
    });

    const startBuildBtn5B = findNode(containerPart5B, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBuildBtn5B).not.toBeNull();
    await act(async () => {
      triggerNodeClick(startBuildBtn5B);
    });

    const submitBuildBtn5B = findNode(containerPart5B, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBuildBtn5B).not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBuildBtn5B);
    });
    expect(builderPostCountPart5B).toBe(1);

    // Operator switch on same runtime object without notify()
    builderRuntimePart5B.setUserId("user-mallory");
    // Do NOT call builderRuntimePart5B.notify(); Auth user remains "user-alice"

    // Release held build POST with success
    deferredBuildPostPart5B.resolve(
      new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          layoutRevision: layoutRevPart4,
          geometry: builderPlotGeometry,
          completed: true,
          script: validScript,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(builderRuntimePart5B.claimStarterHome, "Operator switch on same runtime must NOT allow claimStarterHome").not.toHaveBeenCalled();
    const confirmedNode5B = findNode(containerPart5B, (n: any) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(confirmedNode5B, "Operator switch must fail closed without confirming build").toBeNull();

    // Part 6: Older-finally protection — older operation completion cannot clear newer pending
    currentAuthUser = "user-alice";
    const runtimeFinallyA = createMockRuntime("user-alice", "rev-coast4");
    const runtimeFinallyB = createMockRuntime("user-alice", "rev-coast4");
    const deferredArrivalOp1Truth = createDeferred<Response>();
    deferredArrivalOp1Truth.promise.catch(() => {});
    const deferredArrivalOp2Post = createDeferred<Response>();
    let arrivalCallCount = 0;
    let homeTruthCallCount = 0;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        arrivalCallCount++;
        if (arrivalCallCount === 1) {
          // Op 1 POST resolves immediately with confirmed receipt
          return new Response(
            JSON.stringify({
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              homeGarageUnlocked: true,
              vehicleStorageLocation: "HOME",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return deferredArrivalOp2Post.promise;
      }
      if (url.endsWith("/players/me/home")) {
        homeTruthCallCount++;
        // Call 1: initial mount of A
        if (homeTruthCallCount === 1) {
          return new Response(JSON.stringify(homeTruth), { status: 200 });
        }
        // Call 2: Op 1's post-arrival fetchHomeResidency() readback!
        if (homeTruthCallCount === 2) {
          return deferredArrivalOp1Truth.promise;
        }
        // Call 3: mount of B
        if (homeTruthCallCount === 3) {
          return new Response(JSON.stringify(homeTruth), { status: 200 });
        }
        // Subsequent calls (for Op 2) return RESIDENT truth
        return new Response(
          JSON.stringify({
            ...homeTruth,
            onboardingState: "RESIDENT",
            resident: true,
            homeGarageUnlocked: true,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerFinally = (globalThis as any).document.createElement("div");
    const rootFinally = createRoot(containerFinally);
    await act(async () => {
      rootFinally.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: runtimeFinallyA as any,
        }),
      );
    });

    const arriveBtnFinally = findNode(containerFinally, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnFinally).not.toBeNull();

    // Start Op 1 — completes POST and enters post-arrival fetchHomeResidency() await
    await act(async () => {
      triggerNodeClick(arriveBtnFinally);
    });
    expect(arrivalCallCount).toBe(1);
    expect(homeTruthCallCount).toBe(2);
    expect(arriveBtnFinally.disabled).toBe(true);

    // Rerender with runtimeFinallyB (invalidates Op 1, resets pending for B)
    await act(async () => {
      rootFinally.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: runtimeFinallyB as any,
        }),
      );
    });
    expect(homeTruthCallCount).toBe(3);

    // Start Op 2 on runtimeFinallyB
    const arriveBtnFinally2 = findNode(containerFinally, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnFinally2).not.toBeNull();
    await act(async () => {
      triggerNodeClick(arriveBtnFinally2);
    });
    expect(arrivalCallCount).toBe(2);
    expect(arriveBtnFinally2.disabled).toBe(true);

    // Reject Op 1's held final residency readback
    deferredArrivalOp1Truth.reject(new Error("Op 1 final-residency readback failure"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Op 2 must STILL be pending because Op 1's finally must NOT clear Op 2's pending!
    expect(arriveBtnFinally2.disabled, "Older operation finally block must NOT clear newer operation's pending state").toBe(true);

    // Clean up Op 2
    deferredArrivalOp2Post.resolve(
      new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          homeGarageUnlocked: true,
          vehicleStorageLocation: "HOME",
        }),
        { status: 200 },
      ),
    );
    // Same-object revision change with held arrival denial:
    // Arrival starts on rev-coast4-v1, revision changes to rev-coast4-v2 on same runtime,
    // held arrival resolves with 422 denial. Old denial must NOT write data-arrival-state="rejected"!
    const runtimeSameRev = createMockRuntime("user-alice", "rev-coast4-v1");
    const deferredArrivalDenial = createDeferred<Response>();
    let arrivalSameRevPostCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        arrivalSameRevPostCount++;
        return deferredArrivalDenial.promise;
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(JSON.stringify({ ...homeTruth, layoutRevision: "rev-coast4-v1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const containerSameRev = (globalThis as any).document.createElement("div");
    const rootSameRev = createRoot(containerSameRev);
    await act(async () => {
      rootSameRev.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: runtimeSameRev as any,
        }),
      );
    });
    const arriveBtnSameRev = findNode(containerSameRev, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    await act(async () => {
      triggerNodeClick(arriveBtnSameRev);
    });
    expect(arrivalSameRevPostCount, "Arrival POST must have fired before revision change").toBe(1);
    // Revision changes on same runtime object without notification
    await act(async () => {
      runtimeSameRev.setRev("rev-coast4-v2");
    });
    // Held arrival resolves with 422 denial
    deferredArrivalDenial.resolve(
      new Response(JSON.stringify({ kind: "rejected" }), { status: 422 }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const arrivalState = containerSameRev.getAttribute?.("data-arrival-state") ??
      findNode(containerSameRev, (n: any) => n.getAttribute?.("data-arrival-state") === "rejected");
    expect(arrivalState, "Stale denial across same-object revision change must NOT write rejected outcome").toBeNull();

    // Same-object revision change with held builder submission:
    // Builder starts on rev-coast4-v1, revision changes to rev-coast4-v2 on same runtime,
    // held builder POST resolves with 500 error. Old error must NOT write home-builder-error!
    const runtimeSameBuildRev = createMockRuntime("user-alice", layoutRevPart4);
    const deferredBuildErr = createDeferred<Response>();
    let buildErrPostCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart4), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          buildErrPostCount++;
          return deferredBuildErr.promise;
        }
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            geometry: builderPlotGeometry,
            completed: false,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(
          JSON.stringify({
            owned: false,
            status: "PLOT_OWNED",
            plotOwned: true,
            requiresBuild: true,
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const containerBuildSameRev = (globalThis as any).document.createElement("div");
    const rootBuildSameRev = createRoot(containerBuildSameRev);
    await act(async () => {
      rootBuildSameRev.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: runtimeSameBuildRev as any,
        }),
      );
    });
    const startBuildBtnSame = findNode(containerBuildSameRev, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(startBuildBtnSame);
      await new Promise((r) => setTimeout(r, 20));
    });
    const submitBtnSame = findNode(containerBuildSameRev, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBtnSame).not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBtnSame);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(buildErrPostCount, "Builder POST must have been called").toBe(1);

    // Revision changes on same runtime without notification
    await act(async () => {
      runtimeSameBuildRev.setRev("rev-coast4-v2");
    });
    // Held builder rejects with error
    deferredBuildErr.reject(new Error("Network 500 error"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const errNodeSameRev = findNode(containerBuildSameRev, (n: any) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(errNodeSameRev, "Stale builder error across same-object revision change must NOT write error").toBeNull();

    // StarterPropertyOverlay older-finally vs newer-pending protection:
    const deferredBuildOp1Truth = createDeferred<Response>();
    deferredBuildOp1Truth.promise.catch(() => {});
    const deferredBuildOp2Post = createDeferred<Response>();
    let buildCallCount = 0;
    let truthCallCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart4), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          buildCallCount++;
          if (buildCallCount === 1) {
            // Op 1 POST resolves immediately with confirmed receipt
            return new Response(
              JSON.stringify({
                plotId: "coast4_1",
                frameId: "frame-coast4-1",
                layoutRevision: layoutRevPart4,
                geometry: builderPlotGeometry,
                completed: true,
                script: validScript,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return deferredBuildOp2Post.promise;
        }
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            geometry: builderPlotGeometry,
            completed: buildCallCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        truthCallCount++;
        // Call 1: initial mount of A
        if (truthCallCount === 1) {
          return new Response(
            JSON.stringify({
              owned: false,
              status: "PLOT_OWNED",
              plotOwned: true,
              requiresBuild: true,
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              layoutRevision: layoutRevPart4,
              priceKco: 10000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Call 2 is Op 1's post-build fetchHomeTruth() readback!
        if (truthCallCount === 2) {
          return deferredBuildOp1Truth.promise;
        }
        // Subsequent calls (for Op 2) return completed truth
        return new Response(
          JSON.stringify({
            owned: true,
            status: "OWNED",
            plotOwned: true,
            requiresBuild: false,
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const runtimeBuildFinallyA = createMockRuntime("user-alice", layoutRevPart4);
    const runtimeBuildFinallyB = createMockRuntime("user-alice", layoutRevPart4);
    const containerBuildFinally = (globalThis as any).document.createElement("div");
    const rootBuildFinally = createRoot(containerBuildFinally);
    await act(async () => {
      rootBuildFinally.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: runtimeBuildFinallyA as any,
        }),
      );
    });
    const startBuildBtnFinA = findNode(containerBuildFinally, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(startBuildBtnFinA);
      await new Promise((r) => setTimeout(r, 20));
    });
    const submitBuildBtnFinA = findNode(containerBuildFinally, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    await act(async () => {
      triggerNodeClick(submitBuildBtnFinA);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(buildCallCount).toBe(1);
    expect(truthCallCount).toBe(2);

    // Rerender with runtimeBuildFinallyB (invalidates Op 1, resets build state for B)
    await act(async () => {
      rootBuildFinally.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: runtimeBuildFinallyB as any,
        }),
      );
    });
    const startBuildBtnFinB = findNode(containerBuildFinally, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(startBuildBtnFinB);
      await new Promise((r) => setTimeout(r, 20));
    });
    const submitBuildBtnFinB = findNode(containerBuildFinally, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    await act(async () => {
      triggerNodeClick(submitBuildBtnFinB);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(buildCallCount).toBe(2);
    expect(submitBuildBtnFinB.disabled).toBe(true);

    // Reject Op 1's held final truth readback
    deferredBuildOp1Truth.reject(new Error("Op 1 final-truth readback failure"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Op 2 must still be pending!
    expect(submitBuildBtnFinB.disabled, "Older build finally block must NOT clear newer build pending state").toBe(true);

    // Clean up Op 2 and verify successful completion for Runtime B
    deferredBuildOp2Post.resolve(
      new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          layoutRevision: layoutRevPart4,
          geometry: builderPlotGeometry,
          completed: true,
          script: validScript,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(runtimeBuildFinallyB.claimStarterHome, "Op 2 on Runtime B must claim starter home").toHaveBeenCalled();
    const confirmedNodeFinB = findNode(containerBuildFinally, (n: any) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(confirmedNodeFinB, "Op 2 on Runtime B must show build confirmed").not.toBeNull();

    // Part 7: Held startHouseBuild / loadHouseBuild across context change, followed by current-owner recovery
    currentAuthUser = "user-alice";
    const runtimePart7A = createMockRuntime("user-alice", layoutRevPart4);
    const runtimePart7B = createMockRuntime("user-bob", layoutRevPart4);
    const deferredLoadBuild = createDeferred<Response>();
    let loadBuildCallCount = 0;
    let part7PostCount = 0;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart4), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          part7PostCount++;
          return new Response(
            JSON.stringify({
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              layoutRevision: layoutRevPart4,
              geometry: builderPlotGeometry,
              completed: true,
              script: validScript,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        loadBuildCallCount++;
        if (loadBuildCallCount === 1) {
          // Op 1 GET /home/build is held!
          return deferredLoadBuild.promise;
        }
        // Op 2 returns valid session context (completed: false before POST, completed: true after POST)
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            geometry: builderPlotGeometry,
            completed: part7PostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (loadBuildCallCount >= 2) {
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              plotOwned: true,
              requiresBuild: false,
              plotId: "coast4_1",
              frameId: "frame-coast4-1",
              layoutRevision: layoutRevPart4,
              priceKco: 10000,
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
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerPart7 = (globalThis as any).document.createElement("div");
    const rootPart7 = createRoot(containerPart7);
    await act(async () => {
      rootPart7.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: runtimePart7A as any,
        }),
      );
    });

    const startBtn7A = findNode(containerPart7, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBtn7A).not.toBeNull();
    await act(async () => {
      triggerNodeClick(startBtn7A);
    });
    expect(loadBuildCallCount).toBe(1);

    // Context changes: runtime swaps to runtimePart7B and currentAuthUser switches to user-bob
    currentAuthUser = "user-bob";
    await act(async () => {
      rootPart7.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: runtimePart7B as any,
        }),
      );
    });

    // Op 1's held loadHouseBuild now resolves
    deferredLoadBuild.resolve(
      new Response(
        JSON.stringify({
          plotId: "coast4_1",
          frameId: "frame-coast4-1",
          layoutRevision: layoutRevPart4,
          geometry: builderPlotGeometry,
          completed: false,
          script: validScript,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Stale Op 1 must NOT have opened build session into Bob's context or set error
    const submitBtn7Stale = findNode(containerPart7, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBtn7Stale, "Stale loadHouseBuild must NOT open build session for swapped runtime").toBeNull();
    const errNode7 = findNode(containerPart7, (n: any) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(errNode7, "Stale loadHouseBuild must NOT write error").toBeNull();

    // Current-owner recovery: Bob initiates startHouseBuild cleanly
    const startBtn7B = findNode(containerPart7, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBtn7B).not.toBeNull();
    await act(async () => {
      triggerNodeClick(startBtn7B);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(loadBuildCallCount).toBe(2);

    const submitBtn7B = findNode(containerPart7, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBtn7B, "Recovered current owner Bob must be able to open builder and submit").not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBtn7B);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(runtimePart7B.claimStarterHome, "Current owner Bob must claim home on clean recovery").toHaveBeenCalled();

    // Part 8: Headers-arrived / body-stalled JSON consumption fixture
    currentAuthUser = "user-alice";
    const runtimePart8 = createMockRuntime("user-alice", layoutRevPart4);
    const deferredBodyJson = createDeferred<any>();
    let postCallCountPart8 = 0;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestPart4), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") {
          postCallCountPart8++;
          // Return a Response whose headers have arrived (status 200), but response.json() awaits deferredBodyJson
          const mockResponse = new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
          mockResponse.json = () => deferredBodyJson.promise;
          return mockResponse;
        }
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            geometry: builderPlotGeometry,
            completed: true,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(
          JSON.stringify({
            owned: false,
            status: "PLOT_OWNED",
            plotOwned: true,
            requiresBuild: true,
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevPart4,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerPart8 = (globalThis as any).document.createElement("div");
    const rootPart8 = createRoot(containerPart8);
    await act(async () => {
      rootPart8.render(
        React.createElement(StarterPropertyOverlay, {
          onClose: () => {},
          runtime: runtimePart8 as any,
        }),
      );
    });

    const startBtn8 = findNode(containerPart8, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(startBtn8);
      await new Promise((r) => setTimeout(r, 20));
    });

    const submitBtn8 = findNode(containerPart8, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBtn8).not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBtn8);
    });
    expect(postCallCountPart8).toBe(1);

    // Headers have arrived! But body parsing is stalled.
    // Auth changes while body is stalled:
    currentAuthUser = "user-mallory";

    // Now resolve stalled body JSON
    deferredBodyJson.resolve({
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      layoutRevision: layoutRevPart4,
      geometry: builderPlotGeometry,
      completed: true,
      script: validScript,
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Stalled body consumption must be rejected by helper, and overlay must suppress error and confirmed in Mallory's context
    expect(runtimePart8.claimStarterHome, "Stalled body completion under changed Auth must NOT claim home").not.toHaveBeenCalled();
    const confirmedNode8 = findNode(containerPart8, (n: any) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(confirmedNode8, "Stalled body completion under changed Auth must NOT confirm build").toBeNull();
    const errNode8 = findNode(containerPart8, (n: any) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(errNode8, "Stalled body completion under changed Auth must NOT write error into new owner context").toBeNull();

    vi.unstubAllGlobals();
  });

  it("Review 124 R2: compares actual fresh residency and builder truth without fallbacks, rejecting foreign revisions, missing frames, and mid-await revision changes", async () => {
    setupTestDOM();
    const auth = getAuthClient();
    vi.spyOn(auth, "operator", "get").mockReturnValue({ id: "user-alice", userId: "user-alice", scopes: [], roles: [] });
    vi.spyOn(auth, "isAuthenticated", "get").mockReturnValue(true);
    vi.spyOn(auth, "getValidToken").mockResolvedValue("jwt.tok");

    const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const builderLayout = createWorldLayoutDocument({
      layoutId: "seed-4242",
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
    const layoutRevR1 = builderLayout.revision.contentHash;
    const layoutRevR2 = "foreign-rev-hash-R2";

    const baseHomeTruth = {
      owned: true,
      status: "OWNED",
      onboardingState: "ONBOARDING",
      plotId: "coast4_1",
      frameId: "frame-coast4-1",
      neighbourhoodKey: "coast4",
      layoutRevision: layoutRevR1,
      geometry: { spawn: { x: 32, y: 48 } },
    };

    let freshTruthToReturn: any = {
      ...baseHomeTruth,
      resident: true,
      onboardingState: "RESIDENT",
      homeGarageUnlocked: true,
      layoutRevision: layoutRevR2,
    };

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            homeGarageUnlocked: true,
            vehicleStorageLocation: "HOME",
            onboardingState: "RESIDENT",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(JSON.stringify(freshTruthToReturn), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200 });
    });

    const createMockRuntime = (rev: string) => ({
      getOperatorUserId: () => "user-alice",
      getActiveLayoutRevisionId: () => rev,
      getAuthoritativeCar: () => ({ id: "showroom:karoo-x19-targa" }),
      getOwnedDrivePose: () => ({ x: 32, y: 48 }),
      getPhysicalCarPosition: () => ({ x: 32, y: 48 }),
      focusSurveyCell: vi.fn(),
      subscribe: () => () => {},
    });

    freshTruthToReturn = { ...baseHomeTruth, onboardingState: "ONBOARDING" };
    const runtimeR1 = createMockRuntime(layoutRevR1);
    const containerA = (globalThis as any).document.createElement("div");
    const rootA = createRoot(containerA);

    await act(async () => {
      rootA.render(React.createElement(DriveHomeOverlay, { onClose: () => {}, runtime: runtimeR1 as any }));
    });

    const arriveBtnA = findNode(containerA, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnA).not.toBeNull();

    freshTruthToReturn = {
      ...baseHomeTruth,
      resident: true,
      onboardingState: "RESIDENT",
      homeGarageUnlocked: true,
      layoutRevision: layoutRevR2,
    };

    await act(async () => {
      triggerNodeClick(arriveBtnA);
    });

    const portalA = findNode(containerA, (n: any) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(portalA, "Foreign revision R2 in fresh residency must be rejected without fallback").toBeNull();

    // Subtest R2-B: Arrival fresh residency has null/missing frameId
    freshTruthToReturn = { ...baseHomeTruth, onboardingState: "ONBOARDING" };
    const containerB = (globalThis as any).document.createElement("div");
    const rootB = createRoot(containerB);
    await act(async () => {
      rootB.render(React.createElement(DriveHomeOverlay, { onClose: () => {}, runtime: runtimeR1 as any }));
    });
    const arriveBtnB = findNode(containerB, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    freshTruthToReturn = {
      ...baseHomeTruth,
      resident: true,
      onboardingState: "RESIDENT",
      homeGarageUnlocked: true,
      frameId: null,
    };
    await act(async () => {
      triggerNodeClick(arriveBtnB);
    });
    const portalB = findNode(containerB, (n: any) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(portalB, "Missing frameId in fresh residency must be rejected").toBeNull();

    // Subtest R2-C: Runtime layout revision changes while arrival response is held
    function createDeferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }
    const deferredResidencyC = createDeferred<Response>();
    let currentRuntimeRevC = layoutRevR1;
    const runtimeC = {
      ...createMockRuntime(layoutRevR1),
      getActiveLayoutRevisionId: () => currentRuntimeRevC,
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival")) {
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            homeGarageUnlocked: true,
            vehicleStorageLocation: "HOME",
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/players/me/home")) {
        return deferredResidencyC.promise;
      }
      return new Response("{}", { status: 200 });
    });
    deferredResidencyC.resolve(new Response(JSON.stringify(baseHomeTruth), { status: 200 }));
    const containerC = (globalThis as any).document.createElement("div");
    const rootC = createRoot(containerC);
    await act(async () => {
      rootC.render(React.createElement(DriveHomeOverlay, { onClose: () => {}, runtime: runtimeC as any }));
    });
    const arriveBtnC = findNode(containerC, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");

    const deferredFinalResidencyC = createDeferred<Response>();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival")) {
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            homeGarageUnlocked: true,
            vehicleStorageLocation: "HOME",
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/players/me/home")) {
        return deferredFinalResidencyC.promise;
      }
      return new Response("{}", { status: 200 });
    });
    await act(async () => {
      triggerNodeClick(arriveBtnC);
    });

    currentRuntimeRevC = "rev-changed-in-flight-99";
    deferredFinalResidencyC.resolve(
      new Response(
        JSON.stringify({
          ...baseHomeTruth,
          resident: true,
          onboardingState: "RESIDENT",
          homeGarageUnlocked: true,
        }),
        { status: 200 },
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const portalC = findNode(containerC, (n: any) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(portalC, "Runtime revision change mid-await must reject arrival").toBeNull();

    // Subtest R2-D: Builder final truth missing frameId or layoutRevision throws and displays error
    const builderPlotGeometry: StarterParcelGeometry = {
      plotId: "coast4_1",
      worldId: "seed-4242",
      layoutRevision: layoutRevR1,
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
        layoutRevision: layoutRevR1,
        sourceLayoutRevision: "a".repeat(64),
        layout: builderLayout,
        plots: [
          {
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            geometry: builderPlotGeometry,
          },
        ],
      },
    };
    let builderPostCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifest), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") builderPostCount++;
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevR1,
            geometry: builderPlotGeometry,
            completed: builderPostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (builderPostCount > 0) {
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              plotOwned: true,
              completed: true,
              plotId: "coast4_1",
              frameId: null,
              layoutRevision: layoutRevR1,
              geometry: builderPlotGeometry,
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
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevR1,
            completed: false,
            geometry: builderPlotGeometry,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const builderRuntime: any = {
      getOperatorUserId: () => "user-alice",
      getActiveLayoutRevisionId: () => layoutRevR1,
      claimStarterHome: vi.fn(),
      applyBlueprint: vi.fn(),
    };
    const containerD = (globalThis as any).document.createElement("div");
    const rootD = createRoot(containerD);
    await act(async () => {
      rootD.render(React.createElement(StarterPropertyOverlay, { onClose: () => {}, runtime: builderRuntime }));
    });
    const startBuildBtn = findNode(containerD, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    await act(async () => {
      triggerNodeClick(startBuildBtn);
    });
    const submitBuildBtn = findNode(containerD, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    await act(async () => {
      triggerNodeClick(submitBuildBtn);
    });

    expect(builderPostCount).toBe(1);
    const builderErrorNode = findNode(containerD, (n: any) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(builderErrorNode, "Missing frameId in final truth must display error").not.toBeNull();
    expect(builderRuntime.claimStarterHome).not.toHaveBeenCalled();

    // Subtest R2-E: Real Production Producer Positive with Actual ColonyRuntime
    // 1. Construct real canonical document from ColonyRuntime survey on COLONY.render.seed
    const surveyRt = new ColonyRuntime(COLONY.render.seed, { surveyOnly: true });
    const realCanonicalDoc = surveyRt.captureWorldLayout();
    const surfaceFrame = realCanonicalDoc.frames.find((f: any) => f.kind === "region" && f.layer === "surface")!;

    const survey = surveyStarterParcels({
      worldId: realCanonicalDoc.worldId,
      layoutRevision: realCanonicalDoc.revision.contentHash,
      parcels: surveyRt.lots(),
      roads: surveyRt.sim.state.roads,
      groundClear: (c) => cellOk(surveyRt.sim.state.terrain, c.x, c.y),
    });
    expect(survey.candidates.length).toBeGreaterThan(0);
    const realPlot = survey.candidates[0]!;

    const actualColonyRuntime = new ColonyRuntime(COLONY.render.seed, { initialWorldLayout: realCanonicalDoc });
    actualColonyRuntime.setOperatorUserId("user-alice");
    const citizen = (actualColonyRuntime as any).citizens?.list?.()[0];
    if (citizen) {
      vi.spyOn(actualColonyRuntime as any, "operatorCitizenId").mockReturnValue(citizen.id);
    }

    // Boundary assertion: runtime exposes formatted CAS token `wl:v1:1:${canonicalHash}`
    // while catalogue manifest and provider DTO expose bare content hash `${canonicalHash}`
    const expectedRuntimeToken = `wl:v1:${realCanonicalDoc.revision.number}:${realCanonicalDoc.revision.contentHash}`;
    expect(actualColonyRuntime.getActiveLayoutRevisionId()).toBe(expectedRuntimeToken);

    const doorE = houseDoor(realPlot);
    const hzE = realPlot.houseZone;
    const validScriptE = `house{w:${hzE.width} d:${hzE.depth} wallH:2 door:${doorE}} room{kind:living x:0 y:0 w:${hzE.width} d:${hzE.depth} win:1}`;

    const catalogueManifestE = {
      published: true,
      manifest: {
        schemaVersion: "citylife.starter-parcel-manifest/v1",
        worldId: realCanonicalDoc.worldId,
        layoutRevision: realCanonicalDoc.revision.contentHash, // bare 64-hex hash
        sourceLayoutRevision: realCanonicalDoc.revision.parentHash,
        layout: realCanonicalDoc,
        plots: [
          {
            plotId: realPlot.plotId,
            frameId: surfaceFrame.id,
            geometry: realPlot,
          },
        ],
      },
    };
    actualColonyRuntime.setStarterCatalogueManifest(catalogueManifestE.manifest as any);

    let producerPostCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifestE), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") producerPostCount++;
        return new Response(
          JSON.stringify({
            plotId: realPlot.plotId,
            frameId: surfaceFrame.id,
            layoutRevision: realCanonicalDoc.revision.contentHash,
            geometry: realPlot,
            completed: producerPostCount > 0,
            script: validScriptE,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (producerPostCount > 0) {
          // Exact 10-field HomeTruthResponse record from CitylifeHomePurchaseController.java
          return new Response(
            JSON.stringify({
              owned: true,
              status: "OWNED",
              neighbourhoodKey: realPlot.neighbourhoodKey,
              plotId: realPlot.plotId,
              onboardingState: "RESIDENT",
              plotOwned: true,
              requiresBuild: false,
              frameId: surfaceFrame.id,
              layoutRevision: realCanonicalDoc.revision.contentHash, // bare 64-hex hash
              priceKco: 10000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            owned: false,
            status: "PLOT_OWNED",
            neighbourhoodKey: realPlot.neighbourhoodKey,
            plotId: realPlot.plotId,
            onboardingState: "ONBOARDING",
            plotOwned: true,
            requiresBuild: true,
            frameId: surfaceFrame.id,
            layoutRevision: realCanonicalDoc.revision.contentHash, // bare 64-hex hash
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerE = (globalThis as any).document.createElement("div");
    const rootE = createRoot(containerE);
    await act(async () => {
      rootE.render(React.createElement(StarterPropertyOverlay, { onClose: () => {}, runtime: actualColonyRuntime }));
    });
    const startBuildBtnE = findNode(containerE, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBuildBtnE).not.toBeNull();
    await act(async () => {
      triggerNodeClick(startBuildBtnE);
    });
    const submitBuildBtnE = findNode(containerE, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBuildBtnE).not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBuildBtnE);
    });

    expect(producerPostCount).toBe(1);
    const confirmedNodeE = findNode(containerE, (n: any) => n.getAttribute?.("data-testid") === "home-builder-confirmed");
    expect(confirmedNodeE, "Real production producer 10-field response must confirm build on actual ColonyRuntime").not.toBeNull();
    const errorNodeE = findNode(containerE, (n: any) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(errorNodeE).toBeNull();
    expect(actualColonyRuntime.hasOperatorHome(), "ColonyRuntime must record operator home").toBe(true);
    const assignedLotE = actualColonyRuntime.lots().find((l) => l.id === realPlot.plotId);
    expect(assignedLotE?.blueprint).toBe(validScriptE);

    // Assert actualColonyRuntime.getOperatorHomeTarget() returns exact canonical target
    const opTargetE = actualColonyRuntime.getOperatorHomeTarget();
    expect(opTargetE, "Actual ColonyRuntime getOperatorHomeTarget must return valid target").not.toBeNull();
    expect(opTargetE).toEqual({
      x: Math.round(realPlot.spawn.x),
      y: Math.round(realPlot.spawn.y),
      lotId: realPlot.plotId,
      name: `Plot ${realPlot.plotId}`,
    });

    // Assert driveway resolves for 10-field truth without synthetic geometry
    const drivewayE = actualColonyRuntime.getPlayerHomeDriveway();
    expect(drivewayE, "Actual ColonyRuntime getPlayerHomeDriveway must resolve lot driveway").not.toBeNull();
    expect(drivewayE?.plotId).toBe(realPlot.plotId);
    expect(drivewayE?.cells.length).toBeGreaterThan(0);

    // Negative tests for getOperatorHomeTarget:
    // 1. Foreign layout revision returns null:
    const origTruthE = (actualColonyRuntime as any).authoritativeHomeTruth;
    (actualColonyRuntime as any).authoritativeHomeTruth = {
      ...origTruthE,
      layoutRevision: "foreign-rev-99999",
    };
    expect(actualColonyRuntime.getOperatorHomeTarget(), "Foreign revision must return null from getOperatorHomeTarget").toBeNull();

    // 2. Unknown plotId returns null (fail closed, never legacy hash fallback):
    (actualColonyRuntime as any).authoritativeHomeTruth = {
      ...origTruthE,
      plotId: "nonexistent-plot-999",
    };
    expect(actualColonyRuntime.getOperatorHomeTarget(), "Unknown plotId must fail closed and return null from getOperatorHomeTarget").toBeNull();
    expect(actualColonyRuntime.getPlayerHomeDriveway(), "Unknown plotId must return null from getPlayerHomeDriveway").toBeNull();
    expect(actualColonyRuntime.hasOperatorHome(), "Unknown plotId must return false from hasOperatorHome").toBe(false);

    // 3. Mismatched frameId returns null:
    (actualColonyRuntime as any).authoritativeHomeTruth = {
      ...origTruthE,
      frameId: "foreign-frame-99999",
    };
    expect(actualColonyRuntime.getOperatorHomeTarget(), "Mismatched frameId must return null from getOperatorHomeTarget").toBeNull();

    // Restore original authoritative truth
    (actualColonyRuntime as any).authoritativeHomeTruth = origTruthE;

    // Assert canonical grid size comes from sim terrain
    expect(actualColonyRuntime.getWorldGridSize()).toBe(actualColonyRuntime.sim.state.terrain.size);

    // Also mount DriveHomeOverlay with actualColonyRuntime
    actualColonyRuntime.setOperatorUserId("user-alice");
    actualColonyRuntime.setAuthoritativeOwnedVehicle({
      id: "showroom:karoo-x19-targa",
      model: "karoo-x19-targa",
      x: realPlot.spawn.x,
      y: realPlot.spawn.y,
      heading: 0,
    });
    let arrivalPostCountE = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/home-deed/drive-home-arrival") || url.includes("/home/arrival")) {
        arrivalPostCountE++;
        return new Response(
          JSON.stringify({
            plotId: realPlot.plotId,
            frameId: surfaceFrame.id,
            homeGarageUnlocked: true,
            vehicleStorageLocation: "HOME",
            onboardingState: "RESIDENT",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        return new Response(
          JSON.stringify({
            owned: true,
            status: "OWNED",
            neighbourhoodKey: realPlot.neighbourhoodKey,
            plotId: realPlot.plotId,
            onboardingState: arrivalPostCountE > 0 ? "RESIDENT" : "ONBOARDING",
            plotOwned: true,
            requiresBuild: false,
            frameId: surfaceFrame.id,
            layoutRevision: realCanonicalDoc.revision.contentHash, // bare 64-hex hash
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const containerDriveE = (globalThis as any).document.createElement("div");
    const rootDriveE = createRoot(containerDriveE);
    await act(async () => {
      rootDriveE.render(React.createElement(DriveHomeOverlay, { onClose: () => {}, runtime: actualColonyRuntime }));
    });
    const arriveBtnDriveE = findNode(containerDriveE, (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive");
    expect(arriveBtnDriveE).not.toBeNull();
    expect(arriveBtnDriveE.disabled).toBe(false);
    await act(async () => {
      triggerNodeClick(arriveBtnDriveE);
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    expect(arrivalPostCountE).toBe(1);
    const portalE = findNode(containerDriveE, (n: any) => n.getAttribute?.("data-testid") === "home-garage-portal");
    expect(portalE, "Actual ColonyRuntime arrival with CAS token runtime and bare truth hash must unlock portal").not.toBeNull();

    // Subtest R2-F: Discriminating negative for contradictory requiresBuild: true and status: "PLOT_OWNED"
    // 1. Direct unit check on parseHomeTruth
    const truthContradictory = parseHomeTruth({
      owned: true,
      status: "PLOT_OWNED",
      plotOwned: true,
      requiresBuild: false,
      plotId: "coast4_1",
      layoutRevision: layoutRevR1,
    });
    expect(truthContradictory?.completed, "status PLOT_OWNED must never be marked completed").toBe(false);
    expect(truthContradictory?.requiresBuild, "status PLOT_OWNED must require build").toBe(true);

    let negativePostCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/starter-catalogue")) {
        return new Response(JSON.stringify(catalogueManifest), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/home/build")) {
        if (init?.method === "POST") negativePostCount++;
        return new Response(
          JSON.stringify({
            plotId: "coast4_1",
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevR1,
            geometry: builderPlotGeometry,
            completed: negativePostCount > 0,
            script: validScript,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/players/me/home")) {
        if (negativePostCount > 0) {
          // Contradictory: owned=true and plotOwned=true, but requiresBuild=true
          return new Response(
            JSON.stringify({
              owned: true,
              status: "PLOT_OWNED",
              neighbourhoodKey: "coast4",
              plotId: "coast4_1",
              onboardingState: "ONBOARDING",
              plotOwned: true,
              requiresBuild: true,
              frameId: "frame-coast4-1",
              layoutRevision: layoutRevR1,
              priceKco: 10000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            owned: false,
            status: "PLOT_OWNED",
            neighbourhoodKey: "coast4",
            plotId: "coast4_1",
            onboardingState: "ONBOARDING",
            plotOwned: true,
            requiresBuild: true,
            frameId: "frame-coast4-1",
            layoutRevision: layoutRevR1,
            priceKco: 10000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const negativeProducerRuntime: any = {
      getOperatorUserId: () => "user-alice",
      getActiveLayoutRevisionId: () => `wl:v1:1:${layoutRevR1}`,
      claimStarterHome: vi.fn(),
      applyBlueprint: vi.fn(),
      subscribe: () => () => {},
    };
    const containerF = (globalThis as any).document.createElement("div");
    const rootF = createRoot(containerF);
    await act(async () => {
      rootF.render(React.createElement(StarterPropertyOverlay, { onClose: () => {}, runtime: negativeProducerRuntime }));
    });
    const startBuildBtnF = findNode(containerF, (n: any) => n.getAttribute?.("data-testid") === "home-build-start-btn");
    expect(startBuildBtnF).not.toBeNull();
    await act(async () => {
      triggerNodeClick(startBuildBtnF);
    });
    const submitBuildBtnF = findNode(containerF, (n: any) => n.getAttribute?.("data-testid") === "home-builder-submit");
    expect(submitBuildBtnF).not.toBeNull();
    await act(async () => {
      triggerNodeClick(submitBuildBtnF);
    });

    expect(negativePostCount).toBe(1);
    expect(negativeProducerRuntime.claimStarterHome).not.toHaveBeenCalled();
    const errorNodeF = findNode(containerF, (n: any) => n.getAttribute?.("data-testid") === "home-builder-error");
    expect(errorNodeF, "Contradictory requiresBuild: true must display error").not.toBeNull();

    vi.unstubAllGlobals();
  }, 120_000);
});


