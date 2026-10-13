import { describe, expect, it, vi } from "vitest";
import {
  ColonyRuntime,
  WorldLayoutPreflightError,
} from "../src/colony/runtime";
import {
  createWorldLayoutDocument,
  serializeWorldLayoutDocument,
  worldLayoutRevisionId,
  type WorldLayoutDocument,
  type WorldLayoutPlacement,
} from "../src/colony/spatial/worldLayoutDocument";
import { validatedWorldLayoutImportSaveInput } from "../src/colony/ui/ColonyApp";
import { createPlacementContext } from "../src/colony/placement/runtimeContext";
import {
  surveyZonedPlot as runPureZonedPlotSurvey,
  type PlacementSurveyResult,
} from "../src/colony/placement/surveyPlacement";
import type { PlacementOrientation } from "../src/colony/placement/placeableCatalog";

function child(
  base: WorldLayoutDocument,
  overrides: Partial<
    Pick<
      WorldLayoutDocument,
      "placements" | "terrainEdits" | "zones" | "reservations"
    >
  >,
): WorldLayoutDocument {
  return createWorldLayoutDocument({
    worldId: base.worldId,
    seed: base.seed,
    generator: base.generator,
    revision: {
      number: base.revision.number + 1,
      parentHash: base.revision.contentHash,
    },
    frames: base.frames,
    zones: overrides.zones ?? base.zones,
    reservations: overrides.reservations ?? base.reservations,
    placements: overrides.placements ?? base.placements,
    roads: base.roads,
    ways: base.ways,
    terrainEdits: overrides.terrainEdits ?? base.terrainEdits,
    networks: base.networks,
    portals: base.portals,
  });
}

interface DiscoveredFixtureCandidate {
  x: number;
  y: number;
  orientation: PlacementOrientation;
  pureSurvey: PlacementSurveyResult;
}

const discoveredFixtureCache = new Map<string, DiscoveredFixtureCandidate>();

