// ARCADE.2A — the leaf module of Gamehouse id/dimension constants. It has NO spatial-layer imports so it
// can be evaluated first, which breaks the gamehouseInterior <-> gamehouseCabinet import cycle: the
// cabinet reads these dimensions from here (never from gamehouseInterior), so a cabinet top-level const
// can never touch an interior binding that is still in its temporal dead zone. gamehouseInterior
// re-exports these names, so every existing `from "./gamehouseInterior"` import keeps working unchanged.

/** Human-readable final id/address segment for the Gamehouse building frame. */
export const GAMEHOUSE_LOCAL_ID = "kooker-gamehouse" as const;
/** Human-readable final id/address segment for the nested arcade-floor room frame. */
export const GAMEHOUSE_FLOOR_LOCAL_ID = "gamehouse-floor" as const;

/** Arcade floor: the accepted 8 m x 8 m room on a 1 m interior grid (kept numerically small). */
export const GAMEHOUSE_FLOOR_WIDTH_CELLS = 8 as const;
export const GAMEHOUSE_FLOOR_DEPTH_CELLS = 8 as const;
export const GAMEHOUSE_FLOOR_CELL_SIZE = 1 as const;
