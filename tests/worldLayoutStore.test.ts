import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WorldLayoutRollbackRangeError,
  WorldLayoutIdentityError,
  WorldLayoutStore,
  WorldLayoutStoreCorruptionError,
  WorldLayoutStoreUnavailableError,
  type WorldLayoutSaveInput,
} from "../src/colony/worldLayoutStore";

let databaseNumber = 0;
let databaseName: string;
let indexedDB: IDBFactory;
let store: WorldLayoutStore | undefined;

function layout(worldId: string, elevation?: number): WorldLayoutSaveInput {
  return {
    worldId,
    seed: 4242,
    frames: [
      {
        id: `${worldId}:island`,
        address: `universe/citylife/${worldId}`,
        kind: "region",
        layer: "surface",
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        grid: {
          width: 608,
          height: 608,
          cellSize: 4,
          origin: { x: -1216, y: 0, z: -1216 },
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
              frameId: `${worldId}:island`,
              cell: { x: 10, y: 12 },
              elevation,
            },
          ],
    portals: [],
  };
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

async function corruptSerializedRevision(
  worldId: string,
  sequence: number,
  serializedDocument: string,
): Promise<void> {
  const database = await request(indexedDB.open(databaseName));
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("revisions", "readwrite");
    const revisions = transaction.objectStore("revisions");
    const read = revisions.get([worldId, sequence]);
    read.onsuccess = () => {
      const row = read.result as Record<string, unknown> | undefined;
      if (row === undefined) {
        transaction.abort();
        reject(new Error("revision row was not found"));
        return;
      }
      revisions.put({ ...row, serializedDocument });
    };
    read.onerror = () => reject(read.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

beforeEach(() => {
  indexedDB = new IDBFactory();
  databaseName = `citylife-world-layout-test-${databaseNumber++}`;
  store = new WorldLayoutStore({
    databaseName,
    indexedDB,
    IDBKeyRange,
  });
});

afterEach(async () => {
  await store?.close();
  store = undefined;
});

describe("WorldLayoutStore", () => {
  it("fails clearly when IndexedDB is unavailable", () => {
    const indexedDBDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "indexedDB",
    );
    const keyRangeDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "IDBKeyRange",
    );
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "IDBKeyRange", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(() => new WorldLayoutStore()).toThrow(
        WorldLayoutStoreUnavailableError,
      );
    } finally {
      if (indexedDBDescriptor)
        Object.defineProperty(globalThis, "indexedDB", indexedDBDescriptor);
      else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (keyRangeDescriptor)
        Object.defineProperty(globalThis, "IDBKeyRange", keyRangeDescriptor);
      else
        delete (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
    }
  });

  it("saves and loads a validated canonical head keyed by world", async () => {
    const saved = await store!.save(layout("primary"), null);
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("expected saved result");
    expect(saved.revision.sequence).toBe(0);
    expect(saved.revision.document.revision).toEqual({
      number: 0,
      parentHash: null,
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(saved.revision.layoutRevision).toBe(
      `wl:v1:0:${saved.revision.document.revision.contentHash}`,
    );

    const loaded = await store!.load("primary");
    expect(loaded).toEqual(saved.revision);
    expect(loaded?.document).not.toBe(saved.revision.document);
  });

  it("returns explicit no-op and CAS conflict results without adding history", async () => {
    const initial = await store!.save(layout("primary"), null);
    if (initial.status !== "saved") throw new Error("expected saved result");

    const noop = await store!.save(
      layout("primary"),
      initial.revision.layoutRevision,
    );
    expect(noop).toEqual({ status: "noop", revision: initial.revision });
    expect(await store!.history("primary")).toHaveLength(1);

    const stale = await store!.save(layout("primary", 3), null);
    expect(stale).toEqual({
      status: "conflict",
      expectedLayoutRevision: null,
      actualLayoutRevision: initial.revision.layoutRevision,
    });
    expect(await store!.history("primary")).toHaveLength(1);
  });

  it("advances immutable history and resolves an exact historical revision", async () => {
    const first = await store!.save(layout("primary"), null);
    if (first.status !== "saved") throw new Error("expected saved result");
    const second = await store!.save(
      layout("primary", 3),
      first.revision.layoutRevision,
    );
    if (second.status !== "saved") throw new Error("expected saved result");

    expect(second.revision.document.revision).toMatchObject({
      number: 1,
      parentHash: first.revision.document.revision.contentHash,
    });
    expect(await store!.history("primary")).toEqual([
      second.revision,
      first.revision,
    ]);
    expect(
      await store!.loadRevision("primary", first.revision.layoutRevision),
    ).toEqual(first.revision);
  });

  it("does not allow a persisted world's generation seed to change", async () => {
    const first = await store!.save(layout("primary"), null);
    if (first.status !== "saved") throw new Error("expected saved result");
    const changedSeed = { ...layout("primary"), seed: 4243 };

    await expect(
      store!.save(changedSeed, first.revision.layoutRevision),
    ).rejects.toBeInstanceOf(WorldLayoutIdentityError);
    expect(await store!.history("primary")).toEqual([first.revision]);
  });

  it("rolls back old content as a new deterministic child revision", async () => {
    const first = await store!.save(layout("primary"), null);
    if (first.status !== "saved") throw new Error("expected saved result");
    const second = await store!.save(
      layout("primary", 3),
      first.revision.layoutRevision,
    );
    if (second.status !== "saved") throw new Error("expected saved result");

    const rollback = await store!.rollback(
      "primary",
      first.revision.layoutRevision,
      second.revision.layoutRevision,
    );
    if (rollback.status !== "saved") throw new Error("expected saved rollback");
    expect(rollback.revision.sequence).toBe(2);
    expect(rollback.revision.layoutRevision).not.toBe(
      first.revision.layoutRevision,
    );
    expect(rollback.revision.document.terrainEdits).toEqual(
      first.revision.document.terrainEdits,
    );
    expect(rollback.revision.document.revision).toMatchObject({
      number: 2,
      parentHash: second.revision.document.revision.contentHash,
    });
    expect(await store!.history("primary")).toHaveLength(3);
  });

  it("rejects rollback beyond its deterministic revision-depth bound", async () => {
    await store!.close();
    store = new WorldLayoutStore({
      databaseName,
      indexedDB,
      IDBKeyRange,
      maxRollbackDepth: 1,
    });
    const first = await store.save(layout("primary"), null);
    if (first.status !== "saved") throw new Error("expected saved result");
    const second = await store.save(
      layout("primary", 3),
      first.revision.layoutRevision,
    );
    if (second.status !== "saved") throw new Error("expected saved result");
    const third = await store.save(
      layout("primary", 5),
      second.revision.layoutRevision,
    );
    if (third.status !== "saved") throw new Error("expected saved result");

    await expect(
      store.rollback(
        "primary",
        first.revision.layoutRevision,
        third.revision.layoutRevision,
      ),
    ).rejects.toBeInstanceOf(WorldLayoutRollbackRangeError);
    expect((await store.load("primary"))?.layoutRevision).toBe(
      third.revision.layoutRevision,
    );
  });

  it("rejects corrupt persisted rows instead of exposing partial state", async () => {
    await store!.save(layout("primary"), null);
    await store!.close();
    store = undefined;
    await corruptSerializedRevision("primary", 0, "{not-json");
    store = new WorldLayoutStore({
      databaseName,
      indexedDB,
      IDBKeyRange,
    });

    await expect(store.load("primary")).rejects.toBeInstanceOf(
      WorldLayoutStoreCorruptionError,
    );
  });

  it("keeps save, delete and clear operations scoped to one world", async () => {
    await store!.save(layout("primary"), null);
    const other = await store!.save(layout("second-island"), null);
    if (other.status !== "saved") throw new Error("expected saved result");

    await store!.deleteWorld("primary");
    expect(await store!.load("primary")).toBeNull();
    expect(await store!.load("second-island")).toEqual(other.revision);

    await store!.clearWorld("second-island");
    expect(await store!.load("second-island")).toBeNull();
  });
});
