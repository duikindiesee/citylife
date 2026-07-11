// Spec 121 — the ambient pedestrian crowd, R3F port of the legacy initPedestrians /
// updatePedestrians path. Unlike the citizen avatars (spec 120), which the runtime feeds,
// the pedestrian crowd is a DECORATIVE render-layer flourish whose stepping lived in the
// legacy PlanetRenderer (dead in the R3F path). So R3FPedestrians owns its own pool and
// this module holds the PURE math — pool seeding, target picking, per-figure stepping,
// transform — so it is all node-testable and the component stays a thin instanced syncer.
//
// The visible count tracks the REAL colonist population (capped to the pool): the streets
// are as busy as the colony actually is — these are its people, not a fixed droid army.
import { CITIZEN_HEIGHT_M, citizenFigure } from '../scale';

/** Pool size — the legacy crowd cap. Instanced meshes allocate once at this size; the
 *  drawn count varies per frame via visiblePedCount. */
export const PED_POOL_CAP = 28;

/** Spec 137 — pedestrians share the citizens' 1.7 m adult silhouette, derived from the same
 *  metric (they were ~0.8 m — shorter even than the ~1 m citizens). `translateY` pre-lifts the
 *  torso and head so the figure's feet sit on the ground. */
const FIGURE = citizenFigure(CITIZEN_HEIGHT_M);
export const PED_BODY = { radius: FIGURE.bodyRadius, length: FIGURE.bodyLength, translateY: FIGURE.bodyLift };
export const PED_HEAD = { radius: FIGURE.headRadius, translateY: FIGURE.headLift };
/** Skin-tone head material (legacy 0xe0b48a); bodies carry the per-instance palette. */
export const PED_HEAD_COLOR = 0xe0b48a;

/** The six-color body palette, verbatim from the legacy renderer. */
export const PED_COLORS = [
  0xe06a4d, 0x4d8fe0, 0xe6c84d, 0x57b86a, 0xc9c2b6, 0xb47ad6,
] as const;

/** Body color for pool index i (wraps the palette). */
export function pedColorHex(i: number): number {
  return PED_COLORS[((i % PED_COLORS.length) + PED_COLORS.length) % PED_COLORS.length];
}

export interface Ped {
  x: number;
  y: number;
  /** current stroll target */
  tx: number;
  ty: number;
  /** stroll speed (cells/sec) */
  spd: number;
  /** bob phase */
  phase: number;
}

/** How many figures to draw this frame: one per real colonist, clamped to the pool. */
export function visiblePedCount(colonists: number, poolLen: number): number {
  return Math.max(0, Math.min(poolLen, Math.round(colonists)));
}

/** Seed a pool of figures on land near the landing. rand and onLand are injected so the
 *  seeding is pure and testable; the component passes a seeded RNG + a terrain predicate. */
export function initPedPool(
  landing: { x: number; y: number },
  rand: () => number,
  onLand: (x: number, y: number) => boolean,
  cap: number = PED_POOL_CAP,
): Ped[] {
  const peds: Ped[] = [];
  let guard = 0;
  while (peds.length < cap && guard++ < 800) {
    const a = rand() * Math.PI * 2;
    const r = 2 + rand() * 14;
    const x = landing.x + Math.cos(a) * r;
    const y = landing.y + Math.sin(a) * r;
    if (!onLand(x, y)) continue;
    peds.push({ x, y, tx: x, ty: y, spd: 0.5 + rand() * 0.7, phase: rand() * Math.PI * 2 });
  }
  return peds;
}

/** Pick a figure's next stroll target: a nearby road cell (keeps them on the pavement),
 *  nudged toward the kerb so they don't all walk the centre line. Falls back to a gentle
 *  wander near the landing before any streets exist. */
export function pickPedTarget(
  px: number,
  py: number,
  lx: number,
  ly: number,
  roadCells: readonly { x: number; y: number }[],
  rand: () => number,
  onLand: (x: number, y: number) => boolean,
): { x: number; y: number } {
  if (roadCells.length) {
    let near = roadCells.filter((c) => {
      const dd = Math.hypot(c.x - px, c.y - py);
      return dd > 1.5 && dd < 16;
    });
    if (!near.length) near = roadCells.slice();
    const c = near[(rand() * near.length) | 0]!;
    return { x: c.x + (rand() - 0.5) * 0.5, y: c.y + (rand() - 0.5) * 0.5 };
  }
  for (let tries = 0; tries < 8; tries++) {
    const ang = Math.atan2(ly - py, lx - px) + (rand() - 0.5) * Math.PI * 1.6;
    const step = 3 + rand() * 6;
    const nx = px + Math.cos(ang) * step;
    const ny = py + Math.sin(ang) * step;
    if (onLand(nx, ny) && Math.hypot(nx - lx, ny - ly) < 18) return { x: nx, y: ny };
  }
  return { x: px, y: py };
}

/** Advance one figure toward its target for dt seconds (re-targeting when it arrives),
 *  mutating it in place. Returns the heading and bob for this frame's transform. */
export function stepPed(
  p: Ped,
  dt: number,
  lx: number,
  ly: number,
  roadCells: readonly { x: number; y: number }[],
  rand: () => number,
  onLand: (x: number, y: number) => boolean,
): { heading: number; bob: number } {
  let dx = p.tx - p.x;
  let dy = p.ty - p.y;
  let d = Math.hypot(dx, dy);
  if (d < 0.4) {
    const next = pickPedTarget(p.x, p.y, lx, ly, roadCells, rand, onLand);
    p.tx = next.x;
    p.ty = next.y;
    dx = p.tx - p.x;
    dy = p.ty - p.y;
    d = Math.hypot(dx, dy);
  }
  if (d > 1e-3) {
    const move = Math.min(d, p.spd * dt);
    p.x += (dx / d) * move;
    p.y += (dy / d) * move;
    p.phase += dt * 8;
  }
  return { heading: Math.atan2(dy, dx), bob: Math.abs(Math.sin(p.phase)) * 0.05 };
}

export interface PedTransform {
  wx: number;
  wy: number;
  wz: number;
  rotY: number;
}

/** Grid cell -> world transform for one figure (same 4m grid + yaw convention as avatars);
 *  wy adds the frame's bob on top of the ground height. */
export function pedTransform(
  p: Ped,
  heading: number,
  bob: number,
  size: number,
  groundY: (x: number, y: number) => number,
): PedTransform {
  return {
    wx: (p.x - size / 2) * 4,
    wy: Math.max(0, groundY(Math.round(p.x), Math.round(p.y))) + bob,
    wz: (p.y - size / 2) * 4,
    rotY: -heading + Math.PI / 2,
  };
}

/** Small deterministic RNG (mulberry32) — pedestrians are decorative, not part of the
 *  deterministic sim, but a seeded stream keeps their motion reproducible across runs and
 *  keeps Math.random out of the render loop. */
export function makePedRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
