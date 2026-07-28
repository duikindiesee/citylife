// Spec 158 — the frame-timing ring buffer and the statistics the HUD and the measurement
// harness both read.
//
// Framework-agnostic on purpose (no three, no React, no DOM): the stats maths is the part a
// wrong answer would poison, so it has to be unit-testable in node. The renderer-facing glue
// lives in src/colony/render/R3FPerfProbe.tsx.
//
// WHY 1% LOWS AND NOT AVERAGE FPS: "jittery" is a complaint about the WORST frames, not the
// mean. A scene that renders 58 frames in 8 ms and 2 frames in 90 ms reports a comfortable
// ~62 fps average and feels broken. p99 frame time and the 1% low are the numbers that move
// when a stutter is fixed, so they are what this module reports first.

/** One frame's worth of measurements. All times in milliseconds. */
export interface FrameSample {
  /** performance.now() at the start of the frame. */
  t: number;
  /** Wall-clock gap to the previous frame start — what the player actually feels. */
  frameMs: number;
  /** Wall time from the start of the frame callbacks to the first draw submission: every
   *  useFrame body, the physics step, and anything the runtime's own rAF ran in between. */
  cpuMs: number;
  /** CPU spent inside the renderer draw submission (renderer.render + post passes). */
  drawMs: number;
  /** GPU time for the frame from EXT_disjoint_timer_query_webgl2, or -1 when unavailable. */
  gpuMs: number;
  /** Physics world step cost, or -1 when not instrumented. */
  physicsMs: number;
  /** three.js WebGLRenderer.info.render.calls for the frame. */
  drawCalls: number;
  /** three.js WebGLRenderer.info.render.triangles for the frame. */
  triangles: number;
  /** Whether the shadow map was re-rendered on this frame. */
  shadowPass: boolean;
}

export interface PerfStats {
  frames: number;
  /** Seconds covered by the retained window. */
  windowSec: number;
  fpsMean: number;
  /** Mean fps over the worst 1% of frames — the "1% low". */
  fpsLow1: number;
  frameMeanMs: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  frameMaxMs: number;
  cpuMeanMs: number;
  drawMeanMs: number;
  gpuMeanMs: number;
  physicsMeanMs: number;
  drawCallsMean: number;
  trianglesMean: number;
  /** Frames longer than the spike threshold, and what share of the window they are. */
  spikeCount: number;
  spikeRatio: number;
  /** Mean frame time on shadow-pass frames vs the rest — the periodic-hitch discriminator. */
  shadowFrameMeanMs: number;
  nonShadowFrameMeanMs: number;
  shadowFrames: number;
}

export const DEFAULT_CAPACITY = 1800; // ~30 s at 60 Hz
export const DEFAULT_SPIKE_MS = 33.4; // two 60 Hz frames — a visible hitch

export function emptySample(): FrameSample {
  return {
    t: 0,
    frameMs: 0,
    cpuMs: 0,
    drawMs: 0,
    gpuMs: -1,
    physicsMs: -1,
    drawCalls: 0,
    triangles: 0,
    shadowPass: false,
  };
}

/** Percentile over an ALREADY SORTED ascending array, nearest-rank. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/** Mean fps over the slowest 1% of frames (minimum one frame). */
export function low1Fps(frameTimes: number[]): number {
  if (frameTimes.length === 0) return 0;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const take = Math.max(1, Math.floor(sorted.length / 100));
  const worst = sorted.slice(sorted.length - take);
  const m = mean(worst);
  return m > 0 ? 1000 / m : 0;
}

