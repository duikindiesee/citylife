// Spec 158 — the one mutable cell the walker reads while a trace is replaying.
//
// Deliberately its own module with no imports: FirstPersonController is on the hot path and
// must not pull the perf subsystem in behind it. When nothing is replaying the value is null
// and the walker's check is a single null test per frame.

import type { TracePose } from "./movementTrace";

let pose: TracePose | null = null;

/** The pose the active replay wants the walker to occupy this frame, or null when live. */
export function replayPose(): TracePose | null {
  return pose;
}

export function setReplayPose(next: TracePose | null): void {
  pose = next;
}
