// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";
import {
  blendGarageEmissive,
  GARAGE_BAY_DOOR_HEIGHT_M,
  GARAGE_CAR_METRE_SCALE,
  GARAGE_LIFT_DECK_M,
  GARAGE_LIFT_POST_SPREAD,
  GARAGE_SHOWROOM_HEIGHT_M,
  GARAGE_TURNTABLE_DIAMETER_M,
  GARAGE_WORKSHOP_HEIGHT_M,
  garageShowroomFloorCars,
} from "../src/colony/render/garageAnchorShell";
import { countRenderableTriangles } from "../src/colony/render/garagePavilionLook";

describe("Karoo GLB metre scale", () => {
  it("keeps each GLB at its authored metre bbox inside the x4 garage group", async () => {
    const loader = new GLTFLoader();
    for (const file of ["karoo_vonk.glb", "karoo_kaap_gt.glb", "fiat_x19.glb"]) {
      const buf = readFileSync(
        new URL(`../public/assets/citylife/cars/${file}`, import.meta.url),
      );
      const gltf = await new Promise<THREE.Group>((resolve, reject) => {
        loader.parse(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          "",
          (g) => resolve(g.scene),
          reject,
        );
      });
      const raw = new THREE.Box3().setFromObject(gltf).getSize(new THREE.Vector3());
      const world = raw.clone().multiplyScalar(GARAGE_CAR_METRE_SCALE * 4);
      expect(world.z, file).toBeGreaterThan(4);
      expect(world.z, file).toBeLessThan(4.5);
      expect(world.x, file).toBeGreaterThan(1.7);
      expect(world.x, file).toBeLessThan(2.1);
      expect(world.y, file).toBeGreaterThan(0.9);
      expect(world.y, file).toBeLessThan(1.2);
      expect(world.z, file).toBeCloseTo(raw.z, 5);
    }
  });
});

describe("blendGarageEmissive", () => {
  it("keeps the legacy absolute curve when a material is untagged", () => {
    expect(blendGarageEmissive(1, null)).toBeCloseTo(0.12);
    expect(blendGarageEmissive(0, null)).toBeCloseTo(1.05);
    expect(blendGarageEmissive(0.5, null)).toBeCloseTo(0.12 + 0.5 * 0.93);
  });

  it("preserves an authored night intensity and dims it at noon", () => {
    const authored = { night: 2.35, day: 0.42 };
    expect(blendGarageEmissive(0, authored)).toBeCloseTo(2.35);
    expect(blendGarageEmissive(1, authored)).toBeCloseTo(0.42);
    expect(blendGarageEmissive(0.5, authored)).toBeCloseTo(0.42 + 0.5 * (2.35 - 0.42));
  });
});

