import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Spec 132 — Joe the Crab, ported from the legacy makeCrabGeometry with the operator's
// corrections from the Sol-34 review: the headset is BLUE (blue-white band + blue cups,
// "blue headsets!"), the lightning accents sit ON the earcup outer faces — the sides of the
// headset, not his mouth and not loose above him — one per cup, and a separate ANIMATED
// bolt hovers above him pointing down (the operator liked that accidental look; the
// component owns its bobbing). One merged vertex-coloured geometry; local space origin at
// the ground plane, FRONT = +Z.

export const CRAB_COLORS = {
  shell: 0xe2562f,
  shellDark: 0xc23f1f,
  eyeWhite: 0xf6f6f6,
  eyePupil: 0x101010,
  band: 0xbcd2f5, // blue-white headband
  cup: 0x2f6fd0, // blue earcups
  bolt: 0xf4c020,
} as const;

/** The hover-bolt rest height above the crab's local origin. */
export const CRAB_BOLT_HOVER_Y = 0.85;

function addPart(
  parts: THREE.BufferGeometry[],
  tint: THREE.Color,
  g: THREE.BufferGeometry,
  hex: number,
  pos: [number, number, number],
  rot?: [number, number, number],
  scale?: [number, number, number],
) {
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  if (rot) {
    g.rotateX(rot[0]);
    g.rotateY(rot[1]);
    g.rotateZ(rot[2]);
  }
  g.translate(pos[0], pos[1], pos[2]);
  const count = g.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  tint.setHex(hex);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  parts.push(g);
}

export function buildCrabGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tint = new THREE.Color();
  const add = (
    g: THREE.BufferGeometry,
    hex: number,
    pos: [number, number, number],
    rot?: [number, number, number],
    scale?: [number, number, number],
  ) => addPart(parts, tint, g, hex, pos, rot, scale);

  const { shell: SHELL, shellDark: SHELL_DK, eyeWhite: EYE_W, eyePupil: EYE_P, band: BAND, cup: CUP, bolt: BOLT } = CRAB_COLORS;

  // shell — a flattened dome, wider across (x) than deep (z)
  add(new THREE.SphereGeometry(0.3, 14, 10), SHELL, [0, 0.26, 0], undefined, [1.25, 0.6, 1.0]);
  // eyes — two forward stalks (+z) each capped with a white eyeball + dark pupil
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 6), SHELL_DK, [s * 0.12, 0.36, 0.18], [0.55, 0, 0]);
    add(new THREE.SphereGeometry(0.062, 8, 6), EYE_W, [s * 0.12, 0.46, 0.25]);
    add(new THREE.SphereGeometry(0.03, 6, 6), EYE_P, [s * 0.12, 0.47, 0.3]);
  }
  // claws — an upper arm reaching forward-out + a two-prong pincer (mirrored)
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.1, 0.1, 0.26), SHELL, [s * 0.3, 0.18, 0.22]);
    add(new THREE.BoxGeometry(0.12, 0.16, 0.12), SHELL, [s * 0.34, 0.2, 0.4]);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.16), SHELL_DK, [s * 0.34, 0.26, 0.5]);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.13), SHELL_DK, [s * 0.34, 0.16, 0.49]);
  }
  // legs — three per side, thin cylinders splayed down-out to the ground
  for (const s of [-1, 1]) {
    for (const dz of [-0.16, 0.02, 0.18]) {
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 5), SHELL_DK, [s * 0.34, 0.1, dz], [0, 0, s * 0.95]);
    }
  }
  // headset — an ELLIPTICAL band hugging the flattened shell side-to-side, its ends meeting
  // the earcups on the sides, crown just over the dome
  add(new THREE.TorusGeometry(0.3, 0.038, 8, 22, Math.PI), BAND, [0, 0.26, 0], undefined, [1.25, 0.68, 1.0]);
  // earcups — chunky BLUE discs seated ON the sides of the head, facing out
  for (const s of [-1, 1])
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 16), CUP, [s * 0.38, 0.26, 0.02], [0, 0, Math.PI / 2]);
  // lightning accents — ON the earcup OUTER faces (the sides of the headset), one per cup
  for (const s of [-1, 1])
    add(new THREE.BoxGeometry(0.022, 0.13, 0.06), BOLT, [s * 0.42, 0.27, 0.02], [0, 0, s * 0.4]);

  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** The hover bolt — a chunkier zigzag flash the component floats + bobs above Joe,
 *  tip pointing DOWN at him. Own geometry so it can animate independently. */
export function buildHoverBoltGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tint = new THREE.Color();
  const add = (
    g: THREE.BufferGeometry,
    pos: [number, number, number],
    rotZ: number,
  ) => addPart(parts, tint, g, CRAB_COLORS.bolt, pos, [0, 0, rotZ]);
  // two offset strokes make the classic zigzag; they overlap at the elbow so the flash
  // reads as ONE connected bolt from every angle, the lower stroke ending in the down-tip
  add(new THREE.BoxGeometry(0.055, 0.2, 0.055), [0.028, 0.075, 0], 0.55);
  add(new THREE.BoxGeometry(0.055, 0.22, 0.055), [-0.028, -0.065, 0], 0.55);
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}
