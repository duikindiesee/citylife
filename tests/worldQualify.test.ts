import { describe, expect, it } from "vitest";
import {
  cellsFromRoad,
  qualifyWorld,
  tightestTurnRadius,
  type Pt,
  type QualifyInput,
} from "../src/colony/worldQualify";

// WORLD.SURVEY.1 — the harness decides whether a generated world is sound, so its verdicts have to
// be trustworthy in both directions: a clean world must pass, and each defect must be caught by the
// check that names it. These fixtures are hand-built rather than surveyed, because a booted world
// costs ~0.7 s and would make this suite a minute long for no extra confidence.

/** A tidy 20-cell east-west road with a route running straight down the middle of it. */
function cleanWorld(over: Partial<QualifyInput> = {}): QualifyInput {
  const roads = Array.from({ length: 20 }, (_, x) => ({ x, y: 10 }));
  const line: Pt[] = Array.from({ length: 20 }, (_, x) => ({ x, y: 10 }));
  return {
    seed: 1,
    gridSize: 64,
    roads,
    routeSamples: line,
    waySamples: [line],
    ribbonSamples: [line],
    hasDepot: true,
    loopCells: 20,
    stopCount: 4,
    ...over,
  };
}

const check = (q: ReturnType<typeof qualifyWorld>, id: string) =>
  q.checks.find((c) => c.id === id)!;

describe("nearest drivable cell", () => {
  const isRoad = (x: number, y: number) => x === 5 && y === 5;

  it("measures the real distance, not the cell index", () => {
    expect(cellsFromRoad(isRoad, 5, 5)).toBeCloseTo(0, 9);
    expect(cellsFromRoad(isRoad, 5, 7)).toBeCloseTo(2, 9);
    expect(cellsFromRoad(isRoad, 8, 9)).toBeCloseTo(5, 9);
  });

  it("saturates instead of scanning the whole grid for a hopeless sample", () => {
    expect(cellsFromRoad(isRoad, 500, 500, 6)).toBe(Infinity);
  });
});

describe("tightest turn radius", () => {
  it("reads a right angle over unit steps as a sub-cell radius", () => {
    const corner: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ];
    // one cell of arc through 90 degrees (pi/2 rad) => 1 / (pi/2)
    expect(tightestTurnRadius(corner)).toBeCloseTo(1 / (Math.PI / 2), 6);
  });

  it("is unbounded on a straight line — no curvature, no limit", () => {
    expect(
      tightestTurnRadius([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toBe(Infinity);
  });

  it("IGNORES near-coincident samples instead of dividing by them", () => {
    // A smoothed path packs vertices at every fillet. As a deg/cell RATE this reported 1142 on a
    // live seed — an artefact of the sampling step, not a turn anything takes. A radius cannot
    // blow up that way, and the packed samples are skipped outright.
    const packed: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1.02, y: 0.02 },
      { x: 1.04, y: 0.04 },
      { x: 2, y: 1 },
    ];
    // Every triple here touches a packed pair, so there is no measurable turn anywhere — and
    // "unbounded" is the honest answer. Inventing a tiny radius from a 0.028-cell step is exactly
    // the failure this replaced.
    expect(tightestTurnRadius(packed)).toBe(Infinity);
  });

  it("still finds a REAL turn that sits next to packed samples", () => {
    // ...and it must not go blind just because a fillet is nearby: the right angle at (4,0) is
    // measured on its own well-spaced samples.
    const mixed: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1.02, y: 0.01 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ];
    const r = tightestTurnRadius(mixed);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeCloseTo(1 / (Math.PI / 2), 6);
  });

  it("degrades safely on a path too short to have a turn", () => {
    expect(
      tightestTurnRadius([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toBe(Infinity);
  });

  it("calls a gentle sweep easier than a tight corner", () => {
    const tight: Pt[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ];
    const gentle: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 3 },
    ];
    expect(tightestTurnRadius(gentle)).toBeGreaterThan(
      tightestTurnRadius(tight),
    );
  });
});

describe("qualification verdicts", () => {
  it("passes a clean world on every blocking check", () => {
    const q = qualifyWorld(cleanWorld());
    expect(q.sound).toBe(true);
    expect(q.checks.filter((c) => !c.pass)).toEqual([]);
    expect(q.metrics.components).toBe(1);
    expect(q.metrics.largestComponentShare).toBe(1);
  });

  it("condemns a world that routes a loop but sites no depot", () => {
    const q = qualifyWorld(cleanWorld({ hasDepot: false }));
    expect(q.sound).toBe(false);
    expect(check(q, "transit-complete").pass).toBe(false);
    expect(check(q, "transit-complete").detail).toContain("NO DEPOT");
  });

  it("condemns a world with no route at all, without blaming the route check", () => {
    const q = qualifyWorld(cleanWorld({ routeSamples: null, hasDepot: false }));
    expect(check(q, "transit-complete").pass).toBe(false);
    // route-on-road is vacuous with no route — it must not double-report the same fault
    expect(check(q, "route-on-road").pass).toBe(true);
  });

  it("catches a route that leaves the carriageway", () => {
    const off = cleanWorld();
    off.routeSamples = [...off.routeSamples!, { x: 10, y: 18 }]; // 8 cells adrift
    const q = qualifyWorld(off);
    expect(q.sound).toBe(false);
    expect(check(q, "route-on-road").value).toBeCloseTo(8, 6);
  });

  it("catches a routed way with no drivable cells laid beneath it", () => {
    const gap = cleanWorld();
    gap.waySamples = [[...gap.waySamples[0]!, { x: 10, y: 21 }]];
    const q = qualifyWorld(gap);
    expect(q.sound).toBe(false);
    expect(check(q, "ways-have-cells").pass).toBe(false);
  });

  it("MEASURES the ribbon defect but does not condemn a seed for it", () => {
    // Known and tracked: every seed would fail it today, so blocking on it would rank nothing.
    const bowed = cleanWorld();
    bowed.ribbonSamples = [[...bowed.ribbonSamples[0]!, { x: 10, y: 25 }]];
    const q = qualifyWorld(bowed);
    expect(check(q, "ribbon-on-cells").pass).toBe(false);
    expect(check(q, "ribbon-on-cells").severity).toBe("known");
    expect(q.sound).toBe(true); // still sound — the defect is reported, not charged
    expect(q.metrics.worstRibbonOff).toBeGreaterThan(10);
  });

  it("catches a network that has split into islands", () => {
    const split = cleanWorld();
    split.roads = [...split.roads, { x: 50, y: 50 }, { x: 51, y: 50 }];
    const q = qualifyWorld(split);
    expect(q.sound).toBe(false);
    expect(check(q, "network-connected").pass).toBe(false);
    expect(q.metrics.components).toBe(2);
    expect(q.metrics.strandedCells).toBe(2);
  });

  it("counts connectivity against the real grid width, not a guessed one", () => {
    // roadComponents keys cells as y * gridSize + x; a wrong width silently collapses every cell
    // onto the same index and reports a perfectly connected world. Two rows that do NOT touch must
    // still read as two components.
    const q = qualifyWorld(
      cleanWorld({
        roads: [
          { x: 0, y: 0 },
          { x: 0, y: 5 },
        ],
        gridSize: 64,
      }),
    );
    expect(q.metrics.components).toBe(2);
  });
});
