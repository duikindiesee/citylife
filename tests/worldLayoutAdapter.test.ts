import { describe, expect, it, vi } from "vitest";
import {
  WorldLayoutAdapterError,
  applyWorldLayoutDocument,
  captureWorldLayoutDocument,
  landscapeOffsetsFromTerrainEdits,
  terrainEditsFromLandscapeOffsets,
  zonedPlacementFromParcel,
  type RuntimeZonedPlacement,
  type WorldLayoutRuntimeSource,
} from "../src/colony/spatial/worldLayoutAdapter";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";

const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
} as const;
const VERTICAL = {
  min: 0,
  max: 8,
  clearanceBelow: 0,
  clearanceAbove: 1,
} as const;

function placement(): RuntimeZonedPlacement {
  return {
    id: "placement:dynamic-commercial-compact-n-10-10",
    definitionId: "zoned-plot:commercial:compact",
    frameId: "surface",
    layer: "surface",
    source: "builder",
    cells: [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
    ],
    bounds: { x: 10, y: 10, w: 2, h: 1 },
    vertical: VERTICAL,
    anchors: [{ id: "entrance", cell: { x: 10, y: 10 } }],
    orientation: "n",
  };
}

function source(): WorldLayoutRuntimeSource {
  return {
    worldId: "seed-4242",
    seed: 4242,
    revision: { number: 1, parentHash: null },
    surfaceFrameId: "surface",
    frames: [
      {
        id: "universe",
        address: "spatial://citylife",
        kind: "universe",
        layer: "deep-space",
        transform: IDENTITY,
        metadata: { activeOccupants: ["private-person"] },
      },
      {
        id: "world",
        address: "spatial://citylife/world/seed-4242",
        kind: "world",
        layer: "orbital",
        parentId: "universe",
        transform: IDENTITY,
      },
      {
        id: "surface",
        address: "spatial://citylife/world/seed-4242/surface",
        kind: "region",
        layer: "surface",
        parentId: "world",
        transform: IDENTITY,
        grid: {
          width: 64,
          height: 64,
          cellSize: 4,
          origin: { x: -128, y: 0, z: -128 },
        },
      },
      {
        id: "surface:building:library",
        address: "spatial://citylife/world/seed-4242/surface/building/library",
        kind: "building",
        layer: "interior",
        parentId: "surface",
        transform: { ...IDENTITY, position: { x: 40, y: 0, z: 40 } },
        metadata: { streamedScene: "renderer-only" },
      },
    ],
    portals: [
      {
        id: "portal:library-door",
        address:
          "spatial://citylife/world/seed-4242/surface/building/library/door",
        fromFrameId: "surface",
        toFrameId: "surface:building:library",
        from: { x: 10, y: 0, z: 10 },
        to: { x: 0, y: 0, z: 1 },
        modes: ["walk", "portal"],
        metadata: { currentVisitor: "private-person" },
      },
    ],
    terrainEdits: [
      { frameId: "surface", cell: { x: 4, y: 5 }, elevation: 2.25 },
    ],
    zonedPlacements: [
      {
        ...placement(),
        ownerCitizenId: "private-person",
        preview: { ok: true },
      } as RuntimeZonedPlacement,
    ],
    roads: [
      { x: 2, y: 2, kind: "avenue" },
      { x: 3, y: 2, kind: "avenue" },
      { x: 4, y: 2, kind: "street" },
    ],
    roadWays: [
      {
        path: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ],
        kind: "avenue",
        width: 3,
        source: "builder",
      },
    ],
    roadVertical: { ...VERTICAL, max: 0.3 },
  };
}

