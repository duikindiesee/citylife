// RUNTIME.BOOTORDER — the fleet must dwell where the ANCHORS say, not where a second projection
// of its own says.
//
// This is the boot-ordering invariant for transit, and it is the same shape as the defect
// TRANSIT.COMPLETE.1 (PR 454) fixed: a later step deriving its own answer to a question an earlier
// step had already settled. `computeBusStopAnchors` resolves WHERE A BUS STOPS — sliding a halt
// along the route when its raw projection lands inside a junction cap (BUS.STOP.CLEAR.1). If
// `makeFleetGeometry` is then allowed to re-project the authored stop cells, the coach dwells in
// the crossroads while its pole stands metres up the road, which is the three-unreconciled-points
// fault BUS.BOARD.1 exists to prevent, reintroduced from the other side.
//
// runtime.ts gets this right today — it computes the anchors first and passes their arcs in — but
// nothing asserted it, so the ordering could be undone by deleting one argument.
//
// VERIFIED TO DISCRIMINATE: dropping the `stopArcs` argument at the call site makes this fail on
// every seed below. It is not a vacuous restatement of the code, because the anchored arc really
// does differ from the raw projection: measured, at least one stop per seed moves, by 5.0 to 11.5
// cells (11.5 cells is ~46 m of road). The final assertion in each case pins that non-vacuity, so
// if junction-sliding ever stops mattering this test says so out loud instead of passing silently.
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { busLoopPath, projectPath } from "../src/colony/transit/path";

const SEEDS = [4242, 7, 42, 1, 55, 77];

type Probe = {
  busRoute: { loop: unknown; stops: { x: number; y: number }[] } | null;
  stopAnchors: { arc: number }[] | null;
  fleetGeom: { stopsFromJoin: number[]; joinT: number; loopLen: number } | null;
};

/** The same normalisation makeFleetGeometry applies: distance after the join, ascending. */
function fromJoin(arcs: number[], joinT: number, loopLen: number): number[] {
  return arcs
    .map((s) => (((s - joinT) % loopLen) + loopLen) % loopLen)
    .filter((d) => d > 1e-6)
    .sort((a, b) => a - b);
}

describe("bus fleet geometry is built from the stop anchors", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: the fleet dwells at the anchored arcs, not at re-projected cells`, () => {
      const rt = new ColonyRuntime(seed, {
        surveyOnly: true,
      }) as never as Probe;

      // Guard against a vacuous pass on a seed that happens to have no transit at all.
      expect(rt.busRoute, `seed ${seed} must route a bus loop`).not.toBeNull();
      expect(
        rt.stopAnchors,
        `seed ${seed} must resolve stop anchors`,
      ).not.toBeNull();
      expect(
        rt.fleetGeom,
        `seed ${seed} must build fleet geometry`,
      ).not.toBeNull();

      const { joinT, loopLen, stopsFromJoin } = rt.fleetGeom!;
      const expected = fromJoin(
        rt.stopAnchors!.map((a) => a.arc),
        joinT,
        loopLen,
      );

      expect(stopsFromJoin.length, `seed ${seed}: one dwell per anchor`).toBe(
        expected.length,
      );
      stopsFromJoin.forEach((got, i) => {
        expect(
          Math.abs(got - expected[i]!),
          `seed ${seed}: dwell ${i} must sit on its anchor, not on a re-projection`,
        ).toBeLessThan(1e-6);
      });

      // NON-VACUITY: at least one anchor must actually differ from the raw projection of its
      // authored cell. Without this, a world where junction-sliding never fires would let the
      // assertions above pass even if the fleet re-projected, and the test would prove nothing.
      const loop = busLoopPath(rt.busRoute!.loop as never);
      const moved = rt.busRoute!.stops.filter(
        (c, i) =>
          Math.abs(rt.stopAnchors![i]!.arc - projectPath(loop, c as never)) >
          1e-6,
      );
      expect(
        moved.length,
        `seed ${seed}: at least one stop must have been slid clear of a junction, ` +
          `otherwise anchors and projections agree and this test cannot discriminate`,
      ).toBeGreaterThan(0);
    });
  }
});
