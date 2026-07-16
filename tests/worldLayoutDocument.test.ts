// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { createHash } from "node:crypto";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WORLD_LAYOUT_SCHEMA_VERSION,
  WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION,
  WORLD_LAYOUT_V0_SCHEMA_VERSION,
  LEGACY_WORLD_LAYOUT_PROVENANCE,
  WorldLayoutDocumentError,
  canonicalizeWorldLayoutDocument,
  computeWorldLayoutContentHash,
  createWorldLayoutDocument,
  migrateWorldLayoutDocument,
  parseWorldLayoutDocument,
  serializeWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
  type WorldLayoutDocumentInput,
} from "../src/colony/spatial/worldLayoutDocument";

const ZERO = { x: 0, y: 0, z: 0 } as const;
const IDENTITY = {
  position: ZERO,
  rotation: ZERO,
  scale: { x: 1, y: 1, z: 1 },
} as const;
const VERTICAL = {
  min: 0,
  max: 1,
  clearanceBelow: 0,
  clearanceAbove: 1,
} as const;

function input(): WorldLayoutDocumentInput {
  return {
    worldId: "colony-primary",
    seed: 4242,
    revision: { number: 1, parentHash: null },
    // Deliberately scrambled: canonical creation must not depend on collection/set order.
    frames: [
      {
        id: "surface:room:hq-reception",
        address: "spatial://citylife/world/colony-primary/surface/hq/reception",
        kind: "room",
        layer: "interior",
        parentId: "surface:building:hq",
        transform: IDENTITY,
        grid: {
          width: 12,
          height: 8,
          cellSize: 1,
          origin: ZERO,
        },
      },
      {
        id: "surface:building:hq",
        address: "spatial://citylife/world/colony-primary/surface/hq",
        kind: "building",
        layer: "interior",
        parentId: "surface",
        transform: {
          ...IDENTITY,
          position: { x: 24, y: 2, z: 16 },
        },
      },
      {
        id: "surface",
        address: "spatial://citylife/world/colony-primary/surface",
        kind: "region",
        layer: "surface",
        parentId: "world",
        transform: IDENTITY,
        grid: {
          width: 608,
          height: 608,
          cellSize: 4,
          origin: { x: -1216, y: 0, z: -1216 },
        },
      },
      {
        id: "world",
        address: "spatial://citylife/world/colony-primary",
        kind: "world",
        layer: "orbital",
        parentId: "universe",
        transform: IDENTITY,
      },
      {
        id: "universe",
        address: "spatial://citylife",
        kind: "universe",
        layer: "deep-space",
        transform: IDENTITY,
      },
    ],
    placements: [
      {
        id: "plot:z",
        definitionId: "zoned-plot:commercial:compact",
        frameId: "surface",
        layer: "surface",
        source: "builder",
        cells: [
          { x: 21, y: 20 },
          { x: 20, y: 20 },
        ],
        bounds: { x: 20, y: 20, w: 2, h: 1 },
        vertical: { ...VERTICAL, max: 16, clearanceAbove: 2 },
        anchors: [
          { id: "road", cell: { x: 21, y: 20 } },
          { id: "gate", cell: { x: 20, y: 20 } },
        ],
        orientation: "n",
      },
      {
        id: "hq",
        definitionId: "building:kooker-hq",
        frameId: "surface",
        layer: "surface",
        source: "seed",
        cells: [{ x: 8, y: 9 }],
        bounds: { x: 8, y: 9, w: 1, h: 1 },
        vertical: { ...VERTICAL, max: 24 },
        anchors: [{ id: "entrance", cell: { x: 8, y: 9 } }],
      },
    ],
    roads: [
      {
        id: "road:b",
        frameId: "surface",
        layer: "surface",
        kind: "street",
        cells: [
          { x: 20, y: 22 },
          { x: 19, y: 22 },
        ],
        vertical: VERTICAL,
      },
      {
        id: "road:a",
        frameId: "surface",
        layer: "surface",
        kind: "avenue",
        cells: [
          { x: 19, y: 21 },
          { x: 19, y: 20 },
        ],
        vertical: VERTICAL,
      },
    ],
    ways: [
      {
        id: "way:main",
        frameId: "surface",
        layer: "surface",
        kind: "avenue",
        width: 3.25,
        cells: [
          { x: 19, y: 20 },
          { x: 19, y: 21 },
          { x: 19, y: 22 },
        ],
        roadIds: ["road:b", "road:a"],
      },
    ],
    terrainEdits: [
      {
        frameId: "surface",
        cell: { x: 21, y: 20 },
        elevation: 1.25,
      },
      {
        frameId: "surface",
        cell: { x: 20, y: 20 },
        biome: 3,
        buildability: 2,
      },
    ],
    portals: [
      {
        id: "portal:hq-front-door",
        address:
          "spatial://citylife/world/colony-primary/surface/hq/front-door",
        fromFrameId: "surface",
        toFrameId: "surface:building:hq",
        from: { x: 8, y: 0, z: 9 },
        to: { x: 0, y: 0, z: 1 },
        modes: ["portal", "walk"],
      },
    ],
  };
}

