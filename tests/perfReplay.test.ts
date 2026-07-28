// Spec 158 — the replay contract. The whole investigation rests on "the same trace, twice",
// so the session's replay loop is driven here without a browser: feed it synthetic frames and
// check it advances the pose, discards the warm-up, and resolves with the measured window.
import { describe, it, expect, beforeEach } from "vitest";
import { PerfSession } from "../src/colony/perf/perfSession";
import { replayPose, setReplayPose } from "../src/colony/perf/replayBridge";
import { buildCanonicalTrace } from "../src/colony/perf/movementTrace";
import { emptySample, type FrameSample } from "../src/colony/perf/perfMonitor";

function frameAt(t: number, frameMs: number): FrameSample {
  return { ...emptySample(), t, frameMs };
}

describe("PerfSession replay", () => {
  beforeEach(() => setReplayPose(null));

  it("holds the start pose through the warm-up, then walks the trace and resolves", async () => {
    const session = new PerfSession();
    const trace = buildCanonicalTrace({
      origin: { x: 0, y: 2, z: 0 },
      durationMs: 300,
      stepMs: 100,
    });

    const done = session.runTrace(trace, 3);
    // runTrace parks the walker on frame 0 before any frame is seen.
    expect(replayPose()?.z).toBeCloseTo(0, 6);

    let t = 1000;
    const step = () => {
      t += 16;
      session.onFrame(frameAt(t, 16), null);
    };

    // Warm-up frames: the pose must not advance and the samples must be thrown away.
    step();
    step();
    step();
    expect(replayPose()?.z).toBeCloseTo(0, 6);
    expect(session.monitor.size).toBe(0);

    // Now it walks. 10 m/s along -Z.
    step();
    expect(replayPose()!.z).toBeLessThan(0);

    for (let i = 0; i < 40; i++) step();
    const result = await done;

    expect(result.frames).toBeGreaterThan(0);
    expect(result.durationMs).toBe(300);
    expect(result.stats.frameMeanMs).toBeCloseTo(16, 3);
    // The walker is handed back to live input the moment the trace ends.
    expect(replayPose()).toBeNull();
    expect(session.replaying).toBe(false);
  });

  it("refuses to start a second replay over a running one", async () => {
    const session = new PerfSession();
    const trace = buildCanonicalTrace({
      origin: { x: 0, y: 2, z: 0 },
      durationMs: 100,
      stepMs: 50,
    });
    const first = session.runTrace(trace, 0);
    await expect(session.runTrace(trace, 0)).rejects.toThrow(/already running/);
    session.cancelReplay();
    expect(replayPose()).toBeNull();
    void first;
  });

  it("records pose frames only while recording is armed", () => {
    const session = new PerfSession();
    const pose = {
      x: 1,
      y: 2,
      z: 3,
      yaw: 0,
      pitch: 0,
      input: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        sprint: false,
      },
      frameMs: 16,
      cpuMs: 1,
      drawMs: 2,
      gpuMs: -1,
      drawCalls: 10,
      triangles: 100,
    };
    session.onFrame(frameAt(0, 16), pose);
    expect(session.recorder.frameCount).toBe(0);
    session.recorder.start("t", 4242, 0);
    session.onFrame(frameAt(16, 16), pose);
    expect(session.recorder.frameCount).toBe(1);
    expect(session.recorder.stop().frames[0].x).toBe(1);
  });
});
