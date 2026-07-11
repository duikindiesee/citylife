// Spec 137 — the draped junction cap. The invariants that killed the slab: the cap can
// neither FLOAT (every vertex is roadY + CAP_LIFT by construction) nor STEP (arms enter
// at a 25 mm paint lip), it contains the ribbon-overlap region on diagonal crossings,
// and its coverage cells feed the grading so no corner apron hangs over ungraded ground.
import { describe, it, expect } from "vitest";
import type { RoadWay } from "../src/colony/render/roadRibbon";
import { findJunctionZones } from "../src/colony/render/roadJunctions";
import {
  attachCapPolys,
  buildJunctionCaps,
  capCoverageCells,
  capPolygon,
  CAP_LIFT,
  pointInPoly,
  sanitizeCapPoly,
} from "../src/colony/render/junctionCap";
import { signalState } from "../src/colony/render/roadFurniture";

// A synthetic sloped, ALL-LAND terrain: worldY = x*0.1 + y*0.05 (asymmetric on purpose).
const fakeTerrain = {
  size: 200,
  inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < 200 && y < 200,
  idx: (x: number, y: number) => y * 200 + x,
  biome: new Uint8Array(200 * 200).fill(3), // Biome.Plains (not water)
  water: new Uint8Array(200 * 200),
  buildable: new Uint8Array(200 * 200).fill(1),
} as any;
const roadY = (x: number, y: number) => x * 0.1 + y * 0.05;
const opts = {
  terrain: fakeTerrain,
  wx: (x: number) => x * 4,
  wz: (y: number) => y * 4,
  roadY,
};

const straight = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width = 4,
): RoadWay => ({
  path: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
  kind: "street",
  width,
});

const zonesFor = (ways: RoadWay[]) => attachCapPolys(findJunctionZones(ways));

describe("spec 137 cap-quality — sanitizeCapPoly", () => {
  const selfIntersects = (poly: { x: number; y: number }[]): boolean => {
    const n = poly.length;
    const cross = (a: any, b: any, c: any, d: any) => {
      const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) return false;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
      const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
      return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
    };
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (cross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]))
          return true;
      }
    return false;
  };

  it("leaves a valid concave plus-shape (a real 90-degree cross) untouched", () => {
    const [z] = zonesFor([straight(0, 50, 100, 50), straight(50, 0, 50, 100)]);
    const before = z!.poly.map((p) => ({ ...p }));
    const after = sanitizeCapPoly(before);
    expect(after.length).toBe(before.length); // no dedup, no hull fallback
    expect(selfIntersects(after)).toBe(false);
  });

  it("repairs a self-intersecting / near-duplicate degenerate outline via the convex hull", () => {
    // the shallow-crossing mess measured live at seed 4242 Z0: zigzag + duplicate points
    const bad = [
      { x: 491.6, y: 364.0 }, { x: 492.6, y: 367.9 }, { x: 492.1, y: 365.1 },
      { x: 492.5, y: 369.1 }, { x: 487.1, y: 369.5 }, { x: 482.9, y: 372.9 },
      { x: 480.4, y: 369.8 }, { x: 482.9, y: 372.8 }, { x: 480.4, y: 369.7 },
      { x: 485.4, y: 365.7 },
    ];
    expect(selfIntersects(bad)).toBe(true); // the raw outline is broken
    const fixed = sanitizeCapPoly(bad);
    expect(fixed.length).toBeGreaterThanOrEqual(3);
    expect(selfIntersects(fixed)).toBe(false); // repaired into a simple polygon
  });
});

describe("spec 137 — cap polygon (exact carriageway union)", () => {
  it("a 90-degree cross is the exact plus-shape: overlap paved, corner fields NOT", () => {
    const [z] = zonesFor([straight(0, 50, 100, 50), straight(50, 0, 50, 100)]);
    const poly = z!.poly;
    expect(poly.length).toBeGreaterThanOrEqual(8); // 4 mouth edges + 4 kerb corners
    // the ribbon-overlap square (h=2 both ways) is fully paved
    for (const [dx, dy] of [
      [-1.8, -1.8],
      [1.8, -1.8],
      [1.8, 1.8],
      [-1.8, 1.8],
      [0, 0],
      [2.5, 0], // inside the east arm past the overlap
      [0, -2.5],
    ] as const) {
      expect(pointInPoly(z!.cx + dx, z!.cy + dy, poly)).toBe(true);
    }
    // the exact-union directive: the diagonal corner FIELDS the old convex hull paved
    // are OUTSIDE the pad — the boundary follows the kerb lines, not chords.
    for (const [dx, dy] of [
      [2.6, 2.6],
      [-2.6, 2.6],
      [2.6, -2.6],
      [-2.6, -2.6],
    ] as const) {
      expect(pointInPoly(z!.cx + dx, z!.cy + dy, poly)).toBe(false);
    }
  });

  it("cap side edges are COLLINEAR with the arms' kerb lines", () => {
    const [z] = zonesFor([straight(0, 50, 100, 50), straight(50, 0, 50, 100)]);
    const poly = z!.poly;
    // every polygon vertex lies on SOME arm's kerb line (|perp offset| == half) or on a
    // mouth edge (distance along the arm == mouthD) — nothing is invented geometry.
    for (const p of poly) {
      let onRoadEdge = false;
      for (const a of z!.arms) {
        const rx = p.x - z!.cx,
          ry = p.y - z!.cy;
        const across = Math.abs(rx * -a.uy + ry * a.ux);
        const along = rx * a.ux + ry * a.uy;
        if (Math.abs(across - a.half) < 1e-6 && along > -a.half - 1.5) onRoadEdge = true;
        if (Math.abs(along - a.mouthD) < 1e-6 && across <= a.half + 1e-6) onRoadEdge = true;
      }
      expect(onRoadEdge).toBe(true);
    }
  });

  it("a 45-degree crossing's pad contains the analytic overlap parallelogram", () => {
    const [z] = zonesFor([straight(0, 50, 100, 50), straight(20, 20, 80, 80)]);
    expect(z).toBeTruthy();
    const poly = z!.poly;
    // overlap of two 2-cell-half corridors crossing at ~45deg: extent along each axis is
    // h/sin(45) ~= 2.83. Sample the parallelogram interior.
    const u1 = { x: 1, y: 0 };
    const u2 = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    for (let s = -0.9; s <= 0.9; s += 0.3) {
      for (let t = -0.9; t <= 0.9; t += 0.3) {
        const px = z!.cx + u1.x * s * 2.8 + u2.x * t * 2.8;
        const py = z!.cy + u1.y * s * 2.8 + u2.y * t * 2.8;
        expect(pointInPoly(px, py, poly)).toBe(true);
      }
    }
  });
});

