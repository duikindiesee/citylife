// Spec 131 — the porter economy layer: pile quantisation + legacy-verbatim layout, and the
// cart wander that keeps to the pavement.
import { describe, it, expect } from "vitest";
import {
  pileUnits,
  layPiles,
  pickRoadTarget,
  stepCart,
  PILE_COLORS,
  PORTER_PILE_CAP,
  type PorterCart,
} from "../src/colony/render/porterLayer";

describe("spec 131 — porter piles", () => {
  it("quantises stock to units with a floor and a cap", () => {
    expect(pileUnits(0, 8, 12)).toBe(0);
    expect(pileUnits(7, 8, 12)).toBe(0);
    expect(pileUnits(16, 8, 12)).toBe(2);
    expect(pileUnits(9999, 8, 12)).toBe(12); // capped
    expect(pileUnits(-5, 8, 12)).toBe(0); // never negative
  });

  it("lays materials crates LEFT (brown) and food sacks RIGHT (tan) in a 3-wide grid", () => {
    const shed = { x: 100, y: 100 };
    const piles = layPiles([shed], 4, 2, 200, () => 3);
    expect(piles.length).toBe(6);
    const mats = piles.filter((p) => p.color === PILE_COLORS.materials);
    const food = piles.filter((p) => p.color === PILE_COLORS.food);
    expect(mats.length).toBe(4);
    expect(food.length).toBe(2);
    const wx = (100 - 100) * 4; // shed at grid centre -> world 0
    // first materials crate at ox -1.45; 4th wraps to the second row (gx 0, gz 1)
    expect(mats[0]!.wx).toBeCloseTo(wx - 1.45, 6);
    expect(mats[3]!.wz).toBeCloseTo(0.7 + 0.36, 6);
    // food offset +0.45
    expect(food[0]!.wx).toBeCloseTo(wx + 0.45, 6);
    // everything sits on the ground + 0.02
    for (const p of piles) expect(p.wy).toBeCloseTo(3.02, 6);
  });

  it("never exceeds the pile budget", () => {
    const sheds = Array.from({ length: 10 }, (_, i) => ({ x: i * 5, y: 50 }));
    const piles = layPiles(sheds, 320, 320, 200, () => 1);
    expect(piles.length).toBe(PORTER_PILE_CAP);
  });
});

describe("spec 131 — porter carts", () => {
  const roadSet = new Set<string>(["10,10", "11,10", "12,10"]);

  it("wander targets are always road cells; stays put with no road nearby", () => {
    for (let i = 0; i < 10; i++) {
      const t = pickRoadTarget(roadSet, 11, 10, () => i / 10);
      expect(roadSet.has(`${t.x},${t.y}`)).toBe(true);
    }
    const lost = pickRoadTarget(roadSet, 100, 100, () => 0.5);
    expect(lost).toEqual({ x: 100, y: 100 });
  });

  it("moves toward its target at speed and retargets on arrival", () => {
    const cart: PorterCart = { x: 10, y: 10, tx: 12, ty: 10, spd: 1 };
    const heading = stepCart(cart, 0.5, roadSet, () => 0);
    expect(cart.x).toBeCloseTo(10.5, 6); // spd 1 * dt 0.5 along +x
    expect(cart.y).toBeCloseTo(10, 6);
    expect(heading).toBeCloseTo(0, 6);
    // park it on the target: the next step retargets to a road cell
    cart.x = 12;
    cart.y = 10;
    stepCart(cart, 1 / 60, roadSet, () => 0.99);
    expect(roadSet.has(`${cart.tx},${cart.ty}`)).toBe(true);
  });
});
