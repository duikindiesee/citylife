import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeWorldLayoutHistoryEvidenceHash } from "../src/colony/spatial/worldLayoutDocument";
import {
  WorldLayoutStore,
  WorldLayoutStoreCorruptionError,
  type StoredWorldLayoutRevision,
  type WorldLayoutSaveInput,
} from "../src/colony/worldLayoutStore";

const WORLD_ID = "retention-world";
let databaseNumber = 0;
let databaseName: string;
let indexedDB: IDBFactory;
let store: WorldLayoutStore | undefined;

function layout(elevation?: number): WorldLayoutSaveInput {
  return {
    worldId: WORLD_ID,
    seed: 4242,
    frames: [
      {
        id: "surface",
        address: `spatial://citylife/world/${WORLD_ID}/surface`,
        kind: "region",
        layer: "surface",
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
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
    terrainEdits:
      elevation === undefined
        ? []
        : [
            {
              frameId: "surface",
              cell: { x: 3, y: 4 },
              elevation,
            },
          ],
    portals: [],
  };
}

async function saveRevisions(
  count: number,
): Promise<StoredWorldLayoutRevision[]> {
  const saved: StoredWorldLayoutRevision[] = [];
  let expected: string | null = null;
  for (let index = 0; index < count; index++) {
    const result = await store!.save(
      layout(index === 0 ? undefined : index),
      expected,
    );
    if (result.status !== "saved")
      throw new Error(`expected revision ${index} to save`);
    saved.push(result.revision);
    expected = result.revision.layoutRevision;
  }
  return saved;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

async function rawCounts(): Promise<{
  revisions: number;
  checkpoints: number;
}> {
  const database = await request(indexedDB.open(databaseName));
  const transaction = database.transaction(
    ["revisions", "checkpoints"],
    "readonly",
  );
  const result = await Promise.all([
    request(transaction.objectStore("revisions").count()),
    request(transaction.objectStore("checkpoints").count()),
  ]);
  database.close();
  return { revisions: result[0], checkpoints: result[1] };
}

async function mutateRawRow(
  storeName: "checkpoints" | "revisions",
  key: IDBValidKey,
  mutate: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const database = await request(indexedDB.open(databaseName));
  const transaction = database.transaction(storeName, "readwrite");
  const objectStore = transaction.objectStore(storeName);
  const row = await request(
    objectStore.get(key) as IDBRequest<Record<string, unknown>>,
  );
  objectStore.put(mutate(row));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

beforeEach(() => {
  indexedDB = new IDBFactory();
  databaseName = `world-layout-retention-${databaseNumber++}`;
  store = new WorldLayoutStore({
    databaseName,
    indexedDB,
    IDBKeyRange,
    maxRollbackDepth: 2,
  });
});

afterEach(async () => {
  await store?.close();
  store = undefined;
});

describe("WorldLayoutStore bounded history", () => {
  it("retains rollback-depth snapshots and folds every older revision into evidence", async () => {
    const saved = await saveRevisions(6);

    expect(
      (await store!.history(WORLD_ID, 100)).map((row) => row.sequence),
    ).toEqual([5, 4, 3]);
    expect(
      await store!.loadRevision(WORLD_ID, saved[2]!.layoutRevision),
    ).toBeNull();
    expect(await rawCounts()).toEqual({ revisions: 3, checkpoints: 1 });

    let expectedEvidence = "0".repeat(64);
    for (const revision of saved.slice(0, 3))
      expectedEvidence = computeWorldLayoutHistoryEvidenceHash(
        expectedEvidence,
        revision.sequence,
        revision.layoutRevision,
        revision.document.revision.contentHash,
        revision.document.revision.parentHash,
      );
    expect(await store!.historyEvidence(WORLD_ID)).toEqual({
      worldId: WORLD_ID,
      throughSequence: 2,
      throughLayoutRevision: saved[2]!.layoutRevision,
      throughContentHash: saved[2]!.document.revision.contentHash,
      evidenceHash: expectedEvidence,
    });

    const rollback = await store!.rollback(
      WORLD_ID,
      saved[3]!.layoutRevision,
      saved[5]!.layoutRevision,
    );
    expect(rollback.status).toBe("saved");
    if (rollback.status !== "saved") throw new Error("expected rollback save");
    expect(rollback.revision.sequence).toBe(6);
    expect(rollback.revision.document.terrainEdits).toEqual(
      saved[3]!.document.terrainEdits,
    );
    expect(
      (await store!.history(WORLD_ID, 100)).map((row) => row.sequence),
    ).toEqual([6, 5, 4]);

    await expect(
      store!.rollback(
        WORLD_ID,
        saved[2]!.layoutRevision,
        rollback.revision.layoutRevision,
      ),
    ).rejects.toMatchObject({
      code: "ROLLBACK_OUT_OF_RANGE",
      requestedDepth: 4,
      maximumDepth: 2,
    });
  });

  it("compacts a previously larger valid retained window on first open", async () => {
    await store!.close();
    store = new WorldLayoutStore({
      databaseName,
      indexedDB,
      IDBKeyRange,
      maxRollbackDepth: 6,
    });
    const saved = await saveRevisions(7);
    expect(await rawCounts()).toEqual({ revisions: 7, checkpoints: 0 });
    await store.close();

    store = new WorldLayoutStore({
      databaseName,
      indexedDB,
      IDBKeyRange,
      maxRollbackDepth: 2,
    });
    expect((await store.load(WORLD_ID))?.layoutRevision).toBe(
      saved[6]!.layoutRevision,
    );
    expect(await rawCounts()).toEqual({ revisions: 3, checkpoints: 1 });
    expect(
      (await store.history(WORLD_ID, 100)).map((row) => row.sequence),
    ).toEqual([6, 5, 4]);
    expect((await store.historyEvidence(WORLD_ID))?.throughSequence).toBe(3);
  });

  it("rejects a valid-hex mutation of checkpoint evidence", async () => {
    await saveRevisions(6);
    await mutateRawRow("checkpoints", WORLD_ID, (row) => ({
      ...row,
      evidenceHash: "f".repeat(64),
    }));

    await expect(store!.load(WORLD_ID)).rejects.toBeInstanceOf(
      WorldLayoutStoreCorruptionError,
    );
  });

  it("rejects a valid-hex mutation of a retained row accumulator", async () => {
    await saveRevisions(6);
    await mutateRawRow("revisions", [WORLD_ID, 4], (row) => ({
      ...row,
      chainHash: "f".repeat(64),
    }));

    await expect(store!.load(WORLD_ID)).rejects.toBeInstanceOf(
      WorldLayoutStoreCorruptionError,
    );
  });

  it("bounds configuration and removes checkpoint evidence with the world", async () => {
    expect(
      () =>
        new WorldLayoutStore({
          databaseName: `${databaseName}-oversized`,
          indexedDB,
          IDBKeyRange,
          maxRollbackDepth: 1_001,
        }),
    ).toThrow(/must not exceed 1000/);

    await saveRevisions(4);
    expect(await store!.historyEvidence(WORLD_ID)).not.toBeNull();
    await store!.deleteWorld(WORLD_ID);
    expect(await store!.load(WORLD_ID)).toBeNull();
    expect(await store!.historyEvidence(WORLD_ID)).toBeNull();
    expect(await rawCounts()).toEqual({ revisions: 0, checkpoints: 0 });
  });
});
