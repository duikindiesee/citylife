// CITYLIFE.3D.VIEWER — Gamehouse Cabinet Inspection Modal.
// Authenticated-only 3D inspection modal for Gamehouse cabinets and props.
// Pure same-origin component: NO iframe, NO public score submission, NO credential mutation.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { getAuthClient } from "../authClient";
import { PropViewer3D } from "./PropViewer3D";
import {
  DEFAULT_CONTROLS_STATE,
  clampPropPolar,
  clampPropZoom,
  type PropPlacementSchema,
  type PropViewerControlsState,
  type PropViewerMode,
} from "./propViewerTypes";

export interface CabinetInspectModalProps {
  onClose: () => void;
  isAuthenticated?: boolean;
  glbUrl?: string;
  nodeName?: string;
  placementUrl?: string;
  placementJson?: PropPlacementSchema | null;
  roomName?: string;
  reducedMotion?: boolean;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  background: "rgba(6, 10, 16, 0.94)",
  display: "flex",
  flexDirection: "column",
  fontFamily: "monospace",
  color: "#c8dff0",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 20px",
  background: "#0d1826",
  borderBottom: "1px solid #1e3650",
};

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#ffd25a",
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const buttonStyle: CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 6,
  border: "1px solid #2a4a6a",
  background: "#122032",
  color: "#a0d4f0",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#2a5a8a",
  borderColor: "#4a8ac0",
  color: "#ffffff",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 16px",
  background: "#0c1522",
  borderTop: "1px solid #1e3650",
};

const metaPanelStyle: CSSProperties = {
  position: "absolute",
  top: 60,
  left: 16,
  padding: "10px 14px",
  background: "rgba(10, 18, 28, 0.9)",
  border: "1px solid #1e3a5a",
  borderRadius: 8,
  fontSize: 12,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  pointerEvents: "none",
  zIndex: 10,
};

const authLockStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  padding: 24,
  background: "rgba(10, 14, 22, 0.96)",
  zIndex: 50,
  textAlign: "center",
};

