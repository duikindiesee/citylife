import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { roadRibbonRenderPath } from "../src/colony/render/roadRibbon";
import { inCorridor } from "../src/colony/transit/busFleet";

// BUS.ROUTE.GEOMETRY.1 — buses must stay on the paved carriageway through turns.
//
// Reference is the RENDERED ribbon path (roadRibbonRenderPath — the same chaikin/densify geometry
// the renderer extrudes the asphalt from), NOT the raw route loop. Measuring against the raw loop is
// invalid here: the bus legitimately follows a smoothed line, so a raw-loop deviation proves nothing.

const SEEDS = [4242, 1234];
/** Half the bus body across, in cells: 2.5 m wide / 4 m per cell / 2. */
const BUS_HALF_WIDTH_CELLS = 2.5 / 4 / 2;
/** Slack for ribbon station discretisation. */
const TOLERANCE_CELLS = 0.35;

function distToPolyline(pts: { x: number; y: number }[], px: number, py: number) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((px - a.x) * vx + (py - a.y) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t)));
  }
  return best;
}

/** Worst overhang of the bus body past the paved edge, in cells, over a full sol day. */
function worstOverhang(seed: number) {
  const rt = new ColonyRuntime(seed);
  const terrain = rt.sim.state.terrain;
  const ways = (rt.sim.state.roadWays ?? []).map((w) => ({
    pts: roadRibbonRenderPath(w, terrain),
    half: w.width / 2,
  }));
  expect(ways.length, "world has rendered ways").toBeGreaterThan(0);
  const tick = (rt as unknown as { transitTick: () => void }).transitTick.bind(rt);

  let worst = 0, at = "", samples = 0;
  for (let minute = 0; minute < 1440; minute += 10) {
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
      // Distance past the paved edge of the NEAREST way (a bus may be on any of them).
      let best = Infinity;
      for (const w of ways)
        best = Math.min(best, distToPolyline(w.pts, p.x, p.y) - w.half);
      const overhang = best + BUS_HALF_WIDTH_CELLS;
      if (overhang > worst) {
        worst = overhang;
        at = `bus at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) overhangs the paved edge by ${overhang.toFixed(2)} cells at sol ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
      }
    }
  }
  return { worst, at, samples };
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
});
