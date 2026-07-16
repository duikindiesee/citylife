import Dexie, { type DexieOptions, type Table } from "dexie";
import {
  WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION,
  WORLD_LAYOUT_SCHEMA_VERSION,
  WORLD_LAYOUT_V0_SCHEMA_VERSION,
  computeWorldLayoutHistoryEvidenceHash,
  createWorldLayoutDocument,
  migrateLegacyNumericWorldLayoutDocument,
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
const MAX_ROLLBACK_DEPTH = 1_000;
const EMPTY_EVIDENCE_HASH = "0".repeat(64);
const HASH_PATTERN = /^[0-9a-f]{64}$/;

interface WorldLayoutHeadRow {
  readonly worldId: string;
  readonly sequence: number;
  readonly layoutRevision: string;
  /** Cumulative repository-chain hash through the active revision. */
  readonly chainHash?: string;
}

interface WorldLayoutStoredRows {
  readonly head?: WorldLayoutHeadRow;
  readonly rows: readonly WorldLayoutRevisionRow[];
  readonly checkpoint?: WorldLayoutCheckpointRow;
}

export interface WorldLayoutHistoryEvidence {
  readonly worldId: string;
  /** Last full snapshot folded into the constant-size checkpoint. */
  readonly throughSequence: number;
  readonly throughLayoutRevision: string;
  readonly throughContentHash: string;
  /** Ordered SHA-256 accumulator over every pruned revision. */
  readonly evidenceHash: string;
}

interface WorldLayoutCheckpointRow extends WorldLayoutHistoryEvidence {
  readonly seed: number;
}

function storedSchemaVersion(row: WorldLayoutRevisionRow): unknown {
  try {
    const decoded = JSON.parse(row.serializedDocument) as unknown;
    return decoded !== null && typeof decoded === "object"
      ? (decoded as Record<string, unknown>).schemaVersion
      : undefined;
  } catch {
    return undefined;
  }
}

async function upgradeRecoverableV0(
  database: WorldLayoutDatabase,
  worldId: string,
  head: WorldLayoutHeadRow | undefined,
  rows: readonly WorldLayoutRevisionRow[],
): Promise<WorldLayoutStoredRows> {
  const v0Rows = rows.filter(
    (row) => storedSchemaVersion(row) === WORLD_LAYOUT_V0_SCHEMA_VERSION,
  );
  if (v0Rows.length === 0) return { head, rows };
  if (v0Rows.length !== 1 || rows.length !== 1 || head === undefined)
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} has an ambiguous v0 history that cannot be upgraded safely`,
    );

  const row = v0Rows[0]!;
  let source: Record<string, unknown>;
  try {
    source = JSON.parse(row.serializedDocument) as Record<string, unknown>;
  } catch (error) {
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} v0 source is not valid JSON`,
      { cause: error },
    );
  }
  const sourceRevision = source.revision as Record<string, unknown> | undefined;
  const sourceHash = sourceRevision?.contentHash;
  const expectedV0Revision =
    typeof sourceHash === "string" ? `wl:v0:0:${sourceHash}` : null;
  if (
    row.worldId !== worldId ||
    row.sequence !== 0 ||
    head.worldId !== worldId ||
    head.sequence !== 0 ||
    expectedV0Revision === null ||
    row.layoutRevision !== expectedV0Revision ||
    head.layoutRevision !== expectedV0Revision
  )
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} has inconsistent v0 row/head metadata`,
    );

  let document: WorldLayoutDocument;
  try {
    document = parseWorldLayoutDocument(row.serializedDocument);
  } catch (error) {
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} v0 source failed verified migration`,
      { cause: error },
    );
  }
  if (
    document.layoutId !== worldId ||
    document.revision.number !== 0 ||
    document.revision.parentHash !== null
  )
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} v0 migration changed immutable identity or lineage`,
    );

  const upgradedRevision = worldLayoutRevisionId(document.revision);
  const chainHash = computeWorldLayoutHistoryEvidenceHash(
    EMPTY_EVIDENCE_HASH,
    0,
    upgradedRevision,
    document.revision.contentHash,
    document.revision.parentHash,
  );
  const upgradedRow: WorldLayoutRevisionRow = {
    worldId,
    sequence: 0,
    layoutRevision: upgradedRevision,
    serializedDocument: serializeWorldLayoutDocument(document),
    chainHash,
  };
  const upgradedHead: WorldLayoutHeadRow = {
    worldId,
    sequence: 0,
    layoutRevision: upgradedRevision,
    chainHash,
  };
  // Both puts belong to the caller's Dexie transaction. Any failure aborts and restores the exact
  // v0 row/head pair; no reader can observe a mixed old-row/new-head state.
  await database.revisions.put(upgradedRow);
  await database.heads.put(upgradedHead);
  return { head: upgradedHead, rows: [upgradedRow] };
}

async function upgradeLegacyNumericHistory(
  database: WorldLayoutDatabase,
  worldId: string,
  head: WorldLayoutHeadRow | undefined,
  rows: readonly WorldLayoutRevisionRow[],
): Promise<WorldLayoutStoredRows> {
  if (head === undefined || rows.length === 0)
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} has numeric legacy history without a complete head and chain`,
    );
  const ordered = rows.slice().sort((a, b) => a.sequence - b.sequence);
  const upgraded: WorldLayoutRevisionRow[] = [];
  let previousOldHash: string | null = null;
  let previousNewHash: string | null = null;
  let previousChainHash = EMPTY_EVIDENCE_HASH;
  let immutableSeed: number | undefined;

  try {
    for (const [index, row] of ordered.entries()) {
      const source = JSON.parse(row.serializedDocument) as {
        readonly worldId?: unknown;
        readonly seed?: unknown;
        readonly revision?: {
          readonly number?: unknown;
          readonly parentHash?: unknown;
          readonly contentHash?: unknown;
        };
      };
      const sourceHash = source.revision?.contentHash;
      const expectedToken =
        typeof sourceHash === "string"
          ? `wl:v1:${index}:${sourceHash}`
          : undefined;
      if (
        row.worldId !== worldId ||
        row.sequence !== index ||
        source.worldId !== worldId ||
        source.revision?.number !== index ||
        source.revision?.parentHash !== previousOldHash ||
        row.layoutRevision !== expectedToken ||
        (immutableSeed !== undefined && source.seed !== immutableSeed)
      )
        throw new WorldLayoutStoreCorruptionError(
          `Stored world layout ${worldId} has inconsistent numeric legacy metadata at sequence ${row.sequence}`,
        );

      const document = migrateLegacyNumericWorldLayoutDocument(
        row.serializedDocument,
        previousNewHash,
      );
      if (
        document.layoutId !== worldId ||
        document.revision.number !== index ||
        document.revision.parentHash !== previousNewHash
      )
        throw new WorldLayoutStoreCorruptionError(
          `Stored world layout ${worldId} numeric migration changed identity or lineage at sequence ${index}`,
        );
      immutableSeed ??= document.seed;
      previousOldHash = sourceHash as string;
      previousNewHash = document.revision.contentHash;
      const layoutRevision = worldLayoutRevisionId(document.revision);
      const chainHash = computeWorldLayoutHistoryEvidenceHash(
        previousChainHash,
        index,
        layoutRevision,
        document.revision.contentHash,
        document.revision.parentHash,
      );
      upgraded.push({
        worldId,
        sequence: index,
        layoutRevision,
        serializedDocument: serializeWorldLayoutDocument(document),
        chainHash,
      });
      previousChainHash = chainHash;
    }
  } catch (error) {
    if (error instanceof WorldLayoutStoreCorruptionError) throw error;
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} numeric legacy history failed verified migration`,
      { cause: error },
    );
  }

  const oldCurrent = ordered.at(-1)!;
  if (
    head.worldId !== worldId ||
    head.sequence !== oldCurrent.sequence ||
    head.layoutRevision !== oldCurrent.layoutRevision
  )
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} numeric legacy head does not match its verified chain`,
    );
  const current = upgraded.at(-1)!;
  const upgradedHead: WorldLayoutHeadRow = {
    worldId,
    sequence: current.sequence,
    layoutRevision: current.layoutRevision,
    chainHash: current.chainHash,
  };
  // All source rows have been verified and all target documents constructed before the first put.
  // The caller owns one rw transaction, so a failed bulk replacement restores every old byte.
  await database.revisions.bulkPut(upgraded);
  await database.heads.put(upgradedHead);
  return { head: upgradedHead, rows: upgraded };
}

