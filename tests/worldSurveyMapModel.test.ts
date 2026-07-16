import { describe, expect, it } from "vitest";
import { Biome } from "../src/colony/terrain";
import type {
  SpatialFrame,
  SpatialRecord,
  TerrainCellRecord,
  WorldSurveyRegistry,
} from "../src/colony/worldSurvey";
import {
  buildWorldSurveyMapModel,
  createSurveyMapProjection,
  inspectSurveySelection,
  recordsAtSurveyCell,
  surveyGridToPixel,
  surveyPixelToGrid,
} from "../src/colony/ui/worldSurveyMapModel";

const FRAME_ID = "universe:test:world:one:region:surface";

function terrainCell(x: number, y: number): TerrainCellRecord {
  return {
    id: `${FRAME_ID}:cell:${x}:${y}`,
    address: `spatial://test/world/one/region/surface/cell/${x}/${y}`,
    frameId: FRAME_ID,
    layer: "surface",
    kind: "terrain-cell",
    cell: { x, y },
    world: { x: (x - 2) * 4, y: x + y, z: (y - 1.5) * 4 },
    biome: x === 0 ? Biome.Ocean : y === 0 ? Biome.Beach : Biome.Plains,
    biomeName: x === 0 ? "ocean" : y === 0 ? "beach" : "plains",
    surface: x === 0 ? "sea" : y === 0 ? "shore" : "land",
    water: x === 0 ? "ocean" : "none",
    buildability: x === 0 ? 0 : y === 0 ? 1 : 2,
    elevation: x + y,
    relief: 1,
    distanceToWater: x,
  };
}

function registryFixture(): WorldSurveyRegistry {
  const frame: SpatialFrame = {
    id: FRAME_ID,
    address: "spatial://test/world/one/region/surface",
    kind: "region",
    layer: "surface",
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    grid: { width: 4, height: 3, cellSize: 4, origin: { x: -8, y: 0, z: -6 } },
  };
  const records = new Map<string, SpatialRecord>();
  const add = (record: SpatialRecord): void => {
    records.set(record.id, record);
  };
  add({
    id: `${FRAME_ID}:garage:gearbox`,
    address: `${frame.address}/garage/gearbox`,
    frameId: FRAME_ID,
    layer: "surface",
    kind: "garage",
    geometry: {
      type: "footprint",
      bounds: { x: 1, y: 1, w: 2, h: 1 },
      elevation: 2,
      yaw: 0.5,
      vertical: { min: 2, max: 8, clearanceBelow: 0, clearanceAbove: 0 },
    },
    metadata: { publicName: "Gearbox" },
  });
  add({
    id: `${FRAME_ID}:road:1:1`,
    address: `${frame.address}/road/1/1`,
    frameId: FRAME_ID,
    layer: "surface",
    kind: "intersection",
    geometry: {
      type: "cell",
      cell: { x: 1, y: 1 },
      vertical: { min: 2, max: 2.5, clearanceBelow: 1, clearanceAbove: 4.5 },
    },
    metadata: { degree: 3 },
  });
  add({
    id: `${FRAME_ID}:bus-route:main`,
    address: `${frame.address}/bus-route/main`,
    frameId: FRAME_ID,
    layer: "surface",
    kind: "bus-route",
    geometry: {
      type: "polyline",
      cells: [
        { x: 0, y: 2 },
        { x: 1, y: 2 },
      ],
      closed: false,
      vertical: { min: 2, max: 5.5, clearanceBelow: 0, clearanceAbove: 0 },
    },
    metadata: {},
  });
  return {
    surfaceFrameId: FRAME_ID,
    frames: new Map([[FRAME_ID, frame]]),
    records,
    terrainCell: (x: number, y: number) =>
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      x < 4 &&
      y >= 0 &&
      y < 3
        ? terrainCell(x, y)
        : undefined,
  } as unknown as WorldSurveyRegistry;
}

describe("fixed full-region survey-map projection", () => {
  it("keeps north up and inverts every cell exactly without content auto-fit", () => {
    const projection = createSurveyMapProjection({
      frameId: FRAME_ID,
      gridWidth: 608,
      gridHeight: 608,
      viewportWidth: 900,
      viewportHeight: 640,
      padding: 16,
    });
    expect(projection.scale).toBeCloseTo(1);
    expect(projection.offsetX).toBe(146);
    expect(projection.offsetY).toBe(16);
    for (const cell of [
      { x: 0, y: 0 },
      { x: 303, y: 401 },
      { x: 607, y: 607 },
    ]) {
      const northWest = surveyGridToPixel(projection, cell);
      expect(
        surveyPixelToGrid(projection, {
          x: northWest.x + projection.scale * 0.5,
          y: northWest.y + projection.scale * 0.5,
        }),
      ).toEqual(cell);
    }
    expect(surveyPixelToGrid(projection, { x: 145.99, y: 100 })).toBeNull();
    expect(surveyPixelToGrid(projection, { x: 500, y: 624 })).toBeNull();
  });
});

describe("world survey map model", () => {
  it("builds exact terrain pixels and classified overlays from the declared frame", () => {
    const model = buildWorldSurveyMapModel(registryFixture(), {
      viewportWidth: 400,
      viewportHeight: 300,
      terrainLayer: "buildability",
      padding: 0,
    });
    expect(model.terrainRgba).toHaveLength(4 * 3 * 4);
    expect(model.elevationRange).toEqual({ min: 0, max: 5 });
    expect(model.overlays.footprints.map((record) => record.kind)).toEqual([
      "garage",
    ]);
    expect(model.overlays.intersections).toHaveLength(1);
    expect(model.overlays.routes).toHaveLength(1);
  });

  it("returns all occupying records and an exact stable-address inspector", () => {
    const registry = registryFixture();
    expect(
      recordsAtSurveyCell(registry, FRAME_ID, { x: 1, y: 1 }).map(
        (record) => record.kind,
      ),
    ).toEqual(["garage", "intersection"]);
    const selection = inspectSurveySelection(
      registry,
      { x: 1, y: 1 },
      `${FRAME_ID}:garage:gearbox`,
    );
    expect(selection?.inspector).toMatchObject({
      selectionType: "record",
      id: `${FRAME_ID}:garage:gearbox`,
      address: "spatial://test/world/one/region/surface/garage/gearbox",
      frameId: FRAME_ID,
      cell: { x: 1.5, y: 1 },
      footprint: { width: 2, depth: 1, yaw: 0.5 },
      elevation: 2,
      metadata: { publicName: "Gearbox" },
    });
  });
});
