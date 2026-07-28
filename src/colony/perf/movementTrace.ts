// Spec 158 — movement traces: record what the player did, replay it exactly.
//
// A stutter report is unfalsifiable until the same movement can be run twice. This module is
// the record/replay half of that: a trace is a time-stamped list of poses (plus the raw input
// that produced them and the per-frame timings measured at the time), and replay drives the
// camera from the POSE track.
//
// WHY POSE-DRIVEN REPLAY AND NOT INPUT-DRIVEN: re-simulating recorded input through a rigid
// body cannot be bit-exact — Rapier steps on wall-clock deltas, so a replay on a slower
// machine diverges within a second and the two runs stop being comparable. Replaying the pose
// track reproduces the exact camera path, which is what determines the render workload, which
// is what we are A/B-ing. The input track is recorded anyway so a future physics-determinism
// harness has it.
//
// Framework-agnostic: no three, no React, no DOM.

export interface TraceInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
}

export interface TraceFrame {
  /** Milliseconds since the trace started. */
  t: number;
  /** World-space camera position. */
  x: number;
  y: number;
  z: number;
  /** Camera yaw / pitch in radians (YXZ euler, as FirstPersonController uses). */
  yaw: number;
  pitch: number;
  input: TraceInput;
  /** Timings measured on the frame this pose was captured. */
  frameMs: number;
  cpuMs: number;
  drawMs: number;
  gpuMs: number;
  drawCalls: number;
  triangles: number;
}

export interface MovementTrace {
  version: 1;
  label: string;
  createdAt: number;
  /** Colony seed the trace was recorded against, when known — a trace is only meaningful
   *  against the world it was recorded in. */
  seed: number | null;
  frames: TraceFrame[];
}

export interface TracePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  input: TraceInput;
}

const NO_INPUT: TraceInput = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};

export function traceDurationMs(trace: MovementTrace): number {
  if (trace.frames.length === 0) return 0;
  return trace.frames[trace.frames.length - 1].t;
}

/** Shortest-arc interpolation between two angles, so a replay crossing ±π does not spin the
 *  camera the long way round and render a completely different scene for one frame. */
export function lerpAngle(a: number, b: number, k: number): number {
  const twoPi = Math.PI * 2;
  let delta = (b - a) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return a + delta * k;
}

/** The pose at `tMs` into the trace. Clamped at both ends; linearly interpolated between the
 *  bracketing frames, so replay is smooth and independent of the recording's frame rate —
 *  which is the point: a trace recorded on a stuttering machine must replay identically on a
 *  smooth one. */
export function sampleTraceAt(
  trace: MovementTrace,
  tMs: number,
): TracePose | null {
  const frames = trace.frames;
  if (frames.length === 0) return null;
  if (tMs <= frames[0].t) return poseOf(frames[0]);
  const last = frames[frames.length - 1];
  if (tMs >= last.t) return poseOf(last);

  // Binary search for the last frame at or before tMs.
  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= tMs) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = b.t - a.t;
  const k = span > 0 ? (tMs - a.t) / span : 0;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    yaw: lerpAngle(a.yaw, b.yaw, k),
    pitch: a.pitch + (b.pitch - a.pitch) * k,
    // Input is a step function, not a ramp: it holds the value of the frame it was sampled on.
    input: { ...a.input },
  };
}

function poseOf(frame: TraceFrame): TracePose {
  return {
    x: frame.x,
    y: frame.y,
    z: frame.z,
    yaw: frame.yaw,
    pitch: frame.pitch,
    input: { ...frame.input },
  };
}

/** Accumulates frames into a trace. Pre-sized so recording does not itself allocate per frame
 *  in the steady state. */
export class TraceRecorder {
  private frames: TraceFrame[] = [];
  private startedAt = 0;
  private label = "";
  private seed: number | null = null;
  private active = false;

  get recording(): boolean {
    return this.active;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  start(label: string, seed: number | null, nowMs: number): void {
    this.frames = [];
    this.startedAt = nowMs;
    this.label = label;
    this.seed = seed;
    this.active = true;
  }

  capture(frame: Omit<TraceFrame, "t">, nowMs: number): void {
    if (!this.active) return;
    this.frames.push({ ...frame, t: nowMs - this.startedAt });
  }

  stop(): MovementTrace {
    this.active = false;
    return {
      version: 1,
      label: this.label,
      createdAt: Date.now(),
      seed: this.seed,
      frames: this.frames,
    };
  }
}

export interface CanonicalTraceOptions {
  /** Where the walk starts, in world metres. */
  origin: { x: number; y: number; z: number };
  /** Heading the walk sets off on, radians. */
  startYaw?: number;
  /** Metres per second — MOVEMENT_SPEED in FirstPersonController is 10. */
  speed?: number;
  durationMs?: number;
  /** Sample interval; 16.667 ms is one 60 Hz frame. */
  stepMs?: number;
}

/**
 * A deterministic movement trace generated from numbers alone — no recorded asset, no human.
 *
 * This is what the automated measurement replays. It walks forward while sweeping the yaw
 * back and forth, which is the movement the operator described as jittery (walking around and
 * looking about) and the movement that exercises frustum culling hardest: the visible set
 * churns continuously instead of being a fixed view. Because it is a closed-form function of
 * time it is byte-identical on every machine and in every run, so a before/after comparison
 * measures the code change and nothing else.
 */
export function buildCanonicalTrace(
  options: CanonicalTraceOptions,
): MovementTrace {
  const {
    origin,
    startYaw = 0,
    speed = 10,
    durationMs = 12000,
    stepMs = 1000 / 60,
  } = options;
  const frames: TraceFrame[] = [];
  const yawSweep = Math.PI * 0.75; // ±135° of the world enters and leaves the frustum
  const yawPeriodMs = 4000;

  // Step count is derived so the LAST frame lands exactly on durationMs: a trace that stops
  // 16 ms short of its nominal length would make two runs cover slightly different ground.
  const steps = Math.max(1, Math.round(durationMs / stepMs));
  for (let i = 0; i <= steps; i++) {
    const t = (durationMs * i) / steps;
    const seconds = t / 1000;
    const yaw = startYaw + Math.sin((t / yawPeriodMs) * Math.PI * 2) * yawSweep;
    // Travel along the START heading (not the swept yaw) so the path is a straight line and
    // the walk cannot wander into the sea on one run and not on another.
    const distance = speed * seconds;
    frames.push({
      t,
      x: origin.x - Math.sin(startYaw) * distance,
      y: origin.y,
      z: origin.z - Math.cos(startYaw) * distance,
      yaw,
      pitch: 0,
      input: { ...NO_INPUT, forward: true },
      frameMs: 0,
      cpuMs: 0,
      drawMs: 0,
      gpuMs: -1,
      drawCalls: 0,
      triangles: 0,
    });
  }
  return {
    version: 1,
    label: "canonical-walk",
    createdAt: 0,
    seed: null,
    frames,
  };
}
