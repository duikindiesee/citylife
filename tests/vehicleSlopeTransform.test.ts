import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";

describe("Vehicle Slope Transform, Bounded Exit & Review Hardening", () => {
  it("transforms front and rear vehicle positions with correct pitch on a 1m elevation grade", () => {
    // Car dimensions matching carMesh.ts and R3FOperatorCar.tsx:
    // Headlights/front at local +X (+2.1m), taillights/rear at local -X (-2.1m), wheelbase = 4.2m
    const frontLocal = new THREE.Vector3(2.1, 0, 0);
    const rearLocal = new THREE.Vector3(-2.1, 0, 0);

    // 1m front-to-rear grade (front higher by 1.0m)
    const yFront = 10.0;
    const yRear = 9.0;
    const pitch = Math.atan2(yFront - yRear, 4.2);
    const roll = 0;

    // Test heading 0 (facing +X)
    const heading0 = 0;
    const euler0 = new THREE.Euler(-roll, -heading0, pitch, "YXZ");

    const frontTransformed0 = frontLocal.clone().applyEuler(euler0);
    const rearTransformed0 = rearLocal.clone().applyEuler(euler0);

    const heightDiff0 = frontTransformed0.y - rearTransformed0.y;
    // For 1.0m rise across 4.2m wheelbase, 4.2 * sin(atan2(1.0, 4.2)) = 0.973m (~1m)
    expect(heightDiff0).toBeCloseTo(0.973, 2);
    expect(frontTransformed0.y).toBeGreaterThan(0);
    expect(rearTransformed0.y).toBeLessThan(0);

    // Test heading pi / 2 (facing +Z)
    const headingPiOver2 = Math.PI / 2;
    const eulerPiOver2 = new THREE.Euler(-roll, -headingPiOver2, pitch, "YXZ");

    const frontTransformedPiOver2 = frontLocal.clone().applyEuler(eulerPiOver2);
    const rearTransformedPiOver2 = rearLocal.clone().applyEuler(eulerPiOver2);

    const heightDiffPiOver2 = frontTransformedPiOver2.y - rearTransformedPiOver2.y;
    expect(heightDiffPiOver2).toBeCloseTo(0.973, 2);

    // Test heading pi (facing -X)
    const headingPi = Math.PI;
    const eulerPi = new THREE.Euler(-roll, -headingPi, pitch, "YXZ");

    const frontTransformedPi = frontLocal.clone().applyEuler(eulerPi);
    const rearTransformedPi = rearLocal.clone().applyEuler(eulerPi);

    const heightDiffPi = frontTransformedPi.y - rearTransformedPi.y;
    expect(heightDiffPi).toBeCloseTo(0.973, 2);
  });

  it("transforms lateral roll with correct signs across car doors on a 0.5m side slope", () => {
    // Doors: left side at local +Z (+0.95m), right side at local -Z (-0.95m), track width = 1.9m
    const leftLocal = new THREE.Vector3(0, 0, 0.95);
    const rightLocal = new THREE.Vector3(0, 0, -0.95);

    // Left side higher by 0.5m
    const yLeft = 5.5;
    const yRight = 5.0;
    const roll = Math.atan2(yLeft - yRight, 1.9);
    const pitch = 0;
    const heading = 0;

    const euler = new THREE.Euler(-roll, -heading, pitch, "YXZ");

    const leftTransformed = leftLocal.clone().applyEuler(euler);
    const rightTransformed = rightLocal.clone().applyEuler(euler);

    const rollDiff = leftTransformed.y - rightTransformed.y;
    // Left side must be higher (1.9 * sin(atan2(0.5, 1.9)) = 0.484m ~0.5m)
    expect(rollDiff).toBeCloseTo(0.484, 2);
    expect(leftTransformed.y).toBeGreaterThan(0);
    expect(rightTransformed.y).toBeLessThan(0);
  });

  it("bounds water-exit teleportation and fails safely instead of teleporting across the map", () => {
    const rt = new ColonyRuntime(4242);
    const spec = { id: "karoo_kaap_gt_v8" } as any;
    (rt as any).authoritativeCar = spec;
    (rt as any).operatorUserId = "test-operator";
    (rt as any).ownedDriveSeated = true;

    // Place car at (100, 100), deep in water with no roads within 6 cells
    const carPose = { x: 100, y: 100, heading: 0, speed: 0 };
    (rt as any).ownedDrivePose = carPose;
    (rt as any).sim.state.operatorCar = { spec, cell: { x: 100, y: 100 } };

    // Clear any roads within 10 cells of (100, 100)
    for (let dx = -10; dx <= 10; dx++) {
      for (let dy = -10; dy <= 10; dy++) {
        rt.sim.state.roadSet.delete(`${100 + dx},${100 + dy}`);
      }
    }

    // Add a road far away at (300, 300) (> 200 cells away)
    rt.sim.state.roadSet.add("300,300");

    // Mock blockedStepReason to report water around (100, 100)
    const origBlocked = (rt as any).blockedStepReason.bind(rt);
    (rt as any).blockedStepReason = (x: number, y: number) => {
      if (Math.hypot(x - 100, y - 100) <= 6.5) return "water";
      return origBlocked(x, y);
    };

    const exitResult = rt.exitOwnedCar();

    // Must fail safely (false) without creating an unbounded teleport across the map
    expect(exitResult).toBe(false);
    expect((rt as any).fpTeleportRequest).toBeFalsy();
  });
});
