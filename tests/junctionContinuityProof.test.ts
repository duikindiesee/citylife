import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import {
  findJunctionZones,
  type JunctionZone,
} from "../src/colony/render/roadJunctions";
import { attachCapPolys } from "../src/colony/render/junctionCap";

// Proof that EVERY intersection in a live world is continuous: each junction gets a cap polygon,
// and every arm mouth is actually covered by that cap. A gap between an arm's mouth and the cap hull
// is exactly the "broken / interrupted intersection" the operator reported walking the world — the
// asphalt stops before the junction and open ground shows through.
//
// Seed-agnostic and exhaustive: it sweeps every junction of every seeded world, not a sample.

const SEEDS = [4242, 7, 99, 1234];

/** Winding-number point-in-polygon (handles the concave hulls a 4+-arm cap can produce). */
function inside(poly: { x: number; y: number }[], px: number, py: number) {
  let wn = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && side > 0) wn++;
    } else if (b.y <= py && side < 0) wn--;
  }
  return wn !== 0;
}

interface Gap {
  seed: number;
  zone: number;
  arm: number;
  mouth: { x: number; y: number };
}

function junctionsOf(seed: number): JunctionZone[] {
  const rt = new ColonyRuntime(seed);
  return attachCapPolys(findJunctionZones(rt.sim.state.roadWays ?? []));
}

describe("every rendered intersection is continuous (no arm gaps)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: every junction caps every one of its arms`, () => {
      const zones = junctionsOf(seed);
      expect(zones.length, "world has junctions to prove").toBeGreaterThan(0);

      const missingCap: number[] = [];
      const gaps: Gap[] = [];
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z]!;
        const poly = zone.poly;
        if (!poly || poly.length < 3) {
          missingCap.push(z);
          continue;
        }
        // Each arm's mouth is where the cap must hand over to the ordinary ribbon. If the mouth is
        // outside the cap hull the asphalt is interrupted there.
        for (let a = 0; a < zone.arms.length; a++) {
          const arm = zone.arms[a]!;
          const mx = zone.cx + arm.ux * (arm.mouthD - 0.25);
          const my = zone.cy + arm.uy * (arm.mouthD - 0.25);
          if (!inside(poly, mx, my))
            gaps.push({ seed, zone: z, arm: a, mouth: { x: mx, y: my } });
        }
      }

      expect(
        missingCap.length === 0
          ? "all capped"
          : `seed ${seed}: ${missingCap.length}/${zones.length} junctions have no cap polygon (zones ${missingCap.slice(0, 5).join(",")})`,
      ).toBe("all capped");

      const worst = gaps[0];
      expect(
        worst
          ? `seed ${seed}: ${gaps.length} arm mouth(s) fall outside their junction cap — first at zone ${worst.zone} arm ${worst.arm} (${worst.mouth.x.toFixed(2)}, ${worst.mouth.y.toFixed(2)})`
          : "continuous",
      ).toBe("continuous");
    });
  }

  it("junction geometry is deterministic for a seed", () => {
    const a = junctionsOf(SEEDS[0]!);
    const b = junctionsOf(SEEDS[0]!);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.cx).toBeCloseTo(b[i]!.cx, 9);
      expect(a[i]!.cy).toBeCloseTo(b[i]!.cy, 9);
      expect(a[i]!.arms.length).toBe(b[i]!.arms.length);
    }
  });
});
