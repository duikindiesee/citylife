import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import {
  clampToGrid,
  clampCell,
  homeTargetCell,
  dealershipStartCell,
  isWithinArrivalBounds,
  headingToHome,
  computeRouteGuidance,
  stepCell,
  boundedArrivalEvidence,
  classifyArrivalStatus,
  arrivalIdempotencyKey,
  homePlotRef,
  isResident,
  parseHomeResidency,
  isHomeGarageUnlocked,
  arrivalButtonView,
  arrivalStateColor,
  fetchHomeResidency,
  postHomeArrival,
  ARRIVAL_RADIUS_CELLS,
  type Cell,
} from "../src/colony/home/driveHome";
import { DriveHomeOverlay } from "../src/colony/ui/DriveHomeOverlay";
import { STARTER_PLACEMENT_GRID } from "../src/colony/home/starterHouseProjection";
import type { HomeTruth } from "../src/colony/home/starterProperty";
import { getAuthClient } from "../src/colony/authClient";
import { ColonyRuntime } from "../src/colony/runtime";
import { inspectFootprint, stepOwnedDrive } from "../src/colony/car/ownedDriving";
import { defaultCarSpec } from "../src/colony/car/carSpec";
import { deriveStats } from "../src/colony/car/carParts";
import { COLONY } from "../src/colony/config";

// PLAYER.HOME.1D.S2 — the dark, server-truth drive-home slice. Everything below is the pure model
// (geometry, guidance, classifiers, residency, button views) plus the fail-soft backend layer; no DOM.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function truth(over: Partial<HomeTruth> = {}): HomeTruth {
  return {
    owned: true,
    status: "OWNED",
    neighbourhoodKey: "coastal",
    plotId: "starter-home:demo-user",
    frameId: "starter-home-frame:demo-user",
    onboardingState: "OWNED",
    priceKco: 350,
    ...over,
  };
}

const NOT_OWNED: HomeTruth = {
  owned: false,
  status: null,
  neighbourhoodKey: null,
  plotId: null,
  frameId: null,
  onboardingState: "NONE",
  priceKco: null,
};

