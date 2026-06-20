import * as THREE from "three";

// Spec 092 — DRIFTING CLOUDS. Soft low-poly cloud puffs floating over the island in the deep-space void,
// lit by the same sun (so they warm at golden hour) and drifting slowly on the wall clock. Each cloud is
// a small cluster of flattened spheres sharing one soft material. Render-only + deterministic: placement
// is a pure hash of the cloud index (no RNG); only the drift offset advances on wall-clock time in
// update(), matching the bus/ocean/foam cosmetic convention. The sim is never touched.

export interface CloudLayer {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

export interface CloudLayerOptions {
  worldSize: number; // N — the grid/world extent the clouds drift across
}

const COUNT = 10; // number of clouds
const CLOUD_Y = 56; // base altitude above the island
const DRIFT = 2.0; // base wind speed (world units / second, +X)

export function buildClouds(opts: CloudLayerOptions): CloudLayer {
  const N = opts.worldSize;
  const span = N * 1.05; // drift range; clouds wrap around this width
  const half = span / 2;
  const hash = (n: number): number => {
    let h =
      (Math.imul(n + 0x9e37, 374761393) ^ Math.imul(n * 2 + 0x85eb, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const group = new THREE.Group();
  group.name = "Clouds";
  // Soft blue-white so the puffs sit in the twilight palette; the sun shades them (warm by day, amber at
  // golden hour) while a faint emissive keeps the shadowed side from crushing to black against the void.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd7e2f2,
    emissive: 0x1b2740,
    emissiveIntensity: 0.45,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
    fog: false,
  });

  const clouds: { puff: THREE.Group; baseX: number; speed: number }[] = [];
  for (let i = 0; i < COUNT; i++) {
    const h1 = hash(i * 3 + 1),
      h2 = hash(i * 7 + 2),
      h3 = hash(i * 11 + 3);
    const baseX = -half + h1 * span;
    const z = -half + h2 * span;
    const scale = 7 + h3 * 9;
    const puff = new THREE.Group();
    const blobs = 3 + Math.floor(h1 * 3);
    for (let b = 0; b < blobs; b++) {
      const hb1 = hash(i * 97 + b * 13 + 5),
        hb2 = hash(i * 131 + b * 17 + 6),
        hb3 = hash(i * 191 + b * 19 + 7);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(scale * (0.5 + hb1 * 0.55), 12, 8),
        mat,
      );
      m.position.set(
        (hb1 - 0.5) * scale * 2.4,
        (hb2 - 0.5) * scale * 0.35,
        (hb3 - 0.5) * scale * 1.7,
      );
      m.scale.y = 0.5; // flatten into a puff
      puff.add(m);
    }
    puff.position.set(baseX, CLOUD_Y + h3 * 14, z);
    group.add(puff);
    clouds.push({ puff, baseX, speed: 0.55 + h2 * 0.8 });
  }

  return {
    group,
    update(timeMs: number) {
      const t = timeMs / 1000;
      for (const c of clouds) {
        let x = c.baseX + ((t * DRIFT * c.speed) % span);
        if (x > half) x -= span; // wrap around the world width
        c.puff.position.x = x;
      }
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      mat.dispose();
      group.parent?.remove(group);
    },
  };
}
