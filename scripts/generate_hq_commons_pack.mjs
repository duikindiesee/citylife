// Spec 153 — HQ commons pack: the watercooler/games social kit for the
// commons hub and the Arcade room.
//
// Emits public/assets/citylife/props/hq-commons-pack.glb with eight named
// parts (meters, Y up, forward +Z, minY = 0 on every part):
//   Commons_Watercooler 0.50 x 1.40 x 0.50   pivot floor-center
//   Commons_Foosball    1.60 x 0.90 x 0.80   pivot floor-center (rods along X)
//   Commons_Arcade      0.70 x 1.80 x 0.80   pivot floor-center (emissive screen)
//   Commons_Couch       2.20 x 0.85 x 0.95   pivot floor-center (seat faces +Z)
//   Commons_BeanBag     0.90 x 0.55 x 0.90   pivot floor-center
//   Commons_FleetBoard  3.60 x 2.00 x 0.14   pivot floor-center-back
//   Commons_SnackShelf  1.20 x 1.60 x 0.40   pivot floor-center-back
//   Commons_Rug         3.00 x 0.025 x 2.00  pivot floor-center
//
// Deterministic by construction: fixed parameters and no time- or
// randomness-dependent calls; two runs are byte-identical.
// tests/hqCommonsPackGlb.test.ts guards the structural contract and the
// commons/arcade placement JSON. The FleetBoard's live data binding is the
// later WorklistProjection slice (spec 153 §11); these are inert props.
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

const warmWood = material("Commons_Warm_Wood", 0x8a6a48, { roughness: 0.68, metalness: 0.04 });
const darkWood = material("Commons_Dark_Wood", 0x5c4632, { roughness: 0.74, metalness: 0.03 });
const blackIron = material("Commons_Black_Iron", 0x424b4b, { roughness: 0.36, metalness: 0.82 });
const oldBrass = material("Commons_Old_Brass", 0x927747, { roughness: 0.43, metalness: 0.9 });
const obsidian = material("Commons_Obsidian_Panel", 0x27383c, { roughness: 0.34, metalness: 0.62 });
const tankGlass = material("Commons_Tank_Glass", 0x9fc4d8, {
  roughness: 0.12,
  metalness: 0.05,
  transparent: true,
  opacity: 0.4,
  flatShading: false,
});
const fabricSage = material("Commons_Fabric_Sage", 0x6d7a6f, { roughness: 0.9, metalness: 0.02 });
const fabricRust = material("Commons_Fabric_Rust", 0x7d5a44, { roughness: 0.9, metalness: 0.02 });
const screenGlow = material("Commons_Screen_Emissive", 0x0f1a14, {
  roughness: 0.3,
  emissive: 0x2dd4bf,
  emissiveIntensity: 1.0,
  flatShading: false,
});
const rugWeave = material("Commons_Rug_Weave", 0x4a4136, { roughness: 0.96, metalness: 0.0 });

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
root.name = "HqCommonsPack_Root";
root.userData = {
  asset: "hq-commons-pack",
  authoredBy: "Fable",
  units: "meters",
  upAxis: "Y",
  forwardAxis: "+Z",
  spec: "docs/specs/153-kooker-hq-campus-interior.md",
};

// Commons_Watercooler — the totem itself.
const cooler = new THREE.Group();
cooler.name = "Commons_Watercooler";
root.add(cooler);
mesh("Cooler_Cabinet", new THREE.BoxGeometry(0.45, 0.95, 0.45), obsidian, cooler, [0, 0.475, 0]);
mesh("Cooler_Tap_Panel", new THREE.BoxGeometry(0.3, 0.12, 0.05), oldBrass, cooler, [0, 0.78, 0.2]);
mesh("Cooler_Tank", new THREE.BoxGeometry(0.34, 0.4, 0.34), tankGlass, cooler, [0, 1.15, 0]);
mesh("Cooler_Cap", new THREE.BoxGeometry(0.5, 0.05, 0.5), blackIron, cooler, [0, 1.375, 0]);

// Commons_Foosball — table with X-aligned rods and brass handles.
const foosball = new THREE.Group();
foosball.name = "Commons_Foosball";
root.add(foosball);
mesh("Foos_Body", new THREE.BoxGeometry(1.3, 0.28, 0.8), warmWood, foosball, [0, 0.66, 0]);
for (const sx of [-1, 1])
  for (const sz of [-1, 1])
    mesh(
      `Foos_Leg_${sx < 0 ? "W" : "E"}${sz < 0 ? "N" : "S"}`,
      new THREE.BoxGeometry(0.09, 0.52, 0.09),
      blackIron,
      foosball,
      [sx * 0.55, 0.26, sz * 0.32],
    );
for (let rod = 0; rod < 4; rod += 1) {
  mesh(`Foos_Rod_${rod}`, new THREE.BoxGeometry(1.6, 0.03, 0.03), blackIron, foosball, [
    0, 0.875, -0.24 + rod * 0.16,
  ]);
  mesh(`Foos_Handle_${rod}`, new THREE.BoxGeometry(0.12, 0.05, 0.05), oldBrass, foosball, [
    rod % 2 === 0 ? 0.74 : -0.74, 0.875, -0.24 + rod * 0.16,
  ]);
}