describe("driveHome — grid clamp", () => {
  it("rounds and clamps any coordinate into [0, grid-1]", () => {
    expect(clampToGrid(-5)).toBe(0);
    expect(clampToGrid(1000)).toBe(STARTER_PLACEMENT_GRID - 1);
    expect(clampToGrid(3.4)).toBe(3);
    expect(clampToGrid(Number.NaN)).toBe(0);
    expect(clampToGrid(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampCell({ x: -1, y: 99999 })).toEqual({
      x: 0,
      y: STARTER_PLACEMENT_GRID - 1,
    });
  });
});

describe("driveHome — server-derived destination (never client-authored)", () => {
  it("returns the SAME cell PLAYER.HOME.1C projects the house onto — deterministic across devices", () => {
    const a = homeTargetCell(truth());
    const b = homeTargetCell(truth());
    expect(a).not.toBeNull();
    expect(a).toEqual(b); // same deed → same cell, always (refresh / relogin / second device)
    expect(a!.x).toBeGreaterThanOrEqual(0);
    expect(a!.x).toBeLessThan(STARTER_PLACEMENT_GRID);
  });
  it("is null unless the truth is unambiguously OWNED, and null on a reference-less deed", () => {
    expect(homeTargetCell(null)).toBeNull();
    expect(homeTargetCell(NOT_OWNED)).toBeNull();
    expect(
      homeTargetCell(truth({ owned: true, status: "PENDING" })),
    ).toBeNull();
    expect(
      homeTargetCell(
        truth({ plotId: null, frameId: null, neighbourhoodKey: null }),
      ),
    ).toBeNull();
  });
  it("seeds a deterministic dealership start that never coincides with the home cell", () => {
    const start = dealershipStartCell(truth());
    const home = homeTargetCell(truth());
    expect(start).not.toBeNull();
    expect(start).toEqual(dealershipStartCell(truth())); // deterministic
    expect(start).not.toEqual(home); // would trivially auto-arrive otherwise
    expect(dealershipStartCell(null)).toBeNull();
  });
});

describe("driveHome — arrival bounds + heading (route recovery is inherent)", () => {
  const home: Cell = { x: 30, y: 30 };
  it("counts as arrived only inside the Chebyshev plot radius", () => {
    expect(isWithinArrivalBounds({ x: 30, y: 30 }, home)).toBe(true);
    expect(
      isWithinArrivalBounds({ x: 30 + ARRIVAL_RADIUS_CELLS, y: 30 }, home),
    ).toBe(true);
    expect(
      isWithinArrivalBounds({ x: 30 + ARRIVAL_RADIUS_CELLS + 1, y: 30 }, home),
    ).toBe(false);
  });
  it("points toward home from every quadrant and is null once inside", () => {
    expect(headingToHome({ x: 30, y: 50 }, home)).toBe("N");
    expect(headingToHome({ x: 30, y: 10 }, home)).toBe("S");
    expect(headingToHome({ x: 10, y: 30 }, home)).toBe("E");
    expect(headingToHome({ x: 50, y: 30 }, home)).toBe("W");
    expect(headingToHome({ x: 10, y: 50 }, home)).toBe("NE");
    expect(headingToHome({ x: 50, y: 10 }, home)).toBe("SW");
    expect(headingToHome({ x: 30, y: 30 }, home)).toBeNull();
  });
  it("recomputes purely from the CURRENT position — straying just re-points home (route recovery)", () => {
    // Overshoot past home on the x-axis: the heading flips to keep pointing back at the plot.
    expect(headingToHome({ x: 20, y: 30 }, home)).toBe("E");
    expect(headingToHome({ x: 40, y: 30 }, home)).toBe("W");
  });
});

describe("driveHome — guidance (fail-closed on missing destination)", () => {
  it("fails closed to a neutral 'waiting' guidance when position or destination is missing", () => {
    const g = computeRouteGuidance(null, { x: 1, y: 1 });
    expect(g.arrived).toBe(false);
    expect(g.heading).toBeNull();
    expect(g.distance).toBe(Number.POSITIVE_INFINITY);
    expect(computeRouteGuidance({ x: 1, y: 1 }, null).instruction).toMatch(
      /waiting/i,
    );
  });
  it("reports remaining distance and an arrived flag inside the plot", () => {
    const home: Cell = { x: 10, y: 10 };
    const far = computeRouteGuidance({ x: 10, y: 40 }, home);
    expect(far.arrived).toBe(false);
    expect(far.distance).toBe(30 - ARRIVAL_RADIUS_CELLS);
    expect(far.heading).toBe("N");
    const here = computeRouteGuidance({ x: 10, y: 10 }, home);
    expect(here.arrived).toBe(true);
    expect(here.distance).toBe(0);
    expect(here.heading).toBeNull();
  });
});

describe("driveHome — driving cursor step (clamped)", () => {
  it("moves one cell per compass press and never leaves the grid", () => {
    expect(stepCell({ x: 5, y: 5 }, "up")).toEqual({ x: 5, y: 4 });
    expect(stepCell({ x: 5, y: 5 }, "down")).toEqual({ x: 5, y: 6 });
    expect(stepCell({ x: 5, y: 5 }, "left")).toEqual({ x: 4, y: 5 });
    expect(stepCell({ x: 5, y: 5 }, "right")).toEqual({ x: 6, y: 5 });
    expect(stepCell({ x: 0, y: 0 }, "up")).toEqual({ x: 0, y: 0 }); // clamped
    const max = STARTER_PLACEMENT_GRID - 1;
    expect(stepCell({ x: max, y: max }, "right")).toEqual({ x: max, y: max });
  });
});

describe("driveHome — bounded arrival evidence", () => {
  it("clamps the observed cell and reports the local in-bounds signal only", () => {
    const home: Cell = { x: 20, y: 20 };
    const inside = boundedArrivalEvidence({ x: 21, y: 20 }, home);
    expect(inside.cell).toEqual({ x: 21, y: 20 });
    expect(inside.withinBounds).toBe(true);
    const out = boundedArrivalEvidence({ x: 999, y: -5 }, home);
    expect(out.cell).toEqual({ x: STARTER_PLACEMENT_GRID - 1, y: 0 }); // clamped, never out of range
    expect(out.withinBounds).toBe(false);
  });

  it("reconciles legacy 64 boundary home without overflowing beyond 63", () => {
    // Review 150 counterexample: legacy 64 grid/home(63,63), current(999,63) must clamp to (63,63), not 65
    const legacyHome: Cell = { x: 63, y: 63 };
    const boundaryArrival = boundedArrivalEvidence({ x: 999, y: 63 }, legacyHome);
    expect(boundaryArrival.cell).toEqual({ x: 63, y: 63 });
    expect(boundaryArrival.withinBounds).toBe(true);

    const boundaryOut = boundedArrivalEvidence({ x: 999, y: 0 }, legacyHome);
    expect(boundaryOut.cell).toEqual({ x: 63, y: 0 });
    expect(boundaryOut.withinBounds).toBe(false);

    // Dealership start cell also stays within [0, 63]
    const dealerStart = dealershipStartCell(truth({ x: 63, y: 63, plotId: "legacy_63" }));
    expect(dealerStart).not.toBeNull();
    expect(dealerStart!.x).toBeLessThan(STARTER_PLACEMENT_GRID);
    expect(dealerStart!.y).toBeLessThan(STARTER_PLACEMENT_GRID);
  });

  it("supports canonical 608 layout grid coordinates and enforces 608 bounds", () => {
    const canonicalHome: Cell = { x: 150, y: 200 };
    // Inside arrival radius on 608 layout
    const canonicalInside = boundedArrivalEvidence({ x: 151, y: 200 }, canonicalHome, ARRIVAL_RADIUS_CELLS, 608);
    expect(canonicalInside.cell).toEqual({ x: 151, y: 200 });
    expect(canonicalInside.withinBounds).toBe(true);

    // Outside bounds on 608 layout: clamps to 607 (608 - 1), never 63
    const canonicalFar = boundedArrivalEvidence({ x: 999, y: 200 }, canonicalHome, ARRIVAL_RADIUS_CELLS, 608);
    expect(canonicalFar.cell).toEqual({ x: 607, y: 200 });
    expect(canonicalFar.withinBounds).toBe(false);
  });
});

describe("driveHome — arrival status classification (idempotent duplicate = pending)", () => {
  it("maps every meaningful status to a closed outcome", () => {
    expect(classifyArrivalStatus(200)).toEqual({ kind: "confirmed" });
    expect(classifyArrivalStatus(201)).toEqual({ kind: "confirmed" });
    expect(classifyArrivalStatus(202)).toEqual({ kind: "pending" });
    expect(classifyArrivalStatus(409)).toEqual({ kind: "pending" }); // duplicate arrival replay
    expect(classifyArrivalStatus(422)).toEqual({ kind: "rejected" });
    expect(classifyArrivalStatus(401)).toEqual({ kind: "disabled" });
    expect(classifyArrivalStatus(403)).toEqual({ kind: "disabled" });
    expect(classifyArrivalStatus(503)).toEqual({ kind: "disabled" });
    expect(classifyArrivalStatus(500)).toEqual({ kind: "error", status: 500 });
  });
});

describe("driveHome — idempotency + plot reference (server-owned)", () => {
  it("is stable per (user, plot) so a double-tap can never record a second arrival", () => {
    expect(arrivalIdempotencyKey("u1", "plot-a")).toBe(
      arrivalIdempotencyKey("u1", "plot-a"),
    );
    expect(arrivalIdempotencyKey("u1", "plot-a")).not.toBe(
      arrivalIdempotencyKey("u2", "plot-a"),
    );
  });
  it("keys the arrival to the deed's server plot/frame/neighbourhood, never a client value", () => {
    expect(homePlotRef(truth())).toBe("starter-home:demo-user");
    expect(homePlotRef(truth({ plotId: null }))).toBe(
      "starter-home-frame:demo-user",
    );
    expect(homePlotRef(truth({ plotId: null, frameId: null }))).toBe("coastal");
    expect(homePlotRef(NOT_OWNED)).toBeNull();
  });
});

describe("driveHome — residency + home-garage unlock (fail-closed on ambiguity)", () => {
  it("is RESIDENT only on an owned deed whose onboarding state reads RESIDENT", () => {
    expect(isResident(truth({ onboardingState: "RESIDENT" }))).toBe(true);
    expect(isResident(truth({ onboardingState: "OWNED" }))).toBe(false);
    expect(isResident(NOT_OWNED)).toBe(false);
    expect(isResident(null)).toBe(false);
  });
  it("parses residency and unlocks the garage only on the server-confirmed RESIDENT truth", () => {
    const owned = parseHomeResidency({
      owned: true,
      status: "OWNED",
      onboardingState: "OWNED",
      plotId: "p",
    });
    expect(owned.resident).toBe(false);
    expect(owned.garageUnlocked).toBe(false);
    expect(isHomeGarageUnlocked(owned)).toBe(false);

    const res = parseHomeResidency({
      owned: true,
      status: "OWNED",
      onboardingState: "RESIDENT",
      plotId: "p",
    });
    expect(res.resident).toBe(true);
    expect(res.garageUnlocked).toBe(true);
    expect(isHomeGarageUnlocked(res)).toBe(true);
  });
  it("an explicit server garage-lock always wins over the RESIDENT signal", () => {
    const res = parseHomeResidency({
      owned: true,
      status: "OWNED",
      onboardingState: "RESIDENT",
      plotId: "p",
      homeGarageUnlocked: false,
    });
    expect(res.resident).toBe(true);
    expect(res.garageUnlocked).toBe(false);
    expect(isHomeGarageUnlocked(res)).toBe(false);
  });
  it("fails closed on a malformed body and a null residency", () => {
    const bad = parseHomeResidency("nope");
    expect(bad.truth).toBeNull();
    expect(bad.resident).toBe(false);
    expect(isHomeGarageUnlocked(bad)).toBe(false);
    expect(isHomeGarageUnlocked(null)).toBe(false);
  });
});

describe("driveHome — arrival button view (thin, exhaustive)", () => {
  it("is 'far' (disabled) until inside the plot, then 'ready'", () => {
    expect(arrivalButtonView(false, false, false, undefined).state).toBe("far");
    expect(arrivalButtonView(false, false, false, undefined).disabled).toBe(
      true,
    );
    const ready = arrivalButtonView(false, true, false, undefined);
    expect(ready.state).toBe("ready");
    expect(ready.disabled).toBe(false);
  });
  it("shows a disabled in-flight pending and never re-fires while processing", () => {
    expect(arrivalButtonView(false, true, true, undefined).state).toBe(
      "pending",
    );
    expect(arrivalButtonView(false, true, true, undefined).disabled).toBe(true);
    expect(
      arrivalButtonView(false, true, false, { kind: "pending" }).disabled,
    ).toBe(true);
  });
  it("renders each settled outcome; a confirmed RESIDENT truth locks the control", () => {
    expect(arrivalButtonView(true, true, false, undefined).state).toBe(
      "confirmed",
    );
    expect(arrivalButtonView(true, true, false, undefined).disabled).toBe(true);
    expect(
      arrivalButtonView(false, true, false, { kind: "rejected" }).state,
    ).toBe("rejected");
    expect(
      arrivalButtonView(false, true, false, { kind: "disabled" }).state,
    ).toBe("disabled");
    expect(arrivalButtonView(false, true, false, { kind: "error" }).state).toBe(
      "error",
    );
    // A colour exists for every state.
    for (const s of [
      "far",
      "ready",
      "pending",
      "confirmed",
      "rejected",
      "disabled",
      "error",
    ] as const) {
      expect(arrivalStateColor(s)).toMatch(/^#/);
    }
  });
});

describe("driveHome — residency fetch (best-effort, fail-soft)", () => {
  it("returns null when signed out and never calls the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue(null);
    expect(await fetchHomeResidency()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("returns null on a non-ok / thrown read (endpoint absent while it ships)", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    expect(await fetchHomeResidency()).toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await fetchHomeResidency()).toBeNull();
  });
  it("parses the RESIDENT truth into an unlocked residency", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        owned: true,
        status: "OWNED",
        onboardingState: "RESIDENT",
        plotId: "starter-home:demo-user",
        frameId: "starter-home-frame:demo-user",
        neighbourhoodKey: "coastal",
      }),
    }));
    const res = await fetchHomeResidency();
    expect(res?.resident).toBe(true);
    expect(isHomeGarageUnlocked(res)).toBe(true);
  });
});

