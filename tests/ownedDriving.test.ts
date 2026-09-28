import { describe, it, expect } from "vitest";
import {
  stepOwnedDrive,
  ownedDriveFootprintClear,
  type OwnedDrivePose,
} from "../src/colony/car/ownedDriving";
import { STOCK_STATS } from "../src/colony/car/carSpec";

const start: OwnedDrivePose = { x: 0, y: 0, heading: 0, speed: 0 };
describe("owned vehicle world driving", () => {
  it("rejects a blocked body centre and uses bounds enclosing the displayed model", () => {
    expect(ownedDriveFootprintClear(start, (x, y) => Math.abs(x) > 0.1 || Math.abs(y) > 0.1)).toBe(false);
    expect(ownedDriveFootprintClear(start, (x, y) => Math.abs(x) <= 0.5 && Math.abs(y) <= 0.2125)).toBe(false);
    expect(ownedDriveFootprintClear({...start, heading: Math.PI / 4}, () => true)).toBe(true);
    expect(ownedDriveFootprintClear({...start, x: NaN}, () => true)).toBe(false);
  });
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
});
