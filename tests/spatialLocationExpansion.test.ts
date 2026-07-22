import { describe, expect, it } from "vitest";
import type {
  SpatialFrame,
  SpatialFrameKind,
  SpatialLayer,
  SpatialTransform,
  Vec3,
} from "../src/colony/worldSurvey";
import {
  buildKookerHqInteriorFragment,
  KOOKER_HQ_RECEPTION_CELL_SIZE,
  KOOKER_HQ_RECEPTION_WIDTH_CELLS,
} from "../src/colony/spatial/kookerHqInterior";
import type { WorldLayoutFrame } from "../src/colony/spatial/worldLayoutDocument";
import {
  DEFAULT_PUBLIC_PRESENCE_KINDS,
  relocate,
  resolveLocationInFrame,
  resolvePointBetweenFrames,
  SpatialLocationError,
  toPublicPresence,
  type SpatialLocation,
} from "../src/colony/spatial/spatialLocation";

const identity: SpatialTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function frame(
  id: string,
  parentId: string | undefined,
  transform: SpatialTransform = identity,
  kind: SpatialFrameKind = "region",
  layer: SpatialLayer = "surface",
): SpatialFrame {
  return {
    id,
    address: `spatial://test/${id}`,
    kind,
    layer,
    parentId,
    transform,
  };
}

function frameMap(frames: readonly SpatialFrame[]): Map<string, SpatialFrame> {
  return new Map(frames.map((f) => [f.id, f]));
}

function expectVecClose(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
  expect(actual.z).toBeCloseTo(expected.z, 10);
}

describe("resolvePointBetweenFrames", () => {
  it("returns a copy of the point when source and target are the same frame", () => {
    const frames = frameMap([frame("root", undefined)]);
    const point: Vec3 = { x: 1, y: 2, z: 3 };
    const out = resolvePointBetweenFrames(point, "root", "root", frames);
    expectVecClose(out, point);
    expect(out).not.toBe(point);
  });

  it("resolves a point between two sibling frames through their common ancestor", () => {
    // root at origin; A translated +10 X; B translated +4 Z. A point at A-local origin should land at
    // B-local (10, 0, -4): +10 X into root, then subtract B's +4 Z.
    const root = frame("root", undefined);
    const a = frame("a", "root", {
      ...identity,
      position: { x: 10, y: 0, z: 0 },
    });
    const b = frame("b", "root", {
      ...identity,
      position: { x: 0, y: 0, z: 4 },
    });
    const frames = frameMap([root, a, b]);
    const out = resolvePointBetweenFrames(
      { x: 0, y: 0, z: 0 },
      "a",
      "b",
      frames,
    );
    expectVecClose(out, { x: 10, y: 0, z: -4 });
  });

  it("is exactly invertible between two nested frames including rotation and scale", () => {
    const root = frame("root", undefined);
    const a = frame("a", "root", {
      position: { x: 3, y: -2, z: 7 },
      rotation: { x: 0.3, y: -1.1, z: 0.6 },
      scale: { x: 2, y: 0.5, z: 1.5 },
    });
    const b = frame("b", "root", {
      position: { x: -5, y: 4, z: 1 },
      rotation: { x: -0.2, y: 0.8, z: 0.15 },
      scale: { x: 1.25, y: 3, z: 0.75 },
    });
    const frames = frameMap([root, a, b]);
    const start: Vec3 = { x: 1.7, y: -0.4, z: 2.1 };
    const inB = resolvePointBetweenFrames(start, "a", "b", frames);
    const backInA = resolvePointBetweenFrames(inB, "b", "a", frames);
    expectVecClose(backInA, start);
  });

  it("resolves into an ancestor without applying the ancestor's own transform", () => {
    const root = frame("root", undefined, {
      ...identity,
      position: { x: 100, y: 0, z: 0 },
    });
    const child = frame("child", "root", {
      ...identity,
      position: { x: 5, y: 0, z: 0 },
    });
    const frames = frameMap([root, child]);
    const out = resolvePointBetweenFrames(
      { x: 1, y: 0, z: 0 },
      "child",
      "root",
      frames,
    );
    // 1 + 5 = 6 in root-local; root's own +100 offset is deliberately NOT applied.
    expectVecClose(out, { x: 6, y: 0, z: 0 });
  });

  it("throws NO_COMMON_ANCESTOR for frames under different roots", () => {
    const frames = frameMap([
      frame("root-a", undefined),
      frame("child-a", "root-a"),
      frame("root-b", undefined),
      frame("child-b", "root-b"),
    ]);
    expect(() =>
      resolvePointBetweenFrames(
        { x: 0, y: 0, z: 0 },
        "child-a",
        "child-b",
        frames,
      ),
    ).toThrowError(SpatialLocationError);
  });

  it("throws MISSING_FRAME for an unknown source frame", () => {
    const frames = frameMap([frame("root", undefined)]);
    expect(() =>
      resolvePointBetweenFrames({ x: 0, y: 0, z: 0 }, "ghost", "root", frames),
    ).toThrowError(/does not exist/);
  });
});

