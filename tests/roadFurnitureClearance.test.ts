// Spec 127 — junction furniture stays off the asphalt (the mid-road bus-stop regression,
// operator screenshot 2026-07-10). Placement is measured against REAL boot towns, not just
// synthetic crossings: chained ways, curved corridors and 4-cell-wide side roads are where
// the old fixed offsets planted signs in the carriageway (measured: 8 of 12 stop lines and
// both stop signs on someone's asphalt in the seed-4242 town).
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

describe("spec 127 — boot-town furniture clearance", () => {
  for (const seed of [4242, 7, 1]) {
    it(`seed ${seed}: signs stand on no carriageway, paint lies on at most its own`, () => {
      const rt = new ColonyRuntime(seed);
      const ways = rt.sim.state.roadWays!;
      const smoothed = ways.map((w) =>
        w.path.length >= 2 ? densify(chaikin(w.path, 2), 1.5) : null,
      );
      // how many carriageways contain this point (with a small paint margin)
      const containedBy = (px: number, py: number) => {
        let n = 0;
        smoothed.forEach((cp, wi) => {
          if (!cp) return;
          if (distToPolyline(px, py, cp) < ways[wi]!.width / 2 + 0.2) n++;
        });
        return n;
      };
      let signs = 0;
      let lines = 0;
      let signEligibleArms = 0;
      for (const zone of findJunctionZones(ways)) {
        const items = junctionFurniture(zone, ways);
        // a merge or chain point is not a controlled junction — no furniture at all
        if (zone.kind === "pass") expect(items).toEqual([]);
        if (zone.kind === "tee") {
          // terminating arms WITHOUT an opposed terminating partner (those pairs are a
          // chained corridor flowing through) are where signs must appear
          const term = zone.arms.filter((a) => a.terminating);
          signEligibleArms += term.filter(
            (a) => !term.some((b) => b !== a && a.dx * b.dx + a.dy * b.dy < -0.95),
          ).length;
        }
        for (const f of items) {
          if (f.kind === "stopsign") {
            signs++;
            // a sign NEVER stands on asphalt — anyone's
            expect(containedBy(f.x, f.y), `sign at ${f.x},${f.y}`).toBe(0);
          } else if (f.kind === "stopline") {
            lines++;
            // paint belongs to exactly one road: its own approach lane — verified by
            // attribution, not just count (adversarial verify F1 vacuity fix)
            expect(
              containedBy(f.x, f.y),
              `line at ${f.x},${f.y}`,
            ).toBeLessThanOrEqual(1);
            const own = smoothed[f.wayIndex!];
            expect(own, `line at ${f.x},${f.y} carries wayIndex`).toBeTruthy();
            expect(
              distToPolyline(f.x, f.y, own!),
              `line at ${f.x},${f.y} sits on its OWN carriageway`,
            ).toBeLessThan(ways[f.wayIndex!]!.width / 2);
          }
        }
      }
      // the towns must still HAVE controlled-junction furniture — the fix must not
      // simply delete every item to pass the clearance bar. Signs are pinned wherever a
      // genuine tee approach exists (adversarial verify F1: the first cut silently deleted
      // every boot-town sign and the count-free assertions passed vacuously).
      expect(lines).toBeGreaterThan(0);
      if (signEligibleArms > 0) expect(signs).toBeGreaterThan(0);
    });
  }
});
