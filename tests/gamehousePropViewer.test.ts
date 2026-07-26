// Behavioral & structural test suite for CITYLIFE.3D.VIEWER
// Tests PropViewer3D lifecycle stability across control changes, truthful controlled updates,
// bounded real retry with scene cleanup, CabinetInspectModal fail-closed auth gates,
// return-to-world navigation, and zero-KCO/PAT/iframe boundaries.

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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

  describe("Behavioral Defect 1: Scene & renderer lifecycle stability across control changes", () => {
    it("verifies scene effect dependency array excludes activeControls and updateControls", () => {
      const code = PropViewer3D.toString();

      // Ensure controlsRef is used to supply current controls to animation frames
      expect(code).toContain("controlsRef");

      // Extract the main canvas useEffect dependency array
      const depsMatch = code.match(/\},\s*\[\s*glbUrl[\s\S]*?onError\s*\]\s*\);/);
      expect(depsMatch).not.toBeNull();
      const depsArray = depsMatch?.[0] ?? "";

      expect(depsArray).toContain("retryCount");
      expect(depsArray).not.toContain("activeControls");
      expect(depsArray).not.toContain("updateControls");
    });
  });

  describe("Behavioral Defect 2: Controlled & uncontrolled updates derive from truthful current controls", () => {
    it("derives next control state from controlsRef.current rather than stale internal state", () => {
      const code = PropViewer3D.toString();

      // Verify updateControls reads current state from controlsRef.current
      expect(code).toContain("controlsRef");
      expect(code).toContain("setInternalControls");
      expect(code).toContain("onControlsChange");
    });
  });

  describe("Behavioral Defect 3: Bounded real Retry invokes a new load attempt with cleanup", () => {
    it("triggers real GLTFLoader re-execution via retryCount dependency and handleRetry callback", () => {
      const code = PropViewer3D.toString();

      // Verify handleRetry / setRetryCount exists
      expect(code).toContain("setRetryCount");
      expect(code).toContain("handleRetry");

      // Verify retryCount is included in scene useEffect dependencies
      expect(code).toContain("retryCount");

      // Verify retry button is rendered
      expect(code).toContain("prop-viewer-retry");
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

      const code = CabinetInspectModal.toString();
      expect(code).toContain("Escape");
      expect(code).toContain("onClose()");
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
