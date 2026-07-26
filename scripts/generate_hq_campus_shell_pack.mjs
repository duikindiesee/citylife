// Spec 153 — HQ campus shell pack: structural modules for the campus interior.
//
// Emits public/assets/citylife/props/hq-campus-shell-pack.glb with eight named
// modules (meters, Y up, forward +Z, minY = 0 on every part):
//   Shell_Wall1m        1.00 x 3.00 x 0.12   pivot floor-center
//   Shell_DoorFrame     2.20 x 2.65 x 0.16   pivot floor-center (1.6 m clear opening)
//   Shell_GlassPanel1m  1.00 x 3.00 x 0.10   pivot floor-center
//   Shell_FloorTile     2.00 x 0.08 x 2.00   pivot floor-center
//   Shell_CeilingDuct2m 2.00 x 0.35 x 0.35   pivot floor-center (integration raises to ceiling)
//   Shell_FloorStripe1m 1.00 x 0.02 x 0.30   pivot floor-center
//   Shell_Planter       0.60 x 1.15 x 0.60   pivot floor-center
//   Shell_ServerNook    0.80 x 2.00 x 0.60   pivot floor-center-back (back plane at z=0)
//
// Deterministic by construction: fixed parameters and no time- or
// randomness-dependent calls; two runs are byte-identical.
// tests/hqCampusShellPackGlb.test.ts guards the structural contract.
// Module snap rules live in hq-campus-shell-pack.modules.json. This script
// only writes the asset; runtime wiring is a later gated slice (spec 153 §11).
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

const wallPlaster = material("Shell_Wall_Plaster", 0x39424e, { roughness: 0.9, metalness: 0.02 });
const blackIron = material("Shell_Black_Iron", 0x424b4b, { roughness: 0.36, metalness: 0.82 });
const oldBrass = material("Shell_Old_Brass", 0x927747, { roughness: 0.43, metalness: 0.9 });
const glass = material("Shell_Glass", 0x9fc4d8, {
  roughness: 0.12,
  metalness: 0.05,
  transparent: true,
  opacity: 0.28,
  flatShading: false,
});
const floorSlab = material("Shell_Floor_Slab", 0x2a3038, { roughness: 0.95, metalness: 0.01 });
const stripePaint = material("Shell_Stripe_Paint", 0x6d7a6f, { roughness: 0.8, metalness: 0.02 });
const planterWood = material("Shell_Planter_Wood", 0x5c4632, { roughness: 0.75, metalness: 0.03 });
const foliage = material("Shell_Foliage", 0x3f7d44, { roughness: 0.92, metalness: 0.0 });
const rackLed = material("Shell_Rack_Led_Emissive", 0x0f1a14, {
  roughness: 0.3,
  emissive: 0x2dd4bf,
  emissiveIntensity: 1.4,
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
root.name = "HqCampusShellPack_Root";
root.userData = {
  asset: "hq-campus-shell-pack",
  authoredBy: "Fable",
  units: "meters",
  upAxis: "Y",
  forwardAxis: "+Z",
  spec: "docs/specs/153-kooker-hq-campus-interior.md",
};

// Shell_Wall1m — one metre of interior wall, tileable along X.
const wall = new THREE.Group();
wall.name = "Shell_Wall1m";
root.add(wall);
mesh("Wall_Slab", new THREE.BoxGeometry(1.0, 2.9, 0.12), wallPlaster, wall, [0, 1.45, 0]);
mesh("Wall_Skirt", new THREE.BoxGeometry(1.0, 0.1, 0.12), blackIron, wall, [0, 2.95, 0]);

// Shell_DoorFrame — 1.6 m clear opening with iron posts and a brass lintel.
const door = new THREE.Group();
door.name = "Shell_DoorFrame";
root.add(door);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Door_Post_West" : "Door_Post_East",
    new THREE.BoxGeometry(0.3, 2.5, 0.16),
    blackIron,
    door,
    [side * 0.95, 1.25, 0],
  );
}
mesh("Door_Lintel", new THREE.BoxGeometry(2.2, 0.15, 0.16), oldBrass, door, [0, 2.575, 0]);

