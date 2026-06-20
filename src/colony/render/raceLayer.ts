import * as THREE from "three";
import type { RaceState } from "../racing/race";
import type { RaceTrack } from "../racing/track";
import type { Terrain } from "../terrain";

export interface RaceLayer {
  group: THREE.Group;
  update(raceState: RaceState, timeMs: number): void;
  dispose(): void;
}

export interface RaceLayerOptions {
  terrain: Terrain;
  track: RaceTrack;
  wx: (x: number) => number;
  wz: (y: number) => number;
}

export function buildRaceLayer(opts: RaceLayerOptions): RaceLayer | null {
  if (opts.track.path.length < 2 || opts.track.checkpoints.length < 2)
    return null;
  const group = new THREE.Group();
  group.name = "Road Rally";
  const car = buildPlayerCar();
  const checkpointMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < opts.track.checkpoints.length; i++) {
    group.add(buildCheckpoint(opts, i, checkpointMats));
  }
  group.add(car);

  return {
    group,
    update(raceState: RaceState, timeMs: number) {
      const t = opts.terrain;
      const c = raceState.car;
      const y = Math.max(0, t.worldY(Math.round(c.x), Math.round(c.y))) + 0.22;
      car.position.set(opts.wx(c.x), y, opts.wz(c.y));
      car.rotation.set(0, -c.heading, 0);
      const pulse = (Math.sin(timeMs / 180) + 1) * 0.5;
      for (let i = 0; i < checkpointMats.length; i++) {
        const active =
          i === raceState.nextCheckpoint ||
          (raceState.track.loop &&
            raceState.nextCheckpoint >= raceState.checkpoints.length &&
            i === 0);
        checkpointMats[i]!.emissiveIntensity = active
          ? 0.48 + pulse * 0.16
          : 0.24;
      }
    },
    dispose() {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else if (mat) mat.dispose();
      });
      group.parent?.remove(group);
    },
  };
}

function buildPlayerCar(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xff4c52,
    roughness: 0.5,
    metalness: 0.12,
    emissive: 0x451010,
    emissiveIntensity: 0.35,
  });
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0xffd24d,
    roughness: 0.42,
    metalness: 0.08,
    emissive: 0x3a2a08,
    emissiveIntensity: 0.28,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x171820,
    roughness: 0.72,
    metalness: 0.04,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.34, 0.68), bodyMat);
  body.position.y = 0.22;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.28, 0.46),
    cabinMat,
  );
  cabin.position.set(-0.1, 0.52, 0);
  g.add(body, cabin);
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.38, 0.38]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10),
        wheelMat,
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.14, z);
      g.add(wheel);
    }
  }
  // Headlights (front, +x), tail lights (rear, -x) and a rear spoiler wing — a proper rally car.
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d0,
    emissive: 0xffe9a0,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff5040,
    emissive: 0xff2010,
    emissiveIntensity: 0.85,
    roughness: 0.3,
  });
  for (const z of [-0.2, 0.2]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.14), headMat);
    hl.position.set(0.59, 0.22, z);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.14), tailMat);
    tl.position.set(-0.59, 0.22, z);
    g.add(tl);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.64), bodyMat);
  wing.position.set(-0.5, 0.46, 0);
  g.add(wing);
  for (const z of [-0.26, 0.26]) {
    const sup = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), wheelMat);
    sup.position.set(-0.5, 0.39, z);
    g.add(sup);
  }
  g.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return g;
}

function buildCheckpoint(
  opts: RaceLayerOptions,
  idx: number,
  mats: THREE.MeshStandardMaterial[],
): THREE.Group {
  const cp = opts.track.checkpoints[idx]!;
  const g = new THREE.Group();
  g.name = `Road Rally checkpoint ${idx + 1}`;
  const tangent = checkpointTangent(opts.track, cp);
  const side = { x: -tangent.y, y: tangent.x };
  const baseY = Math.max(0, opts.terrain.worldY(cp.x, cp.y)) + 0.04;
  const mat = new THREE.MeshStandardMaterial({
    color: idx === 0 ? 0x66e0ff : 0xffd75c,
    emissive: idx === 0 ? 0x2aa8d8 : 0xd89a2a,
    emissiveIntensity: 0.36,
    roughness: 0.48,
    metalness: 0.04,
  });
  mats.push(mat);
  const postGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.45, 8);
  const barGeo = new THREE.BoxGeometry(1.55, 0.12, 0.12);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, mat);
    post.position.set(
      opts.wx(cp.x + side.x * s * 0.72),
      baseY + 0.72,
      opts.wz(cp.y + side.y * s * 0.72),
    );
    g.add(post);
  }
  const bar = new THREE.Mesh(barGeo, mat);
  bar.position.set(opts.wx(cp.x), baseY + 1.44, opts.wz(cp.y));
  bar.rotation.y = Math.atan2(side.y, side.x);
  g.add(bar);
  // Start/finish gate gets a checkered banner hanging from the bar — the iconic race line.
  if (idx === 0) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.42),
      new THREE.MeshBasicMaterial({
        map: makeCheckerTex(),
        side: THREE.DoubleSide,
      }),
    );
    banner.position.set(opts.wx(cp.x), baseY + 1.18, opts.wz(cp.y));
    banner.rotation.y = Math.atan2(side.y, side.x);
    g.add(banner);
  }
  return g;
}

/** A small black/white checkerboard texture for the start/finish banner. */
function makeCheckerTex(): THREE.Texture {
  const s = 64,
    n = 6,
    cell = s / n;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#15151a" : "#f4f4f8";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function checkpointTangent(
  track: RaceTrack,
  cp: { x: number; y: number },
): { x: number; y: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < track.path.length; i++) {
    const p = track.path[i]!;
    const d = Math.hypot(p.x - cp.x, p.y - cp.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const a = track.path[Math.max(0, best - 1)] ?? track.path[best]!;
  const b =
    track.path[Math.min(track.path.length - 1, best + 1)] ?? track.path[best]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
