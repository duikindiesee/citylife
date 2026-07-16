import { describe, expect, it } from "vitest";
import {
  WorldLayoutDocumentError,
  createWorldLayoutDocument,
  type WorldLayoutDocument,
  type WorldLayoutDocumentInput,
  type WorldLayoutPortal,
} from "../src/colony/spatial/worldLayoutDocument";

const ZERO = { x: 0, y: 0, z: 0 } as const;
const IDENTITY = {
  position: ZERO,
  rotation: ZERO,
  scale: { x: 1, y: 1, z: 1 },
} as const;

function baseInput(): WorldLayoutDocumentInput {
  return {
    worldId: "portal-contract-layout",
    seed: 4242,
    revision: { number: 0, parentHash: null },
    frames: [
      {
        id: "universe",
        address: "spatial://citylife",
        kind: "universe",
        layer: "deep-space",
        transform: IDENTITY,
      },
      {
        id: "surface",
        address: "spatial://citylife/world/portal-contract-layout/surface",
        kind: "region",
        layer: "surface",
        parentId: "universe",
        transform: IDENTITY,
        grid: {
          width: 8,
          height: 8,
          cellSize: 2,
          origin: { x: -4, y: 0, z: -6 },
        },
      },
    ],
    placements: [],
    roads: [],
    ways: [],
    terrainEdits: [],
    portals: [],
  };
}

function baseDocument(): WorldLayoutDocument {
  return createWorldLayoutDocument(baseInput());
}

function portalDocument(
  base: WorldLayoutDocument,
  portal: WorldLayoutPortal,
  mutateFrames?: (
    frames: WorldLayoutDocument["frames"],
  ) => WorldLayoutDocument["frames"],
): WorldLayoutDocument {
  return createWorldLayoutDocument({
    worldId: base.worldId,
    seed: base.seed,
    generator: base.generator,
    revision: {
      number: base.revision.number + 1,
      parentHash: base.revision.contentHash,
    },
    frames: mutateFrames ? mutateFrames(base.frames) : base.frames,
    zones: base.zones,
    reservations: base.reservations,
    placements: base.placements,
    roads: base.roads,
    ways: base.ways,
    terrainEdits: base.terrainEdits,
    networks: base.networks,
    portals: [...base.portals, portal],
  });
}

function expectIntegrityFailure(
  action: () => unknown,
  pathPattern: RegExp,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(WorldLayoutDocumentError);
    expect((error as WorldLayoutDocumentError).code).toBe(
      "REFERENTIAL_INTEGRITY",
    );
    expect((error as WorldLayoutDocumentError).path).toMatch(pathPattern);
    return;
  }
  throw new Error("expected invalid spatial contract to be rejected");
}

