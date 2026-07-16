import { describe, expect, it } from "vitest";
import type {
  SpatialFrame,
  SpatialLayer,
  SpatialTransform,
  SpatialFrameKind,
} from "../src/colony/worldSurvey";
import {
  FrameTransformError,
  localToParent,
  parentToLocal,
  resolvePointToAncestor,
  resolvePointToRoot,
} from "../src/colony/spatial/frameTransforms";

const identity: SpatialTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function frame(
  id: string,
  parentId?: string,
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

function expectVecClose(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
  expect(actual.z).toBeCloseTo(expected.z, 10);
}

describe("spatial frame transforms", () => {
  it("round-trips translation, XYZ Euler rotation and non-uniform scale", () => {
    const transform: SpatialTransform = {
      position: { x: 25, y: -4, z: 81 },
      rotation: { x: 0.37, y: -1.12, z: 0.63 },
      scale: { x: 2, y: 0.5, z: 3.25 },
    };
    const local = { x: -7.5, y: 12, z: 4.25 };
    const parent = localToParent(local, transform);

    expect(parent).not.toEqual(local);
    expectVecClose(parentToLocal(parent, transform), local);
  });

  it("resolves a room in a building on a second island to the immutable root", () => {
    const root = frame("world-root", undefined, identity, "world", "orbital");
    const secondIsland = frame("island-two", root.id, {
      position: { x: 1_000, y: 0, z: 2_000 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    const building = frame(
      "hq",
      secondIsland.id,
      {
        position: { x: 10, y: 0, z: 20 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 2, y: 2, z: 2 },
      },
      "building",
      "interior",
    );
    const room = frame(
      "boardroom",
      building.id,
      {
        position: { x: 1, y: 3, z: 2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      "room",
      "interior",
    );
    const frames = new Map(
      [root, secondIsland, building, room].map((value) => [value.id, value]),
    );

    const resolved = resolvePointToRoot({ x: 4, y: 1, z: 6 }, room.id, frames);
    expect(resolved.rootFrameId).toBe(root.id);
    expectVecClose(resolved.point, { x: 1_036, y: 8, z: 1_980 });
    expectVecClose(
      resolvePointToAncestor(
        { x: 4, y: 1, z: 6 },
        room.id,
        secondIsland.id,
        frames,
      ),
      { x: 20, y: 8, z: 36 },
    );
  });

  it("does not mutate or transform a point already expressed in root coordinates", () => {
    const root = frame("root");
    const frames = new Map([[root.id, root]]);
    const rootPoint = Object.freeze({ x: 608, y: 42, z: -304 });

    const resolved = resolvePointToRoot(rootPoint, root.id, frames);
    expect(resolved).toEqual({ point: rootPoint, rootFrameId: root.id });
    expect(rootPoint).toEqual({ x: 608, y: 42, z: -304 });
  });

  it("reports missing frames, missing parents, cycles and unrelated ancestors", () => {
    const root = frame("root");
    const orphan = frame("orphan", "missing-parent");
    const cycleA = frame("cycle-a", "cycle-b");
    const cycleB = frame("cycle-b", "cycle-a");
    const otherRoot = frame("other-root");
    const frames = new Map(
      [root, orphan, cycleA, cycleB, otherRoot].map((value) => [
        value.id,
        value,
      ]),
    );

    const codeOf = (operation: () => unknown): string | undefined => {
      try {
        operation();
        return undefined;
      } catch (error) {
        expect(error).toBeInstanceOf(FrameTransformError);
        return (error as FrameTransformError).code;
      }
    };

    expect(
      codeOf(() => resolvePointToRoot({ x: 0, y: 0, z: 0 }, "absent", frames)),
    ).toBe("MISSING_FRAME");
    expect(
      codeOf(() => resolvePointToRoot({ x: 0, y: 0, z: 0 }, orphan.id, frames)),
    ).toBe("MISSING_PARENT");
    expect(
      codeOf(() => resolvePointToRoot({ x: 0, y: 0, z: 0 }, cycleA.id, frames)),
    ).toBe("FRAME_CYCLE");
    expect(
      codeOf(() =>
        resolvePointToAncestor(
          { x: 0, y: 0, z: 0 },
          root.id,
          otherRoot.id,
          frames,
        ),
      ),
    ).toBe("NOT_ANCESTOR");
  });

  it("rejects inverse transforms with a zero scale component", () => {
    expect(() =>
      parentToLocal(
        { x: 1, y: 2, z: 3 },
        { ...identity, scale: { x: 1, y: 0, z: 1 } },
      ),
    ).toThrowError(FrameTransformError);
  });
});
