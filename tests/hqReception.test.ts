// HQ.VIEW.1 / HQ.ENTER.1 — the reception's shape, its camera bounds, and its fail-closed gate.
//
// HqReceptionView.tsx decides none of this: it renders what hqReception.ts computes. That split is the
// point — a room of the wrong size or a camera that can walk out through a wall is caught here, in
// node, rather than by someone noticing in a screenshot.
import { describe, expect, it } from "vitest";
import {
  HQ_CAMERA_MAX_M,
  HQ_CAMERA_MIN_M,
  HQ_DOOR_HEIGHT_M,
  HQ_DOOR_WIDTH_M,
  HQ_ROOM_DEPTH_M,
  HQ_ROOM_WIDTH_M,
  HQ_WALL_HEIGHT_M,
  clampHqCameraDistance,
  hqCameraPosition,
  hqDoorway,
  hqWallSegments,
} from "../src/colony/hq/hqReception";
import {
  KOOKER_HQ_RECEPTION_DEPTH_CELLS,
  KOOKER_HQ_RECEPTION_WIDTH_CELLS,
} from "../src/colony/spatial/kookerHqInterior";
import { kookerHqAvailable } from "../src/colony/entitlement/kookerHq";

describe("HQ.VIEW.1 — the room matches the spatial layer", () => {
  it("takes its size from kookerHqInterior, not a second copy of the numbers", () => {
    // If the spatial layer's reception is ever resized, the rendered room must follow automatically.
    // A hardcoded 12x10 here would silently drift, which is exactly how HQ ended up with an interior
    // nothing agreed the position of.
    expect(HQ_ROOM_WIDTH_M).toBe(KOOKER_HQ_RECEPTION_WIDTH_CELLS);
    expect(HQ_ROOM_DEPTH_M).toBe(KOOKER_HQ_RECEPTION_DEPTH_CELLS);
  });

  it("is a double-height lobby, and the door fits inside it", () => {
    expect(HQ_WALL_HEIGHT_M).toBeGreaterThan(4);
    expect(HQ_DOOR_HEIGHT_M).toBeLessThan(HQ_WALL_HEIGHT_M);
    expect(HQ_DOOR_WIDTH_M).toBeLessThan(HQ_ROOM_WIDTH_M);
  });
});

describe("HQ.VIEW.1 — the walls enclose the room", () => {
  const walls = hqWallSegments();

  it("has all four sides, with the front split around the doorway", () => {
    const ids = walls.map((w) => w.id).sort();
    expect(ids).toEqual([
      "back",
      "front-left",
      "front-lintel",
      "front-right",
      "left",
      "right",
    ]);
  });

  it("leaves a real opening the width of the door — not a painted one", () => {
    const left = walls.find((w) => w.id === "front-left")!;
    const right = walls.find((w) => w.id === "front-right")!;
    // The inner edge of each side panel must sit exactly on the doorway's edge, so the gap between
    // them IS the door width. Off by anything and the door is either blocked or the wall has a slot.
    const leftInnerEdge = left.x + left.w / 2;
    const rightInnerEdge = right.x - right.w / 2;
    expect(rightInnerEdge - leftInnerEdge).toBeCloseTo(HQ_DOOR_WIDTH_M, 9);
    expect(leftInnerEdge).toBeCloseTo(-HQ_DOOR_WIDTH_M / 2, 9);
  });

  it("the front panels together span the full wall", () => {
    const left = walls.find((w) => w.id === "front-left")!;
    const right = walls.find((w) => w.id === "front-right")!;
    expect(left.w + right.w + HQ_DOOR_WIDTH_M).toBeCloseTo(HQ_ROOM_WIDTH_M, 9);
  });

  it("caps the doorway with a lintel that reaches the ceiling", () => {
    const lintel = walls.find((w) => w.id === "front-lintel")!;
    // Bottom of the lintel sits on the door head; top of it reaches the wall height. No gap to the sky.
    expect(lintel.y - lintel.h / 2).toBeCloseTo(HQ_DOOR_HEIGHT_M, 9);
    expect(lintel.y + lintel.h / 2).toBeCloseTo(HQ_WALL_HEIGHT_M, 9);
  });

  it("puts every wall on the room boundary, none floating inside it", () => {
    for (const w of walls) {
      const onX = Math.abs(Math.abs(w.x) - HQ_ROOM_WIDTH_M / 2) < 1e-9;
      const onZ = Math.abs(Math.abs(w.z) - HQ_ROOM_DEPTH_M / 2) < 1e-9;
      expect(
        onX || onZ,
        `wall ${w.id} at (${w.x}, ${w.z}) is not on the boundary`,
      ).toBe(true);
    }
  });
});

