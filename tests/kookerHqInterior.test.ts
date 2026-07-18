import { describe, expect, it } from "vitest";
import type { SpatialFrame, Vec3 } from "../src/colony/worldSurvey";
import {
  createWorldLayoutDocument,
  parseWorldLayoutDocument,
  serializeWorldLayoutDocument,
  type WorldLayoutDocumentInput,
  type WorldLayoutFrame,
} from "../src/colony/spatial/worldLayoutDocument";
import {
  resolvePointToAncestor,
  resolvePointToRoot,
} from "../src/colony/spatial/frameTransforms";
import {
  KookerHqInteriorError,
  buildKookerHqInteriorFragment,
  withKookerHqInterior,
  KOOKER_HQ_RECEPTION_WIDTH_CELLS,
  KOOKER_HQ_RECEPTION_DEPTH_CELLS,
} from "../src/colony/spatial/kookerHqInterior";

const ZERO = { x: 0, y: 0, z: 0 } as const;
const IDENTITY = {
  position: ZERO,
  rotation: ZERO,
  scale: { x: 1, y: 1, z: 1 },
} as const;

/** A small but representative island: universe root, a gridded surface region, one placement, one
 *  road and one way. The HQ fragment must leave every one of these untouched. */
function islandInput(): WorldLayoutDocumentInput {
  return {
    worldId: "kooker-hq-fixture",
    seed: 4242,
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
        address: "spatial://citylife/world/kooker-hq-fixture/surface",
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
    placements: [
      {
        id: "placement:seed-home",
        definitionId: "zoned-plot:residential:compact",
        frameId: "surface",
        layer: "surface",
        source: "seed",
        cells: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 2, y: 3 },
          { x: 3, y: 3 },
        ],
        bounds: { x: 2, y: 2, w: 2, h: 2 },
        vertical: { min: 0, max: 10, clearanceBelow: 0, clearanceAbove: 0 },
        anchors: [{ id: "entrance", cell: { x: 2, y: 3 } }],
      },
    ],
    roads: [
      {
        id: "road:surface:street",
        frameId: "surface",
        layer: "surface",
        kind: "street",
        cells: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
        ],
        vertical: { min: 0, max: 0, clearanceBelow: 0, clearanceAbove: 1 },
      },
    ],
    ways: [
      {
        id: "way:surface:0",
        frameId: "surface",
        layer: "surface",
        kind: "street",
        width: 4,
        cells: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
        ],
        roadIds: ["road:surface:street"],
      },
    ],
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

