import { describe, expect, it } from "vitest";
import {
  buildBusNetworkMiniMapModel,
  canShowPlayerLocationForAccount,
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
  it("fails closed for every render until runtime identity matches the current account", () => {
    const canShow = (
      isCityLifePlayer: boolean,
      authenticatedAccountKey: string | null,
      runtimeAccountKey: string | null,
    ) =>
      canShowPlayerLocationForAccount({
        isCityLifePlayer,
        authenticatedAccountKey,
        runtimeAccountKey,
      });

    expect(canShow(true, "player-a", "player-a")).toBe(true);
    // The account changed in place, but the passive runtime-binding effect has not run yet.
    expect(canShow(true, "player-b", "player-a")).toBe(false);
    expect(canShow(true, "player-b", null)).toBe(false);
    expect(canShow(true, null, "player-a")).toBe(false);
    // An operator account does not receive player-private map data just because it has an ID.
    expect(canShow(false, "player-a", "player-a")).toBe(false);
    // The map may reveal the new account's location after the runtime has rebound.
    expect(canShow(true, "player-b", "player-b")).toBe(true);
  });

  it("allows an exact runtime-owned car pose without a mapped citizen", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        operatorCitizenId: null,
        activeCitizenId: null,
        drivePose: { x: 24, y: 31 },
        cameraCell: { x: 23, y: 30 },
        exactOwnPresence: null,
      }),
    ).toEqual({ x: 24, y: 31 });
  });

  it("does not use camera or presence when no citizen is mapped", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        operatorCitizenId: null,
        activeCitizenId: null,
        drivePose: null,
        cameraCell: { x: 23, y: 30 },
        exactOwnPresence: {
          subjectId: "unmapped-player",
          cell: { x: 22, y: 29 },
        },
      }),
    ).toBeNull();
  });

  it("uses the live owned-car pose before the first-person camera or roster pose", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        operatorCitizenId: "player-1",
        activeCitizenId: "player-1",
        drivePose: { x: 24, y: 31 },
        cameraCell: { x: 23, y: 30 },
        exactOwnPresence: {
          subjectId: "player-1",
          cell: { x: 22, y: 29 },
        },
      }),
    ).toEqual({ x: 24, y: 31 });
  });

  it("uses the live camera capsule for an on-foot player without a citizen-roster match", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        operatorCitizenId: "player-1",
        activeCitizenId: "player-1",
        cameraCell: { x: 14.25, y: 18.5 },
        exactOwnPresence: null,
      }),
    ).toEqual({ x: 14.25, y: 18.5 });
  });

  it("never uses an inspected citizen's camera or marker as the signed-in player's position", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        operatorCitizenId: "player-1",
        activeCitizenId: "citizen-under-inspection",
        cameraCell: { x: 50, y: 60 },
        exactOwnPresence: {
          subjectId: "citizen-under-inspection",
          cell: { x: 50, y: 60 },
        },
      }),
    ).toBeNull();
  });

  it("uses an exact presence fix only when it belongs to the account's citizen", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        operatorCitizenId: "player-1",
        activeCitizenId: null,
        exactOwnPresence: {
          subjectId: "player-1",
          cell: { x: 22, y: 29 },
        },
      }),
    ).toEqual({ x: 22, y: 29 });
  });

  it("does not fabricate a location from absent, malformed, or non-local pose data", () => {
    expect(resolveLocalPlayerMapPosition({})).toBeNull();
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: false,
        cameraCell: { x: 14.25, y: 18.5 },
      }),
    ).toBeNull();
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: true,
        drivePose: { x: Number.NaN, y: 4 },
        operatorCitizenId: "player-1",
        activeCitizenId: null,
        cameraCell: null,
        exactOwnPresence: null,
      }),
    ).toBeNull();
  });

  it("does not show personal location in builder or aerial view", () => {
    expect(
      resolveLocalPlayerMapPosition({
        playerLocationAuthorized: false,
        operatorCitizenId: "player-1",
        activeCitizenId: "player-1",
        drivePose: { x: 24, y: 31 },
        cameraCell: { x: 23, y: 30 },
        exactOwnPresence: {
          subjectId: "player-1",
          cell: { x: 22, y: 29 },
        },
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
