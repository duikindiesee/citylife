// Spec 152 WB.1e-a — Kooker HQ exterior building frame, one nested reception interior frame and a
// deterministic enter/exit door portal pair, authored purely at the canonical WorldLayoutDocument
// layer.
//
// This module does NOT render anything and does NOT decide where the HQ sits in the running world —
// the runtime survey/wiring slice supplies the surveyed HQ site. It is the single authoritative
// source for the HQ frame graph fragment so that the exterior boundary, the reception room and the
// door are addressed beneath the surface island without moving or rewriting a single existing island
// frame, placement, road or coordinate. Entering the HQ is therefore a streaming boundary, never a
// coordinate or identity reset (spec 152).
//
// The fragment is deterministic for a given surface frame + options, and the enter/exit portals are
// exact inverses: the reception door resolves back onto the surface entrance point through the
// invertible parent/local frame transforms in ./frameTransforms.
import type { GridCell, Vec3 } from "../worldSurvey";
import type {
  WorldLayoutDocumentInput,
  WorldLayoutFrame,
  WorldLayoutPortal,
} from "./worldLayoutDocument";

/** Human-readable final id/address segment for the HQ building frame. */
export const KOOKER_HQ_LOCAL_ID = "kooker-hq" as const;
/** Human-readable final id/address segment for the nested reception room frame. */
export const KOOKER_HQ_RECEPTION_LOCAL_ID = "reception" as const;

/** Reception hall interior floor, in a 1 m interior grid kept numerically small (spec 152). */
export const KOOKER_HQ_RECEPTION_WIDTH_CELLS = 12 as const;
export const KOOKER_HQ_RECEPTION_DEPTH_CELLS = 10 as const;
export const KOOKER_HQ_RECEPTION_CELL_SIZE = 1 as const;

/** Compass facing of the HQ door; maps to a yaw about the surface Y axis. */
export type KookerHqFacing = "n" | "e" | "s" | "w";

const FACING_YAW: Record<KookerHqFacing, number> = {
  n: 0,
  e: Math.PI / 2,
  s: Math.PI,
  w: -Math.PI / 2,
};

export interface KookerHqInteriorOptions {
  /**
   * Surface grid cell of the HQ door. Defaults to the surface grid centre as a placeholder; the
   * runtime survey slice passes the real surveyed, buildable HQ site.
   */
  readonly entranceCell?: GridCell;
  /** Direction the HQ door faces on the surface. Defaults to north. */
  readonly facing?: KookerHqFacing;
}

export interface KookerHqInteriorFragment {
  readonly frames: readonly WorldLayoutFrame[];
  readonly portals: readonly WorldLayoutPortal[];
  readonly buildingFrameId: string;
  readonly receptionFrameId: string;
  readonly enterPortalId: string;
  readonly exitPortalId: string;
  /** The surface-local door point both portals pin to. */
  readonly entrancePoint: Vec3;
  /** The reception-local door point both portals pin to. */
  readonly receptionDoorPoint: Vec3;
}

export type KookerHqInteriorErrorCode =
  | "MISSING_SURFACE_FRAME"
  | "AMBIGUOUS_SURFACE_FRAME"
  | "SURFACE_FRAME_NOT_GRIDDED"
  | "ENTRANCE_OUT_OF_BOUNDS"
  | "ALREADY_PRESENT";

export class KookerHqInteriorError extends Error {
  constructor(
    readonly code: KookerHqInteriorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KookerHqInteriorError";
  }
}

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0 } as const;
const UNIT_SCALE = { x: 1, y: 1, z: 1 } as const;

/**
 * Build the HQ frame/portal fragment for a specific surface frame. Pure and deterministic: the same
 * surface frame and options always yield byte-identical frames and portals. The surface frame must
 * carry a grid (the island); its own id, address, transform and grid are read but never modified.
 */
