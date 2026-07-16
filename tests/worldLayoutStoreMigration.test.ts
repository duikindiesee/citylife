// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { createHash } from "node:crypto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WORLD_LAYOUT_SCHEMA_VERSION,
  createWorldLayoutDocument,
  migrateLegacyNumericWorldLayoutDocument,
  serializeWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
} from "../src/colony/spatial/worldLayoutDocument";
import { WorldLayoutBootCoordinator } from "../src/colony/worldLayoutBoot";
import {
  WorldLayoutStore,
  WorldLayoutStoreCorruptionError,
} from "../src/colony/worldLayoutStore";

interface RawRevisionRow {
  readonly worldId: string;
  readonly sequence: number;
  readonly layoutRevision: string;
  readonly serializedDocument: string;
  readonly chainHash?: string;
}

interface RawHeadRow {
  readonly worldId: string;
  readonly sequence: number;
  readonly layoutRevision: string;
  readonly chainHash?: string;
}

interface RawSnapshot {
  readonly head?: RawHeadRow;
  readonly rows: readonly RawRevisionRow[];
}

const V0_SERIALIZED = readFileSync(
  new URL("./fixtures/world-layout-v0.json", import.meta.url),
  "utf8",
);
const V0_DECODED = JSON.parse(V0_SERIALIZED) as {
  readonly worldId: string;
  readonly revision: { readonly contentHash: string };
};
const WORLD_ID = V0_DECODED.worldId;
const V0_REVISION = `wl:v0:0:${V0_DECODED.revision.contentHash}`;
const NUMERIC_SERIALIZED = readFileSync(
  new URL("./fixtures/world-layout-numeric-v1.json", import.meta.url),
  "utf8",
);
const NUMERIC_DECODED = JSON.parse(NUMERIC_SERIALIZED) as {
  readonly worldId: string;
  readonly revision: {
    readonly number: number;
    readonly parentHash: string | null;
    readonly contentHash: string;
  };
  readonly schemaVersion: number;
  readonly seed: number;
  readonly frames: readonly unknown[];
  readonly placements: readonly unknown[];
  readonly roads: readonly unknown[];
  readonly ways: readonly unknown[];
  readonly terrainEdits: readonly unknown[];
  readonly portals: readonly unknown[];
};

let databaseNumber = 0;
let databaseName: string;
let indexedDB: IDBFactory;
let store: WorldLayoutStore | undefined;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function seedRawSnapshot(snapshot: RawSnapshot): Promise<void> {
  const database = await request(indexedDB.open(databaseName));
  const transaction = database.transaction(["heads", "revisions"], "readwrite");
  const heads = transaction.objectStore("heads");
  const revisions = transaction.objectStore("revisions");
  heads.clear();
  revisions.clear();
  if (snapshot.head) heads.put(snapshot.head);
  for (const row of snapshot.rows) revisions.put(row);
  await transactionDone(transaction);
  database.close();
}

async function createPushedV1Database(snapshot: RawSnapshot): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("heads", { keyPath: "worldId" });
      const revisions = db.createObjectStore("revisions", {
        keyPath: ["worldId", "sequence"],
      });
      revisions.createIndex(
        "[worldId+layoutRevision]",
        ["worldId", "layoutRevision"],
        { unique: true },
      );
      revisions.createIndex("worldId", "worldId");
      revisions.createIndex("sequence", "sequence");
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const transaction = database.transaction(["heads", "revisions"], "readwrite");
  if (snapshot.head) transaction.objectStore("heads").put(snapshot.head);
  for (const row of snapshot.rows)
    transaction.objectStore("revisions").put(row);
  await transactionDone(transaction);
  database.close();
}

