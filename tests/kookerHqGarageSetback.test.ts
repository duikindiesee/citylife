import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";
import { worldClearRects } from "../src/colony/render/worldClearRects";

describe("Spec 177 / Kooker HQ Landmark behind Commercial Garage", () => {
  const rt = new ColonyRuntime(4242);
  const s = rt.sim.state;
  const N = s.terrain.size;
  const layer = buildCommercialDistrictLayer({
    state: s,
    district: s.commercialDistrict!,
    wx: (x) => (x - N / 2) * 4,
    wz: (y) => (y - N / 2) * 4,
    surfaceY: (x, y) =>
      Math.max(0, s.terrain.worldY(Math.round(x), Math.round(y))),
  });

  it("builds the Kooker HQ landmark group behind the commercial garage", () => {
    expect(s.commercialDistrict?.garagePad).toBeDefined();
    const hqGroup = layer.group.getObjectByName("commercialDistrict.kookerHq") as THREE.Group;
    expect(hqGroup).toBeDefined();
    expect(hqGroup.userData.kind).toBe("kooker_hq_landmark");
    expect(hqGroup.userData.publicName).toBe("Kooker HQ");
    expect(hqGroup.userData.isPublicSafe).toBe(true);

    // Verify architectural components
    expect(hqGroup.getObjectByName("kookerHqPlazaBase")).toBeDefined();
    expect(hqGroup.getObjectByName("kookerHqCentralTower")).toBeDefined();
    expect(hqGroup.getObjectByName("kookerHqReceptionLobby")).toBeDefined();
    expect(hqGroup.getObjectByName("kookerHqWestWing")).toBeDefined();
    expect(hqGroup.getObjectByName("kookerHqEastWing")).toBeDefined();
  });

  it("positions Kooker HQ on the rear setback behind the garage pad", () => {
    const garage = s.commercialDistrict!.garagePad!;
    const hqGroup = layer.group.getObjectByName("commercialDistrict.kookerHq") as THREE.Group;
    expect(hqGroup).toBeDefined();

    const garageWorldX = (garage.x + (garage.w - 1) / 2 - N / 2) * 4;
    const garageWorldZ = (garage.y + (garage.h - 1) / 2 - N / 2) * 4;

    const dx = hqGroup.position.x - garageWorldX;
    const dz = hqGroup.position.z - garageWorldZ;
    const dist = Math.hypot(dx, dz);

    // Must be set back behind the garage (approx 42m away from garage center)
    expect(dist).toBeGreaterThan(30);
    expect(dist).toBeLessThan(60);
  });

  it("clears the Kooker HQ campus footprint in worldClearRects", () => {
    const rects = worldClearRects(s as never);
    const garage = s.commercialDistrict!.garagePad!;
    const facing = garage.facingAngle ?? 0;
    const backDirX = -Math.sin(facing);
    const backDirY = -Math.cos(facing);
    const expectedHqX = Math.round(garage.x + (garage.w - 1) / 2 + backDirX * 10.5);
    const expectedHqY = Math.round(garage.y + (garage.h - 1) / 2 + backDirY * 10.5);

    const cleared = rects.some(
      (r) =>
        r.x0 <= expectedHqX &&
        r.x1 >= expectedHqX &&
        r.y0 <= expectedHqY &&
        r.y1 >= expectedHqY,
    );
    expect(cleared).toBe(true);
  });
});
