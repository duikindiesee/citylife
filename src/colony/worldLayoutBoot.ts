import { applyWorldLayoutDocument } from "./spatial/worldLayoutAdapter";
import {
  parseWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
} from "./spatial/worldLayoutDocument";
import type {
  StoredWorldLayoutRevision,
  WorldLayoutSaveInput,
  WorldLayoutSaveResult,
} from "./worldLayoutStore";

export interface WorldLayoutBootStore {
  load(worldId: string): Promise<StoredWorldLayoutRevision | null>;
  save(
    input: WorldLayoutSaveInput,
    expectedLayoutRevision: string | null,
  ): Promise<WorldLayoutSaveResult>;
}

/**
 * The runtime side of the boot barrier. Implementations should use the world-layout adapter for
 * both methods, and `hydrateWorldLayout` must commit its already-validated candidate atomically.
 */
export interface WorldLayoutBootRuntime {
  captureWorldLayout(): WorldLayoutDocument | Promise<WorldLayoutDocument>;
  hydrateWorldLayout(document: WorldLayoutDocument): void | Promise<void>;
}

export interface RemoteStarterCatalogueManifest {
  worldId: string;
  layoutRevision: string;
  layout: WorldLayoutDocument;
  [key: string]: any;
}

export interface RemoteWorldLayoutLoader {
  loadRemoteStarterCatalogue(worldId: string): Promise<{
    published: boolean;
    manifest: RemoteStarterCatalogueManifest;
  } | null>;
}

export interface WorldLayoutBootOptions {
  readonly worldId: string;
  readonly store: WorldLayoutBootStore;
  readonly runtime: WorldLayoutBootRuntime;
  readonly remoteLoader?: RemoteWorldLayoutLoader;
  readonly requireRemoteAuthority?: boolean;
}

export interface WorldLayoutBootResult {
  readonly ready: true;
  readonly worldId: string;
  readonly revision: string;
  readonly source: "stored" | "initialized" | "canonical_remote";
}

export class WorldLayoutBootError extends Error {
  constructor(
    readonly code:
      | "WORLD_ID_MISMATCH"
      | "REVISION_MISMATCH"
      | "CONFLICT_WITHOUT_HEAD"
      | "WORLD_UNPUBLISHED"
      | "CANONICAL_REMOTE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "WorldLayoutBootError";
  }
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

function validateRevision(
  worldId: string,
  stored: StoredWorldLayoutRevision,
): StoredWorldLayoutRevision {
  const document = parseWorldLayoutDocument(JSON.stringify(stored.document));
  if (stored.worldId !== worldId || document.worldId !== worldId)
    throw new WorldLayoutBootError(
      "WORLD_ID_MISMATCH",
      `World layout ${stored.worldId}/${document.worldId} cannot boot world ${worldId}`,
    );
  const revision = worldLayoutRevisionId(document.revision);
  if (
    stored.layoutRevision !== revision ||
    stored.sequence !== document.revision.number
  )
    throw new WorldLayoutBootError(
      "REVISION_MISMATCH",
      `World layout ${worldId} has inconsistent revision metadata`,
    );
  return { ...stored, document };
}

function abortError(): DOMException {
  return new DOMException("World layout boot wait was aborted", "AbortError");
}

function waitForAttempt<T>(
  attempt: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return attempt;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    attempt
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * One-shot barrier between deterministic runtime construction and `runtime.start()`.
 *
 * The coordinator deliberately has no start method. Callers may start rendering/simulation only
 * after `boot()` resolves with `ready: true`. Repeated and concurrent calls share one attempt,
 * which makes React StrictMode effect replay safe. A failed attempt is forgotten so an explicit
 * retry can re-read durable truth.
 *
 * Aborting a caller only abandons that caller's wait. The shared persistence/hydration attempt is
 * allowed to finish so another StrictMode invocation cannot observe a half-initialized barrier.
 */
export class WorldLayoutBootCoordinator {
  private readonly worldId: string;
  private readonly store: WorldLayoutBootStore;
  private readonly runtime: WorldLayoutBootRuntime;
  private readonly remoteLoader?: RemoteWorldLayoutLoader;
  private readonly requireRemoteAuthority?: boolean;
  private attempt?: Promise<WorldLayoutBootResult>;
  private attemptSettled = true;

  constructor(options: WorldLayoutBootOptions) {
    this.worldId = requiredWorldId(options.worldId);
    this.store = options.store;
    this.runtime = options.runtime;
    this.remoteLoader = options.remoteLoader;
    this.requireRemoteAuthority = options.requireRemoteAuthority;
  }

  boot(signal?: AbortSignal): Promise<WorldLayoutBootResult> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.attempt === undefined) {
      this.attemptSettled = false;
      const attempt = this.run().then(
        (result) => {
          if (this.attempt === attempt) this.attemptSettled = true;
          return result;
        },
        (error: unknown) => {
          if (this.attempt === attempt) {
            this.attempt = undefined;
            this.attemptSettled = true;
          }
          throw error;
        },
      );
      this.attempt = attempt;
    }
    return waitForAttempt(this.attempt, signal);
  }

