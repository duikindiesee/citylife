import { describe, expect, it } from "vitest";
import {
  buildCommonsArcadeCabinetPlacement,
  isCommonsArcadeCabinetInBounds,
  resolveCommonsArcadeCabinetVisual,
  resolveCabinetInteraction,
  isAuthenticatedCityLifePlayer,
  COMMONS_ARCADE_CABINET_DIMENSIONS,
  COMMONS_ARCADE_CABINET_DEFINITION_ID,
  COMMONS_ARCADE_CABINET_ASSET_URL,
  CABINET_PLAY_PROMPT,
  CABINET_SIGN_IN_PROMPT,
} from "../src/colony/spatial/gamehouseCabinet";

const FLOOR_FRAME_ID =
  "surface:building:kooker-gamehouse:room:gamehouse-floor";

describe("Commons_Arcade cabinet placement (ARCADE.1)", () => {
  it("uses the accepted 0.7 x 1.8 x 0.8 m dimensions with a floor-centre pivot", () => {
    expect(COMMONS_ARCADE_CABINET_DIMENSIONS.width).toBe(0.7);
    expect(COMMONS_ARCADE_CABINET_DIMENSIONS.height).toBe(1.8);
    expect(COMMONS_ARCADE_CABINET_DIMENSIONS.depth).toBe(0.8);
    expect(COMMONS_ARCADE_CABINET_DIMENSIONS.pivot).toBe("floor-centre");
  });

  it("builds a deterministic, in-bounds, contract-valid placement on the floor frame", () => {
    const a = buildCommonsArcadeCabinetPlacement(FLOOR_FRAME_ID);
    const b = buildCommonsArcadeCabinetPlacement(FLOOR_FRAME_ID);
    expect(a).toEqual(b);

    expect(a.definitionId).toBe(COMMONS_ARCADE_CABINET_DEFINITION_ID);
    expect(a.frameId).toBe(FLOOR_FRAME_ID);
    expect(a.layer).toBe("interior");
    expect(a.source).toBe("seed");

    // Tight bounds exactly cover the single occupied cell (WorldLayoutDocument contract).
    expect(a.cells).toHaveLength(1);
    const cell = a.cells[0]!;
    expect(a.bounds).toEqual({ x: cell.x, y: cell.y, w: 1, h: 1 });

    // Every anchor belongs to the placement cells.
    for (const anchor of a.anchors)
      expect(a.cells).toContainEqual(anchor.cell);

    // The cabinet cell and its approach point stay inside the 8 x 8 room.
    expect(isCommonsArcadeCabinetInBounds()).toBe(true);
  });

  it("keeps the placement id and definition id public-safe (no brand-words)", () => {
    const a = buildCommonsArcadeCabinetPlacement(FLOOR_FRAME_ID);
    expect(/token|secret/i.test(a.definitionId)).toBe(false);
    expect(/token|secret/i.test(a.id)).toBe(false);
  });

  it("resolves a procedural box fallback by default and the glb when available", () => {
    const fallback = resolveCommonsArcadeCabinetVisual();
    expect(fallback.kind).toBe("procedural-box");
    if (fallback.kind === "procedural-box") {
      expect(fallback.size).toEqual({ width: 0.7, height: 1.8, depth: 0.8 });
    }

    const withAsset = resolveCommonsArcadeCabinetVisual(true);
    expect(withAsset.kind).toBe("glb");
    if (withAsset.kind === "glb")
      expect(withAsset.url).toBe(COMMONS_ARCADE_CABINET_ASSET_URL);
  });
});

describe("Gamehouse cabinet interaction gate (ARCADE.0 auth contract)", () => {
  it("treats a JWT-derived userId as an authenticated CityLife player", () => {
    expect(
      isAuthenticatedCityLifePlayer({ userId: "user-123", roles: [] }),
    ).toBe(true);
    expect(isAuthenticatedCityLifePlayer({ userId: null })).toBe(false);
    expect(isAuthenticatedCityLifePlayer({ userId: "" })).toBe(false);
    expect(isAuthenticatedCityLifePlayer(null)).toBe(false);
    expect(isAuthenticatedCityLifePlayer(undefined)).toBe(false);
  });

  it("offers the play prompt to an authenticated player", () => {
    const result = resolveCabinetInteraction({
      userId: "user-abc",
      roles: ["CITYLIFE_PLAYER"],
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("ok");
    expect(result.prompt).toBe(CABINET_PLAY_PROMPT);
  });

  it("gates unauthenticated visitors with a clear sign-in prompt", () => {
    for (const session of [null, undefined, { userId: null }] as const) {
      const result = resolveCabinetInteraction(session);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("unauthenticated");
      expect(result.prompt).toBe(CABINET_SIGN_IN_PROMPT);
    }
  });

  it("never leaks a brand-word in either interaction prompt", () => {
    for (const prompt of [CABINET_PLAY_PROMPT, CABINET_SIGN_IN_PROMPT])
      expect(/kooker|token|secret/i.test(prompt)).toBe(false);
  });
});
