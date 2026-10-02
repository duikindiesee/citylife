import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";

describe("Spec 177 / MoJoJo Finding 5391566106: Service Bay 2 Open Cavity & Visual Sightline", () => {
  const rt = new ColonyRuntime(4242);
  const s = rt.sim.state;
  const d = s.commercialDistrict!;
  const t = s.terrain;
  const N = t.size;
  const wx = (x: number) => (x - N / 2) * 4;
  const wz = (y: number) => (y - N / 2) * 4;

  const layer = buildCommercialDistrictLayer({
    state: s,
    district: d,
    wx,
    wz,
    surfaceY: (x, y) => Math.max(0, t.worldY(Math.round(x), Math.round(y))),
  });

  const garageShell = layer.group.getObjectByName(
    "commercialDistrict.garagePad.garageAnchorShell",
  ) as THREE.Group;
  expect(garageShell).toBeDefined();

  const model = rt.getGarageModel()!;
  const bay2X = model.serviceBay.x;
  const bayFaceZ = model.serviceBay.z + model.serviceBay.d / 2 + 0.045;
  const bayDoorW = model.serviceBay.bayDoorW;
  const bayDoorSpacing = bayDoorW * 1.25;
  const bay1X = bay2X - bayDoorSpacing;
  const bay3X = bay2X + bayDoorSpacing;

  it("proves garageAnchorServiceBayBlock is partitioned and contains no solid mesh blocking Bay 2 portal", () => {
    const serviceBlock = garageShell.getObjectByName(
      "garageAnchorServiceBayBlock",
    ) as THREE.Group;
    expect(serviceBlock).toBeDefined();

    // Verify it is a Group of discrete architectural wall elements rather than a solid box
    expect(serviceBlock.type).toBe("Group");
    expect(serviceBlock.children.length).toBeGreaterThanOrEqual(6);

    // Corridor bounds across Bay 2 entrance in asset-local space:
    // Middle 80% of the door opening, front portal zone Z in [bayFaceZ - 0.4, bayFaceZ + 0.1], vehicle height [0.10, 1.70]
    const corridorMinX = bay2X - bayDoorW * 0.4;
    const corridorMaxX = bay2X + bayDoorW * 0.4;
    const portalMinZ = bayFaceZ - 0.4;
    const portalMaxZ = bayFaceZ + 0.1;
    const drivingMinY = 0.1;
    const drivingMaxY = 1.7;

    for (const child of serviceBlock.children) {
      if ((child as any).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.computeBoundingBox();
        const bbox = mesh.geometry.boundingBox!.clone();
        bbox.applyMatrix4(mesh.matrix);

        // Check if mesh intersects the corridor horizontally and in depth
        const xOverlap = bbox.max.x > corridorMinX && bbox.min.x < corridorMaxX;
        const zOverlap = bbox.max.z > portalMinZ && bbox.min.z < portalMaxZ;

        if (xOverlap && zOverlap) {
          // If a mesh exists in this horizontal slice, it must NOT obstruct the driving volume!
          // It must either be below the vehicle floor (<= 0.06m) or above the door clearance (>= 1.80m)
          const isFloorOnly = bbox.max.y <= 0.06;
          const isLintelOnly = bbox.min.y >= 1.8;
          expect(
            isFloorOnly || isLintelOnly,
            `Mesh ${mesh.name} obstructs Bay 2 vehicle volume: Y [${bbox.min.y.toFixed(2)}, ${bbox.max.y.toFixed(2)}]`,
          ).toBe(true);
        }
      }
    }
  });

  it("proves garageAnchorOpenBayInterior is a non-obstructive floor liner, not a solid block", () => {
    const cavity = garageShell.getObjectByName(
      "garageAnchorOpenBayInterior",
    ) as THREE.Mesh;
    expect(cavity).toBeDefined();

    cavity.geometry.computeBoundingBox();
    const bbox = cavity.geometry.boundingBox!.clone();
    bbox.applyMatrix4(cavity.matrix);

    // Height must be <= 0.06m, resting flat on the workshop slab
    expect(bbox.max.y).toBeLessThanOrEqual(0.06);
  });

  it("proves Bay 2 rollup door is rolled up near ceiling and clears driving height", () => {
    const door2 = garageShell.getObjectByName(
      "garageAnchorRollupDoor.2",
    ) as THREE.Mesh;
    expect(door2).toBeDefined();

    door2.updateMatrix();
    door2.geometry.computeBoundingBox();
    const bbox = door2.geometry.boundingBox!.clone();
    bbox.applyMatrix4(door2.matrix);

    // Rollup door 2 must be rolled up above 1.85m
    expect(bbox.min.y).toBeGreaterThanOrEqual(1.85);
  });

  it("proves frontal raycast sightline penetrates cleanly into Bay 2 cavity without front-face occlusion", () => {
    // Ensure all world matrices inside garageShell are up to date
    garageShell.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();

    // 1. Raycast straight into Bay 2 at vehicle eye level (Y = 1.0) from the driveway approach (Z = bayFaceZ + 3.0)
    // Ray origin and direction in asset-local coordinates of garageShell:
    const rayOriginLocal = new THREE.Vector3(bay2X, 1.0, bayFaceZ + 3.0);
    const rayDirLocal = new THREE.Vector3(0, 0, -1);

    // Transform to world coordinates for raycaster
    const rayOriginWorld = rayOriginLocal
      .clone()
      .applyMatrix4(garageShell.matrixWorld);
    const rayTargetWorld = rayOriginLocal
      .clone()
      .add(rayDirLocal)
      .applyMatrix4(garageShell.matrixWorld);
    const rayDirWorld = rayTargetWorld.clone().sub(rayOriginWorld).normalize();

    raycaster.set(rayOriginWorld, rayDirWorld);
    const hits = raycaster.intersectObjects(garageShell.children, true);

    // Filter hits to visible meshes
    const meshHits = hits.filter((h) => (h.object as any).isMesh);
    expect(meshHits.length).toBeGreaterThan(0);

    // The FIRST hit must NOT be at the front portal (Z ~ bayFaceZ)!
    // Convert first hit back to garage local coordinates
    const invGarageMatrix = garageShell.matrixWorld.clone().invert();
    const firstHitLocal = meshHits[0]!.point
      .clone()
      .applyMatrix4(invGarageMatrix);

    // First hit must penetrate deep into the bay interior (at least 1.5m behind bayFaceZ)
    expect(firstHitLocal.z).toBeLessThan(bayFaceZ - 1.5);
  });

  it("proves closed Bays 1 and 3 block frontal raycasts at the entrance door plane", () => {
    garageShell.updateMatrixWorld(true);
    const invGarageMatrix = garageShell.matrixWorld.clone().invert();
    const raycaster = new THREE.Raycaster();

    // Bay 1:
    const ray1OriginLocal = new THREE.Vector3(bay1X, 1.0, bayFaceZ + 3.0);
    const rayDirLocal = new THREE.Vector3(0, 0, -1);
    const ray1OriginWorld = ray1OriginLocal
      .clone()
      .applyMatrix4(garageShell.matrixWorld);
    const ray1TargetWorld = ray1OriginLocal
      .clone()
      .add(rayDirLocal)
      .applyMatrix4(garageShell.matrixWorld);
    raycaster.set(
      ray1OriginWorld,
      ray1TargetWorld.sub(ray1OriginWorld).normalize(),
    );
    const hits1 = raycaster
      .intersectObjects(garageShell.children, true)
      .filter((h) => (h.object as any).isMesh);

    expect(hits1.length).toBeGreaterThan(0);
    const firstHit1Local = hits1[0]!.point
      .clone()
      .applyMatrix4(invGarageMatrix);
    // Bay 1 is blocked at the door face
    expect(Math.abs(firstHit1Local.z - bayFaceZ)).toBeLessThan(0.15);
    expect(hits1[0]!.object.name).toBe("garageAnchorRollupDoor.1");

    // Bay 3:
    const ray3OriginLocal = new THREE.Vector3(bay3X, 1.0, bayFaceZ + 3.0);
    const ray3OriginWorld = ray3OriginLocal
      .clone()
      .applyMatrix4(garageShell.matrixWorld);
    const ray3TargetWorld = ray3OriginLocal
      .clone()
      .add(rayDirLocal)
      .applyMatrix4(garageShell.matrixWorld);
    raycaster.set(
      ray3OriginWorld,
      ray3TargetWorld.sub(ray3OriginWorld).normalize(),
    );
    const hits3 = raycaster
      .intersectObjects(garageShell.children, true)
      .filter((h) => (h.object as any).isMesh);

    expect(hits3.length).toBeGreaterThan(0);
    const firstHit3Local = hits3[0]!.point
      .clone()
      .applyMatrix4(invGarageMatrix);
    // Bay 3 is blocked at the door face
    expect(Math.abs(firstHit3Local.z - bayFaceZ)).toBeLessThan(0.15);
    expect(hits3[0]!.object.name).toBe("garageAnchorRollupDoor.3");
  });

  it("proves a multi-point grid of sightlines across the entire Bay 2 opening penetrates unimpeded", () => {
    garageShell.updateMatrixWorld(true);
    const invGarageMatrix = garageShell.matrixWorld.clone().invert();
    const raycaster = new THREE.Raycaster();
    const rayDirLocal = new THREE.Vector3(0, 0, -1);

    // Sample across 3 X positions and 3 Y heights across the drive-in portal
    const xOffsets = [-bayDoorW * 0.25, 0, bayDoorW * 0.25];
    const yHeights = [0.6, 1.0, 1.4];

    for (const xOff of xOffsets) {
      for (const yH of yHeights) {
        const originLocal = new THREE.Vector3(bay2X + xOff, yH, bayFaceZ + 2.5);
        const originWorld = originLocal
          .clone()
          .applyMatrix4(garageShell.matrixWorld);
        const targetWorld = originLocal
          .clone()
          .add(rayDirLocal)
          .applyMatrix4(garageShell.matrixWorld);
        raycaster.set(originWorld, targetWorld.sub(originWorld).normalize());

        const hits = raycaster
          .intersectObjects(garageShell.children, true)
          .filter((h) => (h.object as any).isMesh);
        expect(hits.length).toBeGreaterThan(0);

        const hitLocal = hits[0]!.point.clone().applyMatrix4(invGarageMatrix);
        // None of these rays hit a front obstruction at bayFaceZ!
        expect(
          hitLocal.z,
          `Ray at (${(bay2X + xOff).toFixed(2)}, ${yH.toFixed(2)}) blocked at Z=${hitLocal.z.toFixed(2)}`,
        ).toBeLessThan(bayFaceZ - 1.0);
      }
    }
  });
});
