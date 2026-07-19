// Canonical CityLife time.
//
// The epoch is the START of the Johannesburg calendar day containing CityLife's first
// git commit (c19aa9bd, authored 2026-05-30 09:52:49 +02:00). One CityLife sol lasts
// six real hours, so every Johannesburg day contains exactly four sols. Within each
// sol the familiar 24-hour game clock is compressed: fifteen real minutes equal one
// in-sol hour. This clock is fixed for every browser and deployment; no localStorage.
//
// Spec 150 PR1 (rescoped — additive helpers on the existing epoch): this module is the
// single source of sol truth. `solsSinceEpoch`, `solMinutesSinceEpoch`, `solMinuteOfDay`,
// `solClockOfDay` and `solPhase` are pure functions of a millisecond instant and default
// to `CITYLIFE_EPOCH_MS`; an epoch may be injected for tests. `canonicalSolClock` is
// re-expressed in terms of them, so the clock and the helpers can never disagree. No new
// epoch is introduced and no bus or HUD behaviour changes.

export const CITYLIFE_EPOCH_MS = 1_780_092_000_000;
export const MS_PER_SOL = 21_600_000; // six real hours
export const SOLS_PER_EARTH_DAY = 4;
export const MINUTES_PER_SOL = 24 * 60;

/** Real milliseconds elapsed since the epoch, clamped so pre-epoch or garbage input yields
 *  0 rather than a negative or NaN sol. Shared by every derived helper. */
function elapsedSinceEpoch(nowMs: number, epochMs: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(epochMs)) return 0;
  return Math.max(0, nowMs - epochMs);
}

/** Whole sols elapsed since the epoch. Replaces the former `solCount`; the epoch now defaults
 *  to the canonical epoch, and an injected epoch remains available for tests. */
export function solsSinceEpoch(
  nowMs: number,
  epochMs: number = CITYLIFE_EPOCH_MS,
): number {
  return Math.floor(elapsedSinceEpoch(nowMs, epochMs) / MS_PER_SOL);
}

/** Cumulative compressed in-sol minutes since the epoch across every sol so far. */
export function solMinutesSinceEpoch(
  nowMs: number,
  epochMs: number = CITYLIFE_EPOCH_MS,
): number {
  return Math.floor(
    (elapsedSinceEpoch(nowMs, epochMs) * MINUTES_PER_SOL) / MS_PER_SOL,
  );
}

/** Compressed in-sol minute within the current sol's 24-hour day, in [0, 1440). */
export function solMinuteOfDay(
  nowMs: number,
  epochMs: number = CITYLIFE_EPOCH_MS,
): number {
  return solMinutesSinceEpoch(nowMs, epochMs) % MINUTES_PER_SOL;
}

export interface SolClockOfDay {
  hour: number;
  minute: number;
}

/** In-sol wall clock {hour, minute} within the current sol day. */
export function solClockOfDay(
  nowMs: number,
  epochMs: number = CITYLIFE_EPOCH_MS,
): SolClockOfDay {
  const minuteOfDay = solMinuteOfDay(nowMs, epochMs);
  return { hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 };
}

/** Normalized progress through the current sol, in [0, 1). Drives sky/lighting interpolation
 *  without exposing the underlying millisecond arithmetic to renderers. */
export function solPhase(
  nowMs: number,
  epochMs: number = CITYLIFE_EPOCH_MS,
): number {
  return (elapsedSinceEpoch(nowMs, epochMs) % MS_PER_SOL) / MS_PER_SOL;
}

export interface CanonicalSolClock {
  sol: number;
  earthDay: number;
  solOfEarthDay: number;
  hour: number;
  minute: number;
  isDay: boolean;
}

/** Derive the public CityLife clock from one immutable epoch. Pre-epoch/garbage input clamps
 * to the founding instant so the HUD can never show a negative or invalid sol. Built from the
 * pure helpers above so the clock and the helpers can never disagree. */
export function canonicalSolClock(nowMs: number): CanonicalSolClock {
  const sol = solsSinceEpoch(nowMs);
  const { hour, minute } = solClockOfDay(nowMs);
  return {
    sol,
    earthDay: Math.floor(sol / SOLS_PER_EARTH_DAY),
    solOfEarthDay: sol % SOLS_PER_EARTH_DAY,
    hour,
    minute,
    isDay: hour >= 6 && hour < 20,
  };
}

/** Real seconds left until the next six-hour sol boundary. */
export function secondsToNextSol(foundingMs: number, nowMs: number): number {
  if (!Number.isFinite(foundingMs) || !Number.isFinite(nowMs)) return 0;
  const elapsed = nowMs - foundingMs;
  if (elapsed < 0) return Math.ceil(-elapsed / 1000);
  return Math.ceil((MS_PER_SOL - (elapsed % MS_PER_SOL)) / 1000);
}
