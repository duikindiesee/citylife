// CITYLIFE.3D.VIEWER — Shared types and contracts for 3D prop inspection & room placement layout.
export type PropViewerMode = "prop" | "room";

export interface PropDimensions {
  w: number;
  h: number;
  d: number;
}

export interface PropPlacementNode {
  dimensions: PropDimensions;
  pivot: "floor-center" | "floor-center-back" | string;
}

export interface RoomGridSpec {
  gridWidthCells: number;
  gridDepthCells: number;
  origin?: string;
}

export interface PlacementItem {
  room: string;
  node: string;
  position: [number, number, number];
  yawRadians: number;
  note?: string;
}

export interface PropPlacementSchema {
  schema: string;
  asset: {
    id: string;
    url: string;
    generator?: string;
    provenance?: string;
    units?: string;
    upAxis?: string;
    forwardAxis?: string;
    publicSafe: boolean;
  };
  rooms: Record<string, RoomGridSpec>;
  frame?: Record<string, unknown>;
  nodes: Record<string, PropPlacementNode>;
  crossPackNodes?: Record<string, string>;
  placements: PlacementItem[];
  integration?: Record<string, unknown>;
}

export interface PropViewerControlsState {
  azimuth: number; // Y-axis rotation in radians
  polar: number;   // Pitch / elevation angle in radians
  zoom: number;    // Camera distance / scale
  pan: [number, number]; // [panX, panY]
}

export const DEFAULT_CONTROLS_STATE: PropViewerControlsState = {
  azimuth: 0.5,
  polar: (22 * Math.PI) / 180,
  zoom: 3.5,
  pan: [0, 0],
};

/** Clamps zoom within reasonable bounds for inspection */
export function clampPropZoom(zoom: number, min = 1.0, max = 10.0): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CONTROLS_STATE.zoom;
  return Math.max(min, Math.min(max, zoom));
}

/** Clamps polar (pitch) angle to prevent camera flipping */
export function clampPropPolar(polar: number): number {
  if (!Number.isFinite(polar)) return DEFAULT_CONTROLS_STATE.polar;
  const minPolar = (-80 * Math.PI) / 180;
  const maxPolar = (85 * Math.PI) / 180;
  return Math.max(minPolar, Math.min(maxPolar, polar));
}
