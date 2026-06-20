import * as THREE from "three";

// Spec 092 — AMBIENT MOTION: a few gulls gliding in lazy circles over the sea, wings flapping, so the
// sky has life. Render-only + deterministic: each gull's circle (centre, radius, altitude, speed, phase)
// is a pure hash of its index; only the position along the circle + the wing flap advance on the wall
// clock in update(). The sim is never touched.

export interface AmbientLayer {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

export interface AmbientLayerOptions {
  worldSize: number; // N
}

const GULLS = 7;

export function buildAmbient(opts: AmbientLayerOptions): AmbientLayer {
  const N = opts.worldSize;
  const hash = (n: number): number => {
    let h =
      (Math.imul(n + 0x9e37, 374761393) ^
        Math.imul(n * 2 + 0x85eb, 668265263)) >>>
      0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const group = new THREE.Group();
  group.name = "Gulls";
  // Shared pale-grey gull material — lit by the sun, a faint emissive so they read against the dark sea.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe7ebf2,
    roughness: 0.85,
    metalness: 0,
    emissive: 0x2a3340,
    emissiveIntensity: 0.25,
    flatShading: true,
  });
  const wingGeo = new THREE.BoxGeometry(0.5, 0.05, 1.0); // chord(x) · thin(y) · span(z)

  const gulls: {
    g: THREE.Group;
    lw: THREE.Mesh;
    rw: THREE.Mesh;
    cx: number;
    cz: number;
    radius: number;
    alt: number;
    speed: number;
    phase: number;
    flapHz: number;
  }[] = [];

  for (let i = 0; i < GULLS; i++) {
    const h1 = hash(i * 3 + 1),
      h2 = hash(i * 7 + 2),
      h3 = hash(i * 11 + 3),
      h4 = hash(i * 17 + 4);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat);
    body.scale.set(1.9, 0.7, 0.6);
    const lw = new THREE.Mesh(wingGeo, mat);
    lw.position.set(0, 0.04, -0.55);
    const rw = new THREE.Mesh(wingGeo, mat);
    rw.position.set(0, 0.04, 0.55);
    g.add(body, lw, rw);
    group.add(g);
    // a circle over the coastal sea: centre at radius N*0.3..0.55 from the world centre, altitude 16..32
    const cAng = h1 * Math.PI * 2;
    const cR = N * (0.3 + h2 * 0.25);
    gulls.push({
      g,
      lw,
      rw,
      cx: Math.cos(cAng) * cR,
      cz: Math.sin(cAng) * cR,
      radius: 9 + h3 * 16,
      alt: 16 + h4 * 16,
      speed: (0.16 + h2 * 0.16) * (h3 > 0.5 ? 1 : -1),
      phase: h4 * Math.PI * 2,
      flapHz: 2.4 + h1 * 1.6,
    });
  }

  return {
    group,
    update(timeMs: number) {
      const t = timeMs / 1000;
      for (const u of gulls) {
        const a = t * u.speed + u.phase;
        u.g.position.set(
          u.cx + Math.cos(a) * u.radius,
          u.alt + Math.sin(t * 0.6 + u.phase) * 1.2, // gentle bob
          u.cz + Math.sin(a) * u.radius,
        );
        u.g.rotation.y = -a - Math.PI / 2; // bank along the circle tangent
        const flap = Math.sin(t * u.flapHz + u.phase) * 0.5;
        u.lw.rotation.x = flap; // both wing tips rise/fall together
        u.rw.rotation.x = -flap;
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
