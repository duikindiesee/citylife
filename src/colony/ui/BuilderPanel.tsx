import React from "react";
import { useRoadNetwork } from "../stores/useRoadNetwork";
import { WorldSurveyMap } from "./WorldSurveyMap";
import type {
  SurveyMapSelection,
  SurveyTerrainLayer,
} from "./worldSurveyMapModel";

interface BuilderPanelProps {
  runtime?: any;
  sim?: any;
}

const BUILDER_ICON_BASE = "/assets/citylife/builder-icons/64";

export const CATEGORY_ICONS = {
  roads: { src: `${BUILDER_ICON_BASE}/roads.png`, alt: "Roads builder tool" },
  zoning: {
    src: `${BUILDER_ICON_BASE}/zoning.png`,
    alt: "Zoning builder tool",
  },
  landscaping: {
    src: `${BUILDER_ICON_BASE}/landscaping.png`,
    alt: "Landscaping builder tool",
  },
  bulldoze: {
    src: `${BUILDER_ICON_BASE}/bulldozer.png`,
    alt: "Bulldozer builder tool",
  },
} as const;

function BuilderCategoryIcon({
  category,
}: {
  category: keyof typeof CATEGORY_ICONS;
}) {
  const icon = CATEGORY_ICONS[category];
  return (
    <img
      src={icon.src}
      alt={icon.alt}
      width={28}
      height={28}
      style={{
        display: "block",
        width: "28px",
        height: "28px",
        objectFit: "contain",
        filter: "drop-shadow(0 0 4px rgba(87, 209, 196, 0.35))",
      }}
    />
  );
}