describe("HQ.VIEW.1 — the camera stays in the room", () => {
  it("clamps to the bounded range", () => {
    expect(clampHqCameraDistance(0)).toBe(HQ_CAMERA_MIN_M);
    expect(clampHqCameraDistance(-50)).toBe(HQ_CAMERA_MIN_M);
    expect(clampHqCameraDistance(1000)).toBe(HQ_CAMERA_MAX_M);
    // An in-range value passes through untouched. (3.1 is inside [2, 4.4]; 7 is not — the
    // limits are deliberately small because the room is 12x10.)
    expect(clampHqCameraDistance(3.1)).toBe(3.1);
  });

  it("resolves a non-finite request instead of NaN-ing the camera", () => {
    // A NaN distance silently blanks the whole scene, which reads as "HQ is broken" rather than
    // "something passed a bad number".
    expect(clampHqCameraDistance(Number.NaN)).toBe(HQ_CAMERA_MAX_M);
    expect(clampHqCameraDistance(Number.POSITIVE_INFINITY)).toBe(
      HQ_CAMERA_MAX_M,
    );
  });

  it("never leaves the room, at any angle or any allowed distance", () => {
    // Sweep a full turn at both limits and assert the camera stays inside the shell. The first draft
    // failed this: a 13 m limit put the camera 9.08 m out in a room whose half-depth is 5 m, orbiting
    // straight through the wall. Margin left for the near plane.
    const halfW = HQ_ROOM_WIDTH_M / 2;
    const halfD = HQ_ROOM_DEPTH_M / 2;
    for (const d of [HQ_CAMERA_MIN_M, HQ_CAMERA_MAX_M, 3.1]) {
      for (let i = 0; i < 64; i++) {
        const p = hqCameraPosition((i / 64) * Math.PI * 2, d);
        expect(Math.abs(p.x), `x at distance ${d}, step ${i}`).toBeLessThan(
          halfW - 0.3,
        );
        expect(Math.abs(p.z), `z at distance ${d}, step ${i}`).toBeLessThan(
          halfD - 0.3,
        );
        // And never through the floor or the ceiling.
        expect(p.y).toBeGreaterThan(0.5);
        expect(p.y).toBeLessThan(HQ_WALL_HEIGHT_M);
      }
    }
  });

  it("an out-of-range request is clamped before it becomes a position", () => {
    const far = hqCameraPosition(0, 999);
    const capped = hqCameraPosition(0, HQ_CAMERA_MAX_M);
    expect(far).toEqual(capped);
  });
});

describe("HQ.ENTER.1 — the gate is fail-closed", () => {
  it("opens only for the dev bypass or a live positive entitlement", () => {
    expect(kookerHqAvailable({ bypass: true, entitlement: null })).toBe(true);
    expect(
      kookerHqAvailable({ bypass: false, entitlement: { enabled: true } }),
    ).toBe(true);
  });

  it("stays shut for every other state", () => {
    expect(kookerHqAvailable({ bypass: false, entitlement: null })).toBe(false);
    expect(
      kookerHqAvailable({ bypass: false, entitlement: { enabled: false } }),
    ).toBe(false);
    // A loading/unknown entitlement must read as closed, not as "not yet denied".
    expect(
      kookerHqAvailable({
        bypass: false,
        entitlement: { enabled: false, reason: "loading" },
      }),
    ).toBe(false);
  });
});

describe("HQ.VIEW.1 — the doorway", () => {
  it("sits centred on the front wall at floor level", () => {
    const d = hqDoorway();
    expect(d.x).toBe(0);
    expect(d.z).toBeCloseTo(-HQ_ROOM_DEPTH_M / 2, 9);
    // Centre of the opening is half its height above the floor — i.e. it starts at the floor.
    expect(d.y - d.h / 2).toBeCloseTo(0, 9);
  });
});
