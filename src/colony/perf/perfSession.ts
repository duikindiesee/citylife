// Spec 158 — the perf session: the single object the HUD, the renderer probe and the
// measurement harness all talk to, plus the window.__perf console/Playwright surface.
//
// Nothing here runs unless perfArmed() is true (see perfFlags.ts).

import {
  PerfMonitor,
  type FrameSample,
  type PerfStats,
  DEFAULT_SPIKE_MS,
} from "./perfMonitor";
import {
  TraceRecorder,
  buildCanonicalTrace,
  sampleTraceAt,
  traceDurationMs,
  type MovementTrace,
  type CanonicalTraceOptions,
  type TraceFrame,
} from "./movementTrace";
import { censusOf, type SceneCensus, type CensusNode } from "./sceneCensus";
import { setReplayPose } from "./replayBridge";
import { perfArmed, perfArming } from "./perfFlags";

export interface ReplayResult {
  label: string;
  durationMs: number;
  frames: number;
  stats: PerfStats;
  census: SceneCensus | null;
  samples: FrameSample[];
}

interface ReplayJob {
  trace: MovementTrace;
  startedAt: number;
  settle: (result: ReplayResult) => void;
  /** Frames to discard at the start so shader compiles and the first-touch of a texture do
   *  not get charged to the steady-state measurement. */
  warmupFrames: number;
  seen: number;
}

export class PerfSession {
  readonly monitor = new PerfMonitor();
  readonly recorder = new TraceRecorder();
  hudVisible = perfArming() === "hud";
  gpuAvailable = false;
  /** Set by the renderer probe so census() can walk the live scene. */
  sceneRoot: CensusNode | null = null;
  lastCensus: SceneCensus | null = null;
  private job: ReplayJob | null = null;
  private listeners = new Set<() => void>();

  get replaying(): boolean {
    return this.job !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    this.emit();
  }

  /** Frames sampled since the session was created. A census or a statistic taken while this
   *  is not advancing is not a measurement of the world — it is a measurement of a detached
   *  probe, and the harness must be able to tell the difference. */
  framesSeen = 0;
  /** Bumped every time a renderer probe attaches; a jump mid-measurement means the canvas was
   *  torn down and re-created, which invalidates the window. */
  probeGeneration = 0;

  census(): SceneCensus {
    // Fall back to the published scene probe: the renderer probe's bookkeeping can lose the
    // reference if the canvas is re-created, and a census of null silently reads as "the
    // world is empty" — the most misleading answer available.
    const root =
      this.sceneRoot ??
      (typeof window !== "undefined"
        ? (window as unknown as { __r3fScene?: CensusNode }).__r3fScene
        : null) ??
      null;
    this.lastCensus = censusOf(root);
    return this.lastCensus;
  }

  /** Called by the renderer probe once per frame, after the sample is complete. */
  onFrame(sample: FrameSample, pose: Omit<TraceFrame, "t"> | null): void {
    this.framesSeen++;
    this.monitor.push(sample);
    if (pose) this.recorder.capture(pose, sample.t);
    const job = this.job;
    if (!job) return;
    job.seen++;
    const elapsed = sample.t - job.startedAt;
    const total = traceDurationMs(job.trace);
    if (job.seen <= job.warmupFrames) {
      // Hold the walker at the trace's first pose while the warm-up frames burn off, then
      // restart the clock so the measured window starts at t=0 of the trace.
      setReplayPose(sampleTraceAt(job.trace, 0));
      job.startedAt = sample.t;
      if (job.seen === job.warmupFrames) this.monitor.reset();
      return;
    }
    if (elapsed >= total) {
      this.finishReplay(job);
      return;
    }
    setReplayPose(sampleTraceAt(job.trace, elapsed));
  }

  private finishReplay(job: ReplayJob): void {
    setReplayPose(null);
    this.job = null;
    const samples = this.monitor.samples();
    const result: ReplayResult = {
      label: job.trace.label,
      durationMs: traceDurationMs(job.trace),
      frames: samples.length,
      stats: this.monitor.stats(undefined, DEFAULT_SPIKE_MS),
      census: this.census(),
      samples,
    };
    job.settle(result);
    this.emit();
  }

  /** Replay a trace and resolve with the frame statistics measured during it. This is the
   *  A/B primitive: the same trace, the same warm-up, two builds. */
  runTrace(trace: MovementTrace, warmupFrames = 30): Promise<ReplayResult> {
    if (this.job)
      return Promise.reject(new Error("a replay is already running"));
    this.monitor.reset();
    return new Promise<ReplayResult>((resolve) => {
      this.job = {
        trace,
        startedAt: 0,
        settle: resolve,
        warmupFrames,
        seen: 0,
      };
      setReplayPose(sampleTraceAt(trace, 0));
      this.emit();
    });
  }

  cancelReplay(): void {
    setReplayPose(null);
    this.job = null;
    this.emit();
  }
}

let session: PerfSession | null = null;

/** The session, created on first use. Returns null when the perf flag is off, so every call
 *  site is forced to handle "not armed" and no perf code can run by accident. */
export function perfSession(): PerfSession | null {
  if (!perfArmed()) return null;
  if (!session) session = new PerfSession();
  return session;
}

/** Publish the console / Playwright surface. Idempotent; no-op when disarmed. */
export function installPerfGlobal(): void {
  const s = perfSession();
  if (!s || typeof window === "undefined") return;
  const w = window as unknown as { __perf?: unknown };
  if (w.__perf) return;
  w.__perf = {
    get armed() {
      return true;
    },
    get hudVisible() {
      return s.hudVisible;
    },
    get gpuAvailable() {
      return s.gpuAvailable;
    },
    get recording() {
      return s.recorder.recording;
    },
    get replaying() {
      return s.replaying;
    },
    toggleHud: () => s.toggleHud(),
    stats: (frames?: number) => s.monitor.stats(frames),
    samples: () => s.monitor.samples(),
    census: () => s.census(),
    reset: () => s.monitor.reset(),
    startRecording: (label = "recording", seed: number | null = null) =>
      s.recorder.start(label, seed, performance.now()),
    stopRecording: () => s.recorder.stop(),
    canonicalTrace: (options: CanonicalTraceOptions) =>
      buildCanonicalTrace(options),
    runTrace: (trace: MovementTrace, warmupFrames?: number) =>
      s.runTrace(trace, warmupFrames),
    cancelReplay: () => s.cancelReplay(),
  };
}
