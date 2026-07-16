import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORLD_LAYOUT_IMPORT_MAX_BYTES,
  validateWorldLayoutImportFile,
} from "../src/colony/ui/BuilderPanel";
import {
  publicWorldLayoutHistoryEntries,
  validatedWorldLayoutImportSaveInput as buildValidatedWorldLayoutImportSaveInput,
} from "../src/colony/ui/ColonyApp";
import {
  createWorldLayoutDocument,
  serializeWorldLayoutDocument,
  type WorldLayoutDocument,
  type WorldLayoutDocumentInput,
} from "../src/colony/spatial/worldLayoutDocument";
import { WorldLayoutStore } from "../src/colony/worldLayoutStore";

const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
} as const;

let databaseNumber = 0;
let store: WorldLayoutStore | undefined;

const validatedWorldLayoutImportSaveInput = (
  serialized: string,
  current: WorldLayoutDocument,
) =>
  buildValidatedWorldLayoutImportSaveInput(serialized, current, () => {
    // Compatibility-focused unit cases below isolate the strict wire/frame checks. Runtime
    // preflight integration has dedicated seeded-terrain atomicity coverage.
  });

afterEach(async () => {
  await store?.close();
  store = undefined;
});

function documentInput(terrainElevation?: number): WorldLayoutDocumentInput {
  return {
    worldId: "seed-4242",
    seed: 4242,
    revision: { number: 0, parentHash: null },
    frames: [
      {
        id: "surface",
        address: "spatial://citylife/world/seed-4242/surface",
        kind: "region",
        layer: "surface",
        transform: IDENTITY,
        grid: {
          width: 32,
          height: 32,
          cellSize: 4,
          origin: { x: -64, y: 0, z: -64 },
        },
      },
    ],
    placements: [],
    roads: [],
    ways: [],
    terrainEdits:
      terrainElevation === undefined
        ? []
        : [
            {
              id: "terrain:surface:2,3",
              frameId: "surface",
              cell: { x: 2, y: 3 },
              elevation: terrainElevation,
            },
          ],
    portals: [],
  };
}

function document(terrainElevation?: number): WorldLayoutDocument {
  return createWorldLayoutDocument(documentInput(terrainElevation));
}

function importDocument(
  current: WorldLayoutDocument,
  terrainElevation: number,
): WorldLayoutDocument {
  return createWorldLayoutDocument({
    ...documentInput(terrainElevation),
    revision: {
      number: current.revision.number + 1,
      parentHash: current.revision.contentHash,
    },
  });
}

