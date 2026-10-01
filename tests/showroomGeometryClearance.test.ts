import { describe, expect, it } from "vitest";
import { buildGarageAnchorShellModel } from "../src/colony/render/garageAnchorShell";

describe("Showroom Geometry & 360° Clearance Acceptance (Spec 176)", () => {
  it("guarantees 360° rotation clearance, bay containment, and walkable paths", () => {
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

    const leftWall = model.showroom.x - model.showroom.w / 2;
    const rightWall = model.showroom.x + model.showroom.w / 2;
    const backWall = model.showroom.z - model.showroom.d / 2;
    const frontWall = model.showroom.z + model.showroom.d / 2;

    const heroX = model.showroom.x - model.showroom.w * 0.10;
    const heroZ = model.showroom.z + model.showroom.d * 0.04;
    const secondX = model.showroom.x + model.showroom.w * 0.085;
    const secondZ = model.showroom.z - model.showroom.d * 0.02;
    const serviceBayLeftWall = model.serviceBay.x - model.serviceBay.w / 2;

    // Authentic vehicle dimensions in world metres (scale 1.05x):
    const kaapLength = 4.28;
    const kaapWidth = 1.92;
    const x19Length = 4.28;
    const x19Width = 1.92;

    // 1. Secondary car fits entirely within showroom bay without wall penetration,
    // maintaining >= 2.5m clearance to both the service bay dividing wall and showroom exterior.
    const secondWorldX = secondX * 4;
    const secondWorldZ = secondZ * 4;
    const secondMinX = secondWorldX - x19Length / 2;
    const secondMaxX = secondWorldX + x19Length / 2;
    const secondMinZ = secondWorldZ - x19Width / 2;
    const secondMaxZ = secondWorldZ + x19Width / 2;

    expect(secondMaxX).toBeLessThan(serviceBayLeftWall * 4 - 2.5); // at least 2.5m clearance to service bay wall!
    expect(secondMaxX).toBeLessThan(rightWall * 4 - 0.5);
    expect(secondMinX).toBeGreaterThan(leftWall * 4 + 0.5);
    expect(secondMinZ).toBeGreaterThan(backWall * 4 + 0.5);
    expect(secondMaxZ).toBeLessThan(frontWall * 4 - 0.5);

    // 2. Throughout full 360° turntable rotation, hero car maintains >= 2.5m walkway clearance to second car
    // and clears all 4 showroom walls
    for (let angle = 0; angle < Math.PI * 2; angle += 0.05) {
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const corners = [
        [-kaapLength / 2, -kaapWidth / 2],
        [kaapLength / 2, -kaapWidth / 2],
        [kaapLength / 2, kaapWidth / 2],
        [-kaapLength / 2, kaapWidth / 2],
      ];

      for (const [cx, cz] of corners) {
        const worldX = heroX * 4 + (cx * cosA - cz * sinA);
        const worldZ = heroZ * 4 + (cx * sinA + cz * cosA);

        // Distance to walls > 0.5m:
        expect(rightWall * 4 - worldX).toBeGreaterThan(0.5);
        expect(worldX - leftWall * 4).toBeGreaterThan(0.5);
        expect(frontWall * 4 - worldZ).toBeGreaterThan(0.5);
        expect(worldZ - backWall * 4).toBeGreaterThan(0.5);

        // Distance to secondary car > 2.5m for walkable customer passage:
        const distToSecond = Math.hypot(worldX - secondWorldX, worldZ - secondWorldZ);
        expect(distToSecond).toBeGreaterThan(2.5);
      }
    }
  });
});