export function BuilderPanel({ runtime, sim }: BuilderPanelProps) {
  const {
    builderActive,
    toggleBuilder,
    worldViewActive,
    toggleWorldView,
    builderMode,
    setBuilderMode,
    saveToDB,
    loadFromDB,
  } = useRoadNetwork();
  const activeRoadType = useRoadNetwork((state) => state.activeRoadType);
  const setActiveRoadType = useRoadNetwork((state) => state.setActiveRoadType);
  const [surveyOpen, setSurveyOpen] = React.useState(false);
  const [surveyLayer, setSurveyLayer] =
    React.useState<SurveyTerrainLayer>("surface");
  const [surveyRevision, setSurveyRevision] = React.useState(0);
  const [surveyTarget, setSurveyTarget] = React.useState<{
    cell: { x: number; y: number };
    recordId?: string;
  } | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const [x, y] = (params.get("cell") ?? "").split(",").map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    const recordId = params.get("survey") ?? undefined;
    return { cell: { x: x!, y: y! }, ...(recordId ? { recordId } : {}) };
  });
  const surveyRegistry = React.useMemo(
    () =>
      surveyOpen && typeof runtime?.worldSurvey === "function"
        ? runtime.worldSurvey()
        : null,
    [runtime, surveyOpen, surveyRevision, sim?.state?.roadsVersion],
  );

  const selectSurveyLocation = (selection: SurveyMapSelection) => {
    const recordId = selection.selectedRecord?.id;
    setSurveyTarget({
      cell: selection.cell,
      ...(recordId ? { recordId } : {}),
    });
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("cell", `${selection.cell.x},${selection.cell.y}`);
    params.set("survey", selection.inspector.id);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${params.toString()}${window.location.hash}`,
    );
  };

  const surveyOverlay = surveyOpen && surveyRegistry && (
    <div
      role="dialog"
      aria-label="Authoritative world survey map"
      style={{
        position: "fixed",
        inset: "16px 16px 154px 16px",
        zIndex: 1200,
        overflow: "auto",
        padding: "12px",
        border: "1px solid #31566b",
        borderRadius: "10px",
        background: "rgba(4, 14, 22, 0.97)",
        boxShadow: "0 12px 50px rgba(0,0,0,0.72)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "10px",
          color: "#dce8ef",
          fontFamily: "monospace",
        }}
      >
        <strong style={{ color: "#57d1c4" }}>AUTHORITATIVE WORLD SURVEY</strong>
        <span style={{ color: "#91a6b4", fontSize: "11px" }}>
          north-up · fixed region grid · exact spatial addresses
        </span>
        <label style={{ marginLeft: "auto", fontSize: "12px" }}>
          Terrain{" "}
          <select
            value={surveyLayer}
            onChange={(event) =>
              setSurveyLayer(event.target.value as SurveyTerrainLayer)
            }
          >
            <option value="surface">Land / shore / sea</option>
            <option value="buildability">Buildability</option>
            <option value="elevation">Elevation</option>
          </select>
        </label>
        <button type="button" onClick={() => setSurveyRevision((n) => n + 1)}>
          Refresh truth
        </button>
        <button type="button" onClick={() => setSurveyOpen(false)}>
          Close map
        </button>
      </div>
      <WorldSurveyMap
        registry={surveyRegistry}
        width={720}
        height={540}
        terrainLayer={surveyLayer}
        selectedCell={surveyTarget?.cell}
        selectedRecordId={surveyTarget?.recordId}
        onSelect={selectSurveyLocation}
        onNavigate={(selection) => {
          selectSurveyLocation(selection);
          runtime?.focusSurveyCell?.(
            selection.inspector.cell.x,
            selection.inspector.cell.y,
          );
          useRoadNetwork.setState({
            builderActive: false,
            worldViewActive: true,
          });
          setSurveyOpen(false);
        }}
      />
    </div>
  );

  const ui = runtime?.getUiState();
  const sol = ui?.clock?.sol ?? 0;
  const hour = ui?.clock?.hour ?? 0;
  const min = ui?.clock?.minute ?? 0;
  const pop = ui?.citizens?.count ?? sim?.state?.citizens?.length ?? 0;
  const balance = ui?.bank?.balance ?? 0;

  if (!builderActive && !worldViewActive) {
    return (
      <>
        <div className="group">
          <button onClick={toggleWorldView} title="Enter Aerial World View">
            🌍 World View
          </button>
          <button onClick={toggleBuilder} title="Enter City Builder Mode">
            🏗️ City Builder
          </button>
          <button
            onClick={() => setSurveyOpen(true)}
            title="Open exact world survey map"
          >
            🗺️ Survey Map
          </button>
        </div>
        {surveyOverlay}
      </>
    );
  }

  if (worldViewActive) {
    return (
      <>
        <div className="group">
          <span style={{ color: "#a0b5c6", fontSize: "11px" }}>
            Drag to pan · Right-drag to tilt · Wheel to zoom
          </span>
          <button
            onClick={() => setSurveyOpen(true)}
            title="Open exact world survey map"
          >
            🗺️ Survey Map
          </button>
          <button
            onClick={toggleWorldView}
            style={{ color: "#ff6b6b" }}
            title="Exit World View"
          >
            Exit World View
          </button>
        </div>
        {surveyOverlay}
      </>
    );
  }

  const getCategory = () => {
    if (builderMode === "roads") return "roads";
    if (builderMode.startsWith("zoning_")) return "zoning";
    if (["raise", "lower", "flatten"].includes(builderMode))
      return "landscaping";
    if (builderMode === "bulldoze") return "bulldoze";
    return null;
  };

  const category = getCategory();

  // Mechanical Button Styles
  const getBtnStyle = (isActive: boolean) => ({
    background: isActive
      ? "linear-gradient(to bottom, #ff9f43, #d35400)"
      : "linear-gradient(to bottom, #50535c, #32353a)",
    color: isActive ? "#000" : "#e8edf7",
    border: isActive ? "2px solid #ffbe76" : "2px solid #575c66",
    boxShadow: isActive
      ? "inset 0 2px 4px rgba(0,0,0,0.4), 0 0 8px rgba(255, 159, 67, 0.4)"
      : "0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
    borderRadius: "4px",
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: "bold" as const,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    fontFamily: "monospace",
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
    minWidth: "120px",
    justifyContent: "center",
    transition: "all 0.1s ease",
  });

  return (
    <>
      {surveyOverlay}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          height: "140px",
          background:
            "linear-gradient(to bottom, #4a4d53 0%, #2b2d30 40%, #151617 100%)",
          borderTop: "5px solid #7c828d",
          boxShadow: "0 -8px 24px rgba(0,0,0,0.7)",
          display: "grid",
          gridTemplateColumns: "260px 1fr 220px",
          zIndex: 1000,
          fontFamily: "monospace",
          pointerEvents: "auto",
          userSelect: "none",
        }}
      >
        {/* SECTION 1: Retro Stats / Colony LCD Panel */}
        <div
          style={{
            padding: "12px 18px",
            borderRight: "3px double #222325",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "#1b1c1e",
            boxShadow: "inset -2px 0 5px rgba(0,0,0,0.5)",
            gap: "4px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#8a8e98",
              textTransform: "uppercase",
            }}
          >
            Colony Status
          </div>

          {/* Sol / Clock */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "#57d1c4",
              fontSize: "13px",
              textShadow: "0 0 3px #57d1c4",
            }}
          >
            <span>SOL / DAY:</span>
            <span>
              {sol} ({String(hour).padStart(2, "0")}:
              {String(min).padStart(2, "0")})
            </span>
          </div>

          {/* Population */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "#ff9f43",
              fontSize: "13px",
              textShadow: "0 0 3px #ff9f43",
            }}
          >
            <span>POPULATION:</span>
            <span>{pop} CITIZENS</span>
          </div>

          {/* Treasury */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "#55ff55",
              fontSize: "13px",
              textShadow: "0 0 3px #55ff55",
            }}
          >
            <span>FUNDS:</span>
            <span>${balance.toLocaleString()} CC</span>
          </div>
        </div>

        {/* SECTION 2: Construction Tools / Categories */}
        <div
          style={{
            padding: "12px 24px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "12px",
            position: "relative",
          }}
        >
          {/* Submenu Tray (Top of tool segment) */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              height: "38px",
              alignItems: "center",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "4px",
              padding: "0 12px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <span
              style={{
                color: "#8a8e98",
                fontSize: "10px",
                textTransform: "uppercase",
                marginRight: "6px",
              }}
            >
              {category ? `${category} options:` : "Select category"}
            </span>

            {category === "roads" && (
              <>
                <button
                  style={{
                    background:
                      activeRoadType === "street"
                        ? "#ff9f43"
                        : "rgba(255,255,255,0.05)",
                    color: activeRoadType === "street" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => {
                    setBuilderMode("roads");
                    setActiveRoadType("street");
                  }}
                >
                  🛣️ STREET
                </button>
                <button
                  style={{
                    background:
                      activeRoadType === "gravel"
                        ? "#ff9f43"
                        : "rgba(255,255,255,0.05)",
                    color: activeRoadType === "gravel" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => {
                    setBuilderMode("roads");
                    setActiveRoadType("gravel");
                  }}
                >
                  🪨 GRAVEL AVENUE
                </button>
                <button
                  style={{
                    background:
                      activeRoadType === "culdesac"
                        ? "#ff9f43"
                        : "rgba(255,255,255,0.05)",
                    color: activeRoadType === "culdesac" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => {
                    setBuilderMode("roads");
                    setActiveRoadType("culdesac");
                  }}
                >
                  🍩 CUL-DE-SAC
                </button>
              </>
            )}

            {category === "zoning" && (
              <>
                <button
                  style={{
                    background:
                      builderMode === "zoning_residential"
                        ? "#55ff55"
                        : "rgba(255,255,255,0.05)",
                    color:
                      builderMode === "zoning_residential" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => setBuilderMode("zoning_residential")}
                >
                  🏠 RESIDENTIAL PLOT
                </button>
                <button
                  style={{
                    background:
                      builderMode === "zoning_commercial"
                        ? "#55cfff"
                        : "rgba(255,255,255,0.05)",
                    color:
                      builderMode === "zoning_commercial" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => setBuilderMode("zoning_commercial")}
                >
                  🏢 COMMERCIAL PLOT
                </button>
              </>
            )}

            {category === "landscaping" && (
              <>
                <button
                  style={{
                    background:
                      builderMode === "raise"
                        ? "#ff9f43"
                        : "rgba(255,255,255,0.05)",
                    color: builderMode === "raise" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => setBuilderMode("raise")}
                >
                  🏔️ RAISE
                </button>
                <button
                  style={{
                    background:
                      builderMode === "lower"
                        ? "#ff9f43"
                        : "rgba(255,255,255,0.05)",
                    color: builderMode === "lower" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => setBuilderMode("lower")}
                >
                  🕳️ LOWER
                </button>
                <button
                  style={{
                    background:
                      builderMode === "flatten"
                        ? "#ff9f43"
                        : "rgba(255,255,255,0.05)",
                    color: builderMode === "flatten" ? "#000" : "#8a8e98",
                    border: "none",
                    borderRadius: "3px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: "bold",
                    fontFamily: "monospace",
                  }}
                  onClick={() => setBuilderMode("flatten")}
                >
                  ➖ FLATTEN
                </button>
              </>
            )}

            {category === "bulldoze" && (
              <span
                style={{
                  color: "#ff3333",
                  fontSize: "11px",
                  fontWeight: "bold",
                }}
              >
                🚜 DEMOLISHING TILES AND PLOTS
              </span>
            )}
          </div>

          {/* Category Selector Grid */}
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              style={getBtnStyle(category === "roads")}
              onClick={() => setBuilderMode("roads")}
            >
              <BuilderCategoryIcon category="roads" />
              ROADS
            </button>
            <button
              style={getBtnStyle(category === "zoning")}
              onClick={() => setBuilderMode("zoning_residential")}
            >
              <BuilderCategoryIcon category="zoning" />
              ZONING
            </button>
            <button
              style={getBtnStyle(category === "landscaping")}
              onClick={() => setBuilderMode("raise")}
            >
              <BuilderCategoryIcon category="landscaping" />
              LANDSCAPING
            </button>
            <button
              style={getBtnStyle(category === "bulldoze")}
              onClick={() => setBuilderMode("bulldoze")}
            >
              <BuilderCategoryIcon category="bulldoze" />
              BULLDOZE
            </button>
          </div>
        </div>

        {/* SECTION 3: System Actions / Save/Load/Exit */}
        <div
          style={{
            padding: "12px 18px",
            borderLeft: "3px double #222325",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "8px",
            background: "#1b1c1e",
            boxShadow: "inset 2px 0 5px rgba(0,0,0,0.5)",
          }}
        >
          {/* Save/Load side by side */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={saveToDB}
              style={{
                flex: 1,
                background: "linear-gradient(to bottom, #4a4d53, #2b2d30)",
                color: "#fff",
                border: "1px solid #7c828d",
                borderRadius: "3px",
                padding: "6px",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: "bold",
                fontFamily: "monospace",
              }}
            >
              💾 SAVE
            </button>
            <button
              onClick={loadFromDB}
              style={{
                flex: 1,
                background: "linear-gradient(to bottom, #4a4d53, #2b2d30)",
                color: "#fff",
                border: "1px solid #7c828d",
                borderRadius: "3px",
                padding: "6px",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: "bold",
                fontFamily: "monospace",
              }}
            >
              📂 LOAD
            </button>
          </div>

          {/* Exit Builder Emergency Plunger Button */}
          <button
            onClick={toggleBuilder}
            style={{
              background: "linear-gradient(to bottom, #c0392b, #962d22)",
              color: "#fff",
              border: "2px solid #e74c3c",
              borderRadius: "4px",
              padding: "10px",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "12px",
              letterSpacing: "1px",
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
              boxShadow: "0 3px 5px rgba(0,0,0,0.4)",
              fontFamily: "monospace",
            }}
          >
            🚨 EXIT BUILDER
          </button>
        </div>
      </div>
    </>
  );
}
