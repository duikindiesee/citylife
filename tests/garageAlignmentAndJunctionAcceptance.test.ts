import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";
import {
  findJunctionZones,
  junctionFurniture,
} from "../src/colony/render/roadJunctions";
import {
  attachCapPolys,
  capCrosswalks,
  capStopBars,
  paintApproaches,
  zebraBand,
  CapBuildOptions,
} from "../src/colony/render/junctionCap";
import { surveyVenuePlacements, junctionZonesToPads } from "../src/colony/render/venuePlacement";

function distToPolyline(
  px: number,
  py: number,
  pts: { x: number; y: number }[],
): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i]!.x,
      ay = pts[i]!.y;
    const vx = pts[i + 1]!.x - ax,
      vy = pts[i + 1]!.y - ay;
    const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
    best = Math.min(best, Math.hypot(px - (ax + t * vx), py - (ay + t * vy)));
  }
  return best;
}

describe("P0 Acceptance: Garage Alignment, Carriageway Clearance, Signage & Junction Furniture", () => {
  const rt = new ColonyRuntime(4242);
  const s = rt.sim.state;
  const d = s.commercialDistrict!;
  const N = s.terrain.size;
  const wx = (x: number) => (x - N / 2) * 4;
  const wz = (y: number) => (y - N / 2) * 4;
  const layer = buildCommercialDistrictLayer({
    state: s,
    district: d,
    wx,
    wz,
    surfaceY: (x, y) => Math.max(0, s.terrain.worldY(Math.round(x), Math.round(y))),
  });
  const getGarageShell = () => {
    layer.group.updateMatrixWorld(true);
    return layer.group.getObjectByName(
      "commercialDistrict.garagePad.garageAnchorShell",
    ) as THREE.Group;
  };

  it("1. Garage and forecourt geometry must NOT occupy the road carriageway or reach the road centreline", () => {
    const garageShell = getGarageShell();
    expect(garageShell).toBeDefined();
    const model = rt.getGarageModel()!;
    const pad = d.garagePad!;

    // Find the fronting street along Y=265
    // Road center on seed 4242 is at Y = 265. Road half-width is 2.0 cells (8m).
    // Road carriageway covers Y in [263.0, 267.0].
    // Garage pad is at Y in [270, 281].
    // Any apron, forecourt or floor slab projecting forward towards the road must NOT enter the road carriageway (Y < 267.0).
    const worldYOf = (localZ: number) => {
      // Facing angle is PI, center Y is 275
      // world Y = center.y + local.x * sin(PI) - local.z * cos(PI) = 275 - local.z
      return pad.y + (pad.h - 1) / 2 - localZ;
    };

    // Check driveway apron front edge
    const apronMaxLocalZ = model.drivewayApron.z + model.drivewayApron.d / 2;
    const apronFrontWorldY = worldYOf(apronMaxLocalZ);
    // Apron must NOT reach the road carriageway (Y <= 267.0) or centreline (Y = 265.0)
    expect(
      apronFrontWorldY,
      `Driveway apron front edge reached world Y=${apronFrontWorldY.toFixed(2)}, penetrating the road carriageway!`,
    ).toBeGreaterThanOrEqual(267.0);

    // Check that no projecting yellow/brown floor slab exists
    const yellowNightFloor = garageShell.getObjectByName("garageAnchorNightFloor") as THREE.Mesh;
    if (yellowNightFloor) {
      // If a floor slab exists, it must not use the yellow/brown emissive material (0xffb24a / 0xff9f2f)
      const mat = yellowNightFloor.material as THREE.MeshStandardMaterial;
      const isYellowOrBrown = mat.color.getHex() === 0xffb24a || mat.emissive.getHex() === 0xff9f2f;
      expect(isYellowOrBrown, "Garage still has projecting yellow/brown night floor slab!").toBe(false);
    }
  });

  it("2. Garage frontage must move forward toward displayed cars and align with the adjacent blue shop", () => {
    const model = rt.getGarageModel()!;
    // In seed 4242, the adjacent blue shop is shop_21 (Tool Library).
    // shop_21 is at parcel X: 147..154, Y: 267..272.
    // Its front building facade is at world Y ~ 268.0 (local Z ~ 7.0 in garage coords).
    // The old garage frontage was at Z = 2.20 (world Y = 272.8), set back by ~5 cells (20m)!
    // The frontage must move forward so it aligns with shop_21's building setback line (Z >= 4.0).
    const facadeLocalZ = model.showroom.z + model.showroom.d / 2;
    expect(
      facadeLocalZ,
      `Garage facade is at local Z=${facadeLocalZ.toFixed(2)}, set back too far from street and adjacent shop!`,
    ).toBeGreaterThanOrEqual(4.0);
  });

  it("3. Display vehicles must match the scale of the actual drivable car, not 15m monster cars", () => {
    const garageShell = getGarageShell();
    // Check display cars in garageShell
    const displayCar1 = garageShell.getObjectByName("garageAnchorDisplayCar.1") as THREE.Group;
    expect(displayCar1).toBeDefined();

    // Compute bounding box in WORLD coordinates
    const box = new THREE.Box3().setFromObject(displayCar1);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Actual drivable car (e.g. Fiat X1/9 or Karoo Vonk) is approx 3.8m - 4.5m long, 1.6m - 1.9m wide, 1.2m - 1.5m high.
    // Length in world metres
    const length = Math.max(size.x, size.z);
    expect(
      length,
      `Display car world length is ${length.toFixed(2)}m — expected real car scale (~3.8m to 4.5m)`,
    ).toBeLessThan(5.0);
    expect(
      length,
      `Display car world length is ${length.toFixed(2)}m — expected real car scale (~3.8m to 4.5m)`,
    ).toBeGreaterThan(3.0);
  });

  it("4. Signage must feature tall corner pole with black hammer logo panel; remove rooftop hammer and yellow bars", () => {
    const garageShell = getGarageShell();
    // 1. Misplaced rooftop hammer/wrench must be removed
    const rooftopWrench = garageShell.getObjectByName("garageAnchorRooftopWrenchEmblem");
    expect(rooftopWrench, "Misplaced rooftop hammer/wrench must be removed").toBeUndefined();

    // 2. Yellow showroom header bar must be removed
    const yellowHeader = garageShell.getObjectByName("garageAnchorShowroomHeaderSign");
    expect(yellowHeader, "Yellow placeholder header bar must be removed").toBeUndefined();

    // 3. Tall corner pole with black panel and hammer logo
    const pylon = garageShell.getObjectByName("garageAnchorCornerPylonSign") as THREE.Mesh;
    expect(pylon).toBeDefined();

    const hammerLogo = garageShell.getObjectByName("garageAnchorPylonHammerLogo");
    expect(hammerLogo, "Tall corner pole must feature black panel with hammer logo").toBeDefined();
  });

  it("5. Junction furniture must never be planted inside road carriageways across seeds", () => {
    const SEEDS = [4242, 7, 99];
    for (const seed of SEEDS) {
      const rtSeed = new ColonyRuntime(seed);
      const ways = (rtSeed.sim.state.roadWays ?? []).filter((w) => w.source !== "depot-spur");
      const zones = attachCapPolys(findJunctionZones(ways));

      for (const zone of zones) {
        if (zone.kind === "bend") continue;
        const furn = junctionFurniture(zone, ways);
        for (const f of furn) {
          // Check distance to both raw way paths and smoothed way paths
          for (const w of ways) {
            const rawDist = distToPolyline(f.x, f.y, w.path);
            expect(
              rawDist,
              `Seed ${seed}: furniture ${f.kind} at (${f.x.toFixed(2)}, ${f.y.toFixed(2)}) is inside road carriageway (dist=${rawDist.toFixed(2)} <= ${(w.width / 2).toFixed(2)})!`,
            ).toBeGreaterThan(w.width / 2);
          }
        }
      }
    }
  });
});
