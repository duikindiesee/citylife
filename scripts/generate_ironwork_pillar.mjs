import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onloadend?.({ target: this });
      });
    }
  };
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(rootDir, "public/assets/citylife/props");
const outFile = resolve(outDir, "ironwork-pillar.glb");
mkdirSync(outDir, { recursive: true });

const material = (name, color, options = {}) => {
  const value = new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.15,
    flatShading: options.flatShading ?? true,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  return value;
};

const mountainRock = material("Pillar_Mountain_Rock", 0x252a2c, {
  roughness: 0.96,
  metalness: 0.01,
});
const obsidian = material("Pillar_Obsidian_Skin", 0x0d1215, {
  roughness: 0.5,
  metalness: 0.48,
});
const blackIron = material("Pillar_Black_Iron", 0x171b1d, {
  roughness: 0.4,
  metalness: 0.8,
});
const oldBrass = material("Pillar_Old_Brass", 0x77633d, {
  roughness: 0.43,
  metalness: 0.9,
});
const paleSeam = material("Pillar_Seam_Emissive", 0x82908c, {
  roughness: 0.24,
  metalness: 0.25,
  emissive: 0xbde7dc,
  emissiveIntensity: 2.2,
  flatShading: false,
});
const coreLight = material("Pillar_Core_Emissive", 0xa8cfc4, {
  roughness: 0.16,
  metalness: 0.08,
  emissive: 0xc8fff0,
  emissiveIntensity: 4.1,
  flatShading: false,
});

const mesh = (name, geometry, mat, parent, position = [0, 0, 0]) => {
  const value = new THREE.Mesh(geometry, mat);
  value.name = name;
  value.position.set(...position);
  value.castShadow = true;
  value.receiveShadow = true;
  parent.add(value);
  return value;
};

const root = new THREE.Group();
root.name = "Ironwork_Pillar_Root";
root.userData = {
  asset: "ironwork-pillar",
  stages: 3,
  heightMeters: 66.5,
  authoredBy: "Vesper",
};

const stage1 = new THREE.Group();
stage1.name = "Pillar_Stage_1";
root.add(stage1);

mesh(
  "Pillar_Buried_Dais",
  new THREE.CylinderGeometry(8.2, 9.1, 1.2, 10),
  mountainRock,
  stage1,
  [0, 0.15, 0],
);
mesh(
  "Pillar_Foundation_Collar",
  new THREE.CylinderGeometry(5.6, 6.7, 2.3, 8),
  blackIron,
  stage1,
  [0, 1.25, 0],
);
mesh(
  "Pillar_Undercroft_Core",
  new THREE.CylinderGeometry(2.9, 3.4, 0.8, 8),
  coreLight,
  stage1,
  [0, 2.45, 0],
);
for (let index = 0; index < 6; index++) {
  const angle = (index / 6) * Math.PI * 2 + 0.18;
  const rootMesh = mesh(
    `Pillar_Mountain_Root_${index + 1}`,
    new THREE.BoxGeometry(3.2, 2.3, 13.5),
    mountainRock,
    stage1,
    [Math.sin(angle) * 6.2, -0.25 - (index % 2) * 0.35, Math.cos(angle) * 6.2],
  );
  rootMesh.rotation.y = angle;
  rootMesh.rotation.x = index % 2 ? 0.1 : -0.08;
  rootMesh.scale.set(0.72, 0.8, 1);
}
// A fractured highland outcrop rises on the far side of the dais. Local +Z faces the colony at
// runtime, so these negative-Z masses merge the foundation into the mountain while leaving the
// hiking approach open.
const outcrops = [
  [-5.8, 4.2, -7.6, 4.5, 8.5, 3.8],
  [0.4, 6.4, -9.8, 5.8, 13.5, 5.2],
  [6.2, 4.8, -8.2, 4.2, 10.2, 4.4],
  [-8.4, 2.8, -12.6, 3.6, 6.2, 4.1],
  [8.8, 3.1, -12.1, 3.4, 7.1, 3.8],
];
for (let index = 0; index < outcrops.length; index++) {
  const [x, y, z, sx, sy, sz] = outcrops[index];
  const outcrop = mesh(
    `Pillar_Outcrop_${index + 1}`,
    new THREE.DodecahedronGeometry(1, 0),
    mountainRock,
    stage1,
    [x, y, z],
  );
  outcrop.scale.set(sx, sy, sz);
  outcrop.rotation.set(index * 0.09, index * 0.61, index % 2 ? -0.12 : 0.1);
}

