import type { ColonyRuntime } from "../runtime";

export interface FirstPersonDogfoodStep {
  label: string;
  /** Movement keys accepted by ColonyRuntime.setFpKey, e.g. w/a/s/d or arrows. */
  keys: string[];
  /** Real-time seconds to advance this held-key step. */
  seconds: number;
}

export interface FirstPersonDogfoodSnapshot {
  position: { x: number; y: number };
  heading: number;
  viewPosition: { x: number; y: number };
  viewHeading: number;
}

export interface FirstPersonDogfoodSample {
  label: string;
  keys: string[];
  seconds: number;
  before: FirstPersonDogfoodSnapshot;
  after: FirstPersonDogfoodSnapshot;
}

export interface FirstPersonDogfoodRun {
  citizenId: string;
  samples: FirstPersonDogfoodSample[];
}

function snapshot(runtime: ColonyRuntime): FirstPersonDogfoodSnapshot {
  const view = runtime.getUiState().firstPerson.view;
  if (!view) throw new Error("first-person dogfood requires an active view");
  return {
    position: { ...view.citizen.positionXY },
    heading: view.citizen.heading,
    viewPosition: { ...view.citizen.positionXY },
    viewHeading: view.citizen.heading,
  };
}

/**
 * Deterministically dogfoods a short first-person route without a browser RAF loop.
 *
 * It uses the same public key input path as the UI, then advances the runtime's
 * first-person driver once per scripted step so tests and future browser probes can
 * assert before/after position, heading and live view samples.
 */
export function driveFirstPersonRouteDogfood(
  runtime: ColonyRuntime,
  citizenId: string,
  steps: FirstPersonDogfoodStep[],
): FirstPersonDogfoodRun {
  if (!runtime.enterFirstPerson(citizenId)) {
    throw new Error(`cannot enter first-person for citizen ${citizenId}`);
  }
  const samples: FirstPersonDogfoodSample[] = [];

  for (const step of steps) {
    const before = snapshot(runtime);
    for (const key of step.keys) runtime.setFpKey(key, true);
    runtime.stepFirstPersonDogfood(step.seconds);
    for (const key of step.keys) runtime.setFpKey(key, false);
    const after = snapshot(runtime);
    samples.push({
      label: step.label,
      keys: [...step.keys],
      seconds: step.seconds,
      before,
      after,
    });
  }

  return { citizenId, samples };
}
