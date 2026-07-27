// ARCADE.2A — the Gamehouse venue overlay: the streamed interior a player steps into after crossing
// the governed commercial-plot portal. It presents the 8 m x 8 m arcade floor and the single public-
// safe Commons_Arcade cabinet; interacting with the cabinet (E / click) opens the ISOLATED 3D
// inspection (CabinetInspectModal → PropViewer3D) and closes it cleanly back to the venue.
//
// Boundaries (ARCADE.2A contract): NO iframe, NO gameplay, NO score submit/persistence, NO KCO/PAT/KCO
// mutation. The whole overlay is gated upstream in ColonyApp by arcadeGamehouseAvailable (authenticated
// entitled CITYLIFE_PLAYER + `citylife-arcade-3d-v1` on, or the DEV/E2E bypass); this component adds a
// second, defense-in-depth auth gate on the cabinet inspection itself. Entering the venue mounts NO
// WebGL — only a cabinet interaction does — so a leaked/duplicate render loop can only ever exist while
// the isolated viewer is open, and it disposes on close (see PropViewer3D cleanup + gamehousePropViewer
// tests).
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { CabinetInspectModal } from "../components/CabinetInspectModal";
import {
  COMMONS_ARCADE_CABINET_DIMENSIONS,
  resolveCabinetInteraction,
  type GamehousePlayerSession,
} from "../spatial/gamehouseCabinet";
import type { GamehousePortalSite } from "../spatial/gamehousePortal";

const panelStyle: CSSProperties = {
  background: "rgba(8,14,24,0.92)",
  border: "1px solid #1e3a5a",
  borderRadius: 10,
  color: "#c8dff0",
  fontFamily: "monospace",
};

const controlButtonStyle: CSSProperties = {
  padding: "8px 14px",
  fontSize: 15,
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid #3a5a6a",
  background: "rgba(8,14,24,0.9)",
  color: "#a0d4f0",
  fontWeight: 700,
};

export interface GamehouseOverlayProps {
  onClose: () => void;
  /** Whether this session may run the isolated 3D cabinet inspection. Defaults to false (fail-closed);
   *  ColonyApp passes the authenticated-entitled-or-DEV-bypass decision so the inspection can open. */
  isAuthenticated?: boolean;
  /** The governed plot this venue fronts, for stable metadata display. Optional — the overlay renders
   *  the same arcade floor with or without it. */
  site?: GamehousePortalSite | null;
  /** Optional reduced-motion override forwarded to the isolated viewer (defaults to the OS preference). */
  reducedMotion?: boolean;
}

export function GamehouseOverlay({
  onClose,
  isAuthenticated = false,
  site = null,
  reducedMotion,
}: GamehouseOverlayProps) {
  const [inspectOpen, setInspectOpen] = useState(false);

  const session: GamehousePlayerSession = {
    userId: isAuthenticated ? "citylife-player" : null,
  };
  const interaction = resolveCabinetInteraction(session);

  const openInspect = useCallback(() => {
    // Defense in depth: the isolated viewer opens ONLY for an authorized session, exactly like the
    // (already fail-closed) modal, so a direct/programmatic call can never mount WebGL for a visitor.
    if (!interaction.allowed) return;
    setInspectOpen(true);
  }, [interaction.allowed]);

  const closeInspect = useCallback(() => setInspectOpen(false), []);

  // Escape leaves the venue — but only when the isolated viewer is NOT open; while it is, the modal owns
  // Escape (return to venue), so a single press never collapses both layers at once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !inspectOpen) {
        e.preventDefault();
        onClose();
      } else if (e.key === "e" || e.key === "E") {
        if (!inspectOpen && interaction.allowed) {
          e.preventDefault();
          openInspect();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectOpen, interaction.allowed, onClose, openInspect]);

  const { width, height, depth } = COMMONS_ARCADE_CABINET_DIMENSIONS;

  return (
    <div
      className="gamehouse-overlay"
      data-testid="gamehouse-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "#0a0f16" }}
    >
      {/* Venue header */}
      <div
        style={{
          ...panelStyle,
          position: "absolute",
          top: 12,
          left: 12,
          padding: "8px 12px",
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span style={{ color: "#ffd25a", fontWeight: 700 }}>
          🕹️ The Gamehouse · Arcade Floor
        </span>
        {site ? (
          <span
            data-testid="gamehouse-plot"
            style={{ color: "#7ab0d0", fontSize: 11 }}
          >
            Plot {site.parcelId} · {site.built ? "open" : "fitting out"}
          </span>
        ) : null}
      </div>

      <button
        data-build-action="gamehouse-exit"
        data-testid="gamehouse-exit"
        onClick={onClose}
        title="Leave the Gamehouse (Escape)"
        style={{
          ...controlButtonStyle,
          position: "absolute",
          top: 12,
          right: 12,
        }}
      >
        ✕ Exit
      </button>

      {/* The 8m x 8m arcade floor with the single Commons_Arcade cabinet. A styled 2D stand-in for the
          room; the 3D is reserved for the isolated cabinet inspection (no heavy scene at venue entry). */}
      <div
        data-testid="gamehouse-floor"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          data-build-action="gamehouse-inspect-cabinet"
          data-testid="gamehouse-cabinet"
          onClick={openInspect}
          disabled={!interaction.allowed}
          aria-label={interaction.prompt}
          title={interaction.prompt}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            padding: "24px 28px",
            borderRadius: 12,
            border: `1px solid ${interaction.allowed ? "#b6892f" : "#3a4a5a"}`,
            background: "rgba(8,14,24,0.9)",
            color: interaction.allowed ? "#ffd25a" : "#7a90a0",
            cursor: interaction.allowed ? "pointer" : "not-allowed",
            fontFamily: "monospace",
            fontWeight: 700,
          }}
        >
          <span style={{ fontSize: 48 }}>🕹️</span>
          <span data-testid="gamehouse-cabinet-name" style={{ fontSize: 14 }}>
            Commons_Arcade cabinet
          </span>
          <span style={{ fontSize: 11, color: "#7ab0d0", fontWeight: 400 }}>
            {width}m × {height}m × {depth}m
          </span>
          <span
            data-testid="gamehouse-cabinet-prompt"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {interaction.prompt}
          </span>
        </button>
      </div>

      {/* The isolated 3D inspection — mounted ONLY on cabinet interaction, and only for an authorized
          session. Closing it returns to the venue with the viewer fully disposed. */}
      {inspectOpen && interaction.allowed ? (
        <CabinetInspectModal
          onClose={closeInspect}
          isAuthenticated={isAuthenticated}
          nodeName="Commons_Arcade"
          roomName="arcade"
          reducedMotion={reducedMotion}
        />
      ) : null}
    </div>
  );
}
