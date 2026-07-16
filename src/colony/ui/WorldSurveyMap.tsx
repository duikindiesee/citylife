import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type {
  GridCell,
  SpatialRecord,
  WorldSurveyRegistry,
} from "../worldSurvey";
import {
  buildWorldSurveyMapModel,
  inspectSurveySelection,
  surveyGridToPixel,
  surveyPixelToGrid,
  type SurveyMapSelection,
  type SurveyTerrainLayer,
} from "./worldSurveyMapModel";

export interface WorldSurveyMapProps {
  registry: WorldSurveyRegistry;
  width?: number;
  height?: number;
  frameId?: string;
  terrainLayer?: SurveyTerrainLayer;
  showRoads?: boolean;
  showFootprints?: boolean;
  showTransit?: boolean;
  selectedCell?: GridCell | null;
  selectedRecordId?: string;
  className?: string;
  style?: CSSProperties;
  onSelect?: (selection: SurveyMapSelection) => void;
  /** The exact selected world position can be handed to a renderer camera or navigation tool. */
  onNavigate?: (selection: SurveyMapSelection) => void;
}

const RECORD_COLORS: Partial<Record<SpatialRecord["kind"], string>> = {
  "residential-plot": "#d7e6ff",
  "commercial-plot": "#ffcf70",
  building: "#e5e7eb",
  structure: "#e5e7eb",
  garage: "#ff8a65",
  mall: "#d77cff",
  "bus-depot": "#49d6c8",
};

