// Spec 179 — low-poly desert showroom look for the world-scene Gearbox pavilion.
//
// Visual only. Dimensions stay in the garage group's cell space (the group is scaled by
// renderScale). Materials and repeated mullions are shared or merged so the landmark does
// not grow a draw call per slat. Any generated texture is a 256² data texture.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildCarMesh } from "../car/carMesh";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";
import { CELL_SIZE } from "../scale";
import {
  GARAGE_TURNTABLE_DIAMETER_M,
  garageShowroomFloorCars,
  type GarageAnchorShellModel,
} from "./garageAnchorShell";

export const GARAGE_AUTHORED_EMISSIVE = "garageAuthoredEmissive";
export const PAVILION_WOOD = 0x8d5a32;
export const PAVILION_WOOD_ROOF = 0x7a4e30;
export const PAVILION_GLASS = 0x9fd4cc;

/** Tag a material so the per-frame night curve scales its authored intensity instead of
 *  replacing it. `night` is full dark, `day` is noon. */
export function tagAuthoredEmissive(
  mat: THREE.MeshStandardMaterial,
  night: number,
  day: number,
): THREE.MeshStandardMaterial {
  mat.emissiveIntensity = night;
  mat.userData[GARAGE_AUTHORED_EMISSIVE] = { night, day };
  return mat;
}

