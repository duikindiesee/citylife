// Spec 179 — low-poly desert showroom look for the world-scene Gearbox pavilion.
//
// Visual only. Dimensions stay in the garage group's cell space (the group is scaled by
// renderScale). Materials and repeated mullions are shared or merged so the landmark does
// not grow a draw call per slat. Any generated texture is a 256² data texture.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildCarMesh } from "../car/carMesh";
import { SHOWROOM_VEHICLES } from "../showroom/showroomCatalog";
import type { GarageAnchorShellModel } from "./garageAnchorShell";

export const GARAGE_AUTHORED_EMISSIVE = "garageAuthoredEmissive";

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

const WOOD = 0x8d5a32;
const WOOD_DARK = 0x6b4428;
const WOOD_ROOF = 0x7a4e30;
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
    roughness: 0.6,
    metalness: 0.25,
    flatShading: true,
  });
  const bulbMat = tagAuthoredEmissive(
    new THREE.MeshStandardMaterial({
      color: 0xfff6e4,
      emissive: 0xffeed4,
      emissiveIntensity: 1.7,
      roughness: 0.3,
    }),
    1.7,
    0.3,
  );
  authoredMats.push(bulbMat);
  const pendantParts: THREE.BufferGeometry[] = [];
  const bulbParts: THREE.BufferGeometry[] = [];
  const shadeY = h * 0.58;
  for (const ox of [-0.18, 0, 0.18]) {
    const px = sx + w * ox;
    const pz = sz + d * 0.1;
    const cord = new THREE.CylinderGeometry(0.012, 0.012, h - shadeY - 0.2, 5);
    cord.translate(px, (h - 0.08 + shadeY) / 2, pz);
    pendantParts.push(cord);
    const shade = new THREE.CylinderGeometry(0.1, 0.14, 0.18, 6);
    shade.translate(px, shadeY, pz);
    pendantParts.push(shade);
    const bulb = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 6);
    bulb.translate(px, shadeY - 0.1, pz);
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
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.12, 1.16, 0.08, 10),
    discMat,
  );
  plinth.name = "garageAnchorShowroomPlinth";
  const plinthX = sx - w * 0.1;
  const plinthZ = sz + d * 0.04;
  plinth.position.set(plinthX, 0.12, plinthZ);
  plinth.receiveShadow = true;
  interior.add(plinth);

  const ringParts: THREE.BufferGeometry[] = [];
  const ringCount = 20;
  const midR = 1.28;
  const radial = 0.16;
  const arc = (Math.PI * 2) / ringCount;
  const tangential = midR * arc * 0.84;
  const yaw = new THREE.Quaternion();
  const ringPos = new THREE.Vector3();
  const ringScale = new THREE.Vector3(1, 1, 1);
  const ringMat4 = new THREE.Matrix4();
  for (let i = 0; i < ringCount; i++) {
    const a = i * arc + arc / 2;
    const geo = new THREE.BoxGeometry(tangential, 0.04, radial);
    // Local +X is the long side. Yaw so it follows the tangent.
    yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a - Math.PI / 2);
    ringPos.set(plinthX + Math.cos(a) * midR, 0.07, plinthZ + Math.sin(a) * midR);
    ringMat4.compose(ringPos, yaw, ringScale);
    geo.applyMatrix4(ringMat4);
    ringParts.push(geo);
  }
  const ring = meshFrom(
    mergeParts(ringParts),
    new THREE.MeshStandardMaterial({
      color: RING,
      roughness: 0.55,
      metalness: 0.12,
      flatShading: true,
    }),
    "garageAnchorShowroomTurntableRing",
  );
  if (ring) interior.add(ring);

  const hero = new THREE.Group();
  hero.name = "garageAnchorShowroomHeroCar";
  hero.position.set(plinthX, 0.16, plinthZ);
  hero.rotation.y = -0.38;
  const fallback = buildCarMesh(SHOWROOM_VEHICLES[2]!.spec);
  fallback.name = "garageAnchorShowroomHeroCarFallback";
  hero.add(fallback);
  interior.add(hero);

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
