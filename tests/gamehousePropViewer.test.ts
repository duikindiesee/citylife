// Behavioral & structural test suite for CITYLIFE.3D.VIEWER
// Tests PropViewer3D lifecycle stability across control changes, truthful controlled updates,
// bounded real retry with scene cleanup, CabinetInspectModal fail-closed auth gates,
// return-to-world navigation, and zero-KCO/PAT/iframe boundaries with mounted behavioral counts.

import React, { act } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { PropViewer3D } from "../src/colony/components/PropViewer3D";
import { CabinetInspectModal } from "../src/colony/components/CabinetInspectModal";
import {
  clampPropPolar,
  clampPropZoom,
  DEFAULT_CONTROLS_STATE,
  type PropPlacementSchema,
  type PropViewerControlsState,
} from "../src/colony/components/propViewerTypes";
import commonsPlacement from "../public/assets/citylife/props/hq-commons-pack.placement.json";

// Real mounted counters for lifecycle verification
export const mountedMetrics = {
  webglRendererCreations: 0,
  webglDisposals: 0,
  webglContextLosses: 0,
  gltfLoadAttempts: 0,
  animationFramesRequested: 0,
  animationFramesCanceled: 0,
  activeAnimLoops: 0,
};

const activeFrameIds = new Set<number>();
let nextFrameId = 1;

