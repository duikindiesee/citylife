// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { createHash } from "node:crypto";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { createWorldLayoutDocument } from "../src/colony/spatial/worldLayoutDocument";
import { validateCanonicalTransitAuthority } from "../src/colony/transit/canonicalTransit";
import {
  createWorldLayoutManifestEnvelope,
  validateWorldLayoutManifestEnvelope,
} from "../src/colony/spatial/transitManifestEnvelope";
import * as transitDerivationModule from "../src/colony/transit/deriveTransitMaterialization";
import { validatedWorldLayoutImportSaveInput } from "../src/colony/ui/ColonyApp";
import {
  WorldLayoutBootCoordinator,
  WorldLayoutBootError,
} from "../src/colony/worldLayoutBoot";
import { useRoadNetwork } from "../src/colony/stores/useRoadNetwork";

const r0Url = new URL(
  "../fixtures/canonical-world/seed-4242-layout-r0.json",
  import.meta.url,
);
const r1Url = new URL(
  "../fixtures/canonical-world/seed-4242-starter-parcel-manifest-r1-physical-candidate.json",
  import.meta.url,
);

describe("Transit Hydration & Canonical Export (e81ea9de)", () => {
  it("preserves exact R0 repo-local artifact size and hash and asserts fail-closed compatibility under current derivation", () => {
    const rawBytes = readFileSync(r0Url);
    expect(rawBytes.length).toBe(259869);
    const sha = createHash("sha256").update(rawBytes).digest("hex");
    expect(sha).toBe(
      "ba13be286091aabce8fc04e0cfee054c3fc618f525e90be453217df7d668cca0",
    );
    const r0Doc = JSON.parse(rawBytes.toString("utf8"));

    const rt = new ColonyRuntime(4242);
    const constructorLoopPoints = rt.busRoute?.loop.length ?? 0;
    const constructorStops = rt.busRoute?.stops.length ?? 0;
    expect(constructorLoopPoints).toBe(2292);
    expect(constructorStops).toBe(6);

    rt.hydrateWorldLayout(r0Doc);

    // Road count changed from constructor 9732 to adopted 4137
    expect(rt.sim.state.roadKind.size).toBe(4137);

    // Historical R0 lacks valid transit geometry under current derivation and fails closed
    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("preserves exact R1 repo-local artifact size and hash and asserts fail-closed compatibility under current derivation", () => {
    const rawBytes = readFileSync(r1Url);
    expect(rawBytes.length).toBe(1598322);
    const sha = createHash("sha256").update(rawBytes).digest("hex");
    expect(sha).toBe(
      "4df43688b8ec5e9a2fc68af662fde88cf8b0f26e02bc932dc21fef59f8a3673a",
    );
    const r1Manifest = JSON.parse(rawBytes.toString("utf8"));
    const r1Doc = r1Manifest.layout;

    const rt = new ColonyRuntime(4242);
    rt.hydrateWorldLayout(r1Doc);

    // Road count is adopted 4137
    expect(rt.sim.state.roadKind.size).toBe(4137);

    // Historical R1 lacks valid transit geometry under current derivation and fails closed
    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("hydrates own-capture layout preserving full 6-stop circuit", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();

    rt.hydrateWorldLayout(doc);

    expect(rt.sim.state.roadKind.size).toBe(9732);
    expect(rt.busRoute!.stops.length).toBe(6);
    expect(rt.busRoute!.loop.length).toBe(2292);
    expect(rt.busStopAnchors().length).toBe(6);

    const exportAuth = rt.exportCanonicalTransitAuthority();
    expect(exportAuth).not.toBeNull();
    expect(exportAuth!.layoutRevision).toBe(doc.revision.contentHash);
    const validation = validateCanonicalTransitAuthority(
      exportAuth,
      exportAuth!.worldId,
      exportAuth!.layoutRevision,
      5,
      true,
    );
    expect(validation.valid).toBe(true);
  });

  it("fails closed on diagnostic 0-road layout without leaving phantom buses", () => {
    const rt = new ColonyRuntime(4242);
    expect(rt.busRoute).not.toBeNull();
    expect(rt.busDepot).not.toBeNull();

    const rawBytes = readFileSync(r0Url);
    const r0Doc = JSON.parse(rawBytes.toString("utf8"));
    const zeroRoadDoc = createWorldLayoutDocument({
      ...r0Doc,
      roads: [],
      ways: [],
      revision: {
        number: r0Doc.revision.number + 1,
        parentHash: r0Doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(zeroRoadDoc);

    // Roads zeroed
    expect(rt.sim.state.roadKind.size).toBe(0);

    // Transit state completely cleared
    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.sim.state.busDepotPad).toBeNull();
    expect(rt.sim.state.busDepotSpurCells!.size).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("fails closed on disconnected roads where route loop cannot close", () => {
    const rt = new ColonyRuntime(4242);
    const rawBytes = readFileSync(r0Url);
    const r0Doc = JSON.parse(rawBytes.toString("utf8"));

    // Sever the roads: keep only a tiny 10-cell disconnected stub
    const severedDoc = createWorldLayoutDocument({
      ...r0Doc,
      roads: [
        {
          ...r0Doc.roads[0],
          cells: r0Doc.roads[0].cells.slice(0, 10),
        },
      ],
      ways: [],
      revision: {
        number: r0Doc.revision.number + 1,
        parentHash: r0Doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(severedDoc);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("fails closed on removed depot spur road negative", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const site = rt.busDepot!.site;
    const minY = Math.min(site.gate.y, site.roadCell.y);
    const maxY = Math.max(site.gate.y, site.roadCell.y);

    // Filter out the spur road cells connecting gate to roadCell
    const spurRemovedDoc = createWorldLayoutDocument({
      ...doc,
      roads: doc.roads.map((r: any) => ({
        ...r,
        cells: r.cells.filter(
          (c: any) => !(c.x === site.roadCell.x && c.y > minY && c.y < maxY),
        ),
      })),
      ways: doc.ways.filter((w: any) => (w as any).id !== "depot-spur" && (w as any).source !== "depot-spur"),
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(spurRemovedDoc);

    // Route still exists, but depot spur is unpaved, so transit fails closed cleanly
    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("fails closed on depot placement overlap negative", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    const kioskCells: { x: number; y: number }[] = [];
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        kioskCells.push({ x: pad.x + 2 + dx, y: pad.y + 2 + dy });
      }
    }
    const overlappingDoc = createWorldLayoutDocument({
      ...doc,
      placements: [
        ...doc.placements,
        {
          id: "placement:test:depot-conflict",
          frameId: surface.id,
          layer: "surface",
          definitionId: "commercial-plot:kiosk",
          source: "import",
          anchors: [{ id: "entrance", cell: { x: pad.x + 2, y: pad.y + 2 } }],
          bounds: { x: pad.x + 2, y: pad.y + 2, w: 2, h: 2 },
          cells: kioskCells,
          vertical: { min: 0, max: 10, clearanceAbove: 2, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(overlappingDoc);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("fails closed on depot reservation overlap negative", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    // Inject a conflicting reservation across pad cells
    const overlappingDoc = createWorldLayoutDocument({
      ...doc,
      reservations: [
        ...doc.reservations,
        {
          id: "reservation:test:pad-conflict",
          frameId: surface.id,
          purpose: "nature-reserve",
          cells: [
            { x: pad.x + 2, y: pad.y + 2 },
            { x: pad.x + 3, y: pad.y + 2 },
            { x: pad.x + 4, y: pad.y + 2 },
          ],
          vertical: { min: 0, max: 5, clearanceAbove: 1, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(overlappingDoc);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("fails closed on translated child reservation overlapping depot pad", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    const childFrameId = `${surface.id}:test:translated-overlap`;
    const childFrame = {
      id: childFrameId,
      address: `${surface.address}/region/translated-overlap`,
      kind: "region" as const,
      layer: "surface" as const,
      parentId: surface.id,
      transform: {
        position: {
          x: surface.grid!.origin.x + (pad.x + 2) * surface.grid!.cellSize,
          y: 0,
          z: surface.grid!.origin.z + (pad.y + 2) * surface.grid!.cellSize,
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 512,
        height: 512,
        cellSize: surface.grid!.cellSize,
        origin: { x: 0, y: 0, z: 0 },
      },
    };

    const docWithChild = createWorldLayoutDocument({
      ...doc,
      frames: [...doc.frames, childFrame],
      reservations: [
        ...doc.reservations,
        {
          id: "reservation:test:child-overlap",
          frameId: childFrameId,
          purpose: "nature-reserve",
          cells: [{ x: 0, y: 0 }],
          vertical: { min: 0, max: 10, clearanceAbove: 1, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithChild);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("preserves transit on translated child reservation outside depot pad", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;

    const childFrameId = `${surface.id}:test:translated-nonoverlap`;
    const childFrame = {
      id: childFrameId,
      address: `${surface.address}/region/translated-nonoverlap`,
      kind: "region" as const,
      layer: "surface" as const,
      parentId: surface.id,
      transform: {
        position: {
          x: surface.grid!.origin.x + 10 * surface.grid!.cellSize,
          y: 0,
          z: surface.grid!.origin.z + 10 * surface.grid!.cellSize,
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 512,
        height: 512,
        cellSize: surface.grid!.cellSize,
        origin: { x: 0, y: 0, z: 0 },
      },
    };

    // Child-local (182, 301) translates to physical surface (192, 311) which is outside pad
    const docWithChild = createWorldLayoutDocument({
      ...doc,
      frames: [...doc.frames, childFrame],
      reservations: [
        ...doc.reservations,
        {
          id: "reservation:test:child-nonoverlap",
          frameId: childFrameId,
          purpose: "nature-reserve",
          cells: [{ x: 182, y: 301 }],
          vertical: { min: 0, max: 10, clearanceAbove: 1, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithChild);

    expect(rt.busRoute).not.toBeNull();
    expect(rt.busDepot).not.toBeNull();
    expect(rt.busStopAnchors().length).toBe(6);
    expect(rt.exportCanonicalTransitAuthority()).not.toBeNull();
  });

  it("fails closed on translated child placement overlapping depot pad", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    const childFrameId = `${surface.id}:test:placement-overlap`;
    const childFrame = {
      id: childFrameId,
      address: `${surface.address}/region/placement-overlap`,
      kind: "region" as const,
      layer: "surface" as const,
      parentId: surface.id,
      transform: {
        position: {
          x: surface.grid!.origin.x + (pad.x + 2) * surface.grid!.cellSize,
          y: 0,
          z: surface.grid!.origin.z + (pad.y + 2) * surface.grid!.cellSize,
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 512,
        height: 512,
        cellSize: surface.grid!.cellSize,
        origin: { x: 0, y: 0, z: 0 },
      },
    };

    const docWithChild = createWorldLayoutDocument({
      ...doc,
      frames: [...doc.frames, childFrame],
      placements: [
        ...doc.placements,
        {
          id: "placement:test:child-kiosk",
          frameId: childFrameId,
          layer: "surface",
          definitionId: "commercial-plot:kiosk",
          source: "import",
          anchors: [{ id: "entrance", cell: { x: 0, y: 0 } }],
          bounds: { x: 0, y: 0, w: 2, h: 2 },
          cells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
          vertical: { min: 0, max: 10, clearanceAbove: 2, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithChild);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("preserves transit on translated child placement outside depot pad", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;

    const childFrameId = `${surface.id}:test:placement-nonoverlap`;
    const childFrame = {
      id: childFrameId,
      address: `${surface.address}/region/placement-nonoverlap`,
      kind: "region" as const,
      layer: "surface" as const,
      parentId: surface.id,
      transform: {
        position: {
          x: surface.grid!.origin.x + 10 * surface.grid!.cellSize,
          y: 0,
          z: surface.grid!.origin.z + 10 * surface.grid!.cellSize,
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 512,
        height: 512,
        cellSize: surface.grid!.cellSize,
        origin: { x: 0, y: 0, z: 0 },
      },
    };

    const docWithChild = createWorldLayoutDocument({
      ...doc,
      frames: [...doc.frames, childFrame],
      placements: [
        ...doc.placements,
        {
          id: "placement:test:child-kiosk-far",
          frameId: childFrameId,
          layer: "surface",
          definitionId: "commercial-plot:kiosk",
          source: "import",
          anchors: [{ id: "entrance", cell: { x: 0, y: 0 } }],
          bounds: { x: 0, y: 0, w: 2, h: 2 },
          cells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
          vertical: { min: 0, max: 10, clearanceAbove: 2, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithChild);

    expect(rt.busRoute).not.toBeNull();
    expect(rt.busDepot).not.toBeNull();
    expect(rt.busStopAnchors().length).toBe(6);
    expect(rt.exportCanonicalTransitAuthority()).not.toBeNull();
  });

  it("fails closed on rotated child cell overlapping pad when center is outside", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    const childFrameId = `${surface.id}:test:rotated-overlap`;
    const childFrame = {
      id: childFrameId,
      address: `${surface.address}/region/rotated-overlap`,
      kind: "region" as const,
      layer: "surface" as const,
      parentId: surface.id,
      transform: {
        position: {
          x: surface.grid!.origin.x + (pad.x - 4) * surface.grid!.cellSize,
          y: 0,
          z: surface.grid!.origin.z + (pad.y + 5) * surface.grid!.cellSize,
        },
        rotation: { x: 0, y: Math.PI / 4, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 512,
        height: 512,
        cellSize: 4 * surface.grid!.cellSize,
        origin: { x: 0, y: 0, z: 0 },
      },
    };

    const docWithChild = createWorldLayoutDocument({
      ...doc,
      frames: [...doc.frames, childFrame],
      reservations: [
        ...doc.reservations,
        {
          id: "reservation:test:rotated-overlap",
          frameId: childFrameId,
          purpose: "nature-reserve",
          cells: [{ x: 0, y: 0 }],
          vertical: { min: 0, max: 10, clearanceAbove: 1, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithChild);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("preserves transit on rotated child cell where AABB overlaps pad but polygon is disjoint", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    const childFrameId = `${surface.id}:test:rotated-nonoverlap`;
    const childFrame = {
      id: childFrameId,
      address: `${surface.address}/region/rotated-nonoverlap`,
      kind: "region" as const,
      layer: "surface" as const,
      parentId: surface.id,
      transform: {
        position: {
          x: surface.grid!.origin.x + (pad.x - 8) * surface.grid!.cellSize,
          y: 0,
          z: surface.grid!.origin.z + (pad.y - 5) * surface.grid!.cellSize,
        },
        rotation: { x: 0, y: Math.PI / 4, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 512,
        height: 512,
        cellSize: 8 * surface.grid!.cellSize,
        origin: { x: 0, y: 0, z: 0 },
      },
    };

    const docWithChild = createWorldLayoutDocument({
      ...doc,
      frames: [...doc.frames, childFrame],
      reservations: [
        ...doc.reservations,
        {
          id: "reservation:test:rotated-nonoverlap",
          frameId: childFrameId,
          purpose: "nature-reserve",
          cells: [{ x: 0, y: 0 }],
          vertical: { min: 0, max: 10, clearanceAbove: 1, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithChild);

    expect(rt.busRoute).not.toBeNull();
    expect(rt.busDepot).not.toBeNull();
    expect(rt.busStopAnchors().length).toBe(6);
    expect(rt.exportCanonicalTransitAuthority()).not.toBeNull();
  });

  it("preserves prior state atomically when surface frame is displaced", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const originalRoute = rt.busRoute;
    const originalDepot = rt.busDepot;

    // Displace the surface frame transform
    const displacedDoc = createWorldLayoutDocument({
      ...doc,
      frames: doc.frames.map((f, i) =>
        i === 0
          ? {
              ...f,
              transform: {
                ...f.transform,
                position: {
                  x: f.transform.position.x + 10,
                  y: f.transform.position.y,
                  z: f.transform.position.z,
                },
              },
            }
          : f,
      ),
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    expect(() => rt.hydrateWorldLayout(displacedDoc)).toThrow(
      /world layout changed the original island frame/,
    );

    expect(rt.busRoute).toBe(originalRoute);
    expect(rt.busDepot).toBe(originalDepot);
  });

  it("preserves prior state atomically when transit derivation throws after valid schema preflight", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const originalRoadCount = rt.sim.state.roadKind.size;
    const originalRoute = rt.busRoute;
    const originalDepot = rt.busDepot;
    const originalLastMin = (rt as any).transitLastMin;

    // Spy on deriveTransitMaterialization to throw an unexpected error after schema validation
    const spy = vi
      .spyOn(transitDerivationModule, "deriveTransitMaterialization")
      .mockImplementationOnce(() => {
        throw new Error("Simulated unexpected transit preflight error");
      });

    try {
      expect(() => rt.hydrateWorldLayout(doc)).toThrow(
        /Simulated unexpected transit preflight error/,
      );

      // Prior state is 100% preserved
      expect(rt.sim.state.roadKind.size).toBe(originalRoadCount);
      expect(rt.busRoute).toBe(originalRoute);
      expect(rt.busDepot).toBe(originalDepot);
      expect((rt as any).transitLastMin).toBe(originalLastMin);
    } finally {
      spy.mockRestore();
    }
  });

  it("exercises the real standalone manifest envelope seam and round-trips transit authority", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const transitAuth = rt.exportCanonicalTransitAuthority();
    expect(transitAuth).not.toBeNull();

    // Create manifest envelope
    const envelope = createWorldLayoutManifestEnvelope(doc, transitAuth);
    expect(envelope.layout).toBe(doc);
    expect(envelope.transit).toBe(transitAuth);

    // Validate envelope
    const validResult = validateWorldLayoutManifestEnvelope(envelope);
    expect(validResult.valid).toBe(true);

    // Negative: mismatched layoutRevision in transit authority
    const mismatchedEnvelope = createWorldLayoutManifestEnvelope(doc, {
      ...transitAuth!,
      layoutRevision: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    const invalidResult =
      validateWorldLayoutManifestEnvelope(mismatchedEnvelope);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.error).toBe("CANONICAL_TRANSIT_UNAVAILABLE");
  });

  it("produces deterministic export payloads across repeated hydrations", () => {
    const rawBytes = readFileSync(r1Url);
    const r1Doc = JSON.parse(rawBytes.toString("utf8")).layout;

    const rtA = new ColonyRuntime(4242);
    rtA.hydrateWorldLayout(r1Doc);
    const exportA = JSON.stringify(rtA.exportCanonicalTransitAuthority());

    const rtB = new ColonyRuntime(4242);
    rtB.hydrateWorldLayout(r1Doc);
    const exportB = JSON.stringify(rtB.exportCanonicalTransitAuthority());

    expect(exportA).toBe(exportB);
  });

  it("fails closed on root 16-cell reservation overlapping depot pad", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    const cells = Array.from({ length: 16 }, (_, i) => ({
      x: pad.x + 1 + (i % 4),
      y: pad.y + 1 + Math.floor(i / 4),
    }));

    const docWithReservation = createWorldLayoutDocument({
      ...doc,
      reservations: [
        ...doc.reservations,
        {
          id: "reservation:test:root-16cell-overlap",
          frameId: surface.id,
          purpose: "nature-reserve",
          cells,
          vertical: { min: 0, max: 10, clearanceAbove: 1, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithReservation);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("fails closed on scaled child reservation overlapping pad even when center is outside", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const surface = doc.frames.find(
      (f) => f.kind === "region" && f.layer === "surface",
    )!;
    expect(rt.busDepot).not.toBeNull();
    const pad = rt.busDepot!.site;

    const childFrameId = `${surface.id}:test:scaled-overlap`;
    const childFrame = {
      id: childFrameId,
      address: `${surface.address}/region/scaled-overlap`,
      kind: "region" as const,
      layer: "surface" as const,
      parentId: surface.id,
      transform: {
        position: {
          x: surface.grid!.origin.x + (pad.x - 3) * surface.grid!.cellSize,
          y: 0,
          z: surface.grid!.origin.z + (pad.y + 1) * surface.grid!.cellSize,
        },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      grid: {
        width: 512,
        height: 512,
        cellSize: 4 * surface.grid!.cellSize,
        origin: { x: 0, y: 0, z: 0 },
      },
    };

    const docWithChild = createWorldLayoutDocument({
      ...doc,
      frames: [...doc.frames, childFrame],
      reservations: [
        ...doc.reservations,
        {
          id: "reservation:test:scaled-overlap",
          frameId: childFrameId,
          purpose: "nature-reserve",
          cells: [{ x: 0, y: 0 }],
          vertical: { min: 0, max: 10, clearanceAbove: 1, clearanceBelow: 0 },
        },
      ],
      revision: {
        number: doc.revision.number + 1,
        parentHash: doc.revision.contentHash,
      },
    });

    rt.hydrateWorldLayout(docWithChild);

    expect(rt.busRoute).toBeNull();
    expect(rt.busDepot).toBeNull();
    expect(rt.busFleet).toBeNull();
    expect(rt.busStopAnchors().length).toBe(0);
    expect(rt.exportCanonicalTransitAuthority()).toBeNull();
  });

  it("accepts manifest envelope with valid transit companion in validatedWorldLayoutImportSaveInput", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const transitAuth = rt.exportCanonicalTransitAuthority();
    expect(transitAuth).not.toBeNull();

    const envelope = {
      layout: doc,
      transit: transitAuth,
      walkability: { schemaVersion: "citylife.walkability/v1", walkableCells: 100 },
      physicalColliders: { schemaVersion: "citylife.physical-colliders/v1", colliders: [] },
    };

    const saveInput = validatedWorldLayoutImportSaveInput(
      JSON.stringify(envelope),
      doc,
      (imported) => rt.preflightWorldLayout(imported),
    );

    expect(saveInput.worldId).toBe(doc.worldId);
    expect(saveInput.seed).toBe(doc.seed);
  });

  it("rejects manifest envelope with mismatched transit companion in validatedWorldLayoutImportSaveInput", () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const transitAuth = rt.exportCanonicalTransitAuthority();
    expect(transitAuth).not.toBeNull();

    const corruptedEnvelope = {
      layout: doc,
      transit: {
        ...transitAuth!,
        layoutRevision: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    };

    expect(() =>
      validatedWorldLayoutImportSaveInput(
        JSON.stringify(corruptedEnvelope),
        doc,
        (imported) => rt.preflightWorldLayout(imported),
      ),
    ).toThrow(/Imported manifest transit companion validation failed/);
  });

  it("boots remote starter catalogue with valid transit companion in worldLayoutBoot", async () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const transitAuth = rt.exportCanonicalTransitAuthority();
    expect(transitAuth).not.toBeNull();

    const store = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => ({
        status: "saved" as const,
        revision: {
          worldId: doc.worldId,
          layoutRevision: doc.revision.contentHash,
          sequence: doc.revision.number,
          document: doc,
        },
      })),
    };
    const remoteLoader = {
      loadRemoteStarterCatalogue: vi.fn(async () => ({
        published: true,
        manifest: {
          worldId: doc.worldId,
          layoutRevision: doc.revision.contentHash,
          layout: doc,
          transit: transitAuth,
          walkability: { status: "ready" },
          physicalColliders: { colliders: [] },
        },
      })),
    };

    const coordinator = new WorldLayoutBootCoordinator({
      worldId: doc.worldId,
      store,
      runtime: rt,
      remoteLoader,
      requireRemoteAuthority: true,
    });

    const result = await coordinator.boot();
    expect(result.ready).toBe(true);
    expect(result.source).toBe("canonical_remote");
    expect(rt.busRoute).not.toBeNull();
    expect(rt.busDepot).not.toBeNull();
    expect(rt.busStopAnchors().length).toBe(6);
  });

  it("rejects remote starter catalogue with mismatched transit companion in worldLayoutBoot", async () => {
    const rt = new ColonyRuntime(4242);
    const doc = rt.captureWorldLayout();
    const transitAuth = rt.exportCanonicalTransitAuthority();
    expect(transitAuth).not.toBeNull();

    const store = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => ({
        status: "saved" as const,
        revision: {
          worldId: doc.worldId,
          layoutRevision: doc.revision.contentHash,
          sequence: doc.revision.number,
          document: doc,
        },
      })),
    };
    const remoteLoader = {
      loadRemoteStarterCatalogue: vi.fn(async () => ({
        published: true,
        manifest: {
          worldId: doc.worldId,
          layoutRevision: doc.revision.contentHash,
          layout: doc,
          transit: {
            ...transitAuth!,
            layoutRevision: "0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
      })),
    };

    const coordinator = new WorldLayoutBootCoordinator({
      worldId: doc.worldId,
      store,
      runtime: rt,
      remoteLoader,
      requireRemoteAuthority: true,
    });

    await expect(coordinator.boot()).rejects.toMatchObject({
      code: "CANONICAL_TRANSIT_UNAVAILABLE",
    });
  });

  it("rederives and binds transit companion to dirty exported layout revision after supported landscape edit", () => {
    const rt = new ColonyRuntime(4242);
    const initial = rt.captureWorldLayout();
    rt.hydrateWorldLayout(initial);
    useRoadNetwork.getState().applyLandscapeEdit(100, 100, "raise");
    const layout = rt.captureWorldLayout();
    expect(layout.revision.contentHash).not.toBe(initial.revision.contentHash);
    const transit = rt.exportCanonicalTransitAuthority();
    expect(transit).not.toBeNull();
    expect(transit!.layoutRevision).toBe(layout.revision.contentHash);
  });

  it("fails closed on invalid dirty depot slope that breaks transit instead of exporting stale transit", () => {
    useRoadNetwork.setState({ tiles: {}, landscapeEdits: new Map() });
    const rt = new ColonyRuntime(4242);
    const initial = rt.captureWorldLayout();
    rt.hydrateWorldLayout(initial);
    const pad = rt.sim.state.busDepotPad;
    expect(pad).not.toBeNull();
    for (let n = 0; n < 40; n++) {
      useRoadNetwork.getState().applyLandscapeEdit(pad!.x + 2, pad!.y + 2, "raise");
    }
    const layout = rt.captureWorldLayout();
    expect(layout.revision.contentHash).not.toBe(initial.revision.contentHash);
    const transit = rt.exportCanonicalTransitAuthority(layout);
    expect(transit).toBeNull();
    const defaultTransit = rt.exportCanonicalTransitAuthority();
    expect(defaultTransit).toBeNull();
  });
});
