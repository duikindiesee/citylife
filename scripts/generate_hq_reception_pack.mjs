// Kooker HQ reception asset pack — deterministic authored GLB generator.
//
// Emits public/assets/citylife/props/hq-reception-pack.glb: one small pack of
// reception furniture for the spec-152 Kooker HQ reception room
// (src/colony/spatial/kookerHqInterior.ts — a 12 x 10 m interior grid, door
// centred on the z=0 wall at x=6, room opening toward +Z).
//
// Pack contents (all dimensions in meters, Y up, forward +Z):
//   HqReception_Desk          2.40 w x 0.96 h x 0.80 d   pivot: floor-center
//   HqReception_ManifestoWall 3.60 w x 2.36 h x 0.14 d   pivot: floor-center-back (back plane at local z=0)
//   HqReception_ArchiveShelf  1.80 w x 2.20 h x 0.45 d   pivot: floor-center-back (back plane at local z=0)
//
// Deterministic by construction: fixed geometry parameters and no
// time- or randomness-dependent calls. Running the generator twice must
// produce byte-identical output;
// tests/hqReceptionPackGlb.test.ts guards the structural contract and
// public/assets/citylife/props/hq-reception-pack.placement.json carries the
// reception-local placement metadata for the runtime-integration owner.
//
// This script only writes the asset file. It never touches the runtime scene,
// prop registry, portals or workflows.
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
const outFile = resolve(outDir, "hq-reception-pack.glb");
mkdirSync(outDir, { recursive: true });

// CityLife palette — matches the ironwork-pillar family so the reception reads
// as the same world (see scripts/generate_ironwork_pillar.mjs).
const material = (name, color, options = {}) =>
  new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.15,
    flatShading: options.flatShading ?? true,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });

const warmWood = material("HqReception_Warm_Wood", 0x8a6a48, {
  roughness: 0.68,
  metalness: 0.04,
});
const darkWood = material("HqReception_Dark_Wood", 0x5c4632, {
  roughness: 0.74,
  metalness: 0.03,
});
const blackIron = material("HqReception_Black_Iron", 0x424b4b, {
  roughness: 0.36,
  metalness: 0.82,
});
const oldBrass = material("HqReception_Old_Brass", 0x927747, {
  roughness: 0.43,
  metalness: 0.9,
});
const obsidian = material("HqReception_Obsidian_Panel", 0x27383c, {
  roughness: 0.34,
  metalness: 0.62,
});
const paleSeam = material("HqReception_Seam_Emissive", 0xa8bbb6, {
  roughness: 0.24,
  metalness: 0.25,
  emissive: 0xbde7dc,
  emissiveIntensity: 1.6,
  flatShading: false,
});
const paperCream = material("HqReception_Manifesto_Paper", 0xd9cfb8, {
  roughness: 0.92,
  metalness: 0.0,
});
const archiveBoxA = material("HqReception_Archive_Box_A", 0x6d7a6f, {
  roughness: 0.85,
  metalness: 0.02,
});
const archiveBoxB = material("HqReception_Archive_Box_B", 0x7d6f5a, {
  roughness: 0.85,
  metalness: 0.02,
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
root.name = "HqReceptionPack_Root";
root.userData = {
  asset: "hq-reception-pack",
  authoredBy: "Fable",
  units: "meters",
  upAxis: "Y",
  forwardAxis: "+Z",
  room: "kooker-hq/reception (spec 152, 12x10m grid)",
  parts: {
    HqReception_Desk: { w: 2.4, h: 0.96, d: 0.8, pivot: "floor-center" },
    HqReception_ManifestoWall: {
      w: 3.6,
      h: 2.36,
      d: 0.14,
      pivot: "floor-center-back",
    },
    HqReception_ArchiveShelf: {
      w: 1.8,
      h: 2.2,
      d: 0.45,
      pivot: "floor-center-back",
    },
  },
};

// ---------------------------------------------------------------------------
// HqReception_Desk — pivot at floor-center; front face toward local +Z.
// Counter slab on an iron under-frame with a brass service edge and a soft
// emissive welcome seam under the counter lip.
// ---------------------------------------------------------------------------
const desk = new THREE.Group();
desk.name = "HqReception_Desk";
root.add(desk);

mesh("Desk_Top", new THREE.BoxGeometry(2.4, 0.06, 0.8), warmWood, desk, [
  0, 0.93, 0,
]);
mesh("Desk_Front_Fascia", new THREE.BoxGeometry(2.4, 0.84, 0.06), obsidian, desk, [
  0, 0.48, 0.34,
]);
mesh("Desk_Brass_Edge", new THREE.BoxGeometry(2.4, 0.03, 0.045), oldBrass, desk, [
  0, 0.915, 0.3775,
]);
mesh("Desk_Welcome_Seam", new THREE.BoxGeometry(2.28, 0.025, 0.02), paleSeam, desk, [
  0, 0.86, 0.375,
]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Desk_Leg_West" : "Desk_Leg_East",
    new THREE.BoxGeometry(0.06, 0.9, 0.74),
    blackIron,
    desk,
    [side * 1.17, 0.45, 0],
  );
}
mesh("Desk_Back_Shelf", new THREE.BoxGeometry(2.28, 0.04, 0.3), darkWood, desk, [
  0, 0.42, -0.2,
]);

// ---------------------------------------------------------------------------
// HqReception_ManifestoWall — pivot floor-center-back; back plane at local
// z=0, faces +Z. A dark backboard carrying three brass-framed manifesto
// plaques under one emissive header seam.
// ---------------------------------------------------------------------------
const manifesto = new THREE.Group();
manifesto.name = "HqReception_ManifestoWall";
root.add(manifesto);

mesh("Manifesto_Backboard", new THREE.BoxGeometry(3.6, 2.3, 0.08), obsidian, manifesto, [
  0, 1.15, 0.04,
]);
mesh("Manifesto_Header_Seam", new THREE.BoxGeometry(3.3, 0.05, 0.03), paleSeam, manifesto, [
  0, 2.335, 0.095,
]);
mesh("Manifesto_Base_Trim", new THREE.BoxGeometry(3.6, 0.08, 0.1), blackIron, manifesto, [
  0, 0.04, 0.05,
]);
const plaqueX = [-1.15, 0, 1.15];
const plaqueNames = ["West", "Centre", "East"];
for (let i = 0; i < 3; i += 1) {
  mesh(
    `Manifesto_Plaque_Frame_${plaqueNames[i]}`,
    new THREE.BoxGeometry(1.0, 1.5, 0.04),
    oldBrass,
    manifesto,
    [plaqueX[i], 1.32, 0.1],
  );
  mesh(
    `Manifesto_Plaque_Paper_${plaqueNames[i]}`,
    new THREE.BoxGeometry(0.9, 1.4, 0.02),
    paperCream,
    manifesto,
    [plaqueX[i], 1.32, 0.13],
  );
}

// ---------------------------------------------------------------------------
// HqReception_ArchiveShelf — pivot floor-center-back; back plane at local
// z=0, faces +Z. Iron uprights, wood shelves, and a deterministic run of
// archive boxes (alternating materials, fixed pattern — no randomness).
// ---------------------------------------------------------------------------
const shelf = new THREE.Group();
shelf.name = "HqReception_ArchiveShelf";
root.add(shelf);

mesh("Archive_Back_Panel", new THREE.BoxGeometry(1.8, 2.2, 0.04), darkWood, shelf, [
  0, 1.1, 0.02,
]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Archive_Upright_West" : "Archive_Upright_East",
    new THREE.BoxGeometry(0.06, 2.2, 0.45),
    blackIron,
    shelf,
    [side * 0.87, 1.1, 0.225],
  );
}
const shelfHeights = [0.08, 0.6, 1.12, 1.64, 2.16];
for (let i = 0; i < shelfHeights.length; i += 1) {
  mesh(
    `Archive_Shelf_Board_${i}`,
    new THREE.BoxGeometry(1.68, 0.04, 0.42),
    warmWood,
    shelf,
    [0, shelfHeights[i], 0.225],
  );
}
// Deterministic box run: three boxes per open bay, alternating A/B materials.
const bayFloors = [0.1, 0.62, 1.14, 1.66];
const boxX = [-0.52, 0, 0.52];
for (let bay = 0; bay < bayFloors.length; bay += 1) {
  for (let slot = 0; slot < boxX.length; slot += 1) {
    if ((bay + slot) % 3 === 2) continue; // leave deterministic gaps so bays read as lived-in
    mesh(
      `Archive_Box_${bay}_${slot}`,
      new THREE.BoxGeometry(0.42, 0.34, 0.34),
      (bay + slot) % 2 === 0 ? archiveBoxA : archiveBoxB,
      shelf,
      [boxX[slot], bayFloors[bay] + 0.19, 0.24],
    );
  }
}

const scene = new THREE.Scene();
scene.name = "HqReceptionPack_Scene";
scene.add(root);
const result = await new Promise((resolveResult, reject) =>
  new GLTFExporter().parse(scene, resolveResult, reject, {
    binary: true,
    onlyVisible: false,
  }),
);
writeFileSync(outFile, Buffer.from(result));
console.log(`hq-reception-pack.glb ${result.byteLength} bytes`);