function json(document: WorldLayoutDocument): Record<string, unknown> {
  return JSON.parse(serializeWorldLayoutDocument(document)) as Record<
    string,
    unknown
  >;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function expectDocumentError(
  action: () => unknown,
  code: WorldLayoutDocumentError["code"],
  path?: string,
): WorldLayoutDocumentError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(WorldLayoutDocumentError);
    const documentError = error as WorldLayoutDocumentError;
    expect(documentError.code).toBe(code);
    if (path) expect(documentError.path).toBe(path);
    return documentError;
  }
  throw new Error("expected WorldLayoutDocumentError");
}

describe("WB.1d WorldLayoutDocument", () => {
  it("creates a strict v1 document with an independently reproducible SHA-256 revision", () => {
    const document = createWorldLayoutDocument(input());
    expect(document.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(document.layoutId).toBe("colony-primary");
    expect(document.worldId).toBe(document.layoutId);
    expect(Object.keys(document)).not.toContain("worldId");
    expect(Object.getOwnPropertyDescriptor(document, "layoutId")).toMatchObject(
      {
        enumerable: true,
        writable: false,
        configurable: false,
      },
    );
    expect(document.frames.map(({ id }) => id)).toEqual([
      "surface",
      "surface:building:hq",
      "surface:room:hq-reception",
      "universe",
      "world",
    ]);
    expect(document.placements.map(({ id }) => id)).toEqual(["hq", "plot:z"]);
    expect(document.placements[1]!.cells).toEqual([
      { x: 20, y: 20 },
      { x: 21, y: 20 },
    ]);
    expect(document.placements[1]!.anchors.map(({ id }) => id)).toEqual([
      "gate",
      "road",
    ]);
    expect(document.roads.map(({ id }) => id)).toEqual(["road:a", "road:b"]);
    expect(document.ways[0]!.roadIds).toEqual(["road:a", "road:b"]);
    expect(document.portals[0]!.modes).toEqual(["portal", "walk"]);

    const content = {
      ...document,
      revision: {
        number: document.revision.number,
        parentHash: document.revision.parentHash,
      },
    };
    const independent = createHash("sha256")
      .update(canonicalJson(content))
      .digest("hex");
    expect(document.revision.contentHash).toBe(independent);
    expect(computeWorldLayoutContentHash(document)).toBe(independent);
    expect(worldLayoutRevisionId(document.revision)).toBe(
      `wl:v1:1:${independent}`,
    );
  });

  it("serializes canonically and round-trips idempotently", () => {
    const document = createWorldLayoutDocument(input());
    const wire = serializeWorldLayoutDocument(document);
    const parsed = parseWorldLayoutDocument(wire);
    expect(parsed).toEqual(document);
    expect(serializeWorldLayoutDocument(parsed)).toBe(wire);
    expect(canonicalizeWorldLayoutDocument(parsed)).toEqual(document);
    expect(migrateWorldLayoutDocument(JSON.parse(wire))).toEqual(document);
  });

  it("verifies and deterministically migrates the committed v0 fixture", () => {
    const fixture = readFileSync(
      new URL("./fixtures/world-layout-v0.json", import.meta.url),
      "utf8",
    );
    expect(JSON.parse(fixture).schemaVersion).toBe(
      WORLD_LAYOUT_V0_SCHEMA_VERSION,
    );
    const migrated = migrateWorldLayoutDocument(fixture);
    expect(migrated.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(migrated.layoutId).toBe("legacy-fixture");
    expect(migrated.worldId).toBe(migrated.layoutId);
    expect(migrated.roads[0]!.id).toBe("road:surface:street");
    expect(migrated.roads[0]!.provenance).toBe(LEGACY_WORLD_LAYOUT_PROVENANCE);
    expect(migrated.terrainEdits).toEqual([
      {
        id: "terrain:surface:3,3",
        frameId: "surface",
        cell: { x: 3, y: 3 },
        elevation: 1.25,
        provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
      },
    ]);
    expect(
      serializeWorldLayoutDocument(migrateWorldLayoutDocument(fixture)),
    ).toBe(serializeWorldLayoutDocument(migrated));

    const tampered = JSON.parse(fixture) as Record<string, unknown>;
    tampered.seed = 4243;
    expectDocumentError(
      () => migrateWorldLayoutDocument(tampered),
      "CONTENT_HASH_MISMATCH",
      "$v0.revision.contentHash",
    );
  });

  it("verifies the pushed numeric-v1 codec before migrating its semantic payload", () => {
    const fixture = readFileSync(
      new URL("./fixtures/world-layout-numeric-v1.json", import.meta.url),
      "utf8",
    );
    expect(JSON.parse(fixture).schemaVersion).toBe(
      WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION,
    );
    const migrated = migrateWorldLayoutDocument(fixture);
    expect(migrated.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(migrated.layoutId).toBe("legacy-fixture");
    expect(migrated.terrainEdits[0]).toMatchObject({
      id: "terrain:surface:3,3",
      provenance: LEGACY_WORLD_LAYOUT_PROVENANCE,
    });
    expect(migrated.revision.contentHash).not.toBe(
      "43b554fa2d9082bc1ac9c8c587aae1de1d9d6798d16f7f6a016b26694a2647b4",
    );

    const tampered = JSON.parse(fixture) as Record<string, unknown>;
    tampered.seed = 4243;
    expectDocumentError(
      () => migrateWorldLayoutDocument(tampered),
      "CONTENT_HASH_MISMATCH",
      "$numericV1.revision.contentHash",
    );
  });

  it("canonicalizes set order while revision number and parent hash remain immutable lineage", () => {
    const firstInput = input();
    const first = createWorldLayoutDocument(firstInput);
    const second = createWorldLayoutDocument({
      ...firstInput,
      frames: [...firstInput.frames].reverse(),
      placements: [...firstInput.placements].reverse().map((item) => ({
        ...item,
        cells: [...item.cells].reverse(),
        anchors: [...item.anchors].reverse(),
      })),
      roads: [...firstInput.roads]
        .reverse()
        .map((item) => ({ ...item, cells: [...item.cells].reverse() })),
      terrainEdits: firstInput.terrainEdits,
      portals: firstInput.portals.map((item) => ({
        ...item,
        modes: [...item.modes].reverse(),
      })),
      ways: firstInput.ways.map((item) => ({
        ...item,
        roadIds: item.roadIds ? [...item.roadIds].reverse() : undefined,
      })),
    });
    expect(second.revision.contentHash).toBe(first.revision.contentHash);

    const next = createWorldLayoutDocument({
      ...firstInput,
      revision: {
        number: 2,
        parentHash: first.revision.contentHash,
      },
    });
    expect(next.revision.contentHash).not.toBe(first.revision.contentHash);

    const pathChanged = createWorldLayoutDocument({
      ...firstInput,
      ways: firstInput.ways.map((item) => ({
        ...item,
        cells: [...item.cells].reverse(),
      })),
    });
    expect(pathChanged.revision.contentHash).not.toBe(
      first.revision.contentHash,
    );

    const terrainOrderChanged = createWorldLayoutDocument({
      ...firstInput,
      terrainEdits: [...firstInput.terrainEdits].reverse(),
    });
    expect(terrainOrderChanged.revision.contentHash).not.toBe(
      first.revision.contentHash,
    );
    expect(terrainOrderChanged.terrainEdits.map(({ id }) => id)).toEqual(
      [...first.terrainEdits].reverse().map(({ id }) => id),
    );
  });

  it("detects content or revision tampering", () => {
    const document = createWorldLayoutDocument(input());
    const tamperedContent = json(document);
    tamperedContent.seed = 4243;
    expectDocumentError(
      () => migrateWorldLayoutDocument(tamperedContent),
      "CONTENT_HASH_MISMATCH",
      "$.revision.contentHash",
    );

    const tamperedRevision = json(document);
    (tamperedRevision.revision as Record<string, unknown>).number = 2;
    expectDocumentError(
      () => migrateWorldLayoutDocument(tamperedRevision),
      "CONTENT_HASH_MISMATCH",
      "$.revision.contentHash",
    );
  });

  it("rejects unknown versions and malformed JSON through the explicit dispatcher", () => {
    const document = json(createWorldLayoutDocument(input()));
    document.schemaVersion = "citylife.world-layout/v2";
    expectDocumentError(
      () => migrateWorldLayoutDocument(document),
      "UNKNOWN_VERSION",
      "$.schemaVersion",
    );
    expectDocumentError(
      () => parseWorldLayoutDocument("{broken"),
      "INVALID_JSON",
      "$",
    );
  });

  it("does not admit private or transient state at any document boundary", () => {
    const document = json(createWorldLayoutDocument(input()));
    document.presence = { botId: "secret", room: "boardroom" };
    expectDocumentError(
      () => migrateWorldLayoutDocument(document),
      "INVALID_DOCUMENT",
      "$.presence",
    );

    const nested = json(createWorldLayoutDocument(input()));
    (nested.frames as Record<string, unknown>[])[0]!.metadata = {
      credentials: "never persist this",
    };
    expectDocumentError(
      () => migrateWorldLayoutDocument(nested),
      "INVALID_DOCUMENT",
      "$.frames[0].metadata",
    );

    const preview = json(createWorldLayoutDocument(input()));
    (preview.placements as Record<string, unknown>[])[0]!.placementGhost = true;
    expectDocumentError(
      () => migrateWorldLayoutDocument(preview),
      "INVALID_DOCUMENT",
      "$.placements[0].placementGhost",
    );
  });

  it("validates the frame graph and every persisted reference", () => {
    const missingFrameBase = input();
    const missingFrame: WorldLayoutDocumentInput = {
      ...missingFrameBase,
      placements: missingFrameBase.placements.map((item, index) =>
        index === 0 ? { ...item, frameId: "missing" } : item,
      ),
    };
    expectDocumentError(
      () => createWorldLayoutDocument(missingFrame),
      "REFERENTIAL_INTEGRITY",
      "$.placements[1].frameId",
    );

    const missingRoadBase = input();
    const missingRoad: WorldLayoutDocumentInput = {
      ...missingRoadBase,
      ways: missingRoadBase.ways.map((item, index) =>
        index === 0 ? { ...item, roadIds: ["road:missing"] } : item,
      ),
    };
    expectDocumentError(
      () => createWorldLayoutDocument(missingRoad),
      "REFERENTIAL_INTEGRITY",
      "$.ways[0].roadIds[0]",
    );

    const cycleBase = input();
    const cycle: WorldLayoutDocumentInput = {
      ...cycleBase,
      frames: cycleBase.frames.map((item) =>
        item.id === "universe" ? { ...item, parentId: "world" } : item,
      ),
    };
    expectDocumentError(
      () => createWorldLayoutDocument(cycle),
      "REFERENTIAL_INTEGRITY",
      "$.frames",
    );

    const missingPortalBase = input();
    const missingPortalFrame: WorldLayoutDocumentInput = {
      ...missingPortalBase,
      portals: missingPortalBase.portals.map((item, index) =>
        index === 0 ? { ...item, toFrameId: "missing" } : item,
      ),
    };
    expectDocumentError(
      () => createWorldLayoutDocument(missingPortalFrame),
      "REFERENTIAL_INTEGRITY",
      "$.portals[0].toFrameId",
    );
  });

  it("rejects lossy geometry and duplicate sparse terrain edits", () => {
    const looseBoundsBase = input();
    const looseBounds: WorldLayoutDocumentInput = {
      ...looseBoundsBase,
      placements: looseBoundsBase.placements.map((item, index) =>
        index === 0 ? { ...item, bounds: { x: 7, y: 9, w: 2, h: 1 } } : item,
      ),
    };
    expectDocumentError(
      () => createWorldLayoutDocument(looseBounds),
      "INVALID_DOCUMENT",
      "$.placements[0].bounds",
    );

    const duplicateEditsBase = input();
    const duplicateEdits: WorldLayoutDocumentInput = {
      ...duplicateEditsBase,
      terrainEdits: [
        ...duplicateEditsBase.terrainEdits,
        { frameId: "surface", cell: { x: 20, y: 20 }, elevation: 2 },
      ],
    };
    expectDocumentError(
      () => createWorldLayoutDocument(duplicateEdits),
      "REFERENTIAL_INTEGRITY",
      "$.terrainEdits[2]",
    );
  });

  it("uses strict V1 wire identity, uint32 seeds and rejects negative zero", () => {
    const document = createWorldLayoutDocument({
      ...input(),
      layoutId: "colony-primary",
      worldId: "colony-primary",
    });
    const wire = serializeWorldLayoutDocument(document);
    expect(wire).toContain('"layoutId":"colony-primary"');
    expect(wire).not.toContain('"worldId"');
    expect(Object.keys(JSON.parse(wire))).toEqual([
      "frames",
      "generator",
      "layoutId",
      "networks",
      "placements",
      "portals",
      "reservations",
      "revision",
      "roads",
      "schemaVersion",
      "seed",
      "terrainEdits",
      "ways",
      "zones",
    ]);
    const compatibilityWire = JSON.parse(wire) as Record<string, unknown>;
    compatibilityWire.worldId = compatibilityWire.layoutId;
    delete compatibilityWire.layoutId;
    expectDocumentError(
      () => parseWorldLayoutDocument(JSON.stringify(compatibilityWire)),
      "INVALID_DOCUMENT",
      "$.worldId",
    );
    const { worldId: _worldId, ...layoutOnly } = input();
    expect(
      createWorldLayoutDocument({ ...layoutOnly, layoutId: "colony-primary" })
        .layoutId,
    ).toBe("colony-primary");

    expectDocumentError(
      () => createWorldLayoutDocument({ ...input(), seed: 0x1_0000_0000 }),
      "INVALID_DOCUMENT",
      "$.seed",
    );
    expectDocumentError(
      () => createWorldLayoutDocument({ ...input(), seed: -0 }),
      "INVALID_DOCUMENT",
      "$.seed",
    );
    const negativeZeroTransform = input();
    expectDocumentError(
      () =>
        createWorldLayoutDocument({
          ...negativeZeroTransform,
          frames: negativeZeroTransform.frames.map((item) =>
            item.id === "universe"
              ? {
                  ...item,
                  transform: {
                    ...item.transform,
                    position: { ...item.transform.position, x: -0 },
                  },
                }
              : item,
          ),
        }),
      "INVALID_DOCUMENT",
      "$.frames[4].transform.position.x",
    );
    expectDocumentError(
      () =>
        createWorldLayoutDocument({
          ...input(),
          layoutId: "other-layout",
        }),
      "INVALID_DOCUMENT",
      "$.layoutId",
    );
  });

  it("treats frame IDs as global and rejects overlapping zone or reservation volumes", () => {
    const frameCollision = input();
    expectDocumentError(
      () =>
        createWorldLayoutDocument({
          ...frameCollision,
          roads: frameCollision.roads.map((item, index) =>
            index === 0 ? { ...item, id: "surface" } : item,
          ),
        }),
      "REFERENTIAL_INTEGRITY",
      "$.roads",
    );

    const overlappingZones = input();
    expectDocumentError(
      () =>
        createWorldLayoutDocument({
          ...overlappingZones,
          zones: [
            {
              id: "zone:a",
              frameId: "surface",
              kind: "commercial",
              cells: [{ x: 4, y: 4 }],
              vertical: VERTICAL,
            },
            {
              id: "zone:b",
              frameId: "surface",
              kind: "civic",
              cells: [{ x: 4, y: 4 }],
              vertical: VERTICAL,
            },
          ],
        }),
      "REFERENTIAL_INTEGRITY",
      "$.zones[1].cells",
    );

    const overlappingReservations = input();
    expectDocumentError(
      () =>
        createWorldLayoutDocument({
          ...overlappingReservations,
          reservations: [
            {
              id: "reservation:a",
              frameId: "surface",
              purpose: "first",
              cells: [{ x: 5, y: 5 }],
              vertical: VERTICAL,
            },
            {
              id: "reservation:b",
              frameId: "surface",
              purpose: "second",
              cells: [{ x: 5, y: 5 }],
              vertical: VERTICAL,
            },
          ],
        }),
      "REFERENTIAL_INTEGRITY",
      "$.reservations[1].cells",
    );
  });
});