const WOOD = PAVILION_WOOD;
const WOOD_DARK = 0x6b4428;
const WOOD_ROOF = PAVILION_WOOD_ROOF;
const TEAL_GLASS = 0xb7ddd4;
const PALE_DISC = 0xe7eef4;
const RING = 0x2a241e;
const EDGE = 0xffb24a;
const KEY = 0xfffaed;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Pale terrazzo with stone chips. 256², deterministic, no DOM canvas. */
export function makeTerrazzoTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const base = [0xd8, 0xe4, 0xee];
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    data[o] = base[0]!;
    data[o + 1] = base[1]!;
    data[o + 2] = base[2]!;
    data[o + 3] = 255;
  }
  const rand = lcg(0x00d8e4ee);
  const chips: ReadonlyArray<readonly [number, number, number]> = [
    [0xb7, 0xc3, 0xce],
    [0xf5, 0xf8, 0xfb],
    [0xc5, 0xd2, 0xc4],
    [0xe4, 0xd0, 0xbe],
    [0x9a, 0xa7, 0xb3],
  ];
  for (let n = 0; n < 2200; n++) {
    const x = (rand() * size) | 0;
    const y = (rand() * size) | 0;
    const chip = chips[(rand() * chips.length) | 0]!;
    const r = rand() < 0.22 ? 3 : rand() < 0.5 ? 2 : 1;
    for (let dy = 0; dy < r; dy++) {
      for (let dx = 0; dx < r; dx++) {
        const xx = (x + dx) % size;
        const yy = (y + dy) % size;
        const o = (yy * size + xx) * 4;
        data[o] = chip[0];
        data[o + 1] = chip[1];
        data[o + 2] = chip[2];
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.name = "garageTerrazzo";
  return tex;
}

function placedBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function meshFrom(
  geo: THREE.BufferGeometry | null,
  mat: THREE.Material,
  name: string,
): THREE.Mesh | null {
  if (!geo) return null;
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

export interface PavilionBuild {
  root: THREE.Group;
  authoredMats: THREE.MeshStandardMaterial[];
}

type Showroom = GarageAnchorShellModel["showroom"];

/**
 * Faceted glass pavilion: large teal panes, warm wood mullions, slatted back wall,
 * speckled terrazzo, a pale turntable disc inside a dark segmented ring, ceiling
 * strips and three cylindrical pendants. Massing matches `showroom` exactly.
 */
export function buildDesertShowroomPavilion(showroom: Showroom): PavilionBuild {
  const root = new THREE.Group();
  root.name = "garageAnchorGlassShowroomGroup";
  const authoredMats: THREE.MeshStandardMaterial[] = [];

  const wood = new THREE.MeshStandardMaterial({
    color: WOOD,
    roughness: 0.78,
    metalness: 0.06,
    flatShading: true,
  });
  const woodDark = new THREE.MeshStandardMaterial({
    color: WOOD_DARK,
    roughness: 0.82,
    metalness: 0.05,
    flatShading: true,
  });
  const edgeMat = tagAuthoredEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffe1a8,
      emissive: EDGE,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    }),
    0.55,
    0.1,
  );
  authoredMats.push(edgeMat);

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fd4cc,
    roughness: 0.06,
    metalness: 0.08,
    transparent: true,
    opacity: 0.3,
    emissive: 0x14343a,
    emissiveIntensity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  glassMat.userData.desertPavilionEnv = true;
  glassMat.envMapIntensity = 0.7;

  const sx = showroom.x;
  const sz = showroom.z;
  const w = showroom.w;
  const h = showroom.h;
  const d = showroom.d;
  const x0 = sx - w / 2;
  const x1 = sx + w / 2;
  const z0 = sz - d / 2;
  const z1 = sz + d / 2;

  const woodParts: THREE.BufferGeometry[] = [];
  const edgeParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];

  const frontBays = 4;
  const frontXs: number[] = [];
  for (let i = 0; i <= frontBays; i++) {
    frontXs.push(x0 + 0.1 + ((w - 0.2) * i) / frontBays);
  }
  const westBays = 3;
  const westZs: number[] = [];
  for (let i = 0; i <= westBays; i++) {
    westZs.push(z0 + 0.1 + ((d - 0.2) * i) / westBays);
  }

  const postH = h;
  for (const x of frontXs) {
    woodParts.push(placedBox(0.13, postH, 0.13, x, postH / 2, z1 - 0.07));
    edgeParts.push(placedBox(0.035, postH * 0.92, 0.02, x, postH / 2, z1 - 0.005));
  }
  for (let i = 0; i < westZs.length; i++) {
    const z = westZs[i]!;
    if (i === westZs.length - 1) continue;
    woodParts.push(placedBox(0.13, postH, 0.13, x0 + 0.07, postH / 2, z));
    edgeParts.push(
      placedBox(0.02, postH * 0.92, 0.035, x0 + 0.005, postH / 2, z),
    );
  }
  woodParts.push(placedBox(w - 0.12, 0.12, 0.12, sx, h - 0.08, z1 - 0.07));
  woodParts.push(placedBox(w - 0.12, 0.1, 0.12, sx, 0.08, z1 - 0.07));
  woodParts.push(placedBox(0.12, 0.12, d - 0.2, x0 + 0.07, h - 0.08, sz));
  woodParts.push(placedBox(0.12, 0.1, d - 0.2, x0 + 0.07, 0.08, sz));

  const paneBottom = 0.16;
  const paneTop = h - 0.16;
  const paneH = paneTop - paneBottom;
  const paneY = (paneBottom + paneTop) / 2;
  for (let i = 0; i < frontBays; i++) {
    const a = frontXs[i]! + 0.075;
    const b = frontXs[i + 1]! - 0.075;
    const pane = new THREE.PlaneGeometry(Math.max(0.2, b - a), paneH);
    pane.translate((a + b) / 2, paneY, z1 - 0.11);
    glassParts.push(pane);
  }
  for (let i = 0; i < westBays; i++) {
    const a = westZs[i]! + 0.075;
    const b = westZs[i + 1]! - 0.075;
    const pane = new THREE.PlaneGeometry(Math.max(0.2, b - a), paneH);
    pane.rotateY(-Math.PI / 2);
    pane.translate(x0 + 0.11, paneY, (a + b) / 2);
    glassParts.push(pane);
  }

  const glass = meshFrom(
    mergeParts(glassParts),
    glassMat,
    "garageAnchorGlassShowroom",
  );
  const posts = meshFrom(mergeParts(woodParts), wood, "garageAnchorShowroomMullions");
  const edges = meshFrom(
    mergeParts(edgeParts),
    edgeMat,
    "garageAnchorShowroomMullionEdges",
  );
  if (posts) posts.castShadow = true;
  for (const m of [glass, posts, edges]) if (m) root.add(m);

  const interior = new THREE.Group();
  interior.name = "garageAnchorShowroomInterior";

  const terrazzo = tagAuthoredEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: makeTerrazzoTexture(),
      roughness: 0.52,
      metalness: 0.02,
      emissive: 0xfff1dc,
      emissiveIntensity: 0.2,
    }),
    0.2,
    0.04,
  );
  authoredMats.push(terrazzo);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.98, 0.06, d * 0.98),
    terrazzo,
  );
  floor.name = "garageAnchorShowroomTerrazzo";
  floor.position.set(sx, 0.05, sz);
  floor.receiveShadow = true;
  interior.add(floor);

  const slatW = 0.09;
  const pitch = 0.2;
  const innerW = w * 0.9;
  const slatCount = Math.max(8, Math.floor(innerW / pitch));
  const slatH = h * 0.9;
  const slatZ = sz - d * 0.46;
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(innerW, slatH, 0.06),
    woodDark,
  );
  backing.name = "garageAnchorShowroomWoodSlatBacking";
  backing.position.set(sx, slatH / 2 + 0.04, slatZ - 0.05);
  interior.add(backing);

  const slatGeo = new THREE.BoxGeometry(slatW, slatH, 0.07);
  const slatMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.76,
    metalness: 0.04,
    flatShading: true,
  });
  const slats = new THREE.InstancedMesh(slatGeo, slatMat, slatCount);
  slats.name = "garageAnchorShowroomWoodSlats";
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const tones = [WOOD, 0xa56b3c, WOOD_DARK, 0x94633a];
  const xStart = sx - ((slatCount - 1) * pitch) / 2;
  for (let i = 0; i < slatCount; i++) {
    dummy.position.set(xStart + i * pitch, slatH / 2 + 0.04, slatZ);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    slats.setMatrixAt(i, dummy.matrix);
    tint.setHex(tones[i % tones.length]!);
    slats.setColorAt(i, tint);
  }
  slats.instanceMatrix.needsUpdate = true;
  if (slats.instanceColor) slats.instanceColor.needsUpdate = true;
  interior.add(slats);

  const soffit = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.96, 0.06, d * 0.94),
    new THREE.MeshStandardMaterial({
      color: WOOD_ROOF,
      roughness: 0.8,
      flatShading: true,
    }),
  );
  soffit.name = "garageAnchorShowroomSoffit";
  soffit.position.set(sx, h - 0.05, sz);
  interior.add(soffit);

  const stripMat = tagAuthoredEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xfffaf0,
      emissive: KEY,
      emissiveIntensity: 2.35,
      roughness: 0.25,
    }),
    2.35,
    0.42,
  );
  authoredMats.push(stripMat);
  const stripParts: THREE.BufferGeometry[] = [];
  for (const oz of [-0.28, 0.02, 0.26]) {
    stripParts.push(
      placedBox(w * 0.62, 0.03, 0.14, sx, h - 0.1, sz + d * oz),
    );
  }
  const strips = meshFrom(
    mergeParts(stripParts),
    stripMat,
    "garageAnchorShowroomCeilingStrips",
  );
  if (strips) interior.add(strips);

  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x2c241c,
    roughness: 0.55,
    metalness: 0.2,
    flatShading: true,
  });
  const bulbMat = tagAuthoredEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xfff6e4,
      emissive: 0xffeed4,
      emissiveIntensity: 1.8,
      roughness: 0.3,
    }),
    1.8,
    0.45,
  );
  authoredMats.push(bulbMat);
  const pendantParts: THREE.BufferGeometry[] = [];
  const bulbParts: THREE.BufferGeometry[] = [];
  // 0.45 m diameter, shade bottom 3.75 m off the floor. Coordinates are cells.
  const shadeR = 0.225 / CELL_SIZE;
  const shadeH = 0.22 / CELL_SIZE;
  const shadeBottom = 3.75 / CELL_SIZE;
  const shadeY = shadeBottom + shadeH / 2;
  const ceilingY = h - 0.06;
  for (const [ox, oz] of [
    [-6, 0],
    [6, 0],
    [0, 5],
  ] as const) {
    const px = sx + ox / CELL_SIZE;
    const pz = sz + oz / CELL_SIZE;
    const cordLen = Math.max(0.05, ceilingY - (shadeY + shadeH / 2));
    const cord = new THREE.CylinderGeometry(0.015 / CELL_SIZE, 0.015 / CELL_SIZE, cordLen, 6);
    cord.translate(px, shadeY + shadeH / 2 + cordLen / 2, pz);
    pendantParts.push(cord);
    const shade = new THREE.CylinderGeometry(shadeR * 0.72, shadeR, shadeH, 12);
    shade.translate(px, shadeY, pz);
    pendantParts.push(shade);
    const bulb = new THREE.CylinderGeometry(shadeR * 0.62, shadeR * 0.62, 0.02 / CELL_SIZE, 12);
    bulb.translate(px, shadeBottom + 0.01 / CELL_SIZE, pz);
    bulbParts.push(bulb);
  }
  const pendants = meshFrom(
    mergeParts(pendantParts),
    shadeMat,
    "garageAnchorShowroomPendants",
  );
  const bulbs = meshFrom(
    mergeParts(bulbParts),
    bulbMat,
    "garageAnchorShowroomPendantBulbs",
  );
  if (pendants) interior.add(pendants);
  if (bulbs) interior.add(bulbs);

  const key = new THREE.PointLight(KEY, 36, 24, 1.8);
  key.position.set(sx - w * 0.06, h - 0.2, sz + d * 0.04);
  const fill = new THREE.PointLight(0xa5dcff, 18, 18, 2);
  fill.position.set(sx + w * 0.28, h - 0.3, sz - d * 0.15);
  interior.add(key, fill);

  const discMat = new THREE.MeshStandardMaterial({
    color: PALE_DISC,
    roughness: 0.42,
    metalness: 0.04,
    flatShading: true,
  });
  discMat.userData.desertPavilionEnv = true;
  discMat.envMapIntensity = 0.35;
  const floorTop = 0.08;
  const discRise = 0.2 / CELL_SIZE;
  const discH = 0.2 / CELL_SIZE;
  const discTop = floorTop + discRise;
  const topR = 3.05 / CELL_SIZE;
  const baseR = 3.3 / CELL_SIZE;
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(topR, baseR, discH, 40),
    discMat,
  );
  plinth.name = "garageAnchorShowroomPlinth";
  const plinthX = sx;
  const plinthZ = sz;
  plinth.position.set(plinthX, discTop - discH / 2, plinthZ);
  plinth.receiveShadow = true;
  interior.add(plinth);

  const ringCount = 28;
  const ringOuter = GARAGE_TURNTABLE_DIAMETER_M / 2 / CELL_SIZE;
  const ringInner = baseR + 0.02 / CELL_SIZE;
  const midR = (ringOuter + ringInner) / 2;
  const radial = ringOuter - ringInner;
  const ringH = 0.08 / CELL_SIZE;
  const arc = (Math.PI * 2) / ringCount;
  const tangential = midR * arc * 0.86;
  const ringPieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < ringCount; i++) {
    const a = i * arc + arc / 2;
    const geo = new THREE.BoxGeometry(tangential, ringH, radial);
    geo.rotateY(-a - Math.PI / 2);
    geo.translate(Math.cos(a) * midR, ringH / 2 - discH / 2, Math.sin(a) * midR);
    ringPieces.push(geo);
  }
  const ringMerged = mergeParts(ringPieces);
  if (ringMerged) {
    const ring = new THREE.Mesh(
      ringMerged,
      new THREE.MeshStandardMaterial({
        color: 0x1c1915,
        roughness: 0.62,
        metalness: 0.08,
        flatShading: true,
      }),
    );
    ring.name = "garageAnchorShowroomTurntableRing";
    plinth.add(ring);
  }

  const hero = new THREE.Group();
  hero.name = "garageAnchorShowroomHeroCar";
  hero.position.set(plinthX, discTop, plinthZ);
  hero.rotation.set(0, 0, 0);
  const fallback = buildCarMesh(SHOWROOM_VEHICLES[2]!.spec);
  fallback.name = "garageAnchorShowroomHeroCarFallback";
  hero.add(fallback);
  interior.add(hero);

  for (const slot of garageShowroomFloorCars({ x: sx, z: sz })) {
    const parked = new THREE.Group();
    parked.name = slot.id;
    parked.position.set(slot.x, floorTop, slot.z);
    parked.rotation.set(0, slot.rot, 0);
    parked.userData.floorCarModel = slot.model;
    const parkedFallback = buildCarMesh(SHOWROOM_VEHICLES[slot.model]!.spec);
    parkedFallback.name = `${slot.id}.fallback`;
    parkedFallback.rotation.set(0, -Math.PI / 2, 0);
    parked.add(parkedFallback);
    interior.add(parked);
  }

  const backZ = sz - 9 / CELL_SIZE;
  const wallH = h - 0.04;
  const doorGap = 2.4 / CELL_SIZE;
  const wallW = (w * 0.92 - doorGap) / 2;
  const backMat = woodDark;
  const backWest = new THREE.Mesh(
    new THREE.BoxGeometry(wallW, wallH, 0.08),
    backMat,
  );
  backWest.name = "garageAnchorShowroomBackWallWest";
  backWest.position.set(sx - (doorGap + wallW) / 2, wallH / 2, backZ);
  const backEast = new THREE.Mesh(
    new THREE.BoxGeometry(wallW, wallH, 0.08),
    backMat,
  );
  backEast.name = "garageAnchorShowroomBackWallEast";
  backEast.position.set(sx + (doorGap + wallW) / 2, wallH / 2, backZ);
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(5 / CELL_SIZE, 1.1 / CELL_SIZE, 0.8 / CELL_SIZE),
    wood,
  );
  counter.name = "garageAnchorShowroomReception";
  counter.position.set(sx, 1.1 / CELL_SIZE / 2, backZ + 1.3 / CELL_SIZE);
  interior.add(backWest, backEast, counter);

  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.84, 0.1, 0.08),
    wood,
  );
  sill.name = "garageAnchorGlassShowroomFront";
  sill.position.set(sx, 0.1, z1 + 0.02);
  interior.add(sill);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.35, 0.16, d + 0.4),
    new THREE.MeshStandardMaterial({
      color: WOOD_ROOF,
      roughness: 0.74,
      metalness: 0.05,
      flatShading: true,
    }),
  );
  roof.name = "garageAnchorShowroomCanopyRoof";
  roof.position.set(sx, h + 0.08, sz);
  roof.castShadow = true;

  const eaveMat = tagAuthoredEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffe1a8,
      emissive: EDGE,
      emissiveIntensity: 0.85,
      roughness: 0.4,
    }),
    0.85,
    0.16,
  );
  authoredMats.push(eaveMat);
  const eaveParts = [
    placedBox(w + 0.4, 0.035, 0.1, sx, h + 0.005, z1 + 0.16),
    placedBox(w + 0.4, 0.035, 0.1, sx, h + 0.005, z0 - 0.16),
    placedBox(0.1, 0.035, d + 0.2, x0 - 0.16, h + 0.005, sz),
    placedBox(0.1, 0.035, d + 0.2, x1 + 0.16, h + 0.005, sz),
  ];
  const eave = meshFrom(mergeParts(eaveParts), eaveMat, "garageAnchorShowroomEaveGlow");
  root.add(interior, roof);
  if (eave) root.add(eave);

  return { root, authoredMats };
}

