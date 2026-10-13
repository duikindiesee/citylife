import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  createWorldLayoutDocument,
  serializeWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
} from "../src/colony/spatial/worldLayoutDocument";
import { useRoadNetwork } from "../src/colony/stores/useRoadNetwork";
import {
  WorldLayoutBootCoordinator,
  type WorldLayoutBootStore,
} from "../src/colony/worldLayoutBoot";
import type { StoredWorldLayoutRevision } from "../src/colony/worldLayoutStore";
import { Biome } from "../src/colony/terrain";

function resetBuilderState(): void {
  useRoadNetwork.setState({
    tiles: {},
    landscapeEdits: new Map(),
    sameSessionPlacements: new Set(),
  });
}

function storedHead(document: WorldLayoutDocument): WorldLayoutBootStore {
  const revision: StoredWorldLayoutRevision = {
    worldId: document.worldId,
    sequence: document.revision.number,
    layoutRevision: worldLayoutRevisionId(document.revision),
    document,
  };
  return {
    load: vi.fn(async () => revision),
    save: vi.fn(async () => {
      throw new Error("stored authority must suppress legacy initialization");
    }),
  };
}

function freeSurfaceCells(
  runtime: ColonyRuntime,
  document: WorldLayoutDocument,
  count: number,
): { x: number; y: number }[] {
  const occupied = new Set<string>();
  for (const road of document.roads)
    for (const cell of road.cells) occupied.add(`${cell.x},${cell.y}`);
  for (const placement of document.placements)
    for (const cell of placement.cells) occupied.add(`${cell.x},${cell.y}`);
  const terrain = runtime.sim.state.terrain;
  const cells: { x: number; y: number }[] = [];
  for (let y = 2; y < terrain.size - 2 && cells.length < count; y++)
    for (let x = 2; x < terrain.size - 2 && cells.length < count; x++) {
      if (occupied.has(`${x},${y}`)) continue;
      const index = terrain.idx(x, y);
      if (terrain.isWater(x, y) || terrain.buildable[index] !== 2) continue;
      cells.push({ x, y });
      occupied.add(`${x},${y}`);
    }
  if (cells.length !== count) throw new Error("not enough free surface cells");
  return cells;
}

interface AuthorityFixture {
  document: WorldLayoutDocument;
  surfaceFrameId: string;
  placementCell: { x: number; y: number };
  terrainCell: { x: number; y: number };
  reservationCell: { x: number; y: number };
  zoneCell: { x: number; y: number };
  editedElevation: number;
  baselineTerrainCell: {
    biome: Biome;
    water: string;
    buildability: number;
    elevation: number;
    distanceToWater: number;
  };
}

let memoizedAuthorityFixture: AuthorityFixture | null = null;

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return obj;
}

