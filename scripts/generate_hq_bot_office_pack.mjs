// Spec 153 — HQ bot-office pack: the repeatable 4x5 m office module kit.
//
// Emits public/assets/citylife/props/hq-bot-office-pack.glb with thirteen named
// parts (meters, Y up, forward +Z, minY = 0 on every part):
//   Office_Desk          1.60 x 0.75 x 0.80   pivot floor-center
//   Office_TaskChair     0.50 x 0.95 x 0.55   pivot floor-center
//   Office_WorklistBoard 3.00 x 1.80 x 0.12   pivot floor-center-back
//   Office_TaskCard      0.60 x 0.40 x 0.04   pivot floor-center-back (instanced on the board)
//   Office_StatusTotem   0.40 x 2.20 x 0.40   pivot floor-center
//   Office_DoorLight     0.35 x 0.14 x 0.10   pivot floor-center-back (mounted above doors)
//   Office_Shelf         1.20 x 1.80 x 0.35   pivot floor-center-back
//   Office_DeskLamp      0.22 x 0.48 x 0.15   pivot floor-center (sits on desks)
//   Office_Plant         0.40 x 0.85 x 0.40   pivot floor-center
//   Office_LiaisonDesk   1.20 x 0.75 x 0.60   pivot floor-center (Suzi commons desk)
//   Office_RoutingBoard  1.60 x 1.20 x 0.10   pivot floor-center-back
//   Office_LibrarySign   1.60 x 0.50 x 0.08   pivot floor-center-back (emissive "LIBRARY ->")
//   Office_Workbench     1.80 x 1.05 x 0.70   pivot floor-center (heavy kit)
//
// Deterministic by construction: fixed parameters and no time- or
// randomness-dependent calls; two runs are byte-identical.
// tests/hqBotOfficePackGlb.test.ts guards the structural contract and the
// spec-153 slot formula in hq-bot-office-pack.placement.json. Runtime wiring
// (registry binding, worklist projection) is a later gated slice (spec 153 §11).
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
  });

const warmWood = material("Office_Warm_Wood", 0x8a6a48, { roughness: 0.68, metalness: 0.04 });
const darkWood = material("Office_Dark_Wood", 0x5c4632, { roughness: 0.74, metalness: 0.03 });
const blackIron = material("Office_Black_Iron", 0x424b4b, { roughness: 0.36, metalness: 0.82 });
const oldBrass = material("Office_Old_Brass", 0x927747, { roughness: 0.43, metalness: 0.9 });
const obsidian = material("Office_Obsidian_Panel", 0x27383c, { roughness: 0.34, metalness: 0.62 });
const boardGlow = material("Office_Board_Emissive", 0x0f1a14, {
  roughness: 0.3,
  emissive: 0x2dd4bf,
  emissiveIntensity: 0.9,
  flatShading: false,
});
const seatFabric = material("Office_Seat_Fabric", 0x6d7a6f, { roughness: 0.88, metalness: 0.02 });
const cardPaper = material("Office_Card_Paper", 0xd9cfb8, { roughness: 0.92, metalness: 0.0 });
const totemBand = material("Office_Totem_Emissive", 0xa8bbb6, {
  roughness: 0.25,
  emissive: 0xbde7dc,
  emissiveIntensity: 1.8,
  flatShading: false,
});
const signAmber = material("Office_Sign_Amber_Emissive", 0x6b4e12, {
  roughness: 0.3,
  emissive: 0xe8b64c,
  emissiveIntensity: 1.3,
  flatShading: false,
});
const foliage = material("Office_Foliage", 0x3f7d44, { roughness: 0.92, metalness: 0.0 });

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
root.name = "HqBotOfficePack_Root";
root.userData = {
  asset: "hq-bot-office-pack",
  authoredBy: "Fable",
  units: "meters",
  upAxis: "Y",
  forwardAxis: "+Z",
  spec: "docs/specs/153-kooker-hq-campus-interior.md",
};

// Office_Desk — 1.6 m work desk, front toward +Z.
const desk = new THREE.Group();
desk.name = "Office_Desk";
root.add(desk);
mesh("Desk_Top", new THREE.BoxGeometry(1.6, 0.05, 0.8), warmWood, desk, [0, 0.725, 0]);
mesh("Desk_Modesty", new THREE.BoxGeometry(1.6, 0.6, 0.05), obsidian, desk, [0, 0.42, 0.3]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Desk_Leg_West" : "Desk_Leg_East",
    new THREE.BoxGeometry(0.05, 0.7, 0.74),
    blackIron,
    desk,
    [side * 0.775, 0.35, 0],
  );
}

