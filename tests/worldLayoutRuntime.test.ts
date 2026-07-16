import { beforeEach, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";
import { useRoadNetwork } from "../src/colony/stores/useRoadNetwork";

describe("WB.1d ColonyRuntime layout ownership", () => {
  beforeEach(() => {
    useRoadNetwork.setState({
      tiles: {},
      landscapeEdits: new Map(),
      sameSessionPlacements: new Set(),
    });
  });

  it("preserves seeded legacy behaviour until a document is hydrated", () => {
    const runtime = new ColonyRuntime(4242);

    expect(runtime.worldLayoutDocument()).toBeNull();
    expect(runtime.surveyRoadPlacement([], "street").layoutRevision).toMatch(
      /^layout-v1-/,
    );

    const captured = runtime.captureWorldLayout();
    expect(captured.worldId).toBe("seed-4242");
    expect(captured.seed).toBe(4242);
    expect(captured.revision.number).toBe(0);
    expect(captured.frames.length).toBeGreaterThanOrEqual(7);
  });

  it("publishes validated roads, terrain edits, placements and child frames before start", () => {
    const source = new ColonyRuntime(4242);
    const base = source.captureWorldLayout();
    const surface = base.frames.find(
      (frame) => frame.kind === "region" && frame.layer === "surface",
    )!;
    const libraryFrameId = `${surface.id}:building:library`;
    const editedCell = { x: 10, y: 10 };
    const editedElevation = source.sim.state.terrain.worldY(10, 10) + 0.25;
    const document = createWorldLayoutDocument({
      worldId: base.worldId,
      seed: base.seed,
      revision: {
        number: 1,
        parentHash: base.revision.contentHash,
      },
      frames: [
        ...base.frames,
        {
          id: libraryFrameId,
          address: `${surface.address}/building/library`,
          kind: "building",
          layer: "interior",
          parentId: surface.id,
          transform: {
            position: { x: 40, y: 0, z: 40 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      placements: base.placements,
      roads: base.roads,
      ways: base.ways,
      terrainEdits: [
        { frameId: surface.id, cell: editedCell, elevation: editedElevation },
      ],
      portals: [
        {
          id: "portal:library-door",
          address: `${surface.address}/building/library/door`,
          fromFrameId: surface.id,
          toFrameId: libraryFrameId,
          from: { x: 40, y: 0, z: 40 },
          to: { x: 0, y: 0, z: 1 },
          modes: ["walk", "portal"],
        },
      ],
    });

    const runtime = new ColonyRuntime(4242);
    const hydrated = runtime.hydrateWorldLayout(document);

    expect(hydrated.layoutRevision).toBe(
      `wl:v1:1:${document.revision.contentHash}`,
    );
    expect(runtime.worldLayoutDocument()).toEqual(document);
    expect(runtime.sim.state.roads).toEqual(
      hydrated.roads.map((road) => ({
        x: road.x,
        y: road.y,
        kind:
          road.kind === "avenue" || road.kind === "path" ? road.kind : "street",
      })),
    );
    expect(runtime.sim.state.roadWays).toEqual(hydrated.roadWays);
    expect(runtime.sim.state.terrain.worldY(10, 10)).toBeCloseTo(
      editedElevation,
      4,
    );
    expect(useRoadNetwork.getState().landscapeEdits.has("10,10")).toBe(false);
    expect(runtime.surveyRoadPlacement([], "street").layoutRevision).toBe(
      hydrated.layoutRevision,
    );
    const survey = runtime.worldSurvey();
    expect(survey.frames.has(libraryFrameId)).toBe(true);
    expect(survey.portals.has("portal:library-door")).toBe(true);
    expect(
      document.placements.every((placement) =>
        survey.records.has(placement.id),
      ),
    ).toBe(true);
    expect(runtime.captureWorldLayout().revision.contentHash).toBe(
      document.revision.contentHash,
    );
  });

  it("rejects a mismatched layout without changing the prior live world", () => {
    const runtime = new ColonyRuntime(4242);
    const base = runtime.captureWorldLayout();
    const beforeRoads = runtime.sim.state.roads.map((road) => ({ ...road }));
    const mismatch = createWorldLayoutDocument({
      worldId: "seed-7",
      seed: 7,
      revision: { number: 0, parentHash: null },
      frames: base.frames,
      placements: base.placements,
      roads: base.roads,
      ways: base.ways,
      terrainEdits: base.terrainEdits,
      portals: base.portals,
    });

    expect(() => runtime.hydrateWorldLayout(mismatch)).toThrow(
      /identity mismatch/,
    );
    expect(runtime.worldLayoutDocument()).toBeNull();
    expect(runtime.sim.state.roads).toEqual(beforeRoads);
    expect(useRoadNetwork.getState().tiles).toEqual({});
  });

  it("captures post-hydration edits while preserving untouched imported identities", () => {
    const source = new ColonyRuntime(4242);
    const base = source.captureWorldLayout();
    const roadIds = new Map(
      base.roads.map((road, index) => [road.id, `imported-road-${index}`]),
    );
    const surface = base.frames.find(
      (frame) => frame.kind === "region" && frame.layer === "surface",
    )!;
    const archiveFrameId = `${surface.id}:building:archive`;
    const imported = createWorldLayoutDocument({
      worldId: base.worldId,
      seed: base.seed,
      revision: {
        number: 7,
        parentHash: base.revision.contentHash,
      },
      frames: [
        ...base.frames,
        {
          id: archiveFrameId,
          address: `${surface.address}/building/archive`,
          kind: "building",
          layer: "interior",
          parentId: surface.id,
          transform: {
            position: { x: 8, y: 0, z: 12 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      placements: base.placements,
      roads: base.roads.map((road) => ({
        ...road,
        id: roadIds.get(road.id)!,
      })),
      ways: base.ways.map((way, index) => ({
        ...way,
        id: `imported-way-${index}`,
        ...(way.roadIds
          ? { roadIds: way.roadIds.map((id) => roadIds.get(id)!) }
          : {}),
      })),
      terrainEdits: base.terrainEdits,
      portals: [
        ...base.portals,
        {
          id: "portal:archive-door",
          address: `${surface.address}/building/archive/door`,
          fromFrameId: surface.id,
          toFrameId: archiveFrameId,
          from: { x: 8, y: 0, z: 12 },
          to: { x: 0, y: 0, z: 1 },
          modes: ["walk", "portal"],
        },
      ],
    });
    const importedSnapshot = JSON.stringify(imported);
    const runtime = new ColonyRuntime(4242);

    runtime.hydrateWorldLayout(imported);
    const unchanged = runtime.captureWorldLayout();

    expect(unchanged.revision.contentHash).toBe(imported.revision.contentHash);
    expect(unchanged.roads.map((road) => road.id)).toEqual(
      imported.roads.map((road) => road.id),
    );
    expect(unchanged.ways.map((way) => way.id)).toEqual(
      imported.ways.map((way) => way.id),
    );

    const occupied = new Set(
      runtime.sim.state.roads.map((road) => `${road.x},${road.y}`),
    );
    let added = { x: 0, y: 0 };
    while (occupied.has(`${added.x},${added.y}`))
      added = { x: added.x + 1, y: 0 };
    runtime.sim.state.roads.push({ ...added, kind: "street" });
    runtime.sim.state.roadSet.add(`${added.x},${added.y}`);
    runtime.sim.state.roadKind.set(`${added.x},${added.y}`, "street");
    runtime.sim.state.roadsVersion++;
    useRoadNetwork.setState((state) => ({
      tiles: {
        ...state.tiles,
        [`${added.x},${added.y}`]: {
          ...added,
          type: "street",
          mask: 0,
        },
      },
      landscapeEdits: new Map(state.landscapeEdits).set("10,10", 0.5),
    }));

    const recaptured = runtime.captureWorldLayout();
    const unchangedRoad = imported.roads.find(
      (road) => road.kind !== "street",
    )!;
    const originalStreet = imported.roads.find(
      (road) => road.kind === "street",
    )!;

    expect(recaptured.revision.number).toBe(imported.revision.number + 1);
    expect(recaptured.revision.parentHash).toBe(imported.revision.contentHash);
    expect(recaptured.revision.contentHash).not.toBe(
      imported.revision.contentHash,
    );
    expect(
      recaptured.roads.find((road) => road.kind === unchangedRoad.kind)?.id,
    ).toBe(unchangedRoad.id);
    expect(
      recaptured.roads.find((road) => road.kind === "street")?.id,
    ).not.toBe(originalStreet.id);
    expect(recaptured.ways.map((way) => way.id)).toEqual(
      imported.ways.map((way) => way.id),
    );
    expect(recaptured.frames).toEqual(imported.frames);
    expect(recaptured.portals).toEqual(imported.portals);
    expect(recaptured.placements).toEqual(imported.placements);
    expect(recaptured.terrainEdits).toContainEqual({
      id: `terrain:${
        imported.frames.find(
          (frame) => frame.kind === "region" && frame.layer === "surface",
        )!.id
      }:10,10`,
      frameId: imported.frames.find(
        (frame) => frame.kind === "region" && frame.layer === "surface",
      )!.id,
      cell: { x: 10, y: 10 },
      elevation: runtime.sim.state.terrain.worldY(10, 10) + 0.5,
    });
    expect(runtime.captureWorldLayout()).toEqual(recaptured);
    expect(JSON.stringify(imported)).toBe(importedSnapshot);
  });

  it("materializes generic placements as authoritative registry and placement-policy truth", () => {
    const runtime = new ColonyRuntime(4242);
    const base = runtime.captureWorldLayout();
    const surface = base.frames.find(
      (frame) => frame.kind === "region" && frame.layer === "surface",
    )!;
    const occupied = new Set([
      ...base.roads.flatMap((road) =>
        road.cells.map((cell) => `${cell.x},${cell.y}`),
      ),
      ...base.placements.flatMap((placement) =>
        placement.cells.map((cell) => `${cell.x},${cell.y}`),
      ),
    ]);
    let libraryCell: { x: number; y: number } | undefined;
    const terrain = runtime.sim.state.terrain;
    for (let y = 2; y < terrain.size - 2 && !libraryCell; y++)
      for (let x = 2; x < terrain.size - 2 && !libraryCell; x++) {
        const index = terrain.idx(x, y);
        if (
          !occupied.has(`${x},${y}`) &&
          !terrain.isWater(x, y) &&
          terrain.buildable[index]! >= 1
        )
          libraryCell = { x, y };
      }
    if (!libraryCell) throw new Error("no valid generic placement cell");
    const unsupported = createWorldLayoutDocument({
      worldId: base.worldId,
      seed: base.seed,
      revision: {
        number: 1,
        parentHash: base.revision.contentHash,
      },
      frames: base.frames,
      placements: [
        ...base.placements,
        {
          id: "placement:imported-library",
          definitionId: "commercial-plot:library",
          frameId: surface.id,
          layer: "surface",
          source: "import",
          cells: [libraryCell],
          bounds: { x: libraryCell.x, y: libraryCell.y, w: 1, h: 1 },
          vertical: {
            min: 0,
            max: 8,
            clearanceBelow: 0,
            clearanceAbove: 1,
          },
          anchors: [],
        },
      ],
      roads: base.roads,
      ways: base.ways,
      terrainEdits: base.terrainEdits,
      portals: base.portals,
    });

    const hydrated = runtime.hydrateWorldLayout(unsupported);
    expect(runtime.worldLayoutDocument()).toEqual(unsupported);
    expect(runtime.worldSurvey().records.get("placement:imported-library")).toMatchObject({
      kind: "commercial-plot",
      metadata: {
        definitionId: "commercial-plot:library",
        persisted: true,
      },
    });
    expect(
      runtime
        .surveyRoadPlacement(
          [libraryCell],
          "street",
          hydrated.layoutRevision,
        )
        .failures.map((failure) => failure.code),
    ).toContain("RESERVED_VOLUME");
  });

  it("adopts a saved child revision while running without replacing live spatial state", () => {
    const source = new ColonyRuntime(4242);
    const base = source.captureWorldLayout();
    const head = createWorldLayoutDocument({
      worldId: base.worldId,
      seed: base.seed,
      revision: {
        number: 1,
        parentHash: base.revision.contentHash,
      },
      frames: base.frames,
      placements: base.placements,
      roads: base.roads,
      ways: base.ways,
      terrainEdits: base.terrainEdits,
      portals: base.portals,
    });
    const runtime = new ColonyRuntime(4242);
    runtime.hydrateWorldLayout(head);
    useRoadNetwork.setState((state) => ({
      landscapeEdits: new Map(state.landscapeEdits).set("10,10", 0.25),
    }));
    const saved = runtime.captureWorldLayout();
    const roadsBefore = JSON.stringify(runtime.sim.state.roads);
    const waysBefore = JSON.stringify(runtime.sim.state.roadWays);
    const roadSetBefore = [...runtime.sim.state.roadSet].sort();
    const tilesBefore = JSON.stringify(useRoadNetwork.getState().tiles);
    const editsBefore = [...useRoadNetwork.getState().landscapeEdits].sort();
    const runningRuntime = runtime as unknown as { running: boolean };
    runningRuntime.running = true;

    const adopted = runtime.adoptWorldLayoutRevision(saved);

    expect(adopted).toEqual(saved);
    expect(runtime.worldLayoutDocument()).toEqual(saved);
    expect(runtime.surveyRoadPlacement([], "street").layoutRevision).toBe(
      `wl:v1:${saved.revision.number}:${saved.revision.contentHash}`,
    );
    expect(JSON.stringify(runtime.sim.state.roads)).toBe(roadsBefore);
    expect(JSON.stringify(runtime.sim.state.roadWays)).toBe(waysBefore);
    expect([...runtime.sim.state.roadSet].sort()).toEqual(roadSetBefore);
    expect(JSON.stringify(useRoadNetwork.getState().tiles)).toBe(tilesBefore);
    expect([...useRoadNetwork.getState().landscapeEdits].sort()).toEqual(
      editsBefore,
    );

    const mismatchedPayload = createWorldLayoutDocument({
      worldId: saved.worldId,
      seed: saved.seed,
      revision: {
        number: saved.revision.number + 1,
        parentHash: saved.revision.contentHash,
      },
      frames: saved.frames,
      placements: saved.placements,
      roads: saved.roads,
      ways: saved.ways,
      terrainEdits: [
        ...saved.terrainEdits,
        {
          frameId: saved.frames.find(
            (frame) => frame.kind === "region" && frame.layer === "surface",
          )!.id,
          cell: { x: 11, y: 11 },
          elevation: runtime.sim.state.terrain.worldY(11, 11) + 1,
        },
      ],
      portals: saved.portals,
    });
    expect(() => runtime.adoptWorldLayoutRevision(mismatchedPayload)).toThrow(
      /does not match current runtime intent/,
    );
    const wrongWorld = createWorldLayoutDocument({
      worldId: "seed-7",
      seed: 7,
      revision: {
        number: saved.revision.number + 1,
        parentHash: saved.revision.contentHash,
      },
      frames: saved.frames,
      placements: saved.placements,
      roads: saved.roads,
      ways: saved.ways,
      terrainEdits: saved.terrainEdits,
      portals: saved.portals,
    });
    expect(() => runtime.adoptWorldLayoutRevision(wrongWorld)).toThrow(
      /identity mismatch/,
    );
    expect(runtime.worldLayoutDocument()).toEqual(saved);
    expect(JSON.stringify(runtime.sim.state.roads)).toBe(roadsBefore);
    runningRuntime.running = false;
  });
});
