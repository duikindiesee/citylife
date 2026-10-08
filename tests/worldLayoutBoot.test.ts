import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
} from "../src/colony/spatial/worldLayoutDocument";
import {
  WorldLayoutBootCoordinator,
  WorldLayoutBootError,
  HttpRemoteWorldLayoutLoader,
  type WorldLayoutBootRuntime,
  type WorldLayoutBootStore,
} from "../src/colony/worldLayoutBoot";
import type {
  StoredWorldLayoutRevision,
  WorldLayoutSaveInput,
  WorldLayoutSaveResult,
} from "../src/colony/worldLayoutStore";

const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
} as const;

function document(
  worldId = "primary",
  elevation?: number,
): WorldLayoutDocument {
  return createWorldLayoutDocument({
    worldId,
    seed: 4242,
    revision: { number: 0, parentHash: null },
    frames: [
      {
        id: `${worldId}:surface`,
        address: `spatial://citylife/${worldId}/surface`,
        kind: "region",
        layer: "surface",
        transform: IDENTITY,
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
              frameId: `${worldId}:surface`,
              cell: { x: 3, y: 4 },
              elevation,
            },
          ],
    portals: [],
  });
}

function stored(value = document()): StoredWorldLayoutRevision {
  return {
    worldId: value.worldId,
    sequence: value.revision.number,
    layoutRevision: worldLayoutRevisionId(value.revision),
    document: value,
  };
}

function runtime(captured = document()): WorldLayoutBootRuntime & {
  captureWorldLayout: Mock<WorldLayoutBootRuntime["captureWorldLayout"]>;
  hydrateWorldLayout: Mock<WorldLayoutBootRuntime["hydrateWorldLayout"]>;
} {
  return {
    captureWorldLayout: vi.fn<WorldLayoutBootRuntime["captureWorldLayout"]>(
      () => captured,
    ),
    hydrateWorldLayout: vi.fn<WorldLayoutBootRuntime["hydrateWorldLayout"]>(),
  };
}

