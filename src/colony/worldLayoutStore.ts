import Dexie, {
  type DexieOptions,
  type Table,
} from "dexie";
import {
  createWorldLayoutDocument,
  parseWorldLayoutDocument,
  serializeWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
  type WorldLayoutDocumentInput,
} from "./spatial/worldLayoutDocument";

const DEFAULT_DATABASE_NAME = "citylife-world-layouts";
const DEFAULT_MAX_ROLLBACK_DEPTH = 100;
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 1_000;

interface WorldLayoutHeadRow {
  readonly worldId: string;
  readonly sequence: number;
  readonly layoutRevision: string;
}

interface WorldLayoutRevisionRow {
  readonly worldId: string;
  readonly sequence: number;
  readonly layoutRevision: string;
  readonly serializedDocument: string;
}

class WorldLayoutDatabase extends Dexie {
  readonly heads!: Table<WorldLayoutHeadRow, string>;
  readonly revisions!: Table<WorldLayoutRevisionRow, [string, number]>;

  constructor(name: string, options: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      heads: "&worldId",
      revisions:
        "[worldId+sequence], &[worldId+layoutRevision], worldId, sequence",
    });
  }
}

export type WorldLayoutSaveInput = Omit<WorldLayoutDocumentInput, "revision">;

export interface StoredWorldLayoutRevision {
  readonly worldId: string;
  /** Monotonically increasing repository sequence, starting at zero. */
  readonly sequence: number;
  /** CAS token consumed by surveyPlacement and mutation callers. */
  readonly layoutRevision: string;
  /** A newly parsed and validated durable document. */
  readonly document: WorldLayoutDocument;
}

export type WorldLayoutSaveResult =
  | {
      readonly status: "saved";
      readonly revision: StoredWorldLayoutRevision;
    }
  | {
      readonly status: "noop";
      readonly revision: StoredWorldLayoutRevision;
    }
  | {
      readonly status: "conflict";
      readonly expectedLayoutRevision: string | null;
      readonly actualLayoutRevision: string | null;
    };

export interface WorldLayoutStoreOptions {
  readonly databaseName?: string;
  readonly indexedDB?: DexieOptions["indexedDB"];
  readonly IDBKeyRange?: DexieOptions["IDBKeyRange"];
  /** Maximum number of revisions an explicit rollback may cross. */
  readonly maxRollbackDepth?: number;
}

export class WorldLayoutStoreUnavailableError extends Error {
  readonly code = "INDEXEDDB_UNAVAILABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "WorldLayoutStoreUnavailableError";
  }
}

export class WorldLayoutStoreCorruptionError extends Error {
  readonly code = "WORLD_LAYOUT_STORE_CORRUPT" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorldLayoutStoreCorruptionError";
  }
}

export class WorldLayoutRollbackRangeError extends Error {
  readonly code = "ROLLBACK_OUT_OF_RANGE" as const;

  constructor(
    readonly requestedDepth: number,
    readonly maximumDepth: number,
  ) {
    super(
      `Rollback depth ${requestedDepth} exceeds the configured maximum of ${maximumDepth}`,
    );
    this.name = "WorldLayoutRollbackRangeError";
  }
}

export class WorldLayoutIdentityError extends Error {
  readonly code = "WORLD_LAYOUT_IDENTITY_MISMATCH" as const;

  constructor(message: string) {
    super(message);
    this.name = "WorldLayoutIdentityError";
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function requiredWorldId(worldId: string): string {
  if (typeof worldId !== "string" || worldId.trim().length === 0)
    throw new TypeError("worldId must be a non-empty string");
  return worldId;
}

function saveInput(document: WorldLayoutDocument): WorldLayoutSaveInput {
  return {
    worldId: document.worldId,
    seed: document.seed,
    frames: document.frames,
    placements: document.placements,
    roads: document.roads,
    ways: document.ways,
    terrainEdits: document.terrainEdits,
    portals: document.portals,
  };
}

function parseRow(row: WorldLayoutRevisionRow): StoredWorldLayoutRevision {
  let document: WorldLayoutDocument;
  try {
    document = parseWorldLayoutDocument(row.serializedDocument);
  } catch (error) {
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${row.worldId} revision ${row.sequence} is invalid`,
      { cause: error },
    );
  }
  const expectedRevision = worldLayoutRevisionId(document.revision);
  if (document.worldId !== row.worldId)
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout row ${row.worldId} contains document ${document.worldId}`,
    );
  if (
    !Number.isSafeInteger(row.sequence) ||
    row.sequence < 0 ||
    document.revision.number !== row.sequence ||
    row.layoutRevision !== expectedRevision
  )
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${row.worldId} has invalid revision metadata at sequence ${row.sequence}`,
    );
  return {
    worldId: row.worldId,
    sequence: row.sequence,
    layoutRevision: row.layoutRevision,
    document,
  };
}

function validateHistory(
  worldId: string,
  rows: readonly WorldLayoutRevisionRow[],
  head?: WorldLayoutHeadRow,
): readonly StoredWorldLayoutRevision[] {
  const revisions = rows
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(parseRow);
  for (const [index, revision] of revisions.entries()) {
    if (revision.worldId !== worldId || revision.sequence !== index)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has a missing or foreign revision at sequence ${index}`,
      );
    const previous = revisions[index - 1];
    const expectedParentHash = previous?.document.revision.contentHash ?? null;
    if (revision.document.revision.parentHash !== expectedParentHash)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has an invalid parent chain at sequence ${revision.sequence}`,
      );
    if (previous !== undefined && revision.document.seed !== previous.document.seed)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} changes its immutable seed at sequence ${revision.sequence}`,
      );
  }
  if (head === undefined) {
    if (revisions.length !== 0)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has revision history without a head`,
      );
    return revisions;
  }
  const current = revisions.at(-1);
  if (
    head.worldId !== worldId ||
    current === undefined ||
    head.sequence !== current.sequence ||
    head.layoutRevision !== current.layoutRevision
  )
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} head does not match immutable history`,
    );
  return revisions;
}