export interface CurbBuild {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

/** Yellow (#ffc83b) curb ribbons along both long edges of the driveway apron. */
export function buildApronYellowCurbs(opts: {
  xMin: number;
  xMax: number;
  z0: number;
  z1: number;
  topY: (x: number, z: number) => number;
}): CurbBuild {
  const mat = tagAuthoredEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xffc83b,
      emissive: 0xffc83b,
      emissiveIntensity: 0.7,
      roughness: 0.5,
    }),
    0.7,
    0.22,
  );
  const parts: THREE.BufferGeometry[] = [];
  const segments = 8;
  const height = 0.05;
  const halfW = 0.07;
  const inset = 0.1;
  for (const xEdge of [opts.xMin + inset, opts.xMax - inset]) {
    for (let i = 0; i < segments; i++) {
      const za = opts.z0 + ((opts.z1 - opts.z0) * i) / segments;
      const zb = opts.z0 + ((opts.z1 - opts.z0) * (i + 1)) / segments;
      const y = (opts.topY(xEdge, za) + opts.topY(xEdge, zb)) / 2 + height / 2;
      const zc = (za + zb) / 2;
      const len = Math.abs(zb - za) * 0.96;
      parts.push(placedBox(halfW * 2, height, len, xEdge, y, zc));
    }
  }
  const mesh = new THREE.Mesh(mergeParts(parts) ?? new THREE.BufferGeometry(), mat);
  mesh.name = "garageAnchorApronYellowCurb";
  mesh.receiveShadow = true;
  return { mesh, material: mat };
}