  /**
   * Forget a completed boot so the next call re-reads the durable head. Import and rollback use
   * this only after their CAS transaction commits and before restarting the runtime boot barrier.
   * Refusing to invalidate an active attempt prevents two hydrations from racing each other.
   */
  invalidateCompletedAttempt(): void {
    if (this.attempt !== undefined && !this.attemptSettled)
      throw new Error("Cannot invalidate an active world layout boot attempt");
    this.attempt = undefined;
    this.attemptSettled = true;
  }

  private async run(): Promise<WorldLayoutBootResult> {
    if (this.remoteLoader) {
      try {
        const remote = await this.remoteLoader.loadRemoteStarterCatalogue(this.worldId);
        if (remote) {
          if (!remote.published) {
            throw new WorldLayoutBootError(
              "WORLD_UNPUBLISHED",
              `World ${this.worldId} starter catalogue returned published=false`,
            );
          }
          const manifest = remote.manifest;
          if (!manifest || typeof manifest !== "object") {
            throw new WorldLayoutBootError(
              "WORLD_UNPUBLISHED",
              `World ${this.worldId} starter catalogue manifest is missing or malformed`,
            );
          }
          if (manifest.worldId !== this.worldId) {
            throw new WorldLayoutBootError(
              "WORLD_ID_MISMATCH",
              `Remote starter catalogue ${manifest.worldId} does not match world ${this.worldId}`,
            );
          }
          const document = parseWorldLayoutDocument(JSON.stringify(manifest.layout));
          if (document.worldId !== this.worldId) {
            throw new WorldLayoutBootError(
              "WORLD_ID_MISMATCH",
              `Remote layout document ${document.worldId} does not match world ${this.worldId}`,
            );
          }
          const revision = worldLayoutRevisionId(document.revision);
          if (manifest.layoutRevision !== document.revision.contentHash) {
            throw new WorldLayoutBootError(
              "REVISION_MISMATCH",
              `Manifest layoutRevision ${manifest.layoutRevision} does not match document contentHash ${document.revision.contentHash}`,
            );
          }
          applyWorldLayoutDocument(document);

          const head = await this.store.load(this.worldId);
          await this.store.save(saveInput(document), head?.layoutRevision ?? null);
          await this.runtime.hydrateWorldLayout(document);
          return {
            ready: true,
            worldId: this.worldId,
            revision,
            source: "canonical_remote",
          };
        } else if (this.requireRemoteAuthority) {
          throw new WorldLayoutBootError(
            "WORLD_UNPUBLISHED",
            `World ${this.worldId} starter catalogue is unpublished (404)`,
          );
        }
      } catch (err: unknown) {
        if (
          this.requireRemoteAuthority ||
          (err instanceof WorldLayoutBootError &&
            (err.code === "WORLD_UNPUBLISHED" ||
              err.code === "WORLD_ID_MISMATCH" ||
              err.code === "REVISION_MISMATCH"))
        ) {
          throw err;
        }
        console.warn(
          `[WorldLayoutBoot] Remote authority unavailable, preserving local stored head:`,
          err,
        );
      }
    }

    const head = await this.store.load(this.worldId);
    if (head !== null) return this.hydrate(head, "stored");

    const captured = parseWorldLayoutDocument(
      JSON.stringify(await this.runtime.captureWorldLayout()),
    );
    if (captured.worldId !== this.worldId)
      throw new WorldLayoutBootError(
        "WORLD_ID_MISMATCH",
        `Captured world layout ${captured.worldId} cannot initialize world ${this.worldId}`,
      );

    // Exercise the exact adapter validation used by hydration before opening the persistence
    // transaction. A malformed legacy way/road/reference candidate can therefore neither mutate
    // the runtime nor strand an unusable first head in IndexedDB.
    applyWorldLayoutDocument(captured);

    const result = await this.store.save(saveInput(captured), null);
    if (result.status === "saved")
      return this.hydrate(result.revision, "initialized");
    if (result.status === "noop")
      return this.hydrate(result.revision, "stored");

    const concurrentHead = await this.store.load(this.worldId);
    if (concurrentHead === null)
      throw new WorldLayoutBootError(
        "CONFLICT_WITHOUT_HEAD",
        `World layout ${this.worldId} conflicted during initialization without a durable head`,
      );
    if (
      result.actualLayoutRevision !== null &&
      concurrentHead.layoutRevision !== result.actualLayoutRevision
    )
      throw new WorldLayoutBootError(
        "REVISION_MISMATCH",
        `World layout ${this.worldId} changed while resolving its initialization conflict`,
      );
    return this.hydrate(concurrentHead, "stored");
  }

  private async hydrate(
    stored: StoredWorldLayoutRevision,
    source: WorldLayoutBootResult["source"],
  ): Promise<WorldLayoutBootResult> {
    const validated = validateRevision(this.worldId, stored);
    await this.runtime.hydrateWorldLayout(validated.document);
    return {
      ready: true,
      worldId: this.worldId,
      revision: validated.layoutRevision,
      source,
    };
  }
}
