import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
} from "../src/colony/spatial/worldLayoutDocument";
import {
  WorldLayoutBootCoordinator,
  WorldLayoutBootError,
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

function document(worldId = "primary", elevation?: number): WorldLayoutDocument {
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
    hydrateWorldLayout:
      vi.fn<WorldLayoutBootRuntime["hydrateWorldLayout"]>(),
  };
}

function store(overrides: Partial<WorldLayoutBootStore> = {}): WorldLayoutBootStore {
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

  it("loses an initialization race safely and hydrates the winning durable head", async () => {
    const captured = document("primary", 1);
    const winner = stored(document("primary", 2));
    const load = vi
      .fn<WorldLayoutBootStore["load"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const save = vi.fn(async (): Promise<WorldLayoutSaveResult> => ({
      status: "conflict",
      expectedLayoutRevision: null,
      actualLayoutRevision: winner.layoutRevision,
    }));
    const bootRuntime = runtime(captured);

    const result = await new WorldLayoutBootCoordinator({
      worldId: "primary",
      store: store({ load, save }),
      runtime: bootRuntime,
    }).boot();

    expect(result.source).toBe("stored");
    expect(result.revision).toBe(winner.layoutRevision);
    expect(bootRuntime.hydrateWorldLayout).toHaveBeenCalledWith(winner.document);
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

    await expect(coordinator.boot()).rejects.toBeInstanceOf(WorldLayoutBootError);
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

    await expect(coordinator.boot()).rejects.toThrow("atomic hydration rejected");
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
});
