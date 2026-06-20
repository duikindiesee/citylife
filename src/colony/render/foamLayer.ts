import * as THREE from "three";
import { COLONY } from "../config";
import { type Terrain } from "../terrain";

// Spec 091 — SHORELINE FOAM. A soft glowing surf line hugging the island's coast. Earlier this was one
// axis-aligned quad per coastline cell, which staircased into hard squares on diagonal shores. Instead
// we trace the TRUE coastline as the f=0 isocontour of (elevation - seaLevel) with MARCHING SQUARES —
// sub-cell interpolated, so the line follows the coast smoothly with no cell stepping — and lay a
// FEATHERED band along it: bright white-cyan at the waterline, fading to nothing on both sides via
// per-vertex alpha, so it reads as breaking surf rather than a flat ribbon. River channels sit above
// sea level so they fall outside the contour and stay un-foamed (a clean island silhouette).
//
// Render-only + deterministic: geometry is built ONCE from the terrain grid (no clock, no RNG; the
// along-shore brightness variation is a pure hash of position). Only the overall opacity breathes on
// the wall clock in update(), matching the bus/ocean cosmetic convention.

export interface FoamLayer {
  group: THREE.Group;
  update(timeMs: number): void;
  dispose(): void;
}

export interface FoamLayerOptions {
  terrain: Terrain;
  wx: (x: number) => number;
  wz: (y: number) => number;
}

// The living sea sits at y=-0.1 and its swells crest to ~+0.31 world-y (updateOcean). Park the foam film
// just above that so the additive band always reads on the water; feathered edges hide the slight lift.
const FOAM_Y = 0.4;
const HALF = 0.75; // band half-width across the shore (so the surf line is ~1.5 cells wide, feathered)
const FOAM_RGB = new THREE.Color(0xdff6ff);

export function buildFoam(opts: FoamLayerOptions): FoamLayer | null {
  const t = opts.terrain;
  const N = t.size;
  const sea = COLONY.world.seaLevel;
  const g = (x: number, y: number): number => t.elev[t.idx(x, y)]! - sea;
  // Deterministic along-shore variation so the surf breaks unevenly (bright crests, dim troughs).
  const hash = (x: number, y: number): number => {
    let h =
      (Math.imul((x | 0) + 0x9e37, 374761393) ^
        Math.imul((y | 0) + 0x85eb, 668265263)) >>>
      0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const positions: number[] = [];
  const colors: number[] = []; // RGBA — alpha feathers the band edges
  const cr = FOAM_RGB.r,
    cg = FOAM_RGB.g,
    cb = FOAM_RGB.b;
  const addV = (wxp: number, wzp: number, a: number): void => {
    positions.push(wxp, FOAM_Y, wzp);
    colors.push(cr, cg, cb, a);
  };
  // center verts (on the contour) at alpha aC; side verts (offset by ±perp*HALF) at alpha 0
  const quad = (
    axx: number,
    azz: number,
    aa: number,
    bxx: number,
    bzz: number,
    ba: number,
    cxx: number,
    czz: number,
    ca: number,
    dxx: number,
    dzz: number,
    da: number,
  ): void => {
    addV(axx, azz, aa);
    addV(bxx, bzz, ba);
    addV(cxx, czz, ca);
    addV(axx, azz, aa);
    addV(cxx, czz, ca);
    addV(dxx, dzz, da);
  };
  const emitSeg = (
    gx0: number,
    gy0: number,
    gx1: number,
    gy1: number,
  ): void => {
    const x0 = opts.wx(gx0),
      z0 = opts.wz(gy0);
    const x1 = opts.wx(gx1),
      z1 = opts.wz(gy1);
    let dx = x1 - x0,
      dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz * HALF,
      pz = dx * HALF; // across-shore offset
    const aC = 0.55 + 0.45 * hash((gx0 + gx1) * 0.5, (gy0 + gy1) * 0.5); // uneven foam crests
    // seaward half then landward half, each fading center(aC) -> edge(0)
    quad(x0, z0, aC, x1, z1, aC, x1 - px, z1 - pz, 0, x0 - px, z0 - pz, 0);
    quad(x0, z0, aC, x1, z1, aC, x1 + px, z1 + pz, 0, x0 + px, z0 + pz, 0);
  };
  // linear edge crossing where the f=0 contour cuts the edge between corners (av) and (bv)
  const ep = (
    ax: number,
    ay: number,
    av: number,
    bx: number,
    by: number,
    bv: number,
  ): [number, number] => {
    const tt = av / (av - bv);
    return [ax + (bx - ax) * tt, ay + (by - ay) * tt];
  };

  for (let y = 0; y < N - 1; y++) {
    for (let x = 0; x < N - 1; x++) {
      const v00 = g(x, y),
        v10 = g(x + 1, y),
        v01 = g(x, y + 1),
        v11 = g(x + 1, y + 1);
      const code =
        (v00 > 0 ? 1 : 0) |
        (v10 > 0 ? 2 : 0) |
        (v11 > 0 ? 4 : 0) |
        (v01 > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const B = v00 > 0 !== v10 > 0 ? ep(x, y, v00, x + 1, y, v10) : null;
      const R =
        v10 > 0 !== v11 > 0 ? ep(x + 1, y, v10, x + 1, y + 1, v11) : null;
      const T =
        v01 > 0 !== v11 > 0 ? ep(x, y + 1, v01, x + 1, y + 1, v11) : null;
      const L = v00 > 0 !== v01 > 0 ? ep(x, y, v00, x, y + 1, v01) : null;
      const seg = (
        p: [number, number] | null,
        q: [number, number] | null,
      ): void => {
        if (p && q) emitSeg(p[0], p[1], q[0], q[1]);
      };
      switch (code) {
        case 1:
        case 14:
          seg(L, B);
          break;
        case 2:
        case 13:
          seg(B, R);
          break;
        case 3:
        case 12:
          seg(L, R);
          break;
        case 4:
        case 11:
          seg(R, T);
          break;
        case 6:
        case 9:
          seg(B, T);
          break;
        case 7:
        case 8:
          seg(L, T);
          break;
        case 5:
          seg(L, B);
          seg(R, T);
          break; // saddle
        case 10:
          seg(B, R);
          seg(T, L);
          break; // saddle
      }
    }
  }
  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4)); // vec4 → per-vertex alpha
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false, // additive glow — never punch a depth hole in the transparent sea
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2; // paint over the transparent ocean (renderOrder 0) and its swells
  const group = new THREE.Group();
  group.name = "Shore Foam";
  group.add(mesh);

  return {
    group,
    update(timeMs: number) {
      // Two desynced sines (non-integer ratio) breathe the whole surf line; the per-vertex feather and
      // hash give it shape. Wall-clock only; geometry never moves — a single float write per frame.
      const tt = timeMs / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(tt * 0.8);
      const flicker = 0.5 + 0.5 * Math.sin(tt * 1.37 + 1.3);
      mat.opacity = 0.34 + 0.22 * pulse + 0.08 * flicker;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      group.parent?.remove(group);
    },
  };
}
