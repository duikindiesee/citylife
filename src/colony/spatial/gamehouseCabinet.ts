// ARCADE.1 — the public-safe Commons_Arcade cabinet inside the Kooker Gamehouse arcade floor, plus
// the authenticated-player interaction gate. Pure and framework-agnostic (no three.js / React / DOM /
// fetch) so it runs in node tests exactly like the rest of the spatial layer.
//
// Two accepted facts from the 2026-07-26 operator decision drive this module:
//   * `Commons_Arcade` is a reusable prop at 0.7 m x 1.8 m x 0.8 m with a floor-centre pivot, placed
//     inside the 8 m x 8 m room bounds (subject to placement tests).
//   * A procedural box is an acceptable fail-safe visual fallback, and no `hq-commons-pack.glb` asset
//     ships in this slice — so the procedural box IS the visual here.
//
// The interaction gate implements the ARCADE.0 contract: cabinet interaction requires an
// authenticated CityLife player whose identity is derived only from a validated CityLife JWT (its
// userId claim). This module authorizes nothing itself and stores no score — it only decides whether
// the interaction prompt is offered and what it reads.
import type { GridCell, Vec3 } from "../worldSurvey";
import type { WorldLayoutPlacement } from "./worldLayoutDocument";
import {
  GAMEHOUSE_FLOOR_CELL_SIZE,
  GAMEHOUSE_FLOOR_DEPTH_CELLS,
  GAMEHOUSE_FLOOR_WIDTH_CELLS,
} from "./gamehouseInterior";

/** Canonical Commons_Arcade cabinet dimensions in metres (floor-centre pivot). */
export const COMMONS_ARCADE_CABINET_DIMENSIONS = {
  width: 0.7,
  height: 1.8,
  depth: 0.8,
  pivot: "floor-centre",
} as const;

/** Public-safe placement definition id for the cabinet prop (no kooker/token/secret brand-words). */
export const COMMONS_ARCADE_CABINET_DEFINITION_ID =
  "prop:commons-arcade-cabinet" as const;

/** Optional shipped mesh; absent in this slice, so the procedural fallback is used. */
export const COMMONS_ARCADE_CABINET_ASSET_URL =
  "/assets/citylife/props/commons-arcade-cabinet.glb" as const;

/** Interior grid cell the cabinet stands on: back-centre of the 8 x 8 floor, clear of the near-wall
 *  door landing and with the back row left as wall clearance. Kept as a single 1 m cell — the
 *  0.7 m x 0.8 m footprint sits comfortably inside one cell. */
export const COMMONS_ARCADE_CABINET_CELL: GridCell = { x: 4, y: 6 } as const;

/** Floor-local point a player stands on to use the cabinet: one cell in front (toward the door), so
 *  the approach never overlaps the cabinet cell, the back wall, or the entrance landing. */
export const COMMONS_ARCADE_CABINET_APPROACH_POINT: Vec3 = {
  x: (COMMONS_ARCADE_CABINET_CELL.x + 0.5) * GAMEHOUSE_FLOOR_CELL_SIZE,
  y: 0,
  z: (COMMONS_ARCADE_CABINET_CELL.y - 0.5) * GAMEHOUSE_FLOOR_CELL_SIZE,
} as const;

/** Vertical envelope of the standing cabinet: floor to 1.8 m, no extra clearance reserved. */
const CABINET_VERTICAL = {
  min: 0,
  max: COMMONS_ARCADE_CABINET_DIMENSIONS.height,
  clearanceBelow: 0,
  clearanceAbove: 0,
} as const;

/** Build the single Commons_Arcade cabinet placement for a given arcade-floor room frame. Pure and
 *  deterministic. The returned placement satisfies the WorldLayoutDocument contract: tight bounds,
 *  in-bounds cell, and an anchor that belongs to the placement cells. */
export function buildCommonsArcadeCabinetPlacement(
  floorFrameId: string,
): WorldLayoutPlacement {
  const cell: GridCell = { ...COMMONS_ARCADE_CABINET_CELL };
  return {
    id: `${floorFrameId}:placement:commons-arcade`,
    definitionId: COMMONS_ARCADE_CABINET_DEFINITION_ID,
    frameId: floorFrameId,
    layer: "interior",
    source: "seed",
    cells: [cell],
    bounds: { x: cell.x, y: cell.y, w: 1, h: 1 },
    vertical: { ...CABINET_VERTICAL },
    anchors: [{ id: "pivot", cell: { ...cell } }],
    orientation: "s",
  };
}