describe("SpatialLocation over the authored Kooker HQ fragment", () => {
  // A minimal surface island frame matching what the HQ fragment expects to anchor to.
  const island: WorldLayoutFrame = {
    id: "island",
    address: "spatial://kooker/island",
    kind: "region",
    layer: "surface",
    transform: identity,
    grid: { width: 8, height: 8, cellSize: 4, origin: { x: 0, y: 0, z: 0 } },
  };
  const fragment = buildKookerHqInteriorFragment(island as SpatialFrame, {
    facing: "n",
  });
  const frames = frameMap([
    island as SpatialFrame,
    ...(fragment.frames as SpatialFrame[]),
  ]);

  it("round-trips the door: reception door point resolves back onto the surface entrance", () => {
    const inSurface = resolvePointBetweenFrames(
      fragment.receptionDoorPoint,
      fragment.receptionFrameId,
      island.id,
      frames,
    );
    expectVecClose(inSurface, fragment.entrancePoint);
  });

  it("relocates a reception-interior seat into surface coordinates and back losslessly", () => {
    // A seat one cell in from the reception door along the hall.
    const seat: SpatialLocation = {
      frameId: fragment.receptionFrameId,
      point: {
        x:
          KOOKER_HQ_RECEPTION_WIDTH_CELLS * KOOKER_HQ_RECEPTION_CELL_SIZE * 0.5,
        y: 0,
        z: 3,
      },
    };
    const onSurface = relocate(seat, island.id, frames);
    expect(onSurface.frameId).toBe(island.id);
    const backInReception = relocate(
      onSurface,
      fragment.receptionFrameId,
      frames,
    );
    expectVecClose(backInReception.point, seat.point);

    // resolveLocationInFrame agrees with relocate's point.
    const direct = resolveLocationInFrame(seat, island.id, frames);
    expectVecClose(direct, onSurface.point);
  });

  it("coarsens interior presence to the building, never the room, for public display", () => {
    const seat: SpatialLocation = {
      frameId: fragment.receptionFrameId,
      point: { x: 1, y: 0, z: 1 },
    };
    const presence = toPublicPresence(seat, frames);
    expect(presence.frameId).toBe(fragment.buildingFrameId);
    expect(presence.kind).toBe("building");
    // The exact interior point is not part of the public presence shape.
    expect(Object.keys(presence)).not.toContain("point");
  });

  it("keeps a bare surface location public as its own region", () => {
    const onSurface: SpatialLocation = {
      frameId: island.id,
      point: { x: 2, y: 0, z: 2 },
    };
    const presence = toPublicPresence(onSurface, frames);
    expect(presence.frameId).toBe(island.id);
    expect(DEFAULT_PUBLIC_PRESENCE_KINDS).toContain(presence.kind);
  });
});
