// PLAYER.GARAGE.1 — the Gearbox Auto Hub showroom interior, authored at the canonical
// WorldLayoutDocument layer exactly like the Kooker HQ reception (spec 152): an exterior building
// frame anchored on the surveyed garage entrance cell, one nested showroom room frame, and a
// deterministic enter/exit door portal pair that are exact inverses. This module renders nothing and
// decides nothing about where the garage sits — the runtime survey supplies the entrance cell (the
// garage pad's road target). Entering the showroom is a streaming boundary, never a coordinate or
// identity reset.
import type { GridCell, Vec3 } from "../worldSurvey";
import type {
  WorldLayoutDocumentInput,
  WorldLayoutFrame,
  WorldLayoutPortal,
} from "./worldLayoutDocument";

/** Human-readable final id/address segment for the showroom building frame. */
export const GARAGE_SHOWROOM_LOCAL_ID = "gearbox-showroom" as const;
/** Human-readable final id/address segment for the nested showroom floor frame. */
export const GARAGE_SHOWROOM_FLOOR_LOCAL_ID = "showroom-floor" as const;

/** Showroom floor, in a 1 m interior grid kept numerically small (spec 152). */
export const GARAGE_SHOWROOM_WIDTH_CELLS = 14 as const;
export const GARAGE_SHOWROOM_DEPTH_CELLS = 10 as const;
export const GARAGE_SHOWROOM_CELL_SIZE = 1 as const;

/** Compass facing of the showroom door; maps to a yaw about the surface Y axis. */
export type GarageShowroomFacing = "n" | "e" | "s" | "w";

const FACING_YAW: Record<GarageShowroomFacing, number> = {
  n: 0,
  e: Math.PI / 2,
  s: Math.PI,
  w: -Math.PI / 2,
};

export interface GarageShowroomInteriorOptions {
  /** Surface grid cell of the showroom door — the garage pad's road-facing entrance. Defaults to
   *  the surface grid centre as a placeholder; the runtime wiring slice passes the surveyed cell. */
  readonly entranceCell?: GridCell;
  /** Direction the showroom door faces on the surface. Defaults to north. */
  readonly facing?: GarageShowroomFacing;
}

export interface GarageShowroomInteriorFragment {
  readonly frames: readonly WorldLayoutFrame[];
  readonly portals: readonly WorldLayoutPortal[];
  readonly buildingFrameId: string;
  readonly floorFrameId: string;
  readonly enterPortalId: string;
  readonly exitPortalId: string;
  /** The surface-local door point both portals pin to. */
  readonly entrancePoint: Vec3;
  /** The showroom-local door point both portals pin to. */
  readonly floorDoorPoint: Vec3;
}

export type GarageShowroomInteriorErrorCode =
  | "MISSING_SURFACE_FRAME"
  | "AMBIGUOUS_SURFACE_FRAME"
  | "SURFACE_FRAME_NOT_GRIDDED"
  | "ENTRANCE_OUT_OF_BOUNDS"
  | "ALREADY_PRESENT";

export class GarageShowroomInteriorError extends Error {
  constructor(
    readonly code: GarageShowroomInteriorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GarageShowroomInteriorError";
  }
}

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0 } as const;
const UNIT_SCALE = { x: 1, y: 1, z: 1 } as const;

/** Build the showroom frame/portal fragment for a specific surface frame. Pure and deterministic:
 *  the same surface frame and options always yield byte-identical frames and portals. */