// Office_TaskChair — simple task chair facing +Z.
const chair = new THREE.Group();
chair.name = "Office_TaskChair";
root.add(chair);
mesh("Chair_Base", new THREE.BoxGeometry(0.45, 0.08, 0.45), blackIron, chair, [0, 0.04, 0]);
mesh("Chair_Post", new THREE.BoxGeometry(0.08, 0.34, 0.08), blackIron, chair, [0, 0.29, 0]);
mesh("Chair_Seat", new THREE.BoxGeometry(0.5, 0.08, 0.5), seatFabric, chair, [0, 0.5, 0.025]);
mesh("Chair_Back", new THREE.BoxGeometry(0.46, 0.45, 0.06), seatFabric, chair, [0, 0.725, -0.245]);

// Office_WorklistBoard — the live task board; back-flush against a wall.
const board = new THREE.Group();
board.name = "Office_WorklistBoard";
root.add(board);
mesh("Board_Panel", new THREE.BoxGeometry(3.0, 1.7, 0.08), obsidian, board, [0, 0.85, 0.04]);
mesh("Board_Screen", new THREE.BoxGeometry(2.84, 1.5, 0.02), boardGlow, board, [0, 0.85, 0.09]);
for (let lane = 0; lane < 3; lane += 1) {
  mesh(`Board_Lane_${lane}`, new THREE.BoxGeometry(0.04, 1.4, 0.015), blackIron, board, [
    -0.71 + lane * 0.71, 0.85, 0.1125,
  ]);
}
mesh("Board_Header", new THREE.BoxGeometry(3.0, 0.1, 0.1), oldBrass, board, [0, 1.75, 0.05]);

// Office_TaskCard — one instanced task card.
const card = new THREE.Group();
card.name = "Office_TaskCard";
root.add(card);
mesh("Card_Body", new THREE.BoxGeometry(0.6, 0.4, 0.025), cardPaper, card, [0, 0.2, 0.0125]);
mesh("Card_Tag", new THREE.BoxGeometry(0.6, 0.07, 0.015), oldBrass, card, [0, 0.365, 0.0325]);

// Office_StatusTotem — presence totem with one emissive band.
const totem = new THREE.Group();
totem.name = "Office_StatusTotem";
root.add(totem);
mesh("Totem_Column", new THREE.BoxGeometry(0.34, 2.2, 0.34), obsidian, totem, [0, 1.1, 0]);
mesh("Totem_Band", new THREE.BoxGeometry(0.4, 0.28, 0.4), totemBand, totem, [0, 1.62, 0]);
mesh("Totem_Foot", new THREE.BoxGeometry(0.4, 0.08, 0.4), blackIron, totem, [0, 0.04, 0]);

// Office_DoorLight — per-bot accent light, mounts above the door lintel.
const doorLight = new THREE.Group();
doorLight.name = "Office_DoorLight";
root.add(doorLight);
mesh("DoorLight_Housing", new THREE.BoxGeometry(0.35, 0.14, 0.06), blackIron, doorLight, [0, 0.07, 0.03]);
mesh("DoorLight_Lens", new THREE.BoxGeometry(0.27, 0.08, 0.04), totemBand, doorLight, [0, 0.07, 0.08]);

// Office_Shelf — wall shelf, back-flush.
const shelf = new THREE.Group();
shelf.name = "Office_Shelf";
root.add(shelf);
mesh("Shelf_Back", new THREE.BoxGeometry(1.2, 1.8, 0.03), darkWood, shelf, [0, 0.9, 0.015]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Shelf_Upright_West" : "Shelf_Upright_East",
    new THREE.BoxGeometry(0.05, 1.8, 0.35),
    blackIron,
    shelf,
    [side * 0.575, 0.9, 0.175],
  );
}
for (let i = 0; i < 3; i += 1) {
  mesh(`Shelf_Board_${i}`, new THREE.BoxGeometry(1.1, 0.035, 0.32), warmWood, shelf, [
    0, 0.35 + i * 0.6, 0.175,
  ]);
}