function surveyedPlacement(
  runtime: ColonyRuntime,
  base: WorldLayoutDocument,
  valid: boolean,
): WorldLayoutPlacement {
  const revision = worldLayoutRevisionId(base.revision);

  if (valid) {
    const cacheKey = `${base.worldId}:${base.seed}:${revision}`;
    let candidate = discoveredFixtureCache.get(cacheKey);

    if (!candidate) {
      const state = runtime.sim.state;
      const placementContext = createPlacementContext({
        state,
        neighborhood: state.neighborhood,
        commercialDistrict: runtime.commercialDistrict,
        roadWays: state.roadWays,
      });
      const orientations: readonly PlacementOrientation[] = ["n", "s", "w", "e"];
      const maxCandidates = 5000;
      const maxDurationMs = 5000;
      let tested = 0;
      const t0 = performance.now();

      for (let i = 0; i < state.roads.length; i++) {
        const road = state.roads[i]!;
        for (const orientation of orientations) {
          if (
            tested >= maxCandidates ||
            performance.now() - t0 >= maxDurationMs
          ) {
            break;
          }
          tested++;
          const position =
            orientation === "n"
              ? { x: road.x, y: road.y + 1 }
              : orientation === "s"
                ? { x: road.x, y: road.y - 1 }
                : orientation === "w"
                  ? { x: road.x + 1, y: road.y }
                  : { x: road.x - 1, y: road.y };
          const survey = runPureZonedPlotSurvey({
            context: placementContext,
            ...position,
            orientation,
            sizeName: "COMPACT",
            zone: "residential",
          });
          if (survey.ok) {
            candidate = Object.freeze({
              x: position.x,
              y: position.y,
              orientation,
              pureSurvey: Object.freeze(survey),
            });
            break;
          }
        }
        if (
          candidate ||
          tested >= maxCandidates ||
          performance.now() - t0 >= maxDurationMs
        ) {
          break;
        }
      }
      if (!candidate) {
        throw new Error(
          `no valid catalog survey fixture found within ${tested} candidates / ${maxDurationMs}ms`,
        );
      }
      discoveredFixtureCache.set(cacheKey, candidate);
    }

    // Verify chosen coordinate with public runtime.surveyZonedPlot using its actual seeded revision
    const runtimeSurvey = runtime.surveyZonedPlot(
      candidate.x,
      candidate.y,
      candidate.orientation,
      "COMPACT",
      "residential",
      revision,
    );
    expect(runtimeSurvey.ok).toBe(true);

    // Compare complete survey/geometry with pure result
    expect(runtimeSurvey.definitionId).toBe(candidate.pureSurvey.definitionId);
    expect(runtimeSurvey.bounds).toEqual(candidate.pureSurvey.bounds);
    expect(runtimeSurvey.cells).toEqual(candidate.pureSurvey.cells);
    expect(runtimeSurvey.vertical).toEqual(candidate.pureSurvey.vertical);
    expect(runtimeSurvey.anchors).toEqual(candidate.pureSurvey.anchors);

    // Retain stale-revision negative
    const staleSurvey = runtime.surveyZonedPlot(
      candidate.x,
      candidate.y,
      candidate.orientation,
      "COMPACT",
      "residential",
      "stale-invalid-revision-probe",
    );
    expect(staleSurvey.ok).toBe(false);
    expect(
      staleSurvey.failures.some(
        (failure) => failure.code === "STALE_LAYOUT_REVISION",
      ),
    ).toBe(true);

    const cellKeys = new Set(
      runtimeSurvey.cells.map((cell) => `${cell.x},${cell.y}`),
    );
    return {
      id: "placement:zz-preflight-control",
      definitionId: runtimeSurvey.definitionId,
      frameId: base.frames.find(
        (frame) => frame.kind === "region" && frame.layer === "surface",
      )!.id,
      layer: "surface",
      source: "import",
      cells: runtimeSurvey.cells,
      bounds: runtimeSurvey.bounds,
      vertical: runtimeSurvey.vertical,
      anchors: runtimeSurvey.anchors.filter((anchor) =>
        cellKeys.has(`${anchor.cell.x},${anchor.cell.y}`),
      ),
      orientation: candidate.orientation,
    };
  }

  const terrain = runtime.sim.state.terrain;
  for (let y = 20; y < terrain.size - 40; y += 6) {
    for (let x = 20; x < terrain.size - 40; x += 6) {
      const survey = runtime.surveyZonedPlot(
        x,
        y,
        "n",
        "COMPACT",
        "residential",
        revision,
      );
      const terrainFailure = survey.failures.some(
        (failure) =>
          failure.code === "WATER_FORBIDDEN" || failure.code === "NON_BUILDABLE",
      );
      if (terrainFailure) {
        const cellKeys = new Set(
          survey.cells.map((cell) => `${cell.x},${cell.y}`),
        );
        return {
          id: "placement:zz-preflight-invalid",
          definitionId: survey.definitionId,
          frameId: base.frames.find(
            (frame) => frame.kind === "region" && frame.layer === "surface",
          )!.id,
          layer: "surface",
          source: "import",
          cells: survey.cells,
          bounds: survey.bounds,
          vertical: survey.vertical,
          anchors: survey.anchors.filter((anchor) =>
            cellKeys.has(`${anchor.cell.x},${anchor.cell.y}`),
          ),
          orientation: "n",
        };
      }
    }
  }
  throw new Error(`no ${valid ? "valid" : "invalid"} catalog survey fixture`);
}

const vertical = (min: number, max: number) => ({
  min,
  max,
  clearanceBelow: 0,
  clearanceAbove: 0,
});

function genericPlacement(
  template: WorldLayoutPlacement,
  id: string,
  min: number,
  max: number,
): WorldLayoutPlacement {
  const cell = template.cells[0]!;
  return {
    id,
    definitionId: "building:stackable-preflight-fixture",
    frameId: template.frameId,
    layer: "surface",
    source: "import",
    cells: [cell],
    bounds: { x: cell.x, y: cell.y, w: 1, h: 1 },
    vertical: vertical(min, max),
    anchors: [],
  };
}