describe("Gearbox desert pavilion look", () => {
  const rt = new ColonyRuntime(4242);
  const s = rt.sim.state;
  const d = s.commercialDistrict!;
  const t = s.terrain;
  const N = t.size;
  const layer = buildCommercialDistrictLayer({
    state: s,
    district: d,
    wx: (x) => (x - N / 2) * 4,
    wz: (y) => (y - N / 2) * 4,
    surfaceY: (x, y) => Math.max(0, t.worldY(Math.round(x), Math.round(y))),
  });
  const shell = layer.group.getObjectByName(
    "commercialDistrict.garagePad.garageAnchorShell",
  ) as THREE.Group;
  const model = rt.getGarageModel()!;

  function matOf(name: string): THREE.MeshStandardMaterial {
    const mesh = shell.getObjectByName(name) as THREE.Mesh;
    expect(mesh, name).toBeTruthy();
    return mesh.material as THREE.MeshStandardMaterial;
  }

  it("keeps the ceiling bright at night and does not flatten legacy HQ glow", () => {
    const camera = new THREE.PerspectiveCamera();
    const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
    layer.update(0, camera, new THREE.Scene(), canvas);
    const strips = matOf("garageAnchorShowroomCeilingStrips");
    expect(strips.emissiveIntensity).toBeCloseTo(2.35, 2);
    expect(strips.emissive.getHex()).toBe(0xfffaed);

    let legacy: THREE.MeshStandardMaterial | null = null;
    shell.parent?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat?.emissive?.getHex?.() === 0xffb347 && !mat.userData.garageAuthoredEmissive) {
          legacy = mat;
        }
      }
    });
    expect(legacy, "untagged HQ bollard").toBeTruthy();
    expect(legacy!.emissiveIntensity).toBeCloseTo(1.05, 2);

    layer.update(1, camera, new THREE.Scene(), canvas);
    expect(strips.emissiveIntensity).toBeCloseTo(0.42, 2);
    expect(legacy!.emissiveIntensity).toBeCloseTo(0.12, 2);
  });

  it("uses teal glass, wood mullions, speckled terrazzo, slats, and a yellow curb", () => {
    const glass = matOf("garageAnchorGlassShowroom");
    expect(glass.color.getHex()).toBe(0x9fd4cc);
    expect(glass.roughness).toBeLessThan(0.15);
    expect(glass.transparent).toBe(true);
    const wood = matOf("garageAnchorShowroomMullions");
    expect(wood.color.getHex()).not.toBe(0x1b232e);
    expect(wood.color.getHex()).toBe(0x8d5a32);
    const floor = matOf("garageAnchorShowroomTerrazzo");
    const map = floor.map as THREE.DataTexture;
    expect(map).toBeTruthy();
    expect(map.image.width).toBeLessThanOrEqual(512);
    expect(shell.getObjectByName("garageAnchorShowroomWoodSlats")).toBeTruthy();
    expect(shell.getObjectByName("garageAnchorShowroomTurntableRing")).toBeTruthy();
    const curb = matOf("garageAnchorApronYellowCurb");
    expect(curb.color.getHex()).toBe(0xffc83b);
  });

  it("keeps poles and lift posts out of the approach onto the glass and the open bay", () => {
    const showroomWest = model.showroom.x - model.showroom.w / 2;
    const showroomEast = model.showroom.x + model.showroom.w / 2;
    const opening = model.serviceBay.bayDoorW / 2;
    const pole = model.obstacles.find((o) => o.id === "forecourt_light_pole_west")!;
    expect(pole).toBeTruthy();
    expect(pole.x).toBeLessThan(-6);
    const overGlass = pole.x > showroomWest + 0.2 && pole.x < showroomEast - 0.2;
    const overBay = Math.abs(pole.x - model.serviceBay.x) < opening;
    expect(overGlass).toBe(false);
    expect(overBay).toBe(false);
    expect(model.obstacles.filter((o) => o.kind === "pole")).toHaveLength(1);
    const posts = model.obstacles.filter((o) => o.kind === "lift_post");
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(Math.abs(post.x - model.serviceBay.x)).toBeCloseTo(
        model.serviceBay.bayDoorW * GARAGE_LIFT_POST_SPREAD,
        5,
      );
      expect(Math.abs(post.x - model.serviceBay.x)).toBeGreaterThan(0.55);
    }
  });

  it("shows the lift car from the apron without a post or pier in front of it", () => {
    shell.updateMatrixWorld(true);
    const bayFaceZ = model.serviceBay.z + model.serviceBay.d / 2 + 0.045;
    const origin = new THREE.Vector3(
      model.serviceBay.x,
      0.45,
      bayFaceZ + 2.2,
    ).applyMatrix4(shell.matrixWorld);
    const target = new THREE.Vector3(
      model.serviceBay.x,
      0.45,
      bayFaceZ - 1.2,
    ).applyMatrix4(shell.matrixWorld);
    const ray = new THREE.Raycaster(origin, target.sub(origin).normalize());
    const hits = ray
      .intersectObjects(shell.children, true)
      .filter((h) => (h.object as THREE.Mesh).isMesh);
    expect(hits.length).toBeGreaterThan(0);
    const named = (obj: THREE.Object3D, needle: string) => {
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (cur.name.includes(needle)) return true;
        cur = cur.parent;
      }
      return false;
    };
    const first = hits[0]!.object;
    expect(named(first, "garageAnchorBayLiftCar")).toBe(true);
    expect(named(first, "HydraulicLift")).toBe(false);
    expect(named(first, "Pier")).toBe(false);
    expect(named(first, "Partition")).toBe(false);
  });

  it("uses a one-storey showroom, a 7 m turntable, and a lift car facing into the bay", () => {
    expect(model.showroom.h * model.renderScale).toBe(GARAGE_SHOWROOM_HEIGHT_M);
    expect(model.serviceBay.h * model.renderScale).toBe(GARAGE_WORKSHOP_HEIGHT_M);
    expect(GARAGE_BAY_DOOR_HEIGHT_M).toBeGreaterThanOrEqual(3);
    expect(GARAGE_BAY_DOOR_HEIGHT_M).toBeLessThanOrEqual(3.5);
    expect(GARAGE_TURNTABLE_DIAMETER_M).toBe(7);

    const plinth = shell.getObjectByName("garageAnchorShowroomPlinth") as THREE.Mesh;
    expect(plinth.position.x).toBeCloseTo(model.showroom.x, 5);
    expect(plinth.position.z).toBeCloseTo(model.showroom.z, 5);

    shell.updateMatrixWorld(true);
    expect(shell.scale.x).toBe(4);
    expect(shell.scale.y).toBe(4);
    expect(shell.scale.z).toBe(4);
    expect(shell.parent?.scale.x ?? 1).toBe(1);
    const car = shell.getObjectByName("garageAnchorBayLiftCar") as THREE.Group;
    const shellPos = new THREE.Vector3();
    const carPos = new THREE.Vector3();
    shell.getWorldPosition(shellPos);
    car.getWorldPosition(carPos);
    expect(carPos.y - shellPos.y).toBeCloseTo(GARAGE_LIFT_DECK_M, 1);

    const inv = shell.matrixWorld.clone().invert();
    const local = new THREE.Box3();
    car.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox!.clone();
      b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      local.union(b);
    });
    const sizeM = local.getSize(new THREE.Vector3()).multiplyScalar(model.renderScale);
    expect(sizeM.z).toBeGreaterThan(sizeM.x);
    expect(sizeM.z).toBeGreaterThan(3.5);
    expect(sizeM.z).toBeLessThan(5);

    const plinthMesh = shell.getObjectByName("garageAnchorShowroomPlinth") as THREE.Mesh;
    const floor = shell.getObjectByName("garageAnchorShowroomTerrazzo") as THREE.Mesh;
    floor.geometry.computeBoundingBox();
    const floorTop =
      floor.position.y + (floor.geometry.boundingBox!.max.y - floor.geometry.boundingBox!.min.y) / 2;
    plinthMesh.geometry.computeBoundingBox();
    const discTop =
      plinthMesh.position.y + plinthMesh.geometry.boundingBox!.max.y;
    expect((discTop - floorTop) * model.renderScale).toBeGreaterThan(0.14);
    expect((discTop - floorTop) * model.renderScale).toBeLessThan(0.26);
    const ring = shell.getObjectByName("garageAnchorShowroomTurntableRing");
    expect(ring?.parent?.name).toBe("garageAnchorShowroomPlinth");

    const cars = garageShowroomFloorCars(model.showroom);
    expect(cars).toHaveLength(4);
    for (const slot of cars) {
      const node = shell.getObjectByName(slot.id) as THREE.Object3D;
      expect(node.rotation.x).toBe(0);
      expect(node.rotation.z).toBe(0);
      expect(node.position.y).toBeCloseTo(floorTop, 5);
      const clearance = Math.hypot(slot.x - model.showroom.x, slot.z - model.showroom.z) * model.renderScale;
      expect(clearance).toBeGreaterThan(GARAGE_TURNTABLE_DIAMETER_M / 2 + 2.5);
    }
  });

  it("stays inside the triangle budget", () => {
    const shellTris = countRenderableTriangles(shell);
    const workspace = shell.getObjectByName("garageAnchorOpenBayWorkspace");
    expect(workspace).toBeTruthy();
    const workspaceTris = countRenderableTriangles(workspace!);
    expect(workspaceTris).toBeLessThan(4000);
    expect(shellTris).toBeLessThan(40000);
  });
});
