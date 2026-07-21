// Civic-art & landmark pack — deterministic authored GLB for the "Landmarks
// and Civic Art" lane. Placeable public-square dressing on the same pipeline as
// the reception/campus packs.
//
// Emits public/assets/citylife/props/hq-civic-art-pack.glb with five named
// parts (meters, Y up, forward +Z, minY = 0 on every part):
//   CivicArt_Fountain     2.60 x 2.57 x 2.60   pivot floor-center
//   CivicArt_Statue       1.20 x 3.20 x 1.20   pivot floor-center
//   CivicArt_Obelisk      0.80 x 5.00 x 0.80   pivot floor-center
//   CivicArt_BannerPole   1.04 x 3.90 x 0.40   pivot floor-pole-base (pole at x=0,z=0; cloth to +x, faces +Z)
//   CivicArt_PlanterBench 1.95 x 1.18 x 0.60   pivot floor-center (bench + planter combo)
//
// Deterministic by construction: fixed parameters and no time- or
// randomness-dependent calls; two runs are byte-identical.
// tests/hqCivicArtPackGlb.test.ts guards the structural contract and
// hq-civic-art-pack.placement.json carries example square placements.
// Runtime wiring is a later gated slice; this only writes the asset.
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
mkdirSync(outDir, { recursive: true });

const material = (name, color, options = {}) =>
  new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.15,
    flatShading: options.flatShading ?? true,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });

const stone = material("CivicArt_Stone", 0x8b8577, { roughness: 0.92, metalness: 0.02 });
const paleStone = material("CivicArt_Pale_Stone", 0xb9b3a2, { roughness: 0.88, metalness: 0.02 });
const bronze = material("CivicArt_Bronze", 0x6e5a34, { roughness: 0.5, metalness: 0.85 });
const oldBrass = material("CivicArt_Old_Brass", 0x927747, { roughness: 0.43, metalness: 0.9 });
const blackIron = material("CivicArt_Black_Iron", 0x424b4b, { roughness: 0.36, metalness: 0.82 });
const water = material("CivicArt_Water", 0x6fb3c9, {
  roughness: 0.15,
  metalness: 0.1,
  transparent: true,
  opacity: 0.55,
  flatShading: false,
});
const waterJet = material("CivicArt_Water_Jet_Emissive", 0xbfe6f0, {
  roughness: 0.12,
  emissive: 0x9fd4e6,
  emissiveIntensity: 1.1,
  flatShading: false,
});
const bannerCloth = material("CivicArt_Banner_Cloth", 0x7d5a44, { roughness: 0.9, metalness: 0.02 });
const bannerTrim = material("CivicArt_Banner_Emissive", 0xa8bbb6, {
  roughness: 0.25,
  emissive: 0xbde7dc,
  emissiveIntensity: 1.4,
  flatShading: false,
});
const warmWood = material("CivicArt_Warm_Wood", 0x8a6a48, { roughness: 0.68, metalness: 0.04 });
const foliage = material("CivicArt_Foliage", 0x3f7d44, { roughness: 0.92, metalness: 0.0 });

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
root.name = "HqCivicArtPack_Root";
root.userData = {
  asset: "hq-civic-art-pack",
  authoredBy: "Fable",
  units: "meters",
  upAxis: "Y",
  forwardAxis: "+Z",
  lane: "Landmarks and Civic Art",
};

// CivicArt_Fountain — three-tier basin with a central emissive water pillar.
const fountain = new THREE.Group();
fountain.name = "CivicArt_Fountain";
root.add(fountain);
mesh("Fountain_Basin_Lower", new THREE.CylinderGeometry(1.2, 1.3, 0.4, 16), stone, fountain, [0, 0.2, 0]);
mesh("Fountain_Water_Lower", new THREE.CylinderGeometry(1.08, 1.08, 0.05, 16), water, fountain, [0, 0.42, 0]);
mesh("Fountain_Pillar", new THREE.CylinderGeometry(0.3, 0.4, 0.7, 12), paleStone, fountain, [0, 0.75, 0]);
mesh("Fountain_Basin_Mid", new THREE.CylinderGeometry(0.7, 0.8, 0.28, 16), stone, fountain, [0, 1.14, 0]);
mesh("Fountain_Water_Mid", new THREE.CylinderGeometry(0.6, 0.6, 0.04, 16), water, fountain, [0, 1.3, 0]);
mesh("Fountain_Neck", new THREE.CylinderGeometry(0.16, 0.24, 0.5, 12), paleStone, fountain, [0, 1.55, 0]);
mesh("Fountain_Basin_Top", new THREE.CylinderGeometry(0.36, 0.42, 0.2, 16), stone, fountain, [0, 1.9, 0]);
mesh("Fountain_Jet", new THREE.CylinderGeometry(0.05, 0.09, 0.4, 8), waterJet, fountain, [0, 2.2, 0]);
mesh("Fountain_Jet_Cap", new THREE.OctahedronGeometry(0.12, 0), waterJet, fountain, [0, 2.45, 0]);

