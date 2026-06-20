import * as THREE from "three";
import { COLONY } from "../config";
import { Biome, type Terrain } from "../terrain";
import type { SeedStructure } from "../sim";

export interface ShorePropsLayer {
  group: THREE.Group;
  update(daylight: number, timeMs: number): void;
  dispose(): void;
}

interface ShorePropsOptions {
  terrain: Terrain;
  structures: readonly SeedStructure[];
  roadSet: ReadonlySet<string>;
  occupied: ReadonlySet<string>;
  wx: (x: number) => number;
  wz: (y: number) => number;
}

const ROCKERY_RADIUS = 20;
const PROP_CAP = 72;

export function buildShoreProps(
  opts: ShorePropsOptions,
): ShorePropsLayer | null {
  const lighthouse = opts.structures.find((s) => s.kind === "lighthouse");
  if (!lighthouse) return null;

  const group = new THREE.Group();
  group.name = "Rockery Beach";
  const lanternMats: THREE.MeshStandardMaterial[] = [];
  const baseY = Math.max(0.04, opts.terrain.worldY(lighthouse.x, lighthouse.y));
  const tower = buildLighthouse(lanternMats);
  tower.position.set(
    opts.wx(lighthouse.x),
    baseY + 0.03,
    opts.wz(lighthouse.y),
  );
  group.add(tower);
  addRockeryBeach(group, opts, lighthouse);

  return {
    group,
    update(daylight: number, timeMs: number) {
      const night = 1 - daylight;
      const pulse = (Math.sin((timeMs / 1000) * 1.65) + 1) * 0.5;
      for (const mat of lanternMats)
        mat.emissiveIntensity = 0.4 + night * 0.78 + pulse * 0.22;
    },
    dispose() {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else if (mat) mat.dispose();
      });
    },
  };
}

function buildLighthouse(
  lanternMats: THREE.MeshStandardMaterial[],
): THREE.Group {
  const g = new THREE.Group();
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0xf1ead8,
    roughness: 0.72,
    metalness: 0.02,
  });
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xb73a32,
    roughness: 0.6,
    metalness: 0.03,
  });
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x6c6870,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x24242a,
    roughness: 0.86,
  });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffdf9a,
    emissive: 0xffc467,
    emissiveIntensity: 0.65,
    roughness: 0.34,
    metalness: 0.05,
  });
  lanternMats.push(lanternMat);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.18, 1.32, 0.42, 12),
    stoneMat,
  );
  base.position.y = 0.21;
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.88, 6.8, 16),
    towerMat,
  );
  tower.position.y = 3.64;
  const lowerBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.84, 0.14, 16),
    redMat,
  );
  lowerBand.position.y = 2.55;
  const redBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.64, 0.7, 0.3, 16),
    redMat,
  );
  redBand.position.y = 7.05;
  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 0.74, 16),
    lanternMat,
  );
  lantern.position.y = 7.56;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 8),
    lanternMat,
  );
  lamp.position.y = 7.56;
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xffd78b,
      transparent: true,
      opacity: 0.18,
    }),
  );
  glow.position.y = 7.56;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.82, 0.92, 16), redMat);
  cap.position.y = 8.42;
  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(0.86, 0.03, 6, 20),
    darkMat,
  );
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 7.12;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.0, 0.06), darkMat);
  door.position.set(0, 0.84, -0.88);

  g.add(base, tower, lowerBand, redBand, lantern, lamp, glow, cap, rail, door);
  g.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return g;
}

