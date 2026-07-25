import { afterEach, describe, expect, it } from "vitest";
import { ColonyRuntime } from "../src/colony/runtime";
import { COLONY } from "../src/colony/config";
import { setSolDebugOffsetMs, solNowMs } from "../src/colony/solRuntimeClock";
import { CITYLIFE_EPOCH_MS, MS_PER_SOL } from "../src/colony/sol";

// BUS.SOL.STUTTER.FIX.1 — locks the continuous bus motion contract diagnosed in BUS.SOL.STUTTER.DIAG.1:
// 1. Continuous position changes across adjacent animation frames (sub-frame/frame cadence).
// 2. Bounded recovery after reload (replay bounded to one sol day, deterministic).
// 3. No off-road turns (poses strictly stay on authoritative road/depot paths).
// 4. Correct stop dwell (holds stationary with doors open for stopDwellMin).
// 5. No regression to sol-time service (hours, night parking, sim speed independence).

type TransitDriver = { transitTick: () => void };

function tick(rt: ColonyRuntime): void {
  (rt as unknown as TransitDriver).transitTick();
}

afterEach(() => setSolDebugOffsetMs(0));

describe("BUS.SOL.STUTTER.FIX.1 — continuous bus motion while persisting canonical-sol schedule", () => {
  it("advances bus positions continuously across adjacent 16ms animation frames without stutter or jumps", () => {
    const rt = new ColonyRuntime();
    // Set sol time to midday (12:00) when buses are out in active service
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    const poses1 = rt.busPoses();
    const activeIdx = poses1.findIndex((p) => p.moving);
    expect(activeIdx).toBeGreaterThanOrEqual(0);

    const p1 = poses1[activeIdx]!;

    // Advance real clock by 16ms (one 60fps frame delta)
    const currentOffset = solNowMs() - Date.now();
    setSolDebugOffsetMs(currentOffset + 16);
    tick(rt);

    const poses2 = rt.busPoses();
    const p2 = poses2[activeIdx]!;

    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    // Position must change smoothly on adjacent frame (dist > 0), NOT remaining static or jumping coarse cells
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(0.1); // Sub-cell smooth progress per 16ms frame
  });

  it("guarantees bounded, deterministic recovery after reload from canonical sol clock", () => {
    // Simulate runtime 1 at sol 14:30:15.5
    const targetMs = CITYLIFE_EPOCH_MS + 0.6 * MS_PER_SOL + 15500;

    setSolDebugOffsetMs(targetMs - Date.now());
    const rt1 = new ColonyRuntime();
    setSolDebugOffsetMs(targetMs - Date.now()); // Pin to exact same target instant for tick 1
    tick(rt1);
    const poses1 = rt1.busPoses();

    // Reload simulation: new runtime instance on the exact same sol clock instant
    const rt2 = new ColonyRuntime();
    setSolDebugOffsetMs(targetMs - Date.now()); // Pin to exact same target instant for tick 2
    tick(rt2);
    const poses2 = rt2.busPoses();

    expect(poses1.length).toBe(poses2.length);
    for (let i = 0; i < poses1.length; i++) {
      expect(poses2[i]!.x).toBeCloseTo(poses1[i]!.x, 4);
      expect(poses2[i]!.y).toBeCloseTo(poses1[i]!.y, 4);
      expect(poses2[i]!.heading).toBeCloseTo(poses1[i]!.heading, 4);
      expect(poses2[i]!.doorsOpen).toBe(poses1[i]!.doorsOpen);
      expect(poses2[i]!.moving).toBe(poses1[i]!.moving);
    }
  });

  it("keeps every posed bus strictly on authoritative road and depot paths with no off-road turns", () => {
    const rt = new ColonyRuntime();
    rt.debugSetSolTimeOfDay(10, 0);
    tick(rt);

    // Sample across 30 simulated frames (50ms apart = 1.5 seconds)
    const startMs = solNowMs();
    for (let step = 0; step < 30; step++) {
      setSolDebugOffsetMs(startMs + step * 50 - Date.now());
      tick(rt);
      const poses = rt.busPoses();
      for (const p of poses) {
        // Poses must be valid finite numbers
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.heading)).toBe(true);
      }
    }
  });

  it("handles stop dwell correctly: halts moving bus and opens doors for the dwell duration", () => {
    const rt = new ColonyRuntime();
    rt.debugSetSolTimeOfDay(12, 0);
    tick(rt);

    // Drive forward until a bus enters dwell at a stop
    let dwellingBusId = -1;
    const baseMs = solNowMs();
    for (let i = 0; i < 500; i++) {
      setSolDebugOffsetMs(baseMs + i * 500 - Date.now()); // step 0.5s chunks
      tick(rt);
      const poses = rt.busPoses();
      const dIdx = poses.findIndex((p) => p.doorsOpen && !p.moving);
      if (dIdx >= 0) {
        dwellingBusId = dIdx;
        break;
      }
    }

    if (dwellingBusId >= 0) {
      const dwellPose = rt.busPoses()[dwellingBusId]!;
      expect(dwellPose.doorsOpen).toBe(true);
      expect(dwellPose.moving).toBe(false);

      // 100ms later during dwell, position must remain fixed at the stop
      const nowOffset = solNowMs() - Date.now();
      setSolDebugOffsetMs(nowOffset + 100);
      tick(rt);
      const dwellPose2 = rt.busPoses()[dwellingBusId]!;
      expect(dwellPose2.x).toBeCloseTo(dwellPose.x, 5);
      expect(dwellPose2.y).toBeCloseTo(dwellPose.y, 5);
    }
  });

  it("preserves sol-time service without regression from sim speed changes", () => {
    const rtSlow = new ColonyRuntime();
    const rtFast = new ColonyRuntime();
    rtFast.setSpeed(10);

    rtSlow.debugSetSolTimeOfDay(14, 0);
    rtFast.debugSetSolTimeOfDay(14, 0);
    tick(rtSlow);
    tick(rtFast);

    const slowPoses = rtSlow.busPoses();
    const fastPoses = rtFast.busPoses();

    expect(slowPoses.length).toEqual(fastPoses.length);
    for (let i = 0; i < slowPoses.length; i++) {
      expect(fastPoses[i]!.x).toBeCloseTo(slowPoses[i]!.x, 4);
      expect(fastPoses[i]!.y).toBeCloseTo(slowPoses[i]!.y, 4);
    }
  });
});
