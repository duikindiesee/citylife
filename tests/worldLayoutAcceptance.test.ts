import { beforeEach, describe, expect, it, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  WorldLayoutDocumentError,
  createWorldLayoutDocument,
  migrateWorldLayoutDocument,
  serializeWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
  type WorldLayoutFrame,
} from "../src/colony/spatial/worldLayoutDocument";
import { useRoadNetwork } from "../src/colony/stores/useRoadNetwork";
import {
  WorldLayoutBootCoordinator,
  type WorldLayoutBootStore,
} from "../src/colony/worldLayoutBoot";
import type { StoredWorldLayoutRevision } from "../src/colony/worldLayoutStore";

function resetRoadBuilderState(): void {
  useRoadNetwork.setState({
    tiles: {},
    landscapeEdits: new Map(),
    sameSessionPlacements: new Set(),
  });
}

function stored(document: WorldLayoutDocument): StoredWorldLayoutRevision {
  return {
    worldId: document.worldId,
    sequence: document.revision.number,
    layoutRevision: worldLayoutRevisionId(document.revision),
    document,
  };
}

function storedHead(document: WorldLayoutDocument): WorldLayoutBootStore {
  return {
    load: vi.fn(async () => stored(document)),
    save: vi.fn(async () => {
      throw new Error("a persisted layout must suppress seed capture and save");
    }),
  };
}

function bootRuntime(runtime: ColonyRuntime) {
  return {
    captureWorldLayout: () => runtime.captureWorldLayout(),
    hydrateWorldLayout: (document: WorldLayoutDocument): void => {
      runtime.hydrateWorldLayout(document);
    },
  };
}

