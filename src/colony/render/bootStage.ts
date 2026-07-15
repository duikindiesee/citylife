// Spec 117 — staged mount. Boot profiling (2026-07-04) showed ~16s of an ~18s cold load
// spent mounting the FULL R3F tree in one synchronous commit (terrain build + foliage scan
// + props + road meshes + postprocessing shader compiles) before the player saw anything.
// The world now mounts in three stages keyed on PRESENTED frames — the player sees terrain
// and sea first, then the city, then the dressing:
//   stage 0  terrain, ocean, lights, physics, camera   (the world exists)
//   stage 1  roads, zones, foliage, cars, foam         (the city arrives)
//   stage 2  props, clouds, contact shadows, postprocessing (the polish lands)
// Pure logic, node-testable; the R3F hook lives in R3FPlanetRenderer.

/** Presented-frame thresholds: bump to the next stage only after the current one has
 *  actually been on screen for a few frames, so the first paint is never blocked. */
export const BOOT_STAGE_FRAMES = {
  /** frames of stage 0 before the city mounts */
  city: 5,
  /** frames (total) before the dressing mounts */
  dressing: 20,
} as const;

export const BOOT_STAGE_FINAL = 2;

/** Next boot stage given the current stage and how many frames have presented. */
export function nextBootStage(stage: number, framesPresented: number): number {
  if (stage === 0 && framesPresented >= BOOT_STAGE_FRAMES.city) return 1;
  if (stage === 1 && framesPresented >= BOOT_STAGE_FRAMES.dressing) return 2;
  return stage;
}