// Commons_Arcade — cabinet with an emissive screen (decor shader at runtime).
const arcade = new THREE.Group();
arcade.name = "Commons_Arcade";
root.add(arcade);
mesh("Arcade_Body", new THREE.BoxGeometry(0.7, 1.7, 0.7), obsidian, arcade, [0, 0.85, -0.05]);
mesh("Arcade_Screen", new THREE.BoxGeometry(0.56, 0.5, 0.05), screenGlow, arcade, [0, 1.25, 0.325]);
mesh("Arcade_Deck", new THREE.BoxGeometry(0.66, 0.08, 0.3), warmWood, arcade, [0, 0.86, 0.25]);
mesh("Arcade_Marquee", new THREE.BoxGeometry(0.66, 0.1, 0.12), oldBrass, arcade, [0, 1.75, 0.24]);

// Commons_Couch — three-seat couch facing +Z.
const couch = new THREE.Group();
couch.name = "Commons_Couch";
root.add(couch);
mesh("Couch_Base", new THREE.BoxGeometry(2.2, 0.4, 0.9), fabricSage, couch, [0, 0.2, 0.025]);
mesh("Couch_Back", new THREE.BoxGeometry(2.2, 0.45, 0.22), fabricSage, couch, [0, 0.625, -0.365]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Couch_Arm_West" : "Couch_Arm_East",
    new THREE.BoxGeometry(0.18, 0.22, 0.9),
    fabricRust,
    couch,
    [side * 1.01, 0.51, 0.025],
  );
}
for (let i = 0; i < 3; i += 1) {
  mesh(`Couch_Cushion_${i}`, new THREE.BoxGeometry(0.58, 0.1, 0.7), fabricRust, couch, [
    -0.62 + i * 0.62, 0.45, 0.075,
  ]);
}

// Commons_BeanBag — low-poly squashed bag.
const bean = new THREE.Group();
bean.name = "Commons_BeanBag";
root.add(bean);
const bagGeometry = new THREE.IcosahedronGeometry(0.45, 1);
bagGeometry.scale(1, 0.6, 1); // baked squash: node transforms stay translation-only
mesh("Bean_Body", bagGeometry, fabricRust, bean, [0, 0.27, 0]);
mesh("Bean_Button", new THREE.BoxGeometry(0.1, 0.03, 0.1), darkWood, bean, [0, 0.535, 0]);

// Commons_FleetBoard — Arcade fleet-state board, back-flush.
const fleet = new THREE.Group();
fleet.name = "Commons_FleetBoard";
root.add(fleet);
mesh("Fleet_Panel", new THREE.BoxGeometry(3.6, 1.9, 0.08), obsidian, fleet, [0, 0.95, 0.04]);
mesh("Fleet_Screen", new THREE.BoxGeometry(3.44, 1.6, 0.03), screenGlow, fleet, [0, 0.95, 0.095]);
mesh("Fleet_Header", new THREE.BoxGeometry(3.6, 0.1, 0.14), oldBrass, fleet, [0, 1.95, 0.07]);

// Commons_SnackShelf — kitchenette shelf, back-flush.
const snack = new THREE.Group();
snack.name = "Commons_SnackShelf";
root.add(snack);
mesh("Snack_Back", new THREE.BoxGeometry(1.2, 1.6, 0.03), darkWood, snack, [0, 0.8, 0.015]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Snack_Upright_West" : "Snack_Upright_East",
    new THREE.BoxGeometry(0.05, 1.6, 0.4),
    blackIron,
    snack,
    [side * 0.575, 0.8, 0.2],
  );
}
for (let i = 0; i < 3; i += 1) {
  mesh(`Snack_Board_${i}`, new THREE.BoxGeometry(1.1, 0.035, 0.36), warmWood, snack, [
    0, 0.3 + i * 0.55, 0.2,
  ]);
}
const tinMats = [oldBrass, tankGlass, oldBrass];
for (let i = 0; i < 3; i += 1) {
  mesh(`Snack_Tin_${i}`, new THREE.BoxGeometry(0.18, 0.24, 0.18), tinMats[i], snack, [
    -0.3 + i * 0.3, 0.44 + (i % 2) * 0.55, 0.2,
  ]);
}

// Commons_Rug — soft zone marker for the couch corner.
const rug = new THREE.Group();
rug.name = "Commons_Rug";
root.add(rug);
mesh("Rug_Field", new THREE.BoxGeometry(3.0, 0.02, 2.0), rugWeave, rug, [0, 0.01, 0]);
mesh("Rug_Border", new THREE.BoxGeometry(2.7, 0.005, 1.7), fabricRust, rug, [0, 0.0225, 0]);

const scene = new THREE.Scene();
scene.name = "HqCommonsPack_Scene";
scene.add(root);
const result = await new Promise((resolveResult, reject) =>
  new GLTFExporter().parse(scene, resolveResult, reject, {
    binary: true,
    onlyVisible: false,
  }),
);
writeFileSync(resolve(outDir, "hq-commons-pack.glb"), Buffer.from(result));
console.log(`hq-commons-pack.glb ${result.byteLength} bytes`);
