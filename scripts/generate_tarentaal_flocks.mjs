import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

if (typeof FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.({ target: this }); }); }
    readAsDataURL(blob) { blob.arrayBuffer().then((ab) => { this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(ab).toString("base64")}`; this.onloadend?.({ target: this }); }); }
  };
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(rootDir, "public/assets/citylife/wildlife");
mkdirSync(outDir, { recursive: true });

const material = (color, roughness = 0.68) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02, flatShading: false });
const mesh = (geometry, color, name, roughness) => { const value = new THREE.Mesh(geometry, material(color, roughness)); value.name = name; value.castShadow = true; return value; };
const qTrack = (node, axis, times, angles) => { const base = node.quaternion.clone(); const vector = new THREE.Vector3(...axis); const values = []; for (const angle of angles) { const q = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(vector, angle)); values.push(q.x, q.y, q.z, q.w); } return new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values); };
const yTrack = (node, times, offsets) => new THREE.VectorKeyframeTrack(`${node.name}.position`, times, offsets.flatMap((offset) => [node.position.x, node.position.y + offset, node.position.z]));

function buildBird(age) {
  const adult = age === "adult";
  const root = new THREE.Group(); root.name = adult ? "TarentaalAdult" : "TarentaalChick";
  const body = new THREE.Group(); body.name = `${root.name}_body`; body.position.y = adult ? 0.34 : 0.18; root.add(body);
  const torso = mesh(new THREE.SphereGeometry(adult ? 0.26 : 0.14, 20, 14), adult ? 0x343944 : 0x8c6d3f, `${root.name}_torso`, 0.72); torso.scale.set(0.9, 1, 1.35); body.add(torso);
  const breast = mesh(new THREE.SphereGeometry(adult ? 0.20 : 0.105, 16, 12), adult ? 0x4a505c : 0xa78752, `${root.name}_breast`, 0.76); breast.scale.set(0.82, 0.92, 0.95); breast.position.set(0, -0.01, 0.16); body.add(breast);
  const head = new THREE.Group(); head.name = `${root.name}_head`; head.position.set(0, adult ? 0.27 : 0.15, adult ? 0.18 : 0.10); body.add(head);
  const neck = mesh(new THREE.CylinderGeometry(adult ? 0.065 : 0.04, adult ? 0.09 : 0.055, adult ? 0.24 : 0.13, 12), adult ? 0x38729a : 0x9b7745, `${root.name}_neck`, 0.62); neck.position.y = adult ? -0.08 : -0.04; head.add(neck);
  const skull = mesh(new THREE.SphereGeometry(adult ? 0.105 : 0.064, 16, 12), adult ? 0x4b82a5 : 0xa9854d, `${root.name}_skull`, 0.58); skull.scale.set(0.8, 0.95, 1); skull.position.y = adult ? 0.07 : 0.045; head.add(skull);
  const beak = mesh(new THREE.ConeGeometry(adult ? 0.045 : 0.028, adult ? 0.13 : 0.075, 10), 0xd8aa42, `${root.name}_beak`, 0.55); beak.rotation.x = Math.PI / 2; beak.position.set(0, adult ? 0.055 : 0.035, adult ? 0.13 : 0.08); head.add(beak);
  for (const side of [-1, 1]) { const eye = mesh(new THREE.SphereGeometry(adult ? 0.018 : 0.012, 10, 8), 0x0b0d10, `${root.name}_eye_${side}`, 0.2); eye.position.set(side * (adult ? 0.067 : 0.041), adult ? 0.095 : 0.058, adult ? 0.067 : 0.042); head.add(eye); }
  if (adult) { const wattle = mesh(new THREE.SphereGeometry(0.035, 10, 8), 0xc64038, `${root.name}_wattle`, 0.62); wattle.scale.set(0.65, 1.25, 0.55); wattle.position.set(0, 0.005, 0.105); head.add(wattle); }
  const wings = [];
  for (const side of [-1, 1]) { const wing = new THREE.Group(); wing.name = `${root.name}_wing_${side}`; wing.position.set(side * (adult ? 0.19 : 0.105), 0.02, -0.015); const feather = mesh(new THREE.SphereGeometry(adult ? 0.18 : 0.095, 14, 10), adult ? 0x292e38 : 0x765932, `${root.name}_wingMesh_${side}`, 0.78); feather.scale.set(0.34, 0.9, 1.12); wing.add(feather); body.add(wing); wings.push(wing); }
  const legs = [];
  for (const side of [-1, 1]) { const leg = new THREE.Group(); leg.name = `${root.name}_leg_${side}`; leg.position.set(side * (adult ? 0.09 : 0.05), adult ? -0.22 : -0.12, 0); const shank = mesh(new THREE.CylinderGeometry(adult ? 0.014 : 0.009, adult ? 0.012 : 0.008, adult ? 0.28 : 0.15, 8), 0xc89d55, `${root.name}_shank_${side}`, 0.55); shank.position.y = adult ? -0.13 : -0.07; leg.add(shank); const foot = mesh(new THREE.BoxGeometry(adult ? 0.05 : 0.03, 0.012, adult ? 0.12 : 0.07), 0xc89d55, `${root.name}_foot_${side}`, 0.55); foot.position.set(0, adult ? -0.27 : -0.145, adult ? 0.035 : 0.02); leg.add(foot); body.add(leg); legs.push(leg); }
  return { root, body, head, wings, legs };
}

function clips(parts, age) {
  const prefix = age === "adult" ? "Tarentaal" : "TarentaalChick";
  const idleTimes = [0, 0.6, 1.2, 1.8];
  const walkTimes = [0, 0.2, 0.4, 0.6, 0.8];
  return [
    new THREE.AnimationClip(`${prefix}_idle`, 1.8, [yTrack(parts.body, idleTimes, [0, 0.012, 0, 0.012]), qTrack(parts.head, [1, 0, 0], idleTimes, [0, 0.55, 0.08, 0.55])]),
    new THREE.AnimationClip(`${prefix}_walk`, 0.8, [yTrack(parts.body, walkTimes, [0, 0.022, 0, 0.022, 0]), qTrack(parts.legs[0], [1, 0, 0], walkTimes, [0, 0.65, 0, -0.65, 0]), qTrack(parts.legs[1], [1, 0, 0], walkTimes, [0, -0.65, 0, 0.65, 0])]),
    new THREE.AnimationClip(`${prefix}_chase`, 0.5, [yTrack(parts.body, [0, 0.125, 0.25, 0.375, 0.5], [0, 0.04, 0, 0.04, 0]), qTrack(parts.legs[0], [1, 0, 0], [0, 0.125, 0.25, 0.375, 0.5], [0, 0.9, 0, -0.9, 0]), qTrack(parts.legs[1], [1, 0, 0], [0, 0.125, 0.25, 0.375, 0.5], [0, -0.9, 0, 0.9, 0]), ...parts.wings.map((wing, index) => qTrack(wing, [0, 0, 1], [0, 0.25, 0.5], [0, index ? -0.32 : 0.32, 0]))]),
  ];
}

async function exportBird(age, filename) {
  const parts = buildBird(age); const scene = new THREE.Scene(); scene.add(parts.root);
  const result = await new Promise((resolveResult, reject) => new GLTFExporter().parse(scene, resolveResult, reject, { binary: true, animations: clips(parts, age) }));
  writeFileSync(resolve(outDir, filename), Buffer.from(result));
  console.log(`${filename} ${result.byteLength} bytes`);
}

await exportBird("adult", "tarentaal-adult.glb");
await exportBird("chick", "tarentaal-chick.glb");
