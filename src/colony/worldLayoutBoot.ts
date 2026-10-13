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
import {
  type CanonicalTransitAuthority,
  canonicalTransitMatches,
  validateCanonicalTransitAuthority,
} from "./transit/canonicalTransit";

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
  hydrateWorldLayout(document: WorldLayoutDocument): unknown | Promise<unknown>;
  exportCanonicalTransitAuthority?(document?: WorldLayoutDocument): CanonicalTransitAuthority | null;
  setStarterCatalogueManifest?(manifest: RemoteStarterCatalogueManifest | null): void;
}

export interface RemoteStarterCatalogueManifest {
  worldId: string;
  layoutRevision: string;
  layout: WorldLayoutDocument;
  transit?: CanonicalTransitAuthority | null;
  walkability?: unknown;
  physicalColliders?: unknown;
  plots?: any[];
  [key: string]: any;
}

/**
 * Strict fail-closed extraction of known authoritative neighbourhood keys from a published
 * starter catalogue manifest, following User #243 / Server 421 worldAuthorityClient semantics.
 * Returns deterministically sorted array of unique neighbourhood keys.
 */
export function extractAuthoritativeNeighbourhoodKeys(
  manifest: RemoteStarterCatalogueManifest | null | undefined,
): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const keys = new Set<string>();
  if (Array.isArray(manifest.plots)) {
    for (const plot of manifest.plots) {
      const key =
        (typeof plot?.geometry?.neighbourhoodKey === "string"
          ? plot.geometry.neighbourhoodKey
          : null) ??
        (typeof plot?.neighbourhoodKey === "string"
          ? plot.neighbourhoodKey
          : null);
      if (typeof key === "string" && key.trim().length > 0) {
        keys.add(key.trim());
      }
    }
  }
  return Array.from(keys).sort();
}

export interface AuthoritativeManifestValidationResult {
  valid: boolean;
  keys: string[];
  error?: string;
  reason?: string;
}

/**
 * Validates the wire identity binding of a RemoteStarterCatalogueManifest against an
 * active WorldLayoutDocument.
 *
 * Rules:
 * - Manifest must be a non-null object.
 * - Active layout must be a non-null object.
 * - Wire worldId must match: manifest.worldId === activeLayout.worldId and manifest.layout.worldId === activeLayout.worldId.
 * - Wire layoutRevision must match activeLayout.revision.contentHash.
 * - Full wire layout revision object (number, contentHash, parentHash) must match activeLayout.revision.
 * - Plots must define at least one valid, non-empty neighbourhood key (Server 421 fail-closed rule).
 */
export function validateAuthoritativeStarterManifest(
  manifest: RemoteStarterCatalogueManifest | null | undefined,
  activeLayout: WorldLayoutDocument | null | undefined,
): AuthoritativeManifestValidationResult {
  if (!manifest || typeof manifest !== "object") {
    return {
      valid: false,
      keys: [],
      error: "MISSING_MANIFEST",
      reason: "Starter catalogue manifest is absent or not an object",
    };
  }
  if (!activeLayout || typeof activeLayout !== "object" || !activeLayout.revision) {
    return {
      valid: false,
      keys: [],
      error: "NO_ACTIVE_LAYOUT",
      reason: "Active world layout document is absent or uncommitted",
    };
  }
  if (
    typeof manifest.worldId !== "string" ||
    manifest.worldId.trim().length === 0 ||
    manifest.worldId !== activeLayout.worldId
  ) {
    return {
      valid: false,
      keys: [],
      error: "WORLD_ID_MISMATCH",
      reason: `Manifest worldId (${manifest.worldId}) does not match active layout worldId (${activeLayout.worldId})`,
    };
  }
  if (!manifest.layout || typeof manifest.layout !== "object") {
    return {
      valid: false,
      keys: [],
      error: "MISSING_MANIFEST_LAYOUT",
      reason: "Manifest layout document is missing",
    };
  }
  const innerLayoutId =
    typeof (manifest.layout as any).worldId === "string"
      ? (manifest.layout as any).worldId
      : typeof (manifest.layout as any).layoutId === "string"
        ? (manifest.layout as any).layoutId
        : null;
  if (innerLayoutId !== null && innerLayoutId !== activeLayout.worldId) {
    return {
      valid: false,
      keys: [],
      error: "WORLD_ID_MISMATCH",
      reason: `Manifest inner layout id (${innerLayoutId}) does not match active layout worldId (${activeLayout.worldId})`,
    };
  }
  if (
    typeof manifest.layoutRevision !== "string" ||
    manifest.layoutRevision !== activeLayout.revision.contentHash
  ) {
    return {
      valid: false,
      keys: [],
      error: "REVISION_HASH_MISMATCH",
      reason: `Manifest layoutRevision (${manifest.layoutRevision}) does not match active contentHash (${activeLayout.revision.contentHash})`,
    };
  }
  if (
    typeof manifest.sourceLayoutRevision === "string" &&
    manifest.sourceLayoutRevision !== activeLayout.revision.parentHash
  ) {
    return {
      valid: false,
      keys: [],
      error: "PARENT_REVISION_HASH_MISMATCH",
      reason: `Manifest sourceLayoutRevision (${manifest.sourceLayoutRevision}) does not match active parentHash (${activeLayout.revision.parentHash})`,
    };
  }
  const rev = manifest.layout.revision;
  if (!rev || typeof rev !== "object") {
    return {
      valid: false,
      keys: [],
      error: "MISSING_MANIFEST_REVISION",
      reason: "Manifest inner layout is missing revision object",
    };
  }
  if (
    typeof rev.number !== "number" ||
    !Number.isSafeInteger(rev.number) ||
    typeof rev.contentHash !== "string" ||
    (typeof rev.parentHash !== "string" && rev.parentHash !== null)
  ) {
    return {
      valid: false,
      keys: [],
      error: "MALFORMED_MANIFEST_REVISION",
      reason:
        "Manifest revision object fields are missing or non-string/non-number",
    };
  }
  if (
    rev.number !== activeLayout.revision.number ||
    rev.contentHash !== activeLayout.revision.contentHash ||
    rev.parentHash !== activeLayout.revision.parentHash
  ) {
    const parentSlice = activeLayout.revision.parentHash
      ? activeLayout.revision.parentHash.slice(0, 8)
      : "null";
    const revParentSlice = rev.parentHash ? rev.parentHash.slice(0, 8) : "null";
    return {
      valid: false,
      keys: [],
      error: "REVISION_WIRE_IDENTITY_MISMATCH",
      reason: `Manifest revision (${rev.number}:${rev.contentHash.slice(0, 8)}:p${revParentSlice}) does not match active layout revision (${activeLayout.revision.number}:${activeLayout.revision.contentHash.slice(0, 8)}:p${parentSlice})`,
    };
  }

  const keys = extractAuthoritativeNeighbourhoodKeys(manifest);
  if (keys.length === 0) {
    return {
      valid: false,
      keys: [],
      error: "NO_NEIGHBOURHOOD_KEYS",
      reason: "Manifest plots define no valid neighbourhoodKey",
    };
  }

  return { valid: true, keys };
}

