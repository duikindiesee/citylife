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
  GarageShowroomInteriorError,
  buildGarageShowroomInteriorFragment,
  withGarageShowroomInterior,
  GARAGE_SHOWROOM_WIDTH_CELLS,
  GARAGE_SHOWROOM_DEPTH_CELLS,
} from "../src/colony/spatial/garageShowroomInterior";

const ZERO = { x: 0, y: 0, z: 0 } as const;
const IDENTITY = {
  position: ZERO,
  rotation: ZERO,
  scale: { x: 1, y: 1, z: 1 },
} as const;

/** Minimal island: universe root plus a gridded surface region the showroom anchors to. */
function islandInput(): WorldLayoutDocumentInput {
  return {
    worldId: "gearbox-showroom-fixture",
    seed: 360,
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
        address: "spatial://citylife/world/gearbox-showroom-fixture/surface",
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

describe("Gearbox showroom interior fragment (PLAYER.GARAGE.1)", () => {
  it("authors exactly one building frame, one showroom floor and enter/exit portals", () => {
    const surface = surfaceFrameFrom(islandInput());
    const fragment = buildGarageShowroomInteriorFragment(surface, {
      entranceCell: { x: 6, y: 9 },
      facing: "s",
    });

    expect(fragment.frames).toHaveLength(2);
    expect(fragment.portals).toHaveLength(2);

    const [building, floor] = fragment.frames;
    expect(building).toMatchObject({
      id: "surface:building:gearbox-showroom",
      address:
        "spatial://citylife/world/gearbox-showroom-fixture/surface/building/gearbox-showroom",
      kind: "building",
      layer: "surface",
      parentId: "surface",
    });
    expect(building.grid).toBeUndefined();
    expect(floor).toMatchObject({
      id: "surface:building:gearbox-showroom:room:showroom-floor",
      kind: "room",
      layer: "interior",
      parentId: "surface:building:gearbox-showroom",
    });
    expect(floor.grid).toMatchObject({
      width: GARAGE_SHOWROOM_WIDTH_CELLS,
      height: GARAGE_SHOWROOM_DEPTH_CELLS,
    });
  });

  it("makes the exit portal the exact inverse of the enter portal", () => {
    const surface = surfaceFrameFrom(islandInput());
    const fragment = buildGarageShowroomInteriorFragment(surface, {
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

    // And the two door points resolve to the SAME world point through the frame graph, for a
    // rotated facing: walking in and stepping back out lands exactly where you entered.
    const augmented = withGarageShowroomInterior(islandInput(), {
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
      buildGarageShowroomInteriorFragment(surface, {
        entranceCell: { x: 4, y: 7 },
        facing: "w",
      }),
    ).toEqual(
      buildGarageShowroomInteriorFragment(surface, {
        entranceCell: { x: 4, y: 7 },
        facing: "w",
      }),
    );
  });

  it("produces a document that validates and survives a serialize/parse replay", () => {
    const augmented = withGarageShowroomInterior(islandInput());
    const document = createWorldLayoutDocument(augmented);

    expect(document.frames).toHaveLength(4);
    expect(document.portals).toHaveLength(2);
    expect(document.revision.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const replayed = parseWorldLayoutDocument(
      serializeWorldLayoutDocument(document),
    );
    expect(replayed.frames).toEqual(document.frames);
    expect(replayed.portals).toEqual(document.portals);
  });

  it("rejects an out-of-bounds entrance and a duplicate application", () => {
    const surface = surfaceFrameFrom(islandInput());
    expect(() =>
      buildGarageShowroomInteriorFragment(surface, {
        entranceCell: { x: 99, y: 0 },
      }),
    ).toThrowError(GarageShowroomInteriorError);

    const once = withGarageShowroomInterior(islandInput());
    expect(() => withGarageShowroomInterior(once)).toThrowError(
      /already present/,
    );
  });
});
