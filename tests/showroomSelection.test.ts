import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  SHOWROOM_DEFAULT_ZOOM,
  SHOWROOM_MAX_ZOOM,
  SHOWROOM_MIN_ZOOM,
  clampShowroomZoom,
  stepSelection,
  wrapIndex,
} from "../src/colony/showroom/showroomState";
import {
  SHOWROOM_VEHICLES,
  showroomCardModel,
} from "../src/colony/showroom/showroomCatalog";
import { safeCarSpec } from "../src/colony/car/carSpec";
import { isPublicSafe } from "../src/colony/newcomers";

// Instrumented cached GLTF scene for lifecycle testing
const mockCachedScene = new THREE.Group();
const mockGeomA = new THREE.BufferGeometry();
const mockGeomB = new THREE.BufferGeometry();
const mockMatA = new THREE.MeshStandardMaterial({ color: 0xffcc00 });
const mockMatB = new THREE.MeshStandardMaterial({ color: 0x111111 });
const mockMeshA = new THREE.Mesh(mockGeomA, mockMatA);
const mockMeshB = new THREE.Mesh(mockGeomB, [mockMatA, mockMatB]);
mockCachedScene.add(mockMeshA, mockMeshB);

vi.mock("@react-three/drei", () => {
  const useGLTF = Object.assign(
    vi.fn(() => ({ scene: mockCachedScene })),
    {
      preload: vi.fn(),
      clear: vi.fn(),
    },
  );
  return {
    useGLTF,
    Environment: ({ children }: { children?: React.ReactNode }) =>
      children ?? null,
  };
});

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => children ?? null,
  useFrame: vi.fn(),
  useThree: vi.fn((selector) => {
    const state = {
      camera: new THREE.PerspectiveCamera(),
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

import { ShowroomView } from "../src/colony/render/ShowroomView";

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
  g.window = globalThis;
  g.document = mockDoc;
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node" },
      configurable: true,
      writable: true,
    });
  } catch {
    /* non-configurable navigator */
  }
}

describe("showroom carousel selection (PLAYER.GARAGE.1)", () => {
  it("wraps at both ends", () => {
    const n = SHOWROOM_VEHICLES.length;
    expect(stepSelection(0, n, -1)).toBe(n - 1); // left from first wraps to last
    expect(stepSelection(n - 1, n, 1)).toBe(0); // right from last wraps to first
    expect(stepSelection(0, n, 1)).toBe(1 % n);
  });

  it("recovers bad indices instead of crashing", () => {
    expect(wrapIndex(-7, 2)).toBe(1);
    expect(wrapIndex(9, 2)).toBe(1);
    expect(wrapIndex(3.5, 2)).toBe(0);
    expect(wrapIndex(0, 0)).toBe(0);
    expect(stepSelection(0, 0, 1)).toBe(0);
  });

  it("clamps camera zoom to the safe envelope and recovers non-finite input", () => {
    expect(clampShowroomZoom(0)).toBe(SHOWROOM_MIN_ZOOM);
    expect(clampShowroomZoom(999)).toBe(SHOWROOM_MAX_ZOOM);
    expect(clampShowroomZoom(SHOWROOM_MIN_ZOOM)).toBe(SHOWROOM_MIN_ZOOM);
    expect(clampShowroomZoom(SHOWROOM_MAX_ZOOM)).toBe(SHOWROOM_MAX_ZOOM);
    expect(clampShowroomZoom(5)).toBe(5);
    expect(clampShowroomZoom(Number.NaN)).toBe(SHOWROOM_DEFAULT_ZOOM);
    expect(clampShowroomZoom(Number.POSITIVE_INFINITY)).toBe(
      SHOWROOM_DEFAULT_ZOOM,
    );
    expect(SHOWROOM_MIN_ZOOM).toBeLessThan(SHOWROOM_DEFAULT_ZOOM);
    expect(SHOWROOM_DEFAULT_ZOOM).toBeLessThan(SHOWROOM_MAX_ZOOM);
  });
});