describe("Kooker HQ interior fragment (WB.1e-a)", () => {
  it("authors exactly the HQ building frame, one reception room and enter/exit portals", () => {
    const surface = surfaceFrameFrom(islandInput());
    const fragment = buildKookerHqInteriorFragment(surface);

    expect(fragment.frames).toHaveLength(2);
    expect(fragment.portals).toHaveLength(2);

    const [building, reception] = fragment.frames;
    expect(building).toMatchObject({
      id: "surface:building:kooker-hq",
      address:
        "spatial://citylife/world/kooker-hq-fixture/surface/building/kooker-hq",
      kind: "building",
      layer: "surface",
      parentId: "surface",
    });
    expect(building.grid).toBeUndefined();
    expect(reception).toMatchObject({
      id: "surface:building:kooker-hq:room:reception",
      kind: "room",
      layer: "interior",
      parentId: "surface:building:kooker-hq",
    });
    expect(reception.grid).toMatchObject({
      width: KOOKER_HQ_RECEPTION_WIDTH_CELLS,
      height: KOOKER_HQ_RECEPTION_DEPTH_CELLS,
    });

    const [enter, exit] = fragment.portals;
    expect(enter).toMatchObject({
      fromFrameId: "surface",
      toFrameId: reception.id,
      modes: ["walk", "portal"],
    });
    expect(exit).toMatchObject({
      fromFrameId: reception.id,
      toFrameId: "surface",
    });
    // The exit is the exact inverse of the enter: same two points, reversed.
    expect(exit.from).toEqual(enter.to);
    expect(exit.to).toEqual(enter.from);
  });

  it("is deterministic for a given surface frame and options", () => {
    const surface = surfaceFrameFrom(islandInput());
    expect(
      buildKookerHqInteriorFragment(surface, {
        entranceCell: { x: 4, y: 7 },
        facing: "e",
      }),
    ).toEqual(
      buildKookerHqInteriorFragment(surface, {
        entranceCell: { x: 4, y: 7 },
        facing: "e",
      }),
    );
  });

  it("produces a document that validates and survives a serialize/parse replay", () => {
    const augmented = withKookerHqInterior(islandInput());
    const document = createWorldLayoutDocument(augmented);

    expect(document.frames).toHaveLength(4);
    expect(document.portals).toHaveLength(2);
    expect(document.revision.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const replayed = parseWorldLayoutDocument(
      serializeWorldLayoutDocument(document),
    );
    expect(replayed).toEqual(document);
    expect(replayed.revision.contentHash).toBe(document.revision.contentHash);
  });

  it("is deterministic at the document content-hash level", () => {
    const a = createWorldLayoutDocument(withKookerHqInterior(islandInput()));
    const b = createWorldLayoutDocument(withKookerHqInterior(islandInput()));
    expect(a.revision.contentHash).toBe(b.revision.contentHash);
  });

  it("leaves every original island id and coordinate unchanged", () => {
    const base = islandInput();
    const augmented = withKookerHqInterior(base);

    // Untouched runtime slices are carried through by identity, not rebuilt.
    expect(augmented.placements).toBe(base.placements);
    expect(augmented.roads).toBe(base.roads);
    expect(augmented.ways).toBe(base.ways);
    expect(augmented.terrainEdits).toBe(base.terrainEdits);
    // Existing frames/portals are a byte-identical prefix; the HQ is only appended.
    expect(augmented.frames.slice(0, base.frames.length)).toEqual(base.frames);
    expect(augmented.frames).toHaveLength(base.frames.length + 2);

    // After the codec runs, each island frame keeps its exact id, address and transform.
    const baseDoc = createWorldLayoutDocument(base);
    const augDoc = createWorldLayoutDocument(augmented);
    const augById = new Map(augDoc.frames.map((frame) => [frame.id, frame]));
    for (const frame of baseDoc.frames)
      expect(augById.get(frame.id)).toEqual(frame);
    expect(baseDoc.placements).toEqual(augDoc.placements);
    expect(baseDoc.roads).toEqual(augDoc.roads);
    expect(baseDoc.ways).toEqual(augDoc.ways);
  });

  it("resolves the reception door back onto the surface entrance through invertible transforms", () => {
    for (const facing of ["n", "e", "s", "w"] as const) {
      const augmented = withKookerHqInterior(islandInput(), { facing });
      const fragment = buildKookerHqInteriorFragment(
        surfaceFrameFrom(islandInput()),
        { facing },
      );
      const frames = frameMap(augmented.frames);

      // The interior door point, resolved up into surface-local coordinates, lands exactly on the
      // surface entrance the portal pins to — a streaming boundary, not a coordinate reset.
      const resolved = resolvePointToAncestor(
        fragment.receptionDoorPoint,
        fragment.receptionFrameId,
        "surface",
        frames,
      );
      expectVecClose(resolved, fragment.entrancePoint);

      // And it resolves all the way to the immutable universe root without error.
      const toRoot = resolvePointToRoot(
        fragment.receptionDoorPoint,
        fragment.receptionFrameId,
        frames,
      );
      expect(toRoot.rootFrameId).toBe("universe");
    }
  });

  it("keeps a single-root frame tree with the reception nested under the building", () => {
    const augmented = withKookerHqInterior(islandInput());
    const roots = augmented.frames.filter((frame) => !frame.parentId);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.id).toBe("universe");

    const byId = new Map(augmented.frames.map((frame) => [frame.id, frame]));
    const reception = byId.get("surface:building:kooker-hq:room:reception")!;
    const building = byId.get(reception.parentId!)!;
    expect(building.id).toBe("surface:building:kooker-hq");
    expect(building.parentId).toBe("surface");
  });

  it("refuses to author the HQ twice, preventing duplicate or ghost frames", () => {
    const once = withKookerHqInterior(islandInput());
    expect(() => withKookerHqInterior(once)).toThrowError(
      KookerHqInteriorError,
    );
    try {
      withKookerHqInterior(once);
    } catch (error) {
      expect((error as KookerHqInteriorError).code).toBe("ALREADY_PRESENT");
    }
  });

  it("reports missing, ambiguous and non-gridded surface frames and out-of-bounds entrances", () => {
    const codeOf = (action: () => unknown): string | undefined => {
      try {
        action();
        return undefined;
      } catch (error) {
        expect(error).toBeInstanceOf(KookerHqInteriorError);
        return (error as KookerHqInteriorError).code;
      }
    };

    const noSurface = islandInput();
    expect(
      codeOf(() =>
        withKookerHqInterior({
          ...noSurface,
          frames: noSurface.frames.filter((frame) => frame.id !== "surface"),
        }),
      ),
    ).toBe("MISSING_SURFACE_FRAME");

    const twoSurfaces = islandInput();
    expect(
      codeOf(() =>
        withKookerHqInterior({
          ...twoSurfaces,
          frames: [
            ...twoSurfaces.frames,
            {
              ...surfaceFrameFrom(twoSurfaces),
              id: "surface-two",
              address: "spatial://citylife/world/kooker-hq-fixture/surface-two",
            },
          ],
        }),
      ),
    ).toBe("AMBIGUOUS_SURFACE_FRAME");

    const ungridded: WorldLayoutFrame = {
      id: "surface",
      address: "spatial://citylife/world/x/surface",
      kind: "region",
      layer: "surface",
      parentId: "universe",
      transform: IDENTITY,
    };
    expect(codeOf(() => buildKookerHqInteriorFragment(ungridded))).toBe(
      "SURFACE_FRAME_NOT_GRIDDED",
    );

    expect(
      codeOf(() =>
        buildKookerHqInteriorFragment(surfaceFrameFrom(islandInput()), {
          entranceCell: { x: 99, y: 0 },
        }),
      ),
    ).toBe("ENTRANCE_OUT_OF_BOUNDS");
  });
});
