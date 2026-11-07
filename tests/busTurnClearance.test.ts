import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { roadRibbonRenderPath } from "../src/colony/render/roadRibbon";
import { solDebugOffsetMs, setSolDebugOffsetMs } from "../src/colony/solRuntimeClock";
import { inCorridor } from "../src/colony/transit/busFleet";

// BUS.ROUTE.GEOMETRY.1 — buses must stay on the paved carriageway through turns.
//
// Reference is the RENDERED ribbon path (roadRibbonRenderPath — the same chaikin/densify geometry
// the renderer extrudes the asphalt from), NOT the raw route loop. Measuring against the raw loop is
// invalid here: the bus legitimately follows a smoothed line, so a raw-loop deviation proves nothing.

const SEEDS = [4242, 1234];
/** Full 12m coach length and 2.5m coach width in cells (1 cell = 4m). */
const BUS_HALF_LENGTH_CELLS = 12 / 4 / 2; // 1.5 cells
const BUS_HALF_WIDTH_CELLS = 2.5 / 4 / 2; // 0.3125 cells
/** Slack for ribbon station discretisation. */
const TOLERANCE_CELLS = 0.35;

function distToPolyline(pts: { x: number; y: number }[], px: number, py: number) {
  if (!pts || pts.length < 2) return Infinity;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return Infinity;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      continue;
    }
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((px - a.x) * vx + (py - a.y) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t)));
  }
  return best;
}

/** 7 key perimeter points of the oriented 12m x 2.5m bus body: 4 corners, front/rear bumpers, centre. */
export function orientedBusBodyPoints(p: { x: number; y: number; heading: number }): { x: number; y: number }[] {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.heading)) {
    throw new Error(`Non-finite bus pose: (${p.x}, ${p.y}, ${p.heading})`);
  }
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  const hl = BUS_HALF_LENGTH_CELLS;
  const hw = BUS_HALF_WIDTH_CELLS;
  return [
    { x: p.x, y: p.y }, // centre
    { x: p.x + c * hl - s * hw, y: p.y + s * hl + c * hw }, // front-left corner
    { x: p.x + c * hl + s * hw, y: p.y + s * hl - c * hw }, // front-right corner
    { x: p.x - c * hl - s * hw, y: p.y - s * hl + c * hw }, // rear-left corner
    { x: p.x - c * hl + s * hw, y: p.y - s * hl - c * hw }, // rear-right corner
    { x: p.x + c * hl, y: p.y + s * hl },                   // front bumper centre
    { x: p.x - c * hl, y: p.y - s * hl },                   // rear bumper centre
  ];
}