async function createPushedV2Database(snapshot: RawSnapshot): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 2);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("heads", { keyPath: "worldId" });
      const revisions = db.createObjectStore("revisions", {
        keyPath: ["worldId", "sequence"],
      });
      revisions.createIndex(
        "[worldId+layoutRevision]",
        ["worldId", "layoutRevision"],
        { unique: true },
      );
      revisions.createIndex("worldId", "worldId");
      revisions.createIndex("sequence", "sequence");
      db.createObjectStore("checkpoints", { keyPath: "worldId" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const transaction = database.transaction(["heads", "revisions"], "readwrite");
  if (snapshot.head) transaction.objectStore("heads").put(snapshot.head);
  for (const row of snapshot.rows)
    transaction.objectStore("revisions").put(row);
  await transactionDone(transaction);
  database.close();
}

async function readRawSnapshot(): Promise<RawSnapshot> {
  const database = await request(indexedDB.open(databaseName));
  const transaction = database.transaction(["heads", "revisions"], "readonly");
  const [head, rows] = await Promise.all([
    request(
      transaction.objectStore("heads").get(WORLD_ID) as IDBRequest<
        RawHeadRow | undefined
      >,
    ),
    request(
      transaction.objectStore("revisions").getAll() as IDBRequest<
        RawRevisionRow[]
      >,
    ),
  ]);
  await transactionDone(transaction);
  database.close();
  return { ...(head ? { head } : {}), rows };
}

function v0Snapshot(serializedDocument = V0_SERIALIZED): RawSnapshot {
  return {
    head: {
      worldId: WORLD_ID,
      sequence: 0,
      layoutRevision: V0_REVISION,
    },
    rows: [
      {
        worldId: WORLD_ID,
        sequence: 0,
        layoutRevision: V0_REVISION,
        serializedDocument,
      },
    ],
  };
}

function numericChainSnapshot(): RawSnapshot {
  const second = {
    ...NUMERIC_DECODED,
    revision: {
      number: 1,
      parentHash: NUMERIC_DECODED.revision.contentHash,
      contentHash: "",
    },
    terrainEdits: [
      {
        frameId: "surface",
        cell: { x: 3, y: 3 },
        elevation: 2.5,
      },
    ],
  };
  const oldPayload = {
    schemaVersion: second.schemaVersion,
    worldId: second.worldId,
    seed: second.seed,
    revision: {
      number: second.revision.number,
      parentHash: second.revision.parentHash,
    },
    frames: second.frames,
    placements: second.placements,
    roads: second.roads,
    ways: second.ways,
    terrainEdits: second.terrainEdits,
    portals: second.portals,
  };
  second.revision.contentHash = createHash("sha256")
    .update(JSON.stringify(oldPayload))
    .digest("hex");
  const secondRevision = `wl:v1:1:${second.revision.contentHash}`;
  return {
    head: {
      worldId: WORLD_ID,
      sequence: 1,
      layoutRevision: secondRevision,
    },
    rows: [
      {
        worldId: WORLD_ID,
        sequence: 0,
        layoutRevision: `wl:v1:0:${NUMERIC_DECODED.revision.contentHash}`,
        serializedDocument: NUMERIC_SERIALIZED,
      },
      {
        worldId: WORLD_ID,
        sequence: 1,
        layoutRevision: secondRevision,
        serializedDocument: JSON.stringify(second),
      },
    ],
  };
}

function currentChainSnapshot(): RawSnapshot {
  const first = migrateLegacyNumericWorldLayoutDocument(NUMERIC_SERIALIZED);
  const second = createWorldLayoutDocument({
    ...first,
    terrainEdits: first.terrainEdits.map((edit) => ({
      ...edit,
      elevation: (edit.elevation ?? 0) + 1,
    })),
    revision: {
      number: 1,
      parentHash: first.revision.contentHash,
    },
  });
  const firstRevision = worldLayoutRevisionId(first.revision);
  const secondRevision = worldLayoutRevisionId(second.revision);
  return {
    head: {
      worldId: WORLD_ID,
      sequence: 1,
      layoutRevision: secondRevision,
    },
    rows: [
      {
        worldId: WORLD_ID,
        sequence: 0,
        layoutRevision: firstRevision,
        serializedDocument: serializeWorldLayoutDocument(first),
      },
      {
        worldId: WORLD_ID,
        sequence: 1,
        layoutRevision: secondRevision,
        serializedDocument: serializeWorldLayoutDocument(second),
      },
    ],
  };
}

async function replaceEmptyDatabase(snapshot: RawSnapshot): Promise<void> {
  // Opening through Dexie first creates the production schema and indexes. The native write then
  // models an already-installed v0 database without relying on production-private fields.
  await store!.load(WORLD_ID);
  await store!.close();
  store = undefined;
  await seedRawSnapshot(snapshot);
  store = new WorldLayoutStore({ databaseName, indexedDB, IDBKeyRange });
}

beforeEach(() => {
  indexedDB = new IDBFactory();
  databaseName = `citylife-world-layout-migration-${databaseNumber++}`;
  store = new WorldLayoutStore({ databaseName, indexedDB, IDBKeyRange });
});

afterEach(async () => {
  await store?.close();
  store = undefined;
});

describe("WorldLayoutStore v0 upgrade", () => {
  it("atomically upgrades a verified v0 row and head to canonical v1 on load", async () => {
    await replaceEmptyDatabase(v0Snapshot());

    const loaded = await store!.load(WORLD_ID);
    expect(loaded?.document.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(loaded?.document.layoutId).toBe(WORLD_ID);
    expect(loaded?.document.worldId).toBe(WORLD_ID);
    expect(loaded?.sequence).toBe(0);
    expect(loaded?.layoutRevision).toMatch(/^wl:v1:0:[0-9a-f]{64}$/);
    expect(loaded?.document.terrainEdits[0]).toMatchObject({
      id: "terrain:surface:3,3",
      provenance: "legacy-seed-v3",
    });

    await store!.close();
    store = undefined;
    const persisted = await readRawSnapshot();
    expect(persisted.head?.layoutRevision).toBe(loaded?.layoutRevision);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]?.layoutRevision).toBe(loaded?.layoutRevision);
    const wire = JSON.parse(persisted.rows[0]!.serializedDocument) as Record<
      string,
      unknown
    >;
    expect(wire.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(wire.layoutId).toBe(WORLD_ID);
    expect(wire).not.toHaveProperty("worldId");
  });

  it("lets the boot barrier hydrate the upgraded durable head without recapturing", async () => {
    await replaceEmptyDatabase(v0Snapshot());
    let hydrated: WorldLayoutDocument | undefined;
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: WORLD_ID,
      store: store!,
      runtime: {
        captureWorldLayout: () => {
          throw new Error("a stored v0 head must not fall back to capture");
        },
        hydrateWorldLayout: (document) => {
          hydrated = document;
        },
      },
    });

    const result = await coordinator.boot();
    expect(result).toMatchObject({
      ready: true,
      worldId: WORLD_ID,
      source: "stored",
    });
    expect(result.revision).toMatch(/^wl:v1:0:[0-9a-f]{64}$/);
    expect(hydrated?.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(hydrated?.layoutId).toBe(WORLD_ID);
  });

  it("leaves a tampered v0 row and head byte-for-byte untouched", async () => {
    const tampered = V0_SERIALIZED.replace('"seed": 4242', '"seed": 4243');
    await replaceEmptyDatabase(v0Snapshot(tampered));
    const before = await readRawSnapshot();

    await expect(store!.load(WORLD_ID)).rejects.toBeInstanceOf(
      WorldLayoutStoreCorruptionError,
    );
    await store!.close();
    store = undefined;
    expect(await readRawSnapshot()).toEqual(before);
  });

  it("refuses ambiguous multi-row v0 history without partial rewriting", async () => {
    const first = v0Snapshot();
    const ambiguous: RawSnapshot = {
      head: {
        worldId: WORLD_ID,
        sequence: 1,
        layoutRevision: `wl:v0:1:${"a".repeat(64)}`,
      },
      rows: [
        ...first.rows,
        {
          worldId: WORLD_ID,
          sequence: 1,
          layoutRevision: `wl:v0:1:${"a".repeat(64)}`,
          serializedDocument: V0_SERIALIZED,
        },
      ],
    };
    await replaceEmptyDatabase(ambiguous);
    const before = await readRawSnapshot();

    await expect(store!.load(WORLD_ID)).rejects.toBeInstanceOf(
      WorldLayoutStoreCorruptionError,
    );
    await store!.close();
    store = undefined;
    expect(await readRawSnapshot()).toEqual(before);
  });
});