export function buildGarageShowroomInteriorFragment(
  surfaceFrame: WorldLayoutFrame,
  options: GarageShowroomInteriorOptions = {},
): GarageShowroomInteriorFragment {
  const grid = surfaceFrame.grid;
  if (!grid)
    throw new GarageShowroomInteriorError(
      "SURFACE_FRAME_NOT_GRIDDED",
      `surface frame ${surfaceFrame.id} has no grid to anchor the showroom door to`,
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
    throw new GarageShowroomInteriorError(
      "ENTRANCE_OUT_OF_BOUNDS",
      `showroom entrance cell (${entranceCell.x}, ${entranceCell.y}) is outside surface grid ${surfaceFrame.id}`,
    );

  const yaw = FACING_YAW[options.facing ?? "n"];

  const entrancePoint: Vec3 = {
    x: grid.origin.x + (entranceCell.x + 0.5) * grid.cellSize,
    y: grid.origin.y,
    z: grid.origin.z + (entranceCell.y + 0.5) * grid.cellSize,
  };

  const buildingFrameId = `${surfaceFrame.id}:building:${GARAGE_SHOWROOM_LOCAL_ID}`;
  const buildingAddress = `${surfaceFrame.address}/building/${GARAGE_SHOWROOM_LOCAL_ID}`;
  const floorFrameId = `${buildingFrameId}:room:${GARAGE_SHOWROOM_FLOOR_LOCAL_ID}`;
  const floorAddress = `${buildingAddress}/room/${GARAGE_SHOWROOM_FLOOR_LOCAL_ID}`;

  // The building origin is the door; the showroom floor is centred on the door on X and opens
  // forward in +Z, so the floor-local door point maps exactly onto the surface entrance point.
  const floorHalfWidth =
    (GARAGE_SHOWROOM_WIDTH_CELLS * GARAGE_SHOWROOM_CELL_SIZE) / 2;
  const floorDoorPoint: Vec3 = { x: floorHalfWidth, y: 0, z: 0 };

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

  const floorFrame: WorldLayoutFrame = {
    id: floorFrameId,
    address: floorAddress,
    kind: "room",
    layer: "interior",
    parentId: buildingFrameId,
    transform: {
      position: { x: -floorHalfWidth, y: 0, z: 0 },
      rotation: { ...IDENTITY_ROTATION },
      scale: { ...UNIT_SCALE },
    },
    grid: {
      width: GARAGE_SHOWROOM_WIDTH_CELLS,
      height: GARAGE_SHOWROOM_DEPTH_CELLS,
      cellSize: GARAGE_SHOWROOM_CELL_SIZE,
      origin: { x: 0, y: 0, z: 0 },
    },
  };

  const enterPortalId = `${buildingFrameId}:portal:enter`;
  const exitPortalId = `${buildingFrameId}:portal:exit`;
  const enterPortal: WorldLayoutPortal = {
    id: enterPortalId,
    address: `${buildingAddress}/portal/enter`,
    fromFrameId: surfaceFrame.id,
    toFrameId: floorFrameId,
    from: { ...entrancePoint },
    to: { ...floorDoorPoint },
    modes: ["walk", "portal"],
  };
  const exitPortal: WorldLayoutPortal = {
    id: exitPortalId,
    address: `${buildingAddress}/portal/exit`,
    fromFrameId: floorFrameId,
    toFrameId: surfaceFrame.id,
    from: { ...floorDoorPoint },
    to: { ...entrancePoint },
    modes: ["walk", "portal"],
  };

  return {
    frames: [buildingFrame, floorFrame],
    portals: [enterPortal, exitPortal],
    buildingFrameId,
    floorFrameId,
    enterPortalId,
    exitPortalId,
    entrancePoint,
    floorDoorPoint,
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
    throw new GarageShowroomInteriorError(
      "MISSING_SURFACE_FRAME",
      "document has no surface region frame to anchor the showroom to",
    );
  if (surfaces.length > 1)
    throw new GarageShowroomInteriorError(
      "AMBIGUOUS_SURFACE_FRAME",
      `document has ${surfaces.length} surface region frames; specify the showroom site explicitly`,
    );
  return surfaces[0]!;
}

/** Return a new document input with the showroom building frame, floor frame and enter/exit portals
 *  appended; every existing frame/portal/placement is carried through untouched and in order.
 *  Throws ALREADY_PRESENT rather than ever duplicating a frame or portal. */
export function withGarageShowroomInterior(
  input: WorldLayoutDocumentInput,
  options: GarageShowroomInteriorOptions = {},
): WorldLayoutDocumentInput {
  const surfaceFrame = findSurfaceFrame(input.frames);
  const fragment = buildGarageShowroomInteriorFragment(surfaceFrame, options);

  const existingFrameIds = new Set(input.frames.map((frame) => frame.id));
  const existingPortalIds = new Set(input.portals.map((portal) => portal.id));
  for (const frame of fragment.frames)
    if (existingFrameIds.has(frame.id))
      throw new GarageShowroomInteriorError(
        "ALREADY_PRESENT",
        `showroom frame ${frame.id} is already present in the document`,
      );
  for (const portal of fragment.portals)
    if (existingPortalIds.has(portal.id))
      throw new GarageShowroomInteriorError(
        "ALREADY_PRESENT",
        `showroom portal ${portal.id} is already present in the document`,
      );

  return {
    ...input,
    frames: [...input.frames, ...fragment.frames],
    portals: [...input.portals, ...fragment.portals],
  };
}
