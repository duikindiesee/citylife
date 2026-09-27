import { expect, it } from "vitest";
import { ownedDriveCamera } from "../src/colony/car/ownedDriveCamera";

it("keeps the owned car ahead of the camera and clears the surveyed surface", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const pose = { x: 10, y: 10, heading };
    const camera = ownedDriveCamera(
      pose,
      20,
      (x) => (x < 10 ? 5 : 2),
    );
    const dx = camera.target[0] - camera.position[0];
    const dz = camera.target[2] - camera.position[2];
    expect(dx * Math.cos(heading) + dz * Math.sin(heading)).toBeGreaterThan(6);
    const cameraGridX = camera.position[0] / 4 + 10;
    expect(camera.position[1]).toBeGreaterThanOrEqual((cameraGridX < 10 ? 5 : 2) + 1.8);
    expect(camera.target).toEqual([0, 3.1, 0]);
  }
});
