// Spec 153 — HQ boardroom pack: the Gate Room kit.
//
// Emits public/assets/citylife/props/hq-boardroom-pack.glb with seven named
// parts (meters, Y up, forward +Z, minY = 0 on every part):
//   Board_Table       3.60 x 0.78 x 1.40   pivot floor-center
//   Board_Chair       0.55 x 1.00 x 0.55   pivot floor-center
//   Board_EpicWall    6.00 x 2.40 x 0.14   pivot floor-center-back (four swimlanes)
//   Board_GatePuck    0.18 x 0.06 x 0.18   pivot floor-center (amber token)
//   Board_MergeTicker 2.40 x 0.30 x 0.12   pivot floor-center-back (mounts over the door)
//   Board_HoloEpic    0.60 x 1.10 x 0.60   pivot floor-center (table centrepiece pedestal)
//   Board_Sideboard   1.80 x 0.90 x 0.45   pivot floor-center-back
//
// Deterministic by construction: fixed parameters and no time- or
// randomness-dependent calls; two runs are byte-identical.
// tests/hqBoardroomPackGlb.test.ts guards the structural contract and the
// Gate Room placement JSON. Live epic/gate/merge data binding is the later
// WorklistProjection slice (spec 153 §11); these are inert props.
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

const warmWood = material("Board_Warm_Wood", 0x8a6a48, { roughness: 0.68, metalness: 0.04 });
const darkWood = material("Board_Dark_Wood", 0x5c4632, { roughness: 0.74, metalness: 0.03 });
const blackIron = material("Board_Black_Iron", 0x424b4b, { roughness: 0.36, metalness: 0.82 });
const oldBrass = material("Board_Old_Brass", 0x927747, { roughness: 0.43, metalness: 0.9 });
const obsidian = material("Board_Obsidian_Panel", 0x27383c, { roughness: 0.34, metalness: 0.62 });
const seatFabric = material("Board_Seat_Fabric", 0x6d7a6f, { roughness: 0.88, metalness: 0.02 });
const laneGlow = material("Board_Lane_Emissive", 0x0f1a14, {
  roughness: 0.3,
  emissive: 0x2dd4bf,
  emissiveIntensity: 0.8,
  flatShading: false,
});
const gateAmber = material("Board_Gate_Amber_Emissive", 0x6b4e12, {
  roughness: 0.3,
  emissive: 0xe8b64c,
  emissiveIntensity: 1.5,
  flatShading: false,
});
const holoGlow = material("Board_Holo_Emissive", 0xa8cfc4, {
  roughness: 0.16,
  metalness: 0.08,
  emissive: 0xc8fff0,
  emissiveIntensity: 2.6,
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
root.name = "HqBoardroomPack_Root";
root.userData = {
  asset: "hq-boardroom-pack",
  authoredBy: "Fable",
  units: "meters",
  upAxis: "Y",
  forwardAxis: "+Z",
  spec: "docs/specs/153-kooker-hq-campus-interior.md",
};

// Board_Table — the Gate Room table.
const table = new THREE.Group();
table.name = "Board_Table";
root.add(table);
mesh("Table_Top", new THREE.BoxGeometry(3.6, 0.07, 1.4), warmWood, table, [0, 0.745, 0]);
mesh("Table_Spine", new THREE.BoxGeometry(3.0, 0.62, 0.5), obsidian, table, [0, 0.36, 0]);
for (const side of [-1, 1]) {
  mesh(
    side < 0 ? "Table_Foot_West" : "Table_Foot_East",
    new THREE.BoxGeometry(0.5, 0.05, 1.2),
    blackIron,
    table,
    [side * 1.35, 0.025, 0],
  );
}
mesh("Table_Brass_Inlay", new THREE.BoxGeometry(3.2, 0.015, 0.12), oldBrass, table, [0, 0.7725, 0]);

// Board_Chair — boardroom chair, instanced ten times by placement.
const chair = new THREE.Group();
chair.name = "Board_Chair";
root.add(chair);
mesh("Chair_Base", new THREE.BoxGeometry(0.5, 0.08, 0.5), blackIron, chair, [0, 0.04, 0]);
mesh("Chair_Post", new THREE.BoxGeometry(0.09, 0.36, 0.09), blackIron, chair, [0, 0.3, 0]);
mesh("Chair_Seat", new THREE.BoxGeometry(0.55, 0.09, 0.55), seatFabric, chair, [0, 0.525, 0]);
mesh("Chair_Back", new THREE.BoxGeometry(0.5, 0.42, 0.07), seatFabric, chair, [0, 0.79, -0.24]);

// Board_EpicWall — four swimlanes on a dark backboard, back-flush.
const epic = new THREE.Group();
epic.name = "Board_EpicWall";
root.add(epic);
mesh("Epic_Backboard", new THREE.BoxGeometry(6.0, 2.3, 0.08), obsidian, epic, [0, 1.15, 0.04]);
const laneNames = ["A", "B", "C", "D"];
for (let i = 0; i < 4; i += 1) {
  mesh(
    `Epic_Lane_${laneNames[i]}`,
    new THREE.BoxGeometry(1.3, 2.0, 0.03),
    laneGlow,
    epic,
    [-2.175 + i * 1.45, 1.2, 0.095],
  );
}
mesh("Epic_Header", new THREE.BoxGeometry(6.0, 0.1, 0.14), oldBrass, epic, [0, 2.35, 0.07]);

// Board_GatePuck — one physical operator-gate token.
const puck = new THREE.Group();
puck.name = "Board_GatePuck";
root.add(puck);
mesh("Puck_Body", new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), gateAmber, puck, [0, 0.025, 0]);
mesh("Puck_Rim", new THREE.CylinderGeometry(0.05, 0.05, 0.01, 12), oldBrass, puck, [0, 0.055, 0]);

// Board_MergeTicker — merge-authority event strip, mounts over the door.
const ticker = new THREE.Group();
ticker.name = "Board_MergeTicker";
root.add(ticker);
mesh("Ticker_Housing", new THREE.BoxGeometry(2.4, 0.3, 0.08), blackIron, ticker, [0, 0.15, 0.04]);
mesh("Ticker_Strip", new THREE.BoxGeometry(2.2, 0.18, 0.04), laneGlow, ticker, [0, 0.15, 0.1]);

// Board_HoloEpic — table centrepiece: pedestal plus floating epic glyph.
const holo = new THREE.Group();
holo.name = "Board_HoloEpic";
root.add(holo);
mesh("Holo_Pedestal", new THREE.BoxGeometry(0.4, 0.5, 0.4), obsidian, holo, [0, 0.25, 0]);
mesh("Holo_Plate", new THREE.BoxGeometry(0.6, 0.04, 0.6), oldBrass, holo, [0, 0.52, 0]);
mesh("Holo_Glyph", new THREE.OctahedronGeometry(0.24, 0), holoGlow, holo, [0, 0.86, 0]);

// Board_Sideboard — refreshment/archive sideboard, back-flush.
const sideboard = new THREE.Group();
sideboard.name = "Board_Sideboard";
root.add(sideboard);
mesh("Side_Body", new THREE.BoxGeometry(1.8, 0.82, 0.42), darkWood, sideboard, [0, 0.41, 0.21]);
mesh("Side_Top", new THREE.BoxGeometry(1.8, 0.04, 0.45), warmWood, sideboard, [0, 0.84, 0.225]);
mesh("Side_Skirt", new THREE.BoxGeometry(1.8, 0.04, 0.42), blackIron, sideboard, [0, 0.88, 0.21]);
for (const x of [-0.45, 0.45]) {
  mesh(
    x < 0 ? "Side_Handle_West" : "Side_Handle_East",
    new THREE.BoxGeometry(0.2, 0.03, 0.02),
    oldBrass,
    sideboard,
    [x, 0.5, 0.43],
  );
}

const scene = new THREE.Scene();
scene.name = "HqBoardroomPack_Scene";
scene.add(root);
const result = await new Promise((resolveResult, reject) =>
  new GLTFExporter().parse(scene, resolveResult, reject, {
    binary: true,
    onlyVisible: false,
  }),
);
writeFileSync(resolve(outDir, "hq-boardroom-pack.glb"), Buffer.from(result));
console.log(`hq-boardroom-pack.glb ${result.byteLength} bytes`);