// Shell_GlassPanel1m — one metre of glazed partition on iron rails.
const pane = new THREE.Group();
pane.name = "Shell_GlassPanel1m";
root.add(pane);
mesh("Glass_Rail_Bottom", new THREE.BoxGeometry(1.0, 0.12, 0.1), blackIron, pane, [0, 0.06, 0]);
mesh("Glass_Sheet", new THREE.BoxGeometry(1.0, 2.7, 0.05), glass, pane, [0, 1.47, 0]);
mesh("Glass_Rail_Top", new THREE.BoxGeometry(1.0, 0.18, 0.1), blackIron, pane, [0, 2.91, 0]);

// Shell_FloorTile — 2 x 2 m interior floor slab.
const tile = new THREE.Group();
tile.name = "Shell_FloorTile";
root.add(tile);
mesh("Tile_Slab", new THREE.BoxGeometry(2.0, 0.08, 2.0), floorSlab, tile, [0, 0.04, 0]);

// Shell_CeilingDuct2m — exposed-services duct run; integration raises it.
const duct = new THREE.Group();
duct.name = "Shell_CeilingDuct2m";
root.add(duct);
mesh("Duct_Body", new THREE.BoxGeometry(2.0, 0.3, 0.3), blackIron, duct, [0, 0.175, 0]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Duct_Ring_West" : "Duct_Ring_East",
    new THREE.BoxGeometry(0.08, 0.35, 0.35),
    oldBrass,
    duct,
    [side * 0.7, 0.175, 0],
  );
}

// Shell_FloorStripe1m — wing hue accent stripe (tinted at runtime per wing).
const stripe = new THREE.Group();
stripe.name = "Shell_FloorStripe1m";
root.add(stripe);
mesh("Stripe_Paint", new THREE.BoxGeometry(1.0, 0.02, 0.3), stripePaint, stripe, [0, 0.01, 0]);

// Shell_Planter — commons greenery.
const planter = new THREE.Group();
planter.name = "Shell_Planter";
root.add(planter);
mesh("Planter_Box", new THREE.BoxGeometry(0.6, 0.5, 0.6), planterWood, planter, [0, 0.25, 0]);
mesh("Planter_Soil", new THREE.BoxGeometry(0.52, 0.04, 0.52), floorSlab, planter, [0, 0.52, 0]);
mesh("Planter_Bush", new THREE.IcosahedronGeometry(0.28, 0), foliage, planter, [0, 0.82, 0]);
mesh("Planter_Sprig", new THREE.ConeGeometry(0.12, 0.35, 6), foliage, planter, [0.14, 0.975, 0.1]);

// Shell_ServerNook — atrium server rack, back-flush against a wall.
const nook = new THREE.Group();
nook.name = "Shell_ServerNook";
root.add(nook);
mesh("Nook_Cabinet", new THREE.BoxGeometry(0.8, 2.0, 0.55), blackIron, nook, [0, 1.0, 0.275]);
for (let i = 0; i < 4; i += 1) {
  mesh(`Nook_Led_Row_${i}`, new THREE.BoxGeometry(0.6, 0.06, 0.02), rackLed, nook, [
    0, 0.4 + i * 0.42, 0.59,
  ]);
}
mesh("Nook_Vent", new THREE.BoxGeometry(0.7, 0.25, 0.03), wallPlaster, nook, [0, 1.85, 0.585]);

const scene = new THREE.Scene();
scene.name = "HqCampusShellPack_Scene";
scene.add(root);
const result = await new Promise((resolveResult, reject) =>
  new GLTFExporter().parse(scene, resolveResult, reject, {
    binary: true,
    onlyVisible: false,
  }),
);
writeFileSync(resolve(outDir, "hq-campus-shell-pack.glb"), Buffer.from(result));
console.log(`hq-campus-shell-pack.glb ${result.byteLength} bytes`);
