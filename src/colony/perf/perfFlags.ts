// Spec 158 — the performance instrumentation flag.
//
// EVERYTHING in src/colony/perf is OFF by default. Nothing in this directory may allocate,
// patch a renderer method, or mount DOM unless the flag below says yes: the whole point of a
// perf tool is that it costs nothing when it is not being used, otherwise the instrument
// changes the thing it measures.
//
// Arming is deliberate and per-session:
//   ?perf=1          — arm the perf subsystem and show the HUD
//   ?perf=armed      — arm the subsystem, HUD hidden until toggled
//   localStorage citylife.perf = "1" | "armed"
// Once armed, F9 toggles HUD visibility. Nothing responds to F9 when disarmed.

export type PerfArming = "off" | "armed" | "hud";

const STORAGE_KEY = "citylife.perf";

function normalize(raw: string | null | undefined): PerfArming | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "hud" || value === "true") return "hud";
  if (value === "armed" || value === "2") return "armed";
  if (value === "0" || value === "off" || value === "false") return "off";
  return null;
}

/** Resolve the arming level from a query string and a storage value. Pure, so tests can
 *  assert the default really is off without touching the DOM. */
export function resolvePerfArming(
  search: string,
  stored: string | null,
): PerfArming {
  const params = new URLSearchParams(search);
  const fromQuery = normalize(params.get("perf"));
  if (fromQuery !== null) return fromQuery;
  const fromStorage = normalize(stored);
  if (fromStorage !== null) return fromStorage;
  return "off";
}

let cached: PerfArming | null = null;

/** The live arming level for this page. Cached: the flag must not change mid-session, or the
 *  before/after halves of a measurement would not be comparable. */
export function perfArming(): PerfArming {
  if (cached !== null) return cached;
  if (typeof window === "undefined") {
    cached = "off";
    return cached;
  }
  let stored: string | null = null;
  try {
    stored = window.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  cached = resolvePerfArming(window.location?.search ?? "", stored);
  return cached;
}

/** True when the perf subsystem should run at all. */
export function perfArmed(): boolean {
  return perfArming() !== "off";
}

/** Test-only: forget the cached arming so a spec can re-resolve it. */
export function resetPerfArmingCache(): void {
  cached = null;
}
