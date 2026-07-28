// Spec 158 — measurement knobs.
//
// The rule this lane was given is measure, then name the cause, THEN change code. That is
// impossible if testing a hypothesis requires editing the renderer, because then every test
// is itself a code change and the "before" is gone. So each candidate cause gets a knob that
// can be switched off from the harness (window.__perfExperiment, planted by an init script)
// and the difference in frame time IS the measurement of that cause.
//
// Every knob defaults to the shipped behaviour, and the whole mechanism is inert unless the
// perf flag armed the session — a production page never reads window.__perfExperiment.

import { perfArmed } from "./perfFlags";

export interface PerfExperiment {
  /** Mount R3FFoliage at all. Off = the 75k-instance conifer layer is absent entirely. */
  foliage: boolean;
  /** Foliage casts into the sun's shadow map. Off = trees still render, but the shadow pass
   *  no longer walks their instance buffer. This is the knob that separates "too much
   *  geometry on screen" from "too much geometry in the shadow pass". */
  foliageShadow: boolean;
  /** Refresh the shadow map at all. */
  shadows: boolean;
  /** Frames between shadow-map refreshes (shipped: 4). */
  shadowCadence: number;
  /** Mount the post-processing stack (Bloom + tone mapping). */
  postProcessing: boolean;
  /** Distance in metres beyond which foliage instances are dropped; 0 = no distance cull. */
  foliageCullDistance: number;
}

const SHIPPED: PerfExperiment = {
  foliage: true,
  foliageShadow: true,
  shadows: true,
  shadowCadence: 4,
  postProcessing: true,
  foliageCullDistance: 0,
};

let cached: PerfExperiment | null = null;

/** Merge the harness's overrides over the shipped defaults. Pure, so the precedence is
 *  testable without a browser. */
export function mergeExperiment(
  overrides: Partial<PerfExperiment> | null | undefined,
): PerfExperiment {
  if (!overrides) return { ...SHIPPED };
  const merged = { ...SHIPPED };
  for (const key of Object.keys(SHIPPED) as (keyof PerfExperiment)[]) {
    const value = overrides[key];
    if (value === undefined || value === null) continue;
    if (typeof value === typeof merged[key]) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/** The knob values for this session. Shipped defaults unless the perf flag is armed AND the
 *  harness planted overrides. Cached: a knob must not change mid-measurement. */
export function perfExperiment(): PerfExperiment {
  if (cached) return cached;
  if (!perfArmed() || typeof window === "undefined") {
    cached = { ...SHIPPED };
    return cached;
  }
  const raw = (
    window as unknown as { __perfExperiment?: Partial<PerfExperiment> }
  ).__perfExperiment;
  cached = mergeExperiment(raw);
  return cached;
}

/** Test-only. */
export function resetPerfExperimentCache(): void {
  cached = null;
}
