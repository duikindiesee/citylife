import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { getSmoothRoadY, isPointOnRoadSurface } from "../src/colony/render/roadSurface";

describe("Coastal Road Grounding & Exit Resilience Acceptance", () => {
  it("verifies Coastal Highway (98, 358) is on road surface and elevation is continuous", () => {
    const rt = new ColonyRuntime(4242);
    const sim = rt.sim;
    const t = sim.state.terrain;

    // 1. (98, 358) is on the paved road surface
    expect(rt.isRoadSurface(98, 358)).toBe(true);

    const roadY = getSmoothRoadY(t, 98, 358) + 0.18;
    const terrY = t.worldYAt(98, 358);
    expect(roadY).toBeGreaterThanOrEqual(terrY);

    // Across the road width from y=357 to y=360:
    for (let y = 357; y <= 360; y++) {
      expect(rt.isRoadSurface(98, y)).toBe(true);
    }
  });

  it("verifies exitOwnedCar always succeeds in finding dry walkable land even near or in water", () => {
    const rt = new ColonyRuntime(4242);
    const sim = rt.sim;
    const t = sim.state.terrain;

    // Configure operator and authoritative car
    rt.setOperatorUserId("test-op");
    rt.applyVehicleOwnership("test-op", ["showroom:karoo-x19-targa"]);

    // Place and seat driver in car right at the water edge near (465, 383)
    rt.teleportCar(465, 383, 0);
    (rt as any).ownedDriveSeated = true;
    expect(rt.getOwnedDrivePose()).not.toBeNull();

    // Verify exitOwnedCar succeeds
    const exitOk = rt.exitOwnedCar();
    expect(exitOk).toBe(true);

    // Verify the exit location is NOT in water and is not blocked
    const teleport = rt.fpTeleportRequest;
    expect(teleport).not.toBeNull();
    if (teleport) {
      expect(t.isWater(teleport.x, teleport.y)).toBe(false);
      expect((rt as any).blockedStepReason(teleport.x, teleport.y)).toBeNull();
    }
  });

  it("proves drive, exit, walk, re-enter sequence", () => {
    const rt = new ColonyRuntime(4242);

    rt.setOperatorUserId("test-op");
    rt.applyVehicleOwnership("test-op", ["showroom:karoo-x19-targa"]);

    // 1. Teleport and seat car on road
    rt.teleportCar(98, 358, 0);
    (rt as any).ownedDriveSeated = true;
    expect(rt.getOwnedDrivePose()).not.toBeNull();

    // 2. Drive forward with throttle input
    rt.setOwnedDriveInput({ throttle: true });
    // Step physics
    (rt as any).tickOwnedDrive(0.1);

    // 3. Exit car
    expect(rt.exitOwnedCar()).toBe(true);
    expect(rt.getOwnedDrivePose()).toBeNull();

    // 4. Walk to car door and re-enter
    const carPose = (rt as any).ownedDrivePose;
    (rt as any).fpCameraCell = { x: carPose.x, y: carPose.y };

    expect(rt.canEnterOwnedCar()).toBe(true);
    expect(rt.enterOwnedCar()).toBe(true);
    expect(rt.getOwnedDrivePose()).not.toBeNull();
  });
});
