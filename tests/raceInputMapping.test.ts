import { describe, expect, it } from "vitest";

import {
  gamepadRaceInput,
  gyroSteerFromOrientation,
  normalizeRaceDriveInput,
  type GamepadLike,
} from "../src/colony/racing/race";

const button = (pressed: boolean) => ({ pressed });

describe("Road Rally additive input mapping", () => {
  it("normalizes keyboard/touch, gyro, and gamepad steer into one deterministic drive input", () => {
    expect(normalizeRaceDriveInput({ steerLeft: true })).toMatchObject({
      steer: -1,
      throttle: false,
      brake: false,
    });
    expect(
      normalizeRaceDriveInput({ steerRight: true, accelerate: true }),
    ).toMatchObject({
      steer: 1,
      throttle: true,
      brake: false,
    });
    expect(normalizeRaceDriveInput({ steer: 0.42, brake: true })).toMatchObject(
      {
        steer: 0.42,
        throttle: false,
        brake: true,
      },
    );
    expect(
      normalizeRaceDriveInput({ steerLeft: true, steer: 0.8 }).steer,
    ).toBeCloseTo(-0.2, 5);
  });

  it("maps calibrated DeviceOrientation tilt through a dead-zone into normalized steering", () => {
    const baseline = { gamma: 4, beta: 10 };
    expect(gyroSteerFromOrientation({ gamma: 5.4, beta: 12 }, baseline)).toBe(
      0,
    );
    expect(
      gyroSteerFromOrientation({ gamma: 16, beta: 10 }, baseline),
    ).toBeCloseTo(0.4, 5);
    expect(gyroSteerFromOrientation({ gamma: -40, beta: 10 }, baseline)).toBe(
      -1,
    );
    expect(gyroSteerFromOrientation({ gamma: null, beta: 10 }, baseline)).toBe(
      0,
    );
  });

  it("maps Android TV gamepads to steer, throttle, and brake", () => {
    const leftStick: GamepadLike = {
      axes: [0.65, 0],
      buttons: [button(true), button(false), button(false), button(false)],
    };
    expect(gamepadRaceInput(leftStick)).toMatchObject({
      steer: 0.65,
      accelerate: true,
      brake: false,
    });

    const dpadBrake: GamepadLike = {
      axes: [0.05, 0],
      buttons: [
        button(false),
        button(true),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(false),
        button(true),
      ],
    };
    expect(gamepadRaceInput(dpadBrake)).toMatchObject({
      steer: -1,
      accelerate: false,
      brake: true,
    });
  });
});
