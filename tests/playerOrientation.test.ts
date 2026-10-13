import { describe, it, expect } from "vitest";
import {
  cameraYawToWireHeading,
  wireHeadingToCameraYaw,
  cameraYawToWorldForward,
  cameraYawToWorldRight,
  headingToWorldDirection,
  normalizeAngle,
} from "../src/colony/playerOrientation";

describe("playerOrientation shared coordinate convention", () => {
  it("maps Three.js camera yaw to world/wire heading and back invertibly", () => {
    // Yaw 0: camera faces down -Z (grid -Y) -> wire heading -PI/2
    const headingAtYaw0 = cameraYawToWireHeading(0);
    expect(headingAtYaw0).toBeCloseTo(-Math.PI / 2, 6);
    expect(wireHeadingToCameraYaw(headingAtYaw0)).toBeCloseTo(0, 6);

    // Yaw -PI/2: camera turned 90 deg right to face +X -> wire heading 0
    const headingAtTurnRight = cameraYawToWireHeading(-Math.PI / 2);
    expect(headingAtTurnRight).toBeCloseTo(0, 6);
    expect(wireHeadingToCameraYaw(headingAtTurnRight)).toBeCloseTo(-Math.PI / 2, 6);

    // Yaw PI/2: camera turned 90 deg left to face -X -> wire heading PI
    const headingAtTurnLeft = cameraYawToWireHeading(Math.PI / 2);
    expect(Math.abs(headingAtTurnLeft)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(wireHeadingToCameraYaw(headingAtTurnLeft))).toBeCloseTo(
      normalizeAngle(Math.PI / 2),
      6
    );

    // Yaw PI: camera turned 180 deg to face +Z (grid +Y) -> wire heading PI/2
    const headingAtTurnBack = cameraYawToWireHeading(Math.PI);
    expect(headingAtTurnBack).toBeCloseTo(Math.PI / 2, 6);
    expect(normalizeAngle(wireHeadingToCameraYaw(headingAtTurnBack))).toBeCloseTo(
      normalizeAngle(Math.PI),
      6
    );
  });

  it("proves forward displacement agreement between camera yaw forward and server wire heading integration", () => {
    // Sample 36 angles around the full circle in 10-degree increments
    for (let deg = 0; deg < 360; deg += 10) {
      const yaw = (deg * Math.PI) / 180;
      const heading = cameraYawToWireHeading(yaw);

      // Client camera forward in world space: (-sin(yaw), -cos(yaw))
      const clientFwd = cameraYawToWorldForward(yaw);

      // Server stepPedestrian integration with forward=1, strafe=0:
      // vx = cos(heading) * speed, vz = sin(heading) * speed
      const serverDir = headingToWorldDirection(heading);

      expect(serverDir.x).toBeCloseTo(clientFwd.x, 5);
      expect(serverDir.z).toBeCloseTo(clientFwd.z, 5);
    }
  });

  it("proves strafe displacement agreement between camera yaw right and server wire heading integration", () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const yaw = (deg * Math.PI) / 180;
      const heading = cameraYawToWireHeading(yaw);

      // Client camera right (strafe +1) in world space: (cos(yaw), -sin(yaw))
      const clientRight = cameraYawToWorldRight(yaw);

      // Server stepPedestrian integration with forward=0, strafe=1:
      // vx = (0*cos - 1*sin(heading)) = -sin(heading)
      // vz = (0*sin + 1*cos(heading)) = +cos(heading)
      const serverVx = -Math.sin(heading);
      const serverVz = Math.cos(heading);

      expect(serverVx).toBeCloseTo(clientRight.x, 5);
      expect(serverVz).toBeCloseTo(clientRight.z, 5);
    }
  });
});