export interface RemoteWorldLayoutLoader {
  loadRemoteStarterCatalogue(worldId: string): Promise<{
    published: boolean;
    manifest: RemoteStarterCatalogueManifest;
  } | null>;
}

export interface HttpRemoteWorldLayoutLoaderOptions {
  baseUrl?: string;
  getToken?: () => Promise<string | null> | string | null;
  timeoutMs?: number;
}

export class HttpRemoteWorldLayoutLoader implements RemoteWorldLayoutLoader {
  private readonly baseUrl: string;
  private readonly getToken?: () => Promise<string | null> | string | null;
  private readonly timeoutMs: number;

  constructor(options?: HttpRemoteWorldLayoutLoaderOptions) {
    this.baseUrl = (options?.baseUrl !== undefined && options.baseUrl !== ""
      ? options.baseUrl
      : "/kooker"
    ).replace(/\/+$/, "");
    this.getToken = options?.getToken;
    this.timeoutMs = options?.timeoutMs ?? 5000;
  }

  async loadRemoteStarterCatalogue(worldId: string): Promise<{
    published: boolean;
    manifest: RemoteStarterCatalogueManifest;
  } | null> {
    const token = this.getToken ? await this.getToken() : null;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Cache-Control": "no-store",
    };
    if (token) {
      headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}/api/v1/citylife/worlds/${encodeURIComponent(worldId)}/starter-catalogue`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Remote starter catalogue fetch failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data || typeof data !== "object") {
        throw new Error("Invalid remote starter catalogue response");
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface WorldLayoutBootOptions {
  readonly worldId: string;
  readonly store: WorldLayoutBootStore;
  readonly runtime: WorldLayoutBootRuntime;
  readonly remoteLoader?: RemoteWorldLayoutLoader;
  readonly requireRemoteAuthority?: boolean;
  readonly requireTransitAuthority?: boolean;
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
      | "CANONICAL_REMOTE_UNAVAILABLE"
      | "CANONICAL_TRANSIT_UNAVAILABLE"
      | "PERSISTENCE_CONFLICT",
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

interface RuntimeCoordinatorOwner {
  activeCoordinator: WorldLayoutBootCoordinator;
  worldId: string;
  generation: number;
}

const runtimeOwnerRegistry = new WeakMap<object, RuntimeCoordinatorOwner>();
let nextBootGeneration = 1;

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
  private readonly requireTransitAuthority?: boolean;
  private attempt?: Promise<WorldLayoutBootResult>;
  private attemptSettled = true;
  private generation = 0;

  constructor(options: WorldLayoutBootOptions) {
    this.worldId = requiredWorldId(options.worldId);
    this.store = options.store;
    this.runtime = options.runtime;
    this.remoteLoader = options.remoteLoader;
    this.requireRemoteAuthority = options.requireRemoteAuthority;
    this.requireTransitAuthority = options.requireTransitAuthority;
    if (typeof this.runtime === "object" && this.runtime !== null) {
      this.generation = nextBootGeneration++;
      runtimeOwnerRegistry.set(this.runtime, {
        activeCoordinator: this,
        worldId: this.worldId,
        generation: this.generation,
      });
    }
  }

  private isSuperseded(): boolean {
    if (typeof this.runtime === "object" && this.runtime !== null) {
      const current = runtimeOwnerRegistry.get(this.runtime);
      if (
        current &&
        (current.activeCoordinator !== this ||
          current.worldId !== this.worldId ||
          current.generation !== this.generation)
      ) {
        return true;
      }
    }
    return false;
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
    if (typeof this.runtime === "object" && this.runtime !== null) {
      this.runtime.setStarterCatalogueManifest?.(null);
      this.generation = nextBootGeneration++;
      runtimeOwnerRegistry.set(this.runtime, {
        activeCoordinator: this,
        worldId: this.worldId,
        generation: this.generation,
      });
    }
  }

  private async run(): Promise<WorldLayoutBootResult> {
    if (this.requireRemoteAuthority && !this.remoteLoader) {
      throw new WorldLayoutBootError(
        "WORLD_UNPUBLISHED",
        `World ${this.worldId} requires remote authority, but no remoteLoader was configured`,
      );
    }

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

          if (this.requireTransitAuthority && !manifest.transit) {
            throw new WorldLayoutBootError(
              "CANONICAL_TRANSIT_UNAVAILABLE",
              `Remote starter catalogue lacks required transit authority companion for world ${this.worldId}`,
            );
          }

          if (manifest.transit) {
            const transitValidation = validateCanonicalTransitAuthority(
              manifest.transit,
              this.worldId,
              document.revision.contentHash,
            );
            if (!transitValidation.valid) {
              throw new WorldLayoutBootError(
                "CANONICAL_TRANSIT_UNAVAILABLE",
                `Remote starter catalogue transit authority validation failed: ${transitValidation.message ?? transitValidation.error}`,
              );
            }
          }

          applyWorldLayoutDocument(document);

          // Atomic validation: verify adopted transit semantics against incoming manifest before persistent save or mutating active world
          if (manifest.transit) {
            if (!this.runtime.exportCanonicalTransitAuthority) {
              throw new WorldLayoutBootError(
                "CANONICAL_TRANSIT_UNAVAILABLE",
                `Remote starter catalogue transit authority requires semantic validation runtime support`,
              );
            }
            const adopted = this.runtime.exportCanonicalTransitAuthority(document);
            if (!adopted || !canonicalTransitMatches(adopted, manifest.transit)) {
              throw new WorldLayoutBootError(
                "CANONICAL_TRANSIT_UNAVAILABLE",
                `Remote starter catalogue transit authority does not match physically validated runtime transit`,
              );
            }
          }

          if (this.isSuperseded()) {
            return {
              ready: true,
              worldId: this.worldId,
              revision,
              source: "canonical_remote",
            };
          }

          const head = await this.store.load(this.worldId);
          if (this.isSuperseded()) {
            return {
              ready: true,
              worldId: this.worldId,
              revision,
              source: "canonical_remote",
            };
          }
          const saveResult = await this.store.save(
            saveInput(document),
            head?.layoutRevision ?? null,
          );
          if (this.isSuperseded()) {
            return {
              ready: true,
              worldId: this.worldId,
              revision,
              source: "canonical_remote",
            };
          }
          if (saveResult.status === "conflict") {
            throw new WorldLayoutBootError(
              "PERSISTENCE_CONFLICT",
              `Remote starter catalogue for world ${this.worldId} conflicted with concurrent stored layout revision ${saveResult.actualLayoutRevision}`,
            );
          }
          this.runtime.setStarterCatalogueManifest?.(manifest);
          try {
            await this.runtime.hydrateWorldLayout(document);
          } catch (hydrateError: unknown) {
            this.runtime.setStarterCatalogueManifest?.(null);
            throw hydrateError;
          }

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
              err.code === "REVISION_MISMATCH" ||
              err.code === "CANONICAL_TRANSIT_UNAVAILABLE" ||
              err.code === "PERSISTENCE_CONFLICT"))
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
    if (head !== null) {
      this.runtime.setStarterCatalogueManifest?.(null);
      return this.hydrate(head, "stored");
    }

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

    if (this.isSuperseded()) {
      return {
        ready: true,
        worldId: this.worldId,
        revision: worldLayoutRevisionId(captured.revision),
        source: "initialized",
      };
    }

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
    if (!this.isSuperseded()) {
      await this.runtime.hydrateWorldLayout(validated.document);
    }
    return {
      ready: true,
      worldId: this.worldId,
      revision: validated.layoutRevision,
      source,
    };
  }
}
