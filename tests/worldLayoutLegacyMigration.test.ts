import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  WorldLayoutAdapterError,
  importLegacyWorldLayoutDocument,
  type WorldLayoutRuntimeSource,
} from "../src/colony/spatial/worldLayoutAdapter";
import {
  LEGACY_WORLD_LAYOUT_PROVENANCE,
  WORLD_LAYOUT_GENERATOR,
  WorldLayoutDocumentError,
  createWorldLayoutDocument,
  parseWorldLayoutDocument,
  serializeWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
} from "../src/colony/spatial/worldLayoutDocument";
import { useRoadNetwork } from "../src/colony/stores/useRoadNetwork";
import {
  WorldLayoutBootCoordinator,
  type WorldLayoutBootRuntime,
  type WorldLayoutBootStore,
} from "../src/colony/worldLayoutBoot";
import {
  WorldLayoutStore,
  type StoredWorldLayoutRevision,
} from "../src/colony/worldLayoutStore";

const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
} as const;
const VERTICAL = {
  min: 0,
  max: 1,
  clearanceBelow: 0,
  clearanceAbove: 1,
} as const;

function source(
  overrides: Partial<WorldLayoutRuntimeSource> = {},
): WorldLayoutRuntimeSource {
  return {
    worldId: "legacy-primary",
    seed: 4242,
    revision: { number: 0, parentHash: null },
    surfaceFrameId: "surface",
    frames: [
      {
        id: "surface",
        address: "spatial://citylife/legacy-primary/surface",
        kind: "region",
        layer: "surface",
        transform: IDENTITY,
        grid: {
          width: 64,
          height: 64,
          cellSize: 4,
          origin: { x: -128, y: 0, z: -128 },
        },
        metadata: { privateDisplayName: "must not persist" },
      },
    ],
    portals: [],
    terrainEdits: [
      { frameId: "surface", cell: { x: 4, y: 4 }, elevation: 2.5 },
      { frameId: "surface", cell: { x: 2, y: 3 }, buildability: 2 },
    ],
    zonedPlacements: [],
    roads: [
      { x: 3, y: 1, kind: "street" },
      { x: 1, y: 1, kind: "street" },
      { x: 2, y: 1, kind: "street" },
      { x: 2, y: 1, kind: "street" },
      { x: 5, y: 5, kind: "avenue" },
      { x: 5, y: 6, kind: "avenue" },
    ],
    roadWays: [
      {
        path: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 1 },
        ],
        kind: "street",
        width: 1,
        source: "builder",
      },
      {
        path: [
          { x: 5, y: 5 },
          { x: 5, y: 6 },
        ],
        kind: "avenue",
        width: 3,
        source: "depot-spur",
      },
    ],
    roadVertical: VERTICAL,
    ...overrides,
  };
}

function stored(document: WorldLayoutDocument): StoredWorldLayoutRevision {
  return {
    worldId: document.worldId,
    sequence: document.revision.number,
    layoutRevision: worldLayoutRevisionId(document.revision),
    document,
  };
}

