// Spec 150 PR2 — the ONE runtime instant every sol consumer reads.
//
// `sol.ts` stays pure: it maps an instant to sol time and never holds state. This module owns the
// single mutable piece — a debug-only offset — so the bus fleet, the sky/day-night cycle and the
// HUD all resolve the same instant and therefore share one clock. Without it, a debug time jump
// would move one consumer and not the others.
//
// The offset is debug/e2e only. Production never sets it, so `solNowMs()` is just `Date.now()`.

let debugOffsetMs = 0;

/** The instant every sol consumer must use. Real wall clock plus any debug offset. */
export function solNowMs(): number {
  return Date.now() + debugOffsetMs;
}

/** Debug/e2e only — shift the shared sol instant. Non-finite input resets the offset. */
export function setSolDebugOffsetMs(offsetMs: number): void {
  debugOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
}

/** The active debug offset in real milliseconds; 0 in production. */
export function solDebugOffsetMs(): number {
  return debugOffsetMs;
}
