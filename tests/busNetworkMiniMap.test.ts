import { describe, expect, it } from "vitest";
import {
  buildBusNetworkMiniMapModel,
  resolveLocalPlayerMapPosition,
} from "../src/colony/ui/busNetworkMiniMapModel";
import type { RoadWay } from "../src/colony/render/roadRibbon";

const ways: RoadWay[] = [
  {
    kind: "street",
    width: 3,
    source: "builder",
    path: [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ],
  },
  {
    kind: "street",
    width: 3,
    source: "depot-spur",
    path: [
      { x: 20, y: 10 },
      { x: 20, y: 14 },
    ],
  },
];

describe("local player map position", () => {
  it("uses the live owned-car pose before the first-person camera or roster pose", () => {
    expect(
      resolveLocalPlayerMapPosition({
        drivePose: { x: 24, y: 31 },
        cameraCell: { x: 23, y: 30 },
        exactLocalPresence: { x: 22, y: 29 },
      }),
    ).toEqual({ x: 24, y: 31 });
  });

  it("uses the live camera capsule for an on-foot player without a citizen-roster match", () => {
    expect(
      resolveLocalPlayerMapPosition({
        cameraCell: { x: 14.25, y: 18.5 },
        exactLocalPresence: null,
      }),
    ).toEqual({ x: 14.25, y: 18.5 });
  });

  it("does not fabricate a location from absent, malformed, or non-local pose data", () => {
    expect(resolveLocalPlayerMapPosition({})).toBeNull();
    expect(
      resolveLocalPlayerMapPosition({
        drivePose: { x: Number.NaN, y: 4 },
        cameraCell: null,
        exactLocalPresence: null,
      }),
    ).toBeNull();
  });

  it("does not reuse a stale first-person pose in builder or aerial view", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerViewActive: false,
        drivePose: { x: 24, y: 31 },
        cameraCell: { x: 23, y: 30 },
        exactLocalPresence: { x: 22, y: 29 },
      }),
    ).toBeNull();
  });
});

describe("always-visible bus network minimap model", () => {
  it("projects every road way, route stop, depot and live coach into the fixed viewport", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [
        { x: 12, y: 10 },
        { x: 18, y: 10 },
      ],
      depot: { x: 20, y: 14 },
      buses: [
        { id: 0, x: 15, y: 10 },
        { id: 1, x: 20, y: 12 },
      ],
      player: { x: 16, y: 10 },
      width: 200,
      height: 132,
      padding: 8,
    });
    expect(model.roads).toHaveLength(2);
    expect(model.stops).toHaveLength(2);
    expect(model.buses).toHaveLength(2);
    expect(model.busClusters.reduce((sum, c) => sum + c.ids.length, 0)).toBe(2);
    expect(model.depot).not.toBeNull();
    expect(model.player).not.toBeNull();
    expect(model.player!.outOfBounds).toBe(false);
    for (const p of [
      ...model.stops,
      ...model.buses,
      model.depot!,
      model.player!,
    ]) {
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThanOrEqual(192);
      expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.y).toBeLessThanOrEqual(124);
    }
  });

  it("clusters overlapping coaches and preserves the visible fleet count", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [0, 1, 2, 3, 4].map((id) => ({ id, x: 15, y: 10 })),
      width: 200,
      height: 132,
      padding: 8,
    });
    expect(model.busClusters).toHaveLength(1);
    expect(model.busClusters[0]!.ids).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps a stable non-zero scale for a one-cell network", () => {
    const model = buildBusNetworkMiniMapModel({
      ways: [{ kind: "street", width: 3, path: [{ x: 4, y: 4 }] }],
      routeStops: [],
      depot: null,
      buses: [],
      width: 180,
      height: 120,
      padding: 8,
    });
    expect(model.roads[0]!.points).toMatch(/^\d/);
    expect(model.bounds.spanX).toBeGreaterThan(0);
    expect(model.bounds.spanY).toBeGreaterThan(0);
  });

  it("keeps network bounds fixed as moving markers travel and indicates off-map positions", () => {
    const first = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [{ x: 12, y: 10 }],
      depot: { x: 20, y: 14 },
      buses: [{ id: 0, x: 15, y: 10 }],
      player: { x: 16, y: 10 },
      width: 200,
      height: 132,
      padding: 8,
    });
    const moved = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [{ x: 12, y: 10 }],
      depot: { x: 20, y: 14 },
      buses: [{ id: 0, x: 500, y: 400 }],
      player: { x: -100, y: 900 },
      width: 200,
      height: 132,
      padding: 8,
    });

    expect(moved.bounds).toEqual(first.bounds);
    expect(moved.roads).toEqual(first.roads);
    expect(moved.buses[0]!.outOfBounds).toBe(true);
    expect(moved.player!.outOfBounds).toBe(true);
    expect(moved.buses[0]!.x).toBe(192);
    expect(moved.buses[0]!.y).toBe(124);
    expect(moved.player!.x).toBe(8);
    expect(moved.player!.y).toBe(124);
  });
});
