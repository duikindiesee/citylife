import * as THREE from "three";
import type { Terrain } from "../terrain";
import type { SeedStructure } from "../sim";

// Spec 151 — the founders' landing camp. The sim seeds four origin structures at the landing block
// (caravan, rocket dropship, solar array, battery) in sim.ts; the legacy PlanetRenderer.makeStructure
// drew them but the R3F port left them unported, so the colony's origin site rendered as bare ground.
// This is the faithful R3F port: an imperative THREE.Group of the four camp props (lighthouse, rally
// and the ironwork pillar are drawn elsewhere), mounted once via <primitive> and animated by update()
// only for the rocket's pulsing red nav beacon. Render-only, deterministic, the sim is never touched.

export interface LandingCampLayer {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

export interface LandingCampOptions {
  terrain: Terrain;
  structures: readonly SeedStructure[];
  wx: (x: number) => number;
  wz: (y: number) => number;
}

const CAMP_KINDS: ReadonlySet<SeedStructure["kind"]> = new Set([
  "caravan",
  "rocket",
  "solar",
  "battery",
]);

export function buildLandingCamp(
  opts: LandingCampOptions,
): LandingCampLayer | null {
  const camp = opts.structures.filter((s) => CAMP_KINDS.has(s.kind));
  if (camp.length === 0) return null;

  const group = new THREE.Group();
  group.name = "LandingCamp";
  const beaconMats: THREE.MeshStandardMaterial[] = [];

  for (const s of camp) {
    const mesh = makeStructure(s, beaconMats);
    const baseY = Math.max(0.05, opts.terrain.worldY(s.x, s.y));
    mesh.position.set(opts.wx(s.x), baseY, opts.wz(s.y));
    group.add(mesh);
  }

  return {
    group,
    update(timeMs: number) {
      // The landed dropship still has power — its nav beacon pulses red.
      const pulse = (Math.sin((timeMs / 1000) * 2.2) + 1) * 0.5;
      for (const mat of beaconMats)
        mat.emissiveIntensity = 0.9 + pulse * 1.4;
    },
    dispose() {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else if (mat) (mat as THREE.Material).dispose();
      });
      group.parent?.remove(group);
    },
  };
}

// Legacy PlanetRenderer.makeStructure, verbatim geometry for the four camp kinds.
function makeStructure(
  s: SeedStructure,
  beaconMats: THREE.MeshStandardMaterial[],
): THREE.Object3D {
  const g = new THREE.Group();
  if (s.kind === "caravan") {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.5, 1.7),
      new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.7 }),
    );
    body.position.y = 1;
    body.castShadow = true;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(3.05, 0.3, 1.75),
      new THREE.MeshStandardMaterial({ color: 0xb24a3a, roughness: 0.6 }),
    );
    roof.position.y = 1.85;
    g.add(body, roof);
  } else if (s.kind === "solar") {
    const post1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x444444 }),
    );
    post1.position.set(-0.8, 0.45, 0);
    const post2 = post1.clone();
    post2.position.x = 0.8;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.09, 1.5),
      new THREE.MeshStandardMaterial({
        color: 0x16335a,
        roughness: 0.25,
        metalness: 0.5,
        emissive: 0x0a1830,
        emissiveIntensity: 0.5,
      }),
    );
    panel.position.y = 0.95;
    panel.rotation.x = -0.5;
    panel.castShadow = true;
    g.add(post1, post2, panel);
  } else if (s.kind === "battery") {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.3, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.6 }),
    );
    box.position.y = 0.65;
    box.castShadow = true;
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.18, 0.95),
      new THREE.MeshStandardMaterial({
        color: 0x39d353,
        emissive: 0x1f8a2f,
        emissiveIntensity: 0.6,
      }),
    );
    cap.position.y = 1.4;
    g.add(box, cap);
  } else if (s.kind === "rocket") {
    // rocket / dropship (landed)
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.1, 5, 16),
      new THREE.MeshStandardMaterial({
        color: 0xdfe3e9,
        roughness: 0.4,
        metalness: 0.3,
      }),
    );
    body.position.y = 2.5;
    body.castShadow = true;
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2, 16),
      new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }),
    );
    nose.position.y = 6;
    nose.castShadow = true;
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 1.4, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xb0b6bf }),
    );
    fin.position.set(0, 0.9, 0);
    // Pulsing red nav beacon just above the nose — animated in update().
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff6a55,
      emissive: 0xff2a18,
      emissiveIntensity: 1.5,
    });
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      beaconMat,
    );
    beacon.position.y = 7.25;
    beaconMats.push(beaconMat);
    g.add(body, nose, fin, beacon);
  }
  return g;
}
