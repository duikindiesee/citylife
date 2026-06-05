// Sols — the colony measures its age in REAL days (operator directive: every real day is a sol).
//
// The sim's internal clock (sim.ts ColonyClock) keeps stepping at its fast cadence so the economy stays
// alive and watchable for a 24/7 broadcast. The SOL is a separate, wall-clock count of real days since the
// colony was founded, so the audience sees an honest "Landing One is N sols old" that advances once per real
// day and survives reloads / tab-throttle / a 24/7 deploy. Pure + deterministic so it is unit-testable
// without a real clock (the runtime feeds Date.now()).

export const MS_PER_SOL = 86_400_000 // one real day

/** How many whole sols (real days) have elapsed since the founding instant. Never negative; 0 on the
 *  founding day. Returns 0 for non-finite inputs so a missing/garbage founding stamp can never crash the HUD. */
export function solCount(foundingMs: number, nowMs: number): number {
  if (!Number.isFinite(foundingMs) || !Number.isFinite(nowMs)) return 0
  return Math.max(0, Math.floor((nowMs - foundingMs) / MS_PER_SOL))
}

/** Real seconds left until the sol counter ticks over to the next sol (for a countdown in the HUD). */
export function secondsToNextSol(foundingMs: number, nowMs: number): number {
  if (!Number.isFinite(foundingMs) || !Number.isFinite(nowMs)) return 0
  const elapsed = nowMs - foundingMs
  if (elapsed < 0) return Math.ceil(-elapsed / 1000)
  return Math.ceil((MS_PER_SOL - (elapsed % MS_PER_SOL)) / 1000)
}

/** Resolve (and lazily persist) the colony founding instant. For a 24/7 deploy the founding date is fixed
 *  on first boot and sols accumulate in real time from there. Falls back to nowMs when storage is absent. */
export function resolveFoundingMs(
  store: { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined,
  nowMs: number,
  key = 'citylife_founding_ms',
): number {
  if (!store) return nowMs
  const saved = store.getItem(key)
  const n = saved === null ? NaN : Number(saved)
  if (Number.isFinite(n) && n > 0) return n
  store.setItem(key, String(nowMs))
  return nowMs
}
