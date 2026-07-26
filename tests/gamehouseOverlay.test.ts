// ARCADE.2A — mounted lifecycle tests for the Gamehouse venue overlay's cabinet-inspection wiring.
// Uses the same deterministic mock-DOM + mocked three.js harness as gamehousePropViewer.test.ts to
// assert: entering the venue mounts NO WebGL; a cabinet interaction opens exactly ONE isolated viewer;
// closing disposes it (no leaked context / animation loop); repeated open/close never leaks; and an
// unauthenticated session can never open the viewer (feature-OFF / fail-closed regression).
import React, { act } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { GamehouseOverlay } from "../src/colony/ui/GamehouseOverlay";

const metrics = {
  rendererCreations: 0,
  disposals: 0,
  contextLosses: 0,
  gltfLoads: 0,
  framesRequested: 0,
  framesCanceled: 0,
  activeAnimLoops: 0,
};
const activeFrameIds = new Set<number>();
let nextFrameId = 1;

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class MockWebGLRenderer {
    domElement: unknown;
    constructor(params?: { canvas?: unknown }) {
      metrics.rendererCreations++;
      this.domElement = params?.canvas ?? {};
    }
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {
      metrics.disposals++;
    }
    forceContextLoss() {
      metrics.contextLosses++;
    }
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

vi.mock("three/addons/loaders/GLTFLoader.js", () => {
  class MockGLTFLoader {
    load(url: string, onLoad: (g: { scene: THREE.Scene }) => void) {
      metrics.gltfLoads++;
      const scene = new THREE.Scene();
      const node = new THREE.Object3D();
      node.name = "Commons_Arcade";
      scene.add(node);
      setTimeout(() => onLoad({ scene }), 0);
    }
  }
  return { GLTFLoader: MockGLTFLoader };
});

function resetMetrics() {
  metrics.rendererCreations = 0;
  metrics.disposals = 0;
  metrics.contextLosses = 0;
  metrics.gltfLoads = 0;
  metrics.framesRequested = 0;
  metrics.framesCanceled = 0;
  metrics.activeAnimLoops = 0;
  activeFrameIds.clear();
  nextFrameId = 1;
}

function setupMountedDOM() {
  resetMetrics();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

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
    (globalThis as Record<string, unknown>)[type] = class extends MockHTMLElement {};
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
      _listeners: nodeListeners,
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
      dispatchEvent: (evt: { type?: string } | string) => {
        const type = typeof evt === "string" ? evt : evt.type!;
        const eventObj =
          typeof evt === "string"
            ? { type: evt, target: node, bubbles: true }
            : (evt as Record<string, unknown>);
        if (!eventObj.target) eventObj.target = node;
        let curr: Record<string, unknown> | null = node;
        while (curr) {
          const listeners = (
            curr._listeners as Map<string, Set<(e: unknown) => void>> | undefined
          )?.get(type);
          if (listeners) listeners.forEach((fn) => fn(eventObj));
          if (type === "click" && typeof curr.onClick === "function")
            (curr.onClick as (e: unknown) => void)(eventObj);
          if (!(eventObj as { bubbles?: boolean }).bubbles) break;
          curr = (curr.parentNode as Record<string, unknown> | null) ?? null;
        }
      },
      click: () =>
        (node.dispatchEvent as (e: unknown) => void)({
          type: "click",
          target: node,
          bubbles: true,
          preventDefault: () => {},
          stopPropagation: () => {},
        }),
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      getContext: () => ({}),
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
      insertBefore: (
        newChild: Record<string, unknown>,
        refChild: unknown,
      ) => {
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

  const windowListeners = new Map<string, Set<(e: unknown) => void>>();
  const g = globalThis as Record<string, unknown>;
  g.addEventListener = (evt: string, fn: (e: unknown) => void) => {
    if (!windowListeners.has(evt)) windowListeners.set(evt, new Set());
    windowListeners.get(evt)!.add(fn);
  };
  g.removeEventListener = (evt: string, fn: (e: unknown) => void) => {
    windowListeners.get(evt)?.delete(fn);
  };
  g.dispatchEvent = (evt: { type: string }) => {
    windowListeners.get(evt.type)?.forEach((fn) => fn(evt));
  };
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
  g.devicePixelRatio = 1;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    metrics.framesRequested++;
    const id = nextFrameId++;
    activeFrameIds.add(id);
    metrics.activeAnimLoops = activeFrameIds.size;
    setTimeout(() => {
      if (activeFrameIds.has(id)) {
        activeFrameIds.delete(id);
        metrics.activeAnimLoops = activeFrameIds.size;
        cb(performance.now());
      }
    }, 16);
    return id;
  };
  g.cancelAnimationFrame = (id: number) => {
    metrics.framesCanceled++;
    activeFrameIds.delete(id);
    metrics.activeAnimLoops = activeFrameIds.size;
  };
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

function findByTestId(
  root: Record<string, unknown> | null,
  testId: string,
): Record<string, unknown> | null {
  if (!root) return null;
  if (
    root["data-testid"] === testId ||
    (root.getAttribute as ((a: string) => unknown) | undefined)?.(
      "data-testid",
    ) === testId ||
    root["data-build-action"] === testId
  )
    return root;
  const children = root.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children))
    for (const child of children) {
      const found = findByTestId(child, testId);
      if (found) return found;
    }
  return null;
}