describe("showroom catalog and specification card", () => {
  it("offers at least two distinct, valid vehicles", () => {
    expect(SHOWROOM_VEHICLES.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(SHOWROOM_VEHICLES.map((v) => v.spec.id));
    expect(ids.size).toBe(SHOWROOM_VEHICLES.length);
    for (const v of SHOWROOM_VEHICLES) {
      // every catalog car must round-trip the CarSpec safety validator unchanged
      expect(safeCarSpec(v.spec)).toEqual(v.spec);
      expect(v.plannedPriceK).toBeGreaterThan(0);
    }
  });

  it("keeps the two launch vehicles visibly different on the card", () => {
    const [vonk, kaap] = SHOWROOM_VEHICLES;
    const a = showroomCardModel(vonk!);
    const b = showroomCardModel(kaap!);
    expect(a.name).toBe("Karoo Vonk 1.1");
    expect(b.name).toBe("Karoo Kaap GT-V8");
    expect(a.name).not.toBe(b.name);
    expect(a.priceLabel).not.toBe(b.priceLabel);
    // the selected-spec rendering must actually differ: top speed and acceleration diverge
    const stat = (m: typeof a, label: string) =>
      m.stats.find((s) => s.label === label)!.pct;
    expect(stat(a, "Top speed")).not.toBe(stat(b, "Top speed"));
    expect(stat(a, "Acceleration")).not.toBe(stat(b, "Acceleration"));
    // acquisition can never be live in this slice
    expect(a.acquirePreviewOnly).toBe(true);
    expect(b.acquirePreviewOnly).toBe(true);
  });

  it("ships no real manufacturer name, badge word or unsafe label", () => {
    const banned = /fiat|ford|capri|perana|uno\b/i;
    for (const v of SHOWROOM_VEHICLES) {
      expect(v.publicName).not.toMatch(banned);
      expect(v.spec.name).not.toMatch(banned);
      expect(v.vehicleClass).not.toMatch(banned);
      expect(v.blurb).not.toMatch(banned);
      expect(isPublicSafe(v.publicName)).toBe(true);
      expect(isPublicSafe(v.blurb)).toBe(true);
    }
  });

  it("offers the Karoo X19 Targa with GLB asset and distinctive stats", () => {
    const x19 = SHOWROOM_VEHICLES.find(
      (v) => v.spec.id === "showroom:karoo-x19-targa",
    );
    expect(x19).toBeDefined();
    const card = showroomCardModel(x19!);
    expect(card.name).toBe("Karoo X19 Targa");
    expect(card.vehicleClass).toBe("Heritage sports targa");
    expect(card.priceLabel).toBe("₭950 · planned");
    expect(x19!.glbUrl).toBe("/assets/citylife/cars/fiat_x19.glb");
    expect(x19!.presentationScale).toBe(0.56);
    expect(x19!.rotationOffset).toEqual([0, -Math.PI / 2, 0]);
    expect(x19!.spec.stats.grip).toBe(0.85);
  });

  it("offers high-fidelity GLB models across all showroom vehicles", () => {
    for (const v of SHOWROOM_VEHICLES) {
      expect(v.glbUrl).toBeDefined();
      expect(v.glbUrl).toMatch(/\.glb$/);
      expect(v.presentationScale).toBeGreaterThan(0);
      expect(v.rotationOffset).toHaveLength(3);
    }
  });
});

describe("GLB turntable model resource ownership", () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    setupMountedDOM();
    originalConsoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("retains loader cache ownership and leaves cached geometries and materials undisposed across component mount, selection away, and unmount", async () => {
    const x19 = SHOWROOM_VEHICLES.find(
      (v) => v.spec.id === "showroom:karoo-x19-targa",
    )!;
    const otherCar = SHOWROOM_VEHICLES.find(
      (v) => v.spec.id === "showroom:karoo-vonk-11",
    )!;
    expect(x19).toBeDefined();
    expect(otherCar).toBeDefined();

    let disposeCalls = 0;
    const onDispose = () => {
      disposeCalls++;
    };

    mockGeomA.addEventListener("dispose", onDispose);
    mockGeomB.addEventListener("dispose", onDispose);
    mockMatA.addEventListener("dispose", onDispose);
    mockMatB.addEventListener("dispose", onDispose);

    const spyGeomA = vi.spyOn(mockGeomA, "dispose");
    const spyGeomB = vi.spyOn(mockGeomB, "dispose");
    const spyMatA = vi.spyOn(mockMatA, "dispose");
    const spyMatB = vi.spyOn(mockMatB, "dispose");

    const container = (
      globalThis as unknown as {
        document: { createElement: (t: string) => Record<string, unknown> };
      }
    ).document.createElement("div");

    let root: Root | null = null;

    try {
      // Step 1: Mount showroom presenting the GLB vehicle (Karoo X19 Targa)
      await act(async () => {
        root = createRoot(container as unknown as HTMLElement);
        root.render(
          React.createElement(ShowroomView, {
            vehicle: x19,
            zoom: SHOWROOM_DEFAULT_ZOOM,
          }),
        );
      });

      expect(disposeCalls).toBe(0);
      expect(spyGeomA).not.toHaveBeenCalled();
      expect(spyGeomB).not.toHaveBeenCalled();
      expect(spyMatA).not.toHaveBeenCalled();
      expect(spyMatB).not.toHaveBeenCalled();

      // Step 2: Select away to another vehicle in the carousel (unmounts previous GlbTurntableCarModel)
      // Loader cache ownership is retained and automatic primitive disposal is suppressed (dispose={null}).
      await act(async () => {
        root!.render(
          React.createElement(ShowroomView, {
            vehicle: otherCar,
            zoom: SHOWROOM_DEFAULT_ZOOM,
          }),
        );
      });

      expect(disposeCalls).toBe(0);
      expect(spyGeomA).not.toHaveBeenCalled();
      expect(spyGeomB).not.toHaveBeenCalled();
      expect(spyMatA).not.toHaveBeenCalled();
      expect(spyMatB).not.toHaveBeenCalled();

      // Step 3: Select back to the GLB vehicle (remounts GlbTurntableCarModel)
      await act(async () => {
        root!.render(
          React.createElement(ShowroomView, {
            vehicle: x19,
            zoom: SHOWROOM_DEFAULT_ZOOM,
          }),
        );
      });

      expect(disposeCalls).toBe(0);
      expect(spyGeomA).not.toHaveBeenCalled();
      expect(spyGeomB).not.toHaveBeenCalled();
      expect(spyMatA).not.toHaveBeenCalled();
      expect(spyMatB).not.toHaveBeenCalled();

      // Step 4: Unmount the entire showroom view
      await act(async () => {
        root?.unmount();
      });

      expect(disposeCalls).toBe(0);
      expect(spyGeomA).not.toHaveBeenCalled();
      expect(spyGeomB).not.toHaveBeenCalled();
      expect(spyMatA).not.toHaveBeenCalled();
      expect(spyMatB).not.toHaveBeenCalled();
    } finally {
      mockGeomA.removeEventListener("dispose", onDispose);
      mockGeomB.removeEventListener("dispose", onDispose);
      mockMatA.removeEventListener("dispose", onDispose);
      mockMatB.removeEventListener("dispose", onDispose);
      spyGeomA.mockRestore();
      spyGeomB.mockRestore();
      spyMatA.mockRestore();
      spyMatB.mockRestore();
    }
  });
});