function store(
  overrides: Partial<WorldLayoutBootStore> = {},
): WorldLayoutBootStore {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => {
      throw new Error("unexpected save");
    }),
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("WorldLayoutBootCoordinator", () => {
  it("loads, validates and hydrates the durable head without capturing seed state", async () => {
    const head = stored();
    const events: string[] = [];
    const bootRuntime = runtime();
    bootRuntime.hydrateWorldLayout.mockImplementation(() => {
      events.push("hydrate");
    });
    const bootStore = store({
      load: vi.fn(async () => {
        events.push("load");
        return head;
      }),
    });

    const result = await new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: bootStore,
      runtime: bootRuntime,
    }).boot();

    expect(result).toEqual({
      ready: true,
      worldId: "primary",
      revision: head.layoutRevision,
      source: "stored",
    });
    expect(events).toEqual(["load", "hydrate"]);
    expect(bootRuntime.captureWorldLayout).not.toHaveBeenCalled();
    expect(bootStore.save).not.toHaveBeenCalled();
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledWith(head.document);
  });

  it("captures deterministic pre-start state, persists it with null CAS and hydrates the saved head", async () => {
    const captured = document();
    const head = stored(captured);
    const events: string[] = [];
    const bootRuntime = runtime(captured);
    bootRuntime.captureWorldLayout.mockImplementation(() => {
      events.push("capture");
      return captured;
    });
    bootRuntime.hydrateWorldLayout.mockImplementation(() => {
      events.push("hydrate");
    });
    const save = vi.fn(
      async (
        input: WorldLayoutSaveInput,
        expected: string | null,
      ): Promise<WorldLayoutSaveResult> => {
        events.push("save");
        expect(expected).toBeNull();
        expect(input).not.toHaveProperty("revision");
        expect(input.worldId).toBe("primary");
        return { status: "saved", revision: head };
      },
    );
    const bootStore = store({
      load: vi.fn(async () => {
        events.push("load");
        return null;
      }),
      save,
    });

    const result = await new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: bootStore,
      runtime: bootRuntime,
    }).boot();

    expect(result.source).toBe("initialized");
    expect(result.revision).toBe(head.layoutRevision);
    expect(events).toEqual(["load", "capture", "save", "hydrate"]);
  });

  it("coalesces concurrent and repeated StrictMode boot calls", async () => {
    const pending = deferred<StoredWorldLayoutRevision | null>();
    const head = stored();
    const bootRuntime = runtime();
    const load = vi.fn(() => pending.promise);
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load }),
      runtime: bootRuntime,
    });

    const first = coordinator.boot();
    const second = coordinator.boot();
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(head);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    const thirdResult = await coordinator.boot();
    expect(firstResult).toBe(secondResult);
    expect(thirdResult).toBe(firstResult);
    expect(load).toHaveBeenCalledTimes(1);
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledTimes(1);
  });

  it("re-reads and hydrates a newly committed head after explicit invalidation", async () => {
    const first = stored(document("primary", 1));
    const changed = stored(document("primary", 2));
    const load = vi
      .fn<WorldLayoutBootStore["load"]>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(changed);
    const bootRuntime = runtime();
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load }),
      runtime: bootRuntime,
    });

    await expect(coordinator.boot()).resolves.toMatchObject({
      revision: first.layoutRevision,
    });
    coordinator.invalidateCompletedAttempt();
    await expect(coordinator.boot()).resolves.toMatchObject({
      revision: changed.layoutRevision,
    });

    expect(load).toHaveBeenCalledTimes(2);
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenNthCalledWith(
      1,
      first.document,
    );
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenNthCalledWith(
      2,
      changed.document,
    );
  });

  it("refuses to invalidate an active shared boot attempt", async () => {
    const pending = deferred<StoredWorldLayoutRevision | null>();
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load: vi.fn(() => pending.promise) }),
      runtime: runtime(),
    });

    const boot = coordinator.boot();
    expect(() => coordinator.invalidateCompletedAttempt()).toThrow(
      "active world layout boot attempt",
    );
    pending.resolve(stored());
    await expect(boot).resolves.toMatchObject({ ready: true });
  });

  it("loses an initialization race safely and hydrates the winning durable head", async () => {
    const captured = document("primary", 1);
    const winner = stored(document("primary", 2));
    const load = vi
      .fn<WorldLayoutBootStore["load"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const save = vi.fn(
      async (): Promise<WorldLayoutSaveResult> => ({
        status: "conflict",
        expectedLayoutRevision: null,
        actualLayoutRevision: winner.layoutRevision,
      }),
    );
    const bootRuntime = runtime(captured);

    const result = await new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load, save }),
      runtime: bootRuntime,
    }).boot();

    expect(result.source).toBe("stored");
    expect(result.revision).toBe(winner.layoutRevision);
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledWith(
      winner.document,
    );
  });

  it("rejects invalid durable revision metadata before hydration", async () => {
    const head = stored();
    const invalid = { ...head, sequence: 9 };
    const bootRuntime = runtime();
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load: vi.fn(async () => invalid) }),
      runtime: bootRuntime,
    });

    await expect(coordinator.boot()).rejects.toMatchObject({
      name: "WorldLayoutBootError",
      code: "REVISION_MISMATCH",
    });
    expect(bootRuntime.hydrateWorldLayout).not.toHaveBeenCalled();
  });

  it("rejects a captured layout for another world before persistence", async () => {
    const bootRuntime = runtime(document("other"));
    const bootStore = store();
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: bootStore,
      runtime: bootRuntime,
    });

    await expect(coordinator.boot()).rejects.toBeInstanceOf(
      WorldLayoutBootError,
    );
    await expect(coordinator.boot()).rejects.toMatchObject({
      code: "WORLD_ID_MISMATCH",
    });
    expect(bootStore.save).not.toHaveBeenCalled();
  });

  it("forgets a failed attempt so a retry can re-read and hydrate durable truth", async () => {
    const head = stored();
    const bootRuntime = runtime();
    bootRuntime.hydrateWorldLayout
      .mockRejectedValueOnce(new Error("atomic hydration rejected"))
      .mockResolvedValueOnce(undefined);
    const load = vi.fn(async () => head);
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load }),
      runtime: bootRuntime,
    });

    await expect(coordinator.boot()).rejects.toThrow(
      "atomic hydration rejected",
    );
    await expect(coordinator.boot()).resolves.toMatchObject({ ready: true });
    expect(load).toHaveBeenCalledTimes(2);
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledTimes(2);
  });

  it("lets an aborted StrictMode caller leave while the shared barrier completes for its successor", async () => {
    const pending = deferred<StoredWorldLayoutRevision | null>();
    const bootRuntime = {
      ...runtime(),
      start: vi.fn(),
    };
    const load = vi.fn(() => pending.promise);
    const coordinator = new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load }),
      runtime: bootRuntime,
    });
    const controller = new AbortController();

    const abandoned = coordinator.boot(controller.signal);
    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });

    const successor = coordinator.boot();
    pending.resolve(stored());
    await expect(successor).resolves.toMatchObject({ ready: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledTimes(1);
    expect(bootRuntime.start).not.toHaveBeenCalled();
  });

  describe("Canonical Remote Authority (Starter-Catalogue)", () => {
    it("boots and hydrates canonical remote starter catalogue document when published", async () => {
      const doc = document("primary");
      const bootRuntime = runtime();
      const mockSave = vi.fn(async () => ({ status: "saved", revision: stored(doc) } as const));
      const mockLoad = vi.fn(async () => null);

      const remoteLoader = {
        loadRemoteStarterCatalogue: vi.fn(async () => ({
          published: true,
          manifest: {
            worldId: "primary",
            layoutRevision: doc.revision.contentHash,
            layout: doc,
          },
        })),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store({ load: mockLoad, save: mockSave }),
        runtime: bootRuntime,
        remoteLoader,
        requireRemoteAuthority: true,
      });

      const result = await coordinator.boot();
      expect(result).toMatchObject({
        ready: true,
        worldId: "primary",
        revision: worldLayoutRevisionId(doc.revision),
        source: "canonical_remote",
      });
      expect(remoteLoader.loadRemoteStarterCatalogue).toHaveBeenCalledWith("primary");
      expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledWith(doc);
      expect(mockSave).toHaveBeenCalled();
    });

    it("fails closed with WORLD_UNPUBLISHED when remote authority returns unpublished and requireRemoteAuthority is true", async () => {
      const bootRuntime = runtime();
      const remoteLoader = {
        loadRemoteStarterCatalogue: vi.fn(async () => null),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store(),
        runtime: bootRuntime,
        remoteLoader,
        requireRemoteAuthority: true,
      });

      await expect(coordinator.boot()).rejects.toThrowError(WorldLayoutBootError);
      await expect(coordinator.boot()).rejects.toMatchObject({
        code: "WORLD_UNPUBLISHED",
      });
      expect(bootRuntime.hydrateWorldLayout).not.toHaveBeenCalled();
    });

    it("fails closed with WORLD_ID_MISMATCH when remote starter catalogue worldId contradicts coordinator", async () => {
      const doc = document("different-world");
      const bootRuntime = runtime();
      const remoteLoader = {
        loadRemoteStarterCatalogue: vi.fn(async () => ({
          published: true,
          manifest: {
            worldId: "different-world",
            layoutRevision: doc.revision.contentHash,
            layout: doc,
          },
        })),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store(),
        runtime: bootRuntime,
        remoteLoader,
      });

      await expect(coordinator.boot()).rejects.toMatchObject({
        code: "WORLD_ID_MISMATCH",
      });
      expect(bootRuntime.hydrateWorldLayout).not.toHaveBeenCalled();
    });

    it("fails closed with REVISION_MISMATCH when remote manifest layoutRevision contradicts document contentHash", async () => {
      const doc = document("primary");
      const bootRuntime = runtime();
      const remoteLoader = {
        loadRemoteStarterCatalogue: vi.fn(async () => ({
          published: true,
          manifest: {
            worldId: "primary",
            layoutRevision: "0".repeat(64), // Incorrect hash!
            layout: doc,
          },
        })),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store(),
        runtime: bootRuntime,
        remoteLoader,
      });

      await expect(coordinator.boot()).rejects.toMatchObject({
        code: "REVISION_MISMATCH",
      });
      expect(bootRuntime.hydrateWorldLayout).not.toHaveBeenCalled();
    });

    it("preserves local stored head when remote authority is unavailable and requireRemoteAuthority is false", async () => {
      const existingHead = stored(document("primary", 42));
      const bootRuntime = runtime();
      const remoteLoader = {
        loadRemoteStarterCatalogue: vi.fn(async () => {
          throw new Error("Network timeout");
        }),
      };

      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store({ load: vi.fn(async () => existingHead) }),
        runtime: bootRuntime,
        remoteLoader,
        requireRemoteAuthority: false,
      });

      const result = await coordinator.boot();
      expect(result).toMatchObject({
        ready: true,
        worldId: "primary",
        revision: existingHead.layoutRevision,
        source: "stored",
      });
      expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledWith(existingHead.document);
    });

    it("fails closed with WORLD_UNPUBLISHED when requireRemoteAuthority is true and remoteLoader is absent", async () => {
      const existingHead = stored(document("primary", 42));
      const bootRuntime = runtime();
      const loadFn = vi.fn(async () => existingHead);
      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store({ load: loadFn }),
        runtime: bootRuntime,
        requireRemoteAuthority: true,
      });

      await expect(coordinator.boot()).rejects.toMatchObject({
        code: "WORLD_UNPUBLISHED",
      });
      expect(loadFn).not.toHaveBeenCalled();
      expect(bootRuntime.hydrateWorldLayout).not.toHaveBeenCalled();
      expect(bootRuntime.captureWorldLayout).not.toHaveBeenCalled();
    });

    it("fails closed with WORLD_UNPUBLISHED when requireRemoteAuthority is true and remote catalogue returns null", async () => {
      const existingHead = stored(document("primary", 42));
      const bootRuntime = runtime();
      const loadFn = vi.fn(async () => existingHead);
      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store({ load: loadFn }),
        runtime: bootRuntime,
        remoteLoader: {
          loadRemoteStarterCatalogue: vi.fn(async () => null),
        },
        requireRemoteAuthority: true,
      });

      await expect(coordinator.boot()).rejects.toMatchObject({
        code: "WORLD_UNPUBLISHED",
      });
      expect(loadFn).not.toHaveBeenCalled();
      expect(bootRuntime.hydrateWorldLayout).not.toHaveBeenCalled();
      expect(bootRuntime.captureWorldLayout).not.toHaveBeenCalled();
    });

    it("ensures world B stays active when an aborted world A boot completes after B", async () => {
      const docA = document("world-a");
      const docB = document("world-b");
      const hydrations: string[] = [];
      const saves: string[] = [];
      let activeWorld = "initial";

      const sharedRuntime = {
        captureWorldLayout: vi.fn(() => docA),
        hydrateWorldLayout: vi.fn((doc) => {
          activeWorld = doc.worldId;
          hydrations.push(doc.worldId);
        }),
      };
      const sharedStore = {
        load: vi.fn(async () => null),
        save: vi.fn(async (input: { worldId: string }) => {
          saves.push(input.worldId);
          return { status: "saved" as const, revision: stored(docA) };
        }),
      };

      let releaseOld: (value: any) => void = () => {};
      const oldResponse = new Promise((resolve) => {
        releaseOld = resolve;
      });

      const oldCoordinator = new WorldLayoutBootCoordinator({
        worldId: "world-a",
        store: sharedStore,
        runtime: sharedRuntime,
        requireRemoteAuthority: true,
        remoteLoader: {
          loadRemoteStarterCatalogue: () => oldResponse as any,
        },
      });

      const aborted = new AbortController();
      const oldWait = oldCoordinator.boot(aborted.signal).catch((err) => err.name);
      aborted.abort();
      expect(await oldWait).toBe("AbortError");

      const currentCoordinator = new WorldLayoutBootCoordinator({
        worldId: "world-b",
        store: sharedStore,
        runtime: sharedRuntime,
        requireRemoteAuthority: true,
        remoteLoader: {
          loadRemoteStarterCatalogue: async () => ({
            published: true,
            manifest: {
              worldId: "world-b",
              layoutRevision: docB.revision.contentHash,
              layout: docB,
            },
          }),
        },
      });

      const currentResult = await currentCoordinator.boot();
      expect(currentResult.worldId).toBe("world-b");
      expect(activeWorld).toBe("world-b");

      // Release late response for oldCoordinator
      releaseOld({
        published: true,
        manifest: {
          worldId: "world-a",
          layoutRevision: docA.revision.contentHash,
          layout: docA,
        },
      });

      const supersededResult = await oldCoordinator.boot();
      expect(supersededResult.source).toBe("canonical_remote");
      // World B stays active; oldCoordinator does not hydrate or save over B
      expect(activeWorld).toBe("world-b");
      expect(hydrations).toEqual(["world-b"]);
      expect(saves).toEqual(["world-b"]);
    });

    it("ensures same-owner aborted waits safely share the valid attempt in StrictMode", async () => {
      const doc = document("primary");
      const hydrations: string[] = [];
      const bootRuntime = {
        captureWorldLayout: vi.fn(() => doc),
        hydrateWorldLayout: vi.fn((d) => {
          hydrations.push(d.worldId);
        }),
      };
      let releaseResponse: (value: any) => void = () => {};
      const remotePromise = new Promise((resolve) => {
        releaseResponse = resolve;
      });
      const coordinator = new WorldLayoutBootCoordinator({
        worldId: "primary",
        store: store({
          load: vi.fn(async () => null),
          save: vi.fn(async () => ({ status: "saved" as const, revision: stored(doc) })),
        }),
        runtime: bootRuntime,
        requireRemoteAuthority: true,
        remoteLoader: {
          loadRemoteStarterCatalogue: () => remotePromise as any,
        },
      });

      // Invocation 1: aborted
      const abort1 = new AbortController();
      const wait1 = coordinator.boot(abort1.signal).catch((e) => e.name);
      abort1.abort();
      expect(await wait1).toBe("AbortError");

      // Invocation 2: same coordinator, new signal (StrictMode replay)
      const abort2 = new AbortController();
      const wait2 = coordinator.boot(abort2.signal);

      // Release remote response
      releaseResponse({
        published: true,
        manifest: {
          worldId: "primary",
          layoutRevision: doc.revision.contentHash,
          layout: doc,
        },
      });

      const result = await wait2;
      expect(result.worldId).toBe("primary");
      expect(hydrations).toEqual(["primary"]);
    });
  });

  describe("HttpRemoteWorldLayoutLoader", () => {
    it("fetches starter-catalogue with Authorization bearer header and parses response", async () => {
      const doc = document("primary");
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          published: true,
          manifest: {
            worldId: "primary",
            layoutRevision: doc.revision.contentHash,
            layout: doc,
          },
        }),
      }));
      vi.stubGlobal("fetch", mockFetch);

      try {
        const loader = new HttpRemoteWorldLayoutLoader({
          baseUrl: "http://test.local",
          getToken: () => "mock-jwt-token",
        });

        const result = await loader.loadRemoteStarterCatalogue("primary");
        expect(mockFetch).toHaveBeenCalledWith(
          "http://test.local/api/v1/citylife/worlds/primary/starter-catalogue",
          expect.objectContaining({
            method: "GET",
            headers: expect.objectContaining({
              Authorization: "Bearer mock-jwt-token",
              Accept: "application/json",
            }),
          }),
        );
        expect(result?.published).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("returns null when starter-catalogue responds with 404", async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 404,
      }));
      vi.stubGlobal("fetch", mockFetch);

      try {
        const loader = new HttpRemoteWorldLayoutLoader({
          baseUrl: "http://test.local",
        });
        const result = await loader.loadRemoteStarterCatalogue("primary");
        expect(result).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("defaults same-origin requests to /kooker/api/v1/citylife/worlds/... gateway boundary", async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          published: false,
          manifest: null,
        }),
      }));
      vi.stubGlobal("fetch", mockFetch);

      try {
        const loader = new HttpRemoteWorldLayoutLoader();
        await loader.loadRemoteStarterCatalogue("colony-primary");
        expect(mockFetch).toHaveBeenCalledWith(
          "/kooker/api/v1/citylife/worlds/colony-primary/starter-catalogue",
          expect.anything(),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