/** True iff the cabinet cell and its approach point both sit inside the 8 x 8 arcade floor. Exposed so
 *  the placement test can assert the cabinet stays within the authored room bounds. */
export function isCommonsArcadeCabinetInBounds(): boolean {
  const { x, y } = COMMONS_ARCADE_CABINET_CELL;
  const cellInBounds =
    x >= 0 &&
    y >= 0 &&
    x < GAMEHOUSE_FLOOR_WIDTH_CELLS &&
    y < GAMEHOUSE_FLOOR_DEPTH_CELLS;
  const width = GAMEHOUSE_FLOOR_WIDTH_CELLS * GAMEHOUSE_FLOOR_CELL_SIZE;
  const depth = GAMEHOUSE_FLOOR_DEPTH_CELLS * GAMEHOUSE_FLOOR_CELL_SIZE;
  const a = COMMONS_ARCADE_CABINET_APPROACH_POINT;
  const approachInBounds = a.x >= 0 && a.x <= width && a.z >= 0 && a.z <= depth;
  return cellInBounds && approachInBounds;
}

/** The cabinet's on-screen form. When the mesh is unavailable (this slice ships none), callers render
 *  the procedural box at the canonical cabinet dimensions — the accepted fail-safe fallback. */
export type CommonsArcadeCabinetVisual =
  | { readonly kind: "glb"; readonly url: string }
  | {
      readonly kind: "procedural-box";
      readonly size: {
        readonly width: number;
        readonly height: number;
        readonly depth: number;
      };
    };

/** Resolve the cabinet visual. Defaults to the procedural box because no cabinet mesh ships in this
 *  slice; pass assetAvailable=true once a public-safe mesh is added to prefer the glb. */
export function resolveCommonsArcadeCabinetVisual(
  assetAvailable = false,
): CommonsArcadeCabinetVisual {
  if (assetAvailable)
    return { kind: "glb", url: COMMONS_ARCADE_CABINET_ASSET_URL };
  return {
    kind: "procedural-box",
    size: {
      width: COMMONS_ARCADE_CABINET_DIMENSIONS.width,
      height: COMMONS_ARCADE_CABINET_DIMENSIONS.height,
      depth: COMMONS_ARCADE_CABINET_DIMENSIONS.depth,
    },
  };
}

// ---------------------------------------------------------------------------
// Authenticated-player interaction gate (ARCADE.0 contract)
// ---------------------------------------------------------------------------

/** The minimal player identity the gate reads. Structurally compatible with the authenticated
 *  `OperatorSession["operator"]` (authClient.ts): `userId` is the stable id decoded from a validated
 *  CityLife JWT and is the ONLY thing identity is derived from. A null session or null userId is an
 *  unauthenticated visitor. */
export interface GamehousePlayerSession {
  readonly userId: string | null;
  readonly roles?: readonly string[];
}

/** Prompt shown to an authenticated player standing at the cabinet. */
export const CABINET_PLAY_PROMPT = "Press E — Play the arcade cabinet" as const;
/** Prompt shown to an unauthenticated visitor: the interaction is offered but gated. */
export const CABINET_SIGN_IN_PROMPT =
  "Sign in to play the arcade cabinet" as const;

export interface CabinetInteraction {
  /** Whether cabinet interaction is authorized for this session. */
  readonly allowed: boolean;
  /** The clear, player-facing interaction prompt to display. */
  readonly prompt: string;
  /** Why interaction is / isn't allowed, for callers that branch on it. */
  readonly reason: "ok" | "unauthenticated";
}

/** True iff the session is an authenticated CityLife player — a non-empty JWT-derived userId. */
export function isAuthenticatedCityLifePlayer(
  session: GamehousePlayerSession | null | undefined,
): boolean {
  return (
    session != null &&
    typeof session.userId === "string" &&
    session.userId.length > 0
  );
}

/** Decide the cabinet interaction for a session. Deterministic and side-effect free: authenticated
 *  players get the play prompt; everyone else gets the sign-in prompt and is not allowed to play. */
export function resolveCabinetInteraction(
  session: GamehousePlayerSession | null | undefined,
): CabinetInteraction {
  if (isAuthenticatedCityLifePlayer(session))
    return { allowed: true, prompt: CABINET_PLAY_PROMPT, reason: "ok" };
  return {
    allowed: false,
    prompt: CABINET_SIGN_IN_PROMPT,
    reason: "unauthenticated",
  };
}
