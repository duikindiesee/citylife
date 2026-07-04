// Spec 117 — staged mount thresholds. The staging must be monotonic (never regress a
// stage), gated on presented frames (never advance before the world has painted), and
// terminal at the final stage.
import { describe, it, expect } from "vitest";
import { BOOT_STAGE_FRAMES, BOOT_STAGE_FINAL, nextBootStage } from "../src/colony/render/bootStage";

describe("spec 117 — boot stage progression", () => {
  it("holds stage 0 until the world has actually presented", () => {
    expect(nextBootStage(0, 0)).toBe(0);
    expect(nextBootStage(0, BOOT_STAGE_FRAMES.city - 1)).toBe(0);
  });

  it("mounts the city after the world has been on screen", () => {
    expect(nextBootStage(0, BOOT_STAGE_FRAMES.city)).toBe(1);
  });

  it("mounts the dressing after the city has settled", () => {
    expect(nextBootStage(1, BOOT_STAGE_FRAMES.dressing - 1)).toBe(1);
    expect(nextBootStage(1, BOOT_STAGE_FRAMES.dressing)).toBe(2);
  });

  it("is terminal at the final stage and never regresses", () => {
    expect(nextBootStage(BOOT_STAGE_FINAL, 10_000)).toBe(BOOT_STAGE_FINAL);
    expect(nextBootStage(1, 0)).toBe(1); // a stage never goes backwards on low frame counts
  });

  it("walks 0 to 2 in order under a monotonic frame counter", () => {
    let stage = 0;
    const seen: number[] = [];
    for (let f = 0; f <= BOOT_STAGE_FRAMES.dressing + 5; f++) {
      stage = nextBootStage(stage, f);
      seen.push(stage);
    }
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(2);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen); // monotonic
  });
});
