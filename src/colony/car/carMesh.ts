// Spec 096 — build a stylised car mesh from a CarSpec, WITH its bolt-on parts mounted on their sockets.
// Base: a wedge body, a cabin, an accent stripe, four wheels, emissive headlights. Then each mounted
// part (carParts) renders from its geom descriptor at its socket anchor: a wheels part re-shapes the
// four wheels, every other part is a child mesh on the car. The headlight/stripe/part emissive stays
// UNDER the 0.9 bloom threshold (spec 087) while giving a night-visible floor (the day-night rule), so
// the car and its parts read from the city below and after dark. No lights, no animation, no rng.
import * as THREE from "three";
import type { CarSpec } from "./carSpec";
import { CAR_PARTS, validCarParts, type CarPartDef } from "./carParts";

export function buildCarMesh(spec: CarSpec): THREE.Group {
  const g = new THREE.Group();
  const mounted = validCarParts(spec.parts).map((k) => CAR_PARTS[k]);
  const wheelPart = mounted.find((d) => d.socket === "wheels");
  // a "body" mod reshapes the car: a roof chop lowers the cabin (a classic hot-rod silhouette)
  const chopped = mounted.some(
    (d) => d.socket === "body" && d.kind === "roof_chop",
  );

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
    new THREE.BoxGeometry(0.5, chopped ? 0.16 : 0.26, 0.4),
    new THREE.MeshStandardMaterial({
      color: spec.paint.cabin,
      roughness: 0.4,
      metalness: 0.2,
    }),
  );
  cabin.position.set(-0.02, chopped ? 0.4 : 0.45, 0);
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

  // a wheels part (e.g. slicks) re-shapes + recolours the four wheels; otherwise stock tyres
  const wheelR = wheelPart ? wheelPart.geom.size[0] : 0.12;
  const wheelW = wheelPart ? wheelPart.geom.size[2] : 0.08;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({
    color: wheelPart ? wheelPart.geom.color : 0x1a1c20,
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
    w.position.set(wx, wheelR, wz);
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

  // mount every bolt-on part as a child mesh at its socket anchor. The wheels + body sockets reshape the
  // car (tyres above, cabin chop) rather than adding a child, so they are skipped here.
  for (const def of mounted) {
    if (def.socket === "wheels" || def.socket === "body") continue;
    const part = buildPartMesh(def);
    part.position.set(def.anchor.x, def.anchor.y, def.anchor.z);
    g.add(part);
  }
  return g;
}

/** Build one bolt-on part mesh from its THREE-free geom descriptor. A small emissive floor (well under
 *  the 0.9 bloom threshold) keeps the part visible at night, matching the rest of the car. */
function buildPartMesh(def: CarPartDef): THREE.Mesh {
  const [sx, sy, sz] = def.geom.size;
  let geo: THREE.BufferGeometry;
  if (def.geom.shape === "cyl") {
    geo = new THREE.CylinderGeometry(sx, sx, sz, 12);
    geo.rotateZ(Math.PI / 2); // lie the pipe/cylinder along the car length
  } else {
    geo = new THREE.BoxGeometry(sx, sy, sz);
  }
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: def.geom.color,
      roughness: 0.5,
      metalness: 0.35,
      emissive: def.geom.color,
      emissiveIntensity: 0.12,
    }),
  );
  m.castShadow = true;
  return m;
}