function cloneDocument(doc: WorldLayoutDocument): WorldLayoutDocument {
  const cloned = structuredClone(doc);
  Object.defineProperty(cloned, "worldId", {
    value: doc.layoutId,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return cloned;
}

function cloneFixture(source: AuthorityFixture): AuthorityFixture {
  return {
    document: cloneDocument(source.document),
    surfaceFrameId: source.surfaceFrameId,
    placementCell: { ...source.placementCell },
    terrainCell: { ...source.terrainCell },
    reservationCell: { ...source.reservationCell },
    zoneCell: { ...source.zoneCell },
    editedElevation: source.editedElevation,
    baselineTerrainCell: { ...source.baselineTerrainCell },
  };
}

function buildAuthorityFixtureTemplate(): AuthorityFixture {
  const source = new ColonyRuntime(4242);
  const base = source.captureWorldLayout();
  const surface = base.frames.find(
    (frame) =>
      frame.kind === "region" && frame.layer === "surface" && frame.grid,
  );
  if (!surface) throw new Error("seed surface frame missing");
  const [placementCell, terrainCell, reservationCell, zoneCell] =
    freeSurfaceCells(source, base, 4);
  const baseline = source
    .worldSurvey()
    .terrainCell(terrainCell!.x, terrainCell!.y)!;
  const baselineTerrainCell = {
    biome: baseline.biome,
    water: baseline.water,
    buildability: baseline.buildability,
    elevation: baseline.elevation,
    distanceToWater: baseline.distanceToWater,
  };
  const editedElevation =
    source.sim.state.terrain.worldY(terrainCell!.x, terrainCell!.y) + 1.25;
  const verticalAt = (cell: { x: number; y: number }) => ({
    min: source.sim.state.terrain.worldY(cell.x, cell.y),
    max: source.sim.state.terrain.worldY(cell.x, cell.y) + 12,
    clearanceBelow: 0,
    clearanceAbove: 2,
  });
  const placementId = "placement:authority:kooker-hq-archive";
  const document = createWorldLayoutDocument({
    worldId: base.worldId,
    seed: base.seed,
    generator: base.generator,
    revision: {
      number: base.revision.number + 1,
      parentHash: base.revision.contentHash,
    },
    frames: base.frames,
    zones: [
      {
        id: "zone:authority:civic",
        frameId: surface.id,
        kind: "civic",
        cells: [zoneCell!],
        vertical: verticalAt(zoneCell!),
        ownerRef: "principal:private-zone-owner",
      },
    ],
    reservations: [
      {
        id: "reservation:authority:future-library",
        frameId: surface.id,
        purpose: "future-library-footprint",
        cells: [reservationCell!],
        vertical: verticalAt(reservationCell!),
        ownerRef: "principal:private-reservation-owner",
      },
    ],
    placements: [
      ...base.placements,
      {
        id: placementId,
        definitionId: "building:kooker-hq-data-archive",
        frameId: surface.id,
        layer: "surface",
        source: "import",
        cells: [placementCell!],
        bounds: { x: placementCell!.x, y: placementCell!.y, w: 1, h: 1 },
        vertical: verticalAt(placementCell!),
        anchors: [{ id: "centre", cell: placementCell! }],
      },
    ],
    roads: base.roads,
    ways: base.ways,
    terrainEdits: [
      ...base.terrainEdits,
      {
        id: `terrain:${surface.id}:${terrainCell!.x},${terrainCell!.y}`,
        frameId: surface.id,
        cell: terrainCell!,
        elevation: editedElevation,
        biome: Biome.Ocean,
        buildability: 0,
      },
    ],
    networks: [
      {
        id: "network:authority:archive-tunnel",
        kind: "transport",
        modes: ["walk", "tunnel"],
        nodes: [
          {
            id: "archive-a",
            frameId: surface.id,
            position: { x: placementCell!.x, y: 0, z: placementCell!.y },
            spatialIds: [placementId],
          },
          {
            id: "archive-b",
            frameId: surface.id,
            position: { x: reservationCell!.x, y: -4, z: reservationCell!.y },
          },
          {
            id: "archive-c",
            frameId: surface.id,
            position: { x: zoneCell!.x, y: -4, z: zoneCell!.y },
          },
        ],
        edges: [
          {
            id: "archive-edge-a-b",
            fromNodeId: "archive-a",
            toNodeId: "archive-b",
            modes: ["walk", "tunnel"],
            bidirectional: true,
            spatialIds: [placementId],
          },
          {
            id: "archive-edge-b-c",
            fromNodeId: "archive-b",
            toNodeId: "archive-c",
            modes: ["walk", "tunnel"],
            bidirectional: false,
          },
        ],
      },
    ],
    portals: base.portals,
  });
  return deepFreeze({
    document,
    surfaceFrameId: surface.id,
    placementCell: placementCell!,
    terrainCell: terrainCell!,
    reservationCell: reservationCell!,
    zoneCell: zoneCell!,
    editedElevation,
    baselineTerrainCell,
  });
}

function authorityDocument(): AuthorityFixture {
  if (!memoizedAuthorityFixture) {
    memoizedAuthorityFixture = buildAuthorityFixtureTemplate();
  }
  return cloneFixture(memoizedAuthorityFixture);
}

describe("WB.1d runtime authority replay", () => {
  beforeAll(() => {
    if (!memoizedAuthorityFixture) {
      memoizedAuthorityFixture = buildAuthorityFixtureTemplate();
    }
  }, 60000);

  beforeEach(resetBuilderState);

  describe("runtime authority two cold boot replay", () => {
    let fixture: ReturnType<typeof authorityDocument>;
    let first: {
      canonical: string;
      placement: any;
      terrain: any;
      zones: any;
      reservations: any;
      networks: any;
      route: any;
      reverseRoute: any;
      placementFailures: string[];
      terrainFailures: string[];
      reservationFailures: string[];
      zoneFailures: { cell: any; detail: any }[];
    };
    let setupDurationMs = 0;

    async function executeColdBoot(
      fixtureDoc: ReturnType<typeof authorityDocument>,
    ) {
      resetBuilderState();
      const bootDoc = cloneDocument(fixtureDoc.document);
      const runtime = new ColonyRuntime(4242);
      const legacyCapture = vi.spyOn(runtime, "captureWorldLayout");
      await new WorldLayoutBootCoordinator({
        worldId: bootDoc.worldId,
        store: storedHead(bootDoc),
        runtime: {
          captureWorldLayout: () => runtime.captureWorldLayout(),
          hydrateWorldLayout: (document): void => {
            runtime.hydrateWorldLayout(document);
          },
        },
      }).boot();
      expect(legacyCapture).not.toHaveBeenCalled();
      const registry = runtime.worldSurvey();
      const terrain = registry.terrainCell(
        fixtureDoc.terrainCell.x,
        fixtureDoc.terrainCell.y,
      );
      const placementSurvey = runtime.surveyRoadPlacement(
        [fixtureDoc.placementCell],
        "street",
        worldLayoutRevisionId(fixtureDoc.document.revision),
      );
      const terrainSurvey = runtime.surveyRoadPlacement(
        [fixtureDoc.terrainCell],
        "street",
        worldLayoutRevisionId(fixtureDoc.document.revision),
      );
      const reservationSurvey = runtime.surveyRoadPlacement(
        [fixtureDoc.reservationCell],
        "street",
        worldLayoutRevisionId(fixtureDoc.document.revision),
      );
      const zonedSurvey = runtime.surveyZonedPlot(
        fixtureDoc.zoneCell.x,
        fixtureDoc.zoneCell.y,
        "n",
        "COMPACT",
        "residential",
        worldLayoutRevisionId(fixtureDoc.document.revision),
      );
      return {
        canonical: serializeWorldLayoutDocument(runtime.captureWorldLayout()),
        placement: registry.records.get(
          "placement:authority:kooker-hq-archive",
        ),
        terrain,
        zones: runtime.worldLayoutZonesAt(
          fixtureDoc.surfaceFrameId,
          fixtureDoc.zoneCell.x,
          fixtureDoc.zoneCell.y,
        ),
        reservations: runtime.worldLayoutReservationIdsAt(
          fixtureDoc.surfaceFrameId,
          fixtureDoc.reservationCell.x,
          fixtureDoc.reservationCell.y,
        ),
        networks: runtime.worldLayoutNetworkIds(),
        route: runtime.worldLayoutNetworkRoute(
          "network:authority:archive-tunnel",
          "archive-a",
          "archive-c",
          "walk",
        ),
        reverseRoute: runtime.worldLayoutNetworkRoute(
          "network:authority:archive-tunnel",
          "archive-c",
          "archive-a",
          "walk",
        ),
        placementFailures: placementSurvey.failures.map(
          (failure) => failure.code,
        ),
        terrainFailures: terrainSurvey.failures.map((failure) => failure.code),
        reservationFailures: reservationSurvey.failures.map(
          (failure) => failure.code,
        ),
        zoneFailures: zonedSurvey.failures
          .filter((failure) => failure.code === "ZONE_MISMATCH")
          .map((failure) => ({ cell: failure.cell, detail: failure.detail })),
      };
    }

    beforeEach(async () => {
      // Parent beforeEach(resetBuilderState) executes first.
      const preStore = useRoadNetwork.getState();
      expect(Object.keys(preStore.tiles).length).toBe(0);
      expect(preStore.landscapeEdits.size).toBe(0);
      expect(preStore.sameSessionPlacements.size).toBe(0);

      const t0 = performance.now();
      const probeFixture = authorityDocument();
      const pristineZonesLength = probeFixture.document.zones.length;
      const pristineZoneCellX = probeFixture.document.zones[0]!.cells[0]!.x;
      const pristineTerrainElevation =
        probeFixture.document.terrainEdits[0]!.elevation;

      (probeFixture.document.zones as unknown[]).push({
        id: "zone:tampered",
        frameId: probeFixture.surfaceFrameId,
        kind: "civic",
        cells: [probeFixture.zoneCell],
        vertical: { min: 0, max: 10, clearanceBelow: 0, clearanceAbove: 1 },
        ownerRef: "principal:tampered",
      });
      (probeFixture.document.zones[0]!.cells[0] as { x: number }).x = 99999;
      (
        probeFixture.document.terrainEdits[0] as {
          elevation: number;
          cell: { x: number };
        }
      ).elevation = 99999;
      (
        probeFixture.document.terrainEdits[0] as {
          elevation: number;
          cell: { x: number };
        }
      ).cell.x = 99999;

      fixture = authorityDocument();
      expect(fixture.document.zones.length).toBe(pristineZonesLength);
      expect(fixture.document.zones[0]!.cells[0]!.x).toBe(pristineZoneCellX);
      expect(fixture.document.terrainEdits[0]!.elevation).toBe(
        pristineTerrainElevation,
      );

      first = await executeColdBoot(fixture);
      setupDurationMs = performance.now() - t0;
    }, 60000);

    it("replays placements, terrain policy, zones, reservations and network navigation identically across two cold boots", async () => {
      const tActionStart = performance.now();
      const second = await executeColdBoot(fixture);
      expect(second).toEqual(first);
      expect(first.canonical).toBe(
        serializeWorldLayoutDocument(fixture.document),
      );
      expect(first.placement).toMatchObject({
        kind: "building",
        geometry: {
          type: "footprint",
          bounds: {
            x: fixture.placementCell.x,
            y: fixture.placementCell.y,
            w: 1,
            h: 1,
          },
        },
        metadata: {
          definitionId: "building:kooker-hq-data-archive",
          persisted: true,
        },
      });
      expect(first.terrain).toMatchObject({
        biome: Biome.Ocean,
        water: "ocean",
        buildability: 0,
        distanceToWater: 0,
      });
      expect(first.terrain?.elevation).toBeCloseTo(fixture.editedElevation, 4);
      expect(first.zones).toEqual([
        { id: "zone:authority:civic", kind: "civic" },
      ]);
      expect(first.reservations).toEqual([
        "reservation:authority:future-library",
      ]);
      expect(first.networks).toEqual(["network:authority:archive-tunnel"]);
      expect(first.route).toEqual(["archive-a", "archive-b", "archive-c"]);
      expect(first.reverseRoute).toBeNull();
      expect(first.placementFailures).toContain("RESERVED_VOLUME");
      expect(first.terrainFailures).toEqual(
        expect.arrayContaining(["WATER_FORBIDDEN", "NON_BUILDABLE"]),
      );
      expect(first.reservationFailures).toContain("RESERVED_VOLUME");
      expect(first.zoneFailures.length).toBeGreaterThan(0);
      expect(
        JSON.stringify({
          zones: first.zones,
          reservations: first.reservations,
        }),
      ).not.toContain("principal:private");

      const actionDurationMs = performance.now() - tActionStart;
      console.log(
        `[worldLayoutRuntimeAuthority:coldReplay] setupDuration=${(setupDurationMs / 1000).toFixed(2)}s, actionDuration=${(actionDurationMs / 1000).toFixed(2)}s, totalCase=${((setupDurationMs + actionDurationMs) / 1000).toFixed(2)}s`,
      );
    }, 60000);
  });

  it("rebuilds the declared cross-frame portal traversal contract from durable layout state", () => {
    const fixture = authorityDocument();
    const surface = fixture.document.frames.find(
      (frame) => frame.id === fixture.surfaceFrameId,
    );
    if (!surface) throw new Error("fixture surface frame missing");
    const archiveFrameId = "frame:authority:kooker-hq-archive-room";
    const portalId = "portal:authority:kooker-hq-archive-room";
    const withPortal = createWorldLayoutDocument({
      worldId: fixture.document.worldId,
      seed: fixture.document.seed,
      generator: fixture.document.generator,
      revision: {
        number: fixture.document.revision.number + 1,
        parentHash: fixture.document.revision.contentHash,
      },
      frames: [
        ...fixture.document.frames,
        {
          id: archiveFrameId,
          address: `${surface.address}/building/kooker-hq/archive-room`,
          kind: "room",
          layer: "interior",
          parentId: surface.id,
          transform: {
            position: {
              x: fixture.placementCell.x,
              y: 0,
              z: fixture.placementCell.y,
            },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          grid: {
            width: 6,
            height: 6,
            cellSize: 1,
            origin: { x: 0, y: 0, z: 0 },
          },
        },
      ],
      zones: fixture.document.zones,
      reservations: fixture.document.reservations,
      placements: fixture.document.placements,
      roads: fixture.document.roads,
      ways: fixture.document.ways,
      terrainEdits: fixture.document.terrainEdits,
      networks: fixture.document.networks,
      portals: [
        ...fixture.document.portals,
        {
          id: portalId,
          address: `${surface.address}/portal/kooker-hq-archive-room`,
          fromFrameId: surface.id,
          toFrameId: archiveFrameId,
          from: {
            x: fixture.placementCell.x,
            y: 0,
            z: fixture.placementCell.y,
          },
          to: { x: 1, y: 0, z: 1 },
          modes: ["portal", "walk"],
        },
      ],
    });
    const runtime = new ColonyRuntime(4242);

    runtime.hydrateWorldLayout(withPortal);

    const survey = runtime.worldSurvey();
    const from = `${portalId}:from`;
    const to = `${portalId}:to`;
    expect(survey.portals.get(portalId)).toMatchObject({
      fromFrameId: surface.id,
      toFrameId: archiveFrameId,
      modes: ["portal", "walk"],
    });
    expect(survey.findPath(from, to, new Set(["portal"]))).toEqual([from, to]);
    expect(survey.findPath(to, from, new Set(["walk"]))).toEqual([to, from]);
    expect(survey.findPath(from, to, new Set(["road"]))).toBeNull();
  });

  it("rehydrates every revision from the procedural baseline instead of leaking prior terrain state", () => {
    const fixture = authorityDocument();
    const runtime = new ColonyRuntime(4242);
    runtime.hydrateWorldLayout(fixture.document);
    expect(
      runtime
        .worldSurvey()
        .terrainCell(fixture.terrainCell.x, fixture.terrainCell.y)?.biome,
    ).toBe(Biome.Ocean);

    const reverted = createWorldLayoutDocument({
      worldId: fixture.document.worldId,
      seed: fixture.document.seed,
      generator: fixture.document.generator,
      revision: {
        number: fixture.document.revision.number + 1,
        parentHash: fixture.document.revision.contentHash,
      },
      frames: fixture.document.frames,
      zones: fixture.document.zones,
      reservations: fixture.document.reservations,
      placements: fixture.document.placements,
      roads: fixture.document.roads,
      ways: fixture.document.ways,
      terrainEdits: fixture.document.terrainEdits.filter(
        (edit) =>
          edit.cell.x !== fixture.terrainCell.x ||
          edit.cell.y !== fixture.terrainCell.y,
      ),
      networks: fixture.document.networks,
      portals: fixture.document.portals,
    });
    runtime.hydrateWorldLayout(reverted);
    expect(
      runtime
        .worldSurvey()
        .terrainCell(fixture.terrainCell.x, fixture.terrainCell.y),
    ).toMatchObject({
      biome: fixture.baselineTerrainCell.biome,
      water: fixture.baselineTerrainCell.water,
      buildability: fixture.baselineTerrainCell.buildability,
      elevation: fixture.baselineTerrainCell.elevation,
      distanceToWater: fixture.baselineTerrainCell.distanceToWater,
    });
    expect(runtime.worldLayoutDocument()).toEqual(reverted);
  });
});