const RAMP_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RAMP_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 warm;
  varying vec3 vDir;
  void main() {
    float y = vDir.y;
    vec3 sky = mix(mid, top, smoothstep(0.05, 1.0, y));
    vec3 ground = mix(vec3(0.08, 0.07, 0.06), warm, smoothstep(-0.4, 0.05, y));
    vec3 c = mix(ground, sky, smoothstep(0.0, 0.16, y));
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * One-shot reflection probe for the pavilion glass and the hero car. Not assigned to
 * the whole world scene. Returns null when the renderer cannot bake.
 */
export function bakeDesertPavilionEnvMap(
  renderer: THREE.WebGLRenderer,
): THREE.Texture | null {
  const scene = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1b2a4a) },
      mid: { value: new THREE.Color(0x3e5b85) },
      warm: { value: new THREE.Color(0xefa98a) },
    },
    vertexShader: RAMP_VERTEX,
    fragmentShader: RAMP_FRAGMENT,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 12), skyMat);
  scene.add(sky);
  const amber = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 4),
    new THREE.MeshBasicMaterial({ color: 0xffb975 }),
  );
  amber.position.set(0, 1.6, -5);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const x of [-2.2, 2.2]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 10), stripMat);
    strip.position.set(x, 4.2, 0);
    strip.rotation.x = Math.PI / 2;
    scene.add(strip);
  }
  const kicker = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 1.6),
    new THREE.MeshBasicMaterial({ color: 0x3e8fd0 }),
  );
  kicker.position.set(-7, 2.2, -1);
  kicker.rotation.y = Math.PI / 2;
  scene.add(amber, kicker);
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(scene, 0.04);
    pmrem.dispose();
    return target.texture;
  } catch {
    return null;
  } finally {
    sky.geometry.dispose();
    skyMat.dispose();
  }
}