/** Reduce a window of samples to the numbers a report quotes. Pure. */
export function summarize(
  samples: readonly FrameSample[],
  spikeMs: number = DEFAULT_SPIKE_MS,
): PerfStats {
  const frames = samples.length;
  if (frames === 0) {
    return {
      frames: 0,
      windowSec: 0,
      fpsMean: 0,
      fpsLow1: 0,
      frameMeanMs: 0,
      frameP50Ms: 0,
      frameP95Ms: 0,
      frameP99Ms: 0,
      frameMaxMs: 0,
      cpuMeanMs: 0,
      drawMeanMs: 0,
      gpuMeanMs: -1,
      physicsMeanMs: -1,
      drawCallsMean: 0,
      trianglesMean: 0,
      spikeCount: 0,
      spikeRatio: 0,
      shadowFrameMeanMs: 0,
      nonShadowFrameMeanMs: 0,
      shadowFrames: 0,
    };
  }
  const frameTimes = samples.map((s) => s.frameMs);
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const frameMean = mean(frameTimes);
  const gpuSamples = samples.filter((s) => s.gpuMs >= 0).map((s) => s.gpuMs);
  const physicsSamples = samples
    .filter((s) => s.physicsMs >= 0)
    .map((s) => s.physicsMs);
  const shadow = samples.filter((s) => s.shadowPass).map((s) => s.frameMs);
  const nonShadow = samples.filter((s) => !s.shadowPass).map((s) => s.frameMs);
  const spikeCount = frameTimes.filter((ms) => ms > spikeMs).length;

  return {
    frames,
    windowSec: frameTimes.reduce((a, b) => a + b, 0) / 1000,
    fpsMean: frameMean > 0 ? 1000 / frameMean : 0,
    fpsLow1: low1Fps(frameTimes),
    frameMeanMs: frameMean,
    frameP50Ms: percentile(sorted, 50),
    frameP95Ms: percentile(sorted, 95),
    frameP99Ms: percentile(sorted, 99),
    frameMaxMs: sorted[sorted.length - 1],
    cpuMeanMs: mean(samples.map((s) => s.cpuMs)),
    drawMeanMs: mean(samples.map((s) => s.drawMs)),
    gpuMeanMs: gpuSamples.length > 0 ? mean(gpuSamples) : -1,
    physicsMeanMs: physicsSamples.length > 0 ? mean(physicsSamples) : -1,
    drawCallsMean: mean(samples.map((s) => s.drawCalls)),
    trianglesMean: mean(samples.map((s) => s.triangles)),
    spikeCount,
    spikeRatio: spikeCount / frames,
    shadowFrameMeanMs: mean(shadow),
    nonShadowFrameMeanMs: mean(nonShadow),
    shadowFrames: shadow.length,
  };
}

/** Fixed-size ring of frame samples. Allocation-free in steady state: the buffer is filled
 *  once and then overwritten in place, so the monitor cannot itself be the GC spike it is
 *  looking for. */
export class PerfMonitor {
  private readonly buffer: FrameSample[];
  private head = 0;
  private filled = 0;

  constructor(readonly capacity: number = DEFAULT_CAPACITY) {
    this.buffer = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.buffer[i] = emptySample();
  }

  /** Overwrite the next slot in place and return it for the caller to fill. */
  push(sample: FrameSample): void {
    const slot = this.buffer[this.head];
    slot.t = sample.t;
    slot.frameMs = sample.frameMs;
    slot.cpuMs = sample.cpuMs;
    slot.drawMs = sample.drawMs;
    slot.gpuMs = sample.gpuMs;
    slot.physicsMs = sample.physicsMs;
    slot.drawCalls = sample.drawCalls;
    slot.triangles = sample.triangles;
    slot.shadowPass = sample.shadowPass;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  get size(): number {
    return this.filled;
  }

  /** Oldest-first copy of the retained window. */
  samples(): FrameSample[] {
    const out: FrameSample[] = [];
    for (let i = 0; i < this.filled; i++) {
      const index =
        (this.head - this.filled + i + this.capacity * 2) % this.capacity;
      out.push({ ...this.buffer[index] });
    }
    return out;
  }

  /** Stats over the last `frames` samples (default: the whole window). */
  stats(frames?: number, spikeMs: number = DEFAULT_SPIKE_MS): PerfStats {
    const all = this.samples();
    const window =
      frames && frames < all.length ? all.slice(all.length - frames) : all;
    return summarize(window, spikeMs);
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
  }
}
