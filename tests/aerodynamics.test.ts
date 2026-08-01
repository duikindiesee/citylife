import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAR_CURVES,
  calculateAerodynamics,
  generateStreamlines,
} from "../src/colony/car/aerodynamics";
import {
  DEFAULT_ENGINE_CALIBRATION,
  v8FiringFrequencyHz,
  superchargerWhineHz,
} from "../src/colony/car/engineSound";

describe("Aerodynamics Physics & Telemetry Engine", () => {
  it("calculates realistic Drag Coefficient (Cd) and frontal area", () => {
    const curves = DEFAULT_CAR_CURVES();
    const aero = calculateAerodynamics(curves, 100);

    expect(aero.cd).toBeGreaterThanOrEqual(0.26);
    expect(aero.cd).toBeLessThanOrEqual(0.55);
    expect(aero.frontalAreaM2).toBeGreaterThan(1.8);
    expect(aero.dragForceN).toBeGreaterThan(0);
  });

  it("increases downforce when wing angle of attack is increased", () => {
    const lowWing = calculateAerodynamics(
      { ...DEFAULT_CAR_CURVES(), wingAngleDeg: 0 },
      150,
    );
    const highWing = calculateAerodynamics(
      { ...DEFAULT_CAR_CURVES(), wingAngleDeg: 20 },
      150,
    );

    expect(highWing.rearDownforceN).toBeGreaterThan(lowWing.rearDownforceN);
  });

  it("generates streamline particles with pressure classifications", () => {
    const particles = generateStreamlines(20, 120);
    expect(particles).toHaveLength(20);
    expect(particles[0]).toHaveProperty("vx");
    expect(particles[0]).toHaveProperty("pressure");
  });
});

describe("V8 Engine Sound Calibration Engine", () => {
  it("computes V8 firing frequency and supercharger whine pitch", () => {
    const cal = DEFAULT_ENGINE_CALIBRATION();
    const firingHz = v8FiringFrequencyHz(cal.currentRpm);
    const whineHz = superchargerWhineHz(cal.currentRpm);

    expect(firingHz).toBe(160); // (2400 / 60) * 4
    expect(whineHz).toBe(640); // (2400 / 60) * 16
  });
});
