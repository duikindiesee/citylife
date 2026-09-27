import type { OwnedDrivePose } from "./ownedDriving";

/** Camera in world metres, following the car's movement heading. */
export function ownedDriveCamera(
  pose: Pick<OwnedDrivePose, "x" | "y" | "heading">,
  terrainSize: number,
  surfaceAt: (x: number, y: number) => number,
): { position: [number, number, number]; target: [number, number, number] } {
  const carSurface = surfaceAt(pose.x, pose.y);
  const behindX = pose.x - Math.cos(pose.heading) * 1.65;
  const behindY = pose.y - Math.sin(pose.heading) * 1.65;
  const cameraSurface = surfaceAt(behindX, behindY);
  const worldX = (x: number) => (x - terrainSize / 2) * 4;
  const worldZ = (y: number) => (y - terrainSize / 2) * 4;
  return {
    position: [
      worldX(behindX),
      Math.max(carSurface + 3.6, cameraSurface + 1.8),
      worldZ(behindY),
    ],
    target: [worldX(pose.x), carSurface + 1.1, worldZ(pose.y)],
  };
}
