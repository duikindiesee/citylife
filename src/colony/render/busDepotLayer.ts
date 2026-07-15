import * as THREE from "three";
import type { DepotSite, DepotLayout } from "../transit/busDepot";

// Spec 149 Phase 1 — the PRIMITIVE bus depot: cut-and-fill apron/foundation, fleet-sized painted
// bays, office, boarding shelter and a lit BUS sign. Runtime node names preserve the GLB contract
// active subset: Depot_Apron, Depot_Bay_00..04, Depot_Office, Depot_Shelter, Depot_Sign.

const CELL = 4; // world metres per grid cell

export interface BusDepotLayerOptions {
  site: DepotSite;
  layout: DepotLayout;
  wx: (x: number) => number;
  wz: (y: number) => number;
  /** World Y of the slab TOP — the flat plane the buses park on. */
  padTopY: number;
  /** Bottom of the cut-and-fill foundation, below the lowest natural pad edge. */
  foundationBottomY: number;
  /** Public-road ribbon height at the surveyed spur endpoint. */
  roadTopY: number;
}

export function buildBusDepotLayer(opts: BusDepotLayerOptions): THREE.Group {
  const { site, layout, wx, wz, padTopY, foundationBottomY, roadTopY } = opts;
  const g = new THREE.Group();
  g.name = "bus-depot";

  const apronMat = new THREE.MeshStandardMaterial({
    color: 0x3d4148,
    roughness: 0.92,
  });
  const drivewayMat = new THREE.MeshStandardMaterial({
    color: 0x595f6a,
    roughness: 0.92,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const foundationMat = new THREE.MeshStandardMaterial({
    color: 0x555861,
    roughness: 1,
  });
  const bayMat = new THREE.MeshStandardMaterial({
    color: 0x555b66,
    roughness: 0.85,
  });
  const officeMat = new THREE.MeshStandardMaterial({
    color: 0xb9a684,
    roughness: 0.7,
  });
  const shelterMat = new THREE.MeshStandardMaterial({
    color: 0x2f6f6f,
    roughness: 0.6,
    metalness: 0.15,
  });
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x3a3f4a,
    roughness: 0.7,
  });
  const signMat = new THREE.MeshStandardMaterial({
    color: 0xffb02e,
    emissive: 0xffb02e,
    emissiveIntensity: 0.8,
    roughness: 0.35,
  });

  // The pad runs long along `u` and deep along `inward` — world sizes follow that frame.
  const alongX = layout.u.x !== 0; // long axis along grid x?
  const dims = (longM: number, deepM: number): [number, number] =>
    alongX ? [longM, deepM] : [deepM, longM];

  // Cut-and-fill retaining volume reaches below the lowest natural edge. Keep it separate from the
  // thin asphalt course so the authored `Depot_Apron` contract remains a surface, while tests and
  // visual probes can inspect the foundation bounds directly.
  const slabDepth = 0.18;
  const foundationTopY = padTopY - slabDepth + 0.02;
  const foundationDepth = Math.max(0.34, foundationTopY - foundationBottomY);
  const cx = wx(site.x + (site.w - 1) / 2);
  const cz = wz(site.y + (site.h - 1) / 2);
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(
      site.w * CELL + 0.4,
      foundationDepth,
      site.h * CELL + 0.4,
    ),
    foundationMat,
  );
  foundation.name = "Depot_Foundation";
  foundation.position.set(cx, foundationTopY - foundationDepth / 2, cz);
  foundation.userData.foundationBottomY = foundationTopY - foundationDepth;
  foundation.userData.foundationTopY = foundationTopY;
  foundation.receiveShadow = true;
  g.add(foundation);

  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(site.w * CELL + 0.2, slabDepth, site.h * CELL + 0.2),
    apronMat,
  );
  apron.name = "Depot_Apron";
  apron.position.set(cx, padTopY - slabDepth / 2, cz);
  apron.userData.padTopY = padTopY;
  apron.receiveShadow = true;
  g.add(apron);

  // A depot is a driveway, not a public four-way junction. Bridge the apron gate to the surveyed
  // road endpoint with one shallow flared throat: wide and flush at the apron boundary, narrower
  // where it kisses the carriageway, and extending slightly under the road surface so there is no
  // crack or square butt-joint. It deliberately does not overlay the apron (the old diagonal seam).
  const gate = new THREE.Vector2(wx(site.gate.x), wz(site.gate.y));
  const road = new THREE.Vector2(wx(site.roadCell.x), wz(site.roadCell.y));
  const dir = road.clone().sub(gate).normalize();
  const perp = new THREE.Vector2(-dir.y, dir.x);
  const start = gate.clone();
  const end = road.clone().addScaledVector(dir, 1.2);
  const padMouthWidthM = 7.4;
  const roadMouthWidthM = 5.8;
  const vertex = (
    p: THREE.Vector2,
    side: number,
    halfWidth: number,
    y: number,
  ) => [
    p.x + perp.x * side * halfWidth,
    y + 0.025,
    p.y + perp.y * side * halfWidth,
  ];
  const a = vertex(start, -1, padMouthWidthM / 2, padTopY);
  const b = vertex(start, 1, padMouthWidthM / 2, padTopY);
  const c = vertex(end, -1, roadMouthWidthM / 2, roadTopY);
  const d = vertex(end, 1, roadMouthWidthM / 2, roadTopY);
  const drivewayGeometry = new THREE.BufferGeometry();
  drivewayGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([...a, ...b, ...c, ...c, ...b, ...d], 3),
  );
  drivewayGeometry.computeVertexNormals();
  const driveway = new THREE.Mesh(drivewayGeometry, drivewayMat);
  driveway.name = "Depot_Driveway";
  driveway.userData.padMouthWidthM = padMouthWidthM;
  driveway.userData.roadMouthWidthM = roadMouthWidthM;
  driveway.receiveShadow = true;
  g.add(driveway);

  // Fleet-sized painted bays — a lighter tile per owned coach.
  layout.bays.forEach((bay, k) => {
    const [bw, bd] = dims(3.4, 13);
    const tile = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.06, bd), bayMat);
    tile.name = `Depot_Bay_${String(k).padStart(2, "0")}`;
    tile.position.set(wx(bay.park.x), padTopY + 0.03, wz(bay.park.y));
    tile.receiveShadow = true;
    g.add(tile);
  });

  // Office block at the gate-side corner.
  const [ow, od] = dims(6, 4);
  const office = new THREE.Mesh(new THREE.BoxGeometry(ow, 3.5, od), officeMat);
  office.name = "Depot_Office";
  office.position.set(wx(layout.office.x), padTopY + 1.75, wz(layout.office.y));
  office.castShadow = true;
  office.receiveShadow = true;
  g.add(office);

  // Boarding shelter beside the gate lane: roof on two posts + a back panel.
  const shelter = new THREE.Group();
  shelter.name = "Depot_Shelter";
  const [sw, sd] = dims(6, 2.5);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.15, sd), shelterMat);
  roof.position.y = 2.7;
  roof.castShadow = true;
  const postOff = alongX ? [2.6, 0] : [0, 2.6];
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 2.7, 8),
      poleMat,
    );
    post.position.set(postOff[0]! * s, 1.35, postOff[1]! * s);
    shelter.add(post);
  }
  const [pw, pd] = dims(6, 0.12);
  const back = new THREE.Mesh(new THREE.BoxGeometry(pw, 1.3, pd), shelterMat);
  back.position.set(
    alongX ? 0 : layout.inward.x * 1.1,
    1.6,
    alongX ? layout.inward.y * 1.1 : 0,
  );
  shelter.add(roof, back);
  shelter.position.set(wx(layout.shelter.x), padTopY, wz(layout.shelter.y));
  g.add(shelter);

  // The lit BUS totem by the gate.
  const sign = new THREE.Group();
  sign.name = "Depot_Sign";
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, 4.5, 8),
    poleMat,
  );
  pole.position.y = 2.25;
  pole.castShadow = true;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.28), signMat);
  box.position.y = 4.4;
  if (!alongX) box.rotation.y = Math.PI / 2;
  sign.add(pole, box);
  sign.position.set(wx(layout.sign.x), padTopY, wz(layout.sign.y));
  g.add(sign);

  return g;
}
