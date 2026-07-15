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

const mountainRock = material("Pillar_Mountain_Rock", 0x343839, {
  roughness: 0.96,
  metalness: 0.01,
});
const obsidian = material("Pillar_Obsidian_Skin", 0x27383c, {
  roughness: 0.34,
  metalness: 0.62,
});
const blackIron = material("Pillar_Black_Iron", 0x424b4b, {
  roughness: 0.36,
  metalness: 0.82,
});
const oldBrass = material("Pillar_Old_Brass", 0x927747, {
  roughness: 0.43,
  metalness: 0.9,
});
const paleSeam = material("Pillar_Seam_Emissive", 0xa8bbb6, {
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
const skyGlyphMaterial = material("Pillar_Sky_Glyph_Emissive", 0x53645f, {
  roughness: 0.42,
  metalness: 0.38,
  emissive: 0x72958c,
  emissiveIntensity: 0.22,
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
  heightMeters: 622,
  authoredBy: "Vesper",
};

const stage1 = new THREE.Group();
stage1.name = "Pillar_Stage_1";
root.add(stage1);

mesh(
  "Pillar_Summit_Apron",
  new THREE.CylinderGeometry(15.2, 17.4, 1, 12),
  mountainRock,
  stage1,
  [0, -0.72, 0],
);
mesh(
  "Pillar_Summit_Terrace",
  new THREE.CylinderGeometry(12.8, 14.6, 0.82, 12),
  mountainRock,
  stage1,
  [0, -0.05, 0],
);
mesh(
  "Pillar_Buried_Dais",
  new THREE.CylinderGeometry(10.2, 11.6, 1.35, 10),
  mountainRock,
  stage1,
  [0, 0.2, 0],
);
mesh(
  "Pillar_Obsidian_Table",
  new THREE.CylinderGeometry(9.5, 10.3, 0.3, 12),
  obsidian,
  stage1,
  [0, 0.92, 0],
);
for (let index = 0; index < 8; index++) {
  const angle = (index / 8) * Math.PI * 2;
  const rune = mesh(
    `Pillar_Dais_Rune_${String(index + 1).padStart(2, "0")}`,
    new THREE.BoxGeometry(0.19, 0.08, 3.4),
    paleSeam,
    stage1,
    [Math.sin(angle) * 8.2, 1.09, Math.cos(angle) * 8.2],
  );
  rune.rotation.y = angle;
}
mesh(
  "Pillar_Foundation_Collar",
  new THREE.CylinderGeometry(7.3, 8.6, 2.8, 8),
  blackIron,
  stage1,
  [0, 1.5, 0],
);
mesh(
  "Pillar_Undercroft_Core",
  new THREE.CylinderGeometry(4.1, 4.7, 0.9, 8),
  coreLight,
  stage1,
  [0, 2.75, 0],
);
// Seven uneven guardian stones form an incomplete summit circle. The deliberate opening on local
// +Z receives the hiking path and makes the dais read as an ancient destination rather than a pad.
const sentinelAngles = [0.72, 1.48, 2.22, 2.98, 3.72, 4.46, 5.2];
for (let index = 0; index < sentinelAngles.length; index++) {
  const angle = sentinelAngles[index];
  const sentinel = mesh(
    `Pillar_Sentinel_${String(index + 1).padStart(2, "0")}`,
    new THREE.DodecahedronGeometry(1, 0),
    mountainRock,
    stage1,
    [Math.sin(angle) * 13.7, 2.15 + (index % 3) * 0.22, Math.cos(angle) * 13.7],
  );
  sentinel.scale.set(0.78 + (index % 2) * 0.12, 3.2 + (index % 3) * 0.42, 0.9);
  sentinel.rotation.set(
    index * 0.07,
    angle + index * 0.13,
    Math.sin(angle) * -0.13,
  );
}
for (let index = 0; index < 6; index++) {
  const angle = (index / 6) * Math.PI * 2 + 0.18;
  const rootMesh = mesh(
    `Pillar_Mountain_Root_${index + 1}`,
    new THREE.BoxGeometry(3.6, 2.5, 16),
    mountainRock,
    stage1,
    [Math.sin(angle) * 7.5, -0.3 - (index % 2) * 0.35, Math.cos(angle) * 7.5],
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
  const rib = mesh(
    `Pillar_Lower_Rib_${side + 1}`,
    new THREE.BoxGeometry(0.62, 27.5, 0.7),
    blackIron,
    stage2,
    [Math.sin(angle) * 3.78, 19.1, Math.cos(angle) * 3.78],
  );
  rib.rotation.y = angle;
  rib.rotation.z = side % 2 ? -0.018 : 0.018;
}
mesh(
  "Pillar_Lower_Brass_Band",
  new THREE.CylinderGeometry(4.28, 4.36, 0.42, 8),
  oldBrass,
  stage2,
  [0, 14.1, 0],
);
mesh(
  "Pillar_Upper_Brass_Band",
  new THREE.CylinderGeometry(3.64, 3.72, 0.38, 8),
  oldBrass,
  stage2,
  [0, 27.15, 0],
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
mesh(
  "Pillar_Retune_Ring_Inner",
  new THREE.TorusGeometry(4.72, 0.11, 8, 48),
  paleSeam,
  ring,
);
for (let brace = 0; brace < 4; brace++) {
  const angle = brace * Math.PI * 0.5;
  const part = mesh(
    `Pillar_Retune_Brace_${brace + 1}`,
    new THREE.BoxGeometry(0.24, 2.7, 0.22),
    blackIron,
    ring,
    [Math.cos(angle) * 3.95, Math.sin(angle) * 3.95, 0],
  );
  part.rotation.z = angle - Math.PI * 0.5;
}
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
  new THREE.CylinderGeometry(2.55, 3.15, 24, 8),
  obsidian,
  stage3,
  [0, 47.7, 0],
);
mesh(
  "Pillar_Distant_Monolith",
  new THREE.CylinderGeometry(1.15, 2.55, 525, 8),
  obsidian,
  stage3,
  [0, 322.3, 0],
);
mesh(
  "Pillar_Sky_Needle",
  new THREE.CylinderGeometry(0.08, 1.15, 37, 8),
  obsidian,
  stage3,
  [0, 603.5, 0],
);
for (let side = 0; side < 4; side++) {
  const angle = side * Math.PI * 0.5 + Math.PI * 0.25;
  const rib = mesh(
    `Pillar_Upper_Rib_${side + 1}`,
    new THREE.BoxGeometry(0.38, 17.8, 0.46),
    blackIron,
    stage3,
    [Math.sin(angle) * 2.28, 47.9, Math.cos(angle) * 2.28],
  );
  rib.rotation.y = angle;
  rib.rotation.z = side % 2 ? -0.02 : 0.02;
}
mesh(
  "Pillar_Needle_Collar_Lower",
  new THREE.CylinderGeometry(1.42, 1.48, 0.32, 8),
  oldBrass,
  stage3,
  [0, 584.7, 0],
);
mesh(
  "Pillar_Needle_Collar_Upper",
  new THREE.CylinderGeometry(0.68, 0.74, 0.28, 8),
  oldBrass,
  stage3,
  [0, 587.15, 0],
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
// These marks are deliberately vast in world units but sparse over the 525 metre sky shaft.
// From normal play they register as uncertain construction seams rather than readable signage.
const skyGlyphGeometry = new THREE.BoxGeometry(0.2, 8.5, 0.09);
const skyGlyphs = [
  [106, 0.25, 0.72],
  [148, 2.42, 1.35],
  [214, 4.58, 0.9],
  [286, 1.04, 1.7],
  [354, 3.22, 0.8],
  [418, 5.36, 1.25],
  [486, 1.92, 0.68],
  [542, 4.08, 1.5],
];
for (let index = 0; index < skyGlyphs.length; index++) {
  const [y, angle, heightScale] = skyGlyphs[index];
  const rise = THREE.MathUtils.clamp((y - 60) / 525, 0, 1);
  const radius = THREE.MathUtils.lerp(2.55, 1.15, rise) + 0.035;
  const glyph = mesh(
    `Pillar_Sky_Glyph_${String(index + 1).padStart(2, "0")}`,
    skyGlyphGeometry,
    skyGlyphMaterial,
    stage3,
    [Math.sin(angle) * radius, y, Math.cos(angle) * radius],
  );
  glyph.rotation.y = angle;
  glyph.rotation.z = index % 2 ? 0.045 : -0.035;
  glyph.scale.y = heightScale;
}
const crown = new THREE.Group();
crown.name = "Pillar_Crown_Iris";
crown.position.set(0, 579.2, 0);
stage3.add(crown);
const crownHalo = new THREE.Group();
crownHalo.name = "Pillar_Crown_Halo";
crown.add(crownHalo);
const outerHaloArc = new THREE.TorusGeometry(4.35, 0.26, 10, 18, 1.52);
const innerHaloArc = new THREE.TorusGeometry(3.82, 0.1, 8, 16, 1.24);
for (let index = 0; index < 3; index++) {
  const outer = mesh(
    `Pillar_Crown_Halo_Outer_Arc_${index + 1}`,
    outerHaloArc,
    oldBrass,
    crownHalo,
  );
  outer.rotation.z = index * ((Math.PI * 2) / 3) + 0.14;
  const inner = mesh(
    `Pillar_Crown_Halo_Inner_Arc_${index + 1}`,
    innerHaloArc,
    paleSeam,
    crownHalo,
  );
  inner.rotation.z = index * ((Math.PI * 2) / 3) + 0.48;
}
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
    [side * 2.05, 577.7, 0],
  );
  fin.rotation.z = side * -0.08;
}
for (const side of [-1, 1]) {
  const fin = mesh(
    side < 0 ? "Pillar_Crown_Fin_North" : "Pillar_Crown_Fin_South",
    new THREE.BoxGeometry(2.2, 7.3, 0.52),
    blackIron,
    stage3,
    [0, 577.55, side * 2.02],
  );
  fin.rotation.x = side * 0.08;
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
