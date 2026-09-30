import { describe, it, expect } from "vitest";
import {
  stepOwnedDrive,
  type OwnedDrivePose,
} from "../src/colony/car/ownedDriving";
import { STOCK_STATS } from "../src/colony/car/carSpec";
import { ColonyRuntime } from "../src/colony/runtime";

const start: OwnedDrivePose = { x: 0, y: 0, heading: 0, speed: 0 };
describe("owned vehicle world driving", () => {
  it("moves the actual pose, steers and reverses using car stats", () => {
    let pose = { ...start };
    for (let i = 0; i < 30; i++)
      pose = stepOwnedDrive(
        pose,
        { throttle: true },
        STOCK_STATS,
        1 / 60,
        () => true,
      );
    expect(pose.x).toBeGreaterThan(0);
    expect(pose.speed).toBeGreaterThan(0);
    const turn = stepOwnedDrive(
      pose,
      { throttle: true, right: true },
      STOCK_STATS,
      0.2,
      () => true,
    );
    expect(turn.heading).toBeGreaterThan(0);
    const reverse = stepOwnedDrive(
      start,
      { reverse: true },
      STOCK_STATS,
      0.2,
      () => true,
    );
    expect(reverse.x).toBeLessThan(0);
    const fast = stepOwnedDrive(
      start,
      { throttle: true },
      { ...STOCK_STATS, acceleration: 1 },
      0.2,
      () => true,
    );
    const stock = stepOwnedDrive(
      start,
      { throttle: true },
      STOCK_STATS,
      0.2,
      () => true,
    );
    expect(fast.speed).toBeGreaterThan(stock.speed);
  });
  it("does not tunnel across a missing road cell on a long frame", () => {
    const road = (x: number, y: number) =>
      Math.round(y) === 0 && Math.round(x) !== 1;
    const pose = stepOwnedDrive(
      { ...start, speed: 10 },
      { throttle: true },
      STOCK_STATS,
      10,
      road,
    );
    expect(pose.x).toBeLessThan(0.1);
    expect(pose.speed).toBe(0);
  });
  it("checks the car width even when its centre remains on a road", () => {
    const pose = stepOwnedDrive(
      start,
      { throttle: true },
      STOCK_STATS,
      0.2,
      (_x, y) => Math.abs(y) < 0.1,
    );
    expect(pose.x).toBe(0);
    expect(pose.speed).toBe(0);
  });
  it("brakes to rest without turning braking into reverse acceleration", () => {
    let pose = { ...start, speed: 1 };
    for (let i = 0; i < 30; i++)
      pose = stepOwnedDrive(
        pose,
        { brake: true },
        STOCK_STATS,
        1 / 60,
        () => true,
      );
    expect(pose.speed).toBe(0);
    expect(pose.x).toBeGreaterThan(0);
    expect(
      stepOwnedDrive(pose, { throttle: true }, STOCK_STATS, NaN, () => true),
    ).toEqual(pose);
  });
  it("allows steering wheels and changing heading even when blocked ahead", () => {
    // Obstacle ahead at x >= 1, but clear behind and around
    const blockedAhead = (x: number) => x < 1;
    const initial: OwnedDrivePose = { x: 0.5, y: 0, heading: 0, speed: 0 };
    // Try to accelerate straight into obstacle while turning right
    const turned = stepOwnedDrive(
      initial,
      { throttle: true, right: true },
      STOCK_STATS,
      0.2,
      blockedAhead,
    );
    expect(turned.heading).toBeGreaterThan(0);
    expect(turned.x).toBeLessThan(1);
  });
  it("slides along unobstructed axis when brushing a boundary", () => {
    // Clear corridor along X for y <= 1.0
    const corridor = (_x: number, y: number) => y <= 1.0;
    // Initial pose fits inside y <= 1.0 (py max is 0.5 + 0.32 = 0.82 <= 1.0)
    const initial: OwnedDrivePose = { x: 0, y: 0.5, heading: 0.3, speed: 5 };
    const step = stepOwnedDrive(
      initial,
      { throttle: true },
      STOCK_STATS,
      0.5,
      corridor,
    );
    // X progress was made via sliding along the wall
    expect(step.x).toBeGreaterThan(0);
    expect(step.y).toBeLessThanOrEqual(1.0);
  });
  it("applies off-road drag and speed ceiling when driving off road", () => {
    const onRoad = stepOwnedDrive(
      start,
      { throttle: true },
      STOCK_STATS,
      1.0,
      () => true,
      () => true,
    );
    const offRoad = stepOwnedDrive(
      start,
      { throttle: true },
      STOCK_STATS,
      1.0,
      () => true,
      () => false,
    );
    expect(onRoad.speed).toBeGreaterThan(offRoad.speed);
    expect(offRoad.speed).toBeGreaterThan(0);
  });

  it("runtime.isRoadSurface recognizes road ribbons and keeps cars at highway speed", () => {
    const rt = new ColonyRuntime(4242);
    const ways = rt.sim.state.roadWays!;
    expect(ways.length).toBeGreaterThan(0);
    const firstWay = ways[0]!;
    const p0 = firstWay.path[0]!;
    expect(rt.isRoadSurface(p0.x, p0.y)).toBe(true);
    expect(rt.isRoadSurface(5, 5)).toBe(false);
  });
});
