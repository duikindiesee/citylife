// BUS.COLLIDE.1 (same-direction half) — a coach must not drive into the back of the one ahead.
//
// THE DEFECT. Departures were spaced by the dispatch gate — the next bus leaves once the previous
// clears its 2nd stop — and NOTHING held them apart afterwards. A bus that has completed a LAP can
// therefore land exactly on one that has just come out of the depot, and joining set `lapT = 0`
// unconditionally, so the newcomer was placed at the join whatever was standing there.
//
// MEASURED on main, both coaches dwelling at the same stop, 0.00 cells apart:
//
//   seed  1  sol 448  loopLen 1094.8   bus0 lapT 1204.14 (lap 1) -> 109.34 on the loop
//                                      bus4 lapT  109.33 (lap 0) -> 109.33
//   seed 55  sol 359  loopLen 2024.7   bus0 lapT 2049.13 (lap 1) ->  24.43
//                                      bus4 lapT   24.40 (lap 0) ->  24.40
//
// NOT THE SAME DEFECT AS PR 465. There the coaches were 315 cells apart ALONG the route and only
// close in space, because the route doubled back on itself — a following distance cannot see that,
// and a headway rule provably did nothing. Here they are genuinely adjacent in the queue, which is
// exactly what a following distance is for. Both halves were needed.
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { setSolDebugOffsetMs } from "../src/colony/solRuntimeClock";
import {
  CITYLIFE_EPOCH_MS,
  MS_PER_SOL,
  MINUTES_PER_SOL,
} from "../src/colony/sol";

/** A coach is 12 m = 3 cells long. Nose to tail, same-direction centres need at least that. */
const COACH_LENGTH_CELLS = 3;

type Probe = {
  busFleet: { buses: { id: number; mode: string }[] } | null;
  busPoseOf: (id: number) => { x: number; y: number; heading: number } | null;
};
type Driver = { transitTick: () => void };

/** Closest approach between two buses travelling in the SAME direction, over a sol-minute window. */
function closestSameDirection(seed: number, fromMin: number, toMin: number) {
  const rt = new ColonyRuntime(seed, { surveyOnly: true }) as never as Probe;
  let worst = Infinity;
  let samples = 0;
  for (let min = fromMin; min <= toMin; min++) {
    setSolDebugOffsetMs(
      CITYLIFE_EPOCH_MS + (min * MS_PER_SOL) / MINUTES_PER_SOL - Date.now(),
    );
    (rt as unknown as Driver).transitTick();
    const svc = rt.busFleet?.buses.filter((b) => b.mode === "service") ?? [];
    if (svc.length < 2) continue;
    samples++;
    const poses = svc.map((b) => rt.busPoseOf(b.id)).filter(Boolean) as {
      x: number;
      y: number;
      heading: number;
    }[];
    for (let i = 0; i < poses.length; i++)
      for (let j = i + 1; j < poses.length; j++) {
        let diff =
          Math.abs(((poses[i]!.heading - poses[j]!.heading) * 180) / Math.PI) %
          360;
        if (diff > 180) diff = 360 - diff;
        if (diff > 60) continue; // opposing or crossing — PR 465's geometry, not headway
        const d = Math.hypot(
          poses[i]!.x - poses[j]!.x,
          poses[i]!.y - poses[j]!.y,
        );
        if (d < worst) worst = d;
      }
  }
  setSolDebugOffsetMs(0);
  return { worst, samples };
}

describe("BUS.COLLIDE.1 — coaches keep a following distance", () => {
  // Windowed around each seed's known event so this stays a unit test.
  for (const [seed, from, to] of [
    [1, 400, 500],
    [55, 320, 400],
  ] as const) {
    it(`seed ${seed}: a lapped coach does not land on a freshly dispatched one`, () => {
      const { worst, samples } = closestSameDirection(seed, from, to);

      // Non-vacuity: the window must contain at least two buses in service, or there is no pair to
      // measure and the assertion below would pass on an empty road.
      expect(samples, "the window must contain live service").toBeGreaterThan(
        30,
      );

      // `worst` stays Infinity if no same-direction pair ever appeared, which is also a pass — the
      // defect is same-direction overlap, and none is none.
      if (worst !== Infinity) {
        expect(
          worst,
          `closest same-direction pair ${worst.toFixed(2)} cells, a coach is ${COACH_LENGTH_CELLS}`,
        ).toBeGreaterThanOrEqual(COACH_LENGTH_CELLS);
      }
    }, 120_000);
  }
});
