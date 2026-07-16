import { describe, expect, it } from "vitest";
import { RNG } from "../src/engine/rng";
import { CELL_SIZE } from "../src/colony/scale";
import { Terrain } from "../src/colony/terrain";
import type { PlacementSurveyResult } from "../src/colony/placement/surveyPlacement";
import {
  createWorldSurvey,
  gridToWorld,
  spatialRecordsConflict,
  verticalRange,
  worldToGrid,
} from "../src/colony/worldSurvey";

describe("authoritative world survey", () => {
  it("preserves the exact 608-cell island transform", () => {
    expect(CELL_SIZE).toBe(4);
    expect(gridToWorld(608, 0, 0)).toEqual({ x: -1216, y: 0, z: -1216 });
    expect(gridToWorld(608, 304, 304)).toEqual({ x: 0, y: 0, z: 0 });
    expect(gridToWorld(608, 607, 607)).toEqual({ x: 1212, y: 0, z: 1212 });
    expect(worldToGrid(608, { x: 84, z: -44 })).toEqual({ x: 325, y: 293 });
  });

  it("addresses exact terrain metadata without copying the whole heightfield", () => {
    const terrain = new Terrain(new RNG(4242));
    const survey = createWorldSurvey({ terrain, worldId: "seed-4242" });
    const landing = survey.terrainCell(terrain.landing.x, terrain.landing.y)!;

    expect(survey.frames.get(survey.surfaceFrameId)?.grid).toMatchObject({
      width: 608,
      height: 608,
      cellSize: 4,
    });
    expect(landing.id).toBe(
      `${survey.surfaceFrameId}:cell:${terrain.landing.x}:${terrain.landing.y}`,
    );
    expect(landing.address).toContain(
      `/cell/${terrain.landing.x}/${terrain.landing.y}`,
    );
    // Landing is always dry; the seeded picker may legitimately choose the buildable beach band.
    expect(["land", "shore"]).toContain(landing.surface);
    expect(landing.water).toBe("none");
    expect(landing.buildability).toBe(2);
    expect(Number.isFinite(landing.elevation)).toBe(true);
    expect(Number.isFinite(landing.relief)).toBe(true);
    expect([
      ...survey.terrainCells({
        x: terrain.landing.x,
        y: terrain.landing.y,
        w: 2,
        h: 2,
      }),
    ]).toHaveLength(4);
  }, 15_000);

  it("maps roads, intersections, bus stops and current footprints with stable ids", () => {
    const terrain = new Terrain(new RNG(7));
    const l = terrain.landing;
    const roads = [
      { x: l.x - 1, y: l.y, kind: "street" as const },
      { x: l.x, y: l.y, kind: "avenue" as const },
      { x: l.x + 1, y: l.y, kind: "street" as const },
      { x: l.x, y: l.y - 1, kind: "street" as const },
      { x: l.x, y: l.y + 1, kind: "street" as const },
    ];
    const survey = createWorldSurvey({
      terrain,
      worldId: "test-world",
      structures: [{ kind: "caravan", x: l.x, y: l.y }],
      buildings: [{ id: 9, x: l.x + 2, y: l.y, artifact: { kind: "garage" } }],
      roads,
      roadWays: [{ path: roads, kind: "avenue", width: 3 }],
      busRoute: {
        stops: [roads[0]!, roads[2]!],
        loop: [roads[0]!, roads[1]!, roads[2]!, roads[1]!],
      },
      busDepotPad: { x: l.x + 3, y: l.y + 3, w: 4, h: 5 },
    });

    const intersection = survey.records.get(
      `${survey.surfaceFrameId}:road:${l.x}:${l.y}`,
    );
    expect(intersection?.kind).toBe("intersection");
    expect(intersection?.metadata.degree).toBe(4);
    expect(
      [...survey.records.values()].filter((r) => r.kind === "bus-stop"),
    ).toHaveLength(2);
    expect(
      [...survey.records.values()].some((r) => r.kind === "bus-depot"),
    ).toBe(true);
    expect(
      [...survey.records.values()].some((r) => r.kind === "structure"),
    ).toBe(true);
    expect(
      [...survey.records.values()].some((r) => r.kind === "building"),
    ).toBe(true);
    const seedStructure = [...survey.records.values()].find(
      (r) => r.kind === "structure",
    )!;
    const colonyBuilding = [...survey.records.values()].find(
      (r) => r.kind === "building",
    )!;
    expect(seedStructure.geometry.type).toBe("point");
    expect(seedStructure.metadata).toMatchObject({ exactFootprint: false });
    expect(colonyBuilding.geometry.type).toBe("point");
    expect(colonyBuilding.metadata).toMatchObject({ exactFootprint: false });

    const from = `${survey.surfaceFrameId}:nav:road:${l.x - 1}:${l.y}`;
    const to = `${survey.surfaceFrameId}:nav:road:${l.x + 1}:${l.y}`;
    expect(survey.findPath(from, to, new Set(["road"]))).toEqual([
      from,
      `${survey.surfaceFrameId}:nav:road:${l.x}:${l.y}`,
      to,
    ]);
  }, 15_000);

  it("supports nested buildings, rooms and portals to tunnels", () => {
    const terrain = new Terrain(new RNG(42));
    const survey = createWorldSurvey({ terrain });
    const hq = survey.addChildFrame({
      id: "kooker-hq",
      parentId: survey.surfaceFrameId,
      kind: "building",
      layer: "interior",
    });
    const boardroom = survey.addChildFrame({
      id: "boardroom",
      parentId: hq.id,
      kind: "room",
      layer: "interior",
    });
    const tunnel = survey.addChildFrame({
      id: "transit-tunnel-1",
      parentId: survey.worldFrameId,
      kind: "region",
      layer: "subsurface",
      grid: {
        width: 200,
        height: 20,
        cellSize: 4,
        origin: { x: 0, y: -12, z: 0 },
      },
    });
    survey.addPortal({
      id: "portal:hq:tunnel",
      address: `${hq.address}/portal/transit-tunnel`,
      fromFrameId: boardroom.id,
      toFrameId: tunnel.id,
      from: { x: 4, y: 0, z: 2 },
      to: { x: 0, y: -12, z: 0 },
      modes: ["walk", "tunnel"],
      metadata: { kind: "lift" },
    });

    expect(boardroom.parentId).toBe(hq.id);
    expect(tunnel.layer).toBe("subsurface");
    expect(
      survey.findPath(
        "portal:hq:tunnel:from",
        "portal:hq:tunnel:to",
        new Set(["tunnel"]),
      ),
    ).toEqual(["portal:hq:tunnel:from", "portal:hq:tunnel:to"]);
  }, 15_000);

  it("keeps the original island addresses stable when another island is added", () => {
    const terrain = new Terrain(new RNG(19));
    const survey = createWorldSurvey({ terrain, worldId: "archipelago" });
    const landingAddress = survey.terrainCell(
      terrain.landing.x,
      terrain.landing.y,
    )!.address;
    const surfaceGrid = survey.frames.get(survey.surfaceFrameId)!.grid;

    const island = survey.addChildFrame({
      id: "island-two",
      parentId: survey.worldFrameId,
      kind: "region",
      layer: "surface",
      transform: {
        position: { x: 10_000, y: 0, z: 4_000 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 304,
        height: 304,
        cellSize: 4,
        origin: { x: -608, y: 0, z: -608 },
      },
    });

    expect(island.address).toContain("/region/island-two");
    expect(
      survey.terrainCell(terrain.landing.x, terrain.landing.y)!.address,
    ).toBe(landingAddress);
    expect(survey.frames.get(survey.surfaceFrameId)!.grid).toEqual(surfaceGrid);
  }, 15_000);

  it("distinguishes vertical occupancy when tunnels overlap surface roads in X/Z", () => {
    const terrain = new Terrain(new RNG(23));
    const cell = terrain.landing;
    const survey = createWorldSurvey({
      terrain,
      roads: [{ ...cell, kind: "avenue" }],
    });
    const road = survey.records.get(
      `${survey.surfaceFrameId}:road:${cell.x}:${cell.y}`,
    )!;
    const tunnel = survey.addRecord({
      id: `${survey.subsurfaceFrameId}:tunnel:test`,
      address: `${survey.frames.get(survey.subsurfaceFrameId)!.address}/tunnel/test`,
      frameId: survey.subsurfaceFrameId,
      layer: "subsurface",
      kind: "road",
      geometry: {
        type: "volume",
        bounds: { x: cell.x, y: cell.y, w: 1, h: 1 },
        yaw: 0,
        vertical: verticalRange(-24, -12, 2, 2),
      },
      metadata: { transport: "tunnel" },
    });
    const deepUtilityInSurfaceFrame = survey.addRecord({
      id: `${survey.surfaceFrameId}:test:deep-utility`,
      address: `${survey.frames.get(survey.surfaceFrameId)!.address}/test/deep-utility`,
      frameId: survey.surfaceFrameId,
      layer: "surface",
      kind: "road",
      geometry: {
        type: "volume",
        bounds: { x: cell.x, y: cell.y, w: 1, h: 1 },
        yaw: 0,
        vertical: verticalRange(-24, -12, 2, 2),
      },
      metadata: {},
    });
    const roadVertical = road.geometry.vertical;
    const crossing = survey.addRecord({
      id: `${survey.surfaceFrameId}:test:crossing`,
      address: `${survey.frames.get(survey.surfaceFrameId)!.address}/test/crossing`,
      frameId: survey.surfaceFrameId,
      layer: "surface",
      kind: "road",
      geometry: {
        type: "volume",
        bounds: { x: cell.x, y: cell.y, w: 1, h: 1 },
        yaw: 0,
        vertical: verticalRange(roadVertical.min, roadVertical.max),
      },
      metadata: {},
    });

    expect(survey.frames.get(survey.subsurfaceFrameId)?.layer).toBe(
      "subsurface",
    );
    expect(survey.frames.get(survey.airFrameId)?.layer).toBe("air");
    expect(survey.frames.get(survey.orbitalFrameId)?.layer).toBe("orbital");
    expect(survey.frames.get(survey.deepSpaceFrameId)?.layer).toBe(
      "deep-space",
    );
    expect(spatialRecordsConflict(road, tunnel)).toBe(false);
    expect(spatialRecordsConflict(road, deepUtilityInSurfaceFrame)).toBe(false);
    expect(spatialRecordsConflict(road, crossing)).toBe(true);
  }, 15_000);

  it("accepts a surveyed bus route before any stops exist", () => {
    const terrain = new Terrain(new RNG(29));
    const survey = createWorldSurvey({
      terrain,
      busRoute: { stops: [], loop: [] },
    });
    expect(
      [...survey.records.values()].filter(
        (record) => record.kind === "bus-route",
      ),
    ).toHaveLength(1);
    expect(
      [...survey.records.values()].filter(
        (record) => record.kind === "bus-stop",
      ),
    ).toHaveLength(0);
    expect(survey.edges.size).toBe(0);
  }, 15_000);

  it("maps an invalid rectangular placement survey as exact transient ghost evidence", () => {
    const terrain = new Terrain(new RNG(31));
    const landing = terrain.landing;
    const placementSurvey: PlacementSurveyResult = {
      ok: false,
      definitionId: "zoned-plot:commercial:big",
      definitionKind: "zoned-plot",
      layoutRevision: "layout:roads-18:lots-7",
      orientation: "e",
      cells: [
        { x: landing.x, y: landing.y },
        { x: landing.x + 1, y: landing.y },
      ],
      bounds: { x: landing.x, y: landing.y, w: 2, h: 1 },
      vertical: {
        min: terrain.worldY(landing.x, landing.y),
        max: terrain.worldY(landing.x + 1, landing.y) + 16,
        clearanceBelow: 0,
        clearanceAbove: 2,
      },
      anchors: [
        { id: "gate", cell: { x: landing.x, y: landing.y } },
        { id: "road", cell: { x: landing.x - 1, y: landing.y } },
      ],
      failures: [
        {
          code: "RENDERED_ROAD_OVERLAP",
          cell: { x: landing.x, y: landing.y },
          detail: "ribbon cell",
        },
        {
          code: "ROAD_CONNECTION_REQUIRED",
          cell: { x: landing.x - 1, y: landing.y },
        },
      ],
    };

    const survey = createWorldSurvey({ terrain, placementSurvey });
    const ghost = survey.records.get(
      `${survey.surfaceFrameId}:placement-ghost:last`,
    );

    expect(ghost).toMatchObject({
      id: `${survey.surfaceFrameId}:placement-ghost:last`,
      address: `${survey.frames.get(survey.surfaceFrameId)!.address}/placement-ghost/last`,
      frameId: survey.surfaceFrameId,
      layer: "surface",
      kind: "placement-ghost",
      geometry: {
        type: "footprint",
        bounds: placementSurvey.bounds,
        elevation: placementSurvey.vertical.min,
        yaw: 0,
        vertical: placementSurvey.vertical,
      },
      metadata: {
        placementGhost: true,
        transient: true,
        valid: false,
        definitionId: placementSurvey.definitionId,
        definitionKind: "zoned-plot",
        layoutRevision: placementSurvey.layoutRevision,
        revision: placementSurvey.layoutRevision,
        orientation: "e",
        cells: placementSurvey.cells,
        anchors: placementSurvey.anchors,
        failures: placementSurvey.failures,
        failureCodes: ["RENDERED_ROAD_OVERLAP", "ROAD_CONNECTION_REQUIRED"],
      },
    });
    expect(ghost && spatialRecordsConflict(ghost, ghost)).toBe(true);

    const replay = createWorldSurvey({ terrain, placementSurvey }).records.get(
      `${survey.surfaceFrameId}:placement-ghost:last`,
    );
    expect(replay).toEqual(ghost);
  }, 15_000);

  it("maps a valid road placement survey as a deterministic transient polyline", () => {
    const terrain = new Terrain(new RNG(37));
    const landing = terrain.landing;
    const cells = [
      { x: landing.x - 1, y: landing.y },
      { x: landing.x, y: landing.y },
      { x: landing.x + 1, y: landing.y },
    ];
    const elevations = cells.map((cell) => terrain.worldY(cell.x, cell.y));
    const placementSurvey: PlacementSurveyResult = {
      ok: true,
      definitionId: "road:street",
      definitionKind: "road",
      layoutRevision: "layout:roads-19:lots-7",
      cells,
      bounds: { x: landing.x - 1, y: landing.y, w: 3, h: 1 },
      vertical: {
        min: Math.min(...elevations),
        max: Math.max(...elevations) + 0.5,
        clearanceBelow: 1,
        clearanceAbove: 4.5,
      },
      anchors: [{ id: "centre", cell: { ...landing } }],
      failures: [],
    };

    const survey = createWorldSurvey({ terrain, placementSurvey });
    const ghost = survey.records.get(
      `${survey.surfaceFrameId}:placement-ghost:last`,
    )!;

    expect(ghost.geometry).toEqual({
      type: "polyline",
      cells,
      closed: false,
      vertical: placementSurvey.vertical,
    });
    expect(ghost.metadata).toMatchObject({
      placementGhost: true,
      transient: true,
      valid: true,
      definitionId: "road:street",
      definitionKind: "road",
      layoutRevision: placementSurvey.layoutRevision,
      cells,
      anchors: placementSurvey.anchors,
      failures: [],
      failureCodes: [],
    });
  }, 15_000);
});