interface WorldLayoutRevisionRow {
  readonly worldId: string;
  readonly sequence: number;
  readonly layoutRevision: string;
  readonly serializedDocument: string;
  /** Cumulative repository-chain hash through this immutable row. */
  readonly chainHash?: string;
}

class WorldLayoutDatabase extends Dexie {
  readonly heads!: Table<WorldLayoutHeadRow, string>;
  readonly revisions!: Table<WorldLayoutRevisionRow, [string, number]>;
  readonly checkpoints!: Table<WorldLayoutCheckpointRow, string>;

  constructor(name: string, options: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      heads: "&worldId",
      revisions:
        "[worldId+sequence], &[worldId+layoutRevision], worldId, sequence",
    });
    this.version(2).stores({ checkpoints: "&worldId" });
    // V3 adds cumulative repository-chain fields. They are deliberately backfilled only after
    // the complete current/legacy document chain has been verified in one application rw
    // transaction, so a failed recovery never partially blesses corrupt predecessor bytes.
    this.version(3).stores({
      heads: "&worldId",
      revisions:
        "[worldId+sequence], &[worldId+layoutRevision], worldId, sequence",
      checkpoints: "&worldId",
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
  /** Maximum retained rollback distance; bounded to 1..1000 full snapshots. */
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

function boundedRollbackDepth(value: number): number {
  const parsed = positiveInteger(value, "maxRollbackDepth");
  if (parsed > MAX_ROLLBACK_DEPTH)
    throw new RangeError(
      `maxRollbackDepth must not exceed ${MAX_ROLLBACK_DEPTH}`,
    );
  return parsed;
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
    generator: document.generator,
    frames: document.frames,
    zones: document.zones,
    reservations: document.reservations,
    placements: document.placements,
    roads: document.roads,
    ways: document.ways,
    terrainEdits: document.terrainEdits,
    networks: document.networks,
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

function repositoryChainHash(
  previousChainHash: string,
  revision: StoredWorldLayoutRevision,
): string {
  return computeWorldLayoutHistoryEvidenceHash(
    previousChainHash,
    revision.sequence,
    revision.layoutRevision,
    revision.document.revision.contentHash,
    revision.document.revision.parentHash,
  );
}

function retainedTailChainHash(stored: WorldLayoutStoredRows): string {
  const tail = stored.rows
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .at(-1);
  return (
    tail?.chainHash ?? stored.checkpoint?.evidenceHash ?? EMPTY_EVIDENCE_HASH
  );
}

function validateHistory(
  worldId: string,
  rows: readonly WorldLayoutRevisionRow[],
  head?: WorldLayoutHeadRow,
  checkpoint?: WorldLayoutCheckpointRow,
  allowMissingRepositoryChain = false,
): readonly StoredWorldLayoutRevision[] {
  const orderedRows = rows.slice().sort((a, b) => a.sequence - b.sequence);
  const revisions = orderedRows.map(parseRow);
  if (checkpoint !== undefined) {
    if (
      checkpoint.worldId !== worldId ||
      !Number.isSafeInteger(checkpoint.throughSequence) ||
      checkpoint.throughSequence < 0 ||
      !Number.isSafeInteger(checkpoint.seed) ||
      checkpoint.seed < 0 ||
      checkpoint.seed > 0xffffffff ||
      !HASH_PATTERN.test(checkpoint.throughContentHash) ||
      !HASH_PATTERN.test(checkpoint.evidenceHash) ||
      checkpoint.throughLayoutRevision !==
        `wl:v1:${checkpoint.throughSequence}:${checkpoint.throughContentHash}`
    )
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has an invalid history checkpoint`,
      );
  }
  let previousChainHash = checkpoint?.evidenceHash ?? EMPTY_EVIDENCE_HASH;
  for (const [index, revision] of revisions.entries()) {
    const row = orderedRows[index]!;
    const expectedSequence = (checkpoint?.throughSequence ?? -1) + index + 1;
    if (revision.worldId !== worldId || revision.sequence !== expectedSequence)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has a missing or foreign revision at sequence ${expectedSequence}`,
      );
    const previous = revisions[index - 1];
    const expectedParentHash =
      previous?.document.revision.contentHash ??
      checkpoint?.throughContentHash ??
      null;
    if (revision.document.revision.parentHash !== expectedParentHash)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has an invalid parent chain at sequence ${revision.sequence}`,
      );
    const expectedSeed = previous?.document.seed ?? checkpoint?.seed;
    if (expectedSeed !== undefined && revision.document.seed !== expectedSeed)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} changes its immutable seed at sequence ${revision.sequence}`,
      );
    const expectedChainHash = repositoryChainHash(previousChainHash, revision);
    if (
      row.chainHash !== expectedChainHash &&
      !(allowMissingRepositoryChain && row.chainHash === undefined)
    )
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has an invalid repository chain at sequence ${revision.sequence}`,
      );
    previousChainHash = expectedChainHash;
  }
  if (head === undefined) {
    if (revisions.length !== 0 || checkpoint !== undefined)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} has revision history or evidence without a head`,
      );
    return revisions;
  }
  const current = revisions.at(-1);
  if (
    head.worldId !== worldId ||
    current === undefined ||
    head.sequence !== current.sequence ||
    head.layoutRevision !== current.layoutRevision ||
    (head.chainHash !== previousChainHash &&
      !(allowMissingRepositoryChain && head.chainHash === undefined))
  )
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} head does not match immutable history`,
    );
  return revisions;
}

async function upgradeCurrentRepositoryChain(
  database: WorldLayoutDatabase,
  worldId: string,
  head: WorldLayoutHeadRow | undefined,
  rows: readonly WorldLayoutRevisionRow[],
  checkpoint: WorldLayoutCheckpointRow | undefined,
): Promise<WorldLayoutStoredRows> {
  if (head === undefined)
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} has current revisions without a head`,
    );
  const missingRows = rows.filter((row) => row.chainHash === undefined).length;
  const missingHead = head.chainHash === undefined;
  if (missingRows === 0 && !missingHead) return { head, rows, checkpoint };
  if (missingRows !== rows.length || !missingHead)
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} has a partial repository-chain upgrade`,
    );

  const revisions = validateHistory(worldId, rows, head, checkpoint, true);
  const orderedRows = rows.slice().sort((a, b) => a.sequence - b.sequence);
  let previousChainHash = checkpoint?.evidenceHash ?? EMPTY_EVIDENCE_HASH;
  const upgradedRows = orderedRows.map((row, index) => {
    const chainHash = repositoryChainHash(previousChainHash, revisions[index]!);
    previousChainHash = chainHash;
    return { ...row, chainHash };
  });
  const upgradedHead: WorldLayoutHeadRow = {
    ...head,
    chainHash: previousChainHash,
  };
  // Verification and construction finish before the first write. Both writes share the caller's
  // rw transaction, preserving the old v1/v2 row/head bytes if any validation or put fails.
  await database.revisions.bulkPut(upgradedRows);
  await database.heads.put(upgradedHead);
  return {
    head: upgradedHead,
    rows: upgradedRows,
    checkpoint,
  };
}

async function upgradeStoredRows(
  database: WorldLayoutDatabase,
  worldId: string,
  head: WorldLayoutHeadRow | undefined,
  rows: readonly WorldLayoutRevisionRow[],
  checkpoint: WorldLayoutCheckpointRow | undefined,
): Promise<WorldLayoutStoredRows> {
  if (rows.length === 0) return { head, rows, checkpoint };
  const versions = rows.map(storedSchemaVersion);
  if (versions.every((version) => version === WORLD_LAYOUT_SCHEMA_VERSION))
    return upgradeCurrentRepositoryChain(
      database,
      worldId,
      head,
      rows,
      checkpoint,
    );
  if (checkpoint !== undefined)
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} mixes a current checkpoint with legacy rows`,
    );
  if (
    versions.every(
      (version) => version === WORLD_LAYOUT_LEGACY_NUMERIC_SCHEMA_VERSION,
    )
  )
    return upgradeLegacyNumericHistory(database, worldId, head, rows);
  if (versions.every((version) => version === WORLD_LAYOUT_V0_SCHEMA_VERSION))
    return upgradeRecoverableV0(database, worldId, head, rows);
  throw new WorldLayoutStoreCorruptionError(
    `Stored world layout ${worldId} has mixed or unsupported schema versions`,
  );
}

