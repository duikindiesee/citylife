// BUS.COLLIDE.1 — where a route doubles back, both directions must offset from the SHARED centre.
//
// THE DEFECT, measured on seed 1234 at sol minute 487. Two coaches on opposing legs of the same
// road (headings 24.3 deg and -155.6 deg, 180 apart):
//
//     centre-lines 1.82 cells apart   ->   after each kept left, 0.23 cells apart
//
// Both had the FULL 1.000 lane offset; nothing was clamped by curvature. `makeBusRoute` gives the
// out and back legs slightly different cell paths, so offsetting each from ITS OWN line
// double-counts a separation that already exists — and because the return leg lay on the outbound
// leg's LEFT, keeping left drove them together. 0.23 cells is inside a 0.625-cell-wide coach.
//
// Real left-hand traffic shares ONE carriageway centre and each direction keeps left of THAT, which
// is what puts opposing flows on opposite sides. That is now what the code does.
//
// REJECTED ALTERNATIVE, recorded so it is not retried: clamping the offset down at self-passes.
// It fixed the collision but removed lane keeping on most of the route — off-centre service poses
// fell from 82.3% to 19.1% — because these legs run close together for much of their length.
// Sharing the centre keeps the full offset AND separates the coaches.
import { describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { setSolDebugOffsetMs } from "../src/colony/solRuntimeClock";
import {
  CITYLIFE_EPOCH_MS,
  MS_PER_SOL,
  MINUTES_PER_SOL,
} from "../src/colony/sol";

/** Coach width in cells: 2.5 m / 4 m per cell. Two passing coaches need twice this. */
const TWO_COACHES_CELLS = 2 * (2.5 / 4);

type Probe = {
  busFleet: { buses: { id: number; mode: string }[] } | null;
  busPoseOf: (id: number) => { x: number; y: number; heading: number } | null;
};
type Driver = { transitTick: () => void };

describe("BUS.COLLIDE.1 — opposing legs of one route pass, not overlap", () => {
  it("seed 1234: the coaches that used to intersect now clear each other", () => {
    const rt = new ColonyRuntime(1234, { surveyOnly: true }) as never as Probe;
    let worst = Infinity;
    let opposing = false;
    let samples = 0;

    // Windowed around the known event so this stays a unit test rather than a full service sweep.
    for (let min = 400; min <= 520; min++) {
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
          const d = Math.hypot(
            poses[i]!.x - poses[j]!.x,
            poses[i]!.y - poses[j]!.y,
          );
          if (d < worst) {
            worst = d;
            let diff =
              Math.abs(
                ((poses[i]!.heading - poses[j]!.heading) * 180) / Math.PI,
              ) % 360;
            if (diff > 180) diff = 360 - diff;
            opposing = diff > 120;
          }
        }
    }
    setSolDebugOffsetMs(0);

    // Non-vacuity: the window must contain live service, and the closest pair must be the OPPOSING
    // one this fix addresses. Same-direction stacking is a separate defect (seeds 1 and 55 sit at
    // 0.00 cells travelling the same way — that is headway, not lane geometry, and is not fixed
    // here).
    expect(samples, "the window must contain live service").toBeGreaterThan(50);
    expect(
      opposing,
      "the closest pair must be opposing, or this is measuring the wrong defect",
    ).toBe(true);
    expect(
      worst,
      `closest opposing pair ${worst.toFixed(2)} cells, two coaches need ${TWO_COACHES_CELLS.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(TWO_COACHES_CELLS);
  }, 120_000);
});
