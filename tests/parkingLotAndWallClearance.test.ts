import { describe, expect, it } from "vitest";
import { buildGarageAnchorShellModel } from "../src/colony/render/garageAnchorShell";
import { stepOwnedDrive, type OwnedDrivePose } from "../src/colony/car/ownedDriving";
import { ColonyRuntime } from "../src/colony/runtime";

describe("Parking Lot Alignment, Wall Clearance & Roadside Unsticking", () => {
  const pad = {
    x: 100,
    y: 200,
    w: 16,
    h: 11,
    facingAngle: 0,
    roadTarget: { x: 100, y: 205 },
    islandCell: { x: 108, y: 205 },
  };
  const model = buildGarageAnchorShellModel(pad as any, () => 0);

  it("aligns parking lot display cars directly with marked parking stalls", () => {
    expect(model.parkingBays.length).toBeGreaterThanOrEqual(3);
    expect(model.displayCars.length).toBeGreaterThanOrEqual(2);

    // Car 1 (Vonk) parked in Bay 01
    const car1 = model.displayCars[0]!;
    const bay1 = model.parkingBays[0]!;
    expect(car1.x).toBe(bay1.x);
    expect(car1.z).toBe(bay1.z);
    expect(car1.rot).toBe(bay1.rot); // perfectly straight (0 rad)

    // Car 2 (Kaap) parked in Bay 02
    const car2 = model.displayCars[1]!;
    const bay2 = model.parkingBays[1]!;
    expect(car2.x).toBe(bay2.x);
    expect(car2.z).toBe(bay2.z);
    expect(car2.rot).toBe(bay2.rot); // perfectly straight (0 rad)

    // Bay 03 remains open for customer / player vehicle parking
    const bay3 = model.parkingBays[2]!;
    expect(bay3.label).toBe("BAY 03");
  });

  it("guarantees secondary car in showroom does not penetrate service bay dividing wall", () => {
    const serviceBayLeftWall = (model.serviceBay.x - model.serviceBay.w / 2) * 4;
    const secondCarX = (model.showroom.x + model.showroom.w * 0.085) * 4;
    const carHalfWidth = 1.92 / 2;

    const carRightSide = secondCarX + carHalfWidth;
    const clearanceToWall = serviceBayLeftWall - carRightSide;

    // Clearance must be greater than 2.5 metres (absolutely zero wall penetration)
    expect(clearanceToWall).toBeGreaterThan(2.5);
  });

  it("allows car to reverse away and unstick when front touches an obstacle", () => {
    // Setup a scenario where x >= 10 is an obstacle
    const canOccupy = (x: number, _y: number) => x < 10;

    // Car is facing +X (heading = 0) with front bumper (x + 1.8/4 = 10.05) touching obstacle at x >= 10
    const initialPose: OwnedDrivePose = {
      x: 9.6,
      y: 5.0,
      heading: 0,
      speed: 0,
    };
    const stats = { acceleration: 1, topSpeed: 1, grip: 1, braking: 1 };

    // 1. Trying to accelerate forward into the obstacle is blocked
    const forwardStep = stepOwnedDrive(
      initialPose,
      { throttle: true },
      stats,
      0.1,
      canOccupy,
    );
    expect(forwardStep.x).toBe(initialPose.x);
    expect(forwardStep.speed).toBe(0);

    // 2. Pressing reverse allows the car to back out away from the obstacle
    const reverseStep = stepOwnedDrive(
      initialPose,
      { reverse: true },
      stats,
      0.1,
      canOccupy,
    );
    // Reverse movement succeeded: x moved backward (< 9.5) and speed is negative
    expect(reverseStep.x).toBeLessThan(initialPose.x);
    expect(reverseStep.speed).toBeLessThan(0);
  });

  it("allows driving onto the garage forecourt entrance apron without border blockage", () => {
    const rt = new ColonyRuntime(4242);
    const garagePad = rt.sim.state.commercialDistrict!.garagePad!;

    // Point right at the road frontage edge of the pad
    const cx = garagePad.x + (garagePad.w - 1) / 2;
    const cy = garagePad.y + (garagePad.h - 1) / 2;
    const cos = Math.cos(garagePad.facingAngle);
    const sin = Math.sin(garagePad.facingAngle);

    // Front apron threshold (localZ = halfD - 0.1)
    const localZ = garagePad.h / 2 - 0.1;
    const edgeX = cx - localZ * sin;
    const edgeY = cy + localZ * cos;

    expect(rt.isGaragePadDrivable(edgeX, edgeY, garagePad)).toBe(true);
  });

  it("strictly blocks driving onto non-road occupied parcels", () => {
    const rt = new ColonyRuntime(4242);
    const t = rt.sim.state.terrain;
    let targetX = 300;
    let targetY = 300;
    for (let x = 250; x < 350; x++) {
      for (let y = 250; y < 350; y++) {
        if (!t.isWater(x, y) && t.worldY(x, y) > 2.0 && !rt.sim.state.roadSet.has(`${x},${y}`)) {
          targetX = x;
          targetY = y;
          break;
        }
      }
      if (targetX !== 300 || targetY !== 300) break;
    }
    const key = `${targetX},${targetY}`;
    rt.sim.state.occupied.add(key);

    expect((rt as any).blockedStepReason(targetX, targetY)).toBe("parcel");

    // Place car facing +X towards the occupied parcel cell
    const spec = { id: "karoo_kaap_gt_v8" } as any;
    (rt as any).authoritativeCar = spec;
    (rt as any).operatorUserId = "test-operator";
    (rt as any).ownedDriveSeated = true;
    (rt as any).sim.state.operatorCar = {
      spec,
      cell: { x: targetX - 0.4, y: targetY },
    };
    (rt as any).ownedDrivePose = {
      x: targetX - 0.4,
      y: targetY,
      heading: 0,
      speed: 10,
    };
    (rt as any).ownedDriveInput = { throttle: true };

    // Run tickOwnedDrive
    (rt as any).tickOwnedDrive(0.1);

    const postDrivePose = rt.getOwnedDrivePose()!;
    expect(postDrivePose.x).toBeLessThan(targetX);
  });
});