describe("spec 137 — cap drape (no float, no step, by construction)", () => {
  it("every cap vertex sits at roadY + CAP_LIFT on sloped ground", () => {
    const zones = zonesFor([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 100),
    ]);
    const { surf } = buildJunctionCaps(zones, opts);
    expect(surf.length).toBeGreaterThan(0);
    for (let i = 0; i < surf.length; i += 3) {
      const gx = surf[i]! / 4,
        gy = surf[i + 2]! / 4;
      const expected = Math.max(0, roadY(gx, gy)) + CAP_LIFT;
      expect(Math.abs(surf[i + 1]! - expected)).toBeLessThan(1e-6);
    }
  });

  it("junction paint (zebras + stop bars + kerb lines) drapes above the cap", () => {
    const zones = zonesFor([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 100),
    ]);
    const { paint } = buildJunctionCaps(zones, opts);
    expect(paint.length).toBeGreaterThan(0);
    for (let i = 0; i < paint.length; i += 3) {
      const gx = paint[i]! / 4,
        gy = paint[i + 2]! / 4;
      const over = paint[i + 1]! - (Math.max(0, roadY(gx, gy)) + CAP_LIFT);
      expect(over).toBeGreaterThan(0.02);
      expect(over).toBeLessThan(0.06);
    }
  });
});

describe("spec 137 — cap coverage feeds the grading", () => {
  it("every rasterized hull cell is present at its road height", () => {
    const zones = zonesFor([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 100),
    ]);
    const cover = capCoverageCells(zones, fakeTerrain, roadY);
    expect(cover.size).toBeGreaterThan(10);
    const z = zones[0]!;
    // the centre cell and the mouth cells are covered
    expect(cover.has(`${Math.round(z.cx)},${Math.round(z.cy)}`)).toBe(true);
    for (const [k, h] of cover) {
      const c = k.indexOf(",");
      expect(h).toBeCloseTo(
        Math.max(0, roadY(+k.slice(0, c), +k.slice(c + 1))),
        6,
      );
    }
  });

  it("coverage never leaves the carriageways: every cell hugs some arm's corridor", () => {
    // The exact-union directive inverted the old hull expectation: coverage must NOT
    // include corner fields beyond the kerb lines (the sprawling graded aprons the
    // operator called an antipattern).
    const zones = zonesFor([
      straight(0, 50, 100, 50),
      straight(20, 20, 80, 80),
    ]);
    const cover = capCoverageCells(zones, fakeTerrain, roadY);
    const z = zones[0]!;
    for (const k of cover.keys()) {
      const c = k.indexOf(",");
      const x = +k.slice(0, c),
        y = +k.slice(c + 1);
      let nearArm = false;
      for (const a of z.arms) {
        const rx = x - z.cx,
          ry = y - z.cy;
        const across = Math.abs(rx * -a.uy + ry * a.ux);
        const along = rx * a.ux + ry * a.uy;
        if (across <= a.half + 1.2 && along >= -a.half - 1.2 && along <= a.mouthD + 1.2)
          nearArm = true;
      }
      expect(nearArm).toBe(true);
    }
  });
});

describe("spec 137 — signal phasing", () => {
  it("never both groups green; all-red inter-green at both changeovers", () => {
    for (let t = 0; t < 16; t += 0.05) {
      const a = signalState(t, "A");
      const b = signalState(t, "B");
      expect(a === "green" && b === "green").toBe(false);
      expect(a === "amber" && b !== "red").toBe(false);
      expect(b === "amber" && a !== "red").toBe(false);
    }
    // and each group DOES get a green
    expect(signalState(1, "A")).toBe("green");
    expect(signalState(9, "B")).toBe("green");
  });
});

describe("spec 137 — stale-way fail-soft", () => {
  it("a zone centred on water emits no cap geometry but keeps the build alive", () => {
    const wet = {
      ...fakeTerrain,
      biome: new Uint8Array(200 * 200).fill(0), // Biome.Ocean everywhere
    } as any;
    const zones = zonesFor([
      straight(0, 50, 100, 50),
      straight(50, 0, 50, 100),
    ]);
    const { surf } = buildJunctionCaps(zones, { ...opts, terrain: wet });
    expect(surf.length).toBe(0);
  });
});
