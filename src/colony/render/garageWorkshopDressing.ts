// Spec 179 — open middle bay dressed as a tidy low-poly workshop.
//
// Props sit against the partitions and the back wall, outside the centred car's
// frontal silhouette. Lift posts stay near the jambs (see GARAGE_LIFT_POST_SPREAD)
// so a head-on view from the apron sees the car, not a pier. Nothing here is added
// to the obstacle list: Bay 2 stays legally drivable.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CELL_SIZE } from "../scale";
import {
  GARAGE_LIFT_DECK_M,
  GARAGE_LIFT_POST_SPREAD,
  type GarageAnchorShellModel,
} from "./garageAnchorShell";

type Bay = GarageAnchorShellModel["serviceBay"];

function placedBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

export interface BayWorkspace {
  group: THREE.Group;
}

/**
 * Tool chests, a corner bench, a pegboard, a tyre rack, an overhead inspection
 * lamp, and a display car centred between the lift posts.
 */
export function buildOpenBayWorkspace(serviceBay: Bay): BayWorkspace {
  const group = new THREE.Group();
  group.name = "garageAnchorOpenBayWorkspace";

  const bayFaceZ = serviceBay.z + serviceBay.d / 2 + 0.045;
  const sx = serviceBay.x;
  const hdw = serviceBay.bayDoorW / 2;
  const spacing = serviceBay.bayDoorW * 1.25;
  const bay1X = sx - spacing;
  const bay3X = sx + spacing;
  const leftInner = (bay1X + hdw + sx - hdw) / 2 + 0.12;
  const rightInner = (sx + hdw + bay3X - hdw) / 2 - 0.12;
  const postZ = bayFaceZ - serviceBay.d * 0.26;
  const postX = serviceBay.bayDoorW * GARAGE_LIFT_POST_SPREAD;
  // Just inside the back-wall face, behind the drivable bay floor.
  const backZ = serviceBay.z - serviceBay.d / 2 + 0.28;

  const red = new THREE.MeshStandardMaterial({
    color: 0xc23b32,
    roughness: 0.55,
    metalness: 0.12,
    flatShading: true,
  });
  const redDark = new THREE.MeshStandardMaterial({
    color: 0x8e2a24,
    roughness: 0.5,
    metalness: 0.16,
    flatShading: true,
  });
  const graphite = new THREE.MeshStandardMaterial({
    color: 0x3a4048,
    roughness: 0.7,
    metalness: 0.2,
    flatShading: true,
  });
  const sand = new THREE.MeshStandardMaterial({
    color: 0xd2b48c,
    roughness: 0.82,
    flatShading: true,
  });
  const yellow = new THREE.MeshStandardMaterial({
    color: 0xf0b429,
    roughness: 0.4,
    metalness: 0.45,
    emissive: 0x8a5508,
    emissiveIntensity: 0.28,
    flatShading: true,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff8ee,
    emissive: 0xfff4e0,
    emissiveIntensity: 2.2,
    roughness: 0.25,
  });

  const redParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const wheelParts: THREE.BufferGeometry[] = [];

  const addChest = (x: number, z: number) => {
    const cw = 0.28;
    const ch = 0.26;
    const cd = 0.2;
    redParts.push(placedBox(cw, ch * 0.72, cd, x, ch * 0.42, z));
    darkParts.push(placedBox(cw * 0.96, 0.012, cd * 0.98, x, ch * 0.28, z));
    darkParts.push(placedBox(cw * 0.96, 0.012, cd * 0.98, x, ch * 0.48, z));
    darkParts.push(placedBox(cw, 0.035, cd, x, ch * 0.78, z));
    for (const [ox, oz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const wheel = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 5);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(x + ox * cw * 0.38, 0.03, z + oz * cd * 0.38);
      wheelParts.push(wheel);
    }
  };

  addChest(leftInner + 0.16, postZ + 0.55);
  addChest(leftInner + 0.16, postZ - 0.85);
  addChest(rightInner - 0.16, postZ + 0.55);

  const redMesh = new THREE.Mesh(mergeParts(redParts)!, red);
  redMesh.name = "garageAnchorBayToolChests";
  const trimMesh = new THREE.Mesh(mergeParts(darkParts)!, redDark);
  trimMesh.name = "garageAnchorBayToolChestTrim";
  const wheels = new THREE.Mesh(mergeParts(wheelParts)!, graphite);
  wheels.name = "garageAnchorBayToolChestWheels";
  group.add(redMesh, trimMesh, wheels);

  const benchDepth = 0.16;
  const bench = new THREE.Mesh(
    mergeParts([
      placedBox(0.7, 0.04, benchDepth, leftInner + 0.4, 0.28, backZ + benchDepth / 2),
      placedBox(0.04, 0.26, 0.04, leftInner + 0.12, 0.14, backZ + 0.04),
      placedBox(0.04, 0.26, 0.04, leftInner + 0.68, 0.14, backZ + 0.04),
      placedBox(0.04, 0.26, 0.04, leftInner + 0.12, 0.14, backZ + benchDepth - 0.04),
      placedBox(0.04, 0.26, 0.04, leftInner + 0.68, 0.14, backZ + benchDepth - 0.04),
      placedBox(0.62, 0.02, 0.16, leftInner + 0.4, 0.12, backZ + benchDepth / 2),
    ])!,
    sand,
  );
  bench.name = "garageAnchorBayWorkbench";
  group.add(bench);

  const boardW = rightInner - leftInner - 0.2;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(boardW, 0.7, 0.03),
    graphite,
  );
  board.name = "garageAnchorBayPegboard";
  board.position.set(sx, 0.55, backZ + 0.02);
  const toolZ = backZ + 0.05;
  const toolBits: THREE.BufferGeometry[] = [];
  const tilt = (geo: THREE.BufferGeometry, x: number, y: number, angle: number) => {
    geo.rotateZ(angle);
    geo.translate(x, y, toolZ);
    toolBits.push(geo);
  };
  // Claw hammers and diagonal open wrenches, so the row does not read as lettering.
  const hangHammer = (x: number, flip: number) => {
    tilt(new THREE.BoxGeometry(0.04, 0.22, 0.03), x, 0.52, 0);
    const head = new THREE.BoxGeometry(0.16, 0.05, 0.035);
    head.translate(flip * 0.04, 0, 0);
    tilt(head, x, 0.64, 0);
  };
  const hangWrench = (x: number, angle: number) => {
    tilt(new THREE.BoxGeometry(0.035, 0.2, 0.028), x, 0.52, angle);
    tilt(new THREE.BoxGeometry(0.09, 0.04, 0.028), x, 0.62, angle);
  };
  hangHammer(sx - 0.62, 1);
  hangWrench(sx - 0.28, 0.5);
  hangHammer(sx + 0.08, -1);
  hangWrench(sx + 0.46, -0.4);
  const tools = new THREE.Mesh(
    mergeParts(toolBits)!,
    new THREE.MeshStandardMaterial({
      color: 0x2c3138,
      roughness: 0.45,
      metalness: 0.35,
      flatShading: true,
    }),
  );
  tools.name = "garageAnchorBayToolSilhouettes";
  group.add(board, tools);

  const tyreMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e33,
    roughness: 0.85,
    flatShading: true,
  });
  const tyreParts: THREE.BufferGeometry[] = [];
  const rackX = rightInner - 0.16;
  for (let i = 0; i < 3; i++) {
    const tyre = new THREE.CylinderGeometry(0.13, 0.13, 0.07, 8);
    tyre.rotateZ(Math.PI / 2);
    tyre.translate(rackX, 0.16, postZ + 0.15 - i * 0.2);
    tyreParts.push(tyre);
  }
  tyreParts.push(placedBox(0.04, 0.36, 0.62, rackX + 0.06, 0.18, postZ - 0.05));
  const tyres = new THREE.Mesh(mergeParts(tyreParts)!, tyreMat);
  tyres.name = "garageAnchorBayTyreRack";
  group.add(tyres);

  const deckY = GARAGE_LIFT_DECK_M / CELL_SIZE;
  const postTop = Math.min(serviceBay.h - 0.08, deckY + 2.4 / CELL_SIZE);
  const postH = postTop;
  const postCenterY = postH / 2;
  for (const side of [-1, 1] as const) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, postH, 0.1),
      yellow,
    );
    post.name = `garageAnchorHydraulicLift.${side < 0 ? "left" : "right"}`;
    post.position.set(sx + postX * side, postCenterY, postZ);
    group.add(post);
  }
  const armLen = 3.4 / CELL_SIZE;
  const arms = new THREE.Mesh(
    mergeParts([
      placedBox(0.08, 0.05, armLen, sx - 0.22, deckY - 0.025, postZ),
      placedBox(0.08, 0.05, armLen, sx + 0.22, deckY - 0.025, postZ),
      placedBox(postX * 2 - 0.1, 0.04, 0.08, sx, postTop - 0.04, postZ),
    ])!,
    yellow,
  );
  arms.name = "garageAnchorHydraulicLiftArms";
  group.add(arms);

  const stripMat = new THREE.MeshStandardMaterial({
    color: 0xfffaed,
    emissive: 0xfffaed,
    emissiveIntensity: 1.6,
    roughness: 0.35,
  });
  const strips = new THREE.Mesh(
    mergeParts([
      placedBox(serviceBay.bayDoorW * 0.9, 0.03, 0.12, sx, serviceBay.h - 0.08, postZ - 0.35),
      placedBox(serviceBay.bayDoorW * 0.9, 0.03, 0.12, sx, serviceBay.h - 0.08, postZ + 0.35),
    ])!,
    stripMat,
  );
  strips.name = "garageAnchorBayCeilingStrips";
  group.add(strips);
  const key = new THREE.PointLight(0xfffaed, 42, 16, 1.4);
  key.name = "garageAnchorBayKeyLight";
  key.position.set(sx, serviceBay.h - 0.12, postZ);
  const fill = new THREE.PointLight(0xa5dcff, 18, 14, 1.6);
  fill.name = "garageAnchorBayFillLight";
  fill.position.set(sx + 0.35, serviceBay.h - 0.2, postZ + 0.9);
  group.add(key, fill);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(serviceBay.bayDoorW * 0.7, 0.03, 0.22),
    lampMat,
  );
  lamp.name = "garageAnchorBayInspectionLamp";
  lamp.position.set(sx, serviceBay.h - 0.1, postZ);
  group.add(lamp);

  const liftCar = new THREE.Group();
  liftCar.name = "garageAnchorBayLiftCar";
  // Deck is the wheel contact. Native GLB nose is -Z, so yaw 0 faces into the bay.
  liftCar.position.set(sx, deckY, postZ);
  liftCar.rotation.y = 0;
  // Metric placeholder: 4.08 m long on Z, 1.825 m wide, 1.01 m tall, nose toward -Z.
  const fallback = new THREE.Mesh(
    new THREE.BoxGeometry(1.825 / CELL_SIZE, 1.01 / CELL_SIZE, 4.08 / CELL_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x4d8be0, roughness: 0.45 }),
  );
  fallback.name = "garageAnchorBayLiftCarFallback";
  fallback.position.y = 1.01 / CELL_SIZE / 2;
  liftCar.add(fallback);
  group.add(liftCar);

  return { group };
}