export function buildKookerHqInteriorFragment(
  surfaceFrame: WorldLayoutFrame,
  options: KookerHqInteriorOptions = {},
): KookerHqInteriorFragment {
  const grid = surfaceFrame.grid;
  if (!grid)
    throw new KookerHqInteriorError(
      "SURFACE_FRAME_NOT_GRIDDED",
      `surface frame ${surfaceFrame.id} has no grid to anchor the HQ door to`,
    );

  const entranceCell = options.entranceCell ?? {
    x: Math.floor(grid.width / 2),
    y: Math.floor(grid.height / 2),
  };
  if (
    !Number.isInteger(entranceCell.x) ||
    !Number.isInteger(entranceCell.y) ||
    entranceCell.x < 0 ||
    entranceCell.y < 0 ||
    entranceCell.x >= grid.width ||
    entranceCell.y >= grid.height
  )
    throw new KookerHqInteriorError(
      "ENTRANCE_OUT_OF_BOUNDS",
      `HQ entrance cell (${entranceCell.x}, ${entranceCell.y}) is outside surface grid ${surfaceFrame.id}`,
    );

  const yaw = FACING_YAW[options.facing ?? "n"];

  // Surface-local door point (grid space, before the surface frame transform). Cell-centred so it
  // sits inside the island grid extent the document contract enforces.
  const entrancePoint: Vec3 = {
    x: grid.origin.x + (entranceCell.x + 0.5) * grid.cellSize,
    y: grid.origin.y,
    z: grid.origin.z + (entranceCell.y + 0.5) * grid.cellSize,
  };

  const buildingFrameId = `${surfaceFrame.id}:building:${KOOKER_HQ_LOCAL_ID}`;
  const buildingAddress = `${surfaceFrame.address}/building/${KOOKER_HQ_LOCAL_ID}`;
  const receptionFrameId = `${buildingFrameId}:room:${KOOKER_HQ_RECEPTION_LOCAL_ID}`;
  const receptionAddress = `${buildingAddress}/room/${KOOKER_HQ_RECEPTION_LOCAL_ID}`;

  // The building origin is the door; the reception hall is centred on that door on X and opens
  // forward in +Z. So the reception-local door point maps exactly onto the building origin, which in
  // turn maps exactly onto the surface entrance point — for any facing yaw.
  const receptionHalfWidth =
    (KOOKER_HQ_RECEPTION_WIDTH_CELLS * KOOKER_HQ_RECEPTION_CELL_SIZE) / 2;
  const receptionDoorPoint: Vec3 = { x: receptionHalfWidth, y: 0, z: 0 };

  const buildingFrame: WorldLayoutFrame = {
    id: buildingFrameId,
    address: buildingAddress,
    kind: "building",
    layer: "surface",
    parentId: surfaceFrame.id,
    transform: {
      position: { ...entrancePoint },
      rotation: { x: 0, y: yaw, z: 0 },
      scale: { ...UNIT_SCALE },
    },
  };

  const receptionFrame: WorldLayoutFrame = {
    id: receptionFrameId,
    address: receptionAddress,
    kind: "room",
    layer: "interior",
    parentId: buildingFrameId,
    transform: {
      position: { x: -receptionHalfWidth, y: 0, z: 0 },
      rotation: { ...IDENTITY_ROTATION },
      scale: { ...UNIT_SCALE },
    },
    grid: {
      width: KOOKER_HQ_RECEPTION_WIDTH_CELLS,
      height: KOOKER_HQ_RECEPTION_DEPTH_CELLS,
      cellSize: KOOKER_HQ_RECEPTION_CELL_SIZE,
      origin: { x: 0, y: 0, z: 0 },
    },
  };

  const enterPortalId = `${buildingFrameId}:portal:enter`;
  const exitPortalId = `${buildingFrameId}:portal:exit`;
  const enterPortal: WorldLayoutPortal = {
    id: enterPortalId,
    address: `${buildingAddress}/portal/enter`,
    fromFrameId: surfaceFrame.id,
    toFrameId: receptionFrameId,
    from: { ...entrancePoint },
    to: { ...receptionDoorPoint },
    modes: ["walk", "portal"],
  };
  const exitPortal: WorldLayoutPortal = {
    id: exitPortalId,
    address: `${buildingAddress}/portal/exit`,
    fromFrameId: receptionFrameId,
    toFrameId: surfaceFrame.id,
    from: { ...receptionDoorPoint },
    to: { ...entrancePoint },
    modes: ["walk", "portal"],
  };

  return {
    frames: [buildingFrame, receptionFrame],
    portals: [enterPortal, exitPortal],
    buildingFrameId,
    receptionFrameId,
    enterPortalId,
    exitPortalId,
    entrancePoint,
    receptionDoorPoint,
  };
}

/** Locate the single surface region frame a document's island lives on. */
function findSurfaceFrame(
  frames: readonly WorldLayoutFrame[],
): WorldLayoutFrame {
  const surfaces = frames.filter(
    (frame) => frame.kind === "region" && frame.layer === "surface",
  );
  if (surfaces.length === 0)
    throw new KookerHqInteriorError(
      "MISSING_SURFACE_FRAME",
      "document has no surface region frame to anchor the HQ to",
    );
  if (surfaces.length > 1)
    throw new KookerHqInteriorError(
      "AMBIGUOUS_SURFACE_FRAME",
      `document has ${surfaces.length} surface region frames; specify the HQ site explicitly`,
    );
  return surfaces[0]!;
}

/**
 * Return a new document input with the HQ building frame, reception room frame and enter/exit door
 * portals appended. Every existing frame, portal, placement, road, way, zone, reservation, network
 * and terrain edit is carried through untouched and in order, so no original island id or coordinate
 * changes. Throws ALREADY_PRESENT if the HQ frames are already authored, which keeps the fragment
 * from ever producing a duplicate or ghost frame.
 */
export function withKookerHqInterior(
  input: WorldLayoutDocumentInput,
  options: KookerHqInteriorOptions = {},
): WorldLayoutDocumentInput {
  const surfaceFrame = findSurfaceFrame(input.frames);
  const fragment = buildKookerHqInteriorFragment(surfaceFrame, options);

  const existingFrameIds = new Set(input.frames.map((frame) => frame.id));
  const existingPortalIds = new Set(
    input.portals.map((portal) => portal.id),
  );
  for (const frame of fragment.frames)
    if (existingFrameIds.has(frame.id))
      throw new KookerHqInteriorError(
        "ALREADY_PRESENT",
        `HQ frame ${frame.id} is already present in the document`,
      );
  for (const portal of fragment.portals)
    if (existingPortalIds.has(portal.id))
      throw new KookerHqInteriorError(
        "ALREADY_PRESENT",
        `HQ portal ${portal.id} is already present in the document`,
      );

  return {
    ...input,
    frames: [...input.frames, ...fragment.frames],
    portals: [...input.portals, ...fragment.portals],
  };
}
