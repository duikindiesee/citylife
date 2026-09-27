import { describe, expect, it } from "vitest";
import { buildBusNetworkMiniMapModel } from "../src/colony/ui/busNetworkMiniMapModel";
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

  it("keeps published home, Gearbox and Alice Shop destinations inside the fixed map frame", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [],
      landmarks: [
        { id: "gearbox", x: 9, y: 10 },
        { id: "home", x: 34, y: 24 },
        { id: "alice-shop", x: 18, y: 12 },
      ],
      width: 200,
      height: 132,
      padding: 8,
    });

    expect(model.landmarks.map(({ id }) => id)).toEqual([
      "gearbox",
      "home",
      "alice-shop",
    ]);
    expect(model.landmarks[1]).toMatchObject({ id: "home", outOfBounds: false });
    expect(model.bounds).toEqual({ minX: 9, minY: 10, spanX: 25, spanY: 14 });
    for (const landmark of model.landmarks) {
      expect(landmark.x).toBeGreaterThanOrEqual(8);
      expect(landmark.x).toBeLessThanOrEqual(192);
      expect(landmark.y).toBeGreaterThanOrEqual(8);
      expect(landmark.y).toBeLessThanOrEqual(124);
      expect(landmark.markerX).toBeGreaterThanOrEqual(8);
      expect(landmark.markerX).toBeLessThanOrEqual(192);
      expect(landmark.markerY).toBeGreaterThanOrEqual(8);
      expect(landmark.markerY).toBeLessThanOrEqual(124);
    }
  });

  it("moves destination badges away from overlapping live bus markers while preserving exact pin coordinates", () => {
    const model = buildBusNetworkMiniMapModel({
      ways,
      routeStops: [],
      depot: null,
      buses: [{ id: 0, x: 20, y: 10 }],
      landmarks: [{ id: "home", x: 20, y: 10 }],
      width: 200,
      height: 132,
      padding: 8,
    });
    const home = model.landmarks[0]!;
    const bus = model.busClusters[0]!;
    expect(home).toMatchObject({ x: bus.x, y: bus.y });
    expect(Math.hypot(home.markerX - bus.x, home.markerY - bus.y)).toBeGreaterThanOrEqual(11);
  });
});