// CivicArt_Statue — plinth plus a stylised bronze figure massing.
const statue = new THREE.Group();
statue.name = "CivicArt_Statue";
root.add(statue);
mesh("Statue_Plinth_Base", new THREE.BoxGeometry(1.2, 0.5, 1.2), stone, statue, [0, 0.25, 0]);
mesh("Statue_Plinth_Body", new THREE.BoxGeometry(0.9, 0.8, 0.9), paleStone, statue, [0, 0.9, 0]);
mesh("Statue_Plinth_Cap", new THREE.BoxGeometry(1.0, 0.12, 1.0), oldBrass, statue, [0, 1.36, 0]);
mesh("Statue_Legs", new THREE.BoxGeometry(0.4, 0.9, 0.3), bronze, statue, [0, 1.87, 0]);
mesh("Statue_Torso", new THREE.BoxGeometry(0.5, 0.7, 0.32), bronze, statue, [0, 2.55, 0.02]);
mesh("Statue_Arm", new THREE.BoxGeometry(0.5, 0.14, 0.14), bronze, statue, [0.05, 2.7, 0.35]);
mesh("Statue_Head", new THREE.BoxGeometry(0.26, 0.3, 0.26), bronze, statue, [0, 3.05, 0.02]);

// CivicArt_Obelisk — tapered spire on a stepped base with a brass tip.
const obelisk = new THREE.Group();
obelisk.name = "CivicArt_Obelisk";
root.add(obelisk);
mesh("Obelisk_Step_1", new THREE.BoxGeometry(0.8, 0.24, 0.8), stone, obelisk, [0, 0.12, 0]);
mesh("Obelisk_Step_2", new THREE.BoxGeometry(0.6, 0.2, 0.6), paleStone, obelisk, [0, 0.34, 0]);
mesh("Obelisk_Shaft", new THREE.CylinderGeometry(0.1, 0.28, 4.1, 4), stone, obelisk, [0, 2.49, 0]);
mesh("Obelisk_Tip", new THREE.ConeGeometry(0.14, 0.46, 4), oldBrass, obelisk, [0, 4.77, 0]);

// CivicArt_BannerPole — iron pole with a hanging cloth banner (faces +Z).
const banner = new THREE.Group();
banner.name = "CivicArt_BannerPole";
root.add(banner);
mesh("Banner_Foot", new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10), blackIron, banner, [0, 0.06, 0]);
mesh("Banner_Pole", new THREE.CylinderGeometry(0.06, 0.06, 3.9, 8), blackIron, banner, [0, 1.95, 0]);
mesh("Banner_Crossarm", new THREE.BoxGeometry(0.9, 0.06, 0.06), oldBrass, banner, [0.35, 3.6, 0]);
mesh("Banner_Cloth", new THREE.BoxGeometry(0.8, 1.6, 0.03), bannerCloth, banner, [0.45, 2.75, 0.02]);
mesh("Banner_Trim", new THREE.BoxGeometry(0.8, 0.08, 0.04), bannerTrim, banner, [0.45, 1.99, 0.03]);

// CivicArt_PlanterBench — a bench flanked by a planter, one placeable unit.
const bench = new THREE.Group();
bench.name = "CivicArt_PlanterBench";
root.add(bench);
// Bench+planter is one unit; children are shifted so the unit is X-centred
// on the origin (floor-center pivot).
mesh("Bench_Seat", new THREE.BoxGeometry(1.3, 0.08, 0.5), warmWood, bench, [-0.325, 0.45, 0]);
mesh("Bench_Back", new THREE.BoxGeometry(1.3, 0.4, 0.06), warmWood, bench, [-0.325, 0.68, -0.22]);
for (const sx of [-1, 1]) {
  mesh(
    sx < 0 ? "Bench_Leg_West" : "Bench_Leg_East",
    new THREE.BoxGeometry(0.08, 0.45, 0.5),
    blackIron,
    bench,
    [-0.325 + sx * 0.55, 0.225, 0],
  );
}
mesh("Bench_Planter_Box", new THREE.BoxGeometry(0.6, 0.55, 0.6), stone, bench, [0.675, 0.275, 0]);
mesh("Bench_Planter_Soil", new THREE.BoxGeometry(0.52, 0.04, 0.52), warmWood, bench, [0.675, 0.57, 0]);
mesh("Bench_Bush", new THREE.IcosahedronGeometry(0.28, 0), foliage, bench, [0.675, 0.85, 0]);
mesh("Bench_Sprig", new THREE.ConeGeometry(0.12, 0.36, 6), foliage, bench, [0.775, 1.0, 0.08]);

const scene = new THREE.Scene();
scene.name = "HqCivicArtPack_Scene";
scene.add(root);
const result = await new Promise((resolveResult, reject) =>
  new GLTFExporter().parse(scene, resolveResult, reject, {
    binary: true,
    onlyVisible: false,
  }),
);
writeFileSync(resolve(outDir, "hq-civic-art-pack.glb"), Buffer.from(result));
console.log(`hq-civic-art-pack.glb ${result.byteLength} bytes`);