describe("world layout import runtime preflight", () => {
  it("rejects a correctly hashed catalog footprint on forbidden terrain before CAS and leaves live truth untouched", () => {
    const runtime = new ColonyRuntime(4242);
    const base = runtime.captureWorldLayout();
    runtime.hydrateWorldLayout(base);
    const invalid = surveyedPlacement(runtime, base, false);
    const imported = child(base, { placements: [...base.placements, invalid] });
    const before = serializeWorldLayoutDocument(runtime.worldLayoutDocument()!);
    const elevationBefore = new Float32Array(runtime.sim.state.terrain.elev);
    const save = vi.fn();

    expect(() => {
      const input = validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(imported),
        base,
        (document) => runtime.preflightWorldLayout(document),
      );
      save(input);
    }).toThrow(WorldLayoutPreflightError);
    try {
      runtime.preflightWorldLayout(imported);
    } catch (error) {
      expect((error as WorldLayoutPreflightError).evidence).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/WATER_FORBIDDEN|NON_BUILDABLE/),
        ]),
      );
    }
    expect(save).not.toHaveBeenCalled();
    expect(serializeWorldLayoutDocument(runtime.worldLayoutDocument()!)).toBe(
      before,
    );
    expect(runtime.sim.state.terrain.elev).toEqual(elevationBefore);
  });

  it("accepts a valid surveyed catalog footprint and rejects Float32 overflow before CAS", () => {
    const runtime = new ColonyRuntime(4242);
    const base = runtime.captureWorldLayout();
    runtime.hydrateWorldLayout(base);
    const valid = surveyedPlacement(runtime, base, true);
    const validImport = child(base, {
      placements: [...base.placements, valid],
    });
    expect(
      validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(validImport),
        base,
        (document) => runtime.preflightWorldLayout(document),
      ).placements.some((placement) => placement.id === valid.id),
    ).toBe(true);

    const surface = valid.frameId;
    const cell = valid.cells[0]!;
    const overflow = child(base, {
      terrainEdits: [
        ...base.terrainEdits,
        {
          id: `terrain:${surface}:${cell.x},${cell.y}`,
          frameId: surface,
          cell,
          elevation: Number.MAX_VALUE,
        },
      ],
    });
    const save = vi.fn();
    expect(() => {
      const input = validatedWorldLayoutImportSaveInput(
        serializeWorldLayoutDocument(overflow),
        base,
        (document) => runtime.preflightWorldLayout(document),
      );
      save(input);
    }).toThrow("unsupported elevation");
    expect(save).not.toHaveBeenCalled();
  }, 60_000);

  it("allows disjoint and boundary-touch reservations but rejects overlap", () => {
    const runtime = new ColonyRuntime(4242);
    const base = runtime.captureWorldLayout();
    runtime.hydrateWorldLayout(base);
    const fixture = surveyedPlacement(runtime, base, true);
    const placement = genericPlacement(fixture, "placement:zz-reserved", 0, 10);
    const cell = placement.cells[0]!;
    const cases = [
      { label: "disjoint", min: -20, max: -10, accepted: true },
      { label: "boundary", min: -10, max: 0, accepted: true },
      { label: "overlap", min: -1, max: 1, accepted: false },
    ] as const;

    for (const testCase of cases) {
      const candidate = child(base, {
        placements: [...base.placements, placement],
        reservations: [
          {
            id: `reservation:${testCase.label}`,
            frameId: placement.frameId,
            purpose: testCase.label,
            cells: [cell],
            vertical: vertical(testCase.min, testCase.max),
          },
        ],
      });
      if (testCase.accepted)
        expect(() => runtime.preflightWorldLayout(candidate)).not.toThrow();
      else
        expect(() => runtime.preflightWorldLayout(candidate)).toThrow(
          /RESERVED_VOLUME/,
        );
    }
  }, 60_000);

  it("allows disjoint and boundary-touch stacked placements but rejects overlap", () => {
    const runtime = new ColonyRuntime(4242);
    const base = runtime.captureWorldLayout();
    runtime.hydrateWorldLayout(base);
    const fixture = surveyedPlacement(runtime, base, true);
    const lower = genericPlacement(fixture, "placement:zz-stack-a", 0, 10);
    const cases = [
      { label: "disjoint", min: 20, max: 30, accepted: true },
      { label: "boundary", min: 10, max: 20, accepted: true },
      { label: "overlap", min: 9, max: 20, accepted: false },
    ] as const;

    for (const testCase of cases) {
      const upper = genericPlacement(
        fixture,
        `placement:zz-stack-b-${testCase.label}`,
        testCase.min,
        testCase.max,
      );
      const candidate = child(base, {
        placements: [...base.placements, lower, upper],
      });
      if (testCase.accepted)
        expect(() => runtime.preflightWorldLayout(candidate)).not.toThrow();
      else
        expect(() => runtime.preflightWorldLayout(candidate)).toThrow(
          /PLACEMENT_COLLISION/,
        );
    }
  }, 60_000);
});
