// Canonical CityLife time.
//
// The epoch is the START of the Johannesburg calendar day containing CityLife's first
// git commit (c19aa9bd, authored 2026-05-30 09:52:49 +02:00). One CityLife sol lasts
// six real hours, so every Johannesburg day contains exactly four sols. Within each
// sol the familiar 24-hour game clock is compressed: fifteen real minutes equal one
// in-sol hour. This clock is fixed for every browser and deployment; no localStorage.

export const CITYLIFE_EPOCH_MS = 1_780_092_000_000;
export const MS_PER_SOL = 6 * 60 * 60 * 1000;
export const SOLS_PER_EARTH_DAY = 4;
export const MINUTES_PER_SOL = 24 * 60;

export interface CanonicalSolClock {
  sol: number;
  earthDay: number;
  solOfEarthDay: number;
  hour: number;
  minute: number;
  isDay: boolean;
}

/** Derive the public CityLife clock from one immutable epoch. Pre-epoch/garbage input
 * clamps to the founding instant so the HUD can never show a negative or invalid sol. */
export function canonicalSolClock(nowMs: number): CanonicalSolClock {
  const safeNow = Number.isFinite(nowMs)
    ? Math.max(CITYLIFE_EPOCH_MS, nowMs)
    : CITYLIFE_EPOCH_MS;
  const elapsed = safeNow - CITYLIFE_EPOCH_MS;
  const sol = Math.floor(elapsed / MS_PER_SOL);
  const withinSol = elapsed % MS_PER_SOL;
  const minuteOfSol = Math.floor(
    (withinSol * MINUTES_PER_SOL) / MS_PER_SOL,
  );
  const hour = Math.floor(minuteOfSol / 60);
  const minute = minuteOfSol % 60;
  return {
    sol,
    earthDay: Math.floor(sol / SOLS_PER_EARTH_DAY),
    solOfEarthDay: sol % SOLS_PER_EARTH_DAY,
    hour,
    minute,
    isDay: hour >= 6 && hour < 20,
  };
}

/** Generic elapsed-sol helper retained for callers/tests that compare arbitrary epochs. */
export function solCount(foundingMs: number, nowMs: number): number {
  if (!Number.isFinite(foundingMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - foundingMs) / MS_PER_SOL));
}

/** Real seconds left until the next six-hour sol boundary. */
export function secondsToNextSol(foundingMs: number, nowMs: number): number {
  if (!Number.isFinite(foundingMs) || !Number.isFinite(nowMs)) return 0;
  const elapsed = nowMs - foundingMs;
  if (elapsed < 0) return Math.ceil(-elapsed / 1000);
  return Math.ceil((MS_PER_SOL - (elapsed % MS_PER_SOL)) / 1000);
}
