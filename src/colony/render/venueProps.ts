import * as THREE from "three";
import type { Terrain } from "../terrain";
import type { SeedStructure } from "../sim";

export interface VenuePropsLayer {
  group: THREE.Group;
  update(daylight: number, timeMs: number): void;
  dispose(): void;
}

interface VenuePropsOptions {
  terrain: Terrain;
  structures: readonly SeedStructure[];
  roadSet: ReadonlySet<string>;
  occupied: ReadonlySet<string>;
  wx: (x: number) => number;
  wz: (y: number) => number;
}

interface VenuePropPlacement {
  kind: "lantern" | "stool" | "crate";
  x: number;
  y: number;
  rotationTurns: number;
  scale: number;
}

interface VenuePlacementOptions {
  terrain: Terrain;
  structures: readonly SeedStructure[];
  roadSet: ReadonlySet<string>;
  occupied: ReadonlySet<string>;
}

const RING: readonly {
  dx: number;
  dy: number;
  kind: VenuePropPlacement["kind"];
}[] = [
  { dx: -4, dy: -2, kind: "lantern" },
  { dx: -2, dy: -4, kind: "stool" },
  { dx: 2, dy: -4, kind: "crate" },
  { dx: 4, dy: -2, kind: "lantern" },
  { dx: 5, dy: 1, kind: "stool" },
  { dx: 3, dy: 4, kind: "crate" },
  { dx: -3, dy: 4, kind: "lantern" },
  { dx: -5, dy: 1, kind: "stool" },
];

export function computeVenuePropPlacements(
  opts: VenuePlacementOptions,
): VenuePropPlacement[] {
  const rally = opts.structures.find((s) => s.kind === "rally");
  if (!rally) return [];

  const blocked = new Set<string>();
  for (const key of opts.roadSet) blocked.add(key);
  for (const key of opts.occupied) blocked.add(key);
  for (const st of opts.structures) {
    const cx = Math.round(st.x);
    const cy = Math.round(st.y);
    const radius = st.kind === "rally" ? 1 : 0;
    for (let y = cy - radius; y <= cy + radius; y++)
      for (let x = cx - radius; x <= cx + radius; x++) blocked.add(`${x},${y}`);
  }

  const rx = Math.round(rally.x);
  const ry = Math.round(rally.y);
  const placements: VenuePropPlacement[] = [];
  for (const c of RING) {
    const x = rx + c.dx;
    const y = ry + c.dy;
    if (!venuePropCellOk(opts.terrain, x, y, blocked)) continue;
    placements.push({
      kind: c.kind,
      x,
      y,
      rotationTurns: hashCell(x, y, 151),
      scale: 0.9 + hashCell(x, y, 211) * 0.22,
    });
  }
  return placements;
}

export function buildVenueProps(
  opts: VenuePropsOptions,
): VenuePropsLayer | null {
  const placements = computeVenuePropPlacements(opts);
  if (placements.length === 0) return null;

  const group = new THREE.Group();
  group.name = "Night Rally Venue Props";
  const lanternMats: THREE.MeshStandardMaterial[] = [];
  const floorMats: THREE.MeshBasicMaterial[] = [];
  const reusable = new THREE.Object3D();

  const lanternMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.18, 1.15, 8),
    new THREE.MeshStandardMaterial({
      color: 0x303647,
      roughness: 0.58,
      metalness: 0.15,
    }),
    placements.length,
  );
  const lanternGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffd38a,
    emissive: 0xffa94f,
    emissiveIntensity: 0.8,
    roughness: 0.32,
  });
  lanternMats.push(lanternGlowMat);
  const lanternGlowMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.28, 12, 8),
    lanternGlowMat,
    placements.length,
  );
  const stoolMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.42, 0.46, 0.34, 10),
    new THREE.MeshStandardMaterial({
      color: 0x8a5d3c,
      roughness: 0.84,
      metalness: 0.01,
    }),
    placements.length,
  );
  const crateMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.8, 0.42, 0.56),
    new THREE.MeshStandardMaterial({
      color: 0x72543b,
      roughness: 0.9,
      metalness: 0.01,
    }),
    placements.length,
  );
  const floorMat = new THREE.MeshBasicMaterial({
    color: 0xffb05f,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  floorMats.push(floorMat);
  const floorMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.72, 18),
    floorMat,
    placements.length,
  );

  let lanterns = 0,
    glows = 0,
    stools = 0,
    crates = 0,
    floors = 0;
  for (const p of placements) {
    const baseY = Math.max(0, opts.terrain.worldY(p.x, p.y));
    const rot = p.rotationTurns * Math.PI * 2;
    if (p.kind === "lantern") {
      reusable.position.set(opts.wx(p.x), baseY + 0.575, opts.wz(p.y));
      reusable.rotation.set(0, rot, 0);
      reusable.scale.setScalar(p.scale);
      reusable.updateMatrix();
      lanternMesh.setMatrixAt(lanterns++, reusable.matrix);
      reusable.position.y = baseY + 1.22 * p.scale;
      reusable.scale.setScalar(p.scale);
      reusable.updateMatrix();
      lanternGlowMesh.setMatrixAt(glows++, reusable.matrix);
    } else if (p.kind === "stool") {
      reusable.position.set(opts.wx(p.x), baseY + 0.17, opts.wz(p.y));
      reusable.rotation.set(0, rot, 0);
      reusable.scale.setScalar(p.scale);
      reusable.updateMatrix();
      stoolMesh.setMatrixAt(stools++, reusable.matrix);
    } else {
      reusable.position.set(opts.wx(p.x), baseY + 0.21, opts.wz(p.y));
      reusable.rotation.set(0, rot, 0);
      reusable.scale.setScalar(p.scale);
      reusable.updateMatrix();
      crateMesh.setMatrixAt(crates++, reusable.matrix);
    }
    reusable.position.set(opts.wx(p.x), baseY + 0.025, opts.wz(p.y));
    reusable.rotation.set(-Math.PI / 2, 0, rot);
    reusable.scale.setScalar(1 + p.scale * 0.28);
    reusable.updateMatrix();
    floorMesh.setMatrixAt(floors++, reusable.matrix);
  }

  for (const mesh of [
    lanternMesh,
    lanternGlowMesh,
    stoolMesh,
    crateMesh,
    floorMesh,
  ]) {
    mesh.castShadow = mesh !== floorMesh;
    mesh.receiveShadow = mesh !== floorMesh;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  lanternMesh.count = lanterns;
  lanternGlowMesh.count = glows;
  stoolMesh.count = stools;
  crateMesh.count = crates;
  floorMesh.count = floors;

  return {
    group,
    update(daylight: number, timeMs: number) {
      const night = 1 - daylight;
      const pulse = (Math.sin((timeMs / 1000) * 1.45) + 1) * 0.5;
      for (const mat of lanternMats)
        mat.emissiveIntensity = 0.35 + night * 1.0 + pulse * 0.25;
      for (const mat of floorMats) mat.opacity = 0.08 + night * 0.28;
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

function venuePropCellOk(
  t: Terrain,
  x: number,
  y: number,
  blocked: ReadonlySet<string>,
): boolean {
  if (blocked.has(`${x},${y}`)) return false;
  if (!t.inBounds(x, y)) return false;
  if (t.isWater(x, y)) return false;
  const i = t.idx(x, y);
  return t.buildable[i] !== 0;
}

function hashCell(x: number, y: number, salt: number): number {
  let h =
    (Math.imul(x + 0x9e37, 374761393) ^ Math.imul(y + salt, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
