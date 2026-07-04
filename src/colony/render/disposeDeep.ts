// Spec 119 — GPU resource disposal. Imperatively-built object trees (the chunked terrain,
// prop groups) are replaced wholesale when their inputs change; three.js never frees GPU
// buffers on its own, so every rebuild leaked the previous tree's geometries and
// materials. Now that the world actually re-renders on sim mutations (spec 115), the
// leaks compound in long sessions.
import * as THREE from "three";

/** Dispose every geometry and material below (and including) the given object.
 *  Materials may be arrays (multi-material meshes); textures on materials are disposed
 *  too. Safe to call on trees that share nothing with live objects — callers own the
 *  whole subtree (that is the contract: only call this on groups YOU built). */
export function disposeDeep(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (Array.isArray(material)) {
      for (const m of material) disposeMaterial(m);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(m: THREE.Material): void {
  // Free any textures the material owns before the material itself.
  for (const value of Object.values(m)) {
    if (value && typeof value === "object" && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  m.dispose();
}