// Office_DeskLamp — sits on a desk top (placement supplies the height).
const lamp = new THREE.Group();
lamp.name = "Office_DeskLamp";
root.add(lamp);
mesh("Lamp_Base", new THREE.BoxGeometry(0.15, 0.03, 0.15), blackIron, lamp, [0, 0.015, 0]);
mesh("Lamp_Stem", new THREE.BoxGeometry(0.04, 0.36, 0.04), blackIron, lamp, [0, 0.21, 0]);
mesh("Lamp_Head", new THREE.BoxGeometry(0.22, 0.09, 0.15), oldBrass, lamp, [0, 0.435, 0]);

// Office_Plant — desk/floor greenery.
const plant = new THREE.Group();
plant.name = "Office_Plant";
root.add(plant);
mesh("Plant_Pot", new THREE.BoxGeometry(0.28, 0.28, 0.28), darkWood, plant, [0, 0.14, 0]);
mesh("Plant_Bush", new THREE.IcosahedronGeometry(0.2, 0), foliage, plant, [0, 0.48, 0]);
mesh("Plant_Sprig", new THREE.ConeGeometry(0.09, 0.28, 6), foliage, plant, [0.08, 0.71, 0.05]);

// Office_LiaisonDesk — Suzi's smaller commons desk (liaison kit).
const liaison = new THREE.Group();
liaison.name = "Office_LiaisonDesk";
root.add(liaison);
mesh("Liaison_Top", new THREE.BoxGeometry(1.2, 0.05, 0.6), darkWood, liaison, [0, 0.725, 0]);
mesh("Liaison_Front", new THREE.BoxGeometry(1.2, 0.55, 0.05), obsidian, liaison, [0, 0.425, 0.22]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Liaison_Leg_West" : "Liaison_Leg_East",
    new THREE.BoxGeometry(0.05, 0.7, 0.55),
    blackIron,
    liaison,
    [side * 0.575, 0.35, 0],
  );
}
mesh("Liaison_Brass_Edge", new THREE.BoxGeometry(1.2, 0.025, 0.04), oldBrass, liaison, [0, 0.7125, 0.28]);

// Office_RoutingBoard — liaison routing board, back-flush.
const routing = new THREE.Group();
routing.name = "Office_RoutingBoard";
root.add(routing);
mesh("Routing_Panel", new THREE.BoxGeometry(1.6, 1.1, 0.06), obsidian, routing, [0, 0.55, 0.03]);
mesh("Routing_Screen", new THREE.BoxGeometry(1.44, 0.9, 0.02), boardGlow, routing, [0, 0.55, 0.07]);
mesh("Routing_Header", new THREE.BoxGeometry(1.6, 0.1, 0.1), oldBrass, routing, [0, 1.15, 0.05]);

// Office_LibrarySign — emissive amber "LIBRARY ->" blade, back-flush.
const sign = new THREE.Group();
sign.name = "Office_LibrarySign";
root.add(sign);
mesh("Sign_Blade", new THREE.BoxGeometry(1.6, 0.5, 0.05), signAmber, sign, [0, 0.25, 0.025]);
mesh("Sign_Frame", new THREE.BoxGeometry(1.6, 0.06, 0.08), blackIron, sign, [0, 0.47, 0.04]);

// Office_Workbench — Jack's heavy kit bench.
const bench = new THREE.Group();
bench.name = "Office_Workbench";
root.add(bench);
mesh("Bench_Top", new THREE.BoxGeometry(1.8, 0.08, 0.7), darkWood, bench, [0, 0.86, 0]);
for (const sx of [-1, 1])
  for (const sz of [-1, 1])
    mesh(
      `Bench_Leg_${sx < 0 ? "W" : "E"}${sz < 0 ? "N" : "S"}`,
      new THREE.BoxGeometry(0.08, 0.82, 0.08),
      blackIron,
      bench,
      [sx * 0.82, 0.41, sz * 0.27],
    );
mesh("Bench_Vice", new THREE.BoxGeometry(0.24, 0.15, 0.18), oldBrass, bench, [0.6, 0.975, 0.2]);
mesh("Bench_Shelf", new THREE.BoxGeometry(1.6, 0.04, 0.6), warmWood, bench, [0, 0.25, 0]);

const scene = new THREE.Scene();
scene.name = "HqBotOfficePack_Scene";
scene.add(root);
const result = await new Promise((resolveResult, reject) =>
  new GLTFExporter().parse(scene, resolveResult, reject, {
    binary: true,
    onlyVisible: false,
  }),
);
writeFileSync(resolve(outDir, "hq-bot-office-pack.glb"), Buffer.from(result));
console.log(`hq-bot-office-pack.glb ${result.byteLength} bytes`);
