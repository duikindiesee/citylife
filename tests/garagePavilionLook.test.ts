import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ColonyRuntime } from "../src/colony/runtime";
import { buildCommercialDistrictLayer } from "../src/colony/render/commercialDistrictLayer";
import {
  blendGarageEmissive,
  GARAGE_LIFT_POST_SPREAD,
} from "../src/colony/render/garageAnchorShell";
import { countRenderableTriangles } from "../src/colony/render/garagePavilionLook";

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
      0.25,
      bayFaceZ + 2.2,
    ).applyMatrix4(shell.matrixWorld);
    const target = new THREE.Vector3(
      model.serviceBay.x,
      0.22,
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

  it("stays inside the triangle budget", () => {
    const shellTris = countRenderableTriangles(shell);
    const workspace = shell.getObjectByName("garageAnchorOpenBayWorkspace");
    expect(workspace).toBeTruthy();
    const workspaceTris = countRenderableTriangles(workspace!);
    expect(workspaceTris).toBeLessThan(4000);
    expect(shellTris).toBeLessThan(40000);
  });
});
