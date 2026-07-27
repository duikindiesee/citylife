import { describe, expect, it } from "vitest";
import {
  buildStop,
  stopVergeDirection,
  STOP_VERGE_OFFSET_CELLS,
} from "../src/colony/render/busLayer";
import { CELL_SIZE } from "../src/colony/scale";

// ROAD.JUNCTIONS.1 — bus stops must stand on the VERGE, never in the drive lane.
//
// Route roads are authored 4 cells (16 m) wide, so the carriageway reaches 2.0 cells either side of
// the centre-line. The old renderer nudged the pole a fixed +3.2 world metres along +Z regardless of
// the road's heading: inside the carriageway on ANY orientation, and pointing straight down the lane
// on a north-south road. These lock the corrected contract on both orientations.

const CARRIAGEWAY_HALF_CELLS = 2.0;

/** Straight closed loops through a stop at (10,10), one per orientation. */
const eastWestLoop = [
  { x: 6, y: 10 },
  { x: 10, y: 10 },
  { x: 14, y: 10 },
  { x: 14, y: 20 },
  { x: 6, y: 20 },
];
const northSouthLoop = [
  { x: 10, y: 6 },
  { x: 10, y: 10 },
  { x: 10, y: 14 },
  { x: 20, y: 14 },
  { x: 20, y: 6 },
];
const stop = { x: 10, y: 10 };

const identityOpts = {
  wx: (x: number) => x * CELL_SIZE,
  wz: (y: number) => y * CELL_SIZE,
  roadY: () => 0,
};

/** Perpendicular distance, in cells, from the stop's road axis to the rendered stop group. */
function offAxisCells(
  group: { position: { x: number; z: number } },
  axis: "x" | "y",
): number {
  const gx = group.position.x / CELL_SIZE;
  const gy = group.position.z / CELL_SIZE;
  // For an east-west road the lane runs along x, so the useful clearance is across y (and vice versa).
  return axis === "x" ? Math.abs(gy - stop.y) : Math.abs(gx - stop.x);
}

describe("ROAD.JUNCTIONS.1 — bus stops sit on the verge, not the carriageway", () => {
  it("offsets perpendicular to an east-west road", () => {
    const dir = stopVergeDirection(eastWestLoop, stop);
    // Road runs along x → verge direction must be purely across y.
    expect(Math.abs(dir.x)).toBeCloseTo(0, 9);
    expect(Math.abs(dir.y)).toBeCloseTo(1, 9);
  });

  it("offsets perpendicular to a north-south road (the orientation that broke)", () => {
    const dir = stopVergeDirection(northSouthLoop, stop);
    // Road runs along y → verge direction must be purely across x. The old fixed +Z nudge failed
    // exactly here: it pointed ALONG this lane.
    expect(Math.abs(dir.y)).toBeCloseTo(0, 9);
    expect(Math.abs(dir.x)).toBeCloseTo(1, 9);
  });

  it("clears the carriageway on BOTH orientations", () => {
    for (const [loop, axis] of [
      [eastWestLoop, "x"],
      [northSouthLoop, "y"],
    ] as const) {
      const g = buildStop(identityOpts, stop, stopVergeDirection(loop, stop));
      expect(offAxisCells(g, axis)).toBeGreaterThan(CARRIAGEWAY_HALF_CELLS);
    }
  });

  it("keeps the offset clear of the authored 4-cell carriageway with kerb margin", () => {
    expect(STOP_VERGE_OFFSET_CELLS).toBeGreaterThan(CARRIAGEWAY_HALF_CELLS);
    // The old 3.2 m nudge was inside the lane — guard the regression numerically.
    expect(STOP_VERGE_OFFSET_CELLS * CELL_SIZE).toBeGreaterThan(3.2);
  });

  it("puts no residual offset in the pole/sign local transforms", () => {
    // The lane-relative correction must live in the group placement, not a hardcoded child nudge.
    const g = buildStop(identityOpts, stop, stopVergeDirection(eastWestLoop, stop));
    for (const child of g.children) {
      expect(child.position.z).toBeCloseTo(0, 9);
      expect(child.position.x).toBeCloseTo(0, 9);
    }
  });

  it("is deterministic and falls back safely on a degenerate loop", () => {
    const a = stopVergeDirection(northSouthLoop, stop);
    const b = stopVergeDirection(northSouthLoop, stop);
    expect(a).toEqual(b);
    expect(stopVergeDirection([], stop)).toEqual({ x: 0, y: 1 });
    expect(stopVergeDirection([stop], stop)).toEqual({ x: 0, y: 1 });
    expect(stopVergeDirection([stop, stop], stop)).toEqual({ x: 0, y: 1 });
  });
});