/**
 * IndexedDB repository for immutable authored world-layout revisions.
 *
 * Document revisions identify content. Repository layout revisions add a monotonically
 * increasing sequence, which lets rollback commit old content without overwriting history.
 */
export class WorldLayoutStore {
  private readonly database: WorldLayoutDatabase;
  private readonly maxRollbackDepth: number;

  constructor(options: WorldLayoutStoreOptions = {}) {
    const indexedDB =
      options.indexedDB ??
      (typeof globalThis.indexedDB === "undefined"
        ? undefined
        : globalThis.indexedDB);
    const IDBKeyRange =
      options.IDBKeyRange ??
      (typeof globalThis.IDBKeyRange === "undefined"
        ? undefined
        : globalThis.IDBKeyRange);
    if (indexedDB === undefined || IDBKeyRange === undefined)
      throw new WorldLayoutStoreUnavailableError(
        "World layout persistence requires an IndexedDB implementation",
      );
    this.maxRollbackDepth = positiveInteger(
      options.maxRollbackDepth ?? DEFAULT_MAX_ROLLBACK_DEPTH,
      "maxRollbackDepth",
    );
    this.database = new WorldLayoutDatabase(
      options.databaseName ?? DEFAULT_DATABASE_NAME,
      { indexedDB, IDBKeyRange },
    );
  }

  async close(): Promise<void> {
    this.database.close();
  }

  private async readValidatedHistory(
    worldId: string,
  ): Promise<readonly StoredWorldLayoutRevision[]> {
    const [head, rows] = await this.database.transaction(
      "r",
      this.database.heads,
      this.database.revisions,
      async () =>
        Promise.all([
          this.database.heads.get(worldId),
          this.database.revisions.where("worldId").equals(worldId).toArray(),
        ]),
    );
    return validateHistory(worldId, rows, head);
  }

  async load(worldId: string): Promise<StoredWorldLayoutRevision | null> {
    const revisions = await this.readValidatedHistory(requiredWorldId(worldId));
    return revisions.at(-1) ?? null;
  }

  async loadRevision(
    worldId: string,
    requestedLayoutRevision: string,
  ): Promise<StoredWorldLayoutRevision | null> {
    const revisions = await this.readValidatedHistory(requiredWorldId(worldId));
    return (
      revisions.find(
        (revision) => revision.layoutRevision === requestedLayoutRevision,
      ) ?? null
    );
  }