function addRockeryBeach(
  group: THREE.Group,
  opts: ShorePropsOptions,
  lighthouse: SeedStructure,
): void {
  const t = opts.terrain;
  const blocked = new Set<string>();
  for (const key of opts.roadSet) blocked.add(key);
  for (const key of opts.occupied) blocked.add(key);
  const mark = (x: number, y: number, r: number) => {
    for (let yy = y - r; yy <= y + r; yy++)
      for (let xx = x - r; xx <= x + r; xx++) blocked.add(`${xx},${yy}`);
  };
  for (const st of opts.structures)
    mark(st.x, st.y, st.kind === "lighthouse" ? 2 : 1);

  const candidates: { x: number; y: number; h: number }[] = [];
  for (
    let y = Math.max(1, lighthouse.y - ROCKERY_RADIUS);
    y <= Math.min(t.size - 2, lighthouse.y + ROCKERY_RADIUS);
    y++
  ) {
    for (
      let x = Math.max(1, lighthouse.x - ROCKERY_RADIUS);
      x <= Math.min(t.size - 2, lighthouse.x + ROCKERY_RADIUS);
      x++
    ) {
      const d = Math.hypot(x - lighthouse.x, y - lighthouse.y);
      if (d < 2.5 || d > ROCKERY_RADIUS) continue;
      if (!shorePropCellOk(t, x, y, blocked)) continue;
      const h = hashCell(x, y, 41);
      if (h > 0.72) continue;
      candidates.push({ x, y, h });
    }
  }
  candidates.sort((a, b) => a.h - b.h);
  const chosen = candidates.slice(0, PROP_CAP);
  if (chosen.length === 0) return;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const rockMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({
      roughness: 0.94,
      metalness: 0.02,
      flatShading: true,
      vertexColors: true,
    }),
    PROP_CAP,
  );
  const sitMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.72, 0),
    new THREE.MeshStandardMaterial({
      color: 0x8b8792,
      roughness: 0.96,
      metalness: 0.02,
      flatShading: true,
    }),
    PROP_CAP,
  );
  const driftMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.12, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0x7a5638,
      roughness: 0.9,
      metalness: 0.01,
    }),
    PROP_CAP,
  );
  const grassMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.12, 0.46, 5),
    new THREE.MeshStandardMaterial({
      color: 0x6f8f58,
      roughness: 0.88,
      metalness: 0,
      flatShading: true,
    }),
    PROP_CAP,
  );
  let rocks = 0,
    sits = 0,
    drifts = 0,
    grasses = 0;
  for (const c of chosen) {
    const h2 = hashCell(c.x, c.y, 73);
    const h3 = hashCell(c.x, c.y, 107);
    const y = Math.max(0, t.worldY(c.x, c.y));
    const px = opts.wx(c.x) + (h2 - 0.5) * 0.48;
    const pz = opts.wz(c.y) + (h3 - 0.5) * 0.48;
    dummy.position.set(px, y, pz);
    dummy.rotation.set(0, h2 * Math.PI * 2, 0);
    if (c.h < 0.38 && rocks < PROP_CAP) {
      const sc = 0.55 + h3 * 0.75;
      dummy.scale.set(sc * (0.85 + h2 * 0.35), 0.32 + h2 * 0.36, sc);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(rocks, dummy.matrix);
      color.setHex(h2 > 0.5 ? 0x827b8b : 0x696d73);
      rockMesh.setColorAt(rocks, color);
      rocks++;
    } else if (c.h < 0.48 && sits < PROP_CAP) {
      dummy.scale.set(1.2 + h2 * 0.4, 0.36, 0.85 + h3 * 0.3);
      dummy.updateMatrix();
      sitMesh.setMatrixAt(sits++, dummy.matrix);
    } else if (c.h < 0.58 && drifts < PROP_CAP) {
      dummy.position.y += 0.08;
      dummy.scale.set(1.1 + h2 * 0.9, 1, 1);
      dummy.updateMatrix();
      driftMesh.setMatrixAt(drifts++, dummy.matrix);
    } else if (grasses < PROP_CAP) {
      dummy.position.y += 0.22;
      dummy.scale.set(0.85 + h2 * 0.6, 0.8 + h3 * 0.8, 0.85 + h2 * 0.6);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(grasses++, dummy.matrix);
    }
  }
  for (const mesh of [rockMesh, sitMesh, driftMesh, grassMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  rockMesh.count = rocks;
  sitMesh.count = sits;
  driftMesh.count = drifts;
  grassMesh.count = grasses;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
}

function shorePropCellOk(
  t: Terrain,
  x: number,
  y: number,
  blocked: Set<string>,
): boolean {
  if (blocked.has(`${x},${y}`)) return false;
  if (!t.inBounds(x, y)) return false;
  if (t.isWater(x, y)) return false;
  const i = t.idx(x, y);
  if (t.buildable[i] === 0) return false;
  const dWater = t.distToWater[i]!;
  if (dWater <= 0 || dWater > COLONY.world.coastSearch) return false;
  const biome = t.biome[i] as Biome;
  return biome === Biome.Beach || dWater <= 5;
}

function hashCell(x: number, y: number, salt: number): number {
  let h =
    (Math.imul(x + 0x9e37, 374761393) ^ Math.imul(y + salt, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