export function applyDesertPavilionEnvMap(
  root: THREE.Object3D,
  envMap: THREE.Texture,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat || !mat.userData?.desertPavilionEnv) continue;
      mat.envMap = envMap;
      mat.needsUpdate = true;
    }
  });
}

/**
 * Bake several posed copies of a metric GLB into one mesh per material.
 * `prototype` is the raw GLB scene (metres, nose toward -Z). `scale` is the
 * uniform factor into garage-group cells (1/renderScale for true metres).
 */
export function mergePosedCars(
  prototypes: THREE.Object3D[],
  slots: Array<{
    prototype: number;
    x: number;
    y: number;
    z: number;
    rot: number;
    scale: number;
  }>,
): THREE.Group {
  const buckets = new Map<
    string,
    { mat: THREE.Material; parts: THREE.BufferGeometry[] }
  >();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const placed = new THREE.Matrix4();
  const meshMat = new THREE.Matrix4();
  for (const slot of slots) {
    const src = prototypes[slot.prototype];
    if (!src) continue;
    src.updateMatrixWorld(true);
    pos.set(slot.x, slot.y, slot.z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), slot.rot);
    scl.set(slot.scale, slot.scale, slot.scale);
    placed.compose(pos, quat, scl);
    src.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const mat = materials[0];
      if (!mat) return;
      const geo = mesh.geometry.clone();
      meshMat.multiplyMatrices(placed, mesh.matrixWorld);
      geo.applyMatrix4(meshMat);
      const key = `${slot.prototype}:${mat.name || mat.uuid}`;
      const bucket = buckets.get(key) ?? { mat, parts: [] };
      bucket.parts.push(geo);
      buckets.set(key, bucket);
    });
  }
  const group = new THREE.Group();
  group.name = "garageAnchorShowroomFloorCarsMerged";
  for (const { mat, parts } of buckets.values()) {
    let merged: THREE.BufferGeometry | null = null;
    try {
      merged = mergeGeometries(parts, false);
    } catch {
      merged = null;
    }
    if (!merged) {
      for (const geo of parts) {
        group.add(new THREE.Mesh(geo, mat));
      }
      continue;
    }
    for (const p of parts) p.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function countRenderableTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const pos = geo?.getAttribute("position");
    if (!pos) return;
    const base = geo.getIndex() ? geo.getIndex()!.count / 3 : pos.count / 3;
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 1;
    tris += base * instances;
  });
  return tris;
}
