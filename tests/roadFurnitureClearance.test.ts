// Spec 137 — junction furniture stays off the asphalt (the mid-road bus-stop / sign
// regression, operator screenshot 2026-07-10; fac1efa's adversarial-verify findings,
// re-pinned against the spec-137 v2 interface). Measured against REAL boot towns, not
// synthetic crossings: chained ways, curved corridors and 4-cell-wide side roads are
// where the old fixed offsets planted signs in the carriageway.
//
// Interface note (spec 137 v2): junctionFurniture(zone) is one-arg (arms carry their own
// ux/uy/half); stop BARS are no longer furniture items — they bake into the junction
// PAINT mesh via junctionCap.capStopBars on the approach half, so this file pins the
// STANDING furniture (traffic lights + stop signs) that must never occupy asphalt.
import { describe, it, expect } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { chaikin, densify } from "../src/colony/render/roadRibbon";
import {
  findJunctionZones,
  junctionFurniture,
} from "../src/colony/render/roadJunctions";

function distToPolyline(
  px: number,
  py: number,
  pts: { x: number; y: number }[],
): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i]!.x,
      ay = pts[i]!.y;
    const vx = pts[i + 1]!.x - ax,
      vy = pts[i + 1]!.y - ay;
    const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
    best = Math.min(best, Math.hypot(px - (ax + t * vx), py - (ay + t * vy)));
  }
  return best;
}

describe("spec 137 — boot-town furniture clearance", () => {
  for (const seed of [4242, 7, 1]) {
    it(`seed ${seed}: every signal + sign stands clear of every carriageway`, () => {
      const rt = new ColonyRuntime(seed);
      const ways = rt.sim.state.roadWays!;
      const smoothed = ways.map((w) =>
        w.path.length >= 2 ? densify(chaikin(w.path, 2), 1.5) : null,
      );
      // how many carriageways contain this point (with a small clearance margin)
      const containedBy = (px: number, py: number) => {
        let n = 0;
        smoothed.forEach((cp, wi) => {
          if (!cp) return;
          if (distToPolyline(px, py, cp) < ways[wi]!.width / 2 + 0.2) n++;
        });
        return n;
      };
      let signs = 0;
      let lights = 0;
      let crossZones = 0;
      let teeZones = 0;
      for (const zone of findJunctionZones(ways)) {
        if (zone.kind === "cross") crossZones++;
        if (zone.kind === "tee") teeZones++;
        const items = junctionFurniture(zone, ways);
        // a bend (elbow) is not a controlled junction — no furniture at all
        if (zone.kind === "bend") expect(items).toEqual([]);
        for (const f of items) {
          // a traffic light OR a stop sign NEVER stands on asphalt — anyone's
          expect(
            containedBy(f.x, f.y),
            `${f.kind} at ${f.x.toFixed(1)},${f.y.toFixed(1)} on a carriageway`,
          ).toBe(0);
          if (f.kind === "light") lights++;
          else if (f.kind === "stopsign") signs++;
        }
      }
      // Non-vacuity (fac1efa F1): the clearance bar must not be met by simply emitting
      // nothing. A cross gets a signal per arm; a tee gets a sign on its terminating arm.
      if (crossZones > 0) expect(lights).toBeGreaterThan(0);
      if (teeZones > 0) expect(signs).toBeGreaterThan(0);
    });
  }
});
