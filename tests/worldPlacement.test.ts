import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { Biome, type Terrain } from "../src/colony/terrain";
import { createPlacementContext } from "../src/colony/placement/runtimeContext";
import { conservativeRoadRibbonBlockedCells } from "../src/colony/placementValidation";
import type { RoadWay } from "../src/colony/render/roadRibbon";
import {
  surveyRoadStroke,
  surveyZonedPlot,
  type PlacementContext,
} from "../src/colony/placement/surveyPlacement";
import type { PlacementOrientation } from "../src/colony/placement/placeableCatalog";

function terrainFixture(
  options: {
    water?: readonly string[];
    shore?: readonly string[];
    blocked?: readonly string[];
  } = {},
): Terrain {
  const size = 100;
  const waterCells = new Set(options.water ?? []);
  const shoreCells = new Set(options.shore ?? []);
  const blockedCells = new Set(options.blocked ?? []);
  const biome = new Uint8Array(size * size);
  const buildable = new Uint8Array(size * size);
  const water = new Uint8Array(size * size);
  biome.fill(Biome.Plains);
  buildable.fill(2);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const key = `${x},${y}`;
      const index = y * size + x;
      if (waterCells.has(key)) water[index] = 1;
      if (shoreCells.has(key)) biome[index] = Biome.Beach;
      if (blockedCells.has(key)) buildable[index] = 0;
    }
  return {
    size,
    biome,
    buildable,
    water,
    idx: (x: number, y: number) => y * size + x,
    inBounds: (x: number, y: number) =>
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < size &&
      y < size,
    isWater: (x: number, y: number) => waterCells.has(`${x},${y}`),
    worldY: () => 4,
  } as unknown as Terrain;
}

function context(
  terrain: Terrain,
  overrides: Partial<Omit<PlacementContext, "terrain">> = {},
): PlacementContext {
  return {
    terrain,
    layoutRevision: "layout-test-1",
    logicalRoadCells: new Set(),
    renderedRoadCells: new Set(),
    occupiedCells: new Set(),
    reservedCells: new Set(),
    ...overrides,
  };
}

const failureCodes = (result: {
  failures: readonly { code: string }[];
}): string[] => result.failures.map((failure) => failure.code);