export function CabinetInspectModal({
  onClose,
  isAuthenticated: passedAuth,
  glbUrl = "/assets/citylife/props/hq-commons-pack.glb",
  nodeName = "Commons_Arcade",
  placementUrl = "/assets/citylife/props/hq-commons-pack.placement.json",
  placementJson = null,
  roomName = "arcade",
  reducedMotion,
}: CabinetInspectModalProps) {
  // Authentication status check (only authenticated users can trigger interactive inspection)
  const isAuth = passedAuth ?? getAuthClient().isAuthenticated;

  const [mode, setMode] = useState<PropViewerMode>("prop");
  const [controls, setControls] = useState<PropViewerControlsState>(DEFAULT_CONTROLS_STATE);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Return to world listener on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const updateControls = useCallback(
    (updater: (prev: PropViewerControlsState) => PropViewerControlsState) => {
      setControls(updater);
    },
    [],
  );

  const rotateLeft = () =>
    updateControls((prev) => ({ ...prev, azimuth: prev.azimuth - 0.25 }));
  const rotateRight = () =>
    updateControls((prev) => ({ ...prev, azimuth: prev.azimuth + 0.25 }));
  const pitchUp = () =>
    updateControls((prev) => ({ ...prev, polar: clampPropPolar(prev.polar + 0.15) }));
  const pitchDown = () =>
    updateControls((prev) => ({ ...prev, polar: clampPropPolar(prev.polar - 0.15) }));

  const zoomIn = () =>
    updateControls((prev) => ({ ...prev, zoom: clampPropZoom(prev.zoom - 0.5) }));
  const zoomOut = () =>
    updateControls((prev) => ({ ...prev, zoom: clampPropZoom(prev.zoom + 0.5) }));

  const panLeft = () =>
    updateControls((prev) => ({ ...prev, pan: [prev.pan[0] - 0.2, prev.pan[1]] }));
  const panRight = () =>
    updateControls((prev) => ({ ...prev, pan: [prev.pan[0] + 0.2, prev.pan[1]] }));
  const panUp = () =>
    updateControls((prev) => ({ ...prev, pan: [prev.pan[0], prev.pan[1] + 0.2] }));
  const panDown = () =>
    updateControls((prev) => ({ ...prev, pan: [prev.pan[0], prev.pan[1] - 0.2] }));

  const resetView = () => setControls(DEFAULT_CONTROLS_STATE);
  const toggleMode = () => setMode((m) => (m === "prop" ? "room" : "prop"));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gamehouse Cabinet Inspection Modal"
      data-testid="cabinet-inspect-modal"
      style={overlayStyle}
    >
      {/* Modal Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>
          <span>🕹️ Gamehouse Cabinet Inspector</span>
          <span style={{ fontSize: 13, color: "#7ab0d0", fontWeight: 400 }}>
            ({nodeName})
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isAuth && (
            <span
              data-testid="cabinet-auth-badge"
              style={{
                fontSize: 11,
                color: "#7ae090",
                background: "rgba(50, 180, 100, 0.15)",
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid rgba(50, 180, 100, 0.3)",
              }}
            >
              ✓ Authenticated
            </span>
          )}
          <button
            type="button"
            data-testid="inspect-close"
            data-build-action="inspect-close"
            onClick={onClose}
            title="Return to World (Escape)"
            style={{
              ...buttonStyle,
              background: "#6a1b29",
              borderColor: "#90283a",
              color: "#ffc2cc",
            }}
          >
            ✕ Return to World
          </button>
        </div>
      </div>

      {/* Main Inspection View Container */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {/* Unauthenticated Lock Banner */}
        {!isAuth ? (
          <div data-testid="cabinet-auth-required" style={authLockStyle}>
            <div style={{ fontSize: 40 }}>🔒</div>
            <div style={{ fontSize: 18, color: "#ffd25a", fontWeight: 700 }}>
              Authentication Required
            </div>
            <div style={{ maxWidth: 420, color: "#a0b8cc", fontSize: 13, lineHeight: 1.5 }}>
              Gamehouse 3D Cabinet Inspection requires an authenticated operator or player session.
              Please sign in to inspect props and room placements.
            </div>
            <button
              type="button"
              data-testid="inspect-auth-close"
              style={buttonStyle}
              onClick={onClose}
            >
              Back to World
            </button>
          </div>
        ) : (
          <>
            {/* Metadata Info Box */}
            <div style={metaPanelStyle} data-testid="cabinet-metadata">
              <div>
                <strong style={{ color: "#ffd25a" }}>Prop:</strong> {nodeName}
              </div>
              <div>
                <strong style={{ color: "#7ab0d0" }}>Room:</strong> {roomName}
              </div>
              <div>
                <strong style={{ color: "#7ab0d0" }}>Mode:</strong>{" "}
                {mode === "prop" ? "Single Prop Isolation" : "Room Layout"}
              </div>
              <div>
                <strong style={{ color: "#7ab0d0" }}>Dimensions:</strong> 0.7m × 1.8m × 0.8m
              </div>
            </div>

            {/* 3D Prop Viewer */}
            <PropViewer3D
              mode={mode}
              glbUrl={glbUrl}
              nodeName={nodeName}
              placementUrl={placementUrl}
              placementJson={placementJson}
              roomName={roomName}
              controls={controls}
              onControlsChange={setControls}
              onError={(err) => setInspectError(err.message)}
              onClose={onClose}
              reducedMotion={reducedMotion}
              ariaLabel={`3D View of ${nodeName} in ${roomName}`}
            />
          </>
        )}
      </div>

      {/* Interactive Controls Toolbar (Only shown when authenticated) */}
      {isAuth && (
        <div style={toolbarStyle} data-testid="cabinet-controls-toolbar">
          <button
            type="button"
            data-testid="inspect-toggle-mode"
            onClick={toggleMode}
            style={mode === "room" ? activeButtonStyle : buttonStyle}
            title="Toggle between single prop isolation and room placement mode"
          >
            {mode === "prop" ? "🏢 Room Mode" : "🔍 Single Prop Mode"}
          </button>

          <div style={{ height: 20, width: 1, background: "#1e3650", margin: "0 4px" }} />

          {/* Rotate Controls */}
          <button
            type="button"
            data-testid="inspect-rotate-left"
            onClick={rotateLeft}
            style={buttonStyle}
            title="Rotate Left (ArrowLeft)"
          >
            ↺ Rotate Left
          </button>
          <button
            type="button"
            data-testid="inspect-rotate-right"
            onClick={rotateRight}
            style={buttonStyle}
            title="Rotate Right (ArrowRight)"
          >
            ↻ Rotate Right
          </button>
          <button
            type="button"
            data-testid="inspect-pitch-up"
            onClick={pitchUp}
            style={buttonStyle}
            title="Tilt Up (ArrowUp)"
          >
            ▲ Pitch Up
          </button>
          <button
            type="button"
            data-testid="inspect-pitch-down"
            onClick={pitchDown}
            style={buttonStyle}
            title="Tilt Down (ArrowDown)"
          >
            ▼ Pitch Down
          </button>

          <div style={{ height: 20, width: 1, background: "#1e3650", margin: "0 4px" }} />

          {/* Zoom Controls */}
          <button
            type="button"
            data-testid="inspect-zoom-in"
            onClick={zoomIn}
            style={buttonStyle}
            title="Zoom In (+)"
          >
            🔍+ Zoom In
          </button>
          <button
            type="button"
            data-testid="inspect-zoom-out"
            onClick={zoomOut}
            style={buttonStyle}
            title="Zoom Out (−)"
          >
            🔍− Zoom Out
          </button>

          <div style={{ height: 20, width: 1, background: "#1e3650", margin: "0 4px" }} />

          {/* Pan Controls */}
          <button
            type="button"
            data-testid="inspect-pan-left"
            onClick={panLeft}
            style={buttonStyle}
            title="Pan Left"
          >
            ◄ Pan Left
          </button>
          <button
            type="button"
            data-testid="inspect-pan-right"
            onClick={panRight}
            style={buttonStyle}
            title="Pan Right"
          >
            ► Pan Right
          </button>

          <div style={{ height: 20, width: 1, background: "#1e3650", margin: "0 4px" }} />

          {/* Reset View Control */}
          <button
            type="button"
            data-testid="inspect-reset"
            onClick={resetView}
            style={buttonStyle}
            title="Reset View (R)"
          >
            ⟲ Reset View
          </button>
        </div>
      )}
    </div>
  );
}