describe("driveHome — POST arrival (server authority, bounded evidence only)", () => {
  it("refuses locally WITHOUT any network call when there is no owned home", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    expect(await postHomeArrival({ x: 0, y: 0 }, NOT_OWNED)).toEqual({
      kind: "disabled",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("refuses locally WITHOUT posting when not inside the owned plot cells", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    const home = homeTargetCell(truth())!;
    const far: Cell = {
      x: (home.x + STARTER_PLACEMENT_GRID / 2) % STARTER_PLACEMENT_GRID,
      y: (home.y + STARTER_PLACEMENT_GRID / 2) % STARTER_PLACEMENT_GRID,
    };
    expect(await postHomeArrival(far, truth())).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("is disabled (never posts) when signed out even if in bounds", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue(null);
    const home = homeTargetCell(truth())!;
    expect(await postHomeArrival(home, truth())).toEqual({ kind: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("posts the clamped cell + server plot echo ONLY, with a bearer + stable idempotency key", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    let url = "";
    let init: RequestInit = {};
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          plotId: "starter-home:demo-user",
          frameId: "starter-home-frame:demo-user",
          homeGarageUnlocked: true,
          vehicleStorageLocation: "HOME",
        }),
      };
    });
    const home = homeTargetCell(truth())!;
    const r = await postHomeArrival(home, truth(), {
      plotId: "starter-home:demo-user",
      frameId: "starter-home-frame:demo-user",
      vehicleKey: "karoo-x19-targa",
    });
    expect(r.kind).toBe("confirmed");
    expect(url).toBe(
      "/kooker/api/v1/citylife/players/me/home-deed/drive-home-arrival",
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt.tok");
    expect(headers["Idempotency-Key"]).toContain("starter-home:demo-user");
    // Authoritative payload: cell, plotRef, plotId, frameId, vehicleKey
    expect(JSON.parse(init.body as string)).toEqual({
      plotId: "starter-home:demo-user",
      frameId: "starter-home-frame:demo-user",
      vehicleKey: "karoo-x19-targa",
      cell: home,
      plotRef: "starter-home:demo-user",
    });
  });
  it("maps a 409 duplicate to a neutral pending replay and a 422 to rejected", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    const home = homeTargetCell(truth())!;
    const arrivalOpts = {
      plotId: "starter-home:demo-user",
      frameId: "starter-home-frame:demo-user",
      vehicleKey: "karoo-x19-targa",
    };
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        plotId: "starter-home:demo-user",
        frameId: "starter-home-frame:demo-user",
        homeGarageUnlocked: true,
        vehicleStorageLocation: "HOME",
        alreadyArrived: true,
      }),
    }));
    expect(await postHomeArrival(home, truth(), arrivalOpts)).toEqual({
      kind: "pending",
      receipt: {
        plotId: "starter-home:demo-user",
        frameId: "starter-home-frame:demo-user",
        homeGarageUnlocked: true,
        homeGarageUnlockedAt: null,
        vehicleStorageLocation: "HOME",
        onboardingState: null,
        alreadyArrived: true,
      },
    });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 422 }));
    expect(await postHomeArrival(home, truth(), arrivalOpts)).toEqual({
      kind: "rejected",
    });
  });
  it("maps a thrown/network failure to a transient error", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const home = homeTargetCell(truth())!;
    expect(
      await postHomeArrival(home, truth(), {
        plotId: "starter-home:demo-user",
        frameId: "starter-home-frame:demo-user",
        vehicleKey: "karoo-x19-targa",
      }),
    ).toEqual({ kind: "error" });
  });
  it("fails closed locally without POSTing when required identity (vehicleKey) is missing", async () => {
    vi.spyOn(getAuthClient(), "getValidToken").mockResolvedValue("jwt.tok");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const home = homeTargetCell(truth())!;
    const res = await postHomeArrival(home, truth(), {
      plotId: "starter-home:demo-user",
      frameId: "starter-home-frame:demo-user",
      vehicleKey: null,
    });
    expect(res).toEqual({ kind: "rejected" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

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
      getAttribute: (attr: string) => (baseNode[attr] as unknown) ?? (propsStore[attr] as unknown) ?? null,
      setAttribute: (attr: string, val: any) => {
        baseNode[attr] = val;
        propsStore[attr] = val;
      },
      removeAttribute: (attr: string) => {
        delete baseNode[attr];
        delete propsStore[attr];
      },
      hasAttribute: (attr: string) => baseNode[attr] != null || propsStore[attr] != null,
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        if (!nodeListeners.has(evt)) nodeListeners.set(evt, new Set());
        nodeListeners.get(evt)!.add(fn);
      },
      removeEventListener: (evt: string, fn: (e: unknown) => void) => {
        nodeListeners.get(evt)?.delete(fn);
      },
      dispatchEvent: () => {},
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

describe("driveHome — C1-C3 physical controller, authority fencing, and mounted regression battery", () => {
  let rt: ColonyRuntime;

  beforeAll(() => {
    rt = new ColonyRuntime(4242);
  }, 60_000);

  beforeEach(() => {
    rt.setOperatorUserId("demo-user");
    rt.getActiveLayoutRevisionId = () => "canonical-rev-4242";
    rt.setAuthoritativeHomeTruth(null);
    rt.setAuthoritativeOwnedVehicle({
      id: "karoo-x19-targa",
      model: "karoo-x19-targa",
      x: 491,
      y: 366,
      heading: 0,
    });
    (rt as any).sim.state.buildings = (rt as any).sim.state.buildings.filter(
      (b: any) => !(b.x === 492 && b.y === 366),
    );
    (rt as any).multiplayerClient = null;
    (rt as any).ownedDriveSeated = false;
    (rt as any).guidedDriveActiveUntil = 0;
    (rt as any).guidedTargetHeading = null;
  });

  it("ensures guided control burst of taps without elapsed ticks produces zero physical displacement", () => {
    const initialPos = rt.getPhysicalCarPosition()!;
    expect(initialPos).not.toBeNull();
    expect(initialPos.x).toBe(491);
    expect(initialPos.y).toBe(366);

    // Burst of 5 taps in a row without advancing simulation ticks
    for (let i = 0; i < 5; i++) {
      const accepted = rt.stepGuidedDrive("right");
      expect(accepted).toBe(true);
    }

    const poseAfterBurst = rt.getOwnedDrivePose()!;
    expect(poseAfterBurst.x).toBe(491);
    expect(poseAfterBurst.y).toBe(366);
    expect(poseAfterBurst.speed).toBe(0);
    // Distance moved without elapsed ticks is strictly 0
    expect(Math.hypot(poseAfterBurst.x - initialPos.x, poseAfterBurst.y - initialPos.y)).toBe(0);
    // Intent is expressed in ownedDriveInput
    expect((rt as any).ownedDriveInput.throttle).toBe(true);
  });

  it("consumes guided driving input over actual simulation ticks with finite bounded displacement and speed limits", () => {
    const initialPos = rt.getPhysicalCarPosition()!;
    rt.stepGuidedDrive("right");

    // Advance 5 simulation ticks of 0.1s each
    for (let i = 0; i < 5; i++) {
      rt.tickOwnedDrive(0.1);
    }

    const finalPose = rt.getOwnedDrivePose()!;
    const distMoved = Math.hypot(finalPose.x - initialPos.x, finalPose.y - initialPos.y);
    expect(distMoved).toBeGreaterThan(0.1);
    expect(distMoved).toBeLessThan(4.0); // finite and bounded
    expect(finalPose.speed).toBeGreaterThan(0);
    expect(finalPose.speed).toBeLessThanOrEqual(COLONY.ownedDriving.topSpeedMps);
  });

  it("detects obstacle and corner footprint collisions in guided driving and refuses input without seating", () => {
    // Add building obstacle directly to the right at (492, 366)
    rt.sim.state.buildings.push({ x: 492, y: 366 } as any);

    // Guided step into obstacle is rejected
    expect(rt.stepGuidedDrive("right")).toBe(false);

    // Car does not move and speed remains 0
    const pos = rt.getPhysicalCarPosition()!;
    expect(pos.x).toBe(491);
    expect(pos.y).toBe(366);
    expect((rt as any).ownedDrivePose.speed).toBe(0);
    expect(rt.isOwnedDriveSeated()).toBe(false);
  });

  it("fails closed and preserves seat and pose on mismatched layout revision, foreign seed, unowned truth, or mismatched geometry", () => {
    // 1. Mismatched revision
    rt.setAuthoritativeHomeTruth({
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_1",
      frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
      layoutRevision: "mismatched-rev-xxx",
      onboardingState: "OWNED",
      priceKco: 350,
    });
    expect(rt.stepGuidedDrive("down")).toBe(false);
    expect((rt as any).ownedDriveSeated).toBe(false);

    // 2. Foreign seed in frameId
    rt.setAuthoritativeHomeTruth({
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_1",
      frameId: "universe:citylife:world:seed-9999:region:surface:region:player-parcel-wood1_plot_1",
      layoutRevision: "canonical-rev-4242",
      onboardingState: "OWNED",
      priceKco: 350,
    });
    expect(rt.stepGuidedDrive("down")).toBe(false);
    expect((rt as any).ownedDriveSeated).toBe(false);

    // 3. Unowned truth
    rt.setAuthoritativeHomeTruth({
      owned: false,
      status: null,
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_1",
      frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
      layoutRevision: "canonical-rev-4242",
      onboardingState: "UNOWNED",
      priceKco: 350,
      geometry: {
        plotId: "wood1_plot_1",
        driveway: [{ x: 491, y: 365 }],
      },
    });
    expect(rt.stepGuidedDrive("down")).toBe(false);
    expect((rt as any).ownedDriveSeated).toBe(false);

    // 4. Mismatched nested geometry plotId
    rt.setAuthoritativeHomeTruth({
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_1",
      frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
      layoutRevision: "canonical-rev-4242",
      onboardingState: "OWNED",
      priceKco: 350,
      geometry: {
        plotId: "foreign_plot_99",
        driveway: [{ x: 491, y: 365 }],
      },
    });
    expect(rt.stepGuidedDrive("down")).toBe(false);
    expect((rt as any).ownedDriveSeated).toBe(false);

    // 5. Unauthenticated operator
    rt.setOperatorUserId(null);
    expect(rt.stepGuidedDrive("down")).toBe(false);
    expect((rt as any).ownedDriveSeated).toBe(false);
  });

  it("strictly denies owner-driveway exemption to unowned HomeTruth geometry and fences solid house bounds", () => {
    // Unowned HomeTruth with geometry MUST NOT receive driveway exemption
    const unownedTruth: HomeTruth = {
      owned: false,
      status: null,
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_1",
      frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
      layoutRevision: "canonical-rev-4242",
      onboardingState: "UNOWNED",
      priceKco: 350,
      geometry: {
        plotId: "wood1_plot_1",
        driveway: [
          { x: 491, y: 363 },
          { x: 491, y: 364 },
          { x: 491, y: 365 },
        ],
        spawn: { x: 491, y: 363 },
      },
    };
    rt.setAuthoritativeHomeTruth(unownedTruth);
    // Unowned geometry MUST return false and parcel reason
    expect((rt as any).isHomesteadDriveway(491, 364)).toBe(false);
    expect((rt as any).blockedStepReason(491, 364)).toBe("parcel");

    // Owned HomeTruth with solid houseZone
    const ownedTruth: HomeTruth = {
      ...unownedTruth,
      owned: true,
      status: "OWNED",
      onboardingState: "OWNED",
      x: 491,
      y: 361,
      geometry: {
        ...unownedTruth.geometry!,
        door: { x: 491, y: 361 },
        houseZone: { x: 490, y: 358, width: 4, depth: 3 },
      },
    };
    rt.setAuthoritativeHomeTruth(ownedTruth);

    // Inside solid houseZone (491, 359)
    expect((rt as any).isHomesteadDriveway(491, 359)).toBe(false);
    expect((rt as any).blockedStepReason(491, 359)).toBe("building");

    // On driveway (491, 364)
    expect((rt as any).isHomesteadDriveway(491, 364)).toBe(true);
    expect((rt as any).blockedStepReason(491, 364)).toBeNull();
  });

  it("enforces anchored world seed matching in frameId across propertyRoadEntrance, isHomesteadDriveway, and stepGuidedDrive", () => {
    const baseTruth: HomeTruth = {
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_1",
      frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
      layoutRevision: "canonical-rev-4242",
      onboardingState: "OWNED",
      priceKco: 350,
      geometry: {
        plotId: "wood1_plot_1",
        driveway: [
          { x: 491, y: 363 },
          { x: 491, y: 364 },
          { x: 491, y: 365 },
        ],
        spawn: { x: 491, y: 363 },
      },
    };

    // Negative 1: worldSeed=424 must reject seed-4242 (prefix bypass prevention)
    const rt424 = new ColonyRuntime(424);
    rt424.setOperatorUserId("demo-user");
    rt424.getActiveLayoutRevisionId = () => "canonical-rev-424";
    rt424.setAuthoritativeOwnedVehicle({
      id: "karoo-x19-targa",
      model: "karoo-x19-targa",
      x: 491,
      y: 366,
      heading: 0,
    });
    const prefixSpoofTruth: HomeTruth = {
      ...baseTruth,
      layoutRevision: "canonical-rev-424",
    };
    rt424.setAuthoritativeHomeTruth(prefixSpoofTruth);
    expect(rt424.stepGuidedDrive("down")).toBe(false);
    expect(rt424.isHomesteadDriveway(491, 364)).toBe(false);
    expect((rt424 as any).propertyRoadEntrance(prefixSpoofTruth)).toBeNull();

    // Negative 2: worldSeed=4242 must reject seed-42420 (suffix bypass prevention)
    const suffixSpoofTruth: HomeTruth = {
      ...baseTruth,
      frameId: "universe:citylife:world:seed-42420:region:surface:region:player-parcel-wood1_plot_1",
    };
    rt.setAuthoritativeHomeTruth(suffixSpoofTruth);
    expect(rt.stepGuidedDrive("down")).toBe(false);
    expect(rt.isHomesteadDriveway(491, 364)).toBe(false);
    expect((rt as any).propertyRoadEntrance(suffixSpoofTruth)).toBeNull();

    // Negative 3: worldSeed=4242 must reject spoofed downstream segment containing seed-4242
    const segmentSpoofTruth: HomeTruth = {
      ...baseTruth,
      frameId: "universe:citylife:world:seed-9999:region:surface:region:seed-4242",
    };
    rt.setAuthoritativeHomeTruth(segmentSpoofTruth);
    expect(rt.stepGuidedDrive("down")).toBe(false);
    expect(rt.isHomesteadDriveway(491, 364)).toBe(false);
    expect((rt as any).propertyRoadEntrance(segmentSpoofTruth)).toBeNull();

    // Positive control 1: world-level frameId "universe:citylife:world:seed-4242"
    const worldFrameTruth: HomeTruth = {
      ...baseTruth,
      frameId: "universe:citylife:world:seed-4242",
    };
    rt.setAuthoritativeHomeTruth(worldFrameTruth);
    expect(rt.isHomesteadDriveway(491, 364)).toBe(true);
    expect((rt as any).propertyRoadEntrance(worldFrameTruth)).not.toBeNull();
    expect(rt.stepGuidedDrive("right")).toBe(true);

    // Positive control 2: full parcel frameId
    rt.setAuthoritativeHomeTruth(baseTruth);
    expect(rt.isHomesteadDriveway(491, 364)).toBe(true);
    expect((rt as any).propertyRoadEntrance(baseTruth)).not.toBeNull();
    expect(rt.stepGuidedDrive("right")).toBe(true);
  });

  it("clears authoritativeHomeTruth and resets input on operator user switch to eliminate stale geometry retention", () => {
    rt.setOperatorUserId("user-alice");
    rt.setAuthoritativeHomeTruth({
      owned: true,
      status: "OWNED",
      neighbourhoodKey: "wood1",
      plotId: "wood1_plot_1",
      frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
      layoutRevision: "canonical-rev-4242",
      onboardingState: "OWNED",
      priceKco: 350,
      geometry: {
        plotId: "wood1_plot_1",
        driveway: [{ x: 491, y: 363 }],
      },
    });
    expect(rt.getAuthoritativeHomeTruth()).not.toBeNull();

    // Switch account to user-bob
    rt.setOperatorUserId("user-bob");
    expect(rt.getAuthoritativeHomeTruth()).toBeNull();
    expect((rt as any).ownedDrivePose).toBeNull();
    expect((rt as any).guidedDriveActiveUntil).toBe(0);
  });

  it("synchronizes protocol 2 directional steer/throttle parity and protocol 1 speed/heading loopback", () => {
    const drivingInputs: any[] = [];
    const poses: any[] = [];
    const mockMultiplayer = {
      getStatus: () => "connected",
      getModeEpoch: () => 1,
      getProtocolVersion: () => 1,
      sendDrivingInput: (inp: any) => drivingInputs.push(inp),
      sendPose: (p: any) => poses.push(p),
    };
    (rt as any).multiplayerClient = mockMultiplayer;
    (rt as any).lastMultiplayerInputSentAt = 0;

    // Guided drive "down" (heading PI/2) from heading 0 (east) requires right steering
    const accepted = rt.stepGuidedDrive("down");
    expect(accepted).toBe(true);

    expect(drivingInputs.length).toBeGreaterThan(0);
    const lastInput = drivingInputs[drivingInputs.length - 1];
    expect(lastInput.throttle).toBe(1);
    expect(lastInput.steer).toBe(1); // Right steering towards south!

    // Tick simulation
    rt.tickOwnedDrive(0.1);
    expect(poses.length).toBeGreaterThan(0);
    const lastPose = poses[poses.length - 1];
    expect(lastPose.speed).toBeGreaterThan(0); // Real speed, not forced 0
    expect(lastPose.mode).toBe("driving");
  });

  it("mounts DriveHomeOverlay and proves physical vehicle arrival gating: disabled when away, 0 POSTs on click, enabled when arrived", async () => {
    setupTestDOM();
    const auth = getAuthClient();
    vi.spyOn(auth, "operator", "get").mockReturnValue({
      id: "Demo User",
      userId: "demo-user",
      scopes: [],
      roles: ["CITYLIFE_PLAYER"],
    });
    vi.spyOn(auth, "isAuthenticated", "get").mockReturnValue(true);
    vi.spyOn(auth, "getValidToken").mockResolvedValue("jwt.tok");

    let arrivalPostCount = 0;
    const targetHome = { x: 491, y: 361 };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("arrival")) {
          arrivalPostCount++;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                plotId: "wood1_plot_1",
                frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
                homeGarageUnlocked: true,
                vehicleStorageLocation: "HOME",
                onboardingState: "RESIDENT",
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
        if (url.includes("/players/me/home")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                owned: true,
                status: "OWNED",
                neighbourhoodKey: "wood1",
                plotId: "wood1_plot_1",
                frameId: "universe:citylife:world:seed-4242:region:surface:region:player-parcel-wood1_plot_1",
                layoutRevision: "canonical-rev-4242",
                onboardingState: arrivalPostCount > 0 ? "RESIDENT" : "ONBOARDING",
                x: targetHome.x,
                y: targetHome.y,
                priceKco: 350,
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );

    // Place vehicle 5 cells away from home (outside arrival radius 2)
    rt.setAuthoritativeOwnedVehicle({
      id: "karoo-x19-targa",
      model: "karoo-x19-targa",
      x: 491,
      y: 366,
      heading: 0,
    });

    const container = (globalThis as any).document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(DriveHomeOverlay, {
          onClose: () => {},
          runtime: rt as any,
        }),
      );
    });

    // Allow fetchHomeResidency to resolve
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    const arriveBtn = findNode(
      container,
      (n: any) => n.getAttribute?.("data-testid") === "drive-home-arrive",
    );
    expect(arriveBtn).not.toBeNull();
    // Disabled while vehicle is physically away
    expect(arriveBtn.getAttribute("data-arrival-state")).toBe("far");
    expect(arriveBtn.disabled).toBe(true);

    // Clicking while away produces 0 arrival POSTs
    await act(async () => {
      triggerNodeClick(arriveBtn);
    });
    expect(arrivalPostCount).toBe(0);

    // Move physical vehicle into arrival radius (x: 491, y: 362 -> distance 1 <= 2)
    rt.setAuthoritativeOwnedVehicle({
      id: "karoo-x19-targa",
      model: "karoo-x19-targa",
      x: 491,
      y: 362,
      heading: 0,
    });
    await act(async () => {
      (rt as any).emit();
    });

    expect(arriveBtn.getAttribute("data-arrival-state")).toBe("ready");
    expect(arriveBtn.disabled).toBe(false);

    // Click arrival button at home
    await act(async () => {
      triggerNodeClick(arriveBtn);
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(arrivalPostCount).toBe(1);
  });
});
