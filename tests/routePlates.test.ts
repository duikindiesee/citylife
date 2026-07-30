import { describe, expect, it } from "vitest";
import {
  cellField,
  closedPath,
  excursionSpan,
  fit,
  plateProfile,
  plateScaling,
  polyline,
  svgDoc,
  worstOf,
  type Pt,
  type RouteMeasure,
} from "../src/colony/render/routePlates";

// BUS.ROUTE.TURN.1 — the plate renderer is evidence, so the evidence has to be trustworthy: a plate
// that silently clips a path, mis-scales a chart, or draws a straight line where the route left the
// window would misrepresent the geometry it claims to show. These cover the parts that can lie.
// The world-booting shell (scripts/busRoutePlates.ts) is deliberately not exercised here — it is a
// CLI over these functions and costs seconds per seed.

const square: Pt[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("plate projection", () => {
  it("fits the extent with padding and keeps aspect square for a square input", () => {
    const f = fit(square, 2, 700);
    // 10 cells + 2 padding each side = 14 across, mapped onto 700px
    expect(f.scale).toBeCloseTo(50, 6);
    expect(f.width).toBe(700);
    expect(f.height).toBe(700);
    expect(f.X(0)).toBe("100.0"); // 2 cells of pad in
    expect(f.Y(10)).toBe("600.0");
  });

  it("reports what is inside the window, so callers can break paths at the edge", () => {
    const f = fit(square, 0, 100);
    expect(f.contains({ x: 5, y: 5 })).toBe(true);
    expect(f.contains({ x: -0.01, y: 5 })).toBe(false);
    expect(f.contains({ x: 5, y: 10.01 })).toBe(false);
  });

  it("refuses an empty extent rather than emitting a NaN viewBox", () => {
    expect(() => fit([], 1, 100)).toThrow();
  });

  it("survives a degenerate single-point extent", () => {
    const f = fit([{ x: 4, y: 4 }], 1, 200);
    expect(Number.isFinite(f.scale)).toBe(true);
    expect(f.width).toBeGreaterThan(0);
  });
});

describe("plate paths", () => {
  it("BREAKS a polyline at the window edge instead of chording across the plate", () => {
    const f = fit(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      0,
      100,
    );
    // out, in, in, out, in, in — two separate runs, never joined
    const pts: Pt[] = [
      { x: -5, y: 5 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 40, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
    ];
    const out = polyline(pts, f, "#fff", 2);
    expect(out.match(/<polyline/g)).toHaveLength(2);
    expect(out).not.toContain("40");
  });

  it("drops runs of a single point (a lone vertex is not a line)", () => {
    const f = fit(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      0,
      100,
    );
    const out = polyline(
      [
        { x: -1, y: 5 },
        { x: 5, y: 5 },
        { x: -1, y: 5 },
      ],
      f,
      "#fff",
      2,
    );
    expect(out).toBe("");
  });

  it("emits the cell field as ONE path, and omits it entirely when nothing is in frame", () => {
    const f = fit(square, 0, 100);
    const filled = cellField(square, f, "#123456");
    expect(filled.match(/<path/g)).toHaveLength(1);
    expect(filled.match(/M/g)!.length).toBe(4); // one subpath per cell
    expect(cellField([{ x: 99, y: 99 }], f, "#123456")).toBe("");
  });

  it("closes the motion path so <animateMotion> loops without a seam", () => {
    const f = fit(square, 0, 100);
    const d = closedPath(square, f);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(closedPath([{ x: 1, y: 1 }], f)).toBe("");
  });
});

describe("plate documents", () => {
  it("wraps a well-formed, self-contained SVG root", () => {
    const doc = svgDoc(120, 80, "<g></g>");
    expect(doc).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(doc).toContain('viewBox="0 0 120 80"');
    expect(doc.endsWith("</svg>")).toBe(true);
    // no external references — these get inlined into pages with a strict CSP
    expect(doc).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("escapes caption text so a stray angle bracket cannot break the document", () => {
    const m = profileFixture([1, 2], [1, 1]);
    const doc = plateProfile({ ...m, seed: 42 });
    expect(doc).not.toContain(
      '<text x="78" y="34" font-size="24" fill="#e6ebf2">SEED 42 <',
    );
    expect(doc).toContain("SEED 42");
  });
});

function profileFixture(
  beforeDist: number[],
  afterDist: number[],
): RouteMeasure {
  const pts = beforeDist.map((_, i) => ({ x: i, y: 0 }));
  return {
    seed: 1,
    cells: pts,
    before: pts,
    after: pts,
    beforeDist,
    afterDist,
  };
}

describe("profile chart", () => {
  it("scales to the worst excursion so a big one is never clipped off the top", () => {
    const doc = plateProfile(profileFixture([0, 14.04, 0], [0, 1.5, 0]));
    // the y axis top is driven by the data, so the peak stays inside the plot box
    const ys = [...doc.matchAll(/(\d+\.\d),(\d+\.\d)/g)].map((m) =>
      Number(m[2]),
    );
    expect(Math.min(...ys)).toBeGreaterThan(40); // above the title band, below the frame top
  });

  it("draws the kerb reference at the carriageway half-width", () => {
    const doc = plateProfile(profileFixture([0, 3, 0], [0, 1, 0]), 2);
    expect(doc).toContain("kerb — 2 cells");
  });

  it("refuses a lap it cannot plot", () => {
    expect(() => plateProfile(profileFixture([1], [1]))).toThrow();
  });
});

describe("scaling plate", () => {
  it("shows a proportional cut growing with the arms while a capped cut stays put", () => {
    // the real rule: a quarter of the segment, unless that exceeds maxCut cells
    const cut = (bend: Pt[], maxCut: number): Pt[] => {
      let pts = bend;
      for (let i = 0; i < 3; i++) {
        const out: Pt[] = [pts[0]!];
        for (let j = 0; j < pts.length - 1; j++) {
          const a = pts[j]!,
            b = pts[j + 1]!;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const f = len > 1e-9 ? Math.min(0.25, maxCut / len) : 0;
          out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
          out.push({ x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
        }
        out.push(pts[pts.length - 1]!);
        pts = out;
      }
      return pts;
    };
    const doc = plateScaling([8, 20, 40], cut, 1);
    const quarter = [...doc.matchAll(/quarter-cut: ([\d.]+) cells off/g)].map(
      (m) => Number(m[1]),
    );
    const capped = [...doc.matchAll(/capped: ([\d.]+) cells off/g)].map((m) =>
      Number(m[1]),
    );
    expect(quarter).toHaveLength(3);
    // THE POINT OF THE PLATE: one grows with the arms, the other does not.
    expect(quarter[1]!).toBeGreaterThan(quarter[0]!);
    expect(quarter[2]!).toBeGreaterThan(quarter[1]!);
    expect(Math.max(...capped) - Math.min(...capped)).toBeLessThan(0.15);
    expect(Math.max(...capped)).toBeLessThanOrEqual(1);
  });
});

describe("excursion span", () => {
  const spanFixture = (dist: number[]): RouteMeasure => ({
    seed: 1,
    cells: [],
    before: dist.map((_, i) => ({ x: i, y: 0 })),
    after: dist.map((_, i) => ({ x: i, y: 0 })),
    beforeDist: dist,
    afterDist: dist.map(() => 0),
  });

  it("takes the CONTIGUOUS run around the worst point, not first-to-last on the lap", () => {
    // two separate bad bends: one small at the start, the real one at the end. Spanning
    // first-to-last would frame the entire circuit and show nothing.
    const s = excursionSpan(spanFixture([3, 3, 0, 0, 0, 0, 0, 9, 8, 0]), 2);
    expect(s.points).toHaveLength(2); // indices 7 and 8, the run holding the peak
    expect(s.from).toBeCloseTo(0.7, 6);
    expect(s.to).toBeCloseTo(0.8, 6);
  });

  it("reports nothing to frame when the route never leaves the paved surface", () => {
    expect(excursionSpan(spanFixture([0.4, 1.1, 0.9]), 2).points).toEqual([]);
  });

  it("survives an empty measure", () => {
    expect(excursionSpan(spanFixture([]), 2).points).toEqual([]);
  });
});

describe("worst-point search", () => {
  it("returns the position of the largest distance, not just the value", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 9, y: 9 },
    ];
    expect(worstOf(pts, [0.2, 8.9, 1.1])).toEqual({ d: 8.9, x: 5, y: 5 });
  });

  it("degrades safely on an empty measure", () => {
    expect(worstOf([], [])).toEqual({ d: 0, x: 0, y: 0 });
  });
});
