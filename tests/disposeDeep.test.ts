// Spec 119 — GPU resource disposal. three.js runs fine in the node env, and dispose()
// fires a 'dispose' event on geometries and materials — so the helper's coverage is
// directly observable without a GPU.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { disposeDeep } from "../src/colony/render/disposeDeep";

function tree() {
  const root = new THREE.Group();
  const child = new THREE.Group();
  const geoA = new THREE.BoxGeometry(1, 1, 1);
  const geoB = new THREE.ConeGeometry(1, 2, 5);
  const matA = new THREE.MeshStandardMaterial();
  const matB = new THREE.MeshStandardMaterial();
  const matC = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(geoA, matA));
  child.add(new THREE.Mesh(geoB, [matB, matC]));
  root.add(child);
  return { root, geoA, geoB, mats: [matA, matB, matC] };
}

describe("spec 119 — disposeDeep frees every geometry and material in a built tree", () => {
  it("disposes nested geometries and single materials", () => {
    const { root, geoA, geoB } = tree();
    const events: string[] = [];
    geoA.addEventListener("dispose", () => events.push("geoA"));
    geoB.addEventListener("dispose", () => events.push("geoB"));
    disposeDeep(root);
    expect(events.sort()).toEqual(["geoA", "geoB"]);
  });

  it("disposes multi-material arrays", () => {
    const { root, mats } = tree();
    let disposed = 0;
    for (const m of mats) m.addEventListener("dispose", () => disposed++);
    disposeDeep(root);
    expect(disposed).toBe(3);
  });

  it("disposes textures owned by materials", () => {
    const root = new THREE.Group();
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    let texDisposed = false;
    tex.addEventListener("dispose", () => (texDisposed = true));
    disposeDeep(root);
    expect(texDisposed).toBe(true);
  });

  it("tolerates non-mesh children (lights, empty groups)", () => {
    const root = new THREE.Group();
    root.add(new THREE.PointLight());
    root.add(new THREE.Group());
    expect(() => disposeDeep(root)).not.toThrow();
  });
});
