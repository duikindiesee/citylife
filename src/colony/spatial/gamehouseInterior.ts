// ARCADE.1 — the Kooker Gamehouse commercial venue interior, authored purely at the canonical
// WorldLayoutDocument layer exactly like the Kooker HQ reception (spec 152/153) and the Gearbox
// showroom (PLAYER.GARAGE.1): an exterior building frame anchored on the surveyed Gamehouse entrance
// cell, one nested 8 m x 8 m arcade-floor room frame, and a deterministic enter/exit door portal pair
// that are exact inverses. This module renders nothing and decides nothing about where the Gamehouse
// sits — the runtime survey slice supplies the entrance cell. Entering the Gamehouse is a streaming
// boundary, never a coordinate or identity reset.
//
// The accepted ARCADE.0 boundary (2026-07-26 operator decision) authors an 8 m x 8 m room with a
// single reusable Commons_Arcade cabinet inside it; the cabinet placement lives in ./gamehouseCabinet
// and is appended by withGamehouseInterior so the whole venue is one deterministic fragment.
import type { GridCell, Vec3 } from "../worldSurvey";
import type {
  WorldLayoutDocumentInput,
  WorldLayoutFrame,
  WorldLayoutPlacement,
  WorldLayoutPortal,
} from "./worldLayoutDocument";
import { buildCommonsArcadeCabinetPlacement } from "./gamehouseCabinet";
// The id/dimension constants live in a dependency-free leaf so the cabinet can read them without
// importing this module — breaking the interior <-> cabinet cycle. Re-exported here so every existing
// `from "./gamehouseInterior"` import path is unchanged.
import {
  GAMEHOUSE_LOCAL_ID,
  GAMEHOUSE_FLOOR_LOCAL_ID,
  GAMEHOUSE_FLOOR_WIDTH_CELLS,
  GAMEHOUSE_FLOOR_DEPTH_CELLS,
  GAMEHOUSE_FLOOR_CELL_SIZE,
} from "./gamehouseDimensions";
export {
  GAMEHOUSE_LOCAL_ID,
  GAMEHOUSE_FLOOR_LOCAL_ID,
  GAMEHOUSE_FLOOR_WIDTH_CELLS,
  GAMEHOUSE_FLOOR_DEPTH_CELLS,
  GAMEHOUSE_FLOOR_CELL_SIZE,
};

/** Compass facing of the Gamehouse door; maps to a yaw about the surface Y axis. */
export type GamehouseFacing = "n" | "e" | "s" | "w";

const FACING_YAW: Record<GamehouseFacing, number> = {
  n: 0,
  e: Math.PI / 2,
  s: Math.PI,
  w: -Math.PI / 2,
};

export interface GamehouseInteriorOptions {
  /** Surface grid cell of the Gamehouse door — the surveyed commercial parcel's road-facing entrance.
   *  Defaults to the surface grid centre as a placeholder; the runtime wiring slice passes the
   *  surveyed cell. */
  readonly entranceCell?: GridCell;
  /** Direction the Gamehouse door faces on the surface. Defaults to north. */
  readonly facing?: GamehouseFacing;
}

export interface GamehouseInteriorFragment {
  readonly frames: readonly WorldLayoutFrame[];
  readonly portals: readonly WorldLayoutPortal[];
  /** The single public-safe Commons_Arcade cabinet, placed inside the arcade-floor bounds. */
  readonly placements: readonly WorldLayoutPlacement[];
  readonly buildingFrameId: string;
  readonly floorFrameId: string;
  readonly enterPortalId: string;
  readonly exitPortalId: string;
  readonly cabinetPlacementId: string;
  /** The surface-local door point both portals pin to. */
  readonly entrancePoint: Vec3;
  /** The floor-local door point both portals pin to — the safe entrance/exit landing. */
  readonly floorDoorPoint: Vec3;
}

export type GamehouseInteriorErrorCode =
  | "MISSING_SURFACE_FRAME"
  | "AMBIGUOUS_SURFACE_FRAME"
  | "SURFACE_FRAME_NOT_GRIDDED"
  | "ENTRANCE_OUT_OF_BOUNDS"
  | "ALREADY_PRESENT";

export class GamehouseInteriorError extends Error {
  constructor(
    readonly code: GamehouseInteriorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GamehouseInteriorError";
  }
}

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0 } as const;
const UNIT_SCALE = { x: 1, y: 1, z: 1 } as const;

/** Build the Gamehouse frame/portal/cabinet fragment for a specific surface frame. Pure and
 *  deterministic: the same surface frame and options always yield byte-identical output. The surface
 *  frame must carry a grid (the island); its own id, address, transform and grid are read but never
 *  modified. */
