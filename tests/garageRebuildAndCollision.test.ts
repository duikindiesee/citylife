// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  buildGarageAnchorShellModel,
  GARAGE_ASSET_VERSION,
  isPointInGarageVicinity,
  localFromGridCoordinates,
  gridFromLocalCoordinates,
  isPointInsideGarageObstacle,
  isPointInDrivableSurface,
  isPointInWalkableSurface,
  isCarFootprintClearOfGarageObstacles,
} from "../src/colony/render/garageAnchorShell";
import type { GaragePad } from "../src/colony/commerce/district";
import { SHOWROOM_VEHICLES } from "../src/colony/showroom/showroomCatalog";

describe("Spec 177 — Commercial Garage Rebuild: Discrete Surfaces, Obstacles & Swept Collision", () => {
  const rt = new ColonyRuntime(4242);
  const district = rt.sim.state.commercialDistrict!;
  const garagePad: GaragePad = district.garagePad!;
  const model = rt.getGarageModel()!;

  it("exports asset version 2.0.0 and public safe metadata", () => {
    expect(GARAGE_ASSET_VERSION).toBe("2.0.0");
    expect(model.assetVersion).toBe("2.0.0");
    expect(model.kind).toBe("garage_anchor_shell");
    expect(model.publicName).toBe("Gearbox Auto Hub");
    expect(model.isPublicSafe).toBe(true);
  });

  it("separates visible mesh, ownership plot, drivable surfaces, and physical obstacles", () => {
    // 1. Cadastral Ownership plot bounds
    expect(garagePad.w).toBe(16);
    expect(garagePad.h).toBe(11);
    expect(Number.isFinite(garagePad.facingAngle)).toBe(true);

    // 2. Discrete Drivable & Walkable Surface Zones
    expect(model.surfaces).toBeDefined();
    expect(model.surfaces.length).toBeGreaterThanOrEqual(4);
    const apron = model.surfaces.find((s) => s.kind === "apron");
    const forecourt = model.surfaces.find((s) => s.kind === "forecourt");
    const bayFloor = model.surfaces.find((s) => s.kind === "bay_floor");
    const showroomFloor = model.surfaces.find((s) => s.kind === "showroom_floor");

    expect(apron?.drivable).toBe(true);
    expect(forecourt?.drivable).toBe(true);
    expect(bayFloor?.drivable).toBe(true);
    expect(showroomFloor?.drivable).toBe(false); // Glass showroom is pedestrian only
    expect(showroomFloor?.walkable).toBe(true);

    // 3. Discrete Obstacles (Individual colliders, no single filled hull across the opening)
    expect(model.obstacles).toBeDefined();
    expect(model.obstacles.length).toBeGreaterThanOrEqual(9);

    // Rollup doors 1 and 3 exist as discrete obstacles
    const door1 = model.obstacles.find((o) => o.id === "rollup_door_1");
    const door3 = model.obstacles.find((o) => o.id === "rollup_door_3");
    expect(door1).toBeDefined();
    expect(door3).toBeDefined();

    // Crucial: Rollup Door 2 (Bay 2) has NO door obstacle — opening is 100% clear!
    const door2 = model.obstacles.find((o) => o.id === "rollup_door_2");
    expect(door2).toBeUndefined();
  });

  it("rotates parking stalls and parked display cars so they align lengthwise into the stalls (not sideways)", () => {
    expect(model.parkingBays.length).toBe(3);
    expect(model.displayCars.length).toBe(2);

    for (const bay of model.parkingBays) {
      // Rotated by Math.PI / 2 radians (perpendicular to curb, pointing along stall depth)
      expect(bay.rot).toBe(Math.PI / 2);
      expect(bay.w).toBeGreaterThanOrEqual(0.65); // ~2.6m wide
      expect(bay.d).toBeGreaterThanOrEqual(1.2); // ~5.0m deep
    }

    // Display vehicles parked in Bay 01 and Bay 02 match the bay rotation
    const car1 = model.displayCars[0]!;
    const car2 = model.displayCars[1]!;
    expect(car1.rot).toBe(model.parkingBays[0]!.rot);
    expect(car2.rot).toBe(model.parkingBays[1]!.rot);
    expect(car1.rot).toBe(Math.PI / 2);
    expect(car2.rot).toBe(Math.PI / 2);
  });

  it("eliminates the obstructing light stanchion from the service bay approach", () => {
    // Check that there is NO pole obstacle anywhere in the service bay driving lane
    const bayX = model.serviceBay.x;
    for (const obs of model.obstacles) {
      if (obs.kind === "pole") {
        // Any light pole must be located on the far west perimeter (x <= -6.0), never in front of the bay (x > 0)
        expect(obs.x).toBeLessThan(-6.0);
      }
    }
  });

  it("provides continuous drivability from the municipal road through the apron to the forecourt and open bay", () => {
    // 1. Point on the driveway apron (setback transition from road toward forecourt)
    const apronGrid = gridFromLocalCoordinates(garagePad, model.drivewayApron.x, model.drivewayApron.z);
    expect(isPointInGarageVicinity(apronGrid.x, apronGrid.y, garagePad)).toBe(true);
    expect(rt.isGaragePadDrivable(apronGrid.x, apronGrid.y, garagePad)).toBe(true);

    // 2. Point in the forecourt maneuvering area (in front of service bay)
    const forecourtGrid = gridFromLocalCoordinates(garagePad, model.serviceBay.x, model.forecourt.frontOffset);
    expect(rt.isGaragePadDrivable(forecourtGrid.x, forecourtGrid.y, garagePad)).toBe(true);

    // 3. Point at the threshold of open Bay 2 (passing through the rollup opening)
    const bayThresholdZ = model.serviceBay.z + model.serviceBay.d / 2;
    const thresholdGrid = gridFromLocalCoordinates(garagePad, model.serviceBay.x, bayThresholdZ);
    expect(rt.isGaragePadDrivable(thresholdGrid.x, thresholdGrid.y, garagePad)).toBe(true);

    // 4. Point deep inside Bay 2 centered between the lift posts
    const bayInsideZ = bayThresholdZ - 1.5;
    const insideGrid = gridFromLocalCoordinates(garagePad, model.serviceBay.x, bayInsideZ);
    expect(rt.isGaragePadDrivable(insideGrid.x, insideGrid.y, garagePad)).toBe(true);

    // 5. Point in open customer parking stall (BAY 03)
    const bay3 = model.parkingBays[2]!;
    const stallGrid = gridFromLocalCoordinates(garagePad, bay3.x, bay3.z);
    expect(rt.isGaragePadDrivable(stallGrid.x, stallGrid.y, garagePad)).toBe(true);
  });

  it("strictly blocks driving into physical building obstacles (walls, closed doors, columns, pylon)", () => {
    // 1. Exterior showroom front glass wall
    const glassWall = model.obstacles.find((o) => o.id === "showroom_glass_front")!;
    const glassGrid = gridFromLocalCoordinates(garagePad, glassWall.x, glassWall.z);
    expect(rt.isGaragePadDrivable(glassGrid.x, glassGrid.y, garagePad)).toBe(false);

    // 2. Exterior showroom side wall
    const westWall = model.obstacles.find((o) => o.id === "showroom_wall_west")!;
    const westGrid = gridFromLocalCoordinates(garagePad, westWall.x, westWall.z);
    expect(rt.isGaragePadDrivable(westGrid.x, westGrid.y, garagePad)).toBe(false);

    // 3. Dividing wall between showroom and service bay
    const divWall = model.obstacles.find((o) => o.id === "dividing_wall")!;
    const divGrid = gridFromLocalCoordinates(garagePad, divWall.x, divWall.z);
    expect(rt.isGaragePadDrivable(divGrid.x, divGrid.y, garagePad)).toBe(false);

    // 4. Closed Bay 1 rollup door
    const door1 = model.obstacles.find((o) => o.id === "rollup_door_1")!;
    const door1Grid = gridFromLocalCoordinates(garagePad, door1.x, door1.z);
    expect(rt.isGaragePadDrivable(door1Grid.x, door1Grid.y, garagePad)).toBe(false);

    // 5. Closed Bay 3 rollup door
    const door3 = model.obstacles.find((o) => o.id === "rollup_door_3")!;
    const door3Grid = gridFromLocalCoordinates(garagePad, door3.x, door3.z);
    expect(rt.isGaragePadDrivable(door3Grid.x, door3Grid.y, garagePad)).toBe(false);

    // 6. Service bay rear solid wall
    const backWall = model.obstacles.find((o) => o.id === "service_bay_wall_back")!;
    const backGrid = gridFromLocalCoordinates(garagePad, backWall.x, backWall.z);
    expect(rt.isGaragePadDrivable(backGrid.x, backGrid.y, garagePad)).toBe(false);

    // 7. Corner pylon
    const pylon = model.obstacles.find((o) => o.id === "corner_pylon")!;
    const pylonGrid = gridFromLocalCoordinates(garagePad, pylon.x, pylon.z);
    expect(rt.isGaragePadDrivable(pylonGrid.x, pylonGrid.y, garagePad)).toBe(false);
  });

  it("verifies car swept footprint collision across the full oriented vehicle body", () => {
    // Car heading aligned with driving into Bay 2 (heading = garagePad.facingAngle + Math.PI)
    const bayHeading = garagePad.facingAngle + Math.PI;

    // 1. Centered in Bay 2: full footprint (4 corners + midpoints) clears lift posts and walls
    const bayThresholdZ = model.serviceBay.z + model.serviceBay.d / 2;
    const centerGrid = gridFromLocalCoordinates(garagePad, model.serviceBay.x, bayThresholdZ - 1.2);
    const clearCenter = isCarFootprintClearOfGarageObstacles(
      centerGrid.x,
      centerGrid.y,
      bayHeading,
      garagePad,
      model.obstacles,
    );
    expect(clearCenter).toBe(true);

    // 2. Off-center: shifted toward left lift post so car corner clips the post
    const leftPost = model.obstacles.find((o) => o.id === "lift_post_left")!;
    const clippedGrid = gridFromLocalCoordinates(garagePad, leftPost.x, leftPost.z);
    const collided = isCarFootprintClearOfGarageObstacles(
      clippedGrid.x,
      clippedGrid.y,
      bayHeading,
      garagePad,
      model.obstacles,
    );
    expect(collided).toBe(false);
  });

  it("allows pedestrian walkability across apron, forecourt, service bay, and showroom floor", () => {
    // 1. Apron
    const apronGrid = gridFromLocalCoordinates(garagePad, model.drivewayApron.x, model.drivewayApron.z);
    expect(rt.isGaragePadWalkable(apronGrid.x, apronGrid.y, garagePad)).toBe(true);

    // 2. Forecourt parking
    const forecourtGrid = gridFromLocalCoordinates(garagePad, 0, model.forecourt.frontOffset);
    expect(rt.isGaragePadWalkable(forecourtGrid.x, forecourtGrid.y, garagePad)).toBe(true);

    // 3. Open service bay floor
    const bayGrid = gridFromLocalCoordinates(garagePad, model.serviceBay.x, model.serviceBay.z);
    expect(rt.isGaragePadWalkable(bayGrid.x, bayGrid.y, garagePad)).toBe(true);

    // 4. Showroom floor (walkway between central plinth and dividing wall)
    const showroomWalkX = -2.6;
    const showroomWalkZ = 0.2;
    const showroomGrid = gridFromLocalCoordinates(garagePad, showroomWalkX, showroomWalkZ);
    expect(rt.isGaragePadWalkable(showroomGrid.x, showroomGrid.y, garagePad)).toBe(true);

    // 5. Walking into solid walls is blocked
    const backWall = model.obstacles.find((o) => o.id === "service_bay_wall_back")!;
    const backGrid = gridFromLocalCoordinates(garagePad, backWall.x, backWall.z);
    expect(rt.isGaragePadWalkable(backGrid.x, backGrid.y, garagePad)).toBe(false);
  });

  it("preserves safe, path-connected exitOwnedCar when parked in Bay 3 or in the service bay", () => {
    const bay3 = model.parkingBays[2]!;
    const stallGrid = gridFromLocalCoordinates(garagePad, bay3.x, bay3.z);

    // Initialize operator and authoritative car
    rt.setOperatorUserId("test-op");
    rt.applyVehicleOwnership("test-op", ["showroom:karoo-x19-targa"]);

    // Teleport and seat car in parking stall
    rt.teleportCar(stallGrid.x, stallGrid.y, garagePad.facingAngle);
    (rt as any).ownedDriveSeated = true;
    expect(rt.getOwnedDrivePose()).toBeTruthy();

    // Exit car: finds a valid, passable exit tile beside the vehicle
    const exited = rt.exitOwnedCar();
    expect(exited).toBe(true);
    expect(rt.getOwnedDrivePose()).toBeNull();
  });

  it("proves production-path car tick collision: stops before showroom glass, stops before closed bay door, enters open bay 2, blocks turns into walls, and recovers in reverse", () => {
    rt.setOperatorUserId("test-op");
    rt.applyVehicleOwnership("test-op", ["showroom:karoo-x19-targa"]);

    // Heading into garage from forecourt is Math.PI / 2
    const headingIntoGarage = Math.PI / 2;

    // 1. Negative collision: car driving toward showroom glass wall stops before penetration
    const glassStart = gridFromLocalCoordinates(garagePad, model.showroom.x, 4.3);
    rt.teleportCar(glassStart.x, glassStart.y, headingIntoGarage);
    (rt as any).ownedDriveSeated = true;
    rt.setOwnedDriveInput({ throttle: true });
    for (let i = 0; i < 30; i++) rt.tickOwnedDrive(0.05);

    const glassPose = rt.getOwnedDrivePose()!;
    const glassLocal = localFromGridCoordinates(garagePad, glassPose.x, glassPose.y);
    const glassWall = model.obstacles.find((o) => o.id === "showroom_glass_front")!;
    // Vehicle stopped before the glass front collider (half-length clearance preserved)
    expect(glassLocal.z).toBeGreaterThan(glassWall.z + glassWall.d / 2);

    // 2. Negative collision: steering while touching front wall is blocked from turning into wall
    const initialHeading = glassPose.heading;
    rt.setOwnedDriveInput({ left: true });
    for (let i = 0; i < 10; i++) rt.tickOwnedDrive(0.05);
    expect(rt.getOwnedDrivePose()!.heading).toBe(initialHeading);

    rt.setOwnedDriveInput({ right: true });
    for (let i = 0; i < 10; i++) rt.tickOwnedDrive(0.05);
    expect(rt.getOwnedDrivePose()!.heading).toBe(initialHeading);

    // 3. Recovery / unsticking: reversing away from obstacle is allowed and clears the vehicle
    rt.setOwnedDriveInput({ reverse: true });
    for (let i = 0; i < 20; i++) rt.tickOwnedDrive(0.05);
    const revPose = rt.getOwnedDrivePose()!;
    const revLocal = localFromGridCoordinates(garagePad, revPose.x, revPose.y);
    expect(revLocal.z).toBeGreaterThan(glassLocal.z + 0.3);

    // 4. Negative collision: car driving toward Bay 1 closed rollup door is stopped
    const door1Obstacle = model.obstacles.find((o) => o.id === "rollup_door_1")!;
    const door1Start = gridFromLocalCoordinates(garagePad, door1Obstacle.x, 4.3);
    rt.teleportCar(door1Start.x, door1Start.y, headingIntoGarage);
    (rt as any).ownedDriveSeated = true;
    rt.setOwnedDriveInput({ throttle: true });
    for (let i = 0; i < 30; i++) rt.tickOwnedDrive(0.05);

    const door1Pose = rt.getOwnedDrivePose()!;
    const door1Local = localFromGridCoordinates(garagePad, door1Pose.x, door1Pose.y);
    expect(door1Local.z).toBeGreaterThan(door1Obstacle.z + door1Obstacle.d / 2);

    // 5. Positive drivability: car driving into Open Bay 2 successfully drives inside
    const bay2Start = gridFromLocalCoordinates(garagePad, model.serviceBay.x, 4.3);
    rt.teleportCar(bay2Start.x, bay2Start.y, headingIntoGarage);
    (rt as any).ownedDriveSeated = true;
    rt.setOwnedDriveInput({ throttle: true });
    for (let i = 0; i < 35; i++) rt.tickOwnedDrive(0.05);

    const bay2Pose = rt.getOwnedDrivePose()!;
    const bay2Local = localFromGridCoordinates(garagePad, bay2Pose.x, bay2Pose.y);
    const bayThresholdZ = model.serviceBay.z + model.serviceBay.d / 2;
    // Car has crossed the threshold and is inside Bay 2
    expect(bay2Local.z).toBeLessThan(bayThresholdZ);
  });

  it("proves actual Fiat X1/9 GLB hero car at scale 0.262 rotates 360 degrees on turntable plinth with >2.5m clearance to walls", async () => {
    const glbBuf = readFileSync(
      new URL("../public/assets/citylife/cars/fiat_x19.glb", import.meta.url),
    );
    const arrayBuffer = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength);

    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, "", resolve, reject);
    });

    const x19Spec = SHOWROOM_VEHICLES[2]!;
    const rotOffset = x19Spec.rotationOffset ?? [0, -Math.PI / 2, 0];

    // Replicate model preparation from R3FCommercialDistrict
    const carCopy = gltf.scene.clone(true);
    carCopy.rotation.set(rotOffset[0], rotOffset[1], rotOffset[2]);
    const root = new THREE.Group();
    root.add(carCopy);
    root.updateMatrixWorld(true);

    const unscaledBounds = new THREE.Box3().setFromObject(root);
    carCopy.position.x -= (unscaledBounds.min.x + unscaledBounds.max.x) / 2;
    carCopy.position.y -= unscaledBounds.min.y;
    carCopy.position.z -= (unscaledBounds.min.z + unscaledBounds.max.z) / 2;

    // Scale 0.262 inside 4x parent group
    const carScale = 0.262;
    carCopy.scale.setScalar(carScale);

    const turntableCar = new THREE.Group();
    turntableCar.add(root);

    // Compute dimensions in world metres (parent 4x group)
    turntableCar.updateMatrixWorld(true);
    const heroBox = new THREE.Box3().setFromObject(turntableCar);
    const sizeInWorldMetres = heroBox.getSize(new THREE.Vector3()).multiplyScalar(4);

    // Real world size matches ~4.28m length, ~1.06m height, ~1.91m width
    expect(sizeInWorldMetres.x).toBeGreaterThan(4.0);
    expect(sizeInWorldMetres.x).toBeLessThan(4.5);
    expect(sizeInWorldMetres.y).toBeGreaterThan(1.0);
    expect(sizeInWorldMetres.y).toBeLessThan(1.2);
    expect(sizeInWorldMetres.z).toBeGreaterThan(1.8);
    expect(sizeInWorldMetres.z).toBeLessThan(2.1);

    // Showroom walls in world metres (4x cell coordinates)
    const plinthX = model.showroom.x - model.showroom.w * 0.1;
    const plinthZ = model.showroom.z + model.showroom.d * 0.04;
    const westWallX = (model.showroom.x - model.showroom.w / 2) * 4;
    const dividingWallX = (model.serviceBay.x - model.serviceBay.w / 2) * 4;
    const glassFrontZ = (model.showroom.z + model.showroom.d / 2) * 4;
    const backWallZ = (model.showroom.z - model.showroom.d / 2) * 4;

    let minWestClearance = Infinity;
    let minDividingClearance = Infinity;
    let minGlassClearance = Infinity;
    let minBackClearance = Infinity;

    // Sweep 360 degrees across turntable rotation
    for (let deg = 0; deg <= 360; deg += 5) {
      turntableCar.rotation.y = (deg * Math.PI) / 180;
      turntableCar.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(turntableCar);

      const minXWorld = (plinthX + b.min.x) * 4;
      const maxXWorld = (plinthX + b.max.x) * 4;
      const minZWorld = (plinthZ + b.min.z) * 4;
      const maxZWorld = (plinthZ + b.max.z) * 4;

      minWestClearance = Math.min(minWestClearance, minXWorld - westWallX);
      minDividingClearance = Math.min(minDividingClearance, dividingWallX - maxXWorld);
      minGlassClearance = Math.min(minGlassClearance, glassFrontZ - maxZWorld);
      minBackClearance = Math.min(minBackClearance, minZWorld - backWallZ);
    }

    // Minimum clearance across all 360 degrees must exceed 2.5m in all directions
    expect(minWestClearance).toBeGreaterThan(2.5);
    expect(minDividingClearance).toBeGreaterThan(2.5);
    expect(minGlassClearance).toBeGreaterThan(2.5);
    expect(minBackClearance).toBeGreaterThan(2.5);
  });
});
