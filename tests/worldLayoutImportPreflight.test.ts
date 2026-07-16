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

function surveyedPlacement(
  runtime: ColonyRuntime,
  base: WorldLayoutDocument,
  valid: boolean,
): WorldLayoutPlacement {
  const orientations = ["n", "s", "e", "w"] as const;
  const candidates: { x: number; y: number; orientation: (typeof orientations)[number] }[] = [];
  if (valid)
    for (const road of base.roads)
      for (const cell of road.cells)
        candidates.push(
          { x: cell.x, y: cell.y + 1, orientation: "n" },
          { x: cell.x, y: cell.y - 1, orientation: "s" },
          { x: cell.x + 1, y: cell.y, orientation: "w" },
          { x: cell.x - 1, y: cell.y, orientation: "e" },
        );
  else {
    const terrain = runtime.sim.state.terrain;
    for (let y = 20; y < terrain.size - 40; y += 6)
      for (let x = 20; x < terrain.size - 40; x += 6)
        candidates.push({ x, y, orientation: "n" });
  }

  const revision = worldLayoutRevisionId(base.revision);
  for (const candidate of candidates) {
    const survey = runtime.surveyZonedPlot(
      candidate.x,
      candidate.y,
      candidate.orientation,
      "COMPACT",
      "residential",
      revision,
    );
    const terrainFailure = survey.failures.some(
      (failure) =>
        failure.code === "WATER_FORBIDDEN" ||
        failure.code === "NON_BUILDABLE",
    );
    if ((valid && !survey.ok) || (!valid && !terrainFailure)) continue;
    const cellKeys = new Set(survey.cells.map((cell) => `${cell.x},${cell.y}`));
    return {
      id: valid ? "placement:zz-preflight-control" : "placement:zz-preflight-invalid",
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
      orientation: candidate.orientation,
    };
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
        expect.arrayContaining([expect.stringMatching(/WATER_FORBIDDEN|NON_BUILDABLE/)]),
      );
    }
    expect(save).not.toHaveBeenCalled();
    expect(serializeWorldLayoutDocument(runtime.worldLayoutDocument()!)).toBe(before);
    expect(runtime.sim.state.terrain.elev).toEqual(elevationBefore);
  });

  it("accepts a valid surveyed catalog footprint and rejects Float32 overflow before CAS", () => {
    const runtime = new ColonyRuntime(4242);
    const base = runtime.captureWorldLayout();
    runtime.hydrateWorldLayout(base);
    const valid = surveyedPlacement(runtime, base, true);
    const validImport = child(base, { placements: [...base.placements, valid] });
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
        reservations: [{
          id: `reservation:${testCase.label}`,
          frameId: placement.frameId,
          purpose: testCase.label,
          cells: [cell],
          vertical: vertical(testCase.min, testCase.max),
        }],
      });
      if (testCase.accepted)
        expect(() => runtime.preflightWorldLayout(candidate)).not.toThrow();
      else
        expect(() => runtime.preflightWorldLayout(candidate)).toThrow(/RESERVED_VOLUME/);
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
        expect(() => runtime.preflightWorldLayout(candidate)).toThrow(/PLACEMENT_COLLISION/);
    }
  }, 60_000);
});
