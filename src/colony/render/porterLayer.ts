// Spec 131 — the porter economy made visible (legacy spec 073): crates of materials and
// sacks of food piled at each Porter Shed, quantised to the live stock, and porter handcarts
// running the roads while the sheds are staffed. Pure node-testable math; the R3F component
// owns the meshes. Legacy-verbatim dimensions and colors.

export const PORTER_PILE_CAP = 320;
export const PORTER_CART_CAP = 28;
export const CRATE = { size: 0.34, lift: 0.17 } as const;
export const CART = {
  w: 0.42,
  h: 0.22,
  d: 0.3,
  lift: 0.14,
  color: 0x9a7a4a,
} as const;
export const PILE_COLORS = { materials: 0x8a6a3a, food: 0xcbb486 } as const;

export interface PileInstance {
  wx: number;
  wy: number;
  wz: number;
  color: number;
}

/** Units of crates/sacks for the live stock, capped at the pile budget. */
export function pileUnits(
  stock: number,
  perUnit: number,
  maxUnits: number,
): number {
  return Math.min(maxUnits, Math.floor(Math.max(0, stock) / perUnit));
}

/** Lay the pile instances for every shed: materials crates (brown) LEFT of the shed, food
 *  sacks (tan) RIGHT — a 3-wide grid growing away from the door, legacy-verbatim offsets. */
export function layPiles(
  sheds: { x: number; y: number }[],
  matUnits: number,
  foodUnits: number,
  size: number,
  groundY: (x: number, y: number) => number,
): PileInstance[] {
  const out: PileInstance[] = [];
  const wx = (x: number) => (x - size / 2) * 4;
  const wz = (y: number) => (y - size / 2) * 4;
  for (const shed of sheds) {
    const baseY = Math.max(0, groundY(shed.x, shed.y)) + 0.02;
    const lay = (units: number, ox: number, color: number) => {
      for (let u = 0; u < units && out.length < PORTER_PILE_CAP; u++) {
        const gx = u % 3;
        const gz = (u / 3) | 0;
        out.push({
          wx: wx(shed.x) + ox + gx * 0.36,
          wy: baseY,
          wz: wz(shed.y) + 0.7 + gz * 0.36,
          color,
        });
      }
    };
    lay(matUnits, -1.45, PILE_COLORS.materials);
    lay(foodUnits, 0.45, PILE_COLORS.food);
  }
  return out;
}

export interface PorterCart {
  x: number;
  y: number;
  tx: number;
  ty: number;
  spd: number;
}

/** A nearby ROAD cell to wander to — keeps carts on the pavement, never water. Scans the
 *  ±6-cell neighbourhood of the cart for road cells and picks one; stays put if the cart
 *  somehow has no road nearby. */
export function pickRoadTarget(
  roadSet: { has(k: string): boolean },
  cx: number,
  cy: number,
  rng: () => number,
): { x: number; y: number } {
  const options: { x: number; y: number }[] = [];
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (roadSet.has(`${ix + dx},${iy + dy}`))
        options.push({ x: ix + dx, y: iy + dy });
    }
  if (options.length === 0) return { x: cx, y: cy };
  return options[
    Math.min(options.length - 1, Math.floor(rng() * options.length))
  ]!;
}

/** Advance one cart one frame (legacy-verbatim): retarget when within 0.4 cells, else move
 *  at the cart's speed toward the target. Returns the travel heading. */
export function stepCart(
  cart: PorterCart,
  dt: number,
  roadSet: { has(k: string): boolean },
  rng: () => number,
): number {
  let dx = cart.tx - cart.x;
  let dy = cart.ty - cart.y;
  let d = Math.hypot(dx, dy);
  if (d < 0.4) {
    const next = pickRoadTarget(roadSet, cart.x, cart.y, rng);
    cart.tx = next.x;
    cart.ty = next.y;
    dx = cart.tx - cart.x;
    dy = cart.ty - cart.y;
    d = Math.hypot(dx, dy);
  }
  if (d > 1e-3) {
    const move = Math.min(d, cart.spd * dt);
    cart.x += (dx / d) * move;
    cart.y += (dy / d) * move;
  }
  return Math.atan2(dy, dx);
}