describe("world layout history and import controls", () => {
  it("rejects unsafe file metadata before reading untrusted bytes", () => {
    expect(() =>
      validateWorldLayoutImportFile({
        name: "layout.txt",
        size: 20,
        type: "text/plain",
      }),
    ).toThrow(".json");
    expect(() =>
      validateWorldLayoutImportFile({
        name: "layout.json",
        size: WORLD_LAYOUT_IMPORT_MAX_BYTES + 1,
        type: "application/json",
      }),
    ).toThrow("5 MiB");
    expect(() =>
      validateWorldLayoutImportFile({
        name: "layout.json",
        size: 20,
        type: "text/html",
      }),
    ).toThrow("JSON media type");
    expect(() =>
      validateWorldLayoutImportFile({
        name: "layout.JSON",
        size: 20,
        type: "application/json; charset=utf-8",
      }),
    ).not.toThrow();
  });

  it("strictly verifies hash and compatibility before producing save input", () => {
    const current = document();
    const candidate = importDocument(current, 7);
    const serialized = serializeWorldLayoutDocument(candidate);

    expect(
      validatedWorldLayoutImportSaveInput(serialized, current),
    ).toMatchObject({
      worldId: current.worldId,
      seed: current.seed,
      generator: current.generator,
      terrainEdits: [{ elevation: 7 }],
    });

    const tampered = serialized.replace('"elevation":7', '"elevation":8');
    expect(() =>
      validatedWorldLayoutImportSaveInput(tampered, current),
    ).toThrow(/hash/i);

    const privatePayload = JSON.parse(serialized) as Record<string, unknown>;
    privatePayload.privateBotState = { token: "must-never-persist" };
    expect(() =>
      validatedWorldLayoutImportSaveInput(
        JSON.stringify(privatePayload),
        current,
      ),
    ).toThrow(/unknown field/i);

    const foreign = createWorldLayoutDocument({
      ...documentInput(7),
      worldId: "seed-elsewhere",
    });
    expect(() =>
      validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(foreign),
        current,
      ),
    ).toThrow("not seed-4242");
  });

  it("rejects generator and base-frame incompatibility while accepting durable placement changes", () => {
    const current = document();
    const incompatibleGenerator = serializeWorldLayoutDocument(
      importDocument(current, 4),
    ).replace('"version":"3"', '"version":"future"');
    expect(() =>
      validatedWorldLayoutImportSaveInput(incompatibleGenerator, current),
    ).toThrow("generator");

    const movedFrame = createWorldLayoutDocument({
      ...documentInput(4),
      frames: [
        {
          ...current.frames[0]!,
          transform: {
            ...IDENTITY,
            position: { x: 4, y: 0, z: 0 },
          },
        },
      ],
    });
    expect(() =>
      validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(movedFrame),
        current,
      ),
    ).toThrow("generator frame");

    const changedPlacements = createWorldLayoutDocument({
      ...documentInput(4),
      placements: [
        {
          id: "plot:1",
          definitionId: "zoned-plot:commercial:compact",
          frameId: "surface",
          layer: "surface",
          source: "import",
          cells: [{ x: 1, y: 1 }],
          bounds: { x: 1, y: 1, w: 1, h: 1 },
          vertical: {
            min: 0,
            max: 4,
            clearanceBelow: 0,
            clearanceAbove: 1,
          },
          anchors: [{ id: "entrance", cell: { x: 1, y: 1 } }],
        },
      ],
    });
    expect(
      validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(changedPlacements),
        current,
      ).placements,
    ).toEqual(changedPlacements.placements);
  });

  it("bounds serialized imports even when the UI file boundary is bypassed", () => {
    expect(() =>
      validatedWorldLayoutImportSaveInput(
        "x".repeat(WORLD_LAYOUT_IMPORT_MAX_BYTES + 1),
        document(),
      ),
    ).toThrow("5 MiB");
  });

  it("loads bounded public history and rolls old content forward as a new CAS revision", async () => {
    store = new WorldLayoutStore({
      databaseName: `world-layout-history-controls-${databaseNumber++}`,
      indexedDB: new IDBFactory(),
      IDBKeyRange,
    });
    const first = await store.save(
      validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(document()),
        document(),
      ),
      null,
    );
    if (first.status !== "saved") throw new Error("expected first revision");
    const second = await store.save(
      validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(
          importDocument(first.revision.document, 8),
        ),
        first.revision.document,
      ),
      first.revision.layoutRevision,
    );
    if (second.status !== "saved") throw new Error("expected second revision");

    const history = await store.history(first.revision.worldId, 50);
    expect(
      publicWorldLayoutHistoryEntries(history, second.revision.layoutRevision),
    ).toEqual([
      {
        revisionNumber: 1,
        revisionId: second.revision.layoutRevision,
        active: true,
      },
      {
        revisionNumber: 0,
        revisionId: first.revision.layoutRevision,
        active: false,
      },
    ]);

    const staleImport = await store.save(
      validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(
          importDocument(second.revision.document, 9),
        ),
        second.revision.document,
      ),
      first.revision.layoutRevision,
    );
    expect(staleImport.status).toBe("conflict");
    expect(await store.history(first.revision.worldId, 50)).toHaveLength(2);

    const rollback = await store.rollback(
      first.revision.worldId,
      first.revision.layoutRevision,
      second.revision.layoutRevision,
    );
    if (rollback.status !== "saved")
      throw new Error("expected rollback revision");
    expect(rollback.revision.sequence).toBe(2);
    expect(rollback.revision.layoutRevision).not.toBe(
      first.revision.layoutRevision,
    );
    expect(rollback.revision.document.terrainEdits).toEqual([]);
    expect(await store.history(first.revision.worldId, 50)).toHaveLength(3);

    const stale = await store.rollback(
      first.revision.worldId,
      first.revision.layoutRevision,
      second.revision.layoutRevision,
    );
    expect(stale.status).toBe("conflict");
    expect(await store.history(first.revision.worldId, 50)).toHaveLength(3);
  });
});
