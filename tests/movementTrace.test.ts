// Spec 158 — record/replay. Replay is only worth anything if the same trace produces the
// same camera path every time, so the sampling and the angle interpolation are locked here.
import { describe, it, expect } from "vitest";
import {
  TraceRecorder,
  buildCanonicalTrace,
  lerpAngle,
  sampleTraceAt,
  traceDurationMs,
  type MovementTrace,
} from "../src/colony/perf/movementTrace";

function frame(t: number, x: number, yaw = 0) {
  return {
    t,
    x,
    y: 5,
    z: 0,
    yaw,
    pitch: 0,
    input: {
      forward: true,
      backward: false,
      left: false,
      right: false,
      sprint: false,
    },
    frameMs: 16,
    cpuMs: 4,
    drawMs: 3,
    gpuMs: -1,
    drawCalls: 100,
    triangles: 1000,
  };
}

const trace: MovementTrace = {
  version: 1,
  label: "t",
  createdAt: 0,
  seed: 4242,
  frames: [frame(0, 0), frame(100, 10), frame(200, 30)],
};

describe("sampleTraceAt", () => {
  it("clamps outside the trace instead of extrapolating off the island", () => {
    expect(sampleTraceAt(trace, -50)?.x).toBe(0);
    expect(sampleTraceAt(trace, 9999)?.x).toBe(30);
  });

  it("interpolates between the bracketing frames", () => {
    expect(sampleTraceAt(trace, 50)?.x).toBeCloseTo(5, 6);
    expect(sampleTraceAt(trace, 150)?.x).toBeCloseTo(20, 6);
  });

  it("is a pure function of time — two samples at the same t are identical", () => {
    const a = sampleTraceAt(trace, 137.5);
    const b = sampleTraceAt(trace, 137.5);
    expect(a).toEqual(b);
  });

  it("returns null for an empty trace", () => {
    expect(
      sampleTraceAt(
        { version: 1, label: "", createdAt: 0, seed: null, frames: [] },
        0,
      ),
    ).toBeNull();
  });
});

describe("lerpAngle", () => {
  it("takes the short way round ±pi", () => {
    // Naive lerp from 3.0 rad to -3.0 rad sweeps the camera through the whole world; the
    // short arc crosses pi and renders what the recording actually saw.
    const mid = lerpAngle(3.0, -3.0, 0.5);
    expect(Math.abs(mid)).toBeGreaterThan(3.0);
  });

  it("is the identity at k=0 and reaches the target at k=1", () => {
    expect(lerpAngle(0.3, 1.2, 0)).toBeCloseTo(0.3, 9);
    expect(lerpAngle(0.3, 1.2, 1)).toBeCloseTo(1.2, 9);
  });
});

describe("TraceRecorder", () => {
  it("stamps frames relative to the start and stops cleanly", () => {
    const recorder = new TraceRecorder();
    expect(recorder.recording).toBe(false);
    recorder.start("walk", 4242, 1000);
    recorder.capture(frame(0, 1), 1000);
    recorder.capture(frame(0, 2), 1016);
    const out = recorder.stop();
    expect(recorder.recording).toBe(false);
    expect(out.seed).toBe(4242);
    expect(out.frames.map((f) => f.t)).toEqual([0, 16]);
    expect(traceDurationMs(out)).toBe(16);
  });

  it("ignores captures while not recording", () => {
    const recorder = new TraceRecorder();
    recorder.capture(frame(0, 1), 0);
    expect(recorder.frameCount).toBe(0);
  });
});

describe("buildCanonicalTrace", () => {
  const options = {
    origin: { x: 10, y: 3, z: -5 },
    durationMs: 2000,
    speed: 10,
  };

  it("is byte-identical across builds, which is what makes an A/B comparison honest", () => {
    expect(buildCanonicalTrace(options)).toEqual(buildCanonicalTrace(options));
  });

  it("walks the configured distance in a straight line", () => {
    const t = buildCanonicalTrace(options);
    const last = t.frames[t.frames.length - 1];
    // 2 s at 10 m/s along -Z (startYaw 0).
    expect(last.z).toBeCloseTo(-5 - 20, 1);
    expect(last.x).toBeCloseTo(10, 6);
  });

  it("sweeps the yaw so the visible set churns rather than sitting still", () => {
    const t = buildCanonicalTrace({ ...options, durationMs: 4000 });
    const yaws = t.frames.map((f) => f.yaw);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(1.5);
  });
});
