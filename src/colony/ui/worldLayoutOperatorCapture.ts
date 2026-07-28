// Spec 158 — the gate on the world-layout operator capture.
//
// WHY THIS EXISTS (measured, PERF.FP.JITTER.1):
// `runtime.captureWorldLayout()` rebuilds the seeded world survey, canonically serialises the
// entire world-layout document and takes a SHA-256 content hash of it. On seed 4242 that is a
// ~220 ms synchronous task. It used to be called straight from the ColonyApp render body, and
// the runtime's 200 ms UI heartbeat re-renders ColonyApp five times a second — so the main
// thread spent ~97% of its time inside this one call (22 long tasks totalling 4,849 ms per
// 5 s window) and the animation frame starved. Measured: 7.8 fps with the heartbeat live,
// 60.2 fps with it stubbed, on identical scene content.
//
// The captured document is used for exactly one thing: comparing its content hash against the
// durable head so the operator's revision controls can say "clean" or "dirty". Those controls
// render only inside the City Builder / World View chrome (`BuilderPanel` returns early
// otherwise). While the player is walking around, the capture is computed, hashed, and thrown
// away unobserved.
//
// So the gate is not a heuristic or a throttle: it is the exact condition under which the
// result can be seen. When it is false the output is unobservable, which is why skipping it
// cannot change behaviour. Save / export / rollback each re-capture at click time, so the
// operator's actions still work on a live document.

/** The slice of the runtime this needs — structural, so the test can pass a counting stub. */
export interface WorldLayoutCaptureSource<TDocument> {
  captureWorldLayout(): TDocument;
}

export interface WorldLayoutCaptureConditions {
  /** The world-layout boot barrier has published a head. */
  bootReady: boolean;
  /** The operator surface that DISPLAYS the capture is on screen. */
  consumerVisible: boolean;
}

export interface WorldLayoutCaptureResult<TDocument> {
  document: TDocument | null;
  error: string | null;
}

/** True only when the capture's result can actually be observed by the operator. */
export function shouldCaptureWorldLayout(
  conditions: WorldLayoutCaptureConditions,
): boolean {
  return conditions.bootReady && conditions.consumerVisible;
}

/**
 * Capture the world layout for the operator's revision controls, or don't.
 *
 * Never throws: a capture failure is reported as `error` so the caller can show it instead of
 * tearing the UI down, which is what the original inline try/catch did.
 */
export function captureWorldLayoutForOperator<TDocument>(
  source: WorldLayoutCaptureSource<TDocument>,
  conditions: WorldLayoutCaptureConditions,
): WorldLayoutCaptureResult<TDocument> {
  if (!shouldCaptureWorldLayout(conditions))
    return { document: null, error: null };
  try {
    return { document: source.captureWorldLayout(), error: null };
  } catch (error: unknown) {
    return {
      document: null,
      error:
        error instanceof Error
          ? error.message
          : "The current world layout could not be captured",
    };
  }
}
