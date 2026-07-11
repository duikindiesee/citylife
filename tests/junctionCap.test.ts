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
  pointInConvexPoly,
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

describe("spec 137 — cap polygon", () => {
  it("a 90-degree cross yields a convex hull containing the full overlap square", () => {
    const [z] = zonesFor([straight(0, 50, 100, 50), straight(50, 0, 50, 100)]);
    const poly = z!.poly;
    expect(poly.length).toBeGreaterThanOrEqual(4);
    // the ribbon-overlap square is half x half around the centre — all inside
    for (const [dx, dy] of [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
      [0, 0],
    ] as const) {
      expect(pointInConvexPoly(z!.cx + dx, z!.cy + dy, poly)).toBe(true);
    }
  });

  it("a 45-degree crossing's hull contains the analytic overlap parallelogram", () => {
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
        expect(pointInConvexPoly(px, py, poly, 0.25)).toBe(true);
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

  it("hull corner cells beyond the plain arm sweep are included (the old float zone)", () => {
    const zones = zonesFor([
      straight(0, 50, 100, 50),
      straight(20, 20, 80, 80),
    ]);
    const cover = capCoverageCells(zones, fakeTerrain, roadY);
    const z = zones[0]!;
    // at least one covered cell farther than half+1 from BOTH centre-lines' axes
    let cornerCells = 0;
    for (const k of cover.keys()) {
      const c = k.indexOf(",");
      const x = +k.slice(0, c),
        y = +k.slice(c + 1);
      const d1 = Math.abs(y - z.cy); // distance from horizontal way
      const d2 = Math.abs((y - z.cy) - (x - z.cx)) / Math.SQRT2; // from diagonal way
      if (d1 > 2.5 && d2 > 2.5) cornerCells++;
    }
    expect(cornerCells).toBeGreaterThan(0);
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