function drawPolyline(
  context: CanvasRenderingContext2D,
  cells: readonly GridCell[],
  project: (cell: GridCell) => { x: number; y: number },
  scale: number,
): void {
  if (cells.length === 0) return;
  context.beginPath();
  cells.forEach((cell, index) => {
    const point = project({ x: cell.x + 0.5, y: cell.y + 0.5 });
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.lineWidth = Math.max(1.5, scale * 0.45);
  context.stroke();
}

function recordBounds(
  record: SpatialRecord,
): { x: number; y: number; w: number; h: number } | null {
  const geometry = record.geometry;
  if (geometry.type === "footprint" || geometry.type === "volume")
    return geometry.bounds;
  if (geometry.type === "cell")
    return { x: geometry.cell.x, y: geometry.cell.y, w: 1, h: 1 };
  return null;
}

function formatMetadata(metadata: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(metadata, null, 2);
}

export function WorldSurveyMap({
  registry,
  width = 760,
  height = 620,
  frameId,
  terrainLayer = "surface",
  showRoads = true,
  showFootprints = true,
  showTransit = true,
  selectedCell = null,
  selectedRecordId,
  className,
  style,
  onSelect,
  onNavigate,
}: WorldSurveyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [internalSelection, setInternalSelection] =
    useState<SurveyMapSelection | null>(null);
  const model = useMemo(
    () =>
      buildWorldSurveyMapModel(registry, {
        viewportWidth: width,
        viewportHeight: height,
        terrainLayer,
        frameId,
      }),
    [registry, width, height, terrainLayer, frameId],
  );
  const selection = useMemo(() => {
    if (selectedCell)
      return inspectSurveySelection(
        registry,
        selectedCell,
        selectedRecordId,
        model.projection.frameId,
      );
    return internalSelection;
  }, [
    registry,
    selectedCell,
    selectedRecordId,
    internalSelection,
    model.projection.frameId,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#07131d";
    context.fillRect(0, 0, width, height);
    const terrainCanvas = document.createElement("canvas");
    terrainCanvas.width = model.projection.gridWidth;
    terrainCanvas.height = model.projection.gridHeight;
    const terrainContext = terrainCanvas.getContext("2d");
    if (!terrainContext) return;
    const imageData = terrainContext.createImageData(
      model.projection.gridWidth,
      model.projection.gridHeight,
    );
    imageData.data.set(model.terrainRgba);
    terrainContext.putImageData(imageData, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      terrainCanvas,
      model.projection.offsetX,
      model.projection.offsetY,
      model.projection.gridWidth * model.projection.scale,
      model.projection.gridHeight * model.projection.scale,
    );
    const project = (cell: GridCell) =>
      surveyGridToPixel(model.projection, cell);

    if (showRoads) {
      context.fillStyle = "rgba(38, 44, 52, 0.9)";
      for (const record of model.overlays.roadCells) {
        const bounds = recordBounds(record);
        if (!bounds) continue;
        const point = project(bounds);
        context.fillRect(
          point.x,
          point.y,
          bounds.w * model.projection.scale,
          bounds.h * model.projection.scale,
        );
      }
      context.strokeStyle = "rgba(45, 51, 59, 0.95)";
      for (const record of model.overlays.roadPaths)
        if (record.geometry.type === "polyline")
          drawPolyline(
            context,
            record.geometry.cells,
            project,
            model.projection.scale,
          );
      context.fillStyle = "#f5c451";
      for (const record of model.overlays.intersections) {
        const bounds = recordBounds(record);
        if (!bounds) continue;
        const point = project({ x: bounds.x + 0.5, y: bounds.y + 0.5 });
        context.beginPath();
        context.arc(
          point.x,
          point.y,
          Math.max(2, model.projection.scale * 0.32),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }

    if (showFootprints) {
      for (const record of model.overlays.footprints) {
        const bounds = recordBounds(record);
        if (!bounds) continue;
        const point = project(bounds);
        context.fillStyle = `${RECORD_COLORS[record.kind] ?? "#edf2f7"}55`;
        context.strokeStyle = RECORD_COLORS[record.kind] ?? "#edf2f7";
        context.lineWidth = record.id === selection?.selectedRecord?.id ? 3 : 1;
        context.fillRect(
          point.x,
          point.y,
          bounds.w * model.projection.scale,
          bounds.h * model.projection.scale,
        );
        context.strokeRect(
          point.x,
          point.y,
          bounds.w * model.projection.scale,
          bounds.h * model.projection.scale,
        );
      }
    }

    if (showTransit) {
      context.strokeStyle = "#41e7dc";
      for (const record of model.overlays.routes)
        if (record.geometry.type === "polyline")
          drawPolyline(
            context,
            record.geometry.cells,
            project,
            model.projection.scale,
          );
      context.fillStyle = "#eaffff";
      context.strokeStyle = "#008e91";
      for (const record of model.overlays.stops) {
        if (record.geometry.type !== "point" || !record.geometry.cell) continue;
        const point = project({
          x: record.geometry.cell.x + 0.5,
          y: record.geometry.cell.y + 0.5,
        });
        context.beginPath();
        context.arc(
          point.x,
          point.y,
          Math.max(2.5, model.projection.scale * 0.4),
          0,
          Math.PI * 2,
        );
        context.fill();
        context.stroke();
      }
    }

    if (selection) {
      const point = project(selection.cell);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.strokeRect(
        point.x,
        point.y,
        model.projection.scale,
        model.projection.scale,
      );
    }

    context.strokeStyle = "rgba(255,255,255,0.7)";
    context.lineWidth = 1;
    context.strokeRect(
      model.projection.offsetX,
      model.projection.offsetY,
      model.projection.gridWidth * model.projection.scale,
      model.projection.gridHeight * model.projection.scale,
    );
  }, [model, selection, showRoads, showFootprints, showTransit, width, height]);

  const handleClick = (event: MouseEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const pixel = {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
    const cell = surveyPixelToGrid(model.projection, pixel);
    if (!cell) return;
    const base = inspectSurveySelection(
      registry,
      cell,
      undefined,
      model.projection.frameId,
    );
    if (!base) return;
    // Footprints are the most useful default target; clicking again can be driven externally via id.
    const preferred =
      [...base.records]
        .reverse()
        .find(
          (record) =>
            record.geometry.type === "footprint" ||
            record.geometry.type === "volume",
        ) ?? [...base.records].reverse()[0];
    const next = preferred
      ? inspectSurveySelection(
          registry,
          cell,
          preferred.id,
          model.projection.frameId,
        )!
      : base;
    if (!selectedCell) setInternalSelection(next);
    onSelect?.(next);
  };

  return (
    <section
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 320px)",
        gap: 12,
        color: "#dce8ef",
        ...style,
      }}
      aria-label="Exact world survey map"
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        style={{
          width: "100%",
          height: "auto",
          background: "#07131d",
          cursor: "crosshair",
        }}
        aria-label={`North-up ${model.projection.gridWidth} by ${model.projection.gridHeight} survey grid`}
      />
      <aside
        style={{
          background: "#0b1b26",
          border: "1px solid #244152",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <strong>Exact survey inspector</strong>
        {!selection ? (
          <p style={{ color: "#91a6b4" }}>
            Select a cell to inspect its stable address and metadata.
          </p>
        ) : (
          <>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "4px 10px",
                fontSize: 13,
              }}
            >
              <dt>ID</dt>
              <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                {selection.inspector.id}
              </dd>
              <dt>Address</dt>
              <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                {selection.inspector.address}
              </dd>
              <dt>Grid</dt>
              <dd style={{ margin: 0 }}>
                {selection.inspector.cell.x}, {selection.inspector.cell.y}
              </dd>
              <dt>World</dt>
              <dd style={{ margin: 0 }}>
                {selection.inspector.world.x.toFixed(2)},{" "}
                {selection.inspector.world.y.toFixed(2)},{" "}
                {selection.inspector.world.z.toFixed(2)}
              </dd>
              <dt>Elevation</dt>
              <dd style={{ margin: 0 }}>
                {selection.inspector.elevation.toFixed(2)}
              </dd>
              <dt>Kind</dt>
              <dd style={{ margin: 0 }}>{selection.inspector.recordKind}</dd>
              {selection.inspector.selectionType === "record" &&
                selection.inspector.footprint && (
                  <>
                    <dt>Footprint</dt>
                    <dd style={{ margin: 0 }}>
                      {selection.inspector.footprint.width} ×{" "}
                      {selection.inspector.footprint.depth}, yaw{" "}
                      {selection.inspector.footprint.yaw.toFixed(3)}
                    </dd>
                  </>
                )}
            </dl>
            {selection.records.length > 1 && (
              <p style={{ fontSize: 12, color: "#91a6b4" }}>
                {selection.records.length} mapped records occupy this cell.
              </p>
            )}
            <pre
              style={{
                fontSize: 11,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                color: "#a9c4d3",
              }}
            >
              {formatMetadata(selection.inspector.metadata)}
            </pre>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate(selection)}>
                Navigate to exact location
              </button>
            )}
          </>
        )}
      </aside>
    </section>
  );
}