async function compactValidatedHistory(
  database: WorldLayoutDatabase,
  worldId: string,
  stored: WorldLayoutStoredRows,
  maximumRetainedSnapshots: number,
): Promise<WorldLayoutStoredRows> {
  const revisions = validateHistory(
    worldId,
    stored.rows,
    stored.head,
    stored.checkpoint,
  );
  if (stored.rows.length <= maximumRetainedSnapshots) return stored;

  const pruneCount = stored.rows.length - maximumRetainedSnapshots;
  const orderedRows = stored.rows
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  const pruned = revisions.slice(0, pruneCount);
  let checkpoint = stored.checkpoint;
  for (const [index, revision] of pruned.entries()) {
    const evidenceHash = orderedRows[index]?.chainHash;
    if (evidenceHash === undefined)
      throw new WorldLayoutStoreCorruptionError(
        `Stored world layout ${worldId} cannot checkpoint a revision without repository evidence`,
      );
    checkpoint = {
      worldId,
      throughSequence: revision.sequence,
      throughLayoutRevision: revision.layoutRevision,
      throughContentHash: revision.document.revision.contentHash,
      evidenceHash,
      seed: revision.document.seed,
    };
  }
  if (checkpoint === undefined)
    throw new WorldLayoutStoreCorruptionError(
      `Stored world layout ${worldId} could not construct its history checkpoint`,
    );
  await database.revisions.bulkDelete(
    orderedRows.slice(0, pruneCount).map((row) => [row.worldId, row.sequence]),
  );
  await database.checkpoints.put(checkpoint);
  const compacted: WorldLayoutStoredRows = {
    head: stored.head,
    rows: orderedRows.slice(pruneCount),
    checkpoint,
  };
  validateHistory(worldId, compacted.rows, compacted.head, checkpoint);
  return compacted;
}