describe("ARCADE.2A — GamehouseOverlay static structure", () => {
  it("renders the arcade floor and cabinet without any iframe or score submit", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GamehouseOverlay, {
        onClose: () => {},
        isAuthenticated: true,
      }),
    );
    expect(markup).toContain('data-testid="gamehouse-overlay"');
    expect(markup).toContain('data-testid="gamehouse-floor"');
    expect(markup).toContain('data-testid="gamehouse-cabinet"');
    expect(markup).toContain("Press E — Play the arcade cabinet");
    expect(markup.toLowerCase()).not.toContain("<iframe");
    expect(markup).not.toContain("submitScore");
    // Entering the venue renders no 3D viewer until the cabinet is interacted with.
    expect(markup).not.toContain('data-testid="cabinet-inspect-modal"');
  });

  it("shows the sign-in prompt and disables the cabinet for an unauthenticated session", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GamehouseOverlay, {
        onClose: () => {},
        isAuthenticated: false,
      }),
    );
    expect(markup).toContain("Sign in to play the arcade cabinet");
    expect(markup).toContain("disabled");
  });
});

describe("ARCADE.2A — GamehouseOverlay cabinet-inspection lifecycle", () => {
  beforeEach(() => setupMountedDOM());

  it("entering the venue mounts NO WebGL until a cabinet interaction", async () => {
    const container = (
      globalThis as unknown as { document: { createElement: (t: string) => Record<string, unknown> } }
    ).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(GamehouseOverlay, {
          onClose: () => {},
          isAuthenticated: true,
        }),
      );
    });
    expect(metrics.rendererCreations).toBe(0);
    expect(metrics.gltfLoads).toBe(0);
    await act(async () => root?.unmount());
  });

  it("a cabinet interaction opens exactly one isolated viewer and closing disposes it cleanly", async () => {
    const container = (
      globalThis as unknown as { document: { createElement: (t: string) => Record<string, unknown> } }
    ).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(GamehouseOverlay, {
          onClose: () => {},
          isAuthenticated: true,
        }),
      );
    });

    // Interact with the cabinet → open the isolated 3D viewer.
    const cabinet = findByTestId(container as unknown as Record<string, unknown>, "gamehouse-cabinet");
    expect(cabinet).not.toBeNull();
    await act(async () => (cabinet!.click as () => void)());

    expect(metrics.rendererCreations).toBe(1);
    expect(metrics.gltfLoads).toBe(1);
    expect(metrics.disposals).toBe(0);
    expect(metrics.activeAnimLoops).toBe(1); // exactly one render loop, never duplicated

    // Close the viewer via the modal's Return-to-World control → back to the venue, fully disposed.
    const close = findByTestId(container as unknown as Record<string, unknown>, "inspect-close");
    expect(close).not.toBeNull();
    await act(async () => (close!.click as () => void)());

    expect(metrics.disposals).toBe(1);
    expect(metrics.contextLosses).toBe(1);
    expect(metrics.framesCanceled).toBeGreaterThan(0);
    expect(metrics.activeAnimLoops).toBe(0); // no leaked animation loop
    // The venue itself is still mounted after closing the inspection.
    expect(
      findByTestId(container as unknown as Record<string, unknown>, "gamehouse-cabinet"),
    ).not.toBeNull();

    await act(async () => root?.unmount());
  });

  it("repeated open/close cycles never leak a renderer or animation loop", async () => {
    const container = (
      globalThis as unknown as { document: { createElement: (t: string) => Record<string, unknown> } }
    ).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(GamehouseOverlay, {
          onClose: () => {},
          isAuthenticated: true,
        }),
      );
    });

    const CYCLES = 3;
    for (let i = 0; i < CYCLES; i++) {
      const cabinet = findByTestId(
        container as unknown as Record<string, unknown>,
        "gamehouse-cabinet",
      );
      await act(async () => (cabinet!.click as () => void)());
      const close = findByTestId(
        container as unknown as Record<string, unknown>,
        "inspect-close",
      );
      await act(async () => (close!.click as () => void)());
    }

    // One creation and one disposal per cycle — perfectly balanced, no accumulation.
    expect(metrics.rendererCreations).toBe(CYCLES);
    expect(metrics.disposals).toBe(CYCLES);
    expect(metrics.contextLosses).toBe(CYCLES);
    expect(metrics.activeAnimLoops).toBe(0);

    await act(async () => root?.unmount());
  });

  it("feature-OFF / fail-closed: an unauthenticated session can never open the viewer", async () => {
    const container = (
      globalThis as unknown as { document: { createElement: (t: string) => Record<string, unknown> } }
    ).document.createElement("div");
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement);
      root.render(
        React.createElement(GamehouseOverlay, {
          onClose: () => {},
          isAuthenticated: false,
        }),
      );
    });

    const cabinet = findByTestId(container as unknown as Record<string, unknown>, "gamehouse-cabinet");
    expect(cabinet).not.toBeNull();
    // Even a forced click cannot mount the isolated viewer for a non-authorized session.
    await act(async () => (cabinet!.click as () => void)());
    expect(metrics.rendererCreations).toBe(0);
    expect(metrics.gltfLoads).toBe(0);
    expect(
      findByTestId(container as unknown as Record<string, unknown>, "cabinet-inspect-modal"),
    ).toBeNull();

    await act(async () => root?.unmount());
  });
});