describe("WB.1d world layout runtime adapter", () => {
  it("captures exact durable spatial intent and excludes private and derived runtime state", () => {
    const document = captureWorldLayoutDocument(source());

    expect(document.frames.map((frame) => frame.id)).toContain(
      "surface:building:library",
    );
    expect(document.portals).toHaveLength(1);
    expect(document.terrainEdits[0]).toEqual({
      frameId: "surface",
      cell: { x: 4, y: 5 },
      elevation: 2.25,
    });
    expect(document.placements[0]?.cells).toEqual([
      { x: 10, y: 10 },
      { x: 11, y: 10 },
    ]);
    expect(document.roads.map((road) => road.kind)).toEqual([
      "avenue",
      "street",
    ]);
    expect(document.ways[0]?.cells).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);

    const persisted = JSON.stringify(document);
    expect(persisted).not.toContain("private-person");
    expect(persisted).not.toContain("activeOccupants");
    expect(persisted).not.toContain("currentVisitor");
    expect(persisted).not.toContain("renderer-only");
    expect(persisted).not.toContain("preview");
    expect(document.ways[0]).not.toHaveProperty("source");
  });

  it("builds a complete validated candidate before one atomic commit", () => {
    const document = captureWorldLayoutDocument(source());
    const commit = vi.fn();
    const candidate = applyWorldLayoutDocument(document, commit);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(candidate);
    expect(candidate.layoutRevision).toBe(
      `wl:v1:1:${document.revision.contentHash}`,
    );
    expect(candidate.roads).toEqual([
      { x: 2, y: 2, kind: "avenue" },
      { x: 3, y: 2, kind: "avenue" },
      { x: 4, y: 2, kind: "street" },
    ]);
    expect(candidate.roadWays).toEqual([
      {
        path: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ],
        kind: "avenue",
        width: 3,
      },
    ]);
    expect(
      candidate.frames.find((frame) => frame.id.endsWith("library")),
    ).toBeDefined();
  });

  it("rejects a tampered document without calling the commit boundary", () => {
    const document = captureWorldLayoutDocument(source());
    const tampered = {
      ...document,
      seed: 17,
    } as typeof document;
    const commit = vi.fn();

    expect(() => applyWorldLayoutDocument(tampered, commit)).toThrow(
      /contentHash|digest mismatch/i,
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects conflicting logical road kinds before capture or hydration commits", () => {
    const conflictingSource = {
      ...source(),
      roads: [
        { x: 2, y: 2, kind: "avenue" as const },
        { x: 2, y: 2, kind: "street" as const },
      ],
    };
    expect(() => captureWorldLayoutDocument(conflictingSource)).toThrowError(
      WorldLayoutAdapterError,
    );

    const base = captureWorldLayoutDocument(source());
    const conflicting = createWorldLayoutDocument({
      worldId: base.worldId,
      seed: base.seed,
      revision: { number: 1, parentHash: null },
      frames: base.frames,
      placements: base.placements,
      roads: [
        {
          id: "road:a",
          frameId: "surface",
          layer: "surface",
          kind: "avenue",
          cells: [{ x: 2, y: 2 }],
          vertical: VERTICAL,
        },
        {
          id: "road:b",
          frameId: "surface",
          layer: "surface",
          kind: "street",
          cells: [{ x: 2, y: 2 }],
          vertical: VERTICAL,
        },
      ],
      ways: [],
      terrainEdits: base.terrainEdits,
      portals: base.portals,
    });
    const commit = vi.fn();
    expect(() => applyWorldLayoutDocument(conflicting, commit)).toThrowError(
      WorldLayoutAdapterError,
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects way control points that are not canonical logical road cells", () => {
    const disconnectedSource = source();
    disconnectedSource.roadWays[0]!.path.push({ x: 40, y: 40 });
    expect(() => captureWorldLayoutDocument(disconnectedSource)).toThrow(
      /non-road cell 40,40/,
    );

    const base = captureWorldLayoutDocument(source());
    const disconnected = createWorldLayoutDocument({
      worldId: base.worldId,
      seed: base.seed,
      revision: { number: 1, parentHash: null },
      frames: base.frames,
      placements: base.placements,
      roads: base.roads,
      ways: base.ways.map((way) => ({
        ...way,
        cells: [...way.cells, { x: 40, y: 40 }],
      })),
      terrainEdits: base.terrainEdits,
      portals: base.portals,
    });
    const commit = vi.fn();
    expect(() => applyWorldLayoutDocument(disconnected, commit)).toThrow(
      /non-road cell 40,40/,
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it("round-trips renderer offsets through exact authored elevations", () => {
    const offsets = new Map([
      ["4,5", 0.25],
      ["-2,8", -0.5],
    ]);
    const elevationAt = (x: number, y: number) => x + y / 10;
    const edits = terrainEditsFromLandscapeOffsets(
      offsets,
      "surface",
      elevationAt,
    );

    expect(edits).toEqual([
      { frameId: "surface", cell: { x: 4, y: 5 }, elevation: 4.75 },
      { frameId: "surface", cell: { x: -2, y: 8 }, elevation: -1.7 },
    ]);
    expect(landscapeOffsetsFromTerrainEdits(edits, elevationAt)).toEqual(
      offsets,
    );
  });

  it("projects exact parcel footprints without copying owner or blueprint data", () => {
    const runtimeParcel = {
      id: "dynamic-commercial-compact-n-20-30",
      x: 20,
      y: 35,
      w: 9,
      h: 11,
      doorX: 20,
      doorY: 32,
      gate: { x: 20, y: 30 },
      zone: "commercial" as const,
      ownerCitizenId: "private-person",
      blueprint: "private authored content",
    };
    const projected = zonedPlacementFromParcel(
      runtimeParcel,
      "surface",
      VERTICAL,
    );

    expect(projected.bounds).toEqual({ x: 16, y: 30, w: 9, h: 11 });
    expect(projected.cells).toHaveLength(99);
    expect(projected.orientation).toBe("n");
    expect(projected.definitionId).toBe("zoned-plot:commercial:compact");
    expect(projected.source).toBe("builder");
    expect(JSON.stringify(projected)).not.toContain("private-person");
    expect(JSON.stringify(projected)).not.toContain("blueprint");
  });
});
