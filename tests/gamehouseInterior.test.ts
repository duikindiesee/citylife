import { describe, expect, it } from "vitest";
import type { SpatialFrame, Vec3 } from "../src/colony/worldSurvey";
import {
  createWorldLayoutDocument,
  parseWorldLayoutDocument,
  serializeWorldLayoutDocument,
  type WorldLayoutDocumentInput,
  type WorldLayoutFrame,
} from "../src/colony/spatial/worldLayoutDocument";
import { resolvePointToAncestor } from "../src/colony/spatial/frameTransforms";
import {
  GamehouseInteriorError,
  buildGamehouseInteriorFragment,
  withGamehouseInterior,
  GAMEHOUSE_FLOOR_WIDTH_CELLS,
  GAMEHOUSE_FLOOR_DEPTH_CELLS,
} from "../src/colony/spatial/gamehouseInterior";
import { COMMONS_ARCADE_CABINET_DEFINITION_ID } from "../src/colony/spatial/gamehouseCabinet";

const ZERO = { x: 0, y: 0, z: 0 } as const;
const IDENTITY = {
  position: ZERO,
  rotation: ZERO,
  scale: { x: 1, y: 1, z: 1 },
} as const;

/** Minimal island: universe root plus a gridded surface region the Gamehouse anchors to. */
function islandInput(): WorldLayoutDocumentInput {
  return {
    worldId: "kooker-gamehouse-fixture",
    seed: 512,
    revision: { number: 0, parentHash: null },
    frames: [
      {
        id: "universe",
        address: "spatial://citylife",
        kind: "universe",
        layer: "deep-space",
        transform: IDENTITY,
      },
      {
        id: "surface",
        address: "spatial://citylife/world/kooker-gamehouse-fixture/surface",
        kind: "region",
        layer: "surface",
        parentId: "universe",
        transform: {
          position: { x: 4, y: 0, z: -8 },
          rotation: ZERO,
          scale: { x: 1, y: 1, z: 1 },
        },
        grid: {
          width: 16,
          height: 16,
          cellSize: 4,
          origin: { x: -32, y: 0, z: -32 },
        },
      },
    ],
    placements: [],
    roads: [],
    ways: [],
    terrainEdits: [],
    portals: [],
  };
}

function surfaceFrameFrom(input: WorldLayoutDocumentInput): WorldLayoutFrame {
  const surface = input.frames.find((frame) => frame.id === "surface");
  if (!surface) throw new Error("fixture surface frame missing");
  return surface;
}

function frameMap(
  frames: readonly WorldLayoutFrame[],
): Map<string, SpatialFrame> {
  return new Map(frames.map((frame) => [frame.id, frame as SpatialFrame]));
}

function expectVecClose(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
}