function nextDocument(
  base: WorldLayoutDocument,
  overrides: Partial<{
    frames: readonly WorldLayoutFrame[];
    placements: WorldLayoutDocument["placements"];
    roads: WorldLayoutDocument["roads"];
    ways: WorldLayoutDocument["ways"];
    terrainEdits: WorldLayoutDocument["terrainEdits"];
    portals: WorldLayoutDocument["portals"];
  }> = {},
): WorldLayoutDocument {
  return createWorldLayoutDocument({
    worldId: base.worldId,
    seed: base.seed,
    generator: base.generator,
    revision: {
      number: base.revision.number + 1,
      parentHash: base.revision.contentHash,
    },
    frames: overrides.frames ?? base.frames,
    zones: base.zones,
    reservations: base.reservations,
    placements: overrides.placements ?? base.placements,
    roads: overrides.roads ?? base.roads,
    ways: overrides.ways ?? base.ways,
    terrainEdits: overrides.terrainEdits ?? base.terrainEdits,
    networks: base.networks,
    portals: overrides.portals ?? base.portals,
  });
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function registrySnapshot(runtime: ColonyRuntime): unknown {
  const registry = runtime.worldSurvey();
  const entries = <T>(source: ReadonlyMap<string, T>) =>
    [...source.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => [id, plain(value)] as const);
  return {
    surfaceFrameId: registry.surfaceFrameId,
    frames: entries(registry.frames),
    records: entries(registry.records),
    portals: entries(registry.portals),
  };
}

function liveSnapshot(runtime: ColonyRuntime): unknown {
  const roadNetwork = useRoadNetwork.getState();
  return {
    document: runtime.worldLayoutDocument(),
    roads: plain(runtime.sim.state.roads),
    roadSet: [...runtime.sim.state.roadSet].sort(),
    roadKind: [...runtime.sim.state.roadKind.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    ),
    roadWays: plain(runtime.sim.state.roadWays),
    tiles: plain(roadNetwork.tiles),
    landscapeEdits: [...roadNetwork.landscapeEdits.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    ),
    registry: registrySnapshot(runtime),
  };
}

function firstFreeRoadCell(document: WorldLayoutDocument): {
  x: number;
  y: number;
} {
  const surface = document.frames.find(
    (frame) =>
      frame.kind === "region" && frame.layer === "surface" && frame.grid,
  );
  if (!surface?.grid)
    throw new Error("seed layout has no gridded surface frame");
  const occupied = new Set(
    document.roads.flatMap((road) =>
      road.cells.map((cell) => `${cell.x},${cell.y}`),
    ),
  );
  for (let y = 0; y < surface.grid.height; y++)
    for (let x = 0; x < surface.grid.width; x++)
      if (!occupied.has(`${x},${y}`)) return { x, y };
  throw new Error("seed layout has no free road cell");
}

describe("WB.1d independent acceptance", () => {
  beforeEach(resetRoadBuilderState);

  it("serializes only the spatial allow-list when account, wallet and presence state is populated", () => {
    const runtime = new ColonyRuntime(4242);
    const privateName = "PRIVATE-WB1D-OPERATOR";
    const privateUserId = "PRIVATE-WB1D-USER-ID";
    runtime.setOperatorName(privateName);
    runtime.setOperatorUserId(privateUserId);
    Object.assign(runtime as unknown as Record<string, unknown>, {
      acceptancePrivateState: {
        contact: "private@example.invalid",
        pat: "kpat_private_wb1d",
        prompt: "private prompt content",
        schedule: "private schedule",
        inferenceTrace: "private trace",
        walletBalance: 999_999,
        kcoTransaction: "private-ledger-entry",
        liveVehiclePosition: { x: 1, y: 2, z: 3 },
        occupant: { botId: "private-bot", room: "boardroom", seat: "north" },
      },
    });

    const serialized = serializeWorldLayoutDocument(
      runtime.captureWorldLayout(),
    );
    for (const forbidden of [
      privateName,
      privateUserId,
      "private@example.invalid",
      "kpat_private_wb1d",
      "private prompt content",
      "private schedule",
      "private trace",
      "private-ledger-entry",
      "private-bot",
      "boardroom",
    ])
      expect(serialized).not.toContain(forbidden);

    const injected = JSON.parse(serialized) as Record<string, unknown>;
    injected.occupants = [{ botId: "private-bot", room: "boardroom" }];
    expect(() => migrateWorldLayoutDocument(injected)).toThrow(
      WorldLayoutDocumentError,
    );
  });

  it("replays one durable head in two independent cold runtimes with identical registry and survey truth", async () => {
    const source = new ColonyRuntime(4242);
    const head = source.captureWorldLayout();

    const coldReplay = async () => {
      resetRoadBuilderState();
      const runtime = new ColonyRuntime(4242);
      await new WorldLayoutBootCoordinator({
        worldId: head.worldId,
        store: storedHead(head),
        runtime: bootRuntime(runtime),
      }).boot();
      return {
        canonical: serializeWorldLayoutDocument(runtime.worldLayoutDocument()!),
        registry: registrySnapshot(runtime),
        survey: runtime.surveyRoadPlacement(
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          "street",
        ),
      };
    };

    expect(await coldReplay()).toEqual(await coldReplay());
  });

  it("loads persisted spatial truth without recapturing seeders and preserves seed-4242 fixtures", async () => {
    const seedRuntime = new ColonyRuntime(4242);
    const seed = seedRuntime.captureWorldLayout();
    const extraCell = firstFreeRoadCell(seed);
    const firstRoad = seed.roads[0];
    if (!firstRoad) throw new Error("seed-4242 has no road fixture");
    const persisted = nextDocument(seed, {
      roads: seed.roads.map((road) =>
        road.id === firstRoad.id
          ? { ...road, cells: [...road.cells, extraCell] }
          : road,
      ),
    });
    const runtime = new ColonyRuntime(4242);
    const capture = vi.spyOn(runtime, "captureWorldLayout");

    await new WorldLayoutBootCoordinator({
      worldId: persisted.worldId,
      store: storedHead(persisted),
      runtime: bootRuntime(runtime),
    }).boot();

    expect(capture).not.toHaveBeenCalled();
    expect(runtime.worldLayoutDocument()).toEqual(persisted);
    expect(runtime.sim.state.roadSet.has(`${extraCell.x},${extraCell.y}`)).toBe(
      true,
    );
    for (const placement of seed.placements)
      expect(runtime.worldSurvey().records.has(placement.id)).toBe(true);
    for (const road of seed.roads)
      for (const cell of road.cells)
        expect(runtime.sim.state.roadSet.has(`${cell.x},${cell.y}`)).toBe(true);
  });

  it("adds subsurface, second-island, sky, orbital and deep-space frames without moving the original island", () => {
    const source = new ColonyRuntime(4242);
    const base = source.captureWorldLayout();
    const surface = base.frames.find(
      (frame) =>
        frame.kind === "region" && frame.layer === "surface" && frame.grid,
    );
    const world = base.frames.find((frame) => frame.kind === "world");
    const universe = base.frames.find((frame) => frame.kind === "universe");
    if (!surface?.grid || !world || !universe)
      throw new Error("seed-4242 frame fixture is incomplete");
    const identity = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    } as const;
    const added: WorldLayoutFrame[] = [
      {
        id: `${surface.id}:subsurface`,
        address: `${surface.address}/subsurface`,
        kind: "region",
        layer: "subsurface",
        parentId: surface.id,
        transform: { ...identity, position: { x: 0, y: -40, z: 0 } },
        grid: { ...surface.grid, origin: { ...surface.grid.origin } },
      },
      {
        id: `${world.id}:region:second-island`,
        address: `${world.address}/region/second-island`,
        kind: "region",
        layer: "surface",
        parentId: world.id,
        transform: { ...identity, position: { x: 20_000, y: 0, z: 0 } },
        grid: { ...surface.grid, origin: { ...surface.grid.origin } },
      },
      {
        id: `${world.id}:region:sky`,
        address: `${world.address}/region/sky`,
        kind: "region",
        layer: "air",
        parentId: world.id,
        transform: { ...identity, position: { x: 0, y: 5_000, z: 0 } },
      },
      {
        id: `${world.id}:region:orbit`,
        address: `${world.address}/region/orbit`,
        kind: "region",
        layer: "orbital",
        parentId: world.id,
        transform: { ...identity, position: { x: 0, y: 100_000, z: 0 } },
      },
      {
        id: `${universe.id}:region:deep-space`,
        address: `${universe.address}/region/deep-space`,
        kind: "region",
        layer: "deep-space",
        parentId: universe.id,
        transform: { ...identity, position: { x: 1_000_000, y: 0, z: 0 } },
      },
    ];
    const expanded = nextDocument(base, {
      frames: [...base.frames, ...added],
      portals: [
        ...base.portals,
        {
          id: "portal:acceptance:subsurface",
          address: `${surface.address}/portal/subsurface`,
          fromFrameId: surface.id,
          toFrameId: added[0]!.id,
          from: { x: 1, y: 0, z: 1 },
          to: { x: 1, y: 0, z: 1 },
          modes: ["walk", "tunnel", "portal"],
        },
        {
          id: "portal:acceptance:second-island",
          address: `${surface.address}/portal/second-island`,
          fromFrameId: surface.id,
          toFrameId: added[1]!.id,
          from: { x: 2, y: 0, z: 2 },
          to: { x: 2, y: 0, z: 2 },
          modes: ["portal", "air"],
        },
      ],
    });
    const runtime = new ColonyRuntime(4242);
    runtime.hydrateWorldLayout(expanded);
    const registry = runtime.worldSurvey();

    for (const original of base.frames) {
      const replayed = registry.frames.get(original.id);
      expect(replayed?.address).toBe(original.address);
      expect(replayed?.transform).toEqual(original.transform);
      expect(replayed?.parentId).toBe(original.parentId);
    }
    for (const frame of added) expect(registry.frames.has(frame.id)).toBe(true);
  });

  it("keeps the prior live document wholly unchanged across hash, version, reference, geometry and road-stage failures", () => {
    const runtime = new ColonyRuntime(4242);
    const head = runtime.captureWorldLayout();
    runtime.hydrateWorldLayout(head);
    const before = liveSnapshot(runtime);

    const tamperedHash = JSON.parse(
      serializeWorldLayoutDocument(head),
    ) as Record<string, unknown>;
    tamperedHash.seed = 7;

    const futureVersion = JSON.parse(
      serializeWorldLayoutDocument(head),
    ) as Record<string, unknown>;
    futureVersion.schemaVersion = 99;

    const portalDocument = nextDocument(head, {
      portals: [
        ...head.portals,
        {
          id: "portal:acceptance:atomic",
          address: `${head.frames[0]!.address}/portal/atomic`,
          fromFrameId: head.frames[0]!.id,
          toFrameId: head.frames.at(-1)!.id,
          from: { x: 0, y: 0, z: 0 },
          to: { x: 0, y: 0, z: 0 },
          modes: ["portal"],
        },
      ],
    });
    const missingPortalReference = JSON.parse(
      serializeWorldLayoutDocument(portalDocument),
    ) as Record<string, unknown>;
    (
      missingPortalReference.portals as Record<string, unknown>[]
    )[0]!.toFrameId = "frame:missing";

    const invalidGeometry = JSON.parse(
      serializeWorldLayoutDocument(head),
    ) as Record<string, unknown>;
    const firstPlacement = (
      invalidGeometry.placements as Record<string, unknown>[]
    )[0];
    if (!firstPlacement) throw new Error("seed-4242 has no placement fixture");
    firstPlacement.bounds = { x: -999, y: -999, w: 1, h: 1 };

    const nonFiniteCoordinate = JSON.parse(
      serializeWorldLayoutDocument(head),
    ) as Record<string, unknown>;
    const nonFiniteFrame = (
      nonFiniteCoordinate.frames as Record<string, unknown>[]
    )[0]!;
    (
      (nonFiniteFrame.transform as Record<string, unknown>).position as Record<
        string,
        unknown
      >
    ).x = Number.POSITIVE_INFINITY;

    const invalidGridUnit = JSON.parse(
      serializeWorldLayoutDocument(head),
    ) as Record<string, unknown>;
    const griddedFrame = (
      invalidGridUnit.frames as Record<string, unknown>[]
    ).find((frame) => frame.grid !== undefined);
    if (!griddedFrame)
      throw new Error("seed-4242 has no gridded frame fixture");
    (griddedFrame.grid as Record<string, unknown>).cellSize = -4;

    const duplicateId = JSON.parse(
      serializeWorldLayoutDocument(head),
    ) as Record<string, unknown>;
    const duplicatePlacements = duplicateId.placements as Record<
      string,
      unknown
    >[];
    if (duplicatePlacements.length < 2)
      throw new Error("seed-4242 has fewer than two placement fixtures");
    duplicatePlacements[1]!.id = duplicatePlacements[0]!.id;

    const firstRoad = head.roads[0];
    if (!firstRoad) throw new Error("seed-4242 has no road fixture");
    const conflictingRoad = nextDocument(head, {
      roads: [
        ...head.roads,
        {
          ...firstRoad,
          id: "road:acceptance:conflict",
          kind: firstRoad.kind === "avenue" ? "street" : "avenue",
          cells: [firstRoad.cells[0]!],
        },
      ],
    });

    const failures: unknown[] = [
      tamperedHash,
      futureVersion,
      missingPortalReference,
      invalidGeometry,
      nonFiniteCoordinate,
      invalidGridUnit,
      duplicateId,
      conflictingRoad,
    ];
    for (const candidate of failures) {
      expect(() =>
        runtime.hydrateWorldLayout(candidate as WorldLayoutDocument),
      ).toThrow();
      expect(liveSnapshot(runtime)).toEqual(before);
    }
  });
});