export function buildGamehouseInteriorFragment(
  surfaceFrame: WorldLayoutFrame,
  options: GamehouseInteriorOptions = {},
): GamehouseInteriorFragment {
  const grid = surfaceFrame.grid;
  if (!grid)
    throw new GamehouseInteriorError(
      "SURFACE_FRAME_NOT_GRIDDED",
      `surface frame ${surfaceFrame.id} has no grid to anchor the Gamehouse door to`,
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
    throw new GamehouseInteriorError(
      "ENTRANCE_OUT_OF_BOUNDS",
      `Gamehouse entrance cell (${entranceCell.x}, ${entranceCell.y}) is outside surface grid ${surfaceFrame.id}`,
    );

  const yaw = FACING_YAW[options.facing ?? "n"];

  // Surface-local door point (grid space, before the surface frame transform). Cell-centred so it
  // sits inside the island grid extent the document contract enforces.
  const entrancePoint: Vec3 = {
    x: grid.origin.x + (entranceCell.x + 0.5) * grid.cellSize,
    y: grid.origin.y,
    z: grid.origin.z + (entranceCell.y + 0.5) * grid.cellSize,
  };

  const buildingFrameId = `${surfaceFrame.id}:building:${GAMEHOUSE_LOCAL_ID}`;
  const buildingAddress = `${surfaceFrame.address}/building/${GAMEHOUSE_LOCAL_ID}`;
  const floorFrameId = `${buildingFrameId}:room:${GAMEHOUSE_FLOOR_LOCAL_ID}`;
  const floorAddress = `${buildingAddress}/room/${GAMEHOUSE_FLOOR_LOCAL_ID}`;

  // The building origin is the door; the arcade floor is centred on the door on X and opens forward
  // in +Z, so the floor-local door point maps exactly onto the building origin, which in turn maps
  // exactly onto the surface entrance point — for any facing yaw. This keeps the enter/exit portals
  // exact inverses and the landing a safe, in-bounds cell edge at the room's near wall.
  const floorHalfWidth =
    (GAMEHOUSE_FLOOR_WIDTH_CELLS * GAMEHOUSE_FLOOR_CELL_SIZE) / 2;
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
      width: GAMEHOUSE_FLOOR_WIDTH_CELLS,
      height: GAMEHOUSE_FLOOR_DEPTH_CELLS,
      cellSize: GAMEHOUSE_FLOOR_CELL_SIZE,
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

  const cabinet = buildCommonsArcadeCabinetPlacement(floorFrameId);

  return {
    frames: [buildingFrame, floorFrame],
    portals: [enterPortal, exitPortal],
    placements: [cabinet],
    buildingFrameId,
    floorFrameId,
    enterPortalId,
    exitPortalId,
    cabinetPlacementId: cabinet.id,
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
    throw new GamehouseInteriorError(
      "MISSING_SURFACE_FRAME",
      "document has no surface region frame to anchor the Gamehouse to",
    );
  if (surfaces.length > 1)
    throw new GamehouseInteriorError(
      "AMBIGUOUS_SURFACE_FRAME",
      `document has ${surfaces.length} surface region frames; specify the Gamehouse site explicitly`,
    );
  return surfaces[0]!;
}

/** Return a new document input with the Gamehouse building frame, arcade-floor room frame, enter/exit
 *  door portals and the Commons_Arcade cabinet placement appended. Every existing frame, portal,
 *  placement, road, way, zone, reservation, network and terrain edit is carried through untouched and
 *  in order, so no original island id or coordinate changes. Throws ALREADY_PRESENT rather than ever
 *  duplicating a frame, portal or placement. */
export function withGamehouseInterior(
  input: WorldLayoutDocumentInput,
  options: GamehouseInteriorOptions = {},
): WorldLayoutDocumentInput {
  const surfaceFrame = findSurfaceFrame(input.frames);
  const fragment = buildGamehouseInteriorFragment(surfaceFrame, options);

  const existingFrameIds = new Set(input.frames.map((frame) => frame.id));
  const existingPortalIds = new Set(input.portals.map((portal) => portal.id));
  const existingPlacementIds = new Set(
    input.placements.map((placement) => placement.id),
  );
  for (const frame of fragment.frames)
    if (existingFrameIds.has(frame.id))
      throw new GamehouseInteriorError(
        "ALREADY_PRESENT",
        `Gamehouse frame ${frame.id} is already present in the document`,
      );
  for (const portal of fragment.portals)
    if (existingPortalIds.has(portal.id))
      throw new GamehouseInteriorError(
        "ALREADY_PRESENT",
        `Gamehouse portal ${portal.id} is already present in the document`,
      );
  for (const placement of fragment.placements)
    if (existingPlacementIds.has(placement.id))
      throw new GamehouseInteriorError(
        "ALREADY_PRESENT",
        `Gamehouse placement ${placement.id} is already present in the document`,
      );

  return {
    ...input,
    frames: [...input.frames, ...fragment.frames],
    portals: [...input.portals, ...fragment.portals],
    placements: [...input.placements, ...fragment.placements],
  };
}