describe("WorldLayoutStore pushed numeric-v1 upgrade", () => {
  it("upgrades the actual pushed Dexie-v1 database schema and numeric chain together", async () => {
    await store!.close();
    store = undefined;
    await createPushedV1Database(numericChainSnapshot());
    store = new WorldLayoutStore({ databaseName, indexedDB, IDBKeyRange });

    const loaded = await store.load(WORLD_ID);
    expect(loaded?.sequence).toBe(1);
    expect(loaded?.document.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    await store.close();
    store = undefined;
    const database = await request(indexedDB.open(databaseName));
    expect([...database.objectStoreNames]).toContain("checkpoints");
    database.close();

    const persisted = await readRawSnapshot();
    expect(
      persisted.rows.every((row) => /^[0-9a-f]{64}$/.test(row.chainHash!)),
    ).toBe(true);
    expect(persisted.head?.chainHash).toBe(persisted.rows.at(-1)?.chainHash);
  });

  it("rewrites a verified two-row chain and its head atomically with new parent hashes", async () => {
    const old = numericChainSnapshot();
    await replaceEmptyDatabase(old);

    const loaded = await store!.load(WORLD_ID);
    expect(loaded?.sequence).toBe(1);
    expect(loaded?.document.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(loaded?.document.terrainEdits[0]).toMatchObject({
      id: "terrain:surface:3,3",
      elevation: 2.5,
      provenance: "legacy-seed-v3",
    });

    await store!.close();
    store = undefined;
    const persisted = await readRawSnapshot();
    expect(persisted.rows).toHaveLength(2);
    const first = JSON.parse(persisted.rows[0]!.serializedDocument) as {
      schemaVersion: string;
      revision: { contentHash: string };
    };
    const second = JSON.parse(persisted.rows[1]!.serializedDocument) as {
      schemaVersion: string;
      revision: { parentHash: string; contentHash: string };
    };
    expect(first.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(second.schemaVersion).toBe(WORLD_LAYOUT_SCHEMA_VERSION);
    expect(second.revision.parentHash).toBe(first.revision.contentHash);
    expect(second.revision.parentHash).not.toBe(
      NUMERIC_DECODED.revision.contentHash,
    );
    expect(persisted.head?.layoutRevision).toBe(
      `wl:v1:1:${second.revision.contentHash}`,
    );
    expect(persisted.head?.layoutRevision).not.toBe(old.head?.layoutRevision);
  });

  it("keeps every numeric row and the old head byte-identical when chain verification fails", async () => {
    const snapshot = numericChainSnapshot();
    const tamperedRows = snapshot.rows.map((row, index) =>
      index === 1
        ? {
            ...row,
            serializedDocument: row.serializedDocument.replace(
              '"elevation":2.5',
              '"elevation":3.5',
            ),
          }
        : row,
    );
    await replaceEmptyDatabase({ head: snapshot.head, rows: tamperedRows });
    const before = await readRawSnapshot();

    await expect(store!.load(WORLD_ID)).rejects.toBeInstanceOf(
      WorldLayoutStoreCorruptionError,
    );
    await store!.close();
    store = undefined;
    expect(await readRawSnapshot()).toEqual(before);
  });
});

describe("WorldLayoutStore repository-chain schema upgrade", () => {
  it("atomically backfills cumulative evidence for a current Dexie-v2 chain", async () => {
    await store!.close();
    store = undefined;
    await createPushedV2Database(currentChainSnapshot());
    store = new WorldLayoutStore({ databaseName, indexedDB, IDBKeyRange });

    expect((await store.load(WORLD_ID))?.sequence).toBe(1);
    await store.close();
    store = undefined;

    const persisted = await readRawSnapshot();
    expect(persisted.rows).toHaveLength(2);
    expect(
      persisted.rows.every((row) => /^[0-9a-f]{64}$/.test(row.chainHash!)),
    ).toBe(true);
    expect(persisted.rows[0]?.chainHash).not.toBe(persisted.rows[1]?.chainHash);
    expect(persisted.head?.chainHash).toBe(persisted.rows[1]?.chainHash);
  });

  it("leaves current Dexie-v2 rows unbackfilled when verification fails", async () => {
    const snapshot = currentChainSnapshot();
    const corrupt: RawSnapshot = {
      head: snapshot.head,
      rows: snapshot.rows.map((row, index) =>
        index === 1
          ? {
              ...row,
              serializedDocument: row.serializedDocument.replace(
                '"elevation":2',
                '"elevation":3',
              ),
            }
          : row,
      ),
    };
    await store!.close();
    store = undefined;
    await createPushedV2Database(corrupt);
    store = new WorldLayoutStore({ databaseName, indexedDB, IDBKeyRange });

    await expect(store.load(WORLD_ID)).rejects.toBeInstanceOf(
      WorldLayoutStoreCorruptionError,
    );
    await store.close();
    store = undefined;
    expect(await readRawSnapshot()).toEqual(corrupt);
  });
});
