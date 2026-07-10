import { describe, expect, it } from "vitest";
import { Terrain } from "../src/colony/terrain";
import { RNG } from "../src/engine/rng";
import {
  padSeatY,
  RENDER_DRY_FLOOR,
} from "../src/colony/render/useTerrainLeveling";

// Spec 128 follow-up — the legacy PlanetRenderer dedup. The legacy renderer carried private
// copies of the continuous ground sampler (groundY: corner-clamped bilinear with a zero
// floor, plus the inline bilinear inside smoothRoadY) and the pad-seat formula. Before those
// delegate to the shared Terrain.worldYAt / padSeatY, this test pins that the shared helpers
// are EXACT drop-ins — including out-of-range positions, where the implementations clamp
// differently (legacy clamps the four corner indices; worldYAt clamps the position itself).
// The reference below IS the old formula, kept verbatim as the contract.
function legacyGroundY(t: Terrain, x: number, y: number): number {
  const cl = (v: number) => Math.max(0, Math.min(t.size - 1, v));
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    tx = x - x0,
    ty = y - y0;
  const a = t.worldY(cl(x0), cl(y0)),
    b = t.worldY(cl(x0 + 1), cl(y0));
  const c = t.worldY(cl(x0), cl(y0 + 1)),
    d = t.worldY(cl(x0 + 1), cl(y0 + 1));
  return Math.max(
    0,
    a * (1 - tx) * (1 - ty) +
      b * tx * (1 - ty) +
      c * (1 - tx) * ty +
      d * tx * ty,
  );
}

const t = new Terrain(new RNG(4242));

describe("legacy PlanetRenderer ground sampling — shared-helper parity", () => {
  it("max(0, worldYAt) equals the legacy corner-clamped bilinear across a dense sweep", () => {
    const last = t.size - 1;
    for (let i = 0; i < 400; i++) {
      // Deterministic pseudo-sweep across the island, quarter-cell resolution.
      const x = ((i * 97) % (last * 4)) / 4;
      const y = ((i * 61) % (last * 4)) / 4;
      expect(Math.max(0, t.worldYAt(x, y))).toBeCloseTo(
        legacyGroundY(t, x, y),
        10,
      );
    }
  });

  it("agrees at and beyond the grid edges where the two clamp differently", () => {
    const last = t.size - 1;
    const probes: Array<[number, number]> = [
      [-0.5, 10.25],
      [10.25, -0.5],
      [-3, -3],
      [last + 0.5, 20.75],
      [20.75, last + 0.5],
      [last + 4, last + 4],
      [0, 0],
      [last, last],
      [last - 0.5, last - 0.5],
    ];
    for (const [x, y] of probes) {
      expect(Math.max(0, t.worldYAt(x, y))).toBeCloseTo(
        legacyGroundY(t, x, y),
        10,
      );
    }
  });

  it("padSeatY equals the legacy seat formula on homestead and commercial shapes", () => {
    // Even widths make the centre fractional — the exact shape the R3F port got wrong.
    const rects = [
      { x: 100, y: 100, w: 4, h: 6 },
      { x: 251, y: 133, w: 5, h: 5 },
      { x: 40, y: 300, w: 8, h: 3 },
      { x: 0, y: 0, w: 2, h: 2 },
    ];
    for (const r of rects) {
      const legacySeat = Math.max(
        legacyGroundY(t, r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2),
        RENDER_DRY_FLOOR,
      );
      expect(padSeatY(t, r.x, r.y, r.w, r.h)).toBeCloseTo(legacySeat, 10);
    }
  });
});