describe("Kooker Gamehouse interior fragment (ARCADE.1)", () => {
  it("authors one building frame, an 8x8 arcade floor, enter/exit portals and one cabinet", () => {
    const surface = surfaceFrameFrom(islandInput());
    const fragment = buildGamehouseInteriorFragment(surface, {
      entranceCell: { x: 6, y: 9 },
      facing: "s",
    });

    expect(fragment.frames).toHaveLength(2);
    expect(fragment.portals).toHaveLength(2);
    expect(fragment.placements).toHaveLength(1);

    const [building, floor] = fragment.frames;
    expect(building).toMatchObject({
      id: "surface:building:kooker-gamehouse",
      address:
        "spatial://citylife/world/kooker-gamehouse-fixture/surface/building/kooker-gamehouse",
      kind: "building",
      layer: "surface",
      parentId: "surface",
    });
    expect(building.grid).toBeUndefined();
    expect(floor).toMatchObject({
      id: "surface:building:kooker-gamehouse:room:gamehouse-floor",
      kind: "room",
      layer: "interior",
      parentId: "surface:building:kooker-gamehouse",
    });
    // The accepted 8 m x 8 m room.
    expect(GAMEHOUSE_FLOOR_WIDTH_CELLS).toBe(8);
    expect(GAMEHOUSE_FLOOR_DEPTH_CELLS).toBe(8);
    expect(floor.grid).toMatchObject({
      width: GAMEHOUSE_FLOOR_WIDTH_CELLS,
      height: GAMEHOUSE_FLOOR_DEPTH_CELLS,
    });

    // The single public-safe Commons_Arcade cabinet sits on the arcade floor, in bounds, tight.
    const cabinet = fragment.placements[0]!;
    expect(cabinet.definitionId).toBe(COMMONS_ARCADE_CABINET_DEFINITION_ID);
    expect(cabinet.frameId).toBe(fragment.floorFrameId);
    expect(cabinet.layer).toBe("interior");
    expect(cabinet.cells).toHaveLength(1);
    const [cell] = cabinet.cells;
    expect(cell!.x).toBeGreaterThanOrEqual(0);
    expect(cell!.y).toBeGreaterThanOrEqual(0);
    expect(cell!.x).toBeLessThan(GAMEHOUSE_FLOOR_WIDTH_CELLS);
    expect(cell!.y).toBeLessThan(GAMEHOUSE_FLOOR_DEPTH_CELLS);
    expect(cabinet.bounds).toEqual({ x: cell!.x, y: cell!.y, w: 1, h: 1 });
  });

  it("makes the exit portal the exact inverse of the enter portal", () => {
    const surface = surfaceFrameFrom(islandInput());
    const fragment = buildGamehouseInteriorFragment(surface, {
      entranceCell: { x: 3, y: 12 },
      facing: "e",
    });
    const [enter, exit] = fragment.portals;
    expect(enter).toMatchObject({
      fromFrameId: "surface",
      toFrameId: fragment.floorFrameId,
      modes: ["walk", "portal"],
    });
    expect(exit).toMatchObject({
      fromFrameId: fragment.floorFrameId,
      toFrameId: "surface",
      modes: ["walk", "portal"],
    });
    expect(exit.from).toEqual(enter.to);
    expect(exit.to).toEqual(enter.from);

    // The two door points resolve to the SAME world point through the frame graph for a rotated
    // facing: walking in and stepping back out lands exactly where you entered (safe entrance/exit).
    const augmented = withGamehouseInterior(islandInput(), {
      entranceCell: { x: 3, y: 12 },
      facing: "e",
    });
    const frames = frameMap(augmented.frames);
    const surfaceDoorWorld = resolvePointToAncestor(
      enter.from,
      "surface",
      "universe",
      frames,
    );
    const floorDoorWorld = resolvePointToAncestor(
      enter.to,
      fragment.floorFrameId,
      "universe",
      frames,
    );
    expectVecClose(floorDoorWorld, surfaceDoorWorld);
  });

  it("is deterministic for a given surface frame and options", () => {
    const surface = surfaceFrameFrom(islandInput());
    expect(
      buildGamehouseInteriorFragment(surface, {
        entranceCell: { x: 4, y: 7 },
        facing: "w",
      }),
    ).toEqual(
      buildGamehouseInteriorFragment(surface, {
        entranceCell: { x: 4, y: 7 },
        facing: "w",
      }),
    );
  });

  it("produces a document that validates and survives a serialize/parse replay", () => {
    const augmented = withGamehouseInterior(islandInput());
    const document = createWorldLayoutDocument(augmented);

    expect(document.frames).toHaveLength(4);
    expect(document.portals).toHaveLength(2);
    expect(document.placements).toHaveLength(1);
    expect(document.revision.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const replayed = parseWorldLayoutDocument(
      serializeWorldLayoutDocument(document),
    );
    expect(replayed.frames).toEqual(document.frames);
    expect(replayed.portals).toEqual(document.portals);
    expect(replayed.placements).toEqual(document.placements);
  });

  it("preserves existing frames/portals/placements untouched and in order", () => {
    const before = islandInput();
    const after = withGamehouseInterior(before);
    // Every original frame is carried through unchanged and first.
    expect(after.frames.slice(0, before.frames.length)).toEqual(before.frames);
    expect(after.portals.slice(0, before.portals.length)).toEqual(
      before.portals,
    );
    expect(after.placements.slice(0, before.placements.length)).toEqual(
      before.placements,
    );
  });

  it("rejects an out-of-bounds entrance and a duplicate application", () => {
    const surface = surfaceFrameFrom(islandInput());
    expect(() =>
      buildGamehouseInteriorFragment(surface, {
        entranceCell: { x: 99, y: 0 },
      }),
    ).toThrowError(GamehouseInteriorError);

    const once = withGamehouseInterior(islandInput());
    expect(() => withGamehouseInterior(once)).toThrowError(/already present/);
  });
});
