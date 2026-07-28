// Spec 158 — the frame-statistics maths. A stutter investigation that quotes wrong numbers
// is worse than one that quotes none, so the percentile / 1%-low / shadow-split arithmetic is
// locked here rather than trusted.
import { describe, it, expect } from "vitest";
import {
  PerfMonitor,
  emptySample,
  low1Fps,
  percentile,
  summarize,
  type FrameSample,
} from "../src/colony/perf/perfMonitor";

function sample(overrides: Partial<FrameSample>): FrameSample {
  return { ...emptySample(), ...overrides };
}

describe("percentile", () => {
  it("uses nearest rank over a sorted array", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile(sorted, 100)).toBe(10);
  });

  it("returns 0 for an empty window rather than NaN", () => {
    expect(percentile([], 99)).toBe(0);
  });
});

describe("low1Fps", () => {
  it("reports the worst 1% of frames, not the average", () => {
    // 99 comfortable frames at 10 ms and one 200 ms hitch. Mean fps is ~52 and looks fine;
    // the 1% low is the number that exposes the hitch.
    const frames = [...Array(99).fill(10), 200];
    expect(low1Fps(frames)).toBeCloseTo(1000 / 200, 5);
  });

  it("always takes at least one frame", () => {
    expect(low1Fps([20])).toBeCloseTo(50, 5);
  });
});

describe("summarize", () => {
  it("separates shadow-pass frames from the rest", () => {
    // The periodic-hitch signature: every 4th frame re-renders the shadow map and costs 5x.
    const samples: FrameSample[] = [];
    for (let i = 0; i < 40; i++) {
      const shadow = i % 4 === 0;
      samples.push(
        sample({ t: i * 16, frameMs: shadow ? 40 : 8, shadowPass: shadow }),
      );
    }
    const stats = summarize(samples);
    expect(stats.shadowFrames).toBe(10);
    expect(stats.shadowFrameMeanMs).toBeCloseTo(40, 5);
    expect(stats.nonShadowFrameMeanMs).toBeCloseTo(8, 5);
    // p50 sits with the cheap frames while p99 sits with the hitch — exactly the shape a
    // "the average FPS looks fine but it feels awful" report has.
    expect(stats.frameP50Ms).toBe(8);
    expect(stats.frameP99Ms).toBe(40);
    expect(stats.spikeCount).toBe(10);
  });

  it("ignores unavailable gpu / physics readings instead of averaging in -1", () => {
    const stats = summarize([
      sample({ frameMs: 10, gpuMs: -1, physicsMs: -1 }),
      sample({ frameMs: 10, gpuMs: 4, physicsMs: 2 }),
    ]);
    expect(stats.gpuMeanMs).toBeCloseTo(4, 5);
    expect(stats.physicsMeanMs).toBeCloseTo(2, 5);
  });

  it("reports zeroes for an empty window", () => {
    const stats = summarize([]);
    expect(stats.frames).toBe(0);
    expect(stats.fpsMean).toBe(0);
    expect(stats.gpuMeanMs).toBe(-1);
  });
});

describe("PerfMonitor", () => {
  it("keeps the newest samples once the ring wraps", () => {
    const monitor = new PerfMonitor(4);
    for (let i = 0; i < 10; i++) monitor.push(sample({ t: i, frameMs: i }));
    expect(monitor.size).toBe(4);
    expect(monitor.samples().map((s) => s.t)).toEqual([6, 7, 8, 9]);
  });

  it("does not alias the caller's sample object", () => {
    const monitor = new PerfMonitor(2);
    const reused = sample({ frameMs: 1 });
    monitor.push(reused);
    reused.frameMs = 999;
    monitor.push(reused);
    expect(monitor.samples().map((s) => s.frameMs)).toEqual([1, 999]);
  });

  it("windows stats to the last n frames", () => {
    const monitor = new PerfMonitor(100);
    for (let i = 0; i < 100; i++)
      monitor.push(sample({ t: i, frameMs: i < 50 ? 100 : 10 }));
    expect(monitor.stats(50).frameMeanMs).toBeCloseTo(10, 5);
    expect(monitor.stats().frameMeanMs).toBeCloseTo(55, 5);
  });
});