describe("WB.1c authoritative placement parity", () => {
  let sharedRuntime: ColonyRuntime | undefined;
  function getSharedRuntime(): ColonyRuntime {
    if (!sharedRuntime) sharedRuntime = new ColonyRuntime(4242);
    return sharedRuntime;
  }
  it("uses one terrain contract for valid, wet, shore and non-buildable footprints", () => {
    const roadCell = "51,50";
    const valid = surveyZonedPlot({
      context: context(terrainFixture(), {
        logicalRoadCells: new Set([roadCell]),
      }),
      x: 50,
      y: 50,
      orientation: "e",
      sizeName: "COMPACT",
      zone: "residential",
    });
    expect(valid.ok).toBe(true);
    expect(valid.failures).toEqual([]);

    const wet = surveyZonedPlot({
      context: context(terrainFixture({ water: ["45,50"] }), {
        logicalRoadCells: new Set([roadCell]),
      }),
      x: 50,
      y: 50,
      orientation: "e",
      sizeName: "COMPACT",
      zone: "residential",
    });
    const shore = surveyZonedPlot({
      context: context(terrainFixture({ shore: ["45,50"] }), {
        logicalRoadCells: new Set([roadCell]),
      }),
      x: 50,
      y: 50,
      orientation: "e",
      sizeName: "COMPACT",
      zone: "residential",
    });
    const blocked = surveyZonedPlot({
      context: context(terrainFixture({ blocked: ["45,50"] }), {
        logicalRoadCells: new Set([roadCell]),
      }),
      x: 50,
      y: 50,
      orientation: "e",
      sizeName: "COMPACT",
      zone: "residential",
    });

    expect(failureCodes(wet)).toContain("WATER_FORBIDDEN");
    expect(failureCodes(shore)).toContain("SHORE_FORBIDDEN");
    expect(failureCodes(blocked)).toContain("NON_BUILDABLE");
  });

  it("rotates the complete rectangular footprint rather than only its marker", () => {
    const east = surveyZonedPlot({
      context: context(terrainFixture(), {
        logicalRoadCells: new Set(["51,50"]),
      }),
      x: 50,
      y: 50,
      orientation: "e",
      sizeName: "COMPACT",
      zone: "commercial",
    });
    const north = surveyZonedPlot({
      context: context(terrainFixture(), {
        logicalRoadCells: new Set(["50,49"]),
      }),
      x: 50,
      y: 50,
      orientation: "n",
      sizeName: "COMPACT",
      zone: "commercial",
    });

    expect(east.ok).toBe(true);
    expect(east.orientation).toBe("e");
    expect(east.bounds).toEqual({ x: 40, y: 46, w: 11, h: 9 });
    expect(east.cells).toHaveLength(99);
    expect(north.bounds).toEqual({ x: 46, y: 50, w: 9, h: 11 });
    expect(north.cells).toHaveLength(east.cells.length);
  });

  it("returns stable road survey failure codes", () => {
    const result = surveyRoadStroke({
      context: context(
        terrainFixture({
          water: ["2,2"],
          shore: ["3,3"],
          blocked: ["4,4"],
        }),
        {
          occupiedCells: new Set(["5,5"]),
          reservedCells: new Set(["6,6"]),
        },
      ),
      roadType: "street",
      cells: [
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 4 },
        { x: 5, y: 5 },
        { x: 6, y: 6 },
        { x: -1, y: 0 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(failureCodes(result)).toEqual([
      "OUT_OF_BOUNDS",
      "WATER_FORBIDDEN",
      "SHORE_FORBIDDEN",
      "NON_BUILDABLE",
      "OCCUPIED_VOLUME",
      "RESERVED_VOLUME",
    ]);
    expect(
      failureCodes(
        surveyRoadStroke({
          context: context(terrainFixture()),
          roadType: "street",
          cells: [],
        }),
      ),
    ).toEqual(["EMPTY_FOOTPRINT"]);
  });

  it("keeps public runtime preview equal to the pure validator", () => {
    const runtime = getSharedRuntime();
    const state = runtime.sim.state;
    const dryRoad = state.roads.find((road) => {
      const index = state.terrain.idx(road.x, road.y);
      return (
        !state.terrain.isWater(road.x, road.y) &&
        state.terrain.biome[index] !== Biome.Beach &&
        state.terrain.buildable[index]! >= 1
      );
    })!;
    const wetCell = { x: 0, y: 0 };
    const placementContext = createPlacementContext({
      state,
      neighborhood: state.neighborhood,
      commercialDistrict: runtime.commercialDistrict,
      roadWays: state.roadWays,
    });

    const validRuntime = runtime.surveyRoadPlacement([dryRoad], "street");
    const validPure = surveyRoadStroke({
      context: placementContext,
      cells: [dryRoad],
      roadType: "street",
    });
    expect(validRuntime).toEqual(validPure);
    expect(validRuntime.ok).toBe(true);

    const invalidRuntime = runtime.surveyRoadPlacement([wetCell], "street");
    const invalidPure = surveyRoadStroke({
      context: placementContext,
      cells: [wetCell],
      roadType: "street",
    });
    expect(invalidRuntime).toEqual(invalidPure);
    expect(failureCodes(invalidRuntime)).toContain("WATER_FORBIDDEN");
  }, 20_000);

  it("commits one aliased runtime plot, maps it once, and rejects a stale replay", () => {
    const runtime = getSharedRuntime();
    const state = runtime.sim.state;
    const placementContext = createPlacementContext({
      state,
      neighborhood: state.neighborhood,
      commercialDistrict: runtime.commercialDistrict,
      roadWays: state.roadWays,
    });
    const orientations: readonly PlacementOrientation[] = ["n", "s", "w", "e"];
    let candidate:
      | {
          x: number;
          y: number;
          orientation: PlacementOrientation;
          survey: ReturnType<typeof surveyZonedPlot>;
        }
      | undefined;
    for (const road of state.roads) {
      for (const orientation of orientations) {
        const position =
          orientation === "n"
            ? { x: road.x, y: road.y + 1 }
            : orientation === "s"
              ? { x: road.x, y: road.y - 1 }
              : orientation === "w"
                ? { x: road.x + 1, y: road.y }
                : { x: road.x - 1, y: road.y };
        const survey = surveyZonedPlot({
          context: placementContext,
          ...position,
          orientation,
          sizeName: "COMPACT",
          zone: "residential",
        });
        if (survey.ok) {
          candidate = { ...position, orientation, survey };
          break;
        }
      }
      if (candidate) break;
    }

    expect(
      candidate,
      "seed 4242 must expose at least one validator-approved compact plot",
    ).toBeDefined();
    const approved = candidate!;
    const runtimePreview = runtime.surveyZonedPlot(
      approved.x,
      approved.y,
      approved.orientation,
      "COMPACT",
      "residential",
    );
    expect(runtimePreview).toEqual(approved.survey);

    const lots = runtime.lots();
    expect(state.neighborhood?.parcels).toBe(lots);
    const before = lots.length;
    const committed = runtime.commitZonedPlot(
      approved.x,
      approved.y,
      approved.orientation,
      "COMPACT",
      "residential",
      runtimePreview.layoutRevision,
    );
    expect(committed.ok).toBe(true);
    if (!committed.ok)
      throw new Error("validator-approved plot did not commit");
    expect(runtime.lots()).toHaveLength(before + 1);
    expect(
      runtime.lots().filter((lot) => lot.id === committed.placedId),
    ).toHaveLength(1);

    const mapped = [...runtime.worldSurvey().records.values()].filter(
      (record) => record.metadata.plotId === committed.placedId,
    );
    expect(mapped).toHaveLength(1);

    const staleReplay = runtime.commitZonedPlot(
      approved.x,
      approved.y,
      approved.orientation,
      "COMPACT",
      "residential",
      runtimePreview.layoutRevision,
    );
    expect(staleReplay.ok).toBe(false);
    if (staleReplay.ok) throw new Error("stale replay unexpectedly committed");
    expect(staleReplay.reason).toBe("stale-revision");
    expect(failureCodes(staleReplay.survey)).toContain("STALE_LAYOUT_REVISION");
    expect(runtime.lots()).toHaveLength(before + 1);
  }, 30_000);
});

describe("conservativeRoadRibbonBlockedCells cache safety and mutation controls (R1)", () => {
  it("evaluates deterministic blocked footprint for identical inputs without stale cache poisoning", () => {
    const terrain = terrainFixture();
    const way1: RoadWay = {
      path: [
        { x: 10, y: 10 },
        { x: 10, y: 20 },
      ],
      width: 4,
      kind: "street",
    };
    const ways: RoadWay[] = [way1];

    const result1 = conservativeRoadRibbonBlockedCells(ways, terrain, 0);
    expect(result1.size).toBeGreaterThan(0);

    // Mutation control 1: Mutating the returned Set must not poison subsequent calls
    const sizeBefore = result1.size;
    result1.clear();
    expect(result1.size).toBe(0);

    const result2 = conservativeRoadRibbonBlockedCells(ways, terrain, 0);
    expect(result2.size).toBe(sizeBefore);

    // Mutation control 2: In-place mutation of ways array must immediately update the footprint
    const way2: RoadWay = {
      path: [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
      ],
      width: 4,
      kind: "street",
    };
    ways.push(way2);

    const result3 = conservativeRoadRibbonBlockedCells(ways, terrain, 0);
    expect(result3.size).toBeGreaterThan(sizeBefore);
    expect(result3.has("55,50")).toBe(true);

    // Mutation control 3: In-place path mutation must reflect in recalculated footprint
    way2.path = [
      { x: 80, y: 80 },
      { x: 90, y: 80 },
    ];
    const result4 = conservativeRoadRibbonBlockedCells(ways, terrain, 0);
    expect(result4.has("85,80")).toBe(true);
    expect(result4.has("55,50")).toBe(false);
  });

  it("discriminates placement obstruction through createPlacementContext across dynamic road ways", () => {
    const terrain = terrainFixture();
    const state: any = {
      roads: [],
      roadsVersion: 1,
      terrain,
      neighborhood: { parcels: [] },
      structures: [],
      buildings: [],
    };

    // Initial context with no roads
    const contextNoRoad = createPlacementContext({
      state,
      roadWays: [],
    });
    expect(contextNoRoad.renderedRoadCells.size).toBe(0);

    // Context with a road way directly intersecting coordinates (10, 10)
    const roadWay: RoadWay = {
      path: [
        { x: 5, y: 10 },
        { x: 15, y: 10 },
      ],
      width: 4,
      kind: "street",
    };
    const contextWithRoad = createPlacementContext({
      state,
      roadWays: [roadWay],
    });
    expect(contextWithRoad.renderedRoadCells.has("10,10")).toBe(true);

    // Mutating input array in caller must not poison subsequent separate context
    const waysList: RoadWay[] = [roadWay];
    const contextA = createPlacementContext({ state, roadWays: waysList });
    expect(contextA.renderedRoadCells.has("10,10")).toBe(true);

    waysList.length = 0; // Empty the array in-place
    const contextB = createPlacementContext({ state, roadWays: waysList });
    expect(contextB.renderedRoadCells.size).toBe(0);
  });
});
