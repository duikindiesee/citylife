import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";
import {
  computeTerrainLeveling,
  padSeatY,
} from "../src/colony/render/useTerrainLeveling";
import {
  garageApronSurfaceY,
  gridFromLocalCoordinates,
  isPointInGarageVicinity,
  localFromGridCoordinates,
} from "../src/colony/render/garageAnchorShell";
import {
  getSmoothRoadY,
  isPointOnRoadSurface,
} from "../src/colony/render/roadSurface";
import { ROAD_RIBBON_LIFT } from "../src/colony/render/roadRibbon";
import { leveledWorldY } from "../src/colony/render/terrainLeveling";
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
import {
  surveyVenuePlacements,
  junctionZonesToPads,
} from "../src/colony/render/venuePlacement";

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
    surfaceY: (x, y) =>
      Math.max(0, s.terrain.worldY(Math.round(x), Math.round(y))),
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
    const yellowNightFloor = garageShell.getObjectByName(
      "garageAnchorNightFloor",
    ) as THREE.Mesh;
    if (yellowNightFloor) {
      // If a floor slab exists, it must not use the yellow/brown emissive material (0xffb24a / 0xff9f2f)
      const mat = yellowNightFloor.material as THREE.MeshStandardMaterial;
      const isYellowOrBrown =
        mat.color.getHex() === 0xffb24a || mat.emissive.getHex() === 0xff9f2f;
      expect(
        isYellowOrBrown,
        "Garage still has projecting yellow/brown night floor slab!",
      ).toBe(false);
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
    const displayCar1 = garageShell.getObjectByName(
      "garageAnchorDisplayCar.1",
    ) as THREE.Group;
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
    const rooftopWrench = garageShell.getObjectByName(
      "garageAnchorRooftopWrenchEmblem",
    );
    expect(
      rooftopWrench,
      "Misplaced rooftop hammer/wrench must be removed",
    ).toBeUndefined();

    // 2. Yellow showroom header bar must be removed
    const yellowHeader = garageShell.getObjectByName(
      "garageAnchorShowroomHeaderSign",
    );
    expect(
      yellowHeader,
      "Yellow placeholder header bar must be removed",
    ).toBeUndefined();

    // 3. Tall corner pole with black panel and hammer logo
    const pylon = garageShell.getObjectByName(
      "garageAnchorCornerPylonSign",
    ) as THREE.Mesh;
    expect(pylon).toBeDefined();

    const hammerLogo = garageShell.getObjectByName(
      "garageAnchorPylonHammerLogo",
    );
    expect(
      hammerLogo,
      "Tall corner pole must feature black panel with hammer logo",
    ).toBeDefined();

    // 4. REAL world-space scale (MoJoJo review 5410400845 finding 1): the garage group is
    //    scaled by renderScale = 4, so the sign must be measured in world metres.
    const poleSize = new THREE.Box3()
      .setFromObject(pylon)
      .getSize(new THREE.Vector3());
    expect(
      poleSize.y,
      `pole world height ${poleSize.y.toFixed(2)} m`,
    ).toBeCloseTo(6.2, 1);
    expect(Math.max(poleSize.x, poleSize.z)).toBeLessThan(0.5);
    const panel = garageShell.getObjectByName(
      "garageAnchorPylonPanel",
    ) as THREE.Mesh;
    const panelSize = new THREE.Box3()
      .setFromObject(panel)
      .getSize(new THREE.Vector3());
    expect(
      panelSize.y,
      `panel world height ${panelSize.y.toFixed(2)} m`,
    ).toBeCloseTo(1.1, 1);
    expect(
      Math.max(panelSize.x, panelSize.z),
      `panel world width ${Math.max(panelSize.x, panelSize.z).toFixed(2)} m`,
    ).toBeCloseTo(1.8, 1);
    const logoSize = new THREE.Box3()
      .setFromObject(hammerLogo!)
      .getSize(new THREE.Vector3());
    expect(Math.max(logoSize.x, logoSize.y, logoSize.z)).toBeLessThan(1.8);
  });

  it("4b. Corner pylon stays clear of building, driveway, forecourt and parking across seeds", () => {
    for (const seed of [4242, 42, 7, 99]) {
      const m = new ColonyRuntime(seed).getGarageModel()!;
      const p = m.pylon;
      const halfW = p.w / 2,
        halfD = p.d / 2;
      const overlaps = (
        r: { x: number; z: number; w: number; d: number },
        pad = 0,
      ) =>
        Math.abs(p.x - r.x) < halfW + r.w / 2 + pad &&
        Math.abs(p.z - r.z) < halfD + r.d / 2 + pad;
      // not inside any drivable/walkable surface (driveway apron, forecourt, bay floor)
      for (const s of m.surfaces)
        if (s.drivable)
          expect(overlaps(s, 0.1), `seed ${seed}: pylon in ${s.id}`).toBe(
            false,
          );
      // not inside the building masses
      expect(
        overlaps({
          x: m.showroom.x,
          z: m.showroom.z,
          w: m.showroom.w,
          d: m.showroom.d,
        }),
        `seed ${seed}: pylon inside showroom`,
      ).toBe(false);
      expect(
        overlaps({
          x: m.serviceBay.x,
          z: m.serviceBay.z,
          w: m.serviceBay.w,
          d: m.serviceBay.d,
        }),
        `seed ${seed}: pylon inside workshop`,
      ).toBe(false);
      // not in a parking stall (stalls rotated PI/2: depth along z, width along x)
      for (const b of m.parkingBays)
        expect(
          overlaps({ x: b.x, z: b.z, w: b.w, d: b.d }, 0.1),
          `seed ${seed}: pylon in ${b.label}`,
        ).toBe(false);
      // on the owned pad, never on the verge/road side of the pad edge
      expect(Math.abs(p.x) + halfW).toBeLessThanOrEqual(m.footprint.w / 2);
      expect(Math.abs(p.z) + halfD).toBeLessThanOrEqual(m.footprint.d / 2);
      // not above the garage doors: horizontally outside the workshop door run
      expect(p.z).toBeGreaterThan(m.serviceBay.z + m.serviceBay.d / 2);
    }
  }, 30000);

  it("5. Junction furniture must never be planted inside road carriageways across seeds", () => {
    const SEEDS = [4242, 7, 99];
    for (const seed of SEEDS) {
      const rtSeed = new ColonyRuntime(seed);
      const ways = (rtSeed.sim.state.roadWays ?? []).filter(
        (w) => w.source !== "depot-spur",
      );
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

  it("6. Solid retaining foundation plinths must embed deep into ground on slopes", () => {
    const garageShell = getGarageShell();
    const buildingFound = garageShell.getObjectByName(
      "garageAnchorFoundation",
    ) as THREE.Mesh;
    expect(buildingFound, "Building foundation plinth must exist").toBeDefined();

    const forecourtFound = garageShell.getObjectByName(
      "garageAnchorForecourtFoundation",
    ) as THREE.Mesh;
    expect(forecourtFound, "Forecourt foundation plinth must exist").toBeDefined();

    const apronFound = garageShell.getObjectByName(
      "garageAnchorDrivewayApronFoundation",
    ) as THREE.Mesh;
    expect(apronFound, "Driveway apron foundation plinth must exist").toBeDefined();

    // Verify depth in world metres (scale factor is 4)
    const buildingBox = new THREE.Box3().setFromObject(buildingFound);
    const buildingDepthM = buildingBox.max.y - buildingBox.min.y;
    expect(
      buildingDepthM,
      `Building foundation depth ${buildingDepthM.toFixed(2)}m must be >= 2.0m to prevent hollow underbelly`,
    ).toBeGreaterThanOrEqual(2.0);
  });

  it("7. Continuous apron and forecourt terrain leveling connects garage smoothly to municipal road ribbon", () => {
    for (const seed of [4242, 42, 7, 99]) {
      const rtSeed = new ColonyRuntime(seed);
      const sSeed = rtSeed.sim.state;
      const tSeed = sSeed.terrain;
      const g = sSeed.commercialDistrict!.garagePad!;
      const roadY = (x: number, y: number) => getSmoothRoadY(tSeed, x, y);
      const ribbon = new Map<string, number>();
      for (const r of sSeed.roads) {
        ribbon.set(`${r.x},${r.y}`, roadY(r.x, r.y));
      }

      const seat = padSeatY(tSeed, g.x, g.y, g.w, g.h);
      const level = computeTerrainLeveling(sSeed, ribbon, new Map());

      // Production vehicle elevation sampling function from R3FOperatorCar.tsx
      const sampleCarElevation = (cx: number, cy: number): number => {
        const isR = isPointOnRoadSurface(
          cx,
          cy,
          sSeed.roadSet,
          sSeed.roadWays,
        );
        if (isPointInGarageVicinity(cx, cy, g)) {
          const local = localFromGridCoordinates(g, cx, cy);
          const apronH = garageApronSurfaceY(
            g,
            tSeed,
            null,
            local.x,
            local.z,
            seat,
          );
          if (isR) {
            const roadH = roadY(cx, cy) + ROAD_RIBBON_LIFT;
            return Math.max(roadH, apronH);
          }
          return apronH;
        }
        if (isR) {
          return roadY(cx, cy) + ROAD_RIBBON_LIFT;
        }
        return (
          Math.max(
            0,
            leveledWorldY(tSeed, level, Math.round(cx), Math.round(cy)),
          ) + 0.02
        );
      };

      // 1. Discriminating production car contact elevation continuity across rounded-cell boundaries (MoJoJo finding).
      // Delta across any 0.025 cell / 0.10m travel must be continuous (< 0.025m), with zero discrete integer-cell snapping jumps.
      for (let z = 5.40; z <= 5.575; z += 0.025) {
        const pt1 = gridFromLocalCoordinates(g, 0, z);
        const pt2 = gridFromLocalCoordinates(g, 0, z + 0.025);
        const h1 = sampleCarElevation(pt1.x, pt1.y);
        const h2 = sampleCarElevation(pt2.x, pt2.y);
        const delta = Math.abs(h2 - h1);
        expect(
          delta,
          `Seed ${seed}: car contact jump at z=${z.toFixed(3)} (${delta.toFixed(4)}m) across cell boundary must be < 0.025m`,
        ).toBeLessThan(0.025);
      }

      // 2. Forecourt seam continuity at z = 4.20
      const ptPre = gridFromLocalCoordinates(g, 0, 4.15);
      const ptPost = gridFromLocalCoordinates(g, 0, 4.25);
      const deltaForecourt = Math.abs(
        sampleCarElevation(ptPost.x, ptPost.y) - sampleCarElevation(ptPre.x, ptPre.y),
      );
      expect(deltaForecourt, `Seed ${seed}: forecourt seam at z=4.20`).toBeLessThan(0.02);

      // 3. Road contact seam continuity at z = 7.80
      const ptApronEdge = gridFromLocalCoordinates(g, 0, 7.78);
      const ptRoadEdge = gridFromLocalCoordinates(g, 0, 7.82);
      const deltaRoadSeam = Math.abs(
        sampleCarElevation(ptRoadEdge.x, ptRoadEdge.y) - sampleCarElevation(ptApronEdge.x, ptApronEdge.y),
      );
      expect(deltaRoadSeam, `Seed ${seed}: road seam at z=7.80`).toBeLessThan(0.02);

      // 4. MoJoJo supplement regression: road predicate and garage apron reconciliation across seed 99 lateral sweep.
      // Across local z = 4.21 from x = -1.5 to -1.2, car elevation must match visible apron (2.0295m)
      // without dipping beneath the apron where isPointOnRoadSurface switches true without a road mesh triangle.
      if (seed === 99) {
        const expectedApron = garageApronSurfaceY(g, tSeed, null, -1.4, 4.21, seat);
        for (let x = -1.5; x <= -1.2; x += 0.05) {
          const pt = gridFromLocalCoordinates(g, x, 4.21);
          const h = sampleCarElevation(pt.x, pt.y);
          expect(
            Math.abs(h - expectedApron),
            `Seed 99: lateral apron transition at x=${x.toFixed(2)} must match visible apron (${expectedApron.toFixed(4)}m) with zero dip`,
          ).toBeLessThan(0.01);
        }
        // At physical overlap (6.97, 4.21), car rides the road ribbon (3.199m), never sinking below apron.
        const ptOver = gridFromLocalCoordinates(g, 6.97, 4.21);
        const hOver = sampleCarElevation(ptOver.x, ptOver.y);
        expect(hOver, 'Seed 99: road ribbon overlap above apron').toBeGreaterThanOrEqual(expectedApron);
      }

      // 4. Rendered apron mesh geometry correspondence with traversable surface.
      const districtLayer = buildCommercialDistrictLayer({
        state: sSeed,
        district: sSeed.commercialDistrict!,
        wx: (x) => x * 4,
        wz: (y) => y * 4,
        surfaceY: (x, y) => Math.max(0, tSeed.worldY(Math.round(x), Math.round(y))),
      });
      districtLayer.group.updateMatrixWorld(true);
      const shell = districtLayer.group.getObjectByName(
        "commercialDistrict.garagePad.garageAnchorShell",
      ) as THREE.Group;
      const fullApron = shell.getObjectByName(
        "garageAnchorDrivewayApron",
      ) as THREE.Mesh;
      expect(fullApron, "driveway apron mesh exists").toBeDefined();

      const apronBox = new THREE.Box3().setFromObject(fullApron);
      let maxSurfaceH = -Infinity;
      for (let lx = -g.w * 0.45; lx <= g.w * 0.45; lx += 1.0) {
        for (const lz of [4.2, 7.8]) {
          const h = garageApronSurfaceY(g, tSeed, ribbon, lx, lz, seat);
          if (h > maxSurfaceH) maxSurfaceH = h;
        }
      }
      expect(
        apronBox.max.y,
        `Seed ${seed}: apron mesh top ${apronBox.max.y.toFixed(2)}m near max surface ${maxSurfaceH.toFixed(2)}m`,
      ).toBeCloseTo(maxSurfaceH, 1);

      // 5. Driveway apron foundation must extend deep into ground (no hollow underbelly).
      const apronFound = shell.getObjectByName(
        "garageAnchorDrivewayApronFoundation",
      ) as THREE.Mesh;
      expect(apronFound, "driveway apron foundation exists").toBeDefined();
      const foundBox = new THREE.Box3().setFromObject(apronFound);
      const foundBottomM = foundBox.min.y;
      expect(
        foundBottomM,
        `Seed ${seed}: apron foundation bottom ${foundBottomM.toFixed(2)}m must embed well below pad seat ${seat.toFixed(2)}m`,
      ).toBeLessThan(seat - 2.0);

      // 6. Terrain leveling under apron must be finite
      const halfW = g.w / 2;
      for (let lz = 4.2; lz <= 7.8; lz += 0.5) {
        for (let lx = -halfW * 0.7; lx <= halfW * 0.7; lx += 2) {
          const pt = gridFromLocalCoordinates(g, lx, lz);
          const gx = Math.round(pt.x),
            gy = Math.round(pt.y);
          const i = gy * tSeed.size + gx;
          const cellH = level.get(i) ?? tSeed.worldY(gx, gy);
          expect(Number.isFinite(cellH)).toBe(true);
        }
      }
    }
  });

  it("8. Paved corner pylon curb and side flank apron eliminate unpaved desert gaps next to road", () => {
    const garageShell = getGarageShell();
    const pylonCurb = garageShell.getObjectByName("garageAnchorPylonCurb");
    expect(pylonCurb, "Corner pylon must stand on a paved curb plinth").toBeDefined();

    const sideFlank = garageShell.getObjectByName("garageAnchorSideFlankApron");
    expect(sideFlank, "Paved side flank apron must bridge building flank to road curb").toBeDefined();
  });
});