const stores: WorldLayoutStore[] = [];
afterEach(async () => {
  useRoadNetwork.setState({ tiles: {}, landscapeEdits: new Map() });
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe("WB.1d deterministic one-time legacy layout migration", () => {
  it("deduplicates canonical cells and emits stable, provenance-hashed V1 bytes", () => {
    const firstSource = source() as WorldLayoutRuntimeSource & {
      roadSet: Set<string>;
      roadKind: Map<string, string>;
    };
    firstSource.roadSet = new Set(["63,63"]);
    firstSource.roadKind = new Map([["63,63", "path"]]);

    const first = importLegacyWorldLayoutDocument(firstSource);
    const second = importLegacyWorldLayoutDocument(
      source({
        roads: [...firstSource.roads].reverse(),
        roadWays: [...firstSource.roadWays].reverse(),
        terrainEdits: [...firstSource.terrainEdits].reverse(),
      }),
    );

    expect(serializeWorldLayoutDocument(second)).toBe(
      serializeWorldLayoutDocument(first),
    );
    expect(first.generator).toEqual(WORLD_LAYOUT_GENERATOR);
    expect(first.roads.flatMap((road) => road.cells)).toHaveLength(5);
    expect(
      first.roads.every(
        (road) => road.provenance === LEGACY_WORLD_LAYOUT_PROVENANCE,
      ),
    ).toBe(true);
    expect(
      first.ways.every(
        (way) => way.provenance === LEGACY_WORLD_LAYOUT_PROVENANCE,
      ),
    ).toBe(true);
    expect(
      first.terrainEdits.every(
        (edit) =>
          edit.id === `terrain:${edit.frameId}:${edit.cell.x},${edit.cell.y}` &&
          edit.provenance === LEGACY_WORLD_LAYOUT_PROVENANCE,
      ),
    ).toBe(true);
    expect(serializeWorldLayoutDocument(first)).not.toContain("roadSet");
    expect(serializeWorldLayoutDocument(first)).not.toContain("roadKind");
    expect(serializeWorldLayoutDocument(first)).not.toContain(
      "privateDisplayName",
    );
  });

  it("rejects conflicting logical cells and disconnected authored ways", () => {
    expect(() =>
      importLegacyWorldLayoutDocument(
        source({
          roads: [
            { x: 1, y: 1, kind: "street" },
            { x: 1, y: 1, kind: "avenue" },
          ],
          roadWays: [],
        }),
      ),
    ).toThrowError(WorldLayoutAdapterError);

    expect(() =>
      importLegacyWorldLayoutDocument(
        source({
          roadWays: [
            {
              path: [
                { x: 1, y: 1 },
                { x: 63, y: 63 },
              ],
              kind: "street",
              width: 1,
            },
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ROAD_WAY_DISCONNECTED" }));
  });

  it("round-trips generator, zones, reservations and multimodal network references strictly", () => {
    const migrated = importLegacyWorldLayoutDocument(source());
    const document = createWorldLayoutDocument({
      ...migrated,
      revision: { number: 0, parentHash: null },
      zones: [
        {
          id: "zone:commercial",
          frameId: "surface",
          kind: "commercial",
          cells: [{ x: 5, y: 5 }],
          vertical: VERTICAL,
          ownerRef: "principal:owner-7f9a",
        },
      ],
      reservations: [
        {
          id: "reservation:library",
          frameId: "surface",
          purpose: "commercial-library",
          cells: [{ x: 4, y: 4 }],
          vertical: VERTICAL,
          ownerRef: "principal:owner-7f9a",
        },
      ],
      networks: [
        {
          id: "network:bus",
          kind: "transport",
          modes: ["walk", "bus"],
          nodes: [
            {
              id: "network:bus:stop:a",
              frameId: "surface",
              position: { x: 1, y: 0, z: 1 },
              spatialIds: [migrated.roads[0]!.id],
            },
            {
              id: "network:bus:stop:b",
              frameId: "surface",
              position: { x: 5, y: 0, z: 5 },
            },
          ],
          edges: [
            {
              id: "network:bus:edge:a-b",
              fromNodeId: "network:bus:stop:a",
              toNodeId: "network:bus:stop:b",
              modes: ["bus"],
              bidirectional: true,
              spatialIds: [migrated.ways[0]!.id],
            },
          ],
        },
      ],
    });

    expect(
      parseWorldLayoutDocument(serializeWorldLayoutDocument(document)),
    ).toEqual(document);
    const unsafe = JSON.parse(serializeWorldLayoutDocument(document)) as Record<
      string,
      unknown
    >;
    (unsafe.zones as Record<string, unknown>[])[0]!.ownerRef =
      "someone@example.com";
    expect(() => parseWorldLayoutDocument(JSON.stringify(unsafe))).toThrowError(
      WorldLayoutDocumentError,
    );
  });

  it("persists one head, then every later boot loads it without consulting legacy state", async () => {
    const document = importLegacyWorldLayoutDocument(source());
    const store = new WorldLayoutStore({
      databaseName: `legacy-migration-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    stores.push(store);
    const firstRuntime: WorldLayoutBootRuntime = {
      captureWorldLayout: vi.fn(() => document),
      hydrateWorldLayout: vi.fn(),
    };
    const first = await new WorldLayoutBootCoordinator({
      worldId: document.worldId,
      store,
      runtime: firstRuntime,
    }).boot();
    expect(first.source).toBe("initialized");

    const secondRuntime: WorldLayoutBootRuntime = {
      captureWorldLayout: vi.fn(() => {
        throw new Error("legacy importer must never run after a head exists");
      }),
      hydrateWorldLayout: vi.fn(),
    };
    const second = await new WorldLayoutBootCoordinator({
      worldId: document.worldId,
      store,
      runtime: secondRuntime,
    }).boot();

    expect(second).toEqual({ ...first, source: "stored" });
    expect(secondRuntime.captureWorldLayout).not.toHaveBeenCalled();
    expect(secondRuntime.hydrateWorldLayout).toHaveBeenCalledWith(document);
    expect(await store.history(document.worldId)).toHaveLength(1);
  });

  it("does not hydrate when validation or the atomic first write fails", async () => {
    const document = importLegacyWorldLayoutDocument(source());
    const hydrateWorldLayout = vi.fn();
    const failingStore: WorldLayoutBootStore = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => {
        throw new Error("IndexedDB transaction aborted");
      }),
    };
    await expect(
      new WorldLayoutBootCoordinator({
        worldId: document.worldId,
        store: failingStore,
        runtime: { captureWorldLayout: () => document, hydrateWorldLayout },
      }).boot(),
    ).rejects.toThrow("IndexedDB transaction aborted");
    expect(hydrateWorldLayout).not.toHaveBeenCalled();

    const tampered = JSON.parse(
      serializeWorldLayoutDocument(document),
    ) as WorldLayoutDocument;
    (tampered.ways[0]!.cells as { x: number; y: number }[])[0] = {
      x: 63,
      y: 63,
    };
    const save = vi.fn();
    await expect(
      new WorldLayoutBootCoordinator({
        worldId: document.worldId,
        store: { load: vi.fn(async () => null), save },
        runtime: { captureWorldLayout: () => tampered, hydrateWorldLayout },
      }).boot(),
    ).rejects.toThrow(WorldLayoutDocumentError);
    expect(save).not.toHaveBeenCalled();
    expect(hydrateWorldLayout).not.toHaveBeenCalled();
  });

  it("ignores legacy derived indexes and regenerates them from the imported document", () => {
    useRoadNetwork.setState({
      tiles: {
        "607,607": {
          x: 607,
          y: 607,
          mask: 0,
          type: "culdesac",
        },
      },
      landscapeEdits: new Map(),
    });
    const runtime = new ColonyRuntime(4242);
    const first = runtime.captureWorldLayout();
    runtime.sim.state.roadSet = new Set(["607,607"]);
    runtime.sim.state.roadKind = new Map([["607,607", "path"]]);
    const second = runtime.captureWorldLayout();
    expect(serializeWorldLayoutDocument(second)).toBe(
      serializeWorldLayoutDocument(first),
    );

    runtime.hydrateWorldLayout(first);
    const expected = new Map(
      first.roads.flatMap((road) =>
        road.cells.map(
          (cell) =>
            [
              `${cell.x},${cell.y}`,
              road.kind === "avenue" || road.kind === "path"
                ? road.kind
                : "street",
            ] as const,
        ),
      ),
    );
    expect(runtime.sim.state.roadSet).toEqual(new Set(expected.keys()));
    expect(runtime.sim.state.roadKind).toEqual(expected);
    expect(runtime.sim.state.roadWays).toEqual(
      first.ways.map((way) => ({
        path: way.cells.map((cell) => ({ ...cell })),
        kind: way.kind,
        width: way.width,
      })),
    );
    expect(serializeWorldLayoutDocument(runtime.captureWorldLayout())).toBe(
      serializeWorldLayoutDocument(first),
    );
  });
});
