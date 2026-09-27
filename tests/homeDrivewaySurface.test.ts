import { expect, it } from "vitest";
import { homeDrivewayGeometry } from "../src/colony/render/HomeDrivewaySurface";

it("paves only the published off-road approach and follows graded ground", () => {
  const geometry = homeDrivewayGeometry(
    [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 1 }],
    8,
    new Set(["1,1"]),
    (x) => x,
  );
  const positions = geometry.getAttribute("position");
  expect(positions.count).toBe(8);
  expect(geometry.getIndex()?.count).toBe(12);
  expect(positions.getY(0)).toBeCloseTo(1.555);
  expect(positions.getY(1)).toBeCloseTo(2.555);
  expect(positions.getX(0)).toBeCloseTo((1.5 - 4) * 4);
  const normals = geometry.getAttribute("normal");
  expect(normals.getY(0)).toBeGreaterThan(0);
  geometry.dispose();
});
