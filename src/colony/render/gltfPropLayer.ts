import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Terrain } from "../terrain";
import type {
  CityLifePropAsset,
  CityLifePropPlacement,
} from "./venuePropAssets";

export interface GltfPropLayer {
  group: THREE.Group;
  update(daylight: number): void;
  dispose(): void;
}

interface GltfPropLayerOptions {
  assets: readonly CityLifePropAsset[];
  placements: readonly CityLifePropPlacement[];
  terrain: Terrain;
  wx: (x: number) => number;
  wz: (y: number) => number;
}

export function buildGltfPropLayer(
  opts: GltfPropLayerOptions,
): GltfPropLayer | null {
  if (opts.placements.length === 0) return null;
  const group = new THREE.Group();
  group.name = "CityLife GLB Venue Props";
  const owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  const emissiveMats: THREE.MeshStandardMaterial[] = [];
  const loader = new GLTFLoader();
  const byAsset = new Map<string, CityLifePropPlacement[]>();
  for (const p of opts.placements) {
    const arr = byAsset.get(p.assetId) ?? [];
    arr.push(p);
    byAsset.set(p.assetId, arr);
  }

  for (const asset of opts.assets) {
    const placements = byAsset.get(asset.id) ?? [];
    if (placements.length === 0 || !asset.publicSafe) continue;
    void loader.loadAsync(asset.url).then((gltf) => {
      // ASSEMBLE then GROUND the model. updateMatrixWorld so each sub-mesh node transform is known —
      // the instance matrix is placement * meshWorld, otherwise a multi-mesh GLB collapses ALL its
      // parts onto one point (a pile, not a model). baseMinY (the assembled scene minimum) then lifts
      // the real base flush onto the terrain so a centre-origin GLB is not half-buried. QA in-world,
      // day AND night, base flush on the ground — a green vitest cannot catch this (worldY is stubbed).
      gltf.scene.updateMatrixWorld(true);
      const baseMinY = new THREE.Box3().setFromObject(gltf.scene).min.y;
      gltf.scene.traverse((obj) => {
        const source = obj as THREE.Mesh;
        if (!source.isMesh) return;
        const meshWorld = source.matrixWorld.clone();
        const geom = source.geometry.clone();
        const mat = cloneMaterial(source.material);
        owned.push(geom);
        if (Array.isArray(mat)) {
          owned.push(...mat);
          for (const m of mat) collectEmissive(m, emissiveMats);
        } else {
          owned.push(mat);
          collectEmissive(mat, emissiveMats);
        }
        const mesh = new THREE.InstancedMesh(geom, mat, placements.length);
        mesh.name = `${asset.id}:${source.name || "mesh"}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const dummy = new THREE.Object3D();
        placements.forEach((p, i) => {
          const y = Math.max(0, opts.terrain.worldY(p.x, p.y));
          dummy.position.set(opts.wx(p.x), y - baseMinY * p.scale, opts.wz(p.y));
          dummy.rotation.set(0, p.rotationTurns * Math.PI * 2, 0);
          dummy.scale.setScalar(p.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix.clone().multiply(meshWorld));
        });
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      });
    });
  }

  return {
    group,
    update(daylight: number) {
      const night = 1 - daylight;
      for (const mat of emissiveMats)
        mat.emissiveIntensity = 0.25 + night * 0.85;
    },
    dispose() {
      for (const item of owned) item.dispose();
    },
  };
}

function cloneMaterial(
  material: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) return material.map((m) => m.clone());
  return material.clone();
}

function collectEmissive(
  mat: THREE.Material,
  out: THREE.MeshStandardMaterial[],
): void {
  const maybe = mat as THREE.MeshStandardMaterial;
  if (maybe.isMeshStandardMaterial && maybe.emissive) out.push(maybe);
}