  async history(
    worldId: string,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<readonly StoredWorldLayoutRevision[]> {
    const boundedLimit = positiveInteger(limit, "limit");
    if (boundedLimit > MAX_HISTORY_LIMIT)
      throw new RangeError(`limit must not exceed ${MAX_HISTORY_LIMIT}`);
    const revisions = await this.readValidatedHistory(requiredWorldId(worldId));
    return revisions.slice(-boundedLimit).reverse();
  }

  async save(
    input: WorldLayoutSaveInput,
    expectedLayoutRevision: string | null,
  ): Promise<WorldLayoutSaveResult> {
    // Validate and normalize all caller-controlled state before opening a write transaction.
    const validatedInput = saveInput(
      createWorldLayoutDocument({
        ...input,
        revision: { number: 0, parentHash: null },
      }),
    );
    const worldId = validatedInput.worldId;
    return this.database.transaction(
      "rw",
      this.database.heads,
      this.database.revisions,
      async () => {
        const [head, rows] = await Promise.all([
          this.database.heads.get(worldId),
          this.database.revisions.where("worldId").equals(worldId).toArray(),
        ]);
        const revisions = validateHistory(worldId, rows, head);
        const current = revisions.at(-1);
        const actualLayoutRevision = current?.layoutRevision ?? null;
        if (actualLayoutRevision !== expectedLayoutRevision)
          return {
            status: "conflict",
            expectedLayoutRevision,
            actualLayoutRevision,
          };
        if (
          current !== undefined &&
          current.document.seed !== validatedInput.seed
        )
          throw new WorldLayoutIdentityError(
            `World ${worldId} cannot change seed ${current.document.seed} to ${validatedInput.seed}`,
          );

        const comparison = createWorldLayoutDocument({
          ...validatedInput,
          revision:
            current?.document.revision ?? { number: 0, parentHash: null },
        });
        if (
          current?.document.revision.contentHash ===
          comparison.revision.contentHash
        )
          return { status: "noop", revision: current };

        const candidate = createWorldLayoutDocument({
          ...validatedInput,
          revision: {
            number: (current?.document.revision.number ?? -1) + 1,
            parentHash: current?.document.revision.contentHash ?? null,
          },
        });

        return this.append(worldId, current?.sequence ?? -1, candidate);
      },
    );
  }

  async rollback(
    worldId: string,
    targetLayoutRevision: string,
    expectedLayoutRevision: string,
  ): Promise<WorldLayoutSaveResult> {
    requiredWorldId(worldId);
    return this.database.transaction(
      "rw",
      this.database.heads,
      this.database.revisions,
      async () => {
        const [head, rows] = await Promise.all([
          this.database.heads.get(worldId),
          this.database.revisions.where("worldId").equals(worldId).toArray(),
        ]);
        const revisions = validateHistory(worldId, rows, head);
        const current = revisions.at(-1);
        const actualLayoutRevision = current?.layoutRevision ?? null;
        if (actualLayoutRevision !== expectedLayoutRevision)
          return {
            status: "conflict",
            expectedLayoutRevision,
            actualLayoutRevision,
          };
        if (current === undefined)
          return {
            status: "conflict",
            expectedLayoutRevision,
            actualLayoutRevision: null,
          };
        const target = revisions.find(
          (revision) => revision.layoutRevision === targetLayoutRevision,
        );
        if (target === undefined)
          throw new RangeError(
            `World ${worldId} does not contain revision ${targetLayoutRevision}`,
          );
        const depth = current.sequence - target.sequence;
        if (depth < 0)
          throw new WorldLayoutStoreCorruptionError(
            `Rollback target ${targetLayoutRevision} is ahead of the active revision`,
          );
        if (depth > this.maxRollbackDepth)
          throw new WorldLayoutRollbackRangeError(
            depth,
            this.maxRollbackDepth,
          );
        const targetPayloadAtCurrentRevision = createWorldLayoutDocument({
          ...saveInput(target.document),
          revision: {
            number: current.document.revision.number,
            parentHash: current.document.revision.parentHash,
          },
        });
        if (
          current.document.revision.contentHash ===
          targetPayloadAtCurrentRevision.revision.contentHash
        )
          return { status: "noop", revision: current };

        const candidate = createWorldLayoutDocument({
          ...saveInput(target.document),
          revision: {
            number: current.document.revision.number + 1,
            parentHash: current.document.revision.contentHash,
          },
        });
        return this.append(worldId, current.sequence, candidate);
      },
    );
  }

  private async append(
    worldId: string,
    previousSequence: number,
    document: WorldLayoutDocument,
  ): Promise<Extract<WorldLayoutSaveResult, { status: "saved" }>> {
    const sequence = previousSequence + 1;
    if (document.revision.number !== sequence)
      throw new WorldLayoutStoreCorruptionError(
        `Candidate world layout revision ${document.revision.number} does not follow sequence ${previousSequence}`,
      );
    const revision: StoredWorldLayoutRevision = {
      worldId,
      sequence,
      layoutRevision: worldLayoutRevisionId(document.revision),
      document,
    };
    // Serialize and parse once more at the final write boundary. The row only contains this
    // canonical string, so later reads cannot depend on a mutable caller-owned object graph.
    const serializedDocument = serializeWorldLayoutDocument(document);
    parseWorldLayoutDocument(serializedDocument);
    await this.database.revisions.add({
      worldId,
      sequence,
      layoutRevision: revision.layoutRevision,
      serializedDocument,
    });
    await this.database.heads.put({
      worldId,
      sequence,
      layoutRevision: revision.layoutRevision,
    });
    return { status: "saved", revision };
  }

  /** Delete one world's head and immutable history; never affects another world. */
  async deleteWorld(worldId: string): Promise<void> {
    requiredWorldId(worldId);
    await this.database.transaction(
      "rw",
      this.database.heads,
      this.database.revisions,
      async () => {
        await this.database.revisions.where("worldId").equals(worldId).delete();
        await this.database.heads.delete(worldId);
      },
    );
  }

  /** Explicitly world-scoped alias for callers that use clear terminology. */
  async clearWorld(worldId: string): Promise<void> {
    await this.deleteWorld(worldId);
  }
}