describe("WB.1d portal endpoint contract", () => {
  it("rejects a portal whose two endpoints are in the same frame", () => {
    const base = baseDocument();
    const surface = base.frames.find(
      (frame) => frame.kind === "region" && frame.layer === "surface",
    );
    if (!surface) throw new Error("seed surface frame missing");

    expectIntegrityFailure(
      () =>
        portalDocument(base, {
          id: "portal:invalid:same-frame",
          address: `${surface.address}/portal/invalid-same-frame`,
          fromFrameId: surface.id,
          toFrameId: surface.id,
          from: { x: 1, y: 0, z: 1 },
          to: { x: 2, y: 0, z: 2 },
          modes: ["portal"],
        }),
      /^\$\.portals\[\d+\]/,
    );
  });

  it("rejects a portal endpoint outside a gridded frame extent", () => {
    const base = baseDocument();
    const surface = base.frames.find(
      (frame) => frame.kind === "region" && frame.layer === "surface",
    );
    if (!surface) throw new Error("seed surface frame missing");
    const childFrameId = "frame:portal-bounds-room";

    expectIntegrityFailure(
      () =>
        portalDocument(
          base,
          {
            id: "portal:invalid:outside-room",
            address: `${surface.address}/portal/invalid-outside-room`,
            fromFrameId: surface.id,
            toFrameId: childFrameId,
            from: { x: 1, y: 0, z: 1 },
            // The child frame covers local x [10, 18) and z [20, 28); x=18 is outside.
            to: { x: 18, y: 0, z: 21 },
            modes: ["portal", "walk"],
          },
          (frames) => [
            ...frames,
            {
              id: childFrameId,
              address: `${surface.address}/building/portal-bounds-room`,
              kind: "room",
              layer: "interior",
              parentId: surface.id,
              transform: IDENTITY,
              grid: {
                width: 4,
                height: 4,
                cellSize: 2,
                origin: { x: 10, y: 0, z: 20 },
              },
            },
          ],
        ),
      /^\$\.portals\[\d+\]/,
    );
  });

  it("rejects a network node outside its gridded frame extent", () => {
    const input = baseInput();
    expectIntegrityFailure(
      () =>
        createWorldLayoutDocument({
          ...input,
          networks: [
            {
              id: "network:invalid:outside-grid",
              kind: "transport",
              modes: ["walk"],
              nodes: [
                {
                  id: "network-node:inside",
                  frameId: "surface",
                  position: { x: 1, y: 0, z: 1 },
                },
                {
                  id: "network-node:outside",
                  frameId: "surface",
                  // The surface frame covers local x [-4, 12) and z [-6, 10); x=12 is outside.
                  position: { x: 12, y: 0, z: 1 },
                },
              ],
              edges: [],
            },
          ],
        }),
      /^\$\.networks\[\d+\]\.nodes\[\d+\]/,
    );
  });

  it("accepts in-bounds gridded endpoints and finite positions in non-grid frames", () => {
    const input = baseInput();
    const document = createWorldLayoutDocument({
      ...input,
      networks: [
        {
          id: "network:valid:mixed-frames",
          kind: "transport",
          modes: ["portal"],
          nodes: [
            {
              id: "network-node:surface-boundary",
              frameId: "surface",
              position: { x: 11.999, y: 250, z: 9.999 },
            },
            {
              id: "network-node:unbounded-universe",
              frameId: "universe",
              position: { x: 1_000_000, y: -250, z: -1_000_000 },
            },
          ],
          edges: [
            {
              id: "network-edge:mixed-frames",
              fromNodeId: "network-node:surface-boundary",
              toNodeId: "network-node:unbounded-universe",
              modes: ["portal"],
              bidirectional: true,
            },
          ],
        },
      ],
    });

    expect(document.networks[0]?.nodes).toHaveLength(2);
  });
});

describe("WB.1d vertical policy-volume contract", () => {
  it("treats zone clearances as part of the conflicting vertical envelope", () => {
    const input = baseInput();
    expectIntegrityFailure(
      () =>
        createWorldLayoutDocument({
          ...input,
          zones: [
            {
              id: "zone:clearance:a",
              frameId: "surface",
              kind: "commercial",
              cells: [{ x: 2, y: 2 }],
              vertical: {
                min: 0,
                max: 1,
                clearanceBelow: 0,
                clearanceAbove: 2,
              },
            },
            {
              id: "zone:clearance:b",
              frameId: "surface",
              kind: "civic",
              cells: [{ x: 2, y: 2 }],
              vertical: {
                min: 2,
                max: 3,
                clearanceBelow: 0,
                clearanceAbove: 0,
              },
            },
          ],
        }),
      /^\$\.zones\[\d+\]/,
    );
  });

  it("treats reservation clearances as part of the conflicting vertical envelope", () => {
    const input = baseInput();
    expectIntegrityFailure(
      () =>
        createWorldLayoutDocument({
          ...input,
          reservations: [
            {
              id: "reservation:clearance:a",
              frameId: "surface",
              purpose: "surface-works",
              cells: [{ x: 3, y: 3 }],
              vertical: {
                min: 0,
                max: 1,
                clearanceBelow: 0,
                clearanceAbove: 0,
              },
            },
            {
              id: "reservation:clearance:b",
              frameId: "surface",
              purpose: "subsurface-works",
              cells: [{ x: 3, y: 3 }],
              vertical: {
                min: 2,
                max: 3,
                clearanceBelow: 2,
                clearanceAbove: 0,
              },
            },
          ],
        }),
      /^\$\.reservations\[\d+\]/,
    );
  });

  it("allows policy clearance envelopes that only touch at a boundary", () => {
    const input = baseInput();
    const document = createWorldLayoutDocument({
      ...input,
      zones: [
        {
          id: "zone:touching:a",
          frameId: "surface",
          kind: "commercial",
          cells: [{ x: 4, y: 4 }],
          vertical: {
            min: 0,
            max: 1,
            clearanceBelow: 0,
            clearanceAbove: 2,
          },
        },
        {
          id: "zone:touching:b",
          frameId: "surface",
          kind: "civic",
          cells: [{ x: 4, y: 4 }],
          vertical: {
            min: 3,
            max: 4,
            clearanceBelow: 0,
            clearanceAbove: 0,
          },
        },
      ],
    });

    expect(document.zones).toHaveLength(2);
  });
});