const stage2 = new THREE.Group();
stage2.name = "Pillar_Stage_2";
root.add(stage2);
mesh(
  "Pillar_Lower_Monolith",
  new THREE.CylinderGeometry(3.1, 4.75, 33, 8),
  obsidian,
  stage2,
  [0, 19.25, 0],
);
mesh(
  "Pillar_Lower_Iron_Collar",
  new THREE.CylinderGeometry(4.85, 5.15, 1.1, 8),
  blackIron,
  stage2,
  [0, 4.05, 0],
);
for (let side = 0; side < 4; side++) {
  const angle = side * Math.PI * 0.5 + Math.PI * 0.25;
  const seam = mesh(
    `Pillar_Lower_Seam_${side + 1}`,
    new THREE.BoxGeometry(0.18, 24, 0.12),
    paleSeam,
    stage2,
    [Math.sin(angle) * 3.45, 20, Math.cos(angle) * 3.45],
  );
  seam.rotation.y = angle;
  seam.rotation.z = side % 2 ? -0.025 : 0.025;
}

const ring = new THREE.Group();
ring.name = "Pillar_Retune_Ring";
ring.position.set(0, 36.2, 0);
stage2.add(ring);
mesh(
  "Pillar_Retune_Ring_Hoop",
  new THREE.TorusGeometry(5.6, 0.34, 10, 48),
  oldBrass,
  ring,
);
for (let tooth = 0; tooth < 12; tooth++) {
  const angle = (tooth / 12) * Math.PI * 2;
  const part = mesh(
    `Pillar_Retune_Tooth_${String(tooth + 1).padStart(2, "0")}`,
    new THREE.BoxGeometry(0.5, 1.15, 0.42),
    oldBrass,
    ring,
    [Math.cos(angle) * 5.6, Math.sin(angle) * 5.6, 0],
  );
  part.rotation.z = angle;
}
mesh(
  "Pillar_Retune_Axis",
  new THREE.CylinderGeometry(0.42, 0.42, 7.4, 12),
  blackIron,
  ring,
  [0, 0, 0],
).rotation.x = Math.PI * 0.5;

const stage3 = new THREE.Group();
stage3.name = "Pillar_Stage_3";
root.add(stage3);
mesh(
  "Pillar_Upper_Monolith",
  new THREE.CylinderGeometry(1.55, 3.15, 24, 8),
  obsidian,
  stage3,
  [0, 47.7, 0],
);
mesh(
  "Pillar_Sky_Needle",
  new THREE.CylinderGeometry(0.08, 1.55, 7.2, 8),
  obsidian,
  stage3,
  [0, 63.3, 0],
);
for (let side = 0; side < 4; side++) {
  const angle = side * Math.PI * 0.5 + Math.PI * 0.25;
  const seam = mesh(
    `Pillar_Upper_Seam_${side + 1}`,
    new THREE.BoxGeometry(0.12, 17.5, 0.08),
    paleSeam,
    stage3,
    [Math.sin(angle) * 2.18, 48.2, Math.cos(angle) * 2.18],
  );
  seam.rotation.y = angle;
  seam.rotation.z = side % 2 ? -0.022 : 0.022;
}
const crown = new THREE.Group();
crown.name = "Pillar_Crown_Iris";
crown.position.set(0, 58.9, 0);
stage3.add(crown);
for (const side of [-1, 1]) {
  const iris = mesh(
    side < 0 ? "Pillar_Iris_Left" : "Pillar_Iris_Right",
    new THREE.BoxGeometry(3.8, 5.8, 0.45),
    blackIron,
    crown,
    [side * 1.45, 0, 0],
  );
  iris.rotation.z = side * -0.12;
}
mesh(
  "Pillar_Crown_Core",
  new THREE.OctahedronGeometry(1.25, 1),
  coreLight,
  crown,
  [0, 0.2, 0],
);
for (const side of [-1, 1]) {
  const fin = mesh(
    side < 0 ? "Pillar_Crown_Fin_West" : "Pillar_Crown_Fin_East",
    new THREE.BoxGeometry(0.6, 8.5, 2.2),
    obsidian,
    stage3,
    [side * 2.05, 57.4, 0],
  );
  fin.rotation.z = side * -0.08;
}

const scene = new THREE.Scene();
scene.name = "Ironwork_Pillar_Scene";
scene.add(root);
const result = await new Promise((resolveResult, reject) =>
  new GLTFExporter().parse(scene, resolveResult, reject, {
    binary: true,
    onlyVisible: false,
  }),
);
writeFileSync(outFile, Buffer.from(result));
console.log(`ironwork-pillar.glb ${result.byteLength} bytes`);