/** Worst overhang of any oriented bus body point past the paved edge, in cells, over a full sol day. */
function worstOverhang(seed: number) {
  const rt = new ColonyRuntime(seed);
  const initialOffsetMs = solDebugOffsetMs();

  try {
    const terrain = rt.sim.state.terrain;
    const ways = (rt.sim.state.roadWays ?? [])
      .filter((w) => Number.isFinite(w.width) && w.width > 0)
      .map((w) => {
        const pts = roadRibbonRenderPath(w, terrain);
        if (!pts || pts.length < 2) throw new Error("Invalid road ribbon render path");
        return {
          pts,
          half: w.width / 2,
        };
      });
    expect(ways.length, "world has valid rendered ways with positive finite width").toBeGreaterThan(0);
    const tick = (rt as unknown as { transitTick: () => void }).transitTick.bind(rt);

    let worst = 0, at = "", samples = 0;
    // Sample every 5 minutes across the full 1440-minute sol day for dense turn analysis
    for (let minute = 0; minute < 1440; minute += 5) {
      rt.debugSetSolTimeOfDay(Math.floor(minute / 60), minute % 60);
      tick();
      const poses = rt.busPoses();
      const buses = rt.busFleet!.buses;
      for (let i = 0; i < poses.length; i++) {
        const mode = buses[i]!.mode;
        // Depot pad, bays and gate spur are legitimately off the public ways.
        if (mode === "parked" || inCorridor(mode)) continue;
        const p = poses[i]!;
        samples++;
        const points = orientedBusBodyPoints(p);
        for (const pt of points) {
          if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
            throw new Error(`Non-finite bus body point: (${pt.x}, ${pt.y})`);
          }
          let best = Infinity;
          for (const w of ways) {
            const d = distToPolyline(w.pts, pt.x, pt.y);
            if (!Number.isFinite(d)) {
              throw new Error(`Non-finite distance to polyline for point (${pt.x}, ${pt.y})`);
            }
            const excess = d - w.half;
            if (!Number.isFinite(excess)) {
              throw new Error(`Non-finite clearance calculation for point (${pt.x}, ${pt.y})`);
            }
            best = Math.min(best, excess);
          }
          if (!Number.isFinite(best)) {
            throw new Error(`Failed to calculate best clearance for point (${pt.x}, ${pt.y})`);
          }
          if (best > worst) {
            worst = best;
            at = `bus corner at (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}) overhangs paved edge by ${best.toFixed(2)} cells at sol ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
          }
        }
      }
    }
    return { worst, at, samples, ways };
  } finally {
    // Teardown: restore canonical sol clock authority
    setSolDebugOffsetMs(initialOffsetMs);
  }
}

describe("bus footprint stays on the carriageway through turns", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: no bus body leaves the paved surface`, () => {
      const { worst, at, samples } = worstOverhang(seed);
      expect(samples, "in-service poses sampled").toBeGreaterThan(0);
      console.log(`seed ${seed}: ${samples} samples, worst overhang ${worst.toFixed(2)} cells`);
      expect(worst <= TOLERANCE_CELLS ? "on road" : `seed ${seed}: ${at} (limit ${TOLERANCE_CELLS})`).toBe("on road");
    });
  }

  it("discriminates off-road negative bus pose and on-road centre with off-road corner", () => {
    const rt = new ColonyRuntime(4242);
    const terrain = rt.sim.state.terrain;
    const ways = (rt.sim.state.roadWays ?? [])
      .filter((w) => Number.isFinite(w.width) && w.width > 0)
      .map((w) => ({
        pts: roadRibbonRenderPath(w, terrain),
        half: w.width / 2,
      }));
    expect(ways.length).toBeGreaterThan(0);

    // 1. Fabricated bus placed far off-road at (10, 10)
    const offRoadPose = { x: 10, y: 10, heading: 0 };
    const pointsOff = orientedBusBodyPoints(offRoadPose);
    let bestOff = Infinity;
    for (const w of ways) {
      const d = distToPolyline(w.pts, pointsOff[0]!.x, pointsOff[0]!.y);
      expect(Number.isFinite(d)).toBe(true);
      bestOff = Math.min(bestOff, d - w.half);
    }
    expect(Number.isFinite(bestOff)).toBe(true);
    expect(bestOff).toBeGreaterThan(5);

    // 2. Discriminating counterexample: centre is on-road within corridor bounds,
    // but an oriented 12m x 2.5m corner swings off-road outside the paved carriageway.
    // Pick the first straight segment of a known way
    const way = ways[0]!;
    const p0 = way.pts[0]!;
    const p1 = way.pts[1]!;
    const wayHeading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    // Place bus centre near the curb (e.g. half - 0.2 cells from center)
    const normalX = -Math.sin(wayHeading);
    const normalY = Math.cos(wayHeading);
    const centreX = p0.x + normalX * (way.half - 0.2);
    const centreY = p0.y + normalY * (way.half - 0.2);

    // Orient bus across the road (perpendicular heading): heading = wayHeading + Math.PI / 2
    const turningPose = { x: centreX, y: centreY, heading: wayHeading + Math.PI / 2 };
    const turningPoints = orientedBusBodyPoints(turningPose);

    // Verify centre point (points[0]) is strictly ON-ROAD:
    let centreExcess = Infinity;
    for (const w of ways) {
      centreExcess = Math.min(centreExcess, distToPolyline(w.pts, turningPoints[0]!.x, turningPoints[0]!.y) - w.half);
    }
    expect(centreExcess, "bus centre is on-road within corridor").toBeLessThanOrEqual(0);

    // Verify oriented corner (points[1..4], e.g. front or rear overhang of 6m / 1.5 cells) swings OFF-ROAD:
    let worstCornerExcess = -Infinity;
    for (const pt of turningPoints.slice(1)) {
      let ptMinDist = Infinity;
      for (const w of ways) {
        ptMinDist = Math.min(ptMinDist, distToPolyline(w.pts, pt.x, pt.y) - w.half);
      }
      worstCornerExcess = Math.max(worstCornerExcess, ptMinDist);
    }
    expect(worstCornerExcess, "oriented corner swings off-road outside paved carriageway").toBeGreaterThan(0.5);
  });
});