async function prepareStoredHistory(
  database: WorldLayoutDatabase,
  worldId: string,
  head: WorldLayoutHeadRow | undefined,
  rows: readonly WorldLayoutRevisionRow[],
  checkpoint: WorldLayoutCheckpointRow | undefined,
  maximumRetainedSnapshots: number,
): Promise<WorldLayoutStoredRows> {
  const upgraded = await upgradeStoredRows(
    database,
    worldId,
    head,
    rows,
    checkpoint,
  );
  return compactValidatedHistory(
    database,
    worldId,
    upgraded,
    maximumRetainedSnapshots,
  );
}

/**
 * IndexedDB repository for immutable authored world-layout revisions within the
 * configured rollback window, plus a cumulative checkpoint for pruned evidence.
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
    this.maxRollbackDepth = boundedRollbackDepth(
      options.maxRollbackDepth ?? DEFAULT_MAX_ROLLBACK_DEPTH,
    );
    this.database = new WorldLayoutDatabase(
      options.databaseName ?? DEFAULT_DATABASE_NAME,
      { indexedDB, IDBKeyRange },
    );
  }

  async close(): Promise<void> {
    this.database.close();
  }

  private async readPreparedHistory(worldId: string): Promise<{
    revisions: readonly StoredWorldLayoutRevision[];
    checkpoint: WorldLayoutCheckpointRow | undefined;
  }> {
    return this.database.transaction(
      "rw",
      this.database.heads,
      this.database.revisions,
      this.database.checkpoints,
      async () => {
        const [head, rows, checkpoint] = await Promise.all([
          this.database.heads.get(worldId),
          this.database.revisions.where("worldId").equals(worldId).toArray(),
          this.database.checkpoints.get(worldId),
        ]);
        const prepared = await prepareStoredHistory(
          this.database,
          worldId,
          head,
          rows,
          checkpoint,
          this.maxRollbackDepth + 1,
        );
        return {
          revisions: validateHistory(
            worldId,
            prepared.rows,
            prepared.head,
            prepared.checkpoint,
          ),
          checkpoint: prepared.checkpoint,
        };
      },
    );
  }

  private async readValidatedHistory(
    worldId: string,
  ): Promise<readonly StoredWorldLayoutRevision[]> {
    return (await this.readPreparedHistory(worldId)).revisions;
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

  /** Constant-size cryptographic evidence for full snapshots older than rollback retention. */
  async historyEvidence(
    worldId: string,
  ): Promise<WorldLayoutHistoryEvidence | null> {
    const { checkpoint } = await this.readPreparedHistory(
      requiredWorldId(worldId),
    );
    if (checkpoint === undefined) return null;
    const { seed: _seed, ...evidence } = checkpoint;
    return evidence;
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
      this.database.checkpoints,
      async () => {
        const [head, rows, checkpoint] = await Promise.all([
          this.database.heads.get(worldId),
          this.database.revisions.where("worldId").equals(worldId).toArray(),
          this.database.checkpoints.get(worldId),
        ]);
        const prepared = await prepareStoredHistory(
          this.database,
          worldId,
          head,
          rows,
          checkpoint,
          this.maxRollbackDepth + 1,
        );
        const revisions = validateHistory(
          worldId,
          prepared.rows,
          prepared.head,
          prepared.checkpoint,
        );
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
          revision: current?.document.revision ?? {
            number: 0,
            parentHash: null,
          },
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

        return this.append(
          worldId,
          current?.sequence ?? -1,
          retainedTailChainHash(prepared),
          candidate,
        );
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
      this.database.checkpoints,
      async () => {
        const [head, rows, checkpoint] = await Promise.all([
          this.database.heads.get(worldId),
          this.database.revisions.where("worldId").equals(worldId).toArray(),
          this.database.checkpoints.get(worldId),
        ]);
        const prepared = await prepareStoredHistory(
          this.database,
          worldId,
          head,
          rows,
          checkpoint,
          this.maxRollbackDepth + 1,
        );
        const revisions = validateHistory(
          worldId,
          prepared.rows,
          prepared.head,
          prepared.checkpoint,
        );
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
        if (target === undefined) {
          const targetSequence = /^wl:v1:(\d+):[0-9a-f]{64}$/.exec(
            targetLayoutRevision,
          )?.[1];
          if (
            targetSequence !== undefined &&
            prepared.checkpoint !== undefined &&
            Number(targetSequence) <= prepared.checkpoint.throughSequence
          )
            throw new WorldLayoutRollbackRangeError(
              current.sequence - Number(targetSequence),
              this.maxRollbackDepth,
            );
          throw new RangeError(
            `World ${worldId} does not contain revision ${targetLayoutRevision}`,
          );
        }
        const depth = current.sequence - target.sequence;
        if (depth < 0)
          throw new WorldLayoutStoreCorruptionError(
            `Rollback target ${targetLayoutRevision} is ahead of the active revision`,
          );
        if (depth > this.maxRollbackDepth)
          throw new WorldLayoutRollbackRangeError(depth, this.maxRollbackDepth);
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
        return this.append(
          worldId,
          current.sequence,
          retainedTailChainHash(prepared),
          candidate,
        );
      },
    );
  }

  private async append(
    worldId: string,
    previousSequence: number,
    previousChainHash: string,
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
    const chainHash = repositoryChainHash(previousChainHash, revision);
    await this.database.revisions.add({
      worldId,
      sequence,
      layoutRevision: revision.layoutRevision,
      serializedDocument,
      chainHash,
    });
    await this.database.heads.put({
      worldId,
      sequence,
      layoutRevision: revision.layoutRevision,
      chainHash,
    });
    const [head, rows, checkpoint] = await Promise.all([
      this.database.heads.get(worldId),
      this.database.revisions.where("worldId").equals(worldId).toArray(),
      this.database.checkpoints.get(worldId),
    ]);
    await compactValidatedHistory(
      this.database,
      worldId,
      { head, rows, checkpoint },
      this.maxRollbackDepth + 1,
    );
    return { status: "saved", revision };
  }

  /** Delete one world's head and immutable history; never affects another world. */
  async deleteWorld(worldId: string): Promise<void> {
    requiredWorldId(worldId);
    await this.database.transaction(
      "rw",
      this.database.heads,
      this.database.revisions,
      this.database.checkpoints,
      async () => {
        await this.database.revisions.where("worldId").equals(worldId).delete();
        await this.database.heads.delete(worldId);
        await this.database.checkpoints.delete(worldId);
      },
    );
  }

  /** Explicitly world-scoped alias for callers that use clear terminology. */
  async clearWorld(worldId: string): Promise<void> {
    await this.deleteWorld(worldId);
  }
}