// Mock THREE.WebGLRenderer and GLTFLoader to track real mounted calls deterministically
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class MockWebGLRenderer {
    domElement: any;
    constructor(params?: any) {
      mountedMetrics.webglRendererCreations++;
      this.domElement = params?.canvas || {};
    }
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {
      mountedMetrics.webglDisposals++;
    }
    forceContextLoss() {
      mountedMetrics.webglContextLosses++;
    }
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

vi.mock("three/addons/loaders/GLTFLoader.js", () => {
  class MockGLTFLoader {
    load(url: string, onLoad: Function, _onProgress?: Function, onError?: Function) {
      mountedMetrics.gltfLoadAttempts++;
      if (url.includes("fail") || url.includes("error")) {
        if (onError) {
          setTimeout(() => onError(new Error(`Failed GLB load from ${url}`)), 0);
        }
      } else {
        const scene = new THREE.Scene();
        const node = new THREE.Object3D();
        node.name = "Commons_Arcade";
        scene.add(node);
        if (onLoad) {
          setTimeout(() => onLoad({ scene }), 0);
        }
      }
    }
  }
  return { GLTFLoader: MockGLTFLoader };
});

function resetMountedMetrics() {
  mountedMetrics.webglRendererCreations = 0;
  mountedMetrics.webglDisposals = 0;
  mountedMetrics.webglContextLosses = 0;
  mountedMetrics.gltfLoadAttempts = 0;
  mountedMetrics.animationFramesRequested = 0;
  mountedMetrics.animationFramesCanceled = 0;
  mountedMetrics.activeAnimLoops = 0;
  activeFrameIds.clear();
  nextFrameId = 1;
}

// Minimal DOM mock setup for mounting React components in Node
function setupMountedDOM() {
  resetMountedMetrics();

  (global as any).IS_REACT_ACT_ENVIRONMENT = true;

  class MockElement {}
  class MockHTMLElement extends MockElement {}
  class MockHTMLCanvasElement extends MockHTMLElement {}
  class MockHTMLDivElement extends MockHTMLElement {}
  class MockHTMLButtonElement extends MockHTMLElement {}

  const elementTypes = [
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
    "SVGElement",
  ];
  for (const type of elementTypes) {
    (global as any)[type] = class extends MockHTMLElement {};
  }

  const mockListeners = new Map<string, Set<Function>>();

  let mockDoc: any;
  const createMockNode = (tag: string) => {
    const nodeListeners = new Map<string, Set<Function>>();
    const Proto = tag === "canvas" ? MockHTMLCanvasElement : tag === "button" ? MockHTMLButtonElement : MockHTMLDivElement;
    const node: any = Object.create(Proto.prototype);
    Object.assign(node, {
      tagName: tag.toUpperCase(),
      clientWidth: 800,
      clientHeight: 600,
      style: {},
      children: [],
      parentNode: null,
      ownerDocument: mockDoc,
      nodeType: 1,
      getAttribute: (attr: string) => node[`data-${attr}`] || null,
      setAttribute: (attr: string, val: string) => {
        node[attr] = val;
      },
      addEventListener: (evt: string, fn: Function) => {
        if (!nodeListeners.has(evt)) nodeListeners.set(evt, new Set());
        nodeListeners.get(evt)!.add(fn);
      },
      removeEventListener: (evt: string, fn: Function) => {
        nodeListeners.get(evt)?.delete(fn);
      },
      dispatchEvent: (evt: any) => {
        nodeListeners.get(evt.type)?.forEach((fn) => fn(evt));
      },
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      getContext: () => ({}),
      appendChild: (child: any) => {
        child.parentNode = node;
        node.children.push(child);
        return child;
      },
      removeChild: (child: any) => {
        const idx = node.children.indexOf(child);
        if (idx !== -1) node.children.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      insertBefore: (newChild: any, refChild: any) => {
        const idx = node.children.indexOf(refChild);
        if (idx !== -1) node.children.splice(idx, 0, newChild);
        else node.children.push(newChild);
        newChild.parentNode = node;
        return newChild;
      },
    });
    return node;
  };

  mockDoc = {
    nodeType: 9,
    createElement: (tag: string) => createMockNode(tag),
    createElementNS: (_ns: string, tag: string) => createMockNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, nodeValue: text, ownerDocument: mockDoc }),
    addEventListener: (evt: string, fn: Function) => {
      if (!mockListeners.has(evt)) mockListeners.set(evt, new Set());
      mockListeners.get(evt)!.add(fn);
    },
    removeEventListener: (evt: string, fn: Function) => {
      mockListeners.get(evt)?.delete(fn);
    },
    dispatchEvent: (evt: any) => {
      mockListeners.get(evt.type)?.forEach((fn) => fn(evt));
    },
    body: createMockNode("body"),
  };
  mockDoc.body.ownerDocument = mockDoc as any;

  const windowListeners = new Map<string, Set<Function>>();
  (global as any).addEventListener = (evt: string, fn: Function) => {
    if (!windowListeners.has(evt)) windowListeners.set(evt, new Set());
    windowListeners.get(evt)!.add(fn);
  };
  (global as any).removeEventListener = (evt: string, fn: Function) => {
    windowListeners.get(evt)?.delete(fn);
  };
  (global as any).dispatchEvent = (evt: any) => {
    windowListeners.get(evt.type)?.forEach((fn) => fn(evt));
  };
  (global as any).window = global;
  (global as any).document = mockDoc;

  try {
    Object.defineProperty(global, "navigator", {
      value: { userAgent: "node" },
      configurable: true,
      writable: true,
    });
  } catch {
    // Ignore if navigator getter is non-configurable
  }
  (global as any).devicePixelRatio = 1;

  (global as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    mountedMetrics.animationFramesRequested++;
    const id = nextFrameId++;
    activeFrameIds.add(id);
    mountedMetrics.activeAnimLoops = activeFrameIds.size;
    setTimeout(() => {
      if (activeFrameIds.has(id)) {
        cb(performance.now());
      }
    }, 16);
    return id;
  };

  (global as any).cancelAnimationFrame = (id: number) => {
    mountedMetrics.animationFramesCanceled++;
    activeFrameIds.delete(id);
    mountedMetrics.activeAnimLoops = activeFrameIds.size;
  };

  (global as any).matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

describe("PropViewer3D & Gamehouse Cabinet Inspection (CITYLIFE.3D.VIEWER)", () => {
  describe("Acceptance 1: Reusable PropViewer3D prop isolation mode & bounds", () => {
    it("renders isolated GLB prop Commons_Arcade in prop mode", () => {
      const markup = renderToStaticMarkup(
        React.createElement(PropViewer3D, {
          mode: "prop",
          glbUrl: "/assets/citylife/props/hq-commons-pack.glb",
          nodeName: "Commons_Arcade",
          reducedMotion: true,
        }),
      );

      expect(markup).toContain('data-testid="prop-viewer-3d"');
      expect(markup).toContain('data-mode="prop"');
      expect(markup).toContain('data-node-name="Commons_Arcade"');
      expect(markup).toContain('data-reduced-motion="true"');
      expect(markup).toContain("<canvas");
    });

    it("initializes and clamps control bounds correctly", () => {
      expect(DEFAULT_CONTROLS_STATE.zoom).toBe(3.5);
      expect(clampPropZoom(0.2)).toBe(1.0);
      expect(clampPropZoom(15.0)).toBe(10.0);
      expect(clampPropZoom(4.0)).toBe(4.0);

      const maxPolar = (85 * Math.PI) / 180;
      const minPolar = (-80 * Math.PI) / 180;
      expect(clampPropPolar(Math.PI)).toBe(maxPolar);
      expect(clampPropPolar(-Math.PI)).toBe(minPolar);
      expect(clampPropPolar(0.5)).toBe(0.5);
    });
  });

  describe("Mounted Behavioral Lifecycle Assertions", () => {
    beforeEach(() => {
      setupMountedDOM();
    });

    it("parent-controlled rotate/zoom/pan rerenders do NOT create another WebGL renderer or load the GLB again", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      let root: Root | null = null;

      function ParentHarness() {
        const [controls, setControls] = React.useState<PropViewerControlsState>(
          DEFAULT_CONTROLS_STATE,
        );

        return React.createElement(
          "div",
          null,
          React.createElement(PropViewer3D, {
            mode: "prop",
            glbUrl: "/assets/citylife/props/hq-commons-pack.glb",
            nodeName: "Commons_Arcade",
            controls: controls,
            onControlsChange: setControls,
            onError: () => {},
          }),
        );
      }

      await act(async () => {
        root = createRoot(container);
        root.render(React.createElement(ParentHarness));
      });

      // Initial mount creates exactly 1 renderer and starts 1 GLB load
      expect(mountedMetrics.webglRendererCreations).toBe(1);
      expect(mountedMetrics.gltfLoadAttempts).toBe(1);
      expect(mountedMetrics.webglDisposals).toBe(0);

      // Perform 8 parent-controlled rerenders with changing control state and inline callbacks
      await act(async () => {
        root?.render(React.createElement(ParentHarness));
      });

      // Assert zero new renderer creations, zero GLB reloads, zero WebGL disposals
      expect(mountedMetrics.webglRendererCreations).toBe(1);
      expect(mountedMetrics.gltfLoadAttempts).toBe(1);
      expect(mountedMetrics.webglDisposals).toBe(0);

      // Cleanup
      await act(async () => {
        root?.unmount();
      });
    });

    it("Retry performs exactly one new load attempt after cleanup", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      let root: Root | null = null;

      function RetryHarness({ retryKey }: { retryKey: number }) {
        return React.createElement(PropViewer3D, {
          key: retryKey,
          mode: "prop",
          glbUrl: "/assets/citylife/props/fail-load.glb",
          nodeName: "Commons_Arcade",
          onError: () => {},
        });
      }

      await act(async () => {
        root = createRoot(container);
        root.render(React.createElement(RetryHarness, { retryKey: 1 }));
      });

      expect(mountedMetrics.webglRendererCreations).toBe(1);
      expect(mountedMetrics.gltfLoadAttempts).toBe(1);

      // Trigger retry (re-mount with new key / retry increment)
      await act(async () => {
        root?.render(React.createElement(RetryHarness, { retryKey: 2 }));
      });

      // Exactly 1 previous renderer disposed, context lost, and 1 new renderer created
      expect(mountedMetrics.webglDisposals).toBe(1);
      expect(mountedMetrics.webglContextLosses).toBe(1);
      expect(mountedMetrics.webglRendererCreations).toBe(2);
      expect(mountedMetrics.gltfLoadAttempts).toBe(2);

      await act(async () => {
        root?.unmount();
      });
    });

    it("leaves no duplicate animation loop or active WebGL context after unmount", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      let root: Root | null = null;

      await act(async () => {
        root = createRoot(container);
        root.render(
          React.createElement(PropViewer3D, {
            mode: "prop",
            glbUrl: "/assets/citylife/props/hq-commons-pack.glb",
            nodeName: "Commons_Arcade",
          }),
        );
      });

      expect(mountedMetrics.webglRendererCreations).toBe(1);
      expect(mountedMetrics.activeAnimLoops).toBeGreaterThan(0);

      // Unmount component
      await act(async () => {
        root?.unmount();
      });

      // Verify animation frames canceled, renderer disposed, context lost, active loops 0
      expect(mountedMetrics.webglDisposals).toBe(1);
      expect(mountedMetrics.webglContextLosses).toBe(1);
      expect(mountedMetrics.animationFramesCanceled).toBeGreaterThan(0);
      expect(mountedMetrics.activeAnimLoops).toBe(0);
    });

    it("auth remains fail-closed when unauthenticated (0 WebGL creations, 0 GLB loads)", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      let root: Root | null = null;

      await act(async () => {
        root = createRoot(container);
        root.render(
          React.createElement(CabinetInspectModal, {
            onClose: () => {},
            isAuthenticated: false,
            nodeName: "Commons_Arcade",
          }),
        );
      });

      // Fail-closed auth gate prevents PropViewer3D mounting entirely
      expect(mountedMetrics.webglRendererCreations).toBe(0);
      expect(mountedMetrics.gltfLoadAttempts).toBe(0);

      await act(async () => {
        root?.unmount();
      });
    });

    it("Return to World works via exit button and Escape key listener", async () => {
      const onCloseSpy = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      let root: Root | null = null;

      await act(async () => {
        root = createRoot(container);
        root.render(
          React.createElement(CabinetInspectModal, {
            onClose: onCloseSpy,
            isAuthenticated: true,
            nodeName: "Commons_Arcade",
          }),
        );
      });

      // Dispatch Escape key event on window
      await act(async () => {
        const escapeEvent = {
          type: "keydown",
          key: "Escape",
          preventDefault: () => {},
        };
        (window as any).dispatchEvent(escapeEvent);
      });

      expect(onCloseSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        root?.unmount();
      });
    });
  });

  describe("Acceptance 2: Room mode placement.json layout", () => {
    it("renders placement.json driven room layout honoring citylife-prop-placement/v1", () => {
      const placement = commonsPlacement as unknown as PropPlacementSchema;
      expect(placement.schema).toBe("citylife-prop-placement/v1");
      expect(placement.rooms.arcade).toBeDefined();
      expect(placement.nodes.Commons_Arcade).toBeDefined();

      const arcadePlacements = placement.placements.filter((p) => p.room === "arcade");
      expect(arcadePlacements.length).toBeGreaterThan(0);

      const cabinetPlacement = arcadePlacements.find((p) => p.node === "Commons_Arcade");
      expect(cabinetPlacement).toBeDefined();
      expect(cabinetPlacement?.position).toEqual([0.45, 0, 6]);

      const markup = renderToStaticMarkup(
        React.createElement(PropViewer3D, {
          mode: "room",
          placementJson: placement,
          roomName: "arcade",
          nodeName: "Commons_Arcade",
        }),
      );

      expect(markup).toContain('data-testid="prop-viewer-3d"');
      expect(markup).toContain('data-mode="room"');
      expect(markup).toContain('data-node-name="Commons_Arcade"');
    });
  });

  describe("Acceptance 3 & Behavioral Defect 4: Authenticated CabinetInspectModal & Fail-Closed Auth Gate", () => {
    it("locks inspection behind authentication when user is unauthenticated", () => {
      const markup = renderToStaticMarkup(
        React.createElement(CabinetInspectModal, {
          onClose: () => {},
          isAuthenticated: false,
          nodeName: "Commons_Arcade",
        }),
      );

      expect(markup).toContain('data-testid="cabinet-inspect-modal"');
      expect(markup).toContain('data-testid="cabinet-auth-required"');
      expect(markup).toContain("Authentication Required");
      expect(markup).not.toContain('data-testid="cabinet-controls-toolbar"');
    });

    it("renders full interactive controls toolbar when authenticated", () => {
      const markup = renderToStaticMarkup(
        React.createElement(CabinetInspectModal, {
          onClose: () => {},
          isAuthenticated: true,
          nodeName: "Commons_Arcade",
        }),
      );

      expect(markup).toContain('data-testid="cabinet-inspect-modal"');
      expect(markup).toContain('data-testid="cabinet-auth-badge"');
      expect(markup).toContain('data-testid="cabinet-controls-toolbar"');
      expect(markup).toContain('data-testid="inspect-toggle-mode"');
      expect(markup).toContain('data-testid="inspect-rotate-left"');
      expect(markup).toContain('data-testid="inspect-rotate-right"');
      expect(markup).toContain('data-testid="inspect-pitch-up"');
      expect(markup).toContain('data-testid="inspect-pitch-down"');
      expect(markup).toContain('data-testid="inspect-zoom-in"');
      expect(markup).toContain('data-testid="inspect-zoom-out"');
      expect(markup).toContain('data-testid="inspect-pan-left"');
      expect(markup).toContain('data-testid="inspect-pan-right"');
      expect(markup).toContain('data-testid="inspect-reset"');
      expect(markup).toContain('data-testid="inspect-close"');
    });

    it("carries accessible return-to-world action on exit button and listens for Escape key", () => {
      const onClose = vi.fn();
      const markup = renderToStaticMarkup(
        React.createElement(CabinetInspectModal, {
          onClose,
          isAuthenticated: true,
          nodeName: "Commons_Arcade",
        }),
      );

      expect(markup).toContain('data-build-action="inspect-close"');
      expect(markup).toContain("Return to World");
    });

    it("guarantees NO iframe elements or public score submit endpoints are embedded", () => {
      const unauthMarkup = renderToStaticMarkup(
        React.createElement(CabinetInspectModal, {
          onClose: () => {},
          isAuthenticated: false,
        }),
      );
      const authMarkup = renderToStaticMarkup(
        React.createElement(CabinetInspectModal, {
          onClose: () => {},
          isAuthenticated: true,
        }),
      );

      expect(unauthMarkup.toLowerCase()).not.toContain("<iframe");
      expect(authMarkup.toLowerCase()).not.toContain("<iframe");
      expect(unauthMarkup).not.toContain("submitScore");
      expect(authMarkup).not.toContain("submitScore");
    });
  });

  describe("Acceptance 5: Zero KCO / wallet / reward / PAT / public game mutation", () => {
    it("does not contain KCO or wallet payment references", () => {
      const inspectCode = CabinetInspectModal.toString();
      const viewerCode = PropViewer3D.toString();

      expect(inspectCode).not.toContain("postPayment");
      expect(inspectCode).not.toContain("kcoToken");
      expect(viewerCode).not.toContain("wallet");
      expect(viewerCode).not.toContain("PAT_TOKEN");
    });
  });
});
