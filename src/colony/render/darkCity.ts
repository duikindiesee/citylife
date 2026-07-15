import * as THREE from "three";

// Spec 136 — DARK CITY: the colony floats on a slab of rock adrift in deep space, and the
// sky is the void. Ported verbatim from the legacy buildPlanet (PlanetRenderer ~542-672):
// a tapered nine-sided rock slab dropping from just under the waterline, the cyan rim glow
// + taller halo that make the island read as a lit slab adrift in the dark, two
// deterministic Fibonacci starfield shells (fine dust + sparse bright stars, fog-disabled
// so the void reads as deep space), and the distant blue gas giant with its additive
// atmosphere — the story's silent witness. Dimensions scale from the WORLD width (the
// legacy world was 1 unit/cell; v3 is 4), star/giant distances stay the legacy absolutes —
// already beyond the camera's orbit cap and inside the raised far plane.

const SLAB_ROCK = 0x24242f;

/** worldN — the island's world width in units (terrain.size * 4 in v3). */
export function buildDarkCity(worldN: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "darkCity";

  // Dark City: a tapered slab of rock drops from just under the waterline into the void,
  // so the island clearly floats in space instead of sitting on a planet.
  const top = worldN * 0.72;
  const base = worldN * 0.34;
  const height = worldN * 1.05;
  const rock = new THREE.Mesh(
    new THREE.CylinderGeometry(top, base, height, 9, 1),
    new THREE.MeshStandardMaterial({
      color: SLAB_ROCK,
      roughness: 0.95,
      metalness: 0.08,
      flatShading: true,
    }),
  );
  rock.name = "darkCity-slab";
  rock.position.set(0, -height / 2 - 1.6, 0);
  group.add(rock);

  // Additive glow at the waterline — a tight bright rim plus a taller, fainter halo that
  // bleeds up into the void (Dark City energy).
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(
      top * 1.01,
      top * 0.9,
      worldN * 0.06,
      9,
      1,
      true,
    ),
    new THREE.MeshBasicMaterial({
      color: 0x3aa6c8,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  rim.name = "darkCity-rim";
  rim.position.set(0, -2.4, 0);
  group.add(rim);
  const rimHalo = new THREE.Mesh(
    new THREE.CylinderGeometry(
      top * 1.09,
      top * 0.98,
      worldN * 0.17,
      9,
      1,
      true,
    ),
    new THREE.MeshBasicMaterial({
      color: 0x256b8a,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  rimHalo.name = "darkCity-rim-halo";
  rimHalo.position.set(0, -1.44, 0);
  group.add(rimHalo);

  // Starfield — two deterministic Fibonacci shells beyond the camera's max orbit distance,
  // fog-disabled so the void always reads as deep space.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const makeStars = (
    count: number,
    seed: number,
    rMin: number,
    rSpan: number,
    color: number,
    size: number,
    opacity: number,
  ) => {
    const sg = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = 1 - ((i + 0.5) / count) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * (i + seed);
      const r = rMin + ((i * 131 + seed * 977) % rSpan);
      pos[i * 3] = Math.cos(theta) * rad * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = Math.sin(theta) * rad * r;
    }
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: true,
        fog: false,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    points.name = seed === 0 ? "darkCity-stardust" : "darkCity-stars";
    points.matrixAutoUpdate = false;
    group.add(points);
  };
  makeStars(2800, 0, 5000, 1700, 0x8d99c8, 4, 0.7); // fine dust
  makeStars(380, 7, 5200, 1500, 0xeef2ff, 11, 0.95); // sparse bright stars

  // A distant gas giant looming in the void — the story's blue witness. Lit by the same
  // sun, so it shows a soft day/night terminator. Sits beyond the orbit cap.
  const giant = new THREE.Mesh(
    new THREE.SphereGeometry(760, 48, 32),
    new THREE.MeshStandardMaterial({
      color: 0x4a5688,
      roughness: 1,
      metalness: 0,
      emissive: 0x1a2348,
      emissiveIntensity: 0.9,
      fog: false,
    }),
  );
  giant.name = "darkCity-gas-giant";
  giant.position.set(-1400, -100, -3400);
  group.add(giant);
  const giantAtmo = new THREE.Mesh(
    new THREE.SphereGeometry(815, 40, 24),
    new THREE.MeshBasicMaterial({
      color: 0x6f86c8,
      transparent: true,
      opacity: 0.22,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  giantAtmo.name = "darkCity-gas-giant-atmo";
  giantAtmo.position.copy(giant.position);
  group.add(giantAtmo);

  return group;
}
