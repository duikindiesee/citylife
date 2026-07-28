// Spec 158 — real GPU frame time via EXT_disjoint_timer_query_webgl2.
//
// The CPU/GPU split is the first question the jitter investigation has to answer, and the
// only honest way to answer it is to ask the GPU. Where the extension is unavailable (it is
// gated in several browsers, and absent under SwiftShader) every read returns -1 and the
// caller falls back to the derived signal: frameMs - cpuMs - drawMs is time the main thread
// spent blocked, which on a GPU-bound frame is the swap wait.
//
// TIME_ELAPSED_EXT allows exactly one query in flight, and a result is not readable on the
// frame it was issued, so this keeps a small pool and reports the most recent RESOLVED frame.

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuFrameTimer {
  private ext: TimerExtension | null = null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private lastMs = -1;

  constructor(private readonly gl: WebGL2RenderingContext | null) {
    if (!gl || typeof gl.createQuery !== "function") return;
    try {
      this.ext = gl.getExtension(
        "EXT_disjoint_timer_query_webgl2",
      ) as TimerExtension | null;
    } catch {
      this.ext = null;
    }
  }

  get available(): boolean {
    return this.ext !== null;
  }

  /** Open a query around the frame's draw submission. No-op when unsupported. */
  begin(): void {
    const { gl, ext } = this;
    if (!gl || !ext || this.active) return;
    const query = gl.createQuery();
    if (!query) return;
    try {
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      this.active = query;
    } catch {
      this.ext = null;
    }
  }

  /** Close the open query and harvest whatever has resolved since. */
  end(): void {
    const { gl, ext } = this;
    if (!gl || !ext || !this.active) return;
    try {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
    } catch {
      this.ext = null;
    }
    this.active = null;
    this.harvest();
  }

  /** Milliseconds of GPU time for the most recently resolved frame, or -1. */
  read(): number {
    return this.lastMs;
  }

  private harvest(): void {
    const { gl, ext } = this;
    if (!gl || !ext) return;
    // A disjoint event means every in-flight timing is garbage — throw the lot away rather
    // than quote a number the driver has already disowned.
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (disjoint) {
      for (const query of this.pending) gl.deleteQuery(query);
      this.pending.length = 0;
      this.lastMs = -1;
      return;
    }
    while (this.pending.length > 0) {
      const query = this.pending[0];
      const ready = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      if (!ready) break;
      const nanoseconds = gl.getQueryParameter(
        query,
        gl.QUERY_RESULT,
      ) as number;
      this.lastMs = nanoseconds / 1e6;
      gl.deleteQuery(query);
      this.pending.shift();
    }
    // Never let a stalled driver grow the pool without bound.
    while (this.pending.length > 8) {
      const query = this.pending.shift();
      if (query) gl.deleteQuery(query);
    }
  }

  dispose(): void {
    const { gl } = this;
    if (!gl) return;
    for (const query of this.pending) gl.deleteQuery(query);
    this.pending.length = 0;
    this.active = null;
  }
}
