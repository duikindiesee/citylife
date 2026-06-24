// Spec 096 Slice A — build a stylised car mesh from a CarSpec. Pure geometry: a wedge body, a cabin, an
// accent stripe, four wheels, and emissive headlights. The headlight/stripe emissive stays UNDER the
// 0.9 bloom threshold (spec 087 race rule) but gives the car a night-visible floor (the day-night rule),
// so it reads from the city below and after dark. No lights, no animation, no rng — deterministic.
import * as THREE from "three";
import type { CarSpec } from "./carSpec";

export function buildCarMesh(spec: CarSpec): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.3, 0.42),
    new THREE.MeshStandardMaterial({
      color: spec.paint.body,
      roughness: 0.45,
      metalness: 0.35,
    }),
  );
  body.position.y = 0.22;
  body.castShadow = true;

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.26, 0.4),
    new THREE.MeshStandardMaterial({
      color: spec.paint.cabin,
      roughness: 0.4,
      metalness: 0.2,
    }),
  );
  cabin.position.set(-0.02, 0.45, 0);
  cabin.castShadow = true;

  // accent stripe down the bonnet — a gentle emissive floor so the car still reads at night
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.97, 0.06, 0.07),
    new THREE.MeshStandardMaterial({
      color: spec.paint.accent,
      emissive: spec.paint.accent,
      emissiveIntensity: 0.25,
    }),
  );
  stripe.position.set(0, 0.31, 0.22);

  const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x1a1c20,
    roughness: 0.85,
  });
  const wheels: THREE.Mesh[] = [];
  for (const [wx, wz] of [
    [0.32, 0.2],
    [0.32, -0.2],
    [-0.32, 0.2],
    [-0.32, -0.2],
  ] as const) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.12, wz);
    w.castShadow = true;
    wheels.push(w);
  }

  // headlights — emissive (night-visible) but under the bloom threshold
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cc,
    emissive: 0xffe08a,
    emissiveIntensity: 0.7,
  });
  const lights: THREE.Mesh[] = [];
  for (const hz of [0.13, -0.13]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.08), headMat);
    h.position.set(0.49, 0.24, hz);
    lights.push(h);
  }

  g.add(body, cabin, stripe, ...wheels, ...lights);
  return g;
}
